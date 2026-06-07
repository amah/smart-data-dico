/**
 * Merge relationship edges that connect the same entity pair (#bidi).
 *
 * A relationship is bidirectional when both of its ends are named — each named
 * end is navigable, so the arrowhead sits at that end. Two reciprocal
 * relationship records (A→B and B→A) describe the *same* association from each
 * side, so the diagram should draw a SINGLE edge for the pair rather than two
 * parallel arrows.
 *
 * This collapses every group of edges sharing an unordered {source, target}
 * pair into one canonical edge, unioning navigability (an arrowhead at an end
 * iff any constituent names that end). The structural and logical builders both
 * consume the result; physical uses FK edges instead, so it doesn't apply.
 */
import type { GraphEdge, MetadataEntry } from '../../types';

export interface MergedGraphEdge {
  /** Canonical edge id (the first constituent's id). */
  id: string;
  /** uuids of every relationship merged into this edge (1+). */
  relationshipIds: string[];
  source: string;
  target: string;
  label: string;
  sourceCardinality?: string;
  targetCardinality?: string;
  sourceName?: string;
  targetName?: string;
  /** Arrowhead at the source end — true iff the source end is navigable (named). */
  arrowAtSource: boolean;
  /** Arrowhead at the target end — true iff the target end is navigable (named). */
  arrowAtTarget: boolean;
  /** True when more than one relationship record was merged (a reciprocal pair). */
  merged: boolean;
  /** Representative metadata (first constituent carrying `orm.*`) for annotations. */
  metadata?: MetadataEntry[];
}

const named = (s?: string): boolean => !!(s && s.trim());

function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export function mergeRelationshipEdges(edges: GraphEdge[]): MergedGraphEdge[] {
  const groups = new Map<string, GraphEdge[]>();
  const order: string[] = [];
  for (const e of edges) {
    const key = pairKey(e.source, e.target);
    if (!groups.has(key)) {
      groups.set(key, []);
      order.push(key);
    }
    groups.get(key)!.push(e);
  }

  return order.map((key) => {
    const group = groups.get(key)!;
    const canon = group[0];
    const canonSource = canon.source;

    let arrowAtSource = false;
    let arrowAtTarget = false;
    let sourceName: string | undefined;
    let targetName: string | undefined;
    let sourceCardinality: string | undefined;
    let targetCardinality: string | undefined;

    for (const e of group) {
      // Each constituent may be stored in the canonical orientation or flipped;
      // map its ends onto the canonical source/target before unioning.
      const flipped = e.source !== canonSource;
      const srcNamed = named(e.sourceName);
      const tgtNamed = named(e.targetName);
      if (!flipped) {
        arrowAtSource = arrowAtSource || srcNamed;
        arrowAtTarget = arrowAtTarget || tgtNamed;
        sourceName = sourceName || (srcNamed ? e.sourceName : undefined);
        targetName = targetName || (tgtNamed ? e.targetName : undefined);
        sourceCardinality = sourceCardinality || e.sourceCardinality;
        targetCardinality = targetCardinality || e.targetCardinality;
      } else {
        arrowAtTarget = arrowAtTarget || srcNamed;
        arrowAtSource = arrowAtSource || tgtNamed;
        sourceName = sourceName || (tgtNamed ? e.targetName : undefined);
        targetName = targetName || (srcNamed ? e.sourceName : undefined);
        sourceCardinality = sourceCardinality || e.targetCardinality;
        targetCardinality = targetCardinality || e.sourceCardinality;
      }
    }

    const metaEdge =
      group.find((e) => (e.metadata || []).some((m) => m.name.startsWith('orm.'))) || canon;

    return {
      id: canon.id,
      relationshipIds: group.map((e) => e.id),
      source: canonSource,
      target: canon.target,
      label: canon.label,
      sourceCardinality,
      targetCardinality,
      sourceName,
      targetName,
      arrowAtSource,
      arrowAtTarget,
      merged: group.length > 1,
      metadata: metaEdge.metadata,
    };
  });
}
