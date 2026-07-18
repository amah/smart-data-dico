import type { Core } from 'cytoscape';

/**
 * Re-synchronise Cytoscape with its container before fitting all elements.
 * This makes recovery reliable after the canvas has resized or been panned
 * completely away from the model.
 */
export function recenterDiagram(cy: Core | null, padding = 40): void {
  if (!cy || cy.destroyed()) return;
  cy.resize();
  if (cy.elements().length > 0) cy.fit(undefined, padding);
}
