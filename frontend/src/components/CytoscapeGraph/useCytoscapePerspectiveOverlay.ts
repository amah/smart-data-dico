import { useEffect, useState } from 'react';
import type { Core } from 'cytoscape';
import { perspectiveApi } from '../../services/api';
import type { ResolvedPerspective } from '../../types';

export function useCytoscapePerspectiveOverlay(
  cyRef: React.RefObject<Core | null>,
  perspectiveId?: string,
) {
  const [resolved, setResolved] = useState<ResolvedPerspective | null>(null);

  useEffect(() => {
    if (!perspectiveId) {
      setResolved(null);
      // Clear overlay classes
      const cy = cyRef.current;
      if (cy) {
        cy.elements().removeClass('perspective-root perspective-member perspective-frontier dimmed');
      }
      return;
    }

    perspectiveApi.resolve(perspectiveId).then(setResolved).catch(() => setResolved(null));
  }, [perspectiveId]);

  // Apply overlay when resolved data or cy changes
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy || !resolved) return;

    const entityUuids = new Set(resolved.resolvedNodes.map((n) => n.entityUuid));
    const rootUuids = new Set(resolved.resolvedNodes.filter((n) => n.isRoot).map((n) => n.entityUuid));
    const frontierUuids = new Set(resolved.resolvedNodes.filter((n) => n.isFrontier).map((n) => n.entityUuid));

    cy.batch(() => {
      // Reset all
      cy.elements().removeClass('perspective-root perspective-member perspective-frontier dimmed');

      // Dim everything first
      cy.nodes().addClass('dimmed');
      cy.edges().addClass('dimmed');

      // Highlight perspective members
      cy.nodes().forEach((node) => {
        const nodeId = node.id();
        if (!entityUuids.has(nodeId)) return;

        node.removeClass('dimmed');

        if (rootUuids.has(nodeId)) {
          node.addClass('perspective-root');
        } else if (frontierUuids.has(nodeId)) {
          node.addClass('perspective-frontier');
        } else {
          node.addClass('perspective-member');
        }
      });

      // Un-dim edges between perspective members
      cy.edges().forEach((edge) => {
        if (entityUuids.has(edge.source().id()) && entityUuids.has(edge.target().id())) {
          edge.removeClass('dimmed');
        }
      });
    });
  }, [resolved, cyRef.current?.elements().length]);

  return { resolved };
}
