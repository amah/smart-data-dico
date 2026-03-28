import { useEffect, useState, useCallback } from 'react';
import type { Core } from 'cytoscape';
import type { TooltipData, InfoPanelData } from './CytoscapeGraph.types';
import type { Attribute } from '../../types';

interface InteractionState {
  tooltip: TooltipData | null;
  infoPanel: InfoPanelData | null;
  setInfoPanel: (data: InfoPanelData | null) => void;
  applySearchFilter: (query: string) => void;
  toggleNodeExpansion: (nodeId: string) => void;
}

export function useCytoscapeInteractions(
  cyRef: React.RefObject<Core | null>,
  onNodeClick?: (service: string, entityName: string) => void,
): InteractionState {
  const [tooltip, setTooltip] = useState<TooltipData | null>(null);
  const [infoPanel, setInfoPanel] = useState<InfoPanelData | null>(null);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;

    // Node hover - tooltip
    const onMouseOver = (evt: any) => {
      const node = evt.target;
      if (node.isParent()) return;
      const pos = node.renderedPosition();
      setTooltip({
        label: node.data('label'),
        description: node.data('description') || '',
        attrCount: node.data('attrCount') || 0,
        pkCount: node.data('pkCount') || 0,
        service: node.data('service') || '',
        position: { x: pos.x, y: pos.y - 40 },
      });
    };

    const onMouseOut = () => {
      setTooltip(null);
    };

    // Node tap - navigate or show info
    const onNodeTap = (evt: any) => {
      const node = evt.target;
      if (node.isParent()) return;
      const service = node.data('service');
      const label = node.data('label');
      const attributes = node.data('attributes') as Attribute[];

      if (onNodeClick) {
        onNodeClick(service, label);
      } else {
        setInfoPanel({
          type: 'node',
          label,
          service,
          description: node.data('description'),
          attributes,
        });
      }
    };

    // Edge tap - show relationship details
    const onEdgeTap = (evt: any) => {
      const edge = evt.target;
      const sourceNode = cy.getElementById(edge.data('source'));
      const targetNode = cy.getElementById(edge.data('target'));

      setInfoPanel({
        type: 'edge',
        label: edge.data('label') || 'Relationship',
        sourceLabel: sourceNode.data('label'),
        targetLabel: targetNode.data('label'),
        sourceCardinality: edge.data('sourceCardinality'),
        targetCardinality: edge.data('targetCardinality'),
      });
    };

    // Double-tap to expand/collapse node
    const onNodeDblTap = (evt: any) => {
      const node = evt.target;
      if (node.isParent()) return;
      const nodeId = node.id();
      toggleNodeExpansionInternal(cy, nodeId);
    };

    // Clear selection on background tap
    const onBgTap = () => {
      setInfoPanel(null);
    };

    cy.on('mouseover', 'node[type = "entity"]', onMouseOver);
    cy.on('mouseout', 'node', onMouseOut);
    cy.on('tap', 'node', onNodeTap);
    cy.on('tap', 'edge', onEdgeTap);
    cy.on('dbltap', 'node[type = "entity"]', onNodeDblTap);
    cy.on('tap', onBgTap);

    return () => {
      cy.off('mouseover', 'node[type = "entity"]', onMouseOver);
      cy.off('mouseout', 'node', onMouseOut);
      cy.off('tap', 'node', onNodeTap);
      cy.off('tap', 'edge', onEdgeTap);
      cy.off('dbltap', 'node[type = "entity"]', onNodeDblTap);
      cy.off('tap', onBgTap);
    };
  }, [cyRef, onNodeClick]);

  const applySearchFilter = useCallback(
    (query: string) => {
      const cy = cyRef.current;
      if (!cy) return;

      if (!query.trim()) {
        cy.elements().removeClass('dimmed highlighted');
        return;
      }

      const q = query.toLowerCase();
      cy.batch(() => {
        cy.elements().addClass('dimmed').removeClass('highlighted');
        const matches = cy.nodes().filter(
          (n) =>
            n.data('label')?.toLowerCase().includes(q) ||
            n.data('description')?.toLowerCase().includes(q),
        );
        matches.removeClass('dimmed').addClass('highlighted');
        matches.connectedEdges().removeClass('dimmed');
        matches.neighborhood('node').removeClass('dimmed');
      });
    },
    [cyRef],
  );

  const toggleNodeExpansion = useCallback(
    (nodeId: string) => {
      const cy = cyRef.current;
      if (!cy) return;
      toggleNodeExpansionInternal(cy, nodeId);
    },
    [cyRef],
  );

  return { tooltip, infoPanel, setInfoPanel, applySearchFilter, toggleNodeExpansion };
}

function toggleNodeExpansionInternal(cy: Core, nodeId: string) {
  const node = cy.getElementById(nodeId);
  if (!node.length) return;

  const expanded = !node.data('expanded');
  node.data('expanded', expanded);

  if (expanded) {
    const attrs = (node.data('attributes') || []) as Attribute[];
    const attrLines = attrs
      .slice(0, 15) // Limit to avoid huge nodes
      .map((a) => `${a.primaryKey ? 'PK ' : ''}${a.name}: ${a.type}`)
      .join('\n');
    const suffix = attrs.length > 15 ? `\n... +${attrs.length - 15} more` : '';

    node.style({
      label: `${node.data('label')}\n${'\u2500'.repeat(20)}\n${attrLines}${suffix}`,
      height: Math.max(50, 40 + attrs.length * 16),
      width: 220,
      'text-valign': 'top',
      'font-size': 10,
    });
  } else {
    node.style({
      label: node.data('label'),
      height: 50,
      width: 180,
      'text-valign': 'center',
      'font-size': 13,
    });
  }
}
