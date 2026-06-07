import { useEffect, useState, useCallback, useRef } from 'react';
import type { Core } from 'cytoscape';
import type { TooltipData, InfoPanelData } from './CytoscapeGraph.types';
import type { Attribute } from '../../types';

interface InteractionState {
  tooltip: TooltipData | null;
  infoPanel: InfoPanelData | null;
  setInfoPanel: (data: InfoPanelData | null) => void;
  applySearchFilter: (query: string) => void;
  /** Id of the currently focused node, or null. */
  focusedId: string | null;
  /** Focus an entity: zoom to its neighbourhood, detail it, dim the rest. */
  enterFocus: (nodeId: string) => void;
  /** Leave focus mode and restore the full graph. */
  exitFocus: () => void;
}

/** Compact key-facts subtitle shown under a neighbour in focus mode. */
export function focusSubtitle(pkCount: number, attrCount: number): string {
  const pk = pkCount > 0 ? 'PK · ' : '';
  return `${pk}${attrCount} attr${attrCount === 1 ? '' : 's'}`;
}

export function useCytoscapeInteractions(cy: Core | null): InteractionState {
  const [tooltip, setTooltip] = useState<TooltipData | null>(null);
  const [infoPanel, setInfoPanel] = useState<InfoPanelData | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  // Mirror the focus id in a ref so event handlers / callbacks read the latest
  // value without re-binding.
  const focusedIdRef = useRef<string | null>(null);

  const exitFocus = useCallback(() => {
    if (!cy || !focusedIdRef.current) return;
    cy.batch(() => {
      cy.elements().removeClass('focus-dim focus-root focus-neighbor');
      // Clear the neighbour key-facts subtitle overrides.
      cy.nodes().forEach((n) => { n.removeStyle('label font-size width height text-valign'); });
    });
    cy.animate({ fit: { eles: cy.elements(), padding: 40 } }, { duration: 350 });
    focusedIdRef.current = null;
    setFocusedId(null);
    setInfoPanel(null);
  }, [cy]);

  const enterFocus = useCallback(
    (nodeId: string) => {
      if (!cy) return;
      const node = cy.getElementById(nodeId);
      if (!node || node.length === 0 || node.isParent?.()) return;

      const hood = node.closedNeighborhood(); // node + neighbours + connecting edges

      cy.batch(() => {
        // Reset any prior focus styling first (switching focus between nodes).
        cy.elements().removeClass('focus-dim focus-root focus-neighbor');
        cy.nodes().forEach((n) => { n.removeStyle('label font-size width height text-valign'); });
        // Clear selection so the :selected highlight doesn't fight focus styling.
        cy.elements().unselect();

        cy.elements().addClass('focus-dim');
        hood.removeClass('focus-dim');

        node.addClass('focus-root');
        // Keep the focused node's name visible (compact) — its full detail is in
        // the info panel.
        node.style({ label: (node.data('displayLabel') as string) || (node.data('label') as string) || '' });
        hood.nodes().not(node).addClass('focus-neighbor');

        // Direct neighbours → compact name + key-facts subtitle.
        hood.nodes().not(node).forEach((n) => {
          if (n.isParent?.()) return;
          const header = (n.data('displayLabel') as string) || (n.data('label') as string) || '';
          const subtitle = focusSubtitle(n.data('pkCount') || 0, n.data('attrCount') || 0);
          n.style({ label: `${header}\n${subtitle}`, 'font-size': 11 });
        });
      });

      // Animate the camera to the neighbourhood (outside the batch).
      cy.animate({ fit: { eles: hood, padding: 80 } }, { duration: 400 });

      // Focused entity → full detail in the info panel (clean, per-mode #188).
      setTooltip(null); // drop any lingering hover tooltip
      setInfoPanel(nodePanelData(node));
      focusedIdRef.current = nodeId;
      setFocusedId(nodeId);
    },
    [cy],
  );

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

    // Single tap → open the side panel (details). Double tap → focus.
    // Navigation to the entity page is via the panel's "View Entity Details".
    // Skip while edge-creation connect mode is active (that hook owns the tap).
    const onNodeTap = (evt: any) => {
      const node = evt.target;
      if (node.isParent()) return;
      if (cy.nodes('.connect-source').length > 0) return;
      setInfoPanel(nodePanelData(node));
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

    // Double-tap an entity → focus on it (zoom to its neighbourhood, detail it,
    // dim the rest). Cancels the pending single-tap navigation. Replaces the old
    // zoom-driven attribute expansion.
    const onNodeDblTap = (evt: any) => {
      const node = evt.target;
      if (node.isParent()) return;
      enterFocus(node.id());
    };

    // Background tap clears the info panel and leaves focus mode.
    const onBgTap = (evt: any) => {
      if (evt.target !== cy) return; // ignore taps that hit an element
      setInfoPanel(null);
      exitFocus();
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
  }, [cy, enterFocus, exitFocus]);

  // Esc leaves focus mode.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') exitFocus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [exitFocus]);

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

  return { tooltip, infoPanel, setInfoPanel, applySearchFilter, focusedId, enterFocus, exitFocus };
}

/** Build the info-panel payload for a node (shared by tap + focus). */
function nodePanelData(node: any): InfoPanelData {
  return {
    type: 'node',
    id: node.id(),
    label: node.data('label'),
    service: node.data('service'),
    description: node.data('description'),
    attributes: node.data('attributes') as Attribute[],
    viewMode: node.data('viewMode'),
    constraints: node.data('constraints'),
  };
}
