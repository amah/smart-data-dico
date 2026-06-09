/**
 * searchIndex.test.ts — in-memory spotlight index.
 *
 * Covers: record flattening + routes, case-insensitive fuzzy matching, and the
 * per-kind re-ranking that floats entities/attributes/packages to the top.
 */
import { describe, it, expect } from 'vitest';
import type { Package, Stereotype } from '../../../../types';
import { buildRecords, createSearchIndex, rankedSearch } from '../searchIndex';

const packages: Package[] = [
  {
    id: 'p1',
    name: 'order-service',
    description: 'Ordering domain',
    entities: [
      {
        uuid: 'e1',
        name: 'Order',
        description: 'A customer order',
        attributes: [
          { uuid: 'a1', name: 'orderNumber', description: 'Human ref', type: 'string', required: true },
          { uuid: 'a2', name: 'total', description: 'Order total', type: 'number', required: true },
        ],
        metadata: [{ name: 'pii', value: true }],
      },
    ],
    relationships: [
      { uuid: 'r1', description: 'Order places Payment', source: {} as never, target: {} as never },
    ],
    cases: [{ uuid: 'c1', name: 'Ordering', description: 'Order lifecycle' }],
  } as Package,
];

const stereotypes: Stereotype[] = [
  { id: 's1', name: 'Aggregate Root', appliesTo: 'entity', metadataDefinitions: [] } as Stereotype,
];

describe('buildRecords', () => {
  const records = buildRecords(packages, stereotypes);

  it('flattens every kind with stable ids and routes', () => {
    const byKind = (k: string) => records.filter((r) => r.kind === k);
    expect(byKind('package')).toHaveLength(1);
    expect(byKind('entity')).toHaveLength(1);
    expect(byKind('attribute')).toHaveLength(2);
    expect(byKind('metadata')).toHaveLength(1);
    expect(byKind('relationship')).toHaveLength(1);
    expect(byKind('case')).toHaveLength(1);
    expect(byKind('stereotype')).toHaveLength(1);

    expect(byKind('entity')[0].route).toBe('/packages/order-service/entities/Order');
    expect(byKind('attribute')[0].route).toBe('/packages/order-service/entities/Order');
    expect(byKind('attribute')[0].entityName).toBe('Order');
    expect(byKind('package')[0].route).toBe('/packages/order-service');
    expect(byKind('case')[0].route).toBe('/cases/c1');
  });
});

describe('rankedSearch', () => {
  const fuse = createSearchIndex(buildRecords(packages, stereotypes));

  it('is case-insensitive — uppercase, lowercase and mixed all find Order', () => {
    for (const q of ['ORDER', 'order', 'OrDeR']) {
      const top = rankedSearch(fuse, q)[0];
      expect(top?.kind).toBe('entity');
      expect(top?.name).toBe('Order');
    }
  });

  it('ranks the entity above same-text relationship/case matches', () => {
    const top = rankedSearch(fuse, 'order');
    const entityIdx = top.findIndex((r) => r.kind === 'entity');
    const relIdx = top.findIndex((r) => r.kind === 'relationship');
    expect(entityIdx).toBeGreaterThanOrEqual(0);
    if (relIdx >= 0) expect(entityIdx).toBeLessThan(relIdx);
  });

  it('matches attributes fuzzily and tolerates a typo', () => {
    const names = rankedSearch(fuse, 'ordernumbr').map((r) => r.name); // missing "e"
    expect(names).toContain('orderNumber');
  });

  it('returns nothing for an empty query and respects the limit', () => {
    expect(rankedSearch(fuse, '   ')).toHaveLength(0);
    expect(rankedSearch(fuse, 'o', 2).length).toBeLessThanOrEqual(2);
  });
});
