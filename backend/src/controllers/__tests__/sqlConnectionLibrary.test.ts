/**
 * Controller wiring for the named connection library (#connection-library):
 * connect-by-connectionId resolution (params + id-scoped saved password),
 * explicit-field overrides, legacy identity-scoped fallback, last-used hints,
 * and the /api/sql/connections CRUD endpoints. The DB layer is mocked; the
 * secret store is real (AES-GCM over a temp file, as in sqlSecret.test.ts);
 * the appDir config file is replaced with an in-memory section store.
 */
jest.mock('../../services/sql/sqlRunService.js', () => ({
  sqlRunService: { connect: jest.fn(async () => ({ dialect: 'postgres', connection: { host: 'db.stage' }, user: 'app' })) },
  NoConnectionError: class extends Error {},
}));

// In-memory replacement for ~/.dico-app/dico-app.json sections.
const mockCfg: Record<string, unknown> = {};
jest.mock('../../utils/appDir', () => ({
  APP_DIR: '/tmp/dico-connlib-ctl-appdir',
  ensureAppDir: jest.fn(),
  getConfigSection: (s: string) => mockCfg[s],
  setConfigSection: (s: string, v: unknown) => { mockCfg[s] = v; },
}));

import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  sqlConnect, sqlListConnections, sqlCreateConnection, sqlUpdateConnection, sqlDeleteConnection,
} from '../sqlController.js';
import { sqlRunService } from '../../services/sql/sqlRunService.js';
import {
  resetSecretProvider, connectionSecretKey, secretKey, getSecret, saveSecret,
} from '../../services/sql/secretStore.js';

const connectMock = sqlRunService.connect as jest.MockedFunction<any>;

function mockRes() {
  const res: any = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
}
const reqOf = (body: Record<string, unknown>, appUserId?: string) =>
  ({ body, ...(appUserId ? { user: { id: appUserId } } : {}) }) as any;

const ENTRY_INPUT = {
  name: 'Staging PG',
  dialect: 'postgres',
  connection: { host: 'db.stage', port: 5432, database: 'orders' },
  user: 'app',
};

/** Create a library entry through the endpoint; returns the response data. */
async function createEntry(over: Record<string, unknown> = {}, appUserId?: string) {
  const res = mockRes();
  await sqlCreateConnection(reqOf({ ...ENTRY_INPUT, ...over }, appUserId), res);
  return res.json.mock.calls[0][0].data;
}

/** Recursively assert no password-shaped KEY exists anywhere in a payload
 *  (hasSavedPassword — a boolean status flag — is the one sanctioned name). */
