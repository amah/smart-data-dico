/**
 * physicalElements.test.ts (#186)
 *
 * The physical (table) builder: physical.tableName/schema → node label +
 * namespace; foreignKey constraints → FK edges labelled with join columns;
 * orm.joinTable → a synthetic join-table node bridging both sides.
 */
import { describe, it, expect } from 'vitest';
import type { GraphNode, GraphEdge, PhysicalConstraint } from '../../../types';
import {
  buildPhysicalElements,
  physicalTableName,
  physicalSchema,
  buildFkEdges,
  buildJoinTables,
  buildTableIndex,
} from '../physicalElements';

const node = (
  id: string,
  label: string,
  metadata: { name: string; value: unknown }[] = [],
  constraints: PhysicalConstraint[] = [],
): GraphNode => ({
  id,
  label,
  type: 'entity',
  service: 'svc',
  data: { uuid: id, name: label, description: '', attributes: [], metadata, constraints } as GraphNode['data'],
});

const ORDER = node(
  'order-uuid',
  'Order',
  [
    { name: 'physical.tableName', value: 'orders' },
    { name: 'physical.schema', value: 'commerce' },
  ],
  [
    { kind: 'unique', name: 'uq_order_no', columns: ['order_number'] },
    { kind: 'foreignKey', name: 'fk_orders_user', columns: ['user_id'], references: { table: 'users', columns: ['id'] } },
  ],
);
const USER = node('user-uuid', 'User', [{ name: 'physical.tableName', value: 'users' }]);

describe('physical table nodes', () => {
  it('labels the node with physical.tableName and carries the schema namespace', () => {
    expect(physicalTableName(ORDER)).toBe('orders');
    expect(physicalSchema(ORDER)).toBe('commerce');
    const n = buildPhysicalElements([ORDER, USER], []).find((e) => e.data.id === 'order-uuid')!;
    expect(n.data.tableName).toBe('orders');
    expect(n.data.schema).toBe('commerce');
    expect(n.data.displayLabel).toContain('orders');
    expect(n.data.displayLabel).toContain('commerce');
    expect(n.data.label).toBe('Order'); // entity name kept for navigation
  });

  it('falls back to the entity name when physical.tableName is absent', () => {
    expect(physicalTableName(node('x', 'Widget'))).toBe('Widget');
  });

  it('keeps nodes compact — constraints carried as data, not inline', () => {
    const n = buildPhysicalElements([ORDER, USER], []).find((e) => e.data.id === 'order-uuid')!;
    expect(n.data.constraints).toHaveLength(2);
    expect(n.data.displayLabel).not.toContain('user_id');
  });
});

describe('FK edges', () => {
  it('emits an FK edge from a foreignKey constraint, labelled with join columns', () => {
    const index = buildTableIndex([ORDER, USER]);
    const fks = buildFkEdges([ORDER, USER], index);
    expect(fks).toHaveLength(1);
    expect(fks[0].data.edgeKind).toBe('fk');
    expect(fks[0].data.source).toBe('order-uuid');
    expect(fks[0].data.target).toBe('user-uuid'); // resolved via physical.tableName "users"
    expect(fks[0].data.label).toBe('user_id → id');
  });

  it('skips FK constraints whose referenced table is off-canvas', () => {
    const index = buildTableIndex([ORDER]); // no users table
    expect(buildFkEdges([ORDER], index)).toHaveLength(0);
  });

  it('does not turn unique/check constraints into edges', () => {
    const onlyUnique = node('p', 'P', [], [{ kind: 'unique', columns: ['x'] }]);
    expect(buildFkEdges([onlyUnique], buildTableIndex([onlyUnique]))).toHaveLength(0);
  });
});

describe('embeddables', () => {
  it('excludes @Embeddable entities from the physical view (no table of their own)', () => {
    const address = node('addr-uuid', 'Address', [{ name: 'orm.embeddable', value: true }]);
    const els = buildPhysicalElements([ORDER, USER, address], []);
    const nodeIds = els.filter((e) => e.group === 'nodes').map((e) => e.data.id);
    expect(nodeIds).toContain('order-uuid');
    expect(nodeIds).toContain('user-uuid');
    expect(nodeIds).not.toContain('addr-uuid'); // embeddable dropped
  });
});

describe('many-to-many join tables', () => {
  const PRODUCT = node('prod-uuid', 'Product');
  const CATEGORY = node('cat-uuid', 'Category');
  const M2M: GraphEdge = {
    id: 'rel-pc',
    source: 'prod-uuid',
    target: 'cat-uuid',
    label: 'Product ↔ Category',
    metadata: [
      { name: 'orm.joinTable', value: 'product_category' },
      { name: 'orm.joinColumns', value: 'product_id' },
      { name: 'orm.inverseJoinColumns', value: 'category_id' },
    ],
  };

  it('builds a join-table node and two FK edges from orm.joinTable', () => {
    const els = buildJoinTables([M2M], [PRODUCT, CATEGORY]);
    const jt = els.find((e) => e.group === 'nodes')!;
    expect(jt.data.type).toBe('jointable');
    expect(jt.data.displayLabel).toBe('product_category');
    const fkEdges = els.filter((e) => e.group === 'edges');
    expect(fkEdges).toHaveLength(2);
    expect(fkEdges.every((e) => e.data.edgeKind === 'fk')).toBe(true);
    expect(fkEdges.map((e) => e.data.target).sort()).toEqual(['cat-uuid', 'prod-uuid']);
    expect(fkEdges.map((e) => e.data.label)).toContain('product_id');
    expect(fkEdges.map((e) => e.data.label)).toContain('category_id');
  });

  it('ignores relationships without orm.joinTable', () => {
    const plain: GraphEdge = { id: 'r', source: 'prod-uuid', target: 'cat-uuid', label: '' };
    expect(buildJoinTables([plain], [PRODUCT, CATEGORY])).toHaveLength(0);
  });
});
