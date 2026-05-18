import type { ElementDefinition } from 'cytoscape';
import type { GraphNode, GraphEdge } from '../../types';

/**
 * Format the label shown at one end of a relationship edge.
 *
 * UML/ER convention: render the role (endpoint name) plus a cardinality
 * glyph (`*` for many, `1` for one). When the role is unset we still show
 * the glyph alone so the edge multiplicity stays legible. The old
 * behaviour was to render the word "many" / "one", which was wordy and
 * hid the role.
 */
export function formatEndLabel(name?: string, cardinality?: string): string {
  const glyph = cardinality === 'many' ? '*' : cardinality ? '1' : '';
  const role = name?.trim();
  if (role && glyph) return `${role} ${glyph}`;
  if (role) return role;
  return glyph;
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
