import type { ElementDefinition } from 'cytoscape';
import type { GraphNode, GraphEdge } from '../../types';

/**
 * Format the label shown at one end of a relationship edge.
 *
 * Rule: many → `*` (alone, or "<role> *"). one → role only, or empty
 * when the role is unset. The "1" glyph is implicit; only multiplicity
 * deserves visual weight on the edge.
 */
export function formatEndLabel(name?: string, cardinality?: string): string {
  const role = name?.trim() ?? '';
  if (cardinality === 'many') return role ? `${role} *` : '*';
  return role;
}

export function mapGraphDataToCytoscape(
  nodes: GraphNode[],
  edges: GraphEdge[],
  parentMapping?: Record<string, string>,
): ElementDefinition[] {
  const elements: ElementDefinition[] = [];

  for (const node of nodes) {
    const entity = node.data;
    const pkCount = entity?.attributes?.filter((a) => a.primaryKey).length ?? 0;
    const attrCount = entity?.attributes?.length ?? 0;
    const displayLabel = node.label;

    elements.push({
      group: 'nodes',
      data: {
        id: node.id,
        label: node.label,
        displayLabel,
        service: node.service,
        type: node.type,
        attrCount,
        pkCount,
        description: entity?.description ?? '',
        attributes: entity?.attributes ?? [],
        expanded: false,
        ...(parentMapping?.[node.id] ? { parent: parentMapping[node.id] } : {}),
      },
    });
  }

  for (const edge of edges) {
    elements.push({
      group: 'edges',
      data: {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        label: edge.label || '',
        // Raw cardinality + name preserved so tooltips/info panel can
        // still display them explicitly.
        sourceCardinality: edge.sourceCardinality ?? '',
        targetCardinality: edge.targetCardinality ?? '',
        sourceName: edge.sourceName ?? '',
        targetName: edge.targetName ?? '',
        // Pre-computed display labels read by the stylesheet's
        // source-label / target-label bindings.
        sourceEndLabel: formatEndLabel(edge.sourceName, edge.sourceCardinality),
        targetEndLabel: formatEndLabel(edge.targetName, edge.targetCardinality),
      },
    });
  }

  return elements;
}
