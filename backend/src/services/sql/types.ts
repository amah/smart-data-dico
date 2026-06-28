/** Run-SQL feature shared types. */

export type SqlDialect = 'postgres' | 'mysql' | 'mssql' | 'oracle';

/** A live database connection: non-secret config + the secret credentials. */
export interface DbConnection {
  dialect: SqlDialect;
  /** Non-secret fields (host/port/database/server/connectString/schema, …). */
  connection: Record<string, unknown>;
  credentials: { user: string; password: string };
}

/** Connection without credentials — safe to echo back to the client. */
export interface RedactedConnection {
  dialect: SqlDialect;
  connection: Record<string, unknown>;
  user: string;
}

/**
 * An opened read-only cursor over a query. `fetch(n)` pulls the next chunk from
 * the live DB cursor (SQL-Developer style — the query is NOT re-run per chunk);
 * `done` is true once the cursor is exhausted. `close()` releases the cursor and
 * its connection.
 */
export interface OpenCursor {
  columns: string[];
  fetch(n: number): Promise<{ rows: unknown[][]; done: boolean }>;
  close(): Promise<void>;
}

/** Opens a query as a read-only chunked cursor for one dialect. */
export interface CursorExecutor {
  open(conn: DbConnection, sql: string, opts?: { timeoutMs?: number }): Promise<OpenCursor>;
}
