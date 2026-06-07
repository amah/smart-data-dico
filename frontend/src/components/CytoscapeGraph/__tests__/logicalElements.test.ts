/**
 * logicalElements.test.ts (#184)
 *
 * The logical (ORM) builder: ORM class labels, stereotype badges, namespace
 * subtitle and annotated association edges (fetch / cascade / orphanRemoval /
 * owning side / cardinality).
 */
import { describe, it, expect } from 'vitest';
import type { GraphNode, GraphEdge } from '../../../types';
import { AttributeType } from '../../../types';
import {
  buildLogicalElements,
  logicalClassName,
  logicalBadges,
  logicalOwningSide,
  logicalEdgeAnnotation,
} from '../logicalElements';

const node = (over: Partial<GraphNode> & { id: string; label: string }): GraphNode => ({
  type: 'entity',
  service: 'order-service',
  data: {
    uuid: over.id,
    name: over.label,
    description: '',
    attributes: [],
    ...(over.data as object),
  } as GraphNode['data'],
  ...over,
});

const ORDER = node({
  id: 'order-uuid',
  label: 'Order',
  data: {
    uuid: 'order-uuid',
    name: 'Order',
    description: 'A customer order',
    attributes: [
      { uuid: 'a1', name: 'id', description: '', type: AttributeType.STRING, required: true, primaryKey: true },
    ],
    metadata: [
      { name: 'orm.className', value: 'OrderEntity' },
      { name: 'orm.package', value: 'com.eshop.order' },
    ],
  },
});

const ADDRESS = node({
  id: 'addr-uuid',
  label: 'Address',
  data: {
    uuid: 'addr-uuid',
    name: 'Address',
    description: '',
    attributes: [],
    metadata: [{ name: 'orm.embeddable', value: true }],
  },
});

const BASE = node({
  id: 'base-uuid',
  label: 'BaseEntity',
  data: {
    uuid: 'base-uuid',
    name: 'BaseEntity',
    description: '',
    attributes: [],
    metadata: [{ name: 'orm.mappedSuperclass', value: true }],
  },
});

const ASSOC: GraphEdge = {
  id: 'rel-1',
  source: 'order-uuid',
  target: 'item-uuid',
  label: 'Order has items',
  sourceCardinality: 'one',
  targetCardinality: 'many',
  sourceName: 'items',
  targetName: 'order',
  metadata: [
    { name: 'orm.fetch', value: 'LAZY' },
    { name: 'orm.cascade', value: 'ALL' },
    { name: 'orm.orphanRemoval', value: true },
    { name: 'orm.mappedBy', value: 'order' },
  ],
};

describe('logical node labels & badges', () => {
  it('uses orm.className over the entity name; package kept in data, not the label', () => {
    expect(logicalClassName(ORDER)).toBe('OrderEntity');
    const els = buildLogicalElements([ORDER], []);
    const n = els.find((e) => e.data.id === 'order-uuid')!;
    expect(n.data.className).toBe('OrderEntity');
    expect(n.data.ormPackage).toBe('com.eshop.order'); // available for the info panel
    expect(n.data.displayLabel).toContain('OrderEntity');
    expect(n.data.displayLabel).not.toContain('com.eshop.order'); // package not shown per node
    // label stays the entity name for navigation
    expect(n.data.label).toBe('Order');
  });

  it('falls back to the entity name when orm.className is absent', () => {
    expect(logicalClassName(ADDRESS)).toBe('Address');
  });

  it('emits UML stereotype badges (embeddable / mapped-super-class)', () => {
    expect(logicalBadges(ADDRESS)).toEqual(['embeddable']);
    expect(logicalBadges(BASE)).toEqual(['mapped-super-class']);
    const addr = buildLogicalElements([ADDRESS], []).find((e) => e.data.id === 'addr-uuid')!;
    expect(addr.data.badges).toEqual(['embeddable']);
    expect(addr.data.displayLabel).toContain('«embeddable»');
  });

  it('keeps nodes compact — attributes carried as data, not inline in the label', () => {
    const n = buildLogicalElements([ORDER], []).find((e) => e.data.id === 'order-uuid')!;
    expect(n.data.attributes).toHaveLength(1);
    expect(n.data.displayLabel).not.toContain('─'); // no UML attribute separator
  });
});

