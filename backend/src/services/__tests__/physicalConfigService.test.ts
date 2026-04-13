/**
 * Tests for the per-service physical config store (whole-model diff).
 *
 * Uses a fresh temp directory as the backing DATA_DICTIONARIES_DIR so the
 * real project's data-dictionaries/ is never touched. The service under
 * test is a thin YAML read/write layer, so we only need to verify the
 * shape, the credential-stripping invariant, and round-trip reads.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

jest.mock('../../utils/logger');

// Mock getPackagePath to point at a temp dir
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'physconfig-'));
const servicesDir = path.join(tmpRoot, 'microservices');
fs.mkdirSync(servicesDir, { recursive: true });
fs.mkdirSync(path.join(servicesDir, 'order-service'));
fs.mkdirSync(path.join(servicesDir, 'user-service'));

jest.mock('../../utils/fileOperations', () => {
  const realPath = jest.requireActual('path');
  return {
    getPackagePath: (name: string) => realPath.join(servicesDir, name),
    listMicroservices: async () => ['order-service', 'user-service'],
  };
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const {
  getPhysicalConfig,
  setPhysicalConfig,
  deletePhysicalConfig,
  mergeCredentials,
} = require('../physicalConfigService');

afterAll(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('physicalConfigService', () => {
  it('returns null when no config exists', () => {
    expect(getPhysicalConfig('order-service')).toBeNull();
  });

  it('round-trips a postgres config', () => {
    setPhysicalConfig('order-service', {
      dialect: 'postgres',
      connection: {
        host: 'db.example.com',
        port: 5432,
        database: 'orders',
        schema: 'public',
      },
    });
    const cfg = getPhysicalConfig('order-service');
    expect(cfg).toEqual({
      dialect: 'postgres',
      connection: {
        host: 'db.example.com',
        port: 5432,
        database: 'orders',
        schema: 'public',
      },
    });
  });

  it('strips user/password defensively on write (never persists creds)', () => {
    setPhysicalConfig('user-service', {
      dialect: 'mysql',
      connection: {
        host: 'mysql.internal',
        port: 3306,
        database: 'users',
        // Intentionally included — must be stripped
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        user: 'root',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        password: 'hunter2',
      } as any,
    });
    const cfg = getPhysicalConfig('user-service')!;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((cfg.connection as any).user).toBeUndefined();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((cfg.connection as any).password).toBeUndefined();
    // Re-read the raw file to confirm the bytes on disk don't contain the password
    const raw = fs.readFileSync(
      path.join(servicesDir, 'user-service', 'physical.yaml'),
      'utf-8',
    );
    expect(raw).not.toContain('hunter2');
    expect(raw).not.toContain('password');
  });

  it('rejects writes for services that do not exist', () => {
    expect(() =>
      setPhysicalConfig('ghost-service', {
        dialect: 'oracle',
        connection: { connectString: 'h:1521/s' },
      }),
    ).toThrow(/does not exist/);
  });

  it('deletes configs idempotently', () => {
    deletePhysicalConfig('order-service');
    expect(getPhysicalConfig('order-service')).toBeNull();
    // Second delete is a no-op, not an error
    expect(() => deletePhysicalConfig('order-service')).not.toThrow();
  });

  it('mergeCredentials layers creds without mutating the source config', () => {
    const base = {
      dialect: 'postgres' as const,
      connection: { host: 'h', database: 'd' },
    };
    const merged = mergeCredentials(base, { user: 'u', password: 'p' });
    expect(merged.connection.user).toBe('u');
    expect(merged.connection.password).toBe('p');
    expect(merged.connection.host).toBe('h');
    // Source not mutated
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((base.connection as any).user).toBeUndefined();
  });
});
