/**
 * Named SQL connection library (#connection-library) — CRUD round-trip,
 * per-app-user isolation, secret-shaped key sanitization, and last-used
 * prefill hints, all against the REAL appDir file store redirected to a
 * throwaway home dir (same isolation pattern as appDir.test.ts), so we can
 * assert on the actual persisted JSON: passwords must never reach the file.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { userTag } from '../secretStore.js';

// The appDir module captures os.homedir() at evaluation time, so reload the
// library fresh per test against the current tmp-home mock.
function loadLib(): typeof import('../connectionLibrary') {
  let mod: typeof import('../connectionLibrary') | undefined;
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    mod = require('../connectionLibrary');
  });
  return mod!;
}

let tmpHome: string;
let homedirSpy: jest.SpyInstance;

const configFile = () => path.join(tmpHome, '.dico-app', 'dico-app.json');
const rawConfig = () => fs.readFileSync(configFile(), 'utf8');

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'dico-connlib-test-'));
  homedirSpy = jest.spyOn(os, 'homedir').mockReturnValue(tmpHome);
});

afterEach(() => {
  homedirSpy.mockRestore();
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

const INPUT = {
  name: 'Staging PG',
  dialect: 'postgres' as const,
  connection: { host: 'db.stage', port: 5432, database: 'orders' },
  user: 'app',
};

describe('CRUD round-trip', () => {
  it('create generates an id and savedAt, list/get round-trip the entry', () => {
    const lib = loadLib();
    const created = lib.createSavedConnection('u1', INPUT);

    expect(created.id).toMatch(/^[0-9a-f-]{36}$/i); // uuid v4
    expect(Number.isNaN(Date.parse(created.savedAt))).toBe(false); // valid ISO date
    expect(created).toMatchObject({
      name: 'Staging PG',
      dialect: 'postgres',
      connection: { host: 'db.stage', port: 5432, database: 'orders' },
      user: 'app',
    });

    expect(lib.listSavedConnections('u1')).toEqual([created]);
    expect(lib.getSavedConnection('u1', created.id)).toEqual(created);
    expect(lib.getSavedConnection('u1', 'nope')).toBeNull();
  });

  it('update replaces fields on the existing id and persists', () => {
    const lib = loadLib();
    const created = lib.createSavedConnection('u1', INPUT);

    const updated = lib.updateSavedConnection('u1', created.id, {
      name: 'Prod PG',
      dialect: 'postgres',
      connection: { host: 'db.prod', port: 5432, database: 'orders' },
      user: 'reader',
    });

    expect(updated).not.toBeNull();
    expect(updated!.id).toBe(created.id); // id is stable across edits
    expect(updated!.name).toBe('Prod PG');
    expect(updated!.connection).toEqual({ host: 'db.prod', port: 5432, database: 'orders' });
    expect(updated!.user).toBe('reader');
    expect(Number.isNaN(Date.parse(updated!.savedAt))).toBe(false);

    expect(lib.listSavedConnections('u1')).toEqual([updated]);
  });

  it('update of an unknown id returns null and writes nothing', () => {
    const lib = loadLib();
    lib.createSavedConnection('u1', INPUT);
    expect(lib.updateSavedConnection('u1', 'no-such-id', INPUT)).toBeNull();
    expect(lib.listSavedConnections('u1')).toHaveLength(1);
  });

  it('delete removes the entry; deleting an unknown id returns false', () => {
    const lib = loadLib();
    const created = lib.createSavedConnection('u1', INPUT);

    expect(lib.deleteSavedConnection('u1', created.id)).toBe(true);
    expect(lib.listSavedConnections('u1')).toEqual([]);
    expect(lib.deleteSavedConnection('u1', created.id)).toBe(false);
  });

  it('list on an empty store returns []', () => {
    const lib = loadLib();
    expect(lib.listSavedConnections('u1')).toEqual([]);
    expect(lib.lastUsedByPackage('u1')).toEqual({});
  });
});

describe('per-app-user isolation', () => {
  it('entries created for one app user are invisible to another', () => {
    const lib = loadLib();
    const created = lib.createSavedConnection('alice', INPUT);

    expect(lib.listSavedConnections('bob')).toEqual([]);
    expect(lib.getSavedConnection('bob', created.id)).toBeNull();
    expect(lib.deleteSavedConnection('bob', created.id)).toBe(false); // bob cannot delete alice's entry
    expect(lib.listSavedConnections('alice')).toEqual([created]); // alice untouched
  });

  it('the persisted section is keyed by the secret-store userTag, not the raw user id', () => {
    const lib = loadLib();
    lib.createSavedConnection('alice', INPUT);

    const parsed = JSON.parse(rawConfig());
    expect(Object.keys(parsed.sqlConnections)).toEqual([userTag('alice')]);
    expect(rawConfig()).not.toContain('alice'); // raw app-user id never hits the file
  });

  it('lastUsed hints are isolated per app user too', () => {
    const lib = loadLib();
    const a = lib.createSavedConnection('alice', INPUT);
    lib.setLastUsed('alice', 'orders', a.id);

    expect(lib.lastUsedByPackage('alice')).toEqual({ orders: a.id });
    expect(lib.lastUsedByPackage('bob')).toEqual({});
  });
});

describe('sanitizeEntry — passwords never reach the file', () => {
  const SECRETY_CONNECTION = {
    host: 'db.stage',
    password: 'boom-1',
    passwd: 'boom-2',
    pwd: 'boom-3',
    credential: 'boom-4',
    credentials: 'boom-5',
    secret: 'boom-6',
    PASSWORD: 'boom-7', // case-insensitive match
  };

  it('create strips password/passwd/pwd/credential(s)/secret keys from the connection', () => {
    const lib = loadLib();
    const created = lib.createSavedConnection('u1', { ...INPUT, connection: SECRETY_CONNECTION });

    expect(created.connection).toEqual({ host: 'db.stage' });
    const raw = rawConfig();
    for (const leaked of ['boom-1', 'boom-2', 'boom-3', 'boom-4', 'boom-5', 'boom-6', 'boom-7']) {
      expect(raw).not.toContain(leaked);
    }
    expect(raw).not.toMatch(/passw|pwd|credential|secret/i); // no secret-shaped keys either
  });

  it('update strips them as well', () => {
    const lib = loadLib();
    const created = lib.createSavedConnection('u1', INPUT);
    const updated = lib.updateSavedConnection('u1', created.id, { ...INPUT, connection: SECRETY_CONNECTION });

    expect(updated!.connection).toEqual({ host: 'db.stage' });
    expect(rawConfig()).not.toContain('boom-1');
  });

  it('strips secret-shaped keys at ANY depth — nested objects and arrays included', () => {
    const lib = loadLib();
    const created = lib.createSavedConnection('u1', {
      ...INPUT,
      connection: {
        host: 'db.stage',
        options: { password: 'boom-nested', keepAlive: true },
        pool: [{ secret: 'boom-array', size: 5 }],
      },
    });

    expect(created.connection).toEqual({
      host: 'db.stage',
      options: { keepAlive: true },
      pool: [{ size: 5 }],
    });
    const raw = rawConfig();
    expect(raw).not.toContain('boom-nested');
    expect(raw).not.toContain('boom-array');
    expect(raw).not.toMatch(/passw|pwd|credential|secret/i);
  });

  it('non-secret connection keys survive sanitization untouched', () => {
    const lib = loadLib();
    const created = lib.createSavedConnection('u1', {
      ...INPUT,
      connection: { host: 'h', port: 5432, database: 'd', ssl: true, connectString: 'x:1521/svc' },
    });
    expect(created.connection).toEqual({ host: 'h', port: 5432, database: 'd', ssl: true, connectString: 'x:1521/svc' });
  });
});

describe('lastUsedByPackage hints', () => {
  it('set/read round-trip, overwriting per package', () => {
    const lib = loadLib();
    const a = lib.createSavedConnection('u1', INPUT);
    const b = lib.createSavedConnection('u1', { ...INPUT, name: 'Other' });

    lib.setLastUsed('u1', 'orders', a.id);
    lib.setLastUsed('u1', 'billing', b.id);
    expect(lib.lastUsedByPackage('u1')).toEqual({ orders: a.id, billing: b.id });

    lib.setLastUsed('u1', 'orders', b.id); // switch
    expect(lib.lastUsedByPackage('u1')).toEqual({ orders: b.id, billing: b.id });
  });

  it('delete removes the dangling hints pointing at the deleted entry, keeps others', () => {
    const lib = loadLib();
    const a = lib.createSavedConnection('u1', INPUT);
    const b = lib.createSavedConnection('u1', { ...INPUT, name: 'Other' });
    lib.setLastUsed('u1', 'orders', a.id);
    lib.setLastUsed('u1', 'inventory', a.id);
    lib.setLastUsed('u1', 'billing', b.id);

    expect(lib.deleteSavedConnection('u1', a.id)).toBe(true);

    expect(lib.lastUsedByPackage('u1')).toEqual({ billing: b.id }); // a's hints gone, b's kept
    expect(rawConfig()).not.toContain(a.id); // no dangling reference in the file
  });
});
