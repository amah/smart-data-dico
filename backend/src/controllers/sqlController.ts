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
import { capabilities as secretCapabilities, secretKey, connectionSecretKey, getSecret, saveSecret, deleteSecret, deleteSecretsForPackage } from '../services/sql/secretStore.js';
import {
  listSavedConnections, getSavedConnection, createSavedConnection, updateSavedConnection,
  deleteSavedConnection, lastUsedByPackage, setLastUsed, type SavedConnectionInput,
} from '../services/sql/connectionLibrary.js';
import { logger } from '../utils/logger.js';

const DIALECTS = new Set<SqlDialect>(['postgres', 'mysql', 'mssql', 'oracle', 'sqlite']);

/** Authenticated app user (JWT subject), used to isolate saved secrets per user.
 *  Falls back to `local` in desktop/single-user mode. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const appUserOf = (req: Request): string => (req as any).user?.id ?? 'local';

/** POST /api/sql/connect — validate credentials and cache the connection. Can
 *  optionally remember the password in the OS-keyed secret store (`remember`),
 *  or transparently reuse a previously saved one when no password is supplied.
 *  With `connectionId` (#connection-library) the params and saved password come
 *  from the named library entry — the password never round-trips the client;
 *  explicit body fields (and an inline password) override the entry's values. */
export const sqlConnect = async (req: Request, res: Response) => {
  const { packageName, connectionId, password, remember } = req.body ?? {};
  let { dialect, connection, user } = req.body ?? {};
  if (!packageName || typeof packageName !== 'string') return res.status(400).json({ message: 'packageName is required' });

  const appUser = appUserOf(req);
  let pwd = typeof password === 'string' ? password : '';
  let usedSaved = false;

  const libEntry = connectionId && typeof connectionId === 'string'
    ? getSavedConnection(appUser, connectionId) : null;
  if (connectionId && !libEntry) return res.status(404).json({ message: 'Saved connection not found' });
  if (libEntry) {
    dialect = dialect ?? libEntry.dialect;
    connection = connection ?? libEntry.connection;
    user = user ?? libEntry.user;
    if (dialect !== 'sqlite' && !pwd) {
      const saved = await getSecret(connectionSecretKey(libEntry.id, appUser));
      if (saved) { pwd = saved; usedSaved = true; }
    }
  }

  if (!DIALECTS.has(dialect)) return res.status(400).json({ message: `dialect must be one of ${[...DIALECTS].join(', ')}` });
  if (!connection || typeof connection !== 'object') return res.status(400).json({ message: 'connection (object) is required' });

  // Legacy ad-hoc fallback: a password remembered for this exact
  // (package, app-user, connection, db-user) identity.
  if (dialect !== 'sqlite' && !pwd && typeof user === 'string' && user) {
    const saved = await getSecret(secretKey(packageName, dialect, connection, user, appUser));
    if (saved) { pwd = saved; usedSaved = true; }
  }
  // SQLite is a local file — no user/password. Other dialects require both.
  if (dialect !== 'sqlite' && (!user || typeof user !== 'string' || !pwd)) {
    return res.status(400).json({ message: 'user and password are required' });
  }
  const conn: DbConnection = { dialect, connection, credentials: { user: user ?? '', password: pwd } };
  try {
    const redacted = await sqlRunService.connect(packageName, conn);
    let remembered = false;
    if (remember === true && dialect !== 'sqlite' && pwd) {
      // Library connections remember under their id-scoped key; ad-hoc ones
      // keep the legacy identity-scoped key.
      const key = libEntry ? connectionSecretKey(libEntry.id, appUser) : secretKey(packageName, dialect, connection, user, appUser);
      try { await saveSecret(key, pwd); remembered = true; }
      catch (e: any) { logger.warn(`Could not persist SQL password for "${packageName}": ${e?.message}`); } // non-fatal
    }
    if (libEntry) {
      try { setLastUsed(appUser, packageName, libEntry.id); } catch { /* hint only */ }
    }
    res.json({ message: 'Connected', data: redacted, remembered, usedSaved });
  } catch (err: any) {
    logger.warn(`SQL connect failed for "${packageName}": ${err?.message}`); // never logs credentials
    res.status(502).json({ message: 'Could not connect to the database', error: String(err?.message ?? err) });
  }
};

// ─── Named connection library (#connection-library) ─────────────────────────
// Non-secret parameters in ~/.dico-app/dico-app.json; passwords in the secret
// store under `conn::<id>::<userTag>`. Responses never contain a password.

