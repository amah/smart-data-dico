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
      minZoom: 0.1,
      maxZoom: 4,
      wheelSensitivity: 0.3,
      boxSelectionEnabled: false,
    });

    cyRef.current = instance;
    setCy(instance);

    return () => {
      instance.destroy();
      cyRef.current = null;
      setCy(null);
    };
  }, [containerRef, elements, stylesheet]);

  return { cyRef, cy };
}
