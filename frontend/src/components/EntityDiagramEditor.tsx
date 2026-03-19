import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Entity, Relationship, Cardinality, DiagramLayout } from '../types';
import { diagramApi, relationshipApi } from '../services/api';

interface Position {
  x: number;
  y: number;
}

interface EntityNode extends Entity {
  position: Position;
  showProperties: boolean;
}

interface Connection {
  id: string;
  source: string;
  target: string;
  relationship: Relationship;
  sourcePoint: Position;
  targetPoint: Position;
}

interface EntityDiagramEditorProps {
  entities: Entity[];
  relationships?: Relationship[];
  onEntityUpdate?: (entity: Entity) => void;
  onEntityCreate?: (entity: Partial<Entity>) => void;
  onEntityDelete?: (entityId: string) => void;
  onRelationshipCreated?: (relationship: Relationship) => void;
  readOnly?: boolean;
  serviceName?: string;
  initialLayoutId?: string | null;
}

const EntityDiagramEditor: React.FC<EntityDiagramEditorProps> = ({
  entities,
  relationships = [],
  onEntityUpdate,
  onEntityCreate,
  onEntityDelete,
  onRelationshipCreated,
  readOnly = false,
  serviceName,
  initialLayoutId
}) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const [entityNodes, setEntityNodes] = useState<EntityNode[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [selectedEntity, setSelectedEntity] = useState<string | null>(null);
  const [draggedEntity, setDraggedEntity] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState<Position>({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<Position>({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [lastPanPoint, setLastPanPoint] = useState<Position>({ x: 0, y: 0 });
  const [savedLayouts, setSavedLayouts] = useState<DiagramLayout[]>([]);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [showLoadDialog, setShowLoadDialog] = useState(false);
  const [saveLayoutName, setSaveLayoutName] = useState('');
  const [selectedLayoutId, setSelectedLayoutId] = useState<string>('');

  // Relationship creation state
  const [connectMode, setConnectMode] = useState(false);
  const [relationshipSource, setRelationshipSource] = useState<string | null>(null);
  const [relationshipTarget, setRelationshipTarget] = useState<string | null>(null);
  const [showRelationshipDialog, setShowRelationshipDialog] = useState(false);
  const [sourceCardinality, setSourceCardinality] = useState<Cardinality>(Cardinality.ONE);
  const [targetCardinality, setTargetCardinality] = useState<Cardinality>(Cardinality.MANY);
  const [relationshipDescription, setRelationshipDescription] = useState('');

  // Initialize entity nodes with positions
  useEffect(() => {
    const nodes: EntityNode[] = entities.map((entity, index) => ({
      ...entity,
      position: {
        x: 100 + (index % 4) * 300,
        y: 100 + Math.floor(index / 4) * 200
      },
      showProperties: false // Properties hidden by default
    }));
    setEntityNodes(nodes);
  }, [entities]);

  // Generate connections from package-level relationships
  useEffect(() => {
    const newConnections: Connection[] = [];

    relationships.forEach(rel => {
      const sourceNode = entityNodes.find(node => node.uuid === rel.source.entity);
      const targetNode = entityNodes.find(node => node.uuid === rel.target.entity);

      if (sourceNode && targetNode) {
        const sourcePoint = {
          x: sourceNode.position.x + 150,
          y: sourceNode.position.y + 40
        };
        const targetPoint = {
          x: targetNode.position.x,
          y: targetNode.position.y + 40
        };

        newConnections.push({
          id: `${sourceNode.uuid}-${targetNode.uuid}-${rel.uuid}`,
          source: sourceNode.uuid,
          target: targetNode.uuid,
          relationship: rel,
          sourcePoint,
          targetPoint
        });
      }
    });

    setConnections(newConnections);
  }, [entityNodes, relationships]);

  const handleEntityMouseDown = useCallback((entityId: string, event: React.MouseEvent) => {
    if (readOnly) return;

    // If in connect mode, handle relationship selection
    if (connectMode) {
      event.preventDefault();
      event.stopPropagation();
      if (!relationshipSource) {
        setRelationshipSource(entityId);
        setSelectedEntity(entityId);
      } else if (relationshipSource && entityId !== relationshipSource) {
        setRelationshipTarget(entityId);
        setSelectedEntity(entityId);
        setShowRelationshipDialog(true);
      }
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const entity = entityNodes.find(e => e.uuid === entityId);
    if (!entity) return;

    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;

    const mouseX = (event.clientX - rect.left - pan.x) / zoom;
    const mouseY = (event.clientY - rect.top - pan.y) / zoom;

    setDraggedEntity(entityId);
    setDragOffset({
      x: mouseX - entity.position.x,
      y: mouseY - entity.position.y
    });
    setSelectedEntity(entityId);
  }, [entityNodes, pan, zoom, readOnly, connectMode, relationshipSource]);

  const handleMouseMove = useCallback((event: React.MouseEvent) => {
    if (!svgRef.current) return;

    const rect = svgRef.current.getBoundingClientRect();
    const mouseX = (event.clientX - rect.left - pan.x) / zoom;
    const mouseY = (event.clientY - rect.top - pan.y) / zoom;

    if (draggedEntity) {
      setEntityNodes(prev => prev.map(entity =>
        entity.uuid === draggedEntity
          ? {
              ...entity,
              position: {
                x: mouseX - dragOffset.x,
                y: mouseY - dragOffset.y
              }
            }
          : entity
      ));
    } else if (isPanning) {
      setPan({
        x: event.clientX - lastPanPoint.x,
        y: event.clientY - lastPanPoint.y
      });
    }
  }, [draggedEntity, dragOffset, isPanning, lastPanPoint, pan, zoom]);

  const handleMouseUp = useCallback(() => {
    setDraggedEntity(null);
    setIsPanning(false);
  }, []);

  const handleSvgMouseDown = useCallback((event: React.MouseEvent) => {
    if (event.target === svgRef.current) {
      setSelectedEntity(null);
      setIsPanning(true);
      setLastPanPoint({ x: event.clientX - pan.x, y: event.clientY - pan.y });
    }
  }, [pan]);

  const toggleEntityProperties = useCallback((entityId: string) => {
    setEntityNodes(prev => prev.map(entity =>
      entity.uuid === entityId
        ? { ...entity, showProperties: !entity.showProperties }
        : entity
    ));
  }, []);

  const handleZoomIn = () => setZoom(prev => Math.min(prev * 1.2, 3));
  const handleZoomOut = () => setZoom(prev => Math.max(prev / 1.2, 0.3));
  const handleResetView = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  // Load saved layouts on component mount
  useEffect(() => {
    const loadSavedLayouts = async () => {
      try {
        const response = await diagramApi.listDiagramLayouts(serviceName);
        setSavedLayouts(response.data || []);
      } catch (error) {
        console.error('Error loading saved layouts:', error);
      }
    };

    loadSavedLayouts();
  }, [serviceName]);

  // Auto-load initial layout if provided
  useEffect(() => {
    const loadInitialLayout = async () => {
      if (initialLayoutId && entityNodes.length > 0) {
        try {
          const response = await diagramApi.loadDiagramLayout(initialLayoutId);
          const layout = response.data;

          // Apply layout to entities
          setEntityNodes(prev => prev.map(node => {
            const savedPosition = layout.entities[node.uuid];
            if (savedPosition) {
              return {
                ...node,
                position: { x: savedPosition.x, y: savedPosition.y },
                showProperties: savedPosition.showProperties
              };
            }
            return node;
          }));

          // Apply zoom and pan
          setZoom(layout.zoom);
          setPan(layout.pan);
        } catch (error) {
          console.error('Error loading initial layout:', error);
        }
      }
    };

    loadInitialLayout();
  }, [initialLayoutId, entityNodes.length]);

  const handleSaveLayout = async () => {
    if (!saveLayoutName.trim()) return;

    try {
      const layoutData: Omit<DiagramLayout, 'createdAt' | 'updatedAt'> = {
        id: `${serviceName || 'all'}-${Date.now()}`,
        name: saveLayoutName,
        service: serviceName,
        entities: entityNodes.reduce((acc, node) => {
          acc[node.uuid] = {
            x: node.position.x,
            y: node.position.y,
            showProperties: node.showProperties,
            name: node.name
          };
          return acc;
        }, {} as DiagramLayout['entities']),
        zoom,
        pan
      };

      const response = await diagramApi.saveDiagramLayout(layoutData);
      setSavedLayouts(prev => [response.data, ...prev]);
      setSaveLayoutName('');
      setShowSaveDialog(false);

      // Emit event to refresh sidebar
      window.dispatchEvent(new CustomEvent('diagramSaved'));
    } catch (error) {
      console.error('Error saving layout:', error);
      alert('Failed to save layout. Please try again.');
    }
  };

  const handleLoadLayout = async () => {
    if (!selectedLayoutId) return;

    try {
      const response = await diagramApi.loadDiagramLayout(selectedLayoutId);
      const layout = response.data;

      // Apply layout to entities
      setEntityNodes(prev => prev.map(node => {
        const savedPosition = layout.entities[node.uuid];
        if (savedPosition) {
          return {
            ...node,
            position: { x: savedPosition.x, y: savedPosition.y },
            showProperties: savedPosition.showProperties
          };
        }
        return node;
      }));

      // Apply zoom and pan
      setZoom(layout.zoom);
      setPan(layout.pan);

      setShowLoadDialog(false);
      setSelectedLayoutId('');
    } catch (error) {
      console.error('Error loading layout:', error);
      alert('Failed to load layout. Please try again.');
    }
  };

  const handleDeleteLayout = async (layoutId: string) => {
    if (!confirm('Are you sure you want to delete this layout?')) return;

    try {
      await diagramApi.deleteDiagramLayout(layoutId);
      setSavedLayouts(prev => prev.filter(layout => layout.id !== layoutId));

      // Emit event to refresh sidebar
      window.dispatchEvent(new CustomEvent('diagramDeleted'));
    } catch (error) {
      console.error('Error deleting layout:', error);
      alert('Failed to delete layout. Please try again.');
    }
  };

  const getRelationshipPath = (connection: Connection): string => {
    const { sourcePoint, targetPoint } = connection;
    const dx = targetPoint.x - sourcePoint.x;
    const dy = targetPoint.y - sourcePoint.y;

    // Create curved path for better visualization
    const midX = sourcePoint.x + dx / 2;
    const midY = sourcePoint.y + dy / 2;
    const controlOffset = Math.min(Math.abs(dx), Math.abs(dy)) * 0.3;

    return `M ${sourcePoint.x} ${sourcePoint.y} Q ${midX} ${midY - controlOffset} ${targetPoint.x} ${targetPoint.y}`;
  };

  const getCardinalityMarker = (cardinality: Cardinality): string => {
    switch (cardinality) {
      case Cardinality.ONE:
        return 'url(#arrow-one)';
      case Cardinality.MANY:
        return 'url(#arrow-many)';
      default:
        return 'url(#arrow-default)';
    }
  };

  const getCardinalityLabel = (cardinality: Cardinality): string => {
    switch (cardinality) {
      case Cardinality.ONE:
        return '1';
      case Cardinality.MANY:
        return '*';
      default:
        return '';
    }
  };

  const handleCreateRelationship = async () => {
    if (!relationshipSource || !relationshipTarget || !serviceName) return;

    const sourceEntity = entityNodes.find(e => e.uuid === relationshipSource);
    const targetEntity = entityNodes.find(e => e.uuid === relationshipTarget);
    if (!sourceEntity || !targetEntity) return;

    const newRelationship: Relationship = {
      uuid: crypto.randomUUID(),
      description: relationshipDescription || undefined,
      source: {
        entity: relationshipSource,
        cardinality: sourceCardinality,
      },
      target: {
        entity: relationshipTarget,
        cardinality: targetCardinality,
      },
    };

    try {
      const response = await relationshipApi.createRelationship(serviceName, newRelationship);
      onRelationshipCreated?.(response.data);
    } catch (error) {
      console.error('Error creating relationship:', error);
      alert('Failed to create relationship. Please try again.');
    }

    // Reset connect mode and dialog
    setShowRelationshipDialog(false);
    setConnectMode(false);
    setRelationshipSource(null);
    setRelationshipTarget(null);
    setRelationshipDescription('');
    setSourceCardinality(Cardinality.ONE);
    setTargetCardinality(Cardinality.MANY);
    setSelectedEntity(null);
  };

  return (
    <div className="w-full h-full bg-base-100 relative overflow-hidden">
      {/* Toolbar */}
      <div className="absolute top-4 left-4 z-10 flex gap-2">
        <div className="btn-group">
          <button className="btn btn-sm" onClick={handleZoomOut} title="Zoom Out">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
            </svg>
          </button>
          <button className="btn btn-sm" onClick={handleResetView} title="Reset View">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
          <button className="btn btn-sm" onClick={handleZoomIn} title="Zoom In">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
            </svg>
          </button>
          <button
            className="btn btn-sm btn-outline"
            onClick={() => {
              // Simple grid auto-layout
              setEntityNodes(prev => {
                const spacingX = 340;
                const spacingY = 180;
                const cols = Math.max(1, Math.ceil(Math.sqrt(prev.length)));
                return prev.map((entity, idx) => ({
                  ...entity,
                  position: {
                    x: 100 + (idx % cols) * spacingX,
                    y: 100 + Math.floor(idx / cols) * spacingY,
                  },
                }));
              });
            }}
            title="Auto Layout"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <rect x="3" y="3" width="7" height="7" stroke="currentColor" strokeWidth="2" fill="none"/>
              <rect x="14" y="3" width="7" height="7" stroke="currentColor" strokeWidth="2" fill="none"/>
              <rect x="3" y="14" width="7" height="7" stroke="currentColor" strokeWidth="2" fill="none"/>
              <rect x="14" y="14" width="7" height="7" stroke="currentColor" strokeWidth="2" fill="none"/>
            </svg>
            Auto Layout
          </button>
        </div>

        <div className="badge badge-info">
          Zoom: {Math.round(zoom * 100)}%
        </div>

        {!readOnly && (
          <div className="btn-group">
            <button
              className={`btn btn-sm ${connectMode ? 'btn-accent' : 'btn-outline'}`}
              onClick={() => {
                if (connectMode) {
                  setConnectMode(false);
                  setRelationshipSource(null);
                  setRelationshipTarget(null);
                  setSelectedEntity(null);
                } else {
                  setConnectMode(true);
                  setRelationshipSource(null);
                  setRelationshipTarget(null);
                  setSelectedEntity(null);
                }
              }}
              title="Connect Entities"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 17L17 7M7 7h10v10" />
              </svg>
              {connectMode ? "Cancel Connect" : "Connect Entities"}
            </button>
            <button
              className="btn btn-sm btn-primary"
              onClick={() => setShowSaveDialog(true)}
              title="Save Layout"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3-3m0 0l-3 3m3-3v12" />
              </svg>
              Save
            </button>
            <button
              className="btn btn-sm btn-secondary"
              onClick={() => setShowLoadDialog(true)}
              title="Load Layout"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3V10" />
              </svg>
              Load
            </button>
          </div>
        )}
      </div>

      {/* Entity Properties Panel */}
      {/* Entity detail panel removed for more diagram space */}

      {/* Main SVG Canvas */}
      <svg
        ref={svgRef}
        className="w-full h-full cursor-grab active:cursor-grabbing"
        onMouseDown={handleSvgMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        {/* Definitions for relationship markers */}
        <defs>
          <marker id="arrow-one" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto" markerUnits="strokeWidth">
            <path d="M0,0 L0,6 L9,3 z" fill="#666" />
          </marker>
          <marker id="arrow-many" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto" markerUnits="strokeWidth">
            <path d="M0,0 L0,6 L9,3 z" fill="#666" />
            <circle cx="2" cy="3" r="1" fill="#666" />
          </marker>
          <marker id="arrow-default" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto" markerUnits="strokeWidth">
            <path d="M0,0 L0,6 L9,3 z" fill="#666" />
          </marker>
        </defs>

        {/* Transform group for zoom and pan */}
        <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
          {/* Render connections */}
          {connections.map(connection => {
            const srcCard = getCardinalityLabel(connection.relationship.source.cardinality);
            const tgtCard = getCardinalityLabel(connection.relationship.target.cardinality);

            return (
              <g key={connection.id}>
                <path
                  d={getRelationshipPath(connection)}
                  stroke="#666"
                  strokeWidth="2"
                  fill="none"
                  markerEnd={getCardinalityMarker(connection.relationship.target.cardinality)}
                />
                {/* Source cardinality label */}
                <text
                  x={connection.sourcePoint.x + 10}
                  y={connection.sourcePoint.y - 8}
                  textAnchor="start"
                  className="text-xs fill-base-content/80 font-semibold"
                >
                  {srcCard}
                </text>
                {/* Target cardinality label */}
                <text
                  x={connection.targetPoint.x - 10}
                  y={connection.targetPoint.y - 8}
                  textAnchor="end"
                  className="text-xs fill-base-content/80 font-semibold"
                >
                  {tgtCard}
                </text>
                {/* Relationship description in the middle */}
                {connection.relationship.description && (
                  <text
                    x={(connection.sourcePoint.x + connection.targetPoint.x) / 2}
                    y={(connection.sourcePoint.y + connection.targetPoint.y) / 2 - 10}
                    textAnchor="middle"
                    className="text-xs fill-base-content/60"
                  >
                    {connection.relationship.description}
                  </text>
                )}
              </g>
            );
          })}

          {/* Render entity nodes */}
          {entityNodes.map(entity => {
            const isSelected = selectedEntity === entity.uuid;
            const entityHeight = entity.showProperties ? 60 + entity.attributes.length * 20 : 80;
            // Highlight for connect mode
            const isConnectSource = connectMode && relationshipSource === entity.uuid;
            const isConnectTarget = connectMode && relationshipTarget === entity.uuid;

            return (
              <g
                key={entity.uuid}
                transform={`translate(${entity.position.x}, ${entity.position.y})`}
                className="cursor-pointer"
                onMouseDown={(e) => handleEntityMouseDown(entity.uuid, e)}
                style={{
                  filter: isConnectSource
                    ? "drop-shadow(0 0 8px #f59e42)"
                    : isConnectTarget
                    ? "drop-shadow(0 0 8px #10b981)"
                    : undefined,
                  opacity:
                    connectMode && relationshipSource && entity.uuid !== relationshipSource
                      ? 0.85
                      : 1,
                  stroke: isConnectSource
                    ? "#f59e42"
                    : isConnectTarget
                    ? "#10b981"
                    : undefined,
                  strokeWidth: isConnectSource || isConnectTarget ? 2 : undefined,
                }}
              >
                {/* Entity box */}
                <rect
                  width="300"
                  height={entityHeight}
                  rx="8"
                  fill={isSelected ? "#e0f2fe" : "#ffffff"}
                  stroke={isSelected ? "#0284c7" : "#d1d5db"}
                  strokeWidth={isSelected ? "2" : "1"}
                  className="drop-shadow-md"
                />

                {/* Entity header */}
                <rect
                  width="300"
                  height="40"
                  rx="8"
                  fill="#f8fafc"
                  stroke="#d1d5db"
                  strokeWidth="1"
                />

                {/* Entity title */}
                <text
                  x="150"
                  y="25"
                  textAnchor="middle"
                  className="font-bold text-sm fill-base-content"
                >
                  {entity.name}
                </text>

                {/* Properties toggle button in header (right side) */}
                <g
                  className="cursor-pointer"
                  onClick={e => {
                    e.stopPropagation();
                    toggleEntityProperties(entity.uuid);
                  }}
                >
                  <circle
                    cx="275"
                    cy="25"
                    r="8"
                    fill={entity.showProperties ? "#10b981" : "#6b7280"}
                  />
                  <text
                    x="275"
                    y="28"
                    textAnchor="middle"
                    className="text-xs fill-white pointer-events-none"
                    style={{ fontWeight: 700, userSelect: "none" }}
                  >
                    {entity.showProperties ? "−" : "+"}
                  </text>
                </g>

                {/* Attributes (when expanded) */}
                {entity.showProperties && (
                  <g>
                    <line
                      x1="10"
                      y1="70"
                      x2="290"
                      y2="70"
                      stroke="#d1d5db"
                      strokeWidth="1"
                    />
                    {entity.attributes.map((attr, index) => (
                      <g key={index}>
                        <text
                          x="15"
                          y={90 + index * 20}
                          className="text-xs fill-base-content"
                        >
                          {attr.required && (
                            <tspan className="fill-red-500">* </tspan>
                          )}
                          {attr.name}
                        </text>
                        <text
                          x="285"
                          y={90 + index * 20}
                          textAnchor="end"
                          className="text-xs fill-base-content/60"
                        >
                          {attr.type}
                        </text>
                      </g>
                    ))}
                  </g>
                )}
              </g>
            );
          })}
        </g>
      </svg>

      {/* Relationship Creation Dialog */}
      {showRelationshipDialog && (
        <div className="modal modal-open">
          <div className="modal-box">
            <h3 className="font-bold text-lg">Create Relationship</h3>
            <div className="py-4">
              <div className="form-control mb-2">
                <label className="label">
                  <span className="label-text">Description</span>
                </label>
                <input
                  type="text"
                  className="input input-bordered"
                  value={relationshipDescription}
                  onChange={e => setRelationshipDescription(e.target.value)}
                  placeholder="Optional description"
                />
              </div>
              <div className="form-control mb-2">
                <label className="label">
                  <span className="label-text">Source Cardinality</span>
                </label>
                <select
                  className="select select-bordered"
                  value={sourceCardinality}
                  onChange={e => setSourceCardinality(e.target.value as Cardinality)}
                >
                  <option value={Cardinality.ONE}>One</option>
                  <option value={Cardinality.MANY}>Many</option>
                </select>
              </div>
              <div className="form-control mb-2">
                <label className="label">
                  <span className="label-text">Target Cardinality</span>
                </label>
                <select
                  className="select select-bordered"
                  value={targetCardinality}
                  onChange={e => setTargetCardinality(e.target.value as Cardinality)}
                >
                  <option value={Cardinality.ONE}>One</option>
                  <option value={Cardinality.MANY}>Many</option>
                </select>
              </div>
              <div className="mt-2 text-sm">
                <b>From:</b>{" "}
                {entityNodes.find(e => e.uuid === relationshipSource)?.name || ""}
                <br />
                <b>To:</b>{" "}
                {entityNodes.find(e => e.uuid === relationshipTarget)?.name || ""}
              </div>
            </div>
            <div className="modal-action">
              <button
                className="btn btn-primary"
                disabled={!relationshipSource || !relationshipTarget}
                onClick={handleCreateRelationship}
              >
                Create
              </button>
              <button
                className="btn"
                onClick={() => {
                  setShowRelationshipDialog(false);
                  setRelationshipTarget(null);
                  setRelationshipDescription('');
                  setSourceCardinality(Cardinality.ONE);
                  setTargetCardinality(Cardinality.MANY);
                  setSelectedEntity(relationshipSource);
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Save Layout Dialog */}
      {showSaveDialog && (
        <div className="modal modal-open">
          <div className="modal-box">
            <h3 className="font-bold text-lg">Save Diagram Layout</h3>
            <div className="py-4">
              <div className="form-control">
                <label className="label">
                  <span className="label-text">Layout Name</span>
                </label>
                <input
                  type="text"
                  placeholder="Enter layout name..."
                  className="input input-bordered"
                  value={saveLayoutName}
                  onChange={(e) => setSaveLayoutName(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && handleSaveLayout()}
                />
              </div>
            </div>
            <div className="modal-action">
              <button
                className="btn btn-primary"
                onClick={handleSaveLayout}
                disabled={!saveLayoutName.trim()}
              >
                Save
              </button>
              <button
                className="btn"
                onClick={() => {
                  setShowSaveDialog(false);
                  setSaveLayoutName('');
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Load Layout Dialog */}
      {showLoadDialog && (
        <div className="modal modal-open">
          <div className="modal-box">
            <h3 className="font-bold text-lg">Load Diagram Layout</h3>
            <div className="py-4">
              {savedLayouts.length === 0 ? (
                <p className="text-base-content/60">No saved layouts found.</p>
              ) : (
                <div className="form-control">
                  <label className="label">
                    <span className="label-text">Select Layout</span>
                  </label>
                  <select
                    className="select select-bordered"
                    value={selectedLayoutId}
                    onChange={(e) => setSelectedLayoutId(e.target.value)}
                  >
                    <option value="">Choose a layout...</option>
                    {savedLayouts.map((layout) => (
                      <option key={layout.id} value={layout.id}>
                        {layout.name} ({new Date(layout.updatedAt).toLocaleDateString()})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {savedLayouts.length > 0 && (
                <div className="mt-4">
                  <h4 className="font-semibold mb-2">Saved Layouts</h4>
                  <div className="max-h-40 overflow-y-auto space-y-2">
                    {savedLayouts.map((layout) => (
                      <div key={layout.id} className="flex items-center justify-between p-2 bg-base-200 rounded">
                        <div>
                          <div className="font-medium">{layout.name}</div>
                          <div className="text-sm text-base-content/60">
                            {layout.service || 'All Services'} • {new Date(layout.updatedAt).toLocaleDateString()}
                          </div>
                        </div>
                        <button
                          className="btn btn-sm btn-error"
                          onClick={() => handleDeleteLayout(layout.id)}
                          title="Delete Layout"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="modal-action">
              <button
                className="btn btn-primary"
                onClick={handleLoadLayout}
                disabled={!selectedLayoutId}
              >
                Load
              </button>
              <button
                className="btn"
                onClick={() => {
                  setShowLoadDialog(false);
                  setSelectedLayoutId('');
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default EntityDiagramEditor;
