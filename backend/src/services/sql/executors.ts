/**
 * Per-dialect read-only chunked cursor adapters for the run-SQL feature. Each
 * opens the query as a server-side cursor (SQL-Developer style) so fetch(n)
 * pulls the next chunk from the live DB without re-running the query.
 *
 * NOTE: these talk to the four production drivers (pg / oracledb / mysql2 /
 * mssql) and cannot be exercised without a real database — they are implemented
 * against each driver's documented streaming/cursor API and need live
 * verification against an actual instance. The surrounding framework
 * (guards, registry, cache, buffered cursor) IS unit-tested.
 */
import type { CursorExecutor, DbConnection, OpenCursor, SqlDialect } from './types.js';
import { createBufferedRowCursor, type RowSource } from './bufferedRowCursor.js';

function str(v: unknown): string | undefined { return v == null ? undefined : String(v); }
function num(v: unknown, d: number): number { const n = Number(v); return Number.isFinite(n) ? n : d; }

// --- postgres: a NO SCROLL cursor inside a READ ONLY transaction ------------
const postgresExecutor: CursorExecutor = {
  async open(conn, sql, opts) {
    const pg: any = await import('pg');
    const c = conn.connection;
    const client = new pg.Client({
      host: str(c.host), port: num(c.port, 5432), database: str(c.database),
      user: conn.credentials.user, password: conn.credentials.password,
      ...(c.ssl ? { ssl: { rejectUnauthorized: false } } : {}),
      ...(opts?.timeoutMs ? { statement_timeout: opts.timeoutMs, query_timeout: opts.timeoutMs } : {}),
    });
    await client.connect();
    const CUR = 'sdd_cursor';
    let columns: string[] = [];
    let closed = false;
    const close = async () => {
      if (closed) return; closed = true;
      try { await client.query(`CLOSE ${CUR}`); } catch { /* ignore */ }
      try { await client.query('ROLLBACK'); } catch { /* ignore */ }
      try { await client.end(); } catch { /* ignore */ }
    };
    try {
      await client.query('BEGIN READ ONLY');
      await client.query(`DECLARE ${CUR} NO SCROLL CURSOR FOR ${sql}`);
      const meta = await client.query(`FETCH FORWARD 0 FROM ${CUR}`);
      columns = (meta.fields || []).map((f: any) => f.name);
    } catch (e) { await close(); throw e; }
    return {
      columns,
      async fetch(n) {
        const want = Math.max(1, n);
        const r = await client.query(`FETCH FORWARD ${want} FROM ${CUR}`);
        if (!columns.length && r.fields) columns = r.fields.map((f: any) => f.name);
        const rows = r.rows.map((row: any) => columns.map((col) => row[col]));
        const done = r.rowCount < want;
        if (done) await close();
        return { rows, done };
      },
      close,
    };
  },
};

// --- oracle: a resultSet, getRows(n) is native chunked fetch ----------------
const oracleExecutor: CursorExecutor = {
  async open(conn, sql, opts) {
    const oracledb: any = (await import('oracledb')).default;
    const c = conn.connection;
    const connectString = str(c.connectString) || `${str(c.host)}:${num(c.port, 1521)}/${str(c.database) || str(c.serviceName)}`;
    const connection = await oracledb.getConnection({ user: conn.credentials.user, password: conn.credentials.password, connectString });
    if (opts?.timeoutMs) { try { connection.callTimeout = opts.timeoutMs; } catch { /* ignore */ } }
    let closed = false;
    let rs: any = null;
    const close = async () => {
      if (closed) return; closed = true;
      try { if (rs) await rs.close(); } catch { /* ignore */ }
      try { await connection.close(); } catch { /* ignore */ }
    };
    try {
      const result = await connection.execute(sql, [], { resultSet: true, outFormat: oracledb.OUT_FORMAT_ARRAY });
      rs = result.resultSet;
      const columns: string[] = (result.metaData || []).map((m: any) => m.name);
      return {
        columns,
        async fetch(n) {
          const want = Math.max(1, n);
          const rows: unknown[][] = await rs.getRows(want);
          const done = rows.length < want;
          if (done) await close();
          return { rows, done };
        },
        close,
      };
    } catch (e) { await close(); throw e; }
  },
};

