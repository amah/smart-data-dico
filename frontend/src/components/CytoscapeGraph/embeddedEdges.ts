/**
 * Diagram-only composition edges for `@Embedded` attributes (#embed).
 *
 * An embeddable value object (e.g. `Address`) is referenced from an owner via an
 * attribute (`type: object`, `orm.embedded`, `orm.javaType: Address`) rather than
 * a relationship — so no association edge connects them. An embed is a UML
 * **composition** (the owner contains the part), so the structural and logical
 * views derive a composition edge `owner ◆— embeddable`, one per embedded
 * attribute (so `shippingAddress` and `billingAddress` each show). Resolved by
 * name against the on-canvas nodes; unresolved targets (off-canvas) are dropped.
 *
 * Pure function — unit-tested in isolation.
 */
import type { ElementDefinition } from 'cytoscape';
import type { GraphNode } from '../../types';
import type { ViewMode } from './viewMode';
import { readMetaFlag, readMetaString } from './elementMeta';

export function buildEmbeddedEdges(
  nodes: GraphNode[],
  viewMode: ViewMode,
): ElementDefinition[] {
  const byName = new Map(nodes.map((n) => [n.label, n.id]));
  const edges: ElementDefinition[] = [];

  for (const node of nodes) {
    for (const attr of node.data?.attributes ?? []) {
      if (!readMetaFlag(attr.metadata, 'orm.embedded')) continue;
      const target = readMetaString(attr.metadata, 'orm.javaType');
      if (!target) continue;
      const targetId = byName.get(target);
      if (!targetId || targetId === node.id) continue;
      edges.push({
        group: 'edges',
        data: {
          id: `embed:${node.id}:${attr.name}`,
          source: node.id, // owner = the whole
          target: targetId, // embeddable = the part
          edgeKind: 'association',
          edgeType: 'composition',
          viewMode,
          label: attr.name, // the embedded field (role)
          // Filled diamond at the owner (composition); no other arrowhead.
          sourceArrow: 'diamond',
          targetArrow: 'none',
          sourceEndLabel: '',
          targetEndLabel: '',
        },
      });
    }
  }
  return edges;
}
