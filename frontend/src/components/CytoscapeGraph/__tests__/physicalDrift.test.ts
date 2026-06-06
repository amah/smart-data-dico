/**
 * physicalDrift.test.ts (#187)
 *
 * Logical↔physical drift, both directions:
 *   - logical relationship with no backing FK → "not enforced in DB";
 *   - FK with no matching logical relationship → "in DB, missing from model".
 * Matching is direction-agnostic; m:n (orm.joinTable) relationships are exempt
 * from the "not enforced" check (the join table carries the FKs).
 */
import { describe, it, expect } from 'vitest';
import type { GraphNode, GraphEdge, PhysicalConstraint, MetadataEntry } from '../../../types';
import { detectDrift, buildDriftEdges, pairKey } from '../physicalDrift';
import { buildTableIndex, buildPhysicalElements } from '../physicalElements';

const node = (
  id: string,
  label: string,
  constraints: PhysicalConstraint[] = [],
  metadata: { name: string; value: unknown }[] = [],
): GraphNode => ({
  id,
  label,
  type: 'entity',
  service: 'svc',
  data: { uuid: id, name: label, description: '', attributes: [], constraints, metadata } as GraphNode['data'],
});

const rel = (id: string, source: string, target: string, metadata: MetadataEntry[] = []): GraphEdge => ({
  id,
  source,
  target,
  label: '',
  metadata,
});

// Order → users via FK; Order also has a logical rel to User.
const ORDER = node(
  'order',
  'Order',
  [{ kind: 'foreignKey', columns: ['user_id'], references: { table: 'users', columns: ['id'] } }],
  [{ name: 'physical.tableName', value: 'orders' }],
);
const USER = node('user', 'User', [], [{ name: 'physical.tableName', value: 'users' }]);

describe('detectDrift', () => {
  it('reports no drift when a relationship and an FK agree', () => {
    const index = buildTableIndex([ORDER, USER]);
    const drift = detectDrift([ORDER, USER], [rel('r', 'order', 'user')], index);
    expect(drift.notEnforced).toHaveLength(0);
    expect(drift.inDbMissing).toHaveLength(0);
  });

  it('flags a logical relationship with no backing FK as "not enforced"', () => {
    const a = node('a', 'A', [], [{ name: 'physical.tableName', value: 'a' }]);
    const b = node('b', 'B', [], [{ name: 'physical.tableName', value: 'b' }]);
    const index = buildTableIndex([a, b]);
    const drift = detectDrift([a, b], [rel('r', 'a', 'b')], index);
    expect(drift.notEnforced).toEqual([{ sourceId: 'a', targetId: 'b' }]);
    expect(drift.inDbMissing).toHaveLength(0);
  });

  it('flags an FK with no matching logical relationship as "in DB, missing"', () => {
    const index = buildTableIndex([ORDER, USER]);
    const drift = detectDrift([ORDER, USER], [], index); // no relationships
    expect(drift.inDbMissing).toEqual([{ sourceId: 'order', targetId: 'user' }]);
    expect(drift.notEnforced).toHaveLength(0);
  });

  it('matches FK and relationship regardless of direction', () => {
    const index = buildTableIndex([ORDER, USER]);
    // relationship declared user→order; FK is order→users — still a match
    const drift = detectDrift([ORDER, USER], [rel('r', 'user', 'order')], index);
    expect(drift.notEnforced).toHaveLength(0);
    expect(drift.inDbMissing).toHaveLength(0);
  });

  it('exempts m:n (orm.joinTable) relationships from the not-enforced check', () => {
    const a = node('a', 'A', [], [{ name: 'physical.tableName', value: 'a' }]);
    const b = node('b', 'B', [], [{ name: 'physical.tableName', value: 'b' }]);
    const index = buildTableIndex([a, b]);
    const m2m = rel('r', 'a', 'b', [{ name: 'orm.joinTable', value: 'a_b' }]);
    const drift = detectDrift([a, b], [m2m], index);
    expect(drift.notEnforced).toHaveLength(0);
  });
});

describe('drift edges & FK flagging', () => {
  it('buildDriftEdges renders a "not enforced in DB" warning edge', () => {
    const edges = buildDriftEdges({ notEnforced: [{ sourceId: 'a', targetId: 'b' }], inDbMissing: [] });
    expect(edges).toHaveLength(1);
    expect(edges[0].data.edgeKind).toBe('drift');
    expect(edges[0].data.driftKind).toBe('not-enforced');
    expect(edges[0].data.label).toBe('not enforced in DB');
  });

  it('the physical build flags an unmatched FK edge as drift (in-db-missing)', () => {
    const els = buildPhysicalElements([ORDER, USER], []); // FK but no relationship
    const fk = els.find((e) => e.data.edgeKind === 'fk')!;
    expect(fk.data.driftInDb).toBe(true);
    expect(fk.data.driftKind).toBe('in-db-missing');
    expect(fk.data.label).toContain('in DB, missing from model');
  });

  it('the physical build does not duplicate an edge for an in-db-missing FK', () => {
    const els = buildPhysicalElements([ORDER, USER], []);
    const edgesBetween = els.filter(
      (e) => e.group === 'edges' && pairKey(e.data.source, e.data.target) === pairKey('order', 'user'),
    );
    expect(edgesBetween).toHaveLength(1); // the flagged FK edge only — no parallel drift edge
  });
});
