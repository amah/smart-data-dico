/**
 * Physical (table) view element builder (#186/#187).
 *
 * Stub for the foundation slice (#183): delegates to the structural builder so
 * the Physical tab is wired and renders. #186 adds table-name nodes, FK edges
 * and join-table nodes; #187 adds the logical↔physical drift overlay.
 */
import type { ElementDefinition } from 'cytoscape';
import type { GraphNode, GraphEdge } from '../../types';
import { mapGraphDataToCytoscape } from './mapGraphDataToCytoscape';

export function buildPhysicalElements(
  nodes: GraphNode[],
  edges: GraphEdge[],
  parentMapping?: Record<string, string>,
): ElementDefinition[] {
  return mapGraphDataToCytoscape(nodes, edges, parentMapping);
}
