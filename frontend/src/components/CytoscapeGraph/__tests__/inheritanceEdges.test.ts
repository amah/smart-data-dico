/**
 * inheritanceEdges.test.ts (#185)
 *
 * orm.extends yields a SEPARATE inheritance ("is-a") edge — never an
 * association — and the root surfaces its orm.inheritanceStrategy. Decision 5:
 * inheritance is diagram-only, not promoted to a relationship type.
 */
import { describe, it, expect } from 'vitest';
import type { GraphNode } from '../../../types';
import {
  buildLogicalElements,
  buildInheritanceEdges,
  logicalInheritanceStrategy,
} from '../logicalElements';

const node = (
  id: string,
  label: string,
  metadata: { name: string; value: unknown }[] = [],
): GraphNode => ({
  id,
  label,
  type: 'entity',
  service: 'svc',
  data: { uuid: id, name: label, description: '', attributes: [], metadata } as GraphNode['data'],
});

// Payment (root, SINGLE_TABLE) ← CardPayment (extends by name) ← uuid ref
const PAYMENT = node('pay-uuid', 'Payment', [
  { name: 'orm.inheritanceStrategy', value: 'SINGLE_TABLE' },
]);
const CARD = node('card-uuid', 'CardPayment', [{ name: 'orm.extends', value: 'Payment' }]);
const WIRE = node('wire-uuid', 'WirePayment', [{ name: 'orm.extends', value: 'pay-uuid' }]);

describe('inheritance is-a edges', () => {
  it('builds a separate inheritance edge per orm.extends, resolved by name or uuid', () => {
    const edges = buildInheritanceEdges([PAYMENT, CARD, WIRE]);
    expect(edges).toHaveLength(2);
    const card = edges.find((e) => e.data.source === 'card-uuid')!;
    expect(card.data.target).toBe('pay-uuid'); // resolved by name "Payment"
    expect(card.data.edgeKind).toBe('inheritance');
    const wire = edges.find((e) => e.data.source === 'wire-uuid')!;
    expect(wire.data.target).toBe('pay-uuid'); // resolved by uuid
  });

  it('is-a edges are not associations and carry no cardinality', () => {
    const [edge] = buildInheritanceEdges([PAYMENT, CARD]);
    expect(edge.data.edgeKind).toBe('inheritance');
    expect(edge.data.edgeKind).not.toBe('association');
    expect(edge.data.sourceEndLabel).toBe('');
    expect(edge.data.targetEndLabel).toBe('');
  });

  it('surfaces the inheritance strategy on the root (node + edge label)', () => {
    expect(logicalInheritanceStrategy(PAYMENT)).toBe('SINGLE_TABLE');
    const els = buildLogicalElements([PAYMENT, CARD], []);
    const root = els.find((e) => e.data.id === 'pay-uuid')!;
    expect(root.data.inheritanceStrategy).toBe('SINGLE_TABLE');
    expect(root.data.displayLabel).toContain('{SINGLE_TABLE}');
    const isa = els.find((e) => e.data.edgeKind === 'inheritance')!;
    expect(isa.data.label).toBe('SINGLE_TABLE');
  });

  it('drops orm.extends that points off-canvas', () => {
    const orphan = node('x-uuid', 'X', [{ name: 'orm.extends', value: 'NotHere' }]);
    expect(buildInheritanceEdges([orphan])).toHaveLength(0);
  });

  it('the full logical build keeps associations and inheritance as distinct edge kinds', () => {
    const els = buildLogicalElements([PAYMENT, CARD], []);
    const edges = els.filter((e) => e.group === 'edges');
    expect(edges.every((e) => e.data.edgeKind === 'inheritance')).toBe(true);
  });
});
