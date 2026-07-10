/**
 * Orchestrates the run-SQL feature: validate read-only → resolve the cached
 * connection for the package → open a chunked cursor via the dialect executor →
 * return the first chunk + (if more rows remain) a resultId for follow-up
 * fetches held in the result registry.
 *
 * Dependencies are injected so the whole flow can be tested with the in-memory
 * FakeExecutor (no real database).
 */
import { generateUUID } from '../../utils/uuid.js';
import { logger } from '../../utils/logger.js';
import { connectionCache as defaultCache, redact } from './connectionCache.js';
import { resultRegistry as defaultRegistry } from './resultRegistry.js';
import { getExecutor as defaultGetExecutor } from './executors.js';
import { assertReadOnlySelect } from './sqlGuards.js';
import type { CursorExecutor, DbConnection, RedactedConnection, SqlDialect } from './types.js';
import type { ConnectionCache } from './connectionCache.js';
import type { ResultRegistry } from './resultRegistry.js';

export class NoConnectionError extends Error {
  constructor(packageName: string) {
    super(`No database connection for package "${packageName}". Connect first.`);
    this.name = 'NoConnectionError';
  }
}

export interface RunResult {
  resultId: string | null;   // null when the whole result fit in the first chunk
  columns: string[];
  rows: unknown[][];
  done: boolean;
  dialect: SqlDialect;
}

export interface SqlRunDeps {
  cache?: ConnectionCache;
  registry?: ResultRegistry;
  getExecutor?: (d: SqlDialect) => CursorExecutor;
  genId?: () => string;
  defaultChunk?: number;
  timeoutMs?: number;
}

export class SqlRunService {
  private cache: ConnectionCache;
  private registry: ResultRegistry;
  private getExecutor: (d: SqlDialect) => CursorExecutor;
  private genId: () => string;
  private defaultChunk: number;
  private timeoutMs: number;

  constructor(deps: SqlRunDeps = {}) {
    this.cache = deps.cache ?? defaultCache;
    this.registry = deps.registry ?? defaultRegistry;
    this.getExecutor = deps.getExecutor ?? defaultGetExecutor;
    this.genId = deps.genId ?? generateUUID;
    this.defaultChunk = deps.defaultChunk ?? 100;
    this.timeoutMs = deps.timeoutMs ?? 15_000;
  }

  /** Validate credentials with a trivial probe query, then cache the connection. */
  async connect(packageName: string, conn: DbConnection): Promise<RedactedConnection> {
    const probe = conn.dialect === 'oracle' ? 'SELECT 1 FROM dual' : 'SELECT 1';
    const cursor = await this.getExecutor(conn.dialect).open(conn, probe, { timeoutMs: this.timeoutMs });
    try { await cursor.fetch(1); } finally { await cursor.close(); }
    this.cache.set(packageName, conn);
    return redact(conn);
  }

  getConnection(packageName: string): RedactedConnection | null {
    const c = this.cache.get(packageName);
    return c ? redact(c) : null;
  }

  disconnect(packageName: string): void {
    this.cache.delete(packageName);
  }

  /** Run a read-only SELECT; returns the first chunk + a resultId if more remain. */
  async run(packageName: string, sql: string, chunk?: number): Promise<RunResult> {
    assertReadOnlySelect(sql);
    const conn = this.cache.get(packageName);
    if (!conn) throw new NoConnectionError(packageName);

    // The guard tolerates a trailing ';' but not every driver does: oracledb
    // rejects it with ORA-00933 before the statement is even parsed (SQL
    // Developer strips it as a separator, hence "works when pasted"). Strip it
    // once here so every dialect gets the statement the user sees.
    const stmt = sql.trim().replace(/\s*;\s*$/, '');
    logger.debug(`SQL run [${conn.dialect}] on "${packageName}"`, { sql: stmt });

    const cursor = await this.getExecutor(conn.dialect).open(conn, stmt, { timeoutMs: this.timeoutMs });
    try {
      const first = await cursor.fetch(chunk ?? this.defaultChunk);
      if (first.done) {
        await cursor.close();
        return { resultId: null, columns: cursor.columns, rows: first.rows, done: true, dialect: conn.dialect };
      }
      const id = this.genId();
      await this.registry.add(id, { cursor, dialect: conn.dialect, packageName, columns: cursor.columns, sql: stmt });
      return { resultId: id, columns: cursor.columns, rows: first.rows, done: false, dialect: conn.dialect };
    } catch (e) {
      await cursor.close();
      throw e;
    }
  }

  /** Pull the next chunk from an open result set. */
  async fetchMore(resultId: string, n?: number): Promise<{ columns: string[]; rows: unknown[][]; done: boolean }> {
    return this.registry.fetch(resultId, n ?? this.defaultChunk);
  }

  async closeResult(resultId: string): Promise<void> {
    await this.registry.close(resultId);
  }
}

export const sqlRunService = new SqlRunService();
