/**
 * Registry of OPEN result-set cursors for the run-SQL feature. Chunked fetch
 * (SQL-Developer style) keeps the DB cursor + its connection open between HTTP
 * requests, so we must bound and reap them:
 *
 *   - TTL on inactivity (cursor closed + connection released on expiry)
 *   - a hard cap on concurrently-open cursors (LRU-evict + close the oldest)
 *   - close() on explicit dialog-close, and clear() on project switch
 *
 * Without these, abandoned result sets would leak DB connections.
 */
import type { OpenCursor, SqlDialect } from './types.js';

export interface ResultEntry {
  cursor: OpenCursor;
  dialect: SqlDialect;
  packageName: string;
  columns: string[];
  sql: string;
  createdAt: number;
  lastAccess: number;
}

export class ResultRegistry {
  private readonly map = new Map<string, ResultEntry>();
  constructor(
    private readonly opts: {
      ttlMs?: number;
      maxOpen?: number;
      now?: () => number;
    } = {},
  ) {}

  private get ttlMs() { return this.opts.ttlMs ?? 5 * 60 * 1000; }
  private get maxOpen() { return this.opts.maxOpen ?? 20; }
  private now() { return (this.opts.now ?? (() => Date.now()))(); }

  /** Register an open cursor under `id`, evicting the LRU if over capacity. */
  async add(id: string, entry: Omit<ResultEntry, 'createdAt' | 'lastAccess'>): Promise<void> {
    await this.sweep();
    if (this.map.size >= this.maxOpen) {
      // evict least-recently-used
      let oldestId: string | null = null;
      let oldest = Infinity;
      for (const [k, v] of this.map) if (v.lastAccess < oldest) { oldest = v.lastAccess; oldestId = k; }
      if (oldestId) await this.close(oldestId);
    }
    const t = this.now();
    this.map.set(id, { ...entry, createdAt: t, lastAccess: t });
  }

  /** Fetch the next chunk, touching the entry's TTL. Throws if unknown/expired. */
  async fetch(id: string, n: number): Promise<{ columns: string[]; rows: unknown[][]; done: boolean }> {
    await this.sweep();
    const e = this.map.get(id);
    if (!e) throw new Error('Result set not found or expired — re-run the query.');
    e.lastAccess = this.now();
    const { rows, done } = await e.cursor.fetch(n);
    if (done) await this.close(id);
    return { columns: e.columns, rows, done };
  }

  /** Close + remove a result set (releases the cursor and its connection). */
  async close(id: string): Promise<void> {
    const e = this.map.get(id);
    if (!e) return;
    this.map.delete(id);
    try { await e.cursor.close(); } catch { /* best-effort release */ }
  }

  /** Close every open result set (e.g. on project switch). */
  async clear(): Promise<void> {
    const ids = [...this.map.keys()];
    await Promise.all(ids.map(id => this.close(id)));
  }

  /** Close + drop entries past their TTL. */
  async sweep(): Promise<void> {
    const cutoff = this.now() - this.ttlMs;
    const expired = [...this.map.entries()].filter(([, v]) => v.lastAccess <= cutoff).map(([k]) => k);
    await Promise.all(expired.map(id => this.close(id)));
  }

  get size(): number { return this.map.size; }
}

export const resultRegistry = new ResultRegistry();
