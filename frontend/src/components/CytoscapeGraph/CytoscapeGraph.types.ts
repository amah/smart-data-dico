import type { Core } from 'cytoscape';
import type { Attribute, Package } from '../../types';

export type GraphMode = 'service' | 'organization';

export type LayoutName = 'dagre' | 'fcose' | 'elk';

export type LayoutDirection = 'TB' | 'LR' | 'BT' | 'RL';

export interface CytoscapeGraphProps {
  service?: string;
  mode?: GraphMode;
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
