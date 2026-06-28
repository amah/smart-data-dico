/**
 * HTTP layer for the run-SQL feature (#run-sql). Connect to a package's
 * database (credentials cached transiently), run a read-only SELECT, and fetch
 * results in chunks (SQL-Developer style). DB execution errors come back as 422
 * with the message so the chat can feed them to the model for auto-repair.
 */
import type { Request, Response } from 'express';
import { sqlRunService, NoConnectionError } from '../services/sql/sqlRunService.js';
import { SqlGuardError } from '../services/sql/sqlGuards.js';
import type { DbConnection, SqlDialect } from '../services/sql/types.js';
import { logger } from '../utils/logger.js';

const DIALECTS = new Set<SqlDialect>(['postgres', 'mysql', 'mssql', 'oracle']);

/** POST /api/sql/connect — validate credentials and cache the connection. */
export const sqlConnect = async (req: Request, res: Response) => {
  const { packageName, dialect, connection, user, password } = req.body ?? {};
  if (!packageName || typeof packageName !== 'string') return res.status(400).json({ message: 'packageName is required' });
  if (!DIALECTS.has(dialect)) return res.status(400).json({ message: `dialect must be one of ${[...DIALECTS].join(', ')}` });
  if (!connection || typeof connection !== 'object') return res.status(400).json({ message: 'connection (object) is required' });
  if (!user || typeof user !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ message: 'user and password are required' });
  }
  const conn: DbConnection = { dialect, connection, credentials: { user, password } };
  try {
    const redacted = await sqlRunService.connect(packageName, conn);
    res.json({ message: 'Connected', data: redacted });
  } catch (err: any) {
    logger.warn(`SQL connect failed for "${packageName}": ${err?.message}`); // never logs credentials
    res.status(502).json({ message: 'Could not connect to the database', error: String(err?.message ?? err) });
  }
};

/** GET /api/sql/connection/:packageName — redacted current connection (or null). */
export const sqlGetConnection = (req: Request, res: Response) => {
  res.json({ data: sqlRunService.getConnection(req.params.packageName) });
};

/** DELETE /api/sql/connection/:packageName — forget the cached connection. */
export const sqlDisconnect = (req: Request, res: Response) => {
  sqlRunService.disconnect(req.params.packageName);
  res.json({ message: 'Disconnected' });
};

/** POST /api/sql/run — run a read-only SELECT, return the first chunk. */
export const sqlRun = async (req: Request, res: Response) => {
  const { packageName, sql, chunk } = req.body ?? {};
  if (!packageName || typeof packageName !== 'string') return res.status(400).json({ message: 'packageName is required' });
  if (!sql || typeof sql !== 'string') return res.status(400).json({ message: 'sql is required' });
  try {
    const result = await sqlRunService.run(packageName, sql, typeof chunk === 'number' ? chunk : undefined);
    res.json({ data: result });
  } catch (err: any) {
    if (err instanceof SqlGuardError) return res.status(400).json({ message: err.message, code: 'guard' });
    if (err instanceof NoConnectionError) return res.status(409).json({ message: err.message, code: 'no-connection' });
    // A real DB execution error — return the message so the client can hand it
    // to the model for analysis/repair.
    res.status(422).json({ message: 'Query failed', code: 'db-error', error: String(err?.message ?? err) });
  }
};

/** POST /api/sql/fetch — next chunk of an open result set. */
export const sqlFetch = async (req: Request, res: Response) => {
  const { resultId, n } = req.body ?? {};
  if (!resultId || typeof resultId !== 'string') return res.status(400).json({ message: 'resultId is required' });
  try {
    res.json({ data: await sqlRunService.fetchMore(resultId, typeof n === 'number' ? n : undefined) });
  } catch (err: any) {
    res.status(410).json({ message: String(err?.message ?? err), code: 'result-gone' });
  }
};

/** POST /api/sql/close — release an open result set. */
export const sqlClose = async (req: Request, res: Response) => {
  const { resultId } = req.body ?? {};
  if (resultId && typeof resultId === 'string') await sqlRunService.closeResult(resultId);
  res.json({ message: 'Closed' });
};