// Not a type predicate: the body also carries password/rememberPassword,
// which are read separately and must never reach the library writer.
const isLibInput = (b: any): boolean =>
  !!b && typeof b.name === 'string' && b.name.trim() !== '' && DIALECTS.has(b.dialect)
  && (b.connection === undefined || (typeof b.connection === 'object' && b.connection !== null));

const libInputOf = (b: any): SavedConnectionInput =>
  ({ name: String(b.name).trim(), dialect: b.dialect, connection: b.connection ?? {}, user: typeof b.user === 'string' ? b.user : '' });

/** GET /api/sql/connections — the caller's saved connections + prefill hints. */
export const sqlListConnections = async (req: Request, res: Response) => {
  const appUser = appUserOf(req);
  const entries = listSavedConnections(appUser);
  const withStatus = await Promise.all(entries.map(async (e) => ({
    ...e,
    hasSavedPassword: e.dialect !== 'sqlite' && !!(await getSecret(connectionSecretKey(e.id, appUser))),
  })));
  res.json({ data: { connections: withStatus, lastUsedByPackage: lastUsedByPackage(appUser) } });
};

/** POST /api/sql/connections — create; optional password goes to the secret store only. */
export const sqlCreateConnection = async (req: Request, res: Response) => {
  const body = req.body ?? {};
  if (!isLibInput(body)) return res.status(400).json({ message: 'name and a valid dialect are required' });
  const appUser = appUserOf(req);
  const entry = createSavedConnection(appUser, libInputOf(body));
  let remembered = false;
  if (body.rememberPassword === true && typeof body.password === 'string' && body.password && entry.dialect !== 'sqlite') {
    try { await saveSecret(connectionSecretKey(entry.id, appUser), body.password); remembered = true; }
    catch (e: any) { logger.warn(`Could not persist password for saved connection "${entry.name}": ${e?.message}`); }
  }
  res.status(201).json({ data: { ...entry, hasSavedPassword: remembered }, remembered });
};

/** PUT /api/sql/connections/:id — update params and/or password (id-keyed secret survives edits). */
export const sqlUpdateConnection = async (req: Request, res: Response) => {
  const body = req.body ?? {};
  if (!isLibInput(body)) return res.status(400).json({ message: 'name and a valid dialect are required' });
  const appUser = appUserOf(req);
  const entry = updateSavedConnection(appUser, req.params.id, libInputOf(body));
  if (!entry) return res.status(404).json({ message: 'Saved connection not found' });
  let remembered: boolean | undefined;
  if (body.rememberPassword === true && typeof body.password === 'string' && body.password && entry.dialect !== 'sqlite') {
    try { await saveSecret(connectionSecretKey(entry.id, appUser), body.password); remembered = true; }
    catch (e: any) { logger.warn(`Could not persist password for saved connection "${entry.name}": ${e?.message}`); remembered = false; }
  }
  const hasSavedPassword = entry.dialect !== 'sqlite' && !!(await getSecret(connectionSecretKey(entry.id, appUser)));
  res.json({ data: { ...entry, hasSavedPassword }, ...(remembered === undefined ? {} : { remembered }) });
};

/** DELETE /api/sql/connections/:id — remove the entry and its saved password. */
export const sqlDeleteConnection = async (req: Request, res: Response) => {
  const appUser = appUserOf(req);
  if (!deleteSavedConnection(appUser, req.params.id)) return res.status(404).json({ message: 'Saved connection not found' });
  await deleteSecret(connectionSecretKey(req.params.id, appUser));
  res.json({ message: 'Deleted' });
};

/** GET /api/sql/secret-capabilities — can this machine store passwords safely? */
export const sqlSecretCapabilities = async (_req: Request, res: Response) => {
  res.json({ data: await secretCapabilities() });
};

/** POST /api/sql/secret-status — is a password saved for this connection identity? */
export const sqlSecretStatus = async (req: Request, res: Response) => {
  const { packageName, dialect, connection, user } = req.body ?? {};
  if (!packageName || !dialect || !connection || !user) return res.json({ data: { hasSecret: false } });
  const saved = await getSecret(secretKey(packageName, dialect, connection, user, appUserOf(req)));
  res.json({ data: { hasSecret: !!saved } });
};

/** DELETE /api/sql/secret/:packageName — forget the caller's saved passwords for a package. */
export const sqlForgetSecret = async (req: Request, res: Response) => {
  await deleteSecretsForPackage(req.params.packageName, appUserOf(req));
  res.json({ message: 'Forgotten' });
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
