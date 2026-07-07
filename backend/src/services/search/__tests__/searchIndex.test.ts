/**
 * SearchIndex — FTS5 store over node:sqlite (#search-index). Runs against an
 * in-memory database so the ranking/filter/incremental contract is exercised
 * without touching disk. Skips gracefully if node:sqlite is unavailable.
 */
import { SearchIndex, toMatchQuery, searchIndexPathFor } from '../searchIndex.js';
import type { Package } from '../../../models/Dictionary.js';

const ordering = {
  id: 'ordering', name: 'ordering', description: 'Order lifecycle', subPackages: [], relationships: [],
  entities: [
    { uuid: 'u1', name: 'Order', description: 'Customer order containing items', attributes: [
      { uuid: 'a1', name: 'orderTotal', description: 'total amount', type: 'decimal', required: true },
    ], metadata: [] },
    { uuid: 'u2', name: 'OrderItem', description: 'Line item within an order', attributes: [], metadata: [] },
  ],
} as unknown as Package;

const catalog = {
  id: 'catalog', name: 'catalog', description: 'Product catalog', subPackages: [], relationships: [],
  entities: [
    { uuid: 'u3', name: 'Product', description: 'A product for sale', attributes: [
      { uuid: 'a2', name: 'sku', description: 'stock keeping unit', type: 'string', required: true },
    ], metadata: [] },
  ],
} as unknown as Package;

describe('toMatchQuery', () => {
  it('makes each token a prefix and ANDs them; strips metacharacters', () => {
    expect(toMatchQuery('Order')).toBe('order*');
    expect(toMatchQuery('order item')).toBe('order* item*');
    expect(toMatchQuery('  "ord(er)"  ')).toBe('ord* er*');
  });
  it('returns null for blank/symbol-only queries', () => {
    expect(toMatchQuery('')).toBeNull();
    expect(toMatchQuery('   ')).toBeNull();
    expect(toMatchQuery('***')).toBeNull();
  });
});

describe('searchIndexPathFor', () => {
  it('is deterministic per data dir and lands under the app storage dir', () => {
    const a = searchIndexPathFor('/tmp/projA');
    expect(a).toBe(searchIndexPathFor('/tmp/projA'));
    expect(a).not.toBe(searchIndexPathFor('/tmp/projB'));
    expect(a).toMatch(/storage\/search\/[0-9a-f]{16}\/index\.sqlite$/);
  });
});

describe('SearchIndex (in-memory)', () => {
  let idx: SearchIndex;

  beforeAll(async () => {
    idx = new SearchIndex(':memory:');
    await idx.open();
  });
  afterAll(() => idx?.close());

  const guard = () => idx.isReady();

  it('opens against node:sqlite', () => {
    if (!guard()) { console.warn('node:sqlite unavailable — skipping'); return; }
    expect(idx.isReady()).toBe(true);
  });

  it('indexes and finds entities, ranking the name match first', () => {
    if (!guard()) return;
    idx.rebuildFrom([ordering, catalog]);
    expect(idx.count()).toBeGreaterThan(0);
    const hits = idx.search('order');
    expect(hits.length).toBeGreaterThan(0);
    // The Order entity should outrank the OrderItem / attribute / package.
    expect(hits[0].kind).toBe('entity');
    expect(hits[0].name).toBe('Order');
    expect(hits[0].route).toBe('/packages/ordering/entities/Order');
  });

  it('finds an inner word of a camelCase identifier via split keywords', () => {
    if (!guard()) return;
    const hits = idx.search('total');
    expect(hits.some((h) => h.name === 'orderTotal')).toBe(true);
  });

  it('supports prefix matching', () => {
    if (!guard()) return;
    const hits = idx.search('prod');
    expect(hits.some((h) => h.name === 'Product')).toBe(true);
  });

  it('filters by kind and by package', () => {
    if (!guard()) return;
    const attrs = idx.search('order', { kinds: ['attribute'] });
    expect(attrs.every((h) => h.kind === 'attribute')).toBe(true);
    const inCatalog = idx.search('s', { package: 'catalog' });
    expect(inCatalog.every((h) => h.package === 'catalog')).toBe(true);
  });

  it('reindexes a single package incrementally without touching others', () => {
    if (!guard()) return;
    const renamed = {
      ...ordering,
      entities: [{ uuid: 'u1', name: 'PurchaseOrder', description: 'renamed', attributes: [], metadata: [] }],
    } as unknown as Package;
    idx.reindexPackage(renamed);
    expect(idx.search('PurchaseOrder').some((h) => h.name === 'PurchaseOrder')).toBe(true);
    expect(idx.search('OrderItem').some((h) => h.name === 'OrderItem')).toBe(false); // gone
    expect(idx.search('Product').some((h) => h.name === 'Product')).toBe(true); // catalog untouched
  });

  it('removes a package entirely', () => {
    if (!guard()) return;
    idx.removePackage('catalog');
    expect(idx.search('Product')).toHaveLength(0);
  });

  it('returns [] for a blank query', () => {
    if (!guard()) return;
    expect(idx.search('   ')).toHaveLength(0);
  });
});
