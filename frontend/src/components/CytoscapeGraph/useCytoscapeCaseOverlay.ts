import { useEffect, useState } from 'react';
import type { Core } from 'cytoscape';
import { useService } from '../../kernel/useService';
import { CASE_SERVICE_TOKEN } from '../../kernel/tokens';
import type { CaseService } from '../../plugins/data-dictionary/services/CaseService';
import type { ResolvedCase } from '../../types';

export function useCytoscapeCaseOverlay(
  cyRef: React.RefObject<Core | null>,
  caseId?: string,
) {
  const caseService = useService<CaseService>(CASE_SERVICE_TOKEN);
  const [resolved, setResolved] = useState<ResolvedCase | null>(null);

  useEffect(() => {
    if (!caseId) {
      setResolved(null);
      // Clear overlay classes
      const cy = cyRef.current;
      if (cy) {
        cy.elements().removeClass('case-root case-member case-frontier dimmed');
      }
      return;
    }

    caseService.resolve(caseId).then(setResolved).catch(() => setResolved(null));
  }, [caseId, caseService]);

  // Apply overlay when resolved data or cy changes
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy || !resolved) return;

    const entityUuids = new Set(resolved.resolvedNodes.map((n) => n.entityUuid));
    const rootUuids = new Set(resolved.resolvedNodes.filter((n) => n.isRoot).map((n) => n.entityUuid));
    const frontierUuids = new Set(resolved.resolvedNodes.filter((n) => n.isFrontier).map((n) => n.entityUuid));

    cy.batch(() => {
      // Reset all
      cy.elements().removeClass('case-root case-member case-frontier dimmed');

      // Dim everything first
      cy.nodes().addClass('dimmed');
      cy.edges().addClass('dimmed');

      // Highlight case members
      cy.nodes().forEach((node) => {
        const nodeId = node.id();
        if (!entityUuids.has(nodeId)) return;

        node.removeClass('dimmed');

        if (rootUuids.has(nodeId)) {
          node.addClass('case-root');
        } else if (frontierUuids.has(nodeId)) {
          node.addClass('case-frontier');
        } else {
          node.addClass('case-member');
        }
      });

      // Un-dim edges between case members
      cy.edges().forEach((edge) => {
        if (entityUuids.has(edge.source().id()) && entityUuids.has(edge.target().id())) {
          edge.removeClass('dimmed');
        }
      });
    });
  }, [resolved, cyRef.current?.elements().length]);

  return { resolved };
}
