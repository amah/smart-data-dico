/**
 * searchDocuments — pure flattening of a Package into SearchDoc[] (#search-index).
 */
import { packageToSearchDocs, KIND_TIER } from '../searchDocuments.js';
import type { Package } from '../../../models/Dictionary.js';

const pkg = {
  id: 'ordering',
  name: 'ordering',
  description: 'Order lifecycle',
  type: 'domain',
  subPackages: [],
  entities: [
    {
      uuid: 'u-order',
      name: 'Order',
      description: 'Customer order',
      stereotype: 'aggregate-root',
      status: 'approved',
      attributes: [
        { uuid: 'a1', name: 'orderTotal', description: 'total amount', type: 'decimal', required: true },
        { uuid: 'a2', name: 'status', description: '', type: 'string', required: true },
      ],
      metadata: [{ name: 'system.hidden', value: 'false' }],
      rules: [{ uuid: 'r1', name: 'TotalMatchesLines', description: 'total = sum(lines)' }],
    },
  ],
  relationships: [
    { uuid: 'rel1', description: 'Order has items', type: 'composition', source: { entity: 'u-order', cardinality: 'one' }, target: { entity: 'u-item', cardinality: 'many' } },
  ],
  cases: [{ uuid: 'c1', name: 'Checkout', description: 'checkout flow' }],
} as unknown as Package;

describe('packageToSearchDocs', () => {
  const docs = packageToSearchDocs(pkg);
  const byKind = (k: string) => docs.filter((d) => d.kind === k);

  it('emits a package doc with its own route', () => {
    const p = byKind('package')[0];
    expect(p.name).toBe('ordering');
    expect(p.route).toBe('/packages/ordering');
    expect(p.description).toBe('Order lifecycle');
  });

  it('emits an entity doc routed to the entity page, folding stereotype/status into keywords', () => {
    const e = byKind('entity')[0];
    expect(e.name).toBe('Order');
    expect(e.route).toBe('/packages/ordering/entities/Order');
    expect(e.keywords).toContain('aggregate-root');
    expect(e.keywords).toContain('approved');
  });

  it('emits one attribute doc per attribute, carrying entityName + type', () => {
    const attrs = byKind('attribute');
    expect(attrs.map((a) => a.name).sort()).toEqual(['orderTotal', 'status']);
    const total = attrs.find((a) => a.name === 'orderTotal')!;
    expect(total.entityName).toBe('Order');
    expect(total.keywords).toContain('decimal');
    expect(total.route).toBe('/packages/ordering/entities/Order');
  });

  it('emits metadata, inline-rule, relationship and case docs', () => {
    expect(byKind('metadata')[0].name).toBe('system.hidden');
    const rule = byKind('rule')[0];
    expect(rule.name).toBe('TotalMatchesLines');
    expect(rule.entityName).toBe('Order');
    expect(byKind('relationship')[0].name).toBe('Order has items');
    const c = byKind('case')[0];
    expect(c.name).toBe('Checkout');
    expect(c.route).toBe('/cases/c1');
  });

  it('gives every doc a unique, stable id', () => {
    const ids = docs.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain('entity:ordering:Order');
    expect(ids).toContain('attr:ordering:Order:orderTotal');
  });

  it('ranks entities above attributes above packages via KIND_TIER', () => {
    expect(KIND_TIER.entity).toBeLessThan(KIND_TIER.attribute);
    expect(KIND_TIER.attribute).toBeLessThan(KIND_TIER.package);
  });

  it('tolerates a bare package (no entities/rels/cases) without throwing', () => {
    const empty = { id: 'x', name: 'x', entities: [], subPackages: [], relationships: [] } as unknown as Package;
    const out = packageToSearchDocs(empty);
    expect(out).toHaveLength(1); // just the package doc
    expect(out[0].kind).toBe('package');
  });
});
