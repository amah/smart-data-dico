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
  cy: Core | null,
  onNodeClick?: (service: string, entityName: string) => void,
): InteractionState {
  const [tooltip, setTooltip] = useState<TooltipData | null>(null);
  const [infoPanel, setInfoPanel] = useState<InfoPanelData | null>(null);

  useEffect(() => {
    if (!cy) return;

    // Node hover - tooltip + hover class for styling
    const onMouseOver = (evt: any) => {
      const node = evt.target;
      if (node.isParent()) return;
      node.addClass('hover');
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

    const onMouseOut = (evt: any) => {
      const node = evt.target;
      if (node && node.removeClass) node.removeClass('hover');
      setTooltip(null);
    };

    // Node tap — default: navigate to entity details (if handler provided).
    // Alt/Option held: show inline info panel instead.
    // Skip entirely while edge-creation connect mode is active (the edge-creation
    // hook owns the tap in that state).
    const onNodeTap = (evt: any) => {
      const node = evt.target;
      if (node.isParent()) return;
      if (cy.nodes('.connect-source').length > 0) return;
      const service = node.data('service');
      const label = node.data('label');
      const attributes = node.data('attributes') as Attribute[];
      const oe = evt.originalEvent;
      const modifierHeld = !!(oe && (oe.altKey || oe.metaKey));

      // Synthetic nodes (e.g. physical join tables) have no backing entity /
      // service — always show the info panel rather than trying to navigate.
      if (onNodeClick && !modifierHeld && service) {
        onNodeClick(service, label);
      } else {
        setInfoPanel({
          type: 'node',
          label,
          service,
          description: node.data('description'),
          attributes,
          viewMode: node.data('viewMode'),
          constraints: node.data('constraints'),
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

    // Double-tap to expand/collapse node. Mark as user-toggled so the
    // zoom-driven LOD pass leaves it alone for the rest of the session.
    const onNodeDblTap = (evt: any) => {
      const node = evt.target;
      if (node.isParent()) return;
      const nodeId = node.id();
      node.data('userToggled', true);
      toggleNodeExpansionInternal(cy, nodeId);
    };

    // Clear selection on background tap
    const onBgTap = () => {
      setInfoPanel(null);
    };

    let zoomTimer: ReturnType<typeof setTimeout> | null = null;
    const onZoom = () => {
      if (zoomTimer) clearTimeout(zoomTimer);
      zoomTimer = setTimeout(() => {
        const z = cy.zoom();
        if (z > 1.5) {
          cy.nodes('[type = "entity"]').forEach((n) => {
            if (n.data('userToggled')) return;
            if (!n.data('expanded')) toggleNodeExpansionInternal(cy, n.id());
          });
        } else if (z < 1.0) {
          cy.nodes('[type = "entity"]').forEach((n) => {
            if (n.data('userToggled')) return;
            if (n.data('expanded')) toggleNodeExpansionInternal(cy, n.id());
          });
        }
      }, 150);
    };

    cy.on('mouseover', 'node[type = "entity"]', onMouseOver);
    cy.on('mouseout', 'node', onMouseOut);
    cy.on('tap', 'node', onNodeTap);
    cy.on('tap', 'edge', onEdgeTap);
    cy.on('dbltap', 'node[type = "entity"]', onNodeDblTap);
    cy.on('tap', onBgTap);
    cy.on('zoom', onZoom);

    return () => {
      cy.off('mouseover', 'node[type = "entity"]', onMouseOver);
      cy.off('mouseout', 'node', onMouseOut);
      cy.off('tap', 'node', onNodeTap);
      cy.off('tap', 'edge', onEdgeTap);
      cy.off('dbltap', 'node[type = "entity"]', onNodeDblTap);
      cy.off('tap', onBgTap);
      cy.off('zoom', onZoom);
      if (zoomTimer) clearTimeout(zoomTimer);
    };
  }, [cy, onNodeClick]);

  const applySearchFilter = useCallback(
    (query: string) => {
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
    [cy],
  );

  const toggleNodeExpansion = useCallback(
    (nodeId: string) => {
      if (!cy) return;
      toggleNodeExpansionInternal(cy, nodeId);
    },
    [cy],
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
      height: Math.max(60, 40 + attrs.length * 16),
      width: 240,
      'text-valign': 'top',
      'font-size': 10,
    });
  } else {
    // Clear inline overrides so the base stylesheet (displayLabel, default size) reapplies
    node.removeStyle('label height width text-valign font-size');
  }
}
