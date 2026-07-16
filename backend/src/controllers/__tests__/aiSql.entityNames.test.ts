/**
 * buildSqlSchema() entityNames scoping (#grounding at scale) — the PREFERRED
 * scope on large models: names resolve across ALL packages (no packageName
 * needed), directly-related entities are pulled in automatically (both
 * relationship directions, cross-package) so JOIN endpoints are always
 * present, and relationships are filtered to the included set. Unresolvable
 * names surface loudly (unresolvedEntityNames / error) with searchModel
 * steering — never as a silently smaller schema.
 *
 * Column-type fallbacks, dialects, and #sql-settings are covered by
 * aiSql.test.ts; this file focuses on scope resolution.
 */
jest.mock('../../utils/fileOperations.js', () => ({
  listMicroservices: jest.fn(),
}));

import { buildSqlSchema } from '../aiSql.js';
import { listMicroservices } from '../../utils/fileOperations.js';

const mockListMicroservices = listMicroservices as jest.MockedFunction<any>;

const ORDER = 'uuid-order';
const ORDER_ITEM = 'uuid-order-item';
const CUSTOMER = 'uuid-customer';
const INVOICE = 'uuid-invoice';
const LEGACY_ORDER = 'uuid-legacy-order'; // entity literally named "ORDER"

function entity(uuid: string, name: string, table: string, extraMeta: Array<{ name: string; value: string }> = []) {
  return {
    uuid, name,
    metadata: [{ name: 'physical.tableName', value: table }, ...extraMeta],
    attributes: [{ name: 'id', type: 'uuid', required: true, primaryKey: true }],
  };
}

const ENTITIES: Record<string, any[]> = {
  'order-service': [
    entity(ORDER, 'Order', 'orders', [{ name: 'physical.schema', value: 'sales' }]),
    entity(ORDER_ITEM, 'OrderItem', 'order_items'),
  ],
  'customer-service': [entity(CUSTOMER, 'Customer', 'customers')],
  'billing-service': [
    entity(INVOICE, 'Invoice', 'invoices'),
    // same name as Order but different case — exact-match precedence probe
    entity(LEGACY_ORDER, 'ORDER', 'legacy_orders'),
  ],
};

const RELATIONSHIPS: Record<string, any[]> = {
  'order-service': [
    // cross-package: Customer lives in customer-service
    { source: { entity: CUSTOMER, cardinality: 'one' }, target: { entity: ORDER, cardinality: 'many' }, description: 'places' },
    { source: { entity: ORDER, cardinality: 'one' }, target: { entity: ORDER_ITEM, cardinality: 'many' } },
  ],
  'customer-service': [],
  'billing-service': [
    { source: { entity: CUSTOMER, cardinality: 'one' }, target: { entity: INVOICE, cardinality: 'many' } },
  ],
};

function makeServices() {
  return {
    serviceService: {
      getServiceEntities: jest.fn(async (pkg: string) => ENTITIES[pkg] ?? []),
      getPackageRelationships: jest.fn(async (pkg: string) => RELATIONSHIPS[pkg] ?? []),
    },
    derivedTypes: { list: jest.fn(async () => []) },
  };
}

const tableEntities = (s: any): string[] => s.tables.map((t: any) => t.entity).sort();

beforeEach(() => {
  jest.clearAllMocks();
  mockListMicroservices.mockResolvedValue(Object.keys(ENTITIES));
});

