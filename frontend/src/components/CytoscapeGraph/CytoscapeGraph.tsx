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
import { useCytoscapeCaseOverlay } from './useCytoscapeCaseOverlay';
import CytoscapeToolbar from './CytoscapeToolbar';
import CytoscapeTooltip from './CytoscapeTooltip';
import CytoscapeInfoPanel from './CytoscapeInfoPanel';
import CytoscapeLegend from './CytoscapeLegend';
import { useCytoscapeEdgeCreation } from './useCytoscapeEdgeCreation';
import CreateRelationshipModal from './CreateRelationshipModal';
import { useCytoscapeEntityCreation } from './useCytoscapeEntityCreation';
import CreateEntityModal from './CreateEntityModal';

export default function CytoscapeGraph({
  service: serviceProp,
  mode = 'service',
  packages,
  initialLayoutId,
  caseId,
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
  const { stylesheet, serviceColorMap } = useCytoscapeStyles(
    { current: null } as any, // Will be set after instance creation
    services,
  );

  // Create Cytoscape instance
  const { cyRef, cy } = useCytoscapeInstance(containerRef, elements, stylesheet);

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

  // Interactions — default tap navigates; Alt/Option click opens info panel.
  // Pass `cy` (state) so the hook re-runs when the instance is created.
  const { tooltip, infoPanel, setInfoPanel, applySearchFilter } =
    useCytoscapeInteractions(cy, handleNodeClick);

  // Case overlay (renamed from perspective in #121)
  useCytoscapeCaseOverlay(cyRef, caseId);

  // Edge creation (right-click → connect)
  const edgeCreation = useCytoscapeEdgeCreation(cyRef);

  // Entity creation (background right-click or toolbar "+")
  const packageOptions = useMemo(() => {
    const set = new Set<string>(services);
    if (service) set.add(service);
    return Array.from(set).sort();
  }, [services, service]);
  const entityCreation = useCytoscapeEntityCreation(cyRef, {
    packageOptions,
    defaultPackage: service || packageOptions[0] || '',
  });

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
        exportFilenameBase={service}
        onAddEntity={packageOptions.length > 0 ? () => entityCreation.startCreate(service || packageOptions[0]) : undefined}
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
        <div ref={containerRef} className="w-full h-full" style={{ cursor: 'pointer' }} />

        {/* Legend overlay */}
        {elements.length > 0 && (
          <CytoscapeLegend
            serviceColorMap={serviceColorMap}
            showCaseStates={!!caseId}
          />
        )}

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

        {/* Context menu */}
        {edgeCreation.contextMenu && (
          <div
            className="fixed z-50 bg-base-100 border border-base-300 rounded-lg shadow-lg py-1 min-w-[160px]"
            style={{ left: edgeCreation.contextMenu.x, top: edgeCreation.contextMenu.y }}
          >
            <button
              className="w-full text-left px-4 py-2 hover:bg-base-200 text-sm"
              onClick={edgeCreation.startConnect}
            >
              Connect to...
            </button>
            <button
              className="w-full text-left px-4 py-2 hover:bg-base-200 text-sm"
              onClick={() => {
                handleNodeClick(
                  edgeCreation.contextMenu!.nodeService,
                  edgeCreation.contextMenu!.nodeLabel,
                );
                edgeCreation.closeContextMenu();
              }}
            >
              Open entity
            </button>
            <button
              className="w-full text-left px-4 py-2 hover:bg-base-200 text-sm text-base-content/50"
              onClick={edgeCreation.closeContextMenu}
            >
              Cancel
            </button>
          </div>
        )}

        {/* Connect mode banner */}
        {edgeCreation.connecting && edgeCreation.sourceNode && (
          <div className="absolute top-2 left-1/2 -translate-x-1/2 z-40 bg-primary text-primary-content px-4 py-2 rounded-lg shadow-lg flex items-center gap-3 text-sm">
            <span>Click a target entity to connect from <strong>{edgeCreation.sourceNode.label}</strong></span>
            <button className="btn btn-xs btn-ghost" onClick={edgeCreation.cancelConnect}>Cancel</button>
          </div>
        )}
      </div>

      {/* Relationship creation modal */}
      {edgeCreation.pendingEdge && (
        <CreateRelationshipModal
          sourceLabel={edgeCreation.pendingEdge.sourceLabel}
          targetLabel={edgeCreation.pendingEdge.targetLabel}
          onConfirm={edgeCreation.confirmEdge}
          onCancel={edgeCreation.cancelEdge}
        />
      )}

      {/* Entity creation modal */}
      {entityCreation.pending && (
        <CreateEntityModal
          packageOptions={entityCreation.pending.packageOptions}
          defaultPackage={entityCreation.pending.defaultPackage}
          onConfirm={entityCreation.confirmCreate}
          onCancel={entityCreation.cancelCreate}
        />
      )}
    </div>
  );
}
