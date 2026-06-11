import { useEffect, useRef, useState } from 'react';
import cytoscape, { type Core, type ElementDefinition, type StylesheetStyle } from 'cytoscape';
// @ts-expect-error - no types for cytoscape-dagre
import dagre from 'cytoscape-dagre';
// @ts-expect-error - no types for cytoscape-fcose
import fcose from 'cytoscape-fcose';
// @ts-expect-error - no types for cytoscape-elk
import elk from 'cytoscape-elk';
// @ts-expect-error - no types for cytoscape-svg
import svg from 'cytoscape-svg';

let extensionsRegistered = false;

function registerExtensions() {
  if (extensionsRegistered) return;
  cytoscape.use(dagre);
  cytoscape.use(fcose);
  cytoscape.use(elk);
  cytoscape.use(svg);
  extensionsRegistered = true;
}

export function useCytoscapeInstance(
  containerRef: React.RefObject<HTMLDivElement | null>,
  elements: ElementDefinition[],
  stylesheet: StylesheetStyle[],
) {
  const cyRef = useRef<Core | null>(null);
  // State mirror of cyRef so consumer hooks (useCytoscapeInteractions, etc.)
  // can re-run their effects once the instance is ready.
  const [cy, setCy] = useState<Core | null>(null);

  useEffect(() => {
    registerExtensions();
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;

    // Destroy previous instance
    if (cyRef.current) {
      cyRef.current.destroy();
      cyRef.current = null;
      setCy(null);
    }

    if (elements.length === 0) return;

    const instance = cytoscape({
      container: containerRef.current,
      elements,
      style: stylesheet,
      layout: { name: 'preset' }, // We'll run layout separately
      // Floor the zoom so a large graph's fit-to-screen can't shrink nodes below
      // a readable size — with many entities they stay visible (pan to see more)
      // rather than collapsing to dots. Node box is 180×60, so 0.3 ≈ 54px min.
      minZoom: 0.3,
      maxZoom: 4,
      wheelSensitivity: 0.3,
      boxSelectionEnabled: false,
    });

    cyRef.current = instance;
    setCy(instance);
    // Dev-only handle for debugging / e2e (no effect in production builds).
    if (import.meta.env.DEV) (window as unknown as { __cy?: Core }).__cy = instance;

    return () => {
      instance.destroy();
      cyRef.current = null;
      setCy(null);
    };
  }, [containerRef, elements, stylesheet]);

  // The canvas is flex-sized (fills the main area), so the container can
  // change size after init — flex settling, sidebar collapse, description
  // expand, window resize. Cytoscape doesn't watch its container; without
  // cy.resize() the renderer keeps the stale dimensions and the graph ends
  // up mis-fitted or cut off. Re-sync and re-fit, rAF-debounced.
  useEffect(() => {
    const el = containerRef.current;
    if (!cy || !el) return;
    let raf = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        if (cy.destroyed()) return;
        cy.resize();
        if (cy.elements().length > 0) cy.fit(undefined, 40);
      });
    });
    observer.observe(el);
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, [cy, containerRef]);

  return { cyRef, cy };
}
