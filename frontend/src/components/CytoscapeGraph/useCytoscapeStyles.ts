import { useEffect, useMemo, useRef } from 'react';
import type { Core } from 'cytoscape';
import { createStylesheet, buildServiceColorMap } from './cytoscapeStylesheet';
import type { ElementStyle } from '../../utils/elementStyle';

export function useCytoscapeStyles(
  cyRef: React.RefObject<Core | null>,
  services: string[],
  elementStyles: ElementStyle[] = [],
) {
  const serviceColorMap = useMemo(() => buildServiceColorMap(services), [services]);
  const stylesheet = useMemo(() => createStylesheet(serviceColorMap, elementStyles), [serviceColorMap, elementStyles]);

  // Watch for theme changes and rebuild styles
  const prevThemeRef = useRef<string | null>(null);

  useEffect(() => {
    const observer = new MutationObserver(() => {
      const theme = document.documentElement.getAttribute('data-theme');
      if (theme !== prevThemeRef.current) {
        prevThemeRef.current = theme;
        const cy = cyRef.current;
        if (cy) {
          const newStyles = createStylesheet(serviceColorMap, elementStyles);
          cy.style().fromJson(newStyles).update();
        }
      }
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });

    prevThemeRef.current = document.documentElement.getAttribute('data-theme');

    return () => observer.disconnect();
  }, [cyRef, serviceColorMap, elementStyles]);

  return { stylesheet, serviceColorMap };
}
