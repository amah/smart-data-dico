import { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import type { ElementDefinition } from 'cytoscape';
import type { CytoscapeGraphProps, LayoutName, LayoutDirection } from './CytoscapeGraph.types';
import { useFetchGraphData } from '../../hooks/useFetchGraphData';
import { mapGraphDataToCytoscape } from './mapGraphDataToCytoscape';
import { mapPackagesToCompoundNodes } from './mapPackagesToCompoundNodes';
import { useCytoscapeInstance } from './useCytoscapeInstance';
import { useCytoscapeLayout } from './useCytoscapeLayout';
import { useCytoscapeStyles } from './useCytoscapeStyles';
import { useCytoscapeInteractions } from './useCytoscapeInteractions';
import { useCytoscapePersistence } from './useCytoscapePersistence';
import { useCytoscapePerspectiveOverlay } from './useCytoscapePerspectiveOverlay';
import CytoscapeToolbar from './CytoscapeToolbar';
import CytoscapeTooltip from './CytoscapeTooltip';
import CytoscapeInfoPanel from './CytoscapeInfoPanel';

export default function CytoscapeGraph({
  service: serviceProp,
  mode = 'service',
  packages,
  initialLayoutId,
  perspectiveId,
}: CytoscapeGraphProps) {
  const params = useParams<{ service?: string; entity?: string }>();
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement>(null);

  const service = serviceProp || params.service;
  const entity = params.entity;

  // State
  const [layoutName, setLayoutName] = useState<LayoutName>('dagre');
  const [layoutDirection, setLayoutDirection] = useState<LayoutDirection>('TB');
  const [layoutRan, setLayoutRan] = useState(false);

  // Fetch data
  const { nodes, edges, loading, error, services } = useFetchGraphData(service, entity);

  // Build Cytoscape elements
  const elements = useMemo<ElementDefinition[]>(() => {
    if (nodes.length === 0) return [];

    let parentMapping: Record<string, string> | undefined;
    let compoundNodes: ElementDefinition[] = [];

    if (mode === 'organization' && packages && packages.length > 0) {
      const result = mapPackagesToCompoundNodes(packages);
      parentMapping = result.parentMapping;
      compoundNodes = result.compoundNodes;
    }

    const entityElements = mapGraphDataToCytoscape(nodes, edges, parentMapping);
    return [...compoundNodes, ...entityElements];
  }, [nodes, edges, mode, packages]);

  // Styles (theme-aware)
  const { stylesheet } = useCytoscapeStyles(
    { current: null } as any, // Will be set after instance creation
    services,
  );

  // Create Cytoscape instance
  const cyRef = useCytoscapeInstance(containerRef, elements, stylesheet);

  // Re-apply styles when cyRef changes (for theme sync)
  useCytoscapeStyles(cyRef, services);

  // Layout
  const { runLayout } = useCytoscapeLayout(cyRef);

  // Persistence
  const persistence = useCytoscapePersistence(cyRef);

  // Load layouts list when service changes
  useEffect(() => {
    persistence.loadLayouts(service);
  }, [service]); // eslint-disable-line react-hooks/exhaustive-deps

  // Navigation callback for node clicks
  const handleNodeClick = useCallback(
    (svc: string, entityName: string) => {
      navigate(`/packages/${svc}/entities/${entityName}`);
    },
    [navigate],
  );

  // Interactions
  const { tooltip, infoPanel, setInfoPanel, applySearchFilter } =
    useCytoscapeInteractions(cyRef);

  // Perspective overlay
  useCytoscapePerspectiveOverlay(cyRef, perspectiveId);

  // Run layout after elements load (once)
  useEffect(() => {
    if (elements.length > 0 && cyRef.current && !layoutRan) {
      if (initialLayoutId) {
        persistence.loadLayout(initialLayoutId);
      } else {
        // Small delay to ensure cy has rendered
        const timer = setTimeout(() => {
          runLayout(layoutName, layoutDirection);
        }, 100);
        return () => clearTimeout(timer);
      }
      setLayoutRan(true);
    }
  }, [elements, cyRef.current]); // eslint-disable-line react-hooks/exhaustive-deps

  // Handle layout changes
  const handleLayoutChange = useCallback(
    (name: LayoutName) => {
      setLayoutName(name);
      runLayout(name, layoutDirection);
    },
    [runLayout, layoutDirection],
  );

  const handleDirectionChange = useCallback(
    (dir: LayoutDirection) => {
      setLayoutDirection(dir);
      runLayout(layoutName, dir);
    },
    [runLayout, layoutName],
  );

  const handleRunLayout = useCallback(() => {
    runLayout(layoutName, layoutDirection);
  }, [runLayout, layoutName, layoutDirection]);

  const handleSaveLayout = useCallback(
    (name: string) => {
      persistence.saveLayout(name, service);
    },
    [persistence, service],
  );

  if (error) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="alert alert-error max-w-md">
          <span>Failed to load graph: {error}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <CytoscapeToolbar
        cyRef={cyRef}
        layoutName={layoutName}
        layoutDirection={layoutDirection}
        onLayoutChange={handleLayoutChange}
        onDirectionChange={handleDirectionChange}
        onRunLayout={handleRunLayout}
        onSearch={applySearchFilter}
        layouts={persistence.layouts}
        onSaveLayout={handleSaveLayout}
        onLoadLayout={persistence.loadLayout}
        onDeleteLayout={persistence.deleteLayout}
      />

      <div className="relative flex-1 min-h-0">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-base-100/50 z-30">
            <span className="loading loading-spinner loading-lg" />
          </div>
        )}

        {!loading && elements.length === 0 && (
          <div className="flex items-center justify-center h-full text-base-content/50">
            No entities to display
          </div>
        )}

        {/* Cytoscape container */}
        <div ref={containerRef} className="w-full h-full" />

        {/* Tooltip overlay */}
        {tooltip && <CytoscapeTooltip data={tooltip} />}

        {/* Info panel */}
        {infoPanel && (
          <CytoscapeInfoPanel
            data={infoPanel}
            onClose={() => setInfoPanel(null)}
            onNavigate={handleNodeClick}
          />
        )}
      </div>
    </div>
  );
}
