/**
 * Logical (ORM) view element builder (#184/#185).
 *
 * Stub for the foundation slice (#183): delegates to the structural builder so
 * the Logical tab is wired and renders. #184 adds ORM class labels, badges and
 * annotated association edges; #185 adds the inheritance is-a edge.
 */
import type { ElementDefinition } from 'cytoscape';
import type { GraphNode, GraphEdge } from '../../types';
import { mapGraphDataToCytoscape } from './mapGraphDataToCytoscape';

export function buildLogicalElements(
  nodes: GraphNode[],
  edges: GraphEdge[],
  parentMapping?: Record<string, string>,
): ElementDefinition[] {
  return mapGraphDataToCytoscape(nodes, edges, parentMapping);
}
