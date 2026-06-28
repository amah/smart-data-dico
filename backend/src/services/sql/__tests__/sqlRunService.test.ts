import { SqlRunService, NoConnectionError } from '../sqlRunService.js';
import { ConnectionCache } from '../connectionCache.js';
import { ResultRegistry } from '../resultRegistry.js';
import { FakeExecutor } from '../fakeExecutor.js';
import { SqlGuardError } from '../sqlGuards.js';
import type { DbConnection } from '../types.js';

const conn: DbConnection = {
  dialect: 'postgres',
  connection: { host: 'db', database: 'app' },
  credentials: { user: 'reader', password: 'secret' },
};

function makeService(dataset: { columns: string[]; rows: unknown[][] }, opts?: { failOnContains?: string }) {
  const cache = new ConnectionCache();
  const registry = new ResultRegistry();
  const executor = new FakeExecutor(dataset, opts);
  let seq = 0;
  const svc = new SqlRunService({ cache, registry, getExecutor: () => executor, genId: () => `r${++seq}`, defaultChunk: 2 });
  return { svc, cache, registry, executor };
}

describe('SqlRunService', () => {
  it('connect() validates + caches, redacting the password', async () => {
    const { svc } = makeService({ columns: ['x'], rows: [[1]] });
    const red = await svc.connect('catalog', conn);
    expect(red).toEqual({ dialect: 'postgres', connection: { host: 'db', database: 'app' }, user: 'reader' });
    expect(svc.getConnection('catalog')).not.toBeNull();
    expect(JSON.stringify(svc.getConnection('catalog'))).not.toContain('secret');
  });

  it('run() returns the whole result in one chunk (no resultId) when it fits', async () => {
    const { svc } = makeService({ columns: ['id'], rows: [[1], [2]] }); // chunk=2
    await svc.connect('p', conn);
    const r = await svc.run('p', 'SELECT id FROM t');
    expect(r).toMatchObject({ resultId: null, columns: ['id'], rows: [[1], [2]], done: true });
  });

  it('run() + fetchMore() chunk through a larger result and auto-close at the end', async () => {
    const { svc, registry } = makeService({ columns: ['id'], rows: [[1], [2], [3], [4], [5]] }); // chunk=2
    await svc.connect('p', conn);
    const first = await svc.run('p', 'SELECT id FROM t');
    expect(first.rows).toEqual([[1], [2]]);
    expect(first.done).toBe(false);
    expect(first.resultId).toBe('r1');
    expect(registry.size).toBe(1);

    const second = await svc.fetchMore('r1', 2);
    expect(second.rows).toEqual([[3], [4]]);
    expect(second.done).toBe(false);

    const third = await svc.fetchMore('r1', 2);
    expect(third.rows).toEqual([[5]]);
    expect(third.done).toBe(true);
    expect(registry.size).toBe(0); // closed on exhaustion
  });

  it('rejects a non-SELECT before touching the DB', async () => {
    const { svc, executor } = makeService({ columns: [], rows: [] });
    await svc.connect('p', conn);
    const beforeRun = executor.opened.length; // connect() opened a probe cursor
    await expect(svc.run('p', 'DELETE FROM t')).rejects.toThrow(SqlGuardError);
    expect(executor.opened.length).toBe(beforeRun); // run() opened no cursor for the rejected query
  });

  it('throws NoConnectionError when the package has no cached connection', async () => {
    const { svc } = makeService({ columns: [], rows: [] });
    await expect(svc.run('nope', 'SELECT 1')).rejects.toThrow(NoConnectionError);
  });

  it('surfaces a DB error and leaves no open result set', async () => {
    const { svc, registry } = makeService({ columns: ['x'], rows: [[1]] }, { failOnContains: 'bad_col' });
    await svc.connect('p', conn);
    await expect(svc.run('p', 'SELECT bad_col FROM t')).rejects.toThrow(/fake DB error/);
    expect(registry.size).toBe(0);
  });

  it('disconnect() drops the cached connection', async () => {
    const { svc } = makeService({ columns: ['x'], rows: [[1]] });
    await svc.connect('p', conn);
    svc.disconnect('p');
    expect(svc.getConnection('p')).toBeNull();
  });
});