// --- mysql / mssql: stream rows through the buffered cursor ------------------
const mysqlExecutor: CursorExecutor = {
  async open(conn, sql, opts) {
    const mysql: any = await import('mysql2/promise');
    const c = conn.connection;
    const connection = await mysql.createConnection({
      host: str(c.host), port: num(c.port, 3306), database: str(c.database),
      user: conn.credentials.user, password: conn.credentials.password,
    });
    try { await connection.query('SET SESSION TRANSACTION READ ONLY'); } catch { /* ignore */ }
    if (opts?.timeoutMs) { try { await connection.query(`SET SESSION max_execution_time = ${Math.ceil(opts.timeoutMs)}`); } catch { /* ignore */ } }
    const core: any = (connection as any).connection;
    const query = core.query(sql);
    let columns: string[] = [];
    await new Promise<void>((resolve, reject) => {
      query.once('fields', (fields: any[]) => { columns = (fields || []).map((f: any) => f.name); resolve(); });
      query.once('error', reject);
      query.once('end', () => resolve());
    });
    const stream = query.stream({ highWaterMark: 500 });
    const src: RowSource = {
      on(event, cb) {
        if (event === 'row') stream.on('data', (row: any) => (cb as (r: unknown[]) => void)(columns.map((col) => row[col])));
        else stream.on(event, cb as () => void);
      },
      pause: () => stream.pause(),
      resume: () => stream.resume(),
      destroy: () => { try { stream.destroy(); } catch { /* ignore */ } connection.end().catch(() => {}); },
    };
    return createBufferedRowCursor(src, columns);
  },
};

const mssqlExecutor: CursorExecutor = {
  async open(conn, sql, opts) {
    const sqlMod: any = (await import('mssql')).default;
    const c = conn.connection;
    const pool = await new sqlMod.ConnectionPool({
      server: str(c.server) || str(c.host), port: num(c.port, 1433), database: str(c.database),
      user: conn.credentials.user, password: conn.credentials.password,
      options: { encrypt: c.encrypt !== false, trustServerCertificate: true },
      ...(opts?.timeoutMs ? { requestTimeout: opts.timeoutMs } : {}),
    }).connect();
    const request = pool.request();
    request.stream = true;
    let columns: string[] = [];
    const src: RowSource = {
      on(event, cb) {
        if (event === 'row') request.on('row', (row: any) => (cb as (r: unknown[]) => void)(columns.map((col) => row[col])));
        else if (event === 'end') request.on('done', cb as () => void);
        else request.on('error', cb as (e: Error) => void);
      },
      pause: () => request.pause(),
      resume: () => request.resume(),
      destroy: () => { try { request.cancel(); } catch { /* ignore */ } pool.close().catch(() => {}); },
    };
    request.on('recordset', (cols: Record<string, unknown>) => { columns = Object.keys(cols); });
    request.query(sql);
    // wait for the column metadata (recordset) before returning
    await new Promise<void>((resolve, reject) => {
      request.once('recordset', () => resolve());
      request.once('error', reject);
      request.once('done', () => resolve());
    });
    return createBufferedRowCursor(src, columns);
  },
};

const EXECUTORS: Record<SqlDialect, CursorExecutor> = {
  postgres: postgresExecutor,
  oracle: oracleExecutor,
  mysql: mysqlExecutor,
  mssql: mssqlExecutor,
};

export function getExecutor(dialect: SqlDialect): CursorExecutor {
  const ex = EXECUTORS[dialect];
  if (!ex) throw new Error(`Unsupported dialect: ${dialect}`);
  return ex;
}

export type { OpenCursor, DbConnection };
