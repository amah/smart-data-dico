/**
 * Inheritance ("is-a") edges from `orm.extends` (#185).
 *
 * Extracted so both the structural builder and the ORM overlay can render the
 * same connection set (a subclass→superclass generalization is part of the
 * structure). Decision 5: inheritance is NOT a relationship — these edges are
 * generated here, never promoted to a relationship `type`, never mixed with
 * associations. `orm.extends` is an entityRef (a uuid or an entity name),
 * resolved against the nodes by id then by name; unresolved parents are dropped.
 */
import type { ElementDefinition } from 'cytoscape';
import type { GraphNode } from '../../types';
import { readMetaString } from './elementMeta';

/** Inheritance strategy declared on a class (the `@Inheritance` on the root). */
export function logicalInheritanceStrategy(node: GraphNode): string {
  return readMetaString(node.data?.metadata, 'orm.inheritanceStrategy') || '';
}

export function buildInheritanceEdges(nodes: GraphNode[]): ElementDefinition[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const byName = new Map(nodes.map((n) => [n.label, n]));
  const edges: ElementDefinition[] = [];

  for (const child of nodes) {
    const ext = readMetaString(child.data?.metadata, 'orm.extends');
    if (!ext) continue;
    const parent = byId.get(ext) || byName.get(ext);
    if (!parent || parent.id === child.id) continue;
    edges.push({
      group: 'edges',
      data: {
        id: `isa:${child.id}->${parent.id}`,
        source: child.id,
        target: parent.id,
        edgeKind: 'inheritance',
        // No association annotation / cardinality on an is-a edge; the root's
        // strategy (if any) labels the edge so it reads at the superclass end.
        label: logicalInheritanceStrategy(parent),
        sourceEndLabel: '',
        targetEndLabel: '',
      },
    });
  }
  return edges;
}