describe('buildSqlSchema — entityNames scoping', () => {
  it('resolves names across all packages (no packageName) and pulls in directly-related entities', async () => {
    const s: any = await buildSqlSchema({ entityNames: ['Order'] }, makeServices());
    // Order + its relatives Customer (cross-package) and OrderItem;
    // NOT Invoice, NOT the case-different "ORDER".
    expect(tableEntities(s)).toEqual(['Customer', 'Order', 'OrderItem']);
    expect(s.scope).toBe('entities: Order (+directly related)');
    expect(s.error).toBeUndefined();
    expect(s.unresolvedEntityNames).toBeUndefined();
  });

  it('filters relationships to the included set so every JOIN has both endpoints', async () => {
    const s: any = await buildSqlSchema({ entityNames: ['Order'] }, makeServices());
    expect(s.relationships).toHaveLength(2);
    expect(s.relationships).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: 'Customer', to: 'Order', fromCardinality: 'one', toCardinality: 'many' }),
      expect.objectContaining({ from: 'Order', to: 'OrderItem' }),
    ]));
    // Customer→Invoice is excluded even though Customer itself is included
    expect(s.relationships).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ to: 'Invoice' }),
    ]));
  });

  it('expands via the TARGET side too (relationship pointing AT the requested entity)', async () => {
    const s: any = await buildSqlSchema({ entityNames: ['OrderItem'] }, makeServices());
    // Order arrives via the o→i relationship's source side; expansion is one hop
    // only, so Customer (related to Order, not to OrderItem) stays out.
    expect(tableEntities(s)).toEqual(['Order', 'OrderItem']);
    expect(s.relationships).toEqual([
      expect.objectContaining({ from: 'Order', to: 'OrderItem' }),
    ]);
  });

  it('expands cross-package in the SOURCE direction (Customer → Order and Invoice)', async () => {
    const s: any = await buildSqlSchema({ entityNames: ['Customer'] }, makeServices());
    expect(tableEntities(s)).toEqual(['Customer', 'Invoice', 'Order']);
    expect(s.relationships).toHaveLength(2);
  });

  it('stamps every table with its owning package', async () => {
    const s: any = await buildSqlSchema({ entityNames: ['Order'] }, makeServices());
    const byEntity = Object.fromEntries(s.tables.map((t: any) => [t.entity, t.package]));
    expect(byEntity).toEqual({
      Order: 'order-service',
      OrderItem: 'order-service',
      Customer: 'customer-service',
    });
  });

  it('takes the table name from physical.tableName and the schema from physical.schema', async () => {
    const s: any = await buildSqlSchema({ entityNames: ['Order'] }, makeServices());
    const order = s.tables.find((t: any) => t.entity === 'Order');
    expect(order.table).toBe('orders');
    expect(order.schema).toBe('sales');
    expect(order.qualifiedName).toBe('sales.orders');
    const item = s.tables.find((t: any) => t.entity === 'OrderItem');
    expect(item.table).toBe('order_items');
    expect(item.schema).toBeUndefined();
  });

  it('exact-case match takes precedence over a case-insensitive one', async () => {
    const s: any = await buildSqlSchema({ entityNames: ['ORDER'] }, makeServices());
    // "ORDER" exists literally in billing-service → the loose match "Order"
    // (and its relatives) must NOT be pulled in.
    expect(tableEntities(s)).toEqual(['ORDER']);
    expect(s.tables[0].table).toBe('legacy_orders');
    expect(s.tables[0].package).toBe('billing-service');
  });

  it('falls back to case-insensitive resolution when no exact-case match exists', async () => {
    const s: any = await buildSqlSchema({ entityNames: ['orderitem'] }, makeServices());
    expect(tableEntities(s)).toEqual(['Order', 'OrderItem']);
  });

  it('partially unresolved names → unresolvedEntityNames + a searchModel note, resolved ones still returned', async () => {
    const s: any = await buildSqlSchema({ entityNames: ['Order', 'Nope'] }, makeServices());
    expect(s.error).toBeUndefined();
    expect(s.unresolvedEntityNames).toEqual(['Nope']);
    expect(s.note).toContain('Nope');
    expect(s.note).toContain('searchModel');
    expect(tableEntities(s)).toEqual(['Customer', 'Order', 'OrderItem']);
    // the scope line names only what actually resolved
    expect(s.scope).toBe('entities: Order (+directly related)');
  });

  it('fully unresolved names → error steering to searchModel, no partial schema', async () => {
    const s: any = await buildSqlSchema({ entityNames: ['Ghost', 'Phantom'] }, makeServices());
    expect(s.tables).toBeUndefined();
    expect(s.error).toContain('Ghost, Phantom');
    expect(s.error).toContain('searchModel');
  });

  it('unknown packageName → error steering to searchModel and the entityNames alternative', async () => {
    const s: any = await buildSqlSchema({ packageName: 'nope-service' }, makeServices());
    expect(s.tables).toBeUndefined();
    expect(s.error).toContain("Package 'nope-service' not found");
    expect(s.error).toContain('searchModel');
    expect(s.error).toContain('entityNames');
  });

  it('non-array entityNames (direct-path malformed call) → explicit error, NOT a whole-model fallback', async () => {
    const s: any = await buildSqlSchema({ entityNames: 'Order' as any }, makeServices());
    expect(s.tables).toBeUndefined();
    expect(s.error).toContain('must be an array');
    expect(s.error).toContain("entityNames: ['Order']");
  });

  it('normalizes ragged direct-path input (whitespace, empty strings)', async () => {
    const s: any = await buildSqlSchema({ entityNames: ['  Order  ', ''] as any }, makeServices());
    expect(tableEntities(s)).toEqual(['Customer', 'Order', 'OrderItem']);
    expect(s.unresolvedEntityNames).toBeUndefined();
  });

  it('whole-model call (no scope) also stamps package on every table (regression)', async () => {
    const s: any = await buildSqlSchema({}, makeServices());
    expect(s.tables).toHaveLength(5);
    for (const t of s.tables) expect(Object.keys(ENTITIES)).toContain(t.package);
    expect(s.scope).toBe('all packages');
  });

  it('refuses an unscoped schema dump for a large model and directs the agent to search first', async () => {
    const largeEntities = Array.from({ length: 251 }, (_, i) =>
      entity(`uuid-${i}`, `Entity${i}`, `entity_${i}`));
    mockListMicroservices.mockResolvedValue(['large-service']);
    const services = {
      serviceService: {
        getServiceEntities: jest.fn(async () => largeEntities),
        getPackageRelationships: jest.fn(async () => []),
      },
      derivedTypes: { list: jest.fn(async () => []) },
    };

    const s: any = await buildSqlSchema({}, services as any);

    expect(s.tables).toBeUndefined();
    expect(s.entityCount).toBe(251);
    expect(s.error).toContain('searchModel');
    expect(s.error).toContain('entityNames');
  });
});
