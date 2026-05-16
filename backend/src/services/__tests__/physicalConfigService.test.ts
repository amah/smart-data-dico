/**
 * Tests for the per-service physical config store (whole-model diff).
 *
 * Uses InMemoryStorageBackend for isolation — no temp directories, no disk I/O.
 */
import { InMemoryStorageBackend } from '../../__tests__/helpers/InMemoryStorageBackend.js';
import { PhysicalConfigService } from '../physicalConfigService.js';
import { wsId, pathOf } from '../../storage/contract/types.js';
import {
  mergeCredentials,
  type PhysicalConfig,
} from '../physicalConfigService.js';

jest.mock('../../utils/logger');

const WS = wsId('dictionaries');

function makeService(backend: InMemoryStorageBackend): PhysicalConfigService {
  return new PhysicalConfigService(backend, WS);
}

async function seedServiceDir(backend: InMemoryStorageBackend, serviceName: string): Promise<void> {
  // Create a file inside the service dir so stat() finds it as a directory
  await backend.mkdir(WS, pathOf(serviceName), true);
}

describe('physicalConfigService', () => {
  let backend: InMemoryStorageBackend;
  let svc: PhysicalConfigService;

  beforeEach(async () => {
    backend = new InMemoryStorageBackend();
    svc = makeService(backend);
    // Pre-create service directories
    await seedServiceDir(backend, 'order-service');
    await seedServiceDir(backend, 'user-service');
  });

  it('returns null when no config exists', async () => {
    expect(await svc.get('order-service')).toBeNull();
  });

  it('round-trips a postgres config', async () => {
    await svc.set('order-service', {
      dialect: 'postgres',
      connection: {
        host: 'db.example.com',
        port: 5432,
        database: 'orders',
        schema: 'public',
      },
    });
    const cfg = await svc.get('order-service');
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

  it('strips user/password defensively on write (never persists creds)', async () => {
    await svc.set('user-service', {
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
    const cfg = (await svc.get('user-service'))!;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((cfg.connection as any).user).toBeUndefined();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((cfg.connection as any).password).toBeUndefined();
    // Re-read the raw bytes to confirm they don't contain the password
    const raw = await backend.read(WS, pathOf('user-service/physical.yaml'));
    expect(raw).not.toContain('hunter2');
    expect(raw).not.toContain('password');
  });

  it('rejects writes for services that do not exist', async () => {
    await expect(
      svc.set('ghost-service', {
        dialect: 'oracle',
        connection: { connectString: 'h:1521/s' },
      }),
    ).rejects.toThrow(/does not exist/);
  });

  it('deletes configs idempotently', async () => {
    await svc.set('order-service', {
      dialect: 'postgres',
      connection: { host: 'h', database: 'd' },
    });
    await svc.delete('order-service');
    expect(await svc.get('order-service')).toBeNull();
    // Second delete is a no-op, not an error
    await expect(svc.delete('order-service')).resolves.not.toThrow();
  });

  it('mergeCredentials layers creds without mutating the source config', () => {
    const base: PhysicalConfig = {
      dialect: 'postgres',
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
