import type { Core } from 'cytoscape';
import type { Attribute, Package, PhysicalConstraint } from '../../types';
import type { ViewMode } from './viewMode';

export type GraphMode = 'service' | 'organization';

/**
 * Node-detail mode for the info panel — independent of the page {@link ViewMode}.
 * The structural tab with the ORM overlay tags its nodes `logical` so the panel
 * shows ORM facts, even though `logical` is no longer a page tab.
 */
export type DetailMode = 'structural' | 'logical' | 'physical';

export type LayoutName = 'dagre' | 'fcose' | 'elk';

export type LayoutDirection = 'TB' | 'LR' | 'BT' | 'RL';

export interface CytoscapeGraphProps {
  service?: string;
  mode?: GraphMode;
  /**
   * Diagram view mode (#181). Distinct from {@link GraphMode} (`mode`, which
   * means service vs organization grouping): `viewMode` selects which element
   * builder + stylesheet variant renders the graph. Defaults to `structural`.
   */
  viewMode?: ViewMode;
  packages?: Package[];
  initialLayoutId?: string;
  caseId?: string;
}

export interface TooltipData {
  label: string;
  description: string;
  attrCount: number;
  pkCount: number;
  service: string;
  position: { x: number; y: number };
}

export interface InfoPanelData {
  type: 'node' | 'edge';
  /** Cytoscape node id — used to drive the Focus action (#focus). */
  id?: string;
  label: string;
  service?: string;
  description?: string;
  attributes?: Attribute[];
  /** Node-detail mode — drives the per-mode node detail (#188). */
  viewMode?: DetailMode;
  /** Entity physical constraints, for the physical-view node detail (#188). */
  constraints?: PhysicalConstraint[];
  /** Resolved element-style name on the node, for the Appearance picker (format painter). */
  styleName?: string;
  /** Whether the entity is currently hidden (system.hidden), for the hide/unhide toggle. */
  hidden?: boolean;
  sourceLabel?: string;
  targetLabel?: string;
  sourceCardinality?: string;
  targetCardinality?: string;
}

export interface CytoscapeRef {
  cy: Core | null;
}
