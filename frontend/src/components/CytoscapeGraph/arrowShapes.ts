/**
 * UML-style edge decorations for relationship edges (#uml).
 *
 * Two distinctions are drawn:
 *   - Navigability — an arrowhead points at a navigable (named) end. A
 *     relationship navigable BOTH ways is, by UML convention, a plain line with
 *     NO arrowheads; only a one-way relationship shows a single open arrow.
 *   - Composition vs reference — a relationship with strong ownership /
 *     lifecycle (`orm.orphanRemoval`, or cascade ALL/REMOVE) is a composition:
 *     a filled diamond at the whole (the "one" side). Everything else is a plain
 *     reference (association) decorated only by navigability.
 *
 * Pure functions — unit-tested in isolation.
 */
import type { MetadataEntry } from '../../types';
import { readMetaList, readMetaFlag } from './elementMeta';

export type ArrowShape = 'none' | 'vee' | 'diamond';

interface Navigable {
  arrowAtSource: boolean;
  arrowAtTarget: boolean;
}

interface Cardinalitied {
  sourceCardinality?: string;
  targetCardinality?: string;
}

/**
 * Navigability arrows for a plain reference: bidirectional (both ends
 * navigable) → no arrowheads; one-way → a single open arrow (vee) at the
 * navigable end.
 */
export function referenceArrows(e: Navigable): { sourceArrow: ArrowShape; targetArrow: ArrowShape } {
  const bidirectional = e.arrowAtSource && e.arrowAtTarget;
  return {
    sourceArrow: !bidirectional && e.arrowAtSource ? 'vee' : 'none',
    targetArrow: !bidirectional && e.arrowAtTarget ? 'vee' : 'none',
  };
}

/** A UML composition — strong ownership + lifecycle (orphanRemoval, or cascade ALL/REMOVE). */
export function isComposition(metadata: MetadataEntry[] | undefined): boolean {
  const cascade = readMetaList(metadata, 'orm.cascade');
  return (
    readMetaFlag(metadata, 'orm.orphanRemoval') ||
    cascade.includes('ALL') ||
    cascade.includes('REMOVE')
  );
}

/** The "whole"/container end of a composition — the `one` side (one whole owns many parts). */
export function compositionWholeEnd(e: Cardinalitied): '' | 'source' | 'target' {
  const s = e.sourceCardinality;
  const t = e.targetCardinality;
  if (s === 'one' && t === 'many') return 'source';
  if (t === 'one' && s === 'many') return 'target';
  if (s === 'one' && t === 'one') return 'source';
  return ''; // many-to-many or unknown — not a composition shape
}

/**
 * Decorate an association edge: a filled diamond at the whole for a composition,
 * else navigability arrows for a plain reference.
 */
export function associationArrows(
  e: Navigable & Cardinalitied & { metadata?: MetadataEntry[] },
): { sourceArrow: ArrowShape; targetArrow: ArrowShape; edgeType: 'composition' | 'reference' } {
  if (isComposition(e.metadata)) {
    const whole = compositionWholeEnd(e);
    if (whole) {
      return {
        sourceArrow: whole === 'source' ? 'diamond' : 'none',
        targetArrow: whole === 'target' ? 'diamond' : 'none',
        edgeType: 'composition',
      };
    }
  }
  return { ...referenceArrows(e), edgeType: 'reference' };
}
