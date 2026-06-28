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

/**
 * The four production drivers are OPTIONAL peer dependencies — a published
 * install only carries the ones the user chose. Load lazily and, when a driver
 * is absent, surface an actionable message instead of a raw module-not-found.
 */
async function loadDriver(pkg: string): Promise<any> {
  try {
    return await import(pkg);
  } catch (e) {
    const code = (e as { code?: string })?.code;
    if (code === 'ERR_MODULE_NOT_FOUND' || code === 'MODULE_NOT_FOUND') {
      const dep = pkg.split('/')[0]; // 'mysql2/promise' → 'mysql2'
      throw new Error(`The "${dep}" driver isn't installed. Install it to query this dialect:  npm install ${dep}`);
    }
    throw e;
  }
}

// --- postgres: a NO SCROLL cursor inside a READ ONLY transaction ------------
const postgresExecutor: CursorExecutor = {
  async open(conn, sql, opts) {
    const pg: any = await loadDriver('pg');
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
    const oracledb: any = (await loadDriver('oracledb')).default;
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
    const mysql: any = await loadDriver('mysql2/promise');
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
    const sqlMod: any = (await loadDriver('mssql')).default;
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

// SQLite — Node's built-in node:sqlite (requires Node ≥22.5 with
// `--experimental-sqlite`). The driver is in-process and synchronous with no
// streaming cursor, so the result set is read once via .all() and served in
// chunks from memory (the query is still run only once). `connection.file` is
// the database path; credentials are unused. Ideal for zero-setup dev/demo.
const sqliteExecutor: CursorExecutor = {
  async open(conn, sql) {
    let DatabaseSync: any;
    try {
      // @types/node@20 ships no node:sqlite typings yet; a non-literal specifier
      // keeps tsc from resolving it (the module is a real Node ≥22.5 built-in).
      const sqliteModule: string = 'node:sqlite';
      ({ DatabaseSync } = await import(sqliteModule));
    } catch {
      // node:sqlite is built-in but gated behind --experimental-sqlite until it
      // stabilises (~Node 23.5). Tell the operator how to enable it.
      throw new Error('SQLite support needs Node’s built-in node:sqlite. Run Node ≥22.5 with --experimental-sqlite (e.g. NODE_OPTIONS=--experimental-sqlite), or upgrade to a Node version where it is stable.');
    }
    const db = new DatabaseSync(str(conn.connection.file) || str(conn.connection.database));
    try {
      const objs: Record<string, unknown>[] = db.prepare(sql).all();
      const columns = objs.length ? Object.keys(objs[0]) : [];
      const all = objs.map((o) => columns.map((c) => o[c]));
      let i = 0;
      return {
        columns,
        async fetch(n: number) { const rows = all.slice(i, i + n); i += n; return { rows, done: i >= all.length }; },
        async close() { try { db.close(); } catch { /* ignore */ } },
      };
    } catch (e) {
      try { db.close(); } catch { /* ignore */ }
      throw e;
    }
  },
};

const EXECUTORS: Record<SqlDialect, CursorExecutor> = {
  postgres: postgresExecutor,
  oracle: oracleExecutor,
  mysql: mysqlExecutor,
  mssql: mssqlExecutor,
  sqlite: sqliteExecutor,
};

export function getExecutor(dialect: SqlDialect): CursorExecutor {
  const ex = EXECUTORS[dialect];
  if (!ex) throw new Error(`Unsupported dialect: ${dialect}`);
  return ex;
}

export type { OpenCursor, DbConnection };