function assertNoSecretKeys(o: unknown, trail = '$'): void {
  if (Array.isArray(o)) return o.forEach((v, i) => assertNoSecretKeys(v, `${trail}[${i}]`));
  if (o && typeof o === 'object') {
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      if (k !== 'hasSavedPassword') {
        expect({ trail: `${trail}.${k}`, matchesSecretShape: /^(password|passwd|pwd|credentials?|secret)$/i.test(k) })
          .toEqual({ trail: `${trail}.${k}`, matchesSecretShape: false });
      }
      assertNoSecretKeys(v, `${trail}.${k}`);
    }
  }
}

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dico-connlib-ctl-'));
  process.env.DICO_SECRETS_FILE = path.join(dir, 'secrets.json');
  process.env.DICO_SECRET_PROVIDER = 'aesgcm';
  process.env.DICO_SECRET_KEY = 'master-key-for-tests';
  resetSecretProvider();
  connectMock.mockClear();
  connectMock.mockImplementation(async () => ({ dialect: 'postgres', connection: { host: 'db.stage' }, user: 'app' }));
  for (const k of Object.keys(mockCfg)) delete mockCfg[k];
});
afterEach(() => {
  delete process.env.DICO_SECRETS_FILE;
  delete process.env.DICO_SECRET_PROVIDER;
  delete process.env.DICO_SECRET_KEY;
  resetSecretProvider();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('POST /api/sql/connect with connectionId', () => {
  it('resolves the entry params + the id-scoped saved password; response never leaks it', async () => {
    const entry = await createEntry({ password: 'saved-pw', rememberPassword: true });

    const res = mockRes();
    await sqlConnect(reqOf({ packageName: 'orders', connectionId: entry.id }), res);

    expect(connectMock).toHaveBeenCalledTimes(1);
    expect(connectMock.mock.calls[0][0]).toBe('orders');
    expect(connectMock.mock.calls[0][1]).toEqual({
      dialect: 'postgres',
      connection: { host: 'db.stage', port: 5432, database: 'orders' },
      credentials: { user: 'app', password: 'saved-pw' },
    });
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ usedSaved: true }));
    // redaction: the saved password must not appear anywhere in the response
    expect(JSON.stringify(res.json.mock.calls)).not.toContain('saved-pw');
    assertNoSecretKeys(res.json.mock.calls[0][0]);
  });

  it('explicit body fields override the entry; an inline password beats the saved secret', async () => {
    const entry = await createEntry({ password: 'saved-pw', rememberPassword: true });

    const res = mockRes();
    await sqlConnect(reqOf({
      packageName: 'orders',
      connectionId: entry.id,
      connection: { host: 'override-host' },
      user: 'other-user',
      password: 'inline-pw',
    }), res);

    expect(connectMock.mock.calls[0][1]).toEqual({
      dialect: 'postgres', // not overridden → from the entry
      connection: { host: 'override-host' },
      credentials: { user: 'other-user', password: 'inline-pw' },
    });
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ usedSaved: false }));
  });

  it('unknown connectionId → 404 and connect is never attempted', async () => {
    const res = mockRes();
    await sqlConnect(reqOf({ packageName: 'orders', connectionId: 'no-such-id' }), res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ message: 'Saved connection not found' });
    expect(connectMock).not.toHaveBeenCalled();
  });

  it('another app user cannot connect via my saved connection id (404)', async () => {
    const entry = await createEntry({}, 'u1');
    const res = mockRes();
    await sqlConnect(reqOf({ packageName: 'orders', connectionId: entry.id }, 'u2'), res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(connectMock).not.toHaveBeenCalled();
  });

  it('falls back to the legacy identity-scoped secret when no id-scoped one exists', async () => {
    const entry = await createEntry(); // no password saved under the id-scoped key
    await saveSecret(
      secretKey('orders', 'postgres', { host: 'db.stage', port: 5432, database: 'orders' }, 'app', 'local'),
      'legacy-pw',
    );

    const res = mockRes();
    await sqlConnect(reqOf({ packageName: 'orders', connectionId: entry.id }), res);

    expect(connectMock.mock.calls[0][1].credentials.password).toBe('legacy-pw');
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ usedSaved: true }));
  });

  it('no password anywhere (no inline, no id-scoped, no legacy) → 400, no connect', async () => {
    const entry = await createEntry();
    const res = mockRes();
    await sqlConnect(reqOf({ packageName: 'orders', connectionId: entry.id }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(connectMock).not.toHaveBeenCalled();
  });

  it('successful connect-by-id records the lastUsedByPackage hint', async () => {
    const entry = await createEntry({ password: 'saved-pw', rememberPassword: true });
    await sqlConnect(reqOf({ packageName: 'orders', connectionId: entry.id }), mockRes());

    const res = mockRes();
    await sqlListConnections(reqOf({}), res);
    expect(res.json.mock.calls[0][0].data.lastUsedByPackage).toEqual({ orders: entry.id });
  });

  it('a FAILED connect-by-id does not record a last-used hint', async () => {
    const entry = await createEntry({ password: 'saved-pw', rememberPassword: true });
    connectMock.mockRejectedValueOnce(new Error('connection refused'));

    const res = mockRes();
    await sqlConnect(reqOf({ packageName: 'orders', connectionId: entry.id }), res);
    expect(res.status).toHaveBeenCalledWith(502);

    const list = mockRes();
    await sqlListConnections(reqOf({}), list);
    expect(list.json.mock.calls[0][0].data.lastUsedByPackage).toEqual({});
  });

  it('remember:true with connectionId saves under the id-scoped key (not the legacy one)', async () => {
    const entry = await createEntry();
    const res = mockRes();
    await sqlConnect(reqOf({ packageName: 'orders', connectionId: entry.id, password: 'new-pw', remember: true }), res);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ remembered: true }));
    expect(await getSecret(connectionSecretKey(entry.id, 'local'))).toBe('new-pw');
    expect(await getSecret(
      secretKey('orders', 'postgres', { host: 'db.stage', port: 5432, database: 'orders' }, 'app', 'local'),
    )).toBeNull();
  });

  it('regression: the inline flow without connectionId is unchanged', async () => {
    const res = mockRes();
    await sqlConnect(reqOf({
      packageName: 'orders', dialect: 'postgres', connection: { host: 'adhoc' }, user: 'app', password: 'pw',
    }), res);

    expect(connectMock.mock.calls[0][1]).toEqual({
      dialect: 'postgres', connection: { host: 'adhoc' }, credentials: { user: 'app', password: 'pw' },
    });
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: 'Connected', usedSaved: false }));
  });
});

