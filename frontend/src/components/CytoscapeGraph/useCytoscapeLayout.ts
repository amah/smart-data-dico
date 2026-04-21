import { useCallback } from 'react';
import type { Core } from 'cytoscape';
import type { LayoutName, LayoutDirection } from './CytoscapeGraph.types';

export function useCytoscapeLayout(cyRef: React.RefObject<Core | null>) {
  const runLayout = useCallback(
    (name: LayoutName = 'dagre', direction: LayoutDirection = 'TB') => {
      const cy = cyRef.current;
      if (!cy || cy.nodes().length === 0) return;

      let layoutOptions: any;

      if (name === 'dagre') {
        layoutOptions = {
          name: 'dagre',
          rankDir: direction,
          nodeSep: 60,
          rankSep: 80,
          edgeSep: 30,
          padding: 40,
          animate: true,
          animationDuration: 300,
        };
      } else if (name === 'elk') {
        // ELK 'layered' algorithm: orthogonal routing, structured hierarchical layout
        const elkDirection =
          direction === 'LR' ? 'RIGHT'
          : direction === 'RL' ? 'LEFT'
          : direction === 'BT' ? 'UP'
          : 'DOWN';
        layoutOptions = {
          name: 'elk',
          animate: true,
          animationDuration: 300,
          nodeDimensionsIncludeLabels: true,
          padding: 40,
          elk: {
            algorithm: 'layered',
            'elk.direction': elkDirection,
            'elk.spacing.nodeNode': 40,
            'elk.layered.spacing.nodeNodeBetweenLayers': 80,
            'elk.edgeRouting': 'ORTHOGONAL',
          },
        };
      } else {
        // fcose
        layoutOptions = {
          name: 'fcose',
          animate: true,
          animationDuration: 300,
          nodeDimensionsIncludeLabels: true,
          idealEdgeLength: 150,
          nodeRepulsion: 8000,
          padding: 40,
        };
      }

      cy.layout(layoutOptions).run();
    },
    [cyRef],
  );

  return { runLayout };
}
