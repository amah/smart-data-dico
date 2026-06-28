import { ConnectionCache, redact } from '../connectionCache.js';
import { ResultRegistry } from '../resultRegistry.js';
import { FakeExecutor, FakeCursor } from '../fakeExecutor.js';
import type { DbConnection } from '../types.js';

const conn: DbConnection = {
  dialect: 'postgres',
  connection: { host: 'db', database: 'app', port: 5432 },
  credentials: { user: 'reader', password: 'secret' },
};

describe('ConnectionCache', () => {
  it('stores, slides TTL on use, and expires', () => {
    let t = 1000;
    const cache = new ConnectionCache(100, () => t);
    cache.set('catalog', conn);
    expect(cache.get('catalog')?.credentials.user).toBe('reader');
    t = 1050; expect(cache.has('catalog')).toBe(true);   // touched at 1000, slides to 1150
    t = 1140; expect(cache.has('catalog')).toBe(true);   // slid again
    t = 1300; expect(cache.get('catalog')).toBeNull();    // past TTL → evicted
  });

  it('redact() drops the password', () => {
    expect(redact(conn)).toEqual({ dialect: 'postgres', connection: { host: 'db', database: 'app', port: 5432 }, user: 'reader' });
    expect(JSON.stringify(redact(conn))).not.toContain('secret');
  });
});

describe('ResultRegistry', () => {
  const cur = (cols: string[], rows: unknown[][]) => new FakeCursor(cols, rows);

  it('chunks through a cursor and auto-closes when exhausted', async () => {
    const reg = new ResultRegistry();
    const c = cur(['id'], [[1], [2], [3]]);
    await reg.add('r1', { cursor: c, dialect: 'postgres', packageName: 'p', columns: ['id'], sql: 'SELECT id' });
    let res = await reg.fetch('r1', 2);
    expect(res.rows).toEqual([[1], [2]]);
    expect(res.done).toBe(false);
    res = await reg.fetch('r1', 2);
    expect(res.rows).toEqual([[3]]);
    expect(res.done).toBe(true);
    expect(c.closed).toBe(true);            // exhausted → closed
    expect(reg.size).toBe(0);
  });

  it('evicts + closes the LRU when over capacity', async () => {
    let t = 0;
    const reg = new ResultRegistry({ maxOpen: 2, now: () => t });
    const a = cur(['x'], [[1]]); const b = cur(['x'], [[1]]); const d = cur(['x'], [[1]]);
    t = 1; await reg.add('a', { cursor: a, dialect: 'postgres', packageName: 'p', columns: ['x'], sql: 's' });
    t = 2; await reg.add('b', { cursor: b, dialect: 'postgres', packageName: 'p', columns: ['x'], sql: 's' });
    t = 3; await reg.add('d', { cursor: d, dialect: 'postgres', packageName: 'p', columns: ['x'], sql: 's' }); // evicts 'a'
    expect(a.closed).toBe(true);
    expect(reg.size).toBe(2);
  });

  it('closes expired cursors on sweep/fetch', async () => {
    let t = 0;
    const reg = new ResultRegistry({ ttlMs: 100, now: () => t });
    const c = cur(['x'], [[1], [2]]);
    await reg.add('r', { cursor: c, dialect: 'postgres', packageName: 'p', columns: ['x'], sql: 's' });
    t = 200;
    await expect(reg.fetch('r', 1)).rejects.toThrow(/not found or expired/);
    expect(c.closed).toBe(true);
  });

  it('clear() closes everything', async () => {
    const reg = new ResultRegistry();
    const c1 = cur(['x'], [[1]]); const c2 = cur(['x'], [[1]]);
    await reg.add('1', { cursor: c1, dialect: 'postgres', packageName: 'p', columns: ['x'], sql: 's' });
    await reg.add('2', { cursor: c2, dialect: 'postgres', packageName: 'p', columns: ['x'], sql: 's' });
    await reg.clear();
    expect(c1.closed && c2.closed).toBe(true);
    expect(reg.size).toBe(0);
  });
});

describe('FakeExecutor', () => {
  it('opens a chunked cursor and can simulate a DB error', async () => {
    const ex = new FakeExecutor({ columns: ['id', 'name'], rows: [[1, 'a'], [2, 'b']] });
    const c = await ex.open(conn, 'SELECT id, name FROM t');
    expect(c.columns).toEqual(['id', 'name']);
    expect((await c.fetch(1)).rows).toEqual([[1, 'a']]);
    const failing = new FakeExecutor({ columns: [], rows: [] }, { failOnContains: 'bad_col' });
    await expect(failing.open(conn, 'SELECT bad_col FROM t')).rejects.toThrow(/fake DB error/);
  });
});