describe('connection CRUD endpoints', () => {
  it('create → 201 with generated id; password-shaped keys are sanitized out of the stored entry', async () => {
    const res = mockRes();
    await sqlCreateConnection(reqOf({
      ...ENTRY_INPUT,
      connection: { host: 'db.stage', password: 'leak-1', pwd: 'leak-2' },
      password: 'body-pw', rememberPassword: true,
    }), res);

    expect(res.status).toHaveBeenCalledWith(201);
    const data = res.json.mock.calls[0][0].data;
    expect(data.connection).toEqual({ host: 'db.stage' }); // secret-shaped keys stripped
    expect(data.hasSavedPassword).toBe(true); // body-pw went to the secret store instead
    expect(JSON.stringify(mockCfg)).not.toMatch(/leak-1|leak-2|body-pw/); // never persisted in the config
    assertNoSecretKeys(res.json.mock.calls[0][0]);
  });

  it('create validation: missing name or invalid dialect → 400', async () => {
    for (const bad of [{ ...ENTRY_INPUT, name: '  ' }, { ...ENTRY_INPUT, dialect: 'mongodb' }, {}]) {
      const res = mockRes();
      await sqlCreateConnection(reqOf(bad as any), res);
      expect(res.status).toHaveBeenCalledWith(400);
    }
  });

  it('list reports hasSavedPassword per entry and never leaks a password', async () => {
    const withPwd = await createEntry({ name: 'With pwd', password: 'saved-pw', rememberPassword: true });
    const withoutPwd = await createEntry({ name: 'No pwd' });

    const res = mockRes();
    await sqlListConnections(reqOf({}), res);
    const payload = res.json.mock.calls[0][0];
    const byId = Object.fromEntries(payload.data.connections.map((c: any) => [c.id, c]));

    expect(byId[withPwd.id].hasSavedPassword).toBe(true);
    expect(byId[withoutPwd.id].hasSavedPassword).toBe(false);
    expect(JSON.stringify(payload)).not.toContain('saved-pw');
    assertNoSecretKeys(payload); // deep: no password/pwd/credentials/secret key anywhere
  });

  it('list is scoped to the calling app user', async () => {
    await createEntry({}, 'u1');
    const res = mockRes();
    await sqlListConnections(reqOf({}, 'u2'), res);
    expect(res.json.mock.calls[0][0].data.connections).toEqual([]);
  });

  it('sqlite entries never report a saved password', async () => {
    const entry = await createEntry({
      name: 'Local file', dialect: 'sqlite', connection: { file: '/tmp/x.db' }, user: '',
      password: 'ignored', rememberPassword: true,
    });
    expect(entry.hasSavedPassword).toBe(false); // remember is a no-op for sqlite

    const res = mockRes();
    await sqlListConnections(reqOf({}), res);
    const listed = res.json.mock.calls[0][0].data.connections.find((c: any) => c.id === entry.id);
    expect(listed.hasSavedPassword).toBe(false);
  });

  it('update edits params while the id-scoped password stays attached', async () => {
    const entry = await createEntry({ password: 'saved-pw', rememberPassword: true });

    const res = mockRes();
    await sqlUpdateConnection(
      { params: { id: entry.id }, body: { ...ENTRY_INPUT, name: 'Renamed', connection: { host: 'new-host' } } } as any,
      res,
    );

    const data = res.json.mock.calls[0][0].data;
    expect(data).toMatchObject({ id: entry.id, name: 'Renamed', connection: { host: 'new-host' } });
    expect(data.hasSavedPassword).toBe(true); // id-keyed secret survives host edits
    expect(await getSecret(connectionSecretKey(entry.id, 'local'))).toBe('saved-pw');
  });

  it('update of an unknown id → 404', async () => {
    const res = mockRes();
    await sqlUpdateConnection({ params: { id: 'nope' }, body: { ...ENTRY_INPUT } } as any, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('delete removes the entry AND its saved secret; unknown id → 404', async () => {
    const entry = await createEntry({ password: 'saved-pw', rememberPassword: true });
    expect(await getSecret(connectionSecretKey(entry.id, 'local'))).toBe('saved-pw');

    const res = mockRes();
    await sqlDeleteConnection({ params: { id: entry.id } } as any, res);
    expect(res.json).toHaveBeenCalledWith({ message: 'Deleted' });
    expect(await getSecret(connectionSecretKey(entry.id, 'local'))).toBeNull();

    const list = mockRes();
    await sqlListConnections(reqOf({}), list);
    expect(list.json.mock.calls[0][0].data.connections).toEqual([]);

    const notFound = mockRes();
    await sqlDeleteConnection({ params: { id: entry.id } } as any, notFound);
    expect(notFound.status).toHaveBeenCalledWith(404);
  });
});
