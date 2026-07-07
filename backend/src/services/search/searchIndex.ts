/**
 * SearchIndex — persistent full-text index over the whole dictionary (#search-index).
 *
 * A **derived cache**, not a source of truth: files under the project remain
 * canonical; this index is rebuilt from them on boot and can be deleted at any
 * time. It is backed by SQLite **FTS5** via Node's built-in `node:sqlite`
 * (already used by the SQL-run feature; Node ≥22.5). FTS5 gives real BM25
 * ranking, prefix and boolean matching, and `snippet()` highlighting — far
 * beyond the previous O(n) substring scan in `serviceService.searchEntities`.
 *
 * **Where it lives.** `node:sqlite` needs a real local file it can lock/mmap —
 * it cannot go through `IStorageBackend` (which may be git-backed or in-memory)
 * — and the index must never be committed into the project's git repo. So it
 * lives per-project under the app dir, keyed by a hash of the resolved data
 * directory: `~/.dico-app/storage/search/<key>/index.sqlite`. Tests pass
 * `':memory:'`.
 *
 * **Lifecycle** mirrors `UuidIndex`: boot calls `rebuild()` once, then a
 * projection subscriber calls `reindexPackage()` / `removePackage()` on writes.
 * All three consumers — the top-bar, `/api/search`, and the AI `searchModel`
 * tool — query one `search()` method.
 */
import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import { STORAGE_DIR } from '../../utils/appDir.js';
import { logger } from '../../utils/logger.js';
import type { Package } from '../../models/Dictionary.js';
import { packageToSearchDocs, KIND_TIER, type SearchDoc, type SearchKind } from './searchDocuments.js';

/** Bump when the schema/tokenizer changes so an old on-disk index is dropped + rebuilt. */
const SCHEMA_VERSION = 1;

/** Each per-kind tier worsens the effective score by this much (bm25: lower = better). */
const TIER_PENALTY = 0.5;

export interface SearchHit {
  id: string;
  kind: SearchKind;
  name: string;
  description: string;
  package: string;
  entityName: string;
  route: string;
  /** Effective rank (bm25 + tier penalty); lower is better. */
  score: number;
  /** Highlighted fragment of the best-matching field. */
  snippet: string;
}

export interface SearchOptions {
  /** Restrict to these kinds (default: all). */
  kinds?: SearchKind[];
  /** Restrict to one package. */
  package?: string;
  /** Max hits (default 20, hard cap 100). */
  limit?: number;
}

/** Resolve the on-disk index path for a given data directory. */
export function searchIndexPathFor(dataDir: string): string {
  const key = createHash('sha256').update(path.resolve(dataDir), 'utf8').digest('hex').slice(0, 16);
  return path.join(STORAGE_DIR, 'search', key, 'index.sqlite');
}

/**
 * Turn a free-text query into an FTS5 MATCH expression: split into alphanumeric
 * tokens, make each a prefix term, AND them together. Returns null when the
 * query has no usable tokens (caller returns []). Stripping to `[\p{L}\p{N}_]`
 * removes every FTS5 metacharacter, so the result is always a safe expression.
 */
