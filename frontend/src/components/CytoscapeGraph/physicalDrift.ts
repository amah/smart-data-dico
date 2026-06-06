/**
 * Logical↔physical drift detector (#187, Decision 3 — logical-first overlay).
 *
 * The logical model is the source of truth; the Physical view is cross-checked
 * against it and drift is flagged BOTH ways:
 *
 *   - a logical **relationship with no backing FK** constraint → "not enforced
 *     in DB" (a new dashed warning edge);
 *   - an **FK constraint with no matching logical relationship** → "in DB,
 *     missing from model" (the FK edge is flagged as a warning).
 *
 * Matching is direction-agnostic (an FK can sit on either side of a logical
 * relationship), so entity pairs are keyed undirected. This mirrors the
 * existing Physical Sync diff's intent (impactDiff.ts) — relationships vs FK
 * constraints — at the diagram layer.
 *
 * Pure functions of (nodes, edges, tableIndex) — unit-tested in isolation.
 */
import type { ElementDefinition } from 'cytoscape';
import type { GraphNode, GraphEdge } from '../../types';
import { readMetaString } from './elementMeta';

export interface DriftPair {
  sourceId: string;
  targetId: string;
}

export interface DriftResult {
  /** Logical relationships with no backing FK constraint. */
  notEnforced: DriftPair[];
  /** FK constraints with no matching logical relationship. */
  inDbMissing: DriftPair[];
}

/** Undirected key for an entity pair. */
export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * Resolve every on-canvas FK constraint to an entity pair. FKs whose referenced
 * table is off-canvas (or self-referencing) are dropped — they can't be drawn,
 * and shouldn't be reported as drift either way.
 */
export function resolveFkPairs(
  nodes: GraphNode[],
  tableIndex: Map<string, string>,
): DriftPair[] {
  const pairs: DriftPair[] = [];
  for (const node of nodes) {
    const fks = (node.data?.constraints ?? []).filter((c) => c.kind === 'foreignKey');
    for (const fk of fks) {
      const refTable = fk.references?.table;
      if (!refTable) continue;
      const targetId = tableIndex.get(refTable);
      if (!targetId || targetId === node.id) continue;
      pairs.push({ sourceId: node.id, targetId });
    }
  }
  return pairs;
}

/**
 * Logical relationship pairs eligible for FK backing. Many-to-many
 * relationships (`orm.joinTable`) are excluded — their integrity is enforced by
 * the join table's FKs, not a direct constraint, so they are never "not enforced".
 */
export function logicalPairs(edges: GraphEdge[]): DriftPair[] {
  return edges
    .filter((e) => !readMetaString(e.metadata, 'orm.joinTable'))
    .map((e) => ({ sourceId: e.source, targetId: e.target }));
}

export function detectDrift(
  nodes: GraphNode[],
  edges: GraphEdge[],
  tableIndex: Map<string, string>,
): DriftResult {
  const fkPairs = resolveFkPairs(nodes, tableIndex);
  const logical = logicalPairs(edges);

  const fkSet = new Set(fkPairs.map((p) => pairKey(p.sourceId, p.targetId)));
  const logicalSet = new Set(logical.map((p) => pairKey(p.sourceId, p.targetId)));

  const notEnforced = logical.filter((p) => !fkSet.has(pairKey(p.sourceId, p.targetId)));

  // Dedupe inDbMissing by pair so a compound FK doesn't double-report.
  const seen = new Set<string>();
  const inDbMissing: DriftPair[] = [];
  for (const p of fkPairs) {
    const key = pairKey(p.sourceId, p.targetId);
    if (logicalSet.has(key) || seen.has(key)) continue;
    seen.add(key);
    inDbMissing.push(p);
  }

  return { notEnforced, inDbMissing };
}

/**
 * Warning edges for "not enforced in DB" drift (a logical relationship with no
 * backing FK). The "in DB, missing from model" direction is rendered by
 * flagging the existing FK edge (see physicalElements), not by a new edge, so
 * the canvas never carries two edges for one FK.
 */
export function buildDriftEdges(drift: DriftResult): ElementDefinition[] {
  return drift.notEnforced.map((p) => ({
    group: 'edges' as const,
    data: {
      id: `drift:not-enforced:${pairKey(p.sourceId, p.targetId)}`,
      source: p.sourceId,
      target: p.targetId,
      edgeKind: 'drift',
      driftKind: 'not-enforced',
      viewMode: 'physical',
      label: 'not enforced in DB',
      sourceEndLabel: '',
      targetEndLabel: '',
    },
  }));
}
