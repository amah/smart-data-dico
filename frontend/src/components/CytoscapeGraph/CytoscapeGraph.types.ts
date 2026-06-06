import type { Core } from 'cytoscape';
import type { Attribute, Package } from '../../types';
import type { ViewMode } from './viewMode';

export type GraphMode = 'service' | 'organization';

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
  label: string;
  service?: string;
  description?: string;
  attributes?: Attribute[];
  sourceLabel?: string;
  targetLabel?: string;
  sourceCardinality?: string;
  targetCardinality?: string;
}

export interface CytoscapeRef {
  cy: Core | null;
}