export function toMatchQuery(raw: string): string | null {
  const tokens = (raw || '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}_]+/u)
    .filter((t) => t.length > 0);
  if (tokens.length === 0) return null;
  return tokens.map((t) => `${t}*`).join(' ');
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

export class SearchIndex {
  private db: Db | null = null;
  private ready = false;

  constructor(private readonly dbPath: string) {}

  /** Whether the index opened successfully and is usable. */
  isReady(): boolean {
    return this.ready;
  }

  /**
   * Open the database (creating parent dirs) and ensure the schema. On any
   * failure — node:sqlite unavailable, disk error — it logs and stays
   * `ready=false`; callers fall back to the legacy scan so search never breaks.
   */
  async open(): Promise<boolean> {
    if (this.ready) return true;
    let DatabaseSync: new (p: string) => Db;
    try {
      // @types/node@20 ships no node:sqlite typings; a non-literal specifier
      // keeps tsc from resolving the (real, built-in) Node ≥22.5 module. Same
      // pattern as services/sql/executors.ts.
      const sqliteModule: string = 'node:sqlite';
      ({ DatabaseSync } = await import(sqliteModule));
    } catch (e) {
      logger.warn(`SearchIndex: node:sqlite unavailable — full-text index disabled (${e instanceof Error ? e.message : String(e)})`);
      return false;
    }
    try {
      if (this.dbPath !== ':memory:') {
        fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });
      }
      this.db = new DatabaseSync(this.dbPath);
      this.ensureSchema();
      this.ready = true;
      return true;
    } catch (e) {
      logger.warn(`SearchIndex: failed to open ${this.dbPath} — ${e instanceof Error ? e.message : String(e)}`);
      this.db = null;
      return false;
    }
  }

  private ensureSchema(): void {
    const row = this.db.prepare('PRAGMA user_version').get() as { user_version: number } | undefined;
    const version = row?.user_version ?? 0;
    if (version !== SCHEMA_VERSION) {
      // Drop any stale-schema table and recreate. The index is derived, so a
      // rebuild follows immediately at boot.
      this.db.exec('DROP TABLE IF EXISTS docs');
      this.db.exec(`CREATE VIRTUAL TABLE docs USING fts5(
        id UNINDEXED, kind UNINDEXED, package UNINDEXED, entityName UNINDEXED, route UNINDEXED,
        name, description, keywords,
        tokenize='unicode61 remove_diacritics 2'
      )`);
      this.db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    }
  }

  private insertDocs(docs: SearchDoc[]): void {
    const stmt = this.db.prepare(
      `INSERT INTO docs(id, kind, package, entityName, route, name, description, keywords)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const d of docs) {
      stmt.run(d.id, d.kind, d.package, d.entityName, d.route, d.name, d.description, d.keywords);
    }
  }

  /** Full rebuild from the given loaded packages. Atomic (single transaction). */
  rebuildFrom(packages: Package[]): void {
    if (!this.ready) return;
    this.db.exec('BEGIN');
    try {
      this.db.exec('DELETE FROM docs');
      for (const pkg of packages) this.insertDocs(packageToSearchDocs(pkg));
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  /** Replace all docs for one package (delete-then-insert). Used incrementally. */
  reindexPackage(pkg: Package): void {
    if (!this.ready) return;
    this.db.exec('BEGIN');
    try {
      this.db.prepare('DELETE FROM docs WHERE package = ?').run(pkg.name);
      this.insertDocs(packageToSearchDocs(pkg));
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  /** Drop every doc for a package (on package delete). */
  removePackage(name: string): void {
    if (!this.ready) return;
    this.db.prepare('DELETE FROM docs WHERE package = ?').run(name);
  }

  /** Total indexed docs (test/health). */
  count(): number {
    if (!this.ready) return 0;
    const r = this.db.prepare('SELECT count(*) AS c FROM docs').get() as { c: number };
    return r.c;
  }

  /**
   * Ranked full-text search. Blends FTS5 BM25 (name weighted highest, then
   * keywords, then description) with the per-kind tier so entities/attributes
   * lead incidental matches. Empty/blank query → [].
   */
  search(query: string, opts: SearchOptions = {}): SearchHit[] {
    if (!this.ready) return [];
    const match = toMatchQuery(query);
    if (!match) return [];

    const limit = Math.min(Math.max(opts.limit ?? 20, 1), 100);
    const where: string[] = ['docs MATCH ?'];
    const params: unknown[] = [match];
    if (opts.package) {
      where.push('package = ?');
      params.push(opts.package);
    }
    if (opts.kinds && opts.kinds.length > 0) {
      where.push(`kind IN (${opts.kinds.map(() => '?').join(', ')})`);
      params.push(...opts.kinds);
    }

    // bm25 column weights: name=10, description=2, keywords=4 (indexed columns
    // only, in declared order — the 5 UNINDEXED columns get weight 0).
    // Over-fetch (limit*3) before applying the tier penalty so a strong-tier
    // match can climb past a slightly-better-bm25 low-tier one.
    const sql = `SELECT id, kind, package, entityName, route, name, description,
        bm25(docs, 0,0,0,0,0, 10.0, 2.0, 4.0) AS bm,
        snippet(docs, 6, '[', ']', '…', 8) AS snip
      FROM docs WHERE ${where.join(' AND ')}
      ORDER BY bm LIMIT ?`;
    const rows = this.db.prepare(sql).all(...params, limit * 3) as Array<{
      id: string; kind: SearchKind; package: string; entityName: string; route: string;
      name: string; description: string; bm: number; snip: string;
    }>;

    return rows
      .map((r) => ({
        id: r.id,
        kind: r.kind,
        name: r.name,
        description: r.description,
        package: r.package,
        entityName: r.entityName,
        route: r.route,
        score: r.bm + (KIND_TIER[r.kind] ?? 4) * TIER_PENALTY,
        snippet: r.snip || r.name,
      }))
      .sort((a, b) => a.score - b.score)
      .slice(0, limit);
  }

  close(): void {
    if (this.db) {
      try { this.db.close(); } catch { /* ignore */ }
    }
    this.db = null;
    this.ready = false;
  }
}