describe('logical association edges', () => {
  it('annotates fetch, cascade and orphanRemoval', () => {
    expect(logicalEdgeAnnotation(ASSOC)).toBe('LAZY · cascade: ALL · orphanRemoval');
    const e = buildLogicalElements([], [ASSOC])[0];
    expect(e.data.edgeKind).toBe('association');
    expect(e.data.fetch).toBe('LAZY');
    expect(e.data.cascade).toBe('ALL');
    expect(e.data.orphanRemoval).toBe(true);
    expect(e.data.label).toBe('LAZY · cascade: ALL · orphanRemoval');
    // cardinality glyphs preserved on the ends
    expect(e.data.targetEndLabel).toBe('order *');
  });

  it('keeps the owning side available for the info panel (from mappedBy / owningEnd)', () => {
    // mappedBy: order matches the target role → target is inverse → source owns
    expect(logicalOwningSide(ASSOC)).toBe('source');
    expect(buildLogicalElements([], [ASSOC])[0].data.owningSide).toBe('source');
    const byOwningEnd: GraphEdge = { ...ASSOC, metadata: [{ name: 'orm.owningEnd', value: 'order' }] };
    expect(logicalOwningSide(byOwningEnd)).toBe('target');
  });

  it('renders a composition (orphanRemoval / cascade ALL) as a filled diamond at the whole', () => {
    // ASSOC: one→many with orphanRemoval + cascade ALL → composition; whole = source (the "one").
    const e = buildLogicalElements([], [ASSOC])[0];
    expect(e.data.edgeType).toBe('composition');
    expect(e.data.sourceArrow).toBe('diamond');
    expect(e.data.targetArrow).toBe('none');
  });

  it('renders a bidirectional reference with no arrowheads (UML plain line)', () => {
    // both ends named, no orphan/cascade → plain bidirectional reference
    const ref: GraphEdge = {
      ...ASSOC,
      metadata: [{ name: 'orm.fetch', value: 'LAZY' }], // no orphanRemoval/cascade
    };
    const e = buildLogicalElements([], [ref])[0];
    expect(e.data.edgeType).toBe('reference');
    expect(e.data.sourceArrow).toBe('none');
    expect(e.data.targetArrow).toBe('none');
  });

  it('renders a one-way reference with a single open arrow at the navigable end', () => {
    const oneWay: GraphEdge = {
      ...ASSOC,
      metadata: [], // not a composition
      sourceName: 'items',
      targetName: undefined, // only source navigable
    };
    const e = buildLogicalElements([], [oneWay])[0];
    expect(e.data.edgeType).toBe('reference');
    expect(e.data.sourceArrow).toBe('vee');
    expect(e.data.targetArrow).toBe('none');
  });

  it('merges a reciprocal relationship pair into a single association edge', () => {
    const forward: GraphEdge = { ...ASSOC, id: 'fwd' };
    const back: GraphEdge = {
      id: 'back',
      source: 'item-uuid',
      target: 'order-uuid',
      label: 'belongs to',
    };
    const edges = buildLogicalElements([], [forward, back]).filter((el) => el.group === 'edges');
    expect(edges).toHaveLength(1); // one edge for the pair, not two
  });

  it('hides the ORM annotation when showAnnotations is false', () => {
    const shown = buildLogicalElements([], [ASSOC], undefined, { showAnnotations: true })[0];
    const hidden = buildLogicalElements([], [ASSOC], undefined, { showAnnotations: false })[0];
    expect(shown.data.label).toBe('LAZY · cascade: ALL · orphanRemoval');
    expect(hidden.data.label).toBe('');
    // hiding the annotation does not change the edge decoration
    expect(hidden.data.edgeType).toBe('composition');
  });

  it('leaves owning side unset when nothing pins it down', () => {
    const edge: GraphEdge = { ...ASSOC, metadata: [{ name: 'orm.fetch', value: 'EAGER' }] };
    expect(logicalOwningSide(edge)).toBe('');
    expect(logicalEdgeAnnotation(edge)).toBe('EAGER');
  });
});
