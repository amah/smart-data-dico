/**
 * mergeEdges.test.ts (#bidi)
 *
 * Reciprocal relationship records between the same entity pair collapse into a
 * single edge, and arrowheads follow navigability: an arrowhead sits at an end
 * iff that end is named (navigable). Both named → one double-headed edge.
 */
import { describe, it, expect } from 'vitest';
import type { GraphEdge } from '../../../types';
import { mergeRelationshipEdges } from '../mergeEdges';

const edge = (over: Partial<GraphEdge> & { id: string; source: string; target: string }): GraphEdge => ({
  label: '',
  ...over,
});

describe('mergeRelationshipEdges', () => {
  it('arrowhead at each named end; both named → double-headed single edge', () => {
    const [m] = mergeRelationshipEdges([
      edge({ id: 'r', source: 'A', target: 'B', sourceName: 'bs', targetName: 'as' }),
    ]);
    expect(m.arrowAtSource).toBe(true);
    expect(m.arrowAtTarget).toBe(true);
    expect(m.merged).toBe(false);
  });

  it('one named end → a single arrowhead at that end', () => {
    const [m] = mergeRelationshipEdges([
      edge({ id: 'r', source: 'A', target: 'B', sourceName: 'bs' }),
    ]);
    expect(m.arrowAtSource).toBe(true);
    expect(m.arrowAtTarget).toBe(false);
  });

  it('no named ends → no arrowheads (plain line)', () => {
    const [m] = mergeRelationshipEdges([edge({ id: 'r', source: 'A', target: 'B' })]);
    expect(m.arrowAtSource).toBe(false);
    expect(m.arrowAtTarget).toBe(false);
  });

  it('merges a reciprocal pair (A→B and B→A) into one edge, unioning navigability', () => {
    const merged = mergeRelationshipEdges([
      edge({ id: 'fwd', source: 'A', target: 'B', sourceName: 'items' }), // A→B navigable
      edge({ id: 'back', source: 'B', target: 'A', sourceName: 'order' }), // B→A navigable
    ]);
    expect(merged).toHaveLength(1);
    const m = merged[0];
    expect(m.merged).toBe(true);
    expect(m.relationshipIds).toEqual(['fwd', 'back']);
    // canonical orientation = first edge (A→B); both directions navigable now
    expect(m.source).toBe('A');
    expect(m.target).toBe('B');
    expect(m.arrowAtSource).toBe(true); // from back (B→A)
    expect(m.arrowAtTarget).toBe(true); // from fwd (A→B)
  });

  it('keeps distinct entity pairs separate', () => {
    const merged = mergeRelationshipEdges([
      edge({ id: 'r1', source: 'A', target: 'B' }),
      edge({ id: 'r2', source: 'B', target: 'C' }),
    ]);
    expect(merged).toHaveLength(2);
  });

  it('prefers a constituent carrying orm.* metadata as the representative', () => {
    const [m] = mergeRelationshipEdges([
      edge({ id: 'plain', source: 'A', target: 'B' }),
      edge({ id: 'orm', source: 'B', target: 'A', metadata: [{ name: 'orm.fetch', value: 'LAZY' }] }),
    ]);
    expect(m.metadata?.some((x) => x.name === 'orm.fetch')).toBe(true);
  });
});
