/**
 * Mode-aware Cytoscape element builders (#181/#183).
 *
 * One entry point — {@link buildViewElements} — selects a per-mode builder by
 * `viewMode` and produces the `ElementDefinition[]` fed to Cytoscape:
 *
 *   - `structural` → the original {@link mapGraphDataToCytoscape} output, byte
 *     for byte (snapshot-locked). The baseline view, unchanged.
 *   - `logical`    → ORM class model from `orm.*` (#184 labels/badges/edges, #185
 *     inheritance is-a edges).
 *   - `physical`   → DB table model from `physical.*` + `constraints[]` (#186
 *     tables/FK/join-tables, #187 logical↔physical drift overlay).
 *
 * All builders are pure functions of (nodes, edges, parentMapping) so each is
 * unit-testable in isolation. They share the package-compound `parentMapping`
 * and the same canvas/layout/export — only element building + styling differ.
 */
import type { ElementDefinition } from 'cytoscape';
import type { GraphNode, GraphEdge } from '../../types';
import type { ViewMode } from './viewMode';
import { mapGraphDataToCytoscape } from './mapGraphDataToCytoscape';
import { buildLogicalElements } from './logicalElements';
import { buildPhysicalElements } from './physicalElements';

export interface ViewOptions {
  /**
   * Structural view: overlay the ORM class model (class names, stereotype
   * badges, composition vs reference, inheritance is-a, embed links and the
   * fetch/cascade annotation). Toggled from the legend.
   */
  orm?: boolean;
}

export function buildViewElements(
  viewMode: ViewMode,
  nodes: GraphNode[],
  edges: GraphEdge[],
  parentMapping?: Record<string, string>,
  options: ViewOptions = {},
): ElementDefinition[] {
  switch (viewMode) {
    case 'physical':
      return buildPhysicalElements(nodes, edges, parentMapping);
    case 'structural':
    default:
      // The ORM overlay reuses the logical builder; plain structural otherwise.
      return options.orm
        ? buildLogicalElements(nodes, edges, parentMapping, { showAnnotations: true })
        : mapGraphDataToCytoscape(nodes, edges, parentMapping);
  }
}
