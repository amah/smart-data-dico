import type { ElementDefinition } from 'cytoscape';
import type { GraphNode, GraphEdge } from '../../types';

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
    const summaryParts: string[] = [];
    if (pkCount > 0) summaryParts.push(`${pkCount} PK`);
    summaryParts.push(`${attrCount} ${attrCount === 1 ? 'attr' : 'attrs'}`);
    const displayLabel = `${node.label}\n${summaryParts.join(' · ')}`;

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
        sourceCardinality: edge.sourceCardinality ?? '',
        targetCardinality: edge.targetCardinality ?? '',
      },
    });
  }

  return elements;
}
