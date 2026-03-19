import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import mermaid from 'mermaid';
import { servicesApi, diagramApi, relationshipApi } from '../services/api';
import { Entity, Relationship, Cardinality, DiagramLayout } from '../types';

interface VisualizationComponentProps {
  serviceName?: string;
  entityName?: string;
  showCrossServiceRelationships?: boolean;
}

interface EntityTooltip {
  entity: Entity;
  x: number;
  y: number;
  visible: boolean;
}

interface ContextMenu {
  entity: Entity;
  x: number;
  y: number;
  visible: boolean;
}

interface EntityPosition {
  x: number;
  y: number;
  showAttributes: boolean;
}

interface DragState {
  isDragging: boolean;
  entityId: string | null;
  startX: number;
  startY: number;
  offsetX: number;
  offsetY: number;
  hasMoved: boolean;
}

/** Map entity UUID to its service name for lookups */
type EntityServiceMap = Record<string, string>;

/**
 * Format a cardinality label from source/target cardinality values.
 * Returns e.g. "1:N", "N:1", "1:1", "N:N"
 */
const formatCardinalityLabel = (
  sourceCardinality?: Cardinality | string,
  targetCardinality?: Cardinality | string
): string => {
  const src = sourceCardinality === Cardinality.MANY ? 'N' : '1';
  const tgt = targetCardinality === Cardinality.MANY ? 'N' : '1';
  return `${src}:${tgt}`;
};

const VisualizationComponent = ({
  serviceName,
  entityName,
  showCrossServiceRelationships = true
}: VisualizationComponentProps) => {
  const params = useParams<{ service?: string; entity?: string }>();
  const navigate = useNavigate();
  const service = serviceName || params.service;
  const entity = entityName || params.entity;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mermaidDefinition, setMermaidDefinition] = useState<string>('');
  const [zoom, setZoom] = useState(1);
  const [entities, setEntities] = useState<Entity[]>([]);
  const [relationships, setRelationships] = useState<Relationship[]>([]);
  const [entityServiceMap, setEntityServiceMap] = useState<EntityServiceMap>({});
  const [tooltip, setTooltip] = useState<EntityTooltip>({ entity: {} as Entity, x: 0, y: 0, visible: false });
  const [contextMenu, setContextMenu] = useState<ContextMenu>({ entity: {} as Entity, x: 0, y: 0, visible: false });
  const [showAttributes, setShowAttributes] = useState(false);
  const [entityPositions, setEntityPositions] = useState<Record<string, EntityPosition>>({});
  const [dragState, setDragState] = useState<DragState>({
    isDragging: false,
    entityId: null,
    startX: 0,
    startY: 0,
    offsetX: 0,
    offsetY: 0,
    hasMoved: false
  });
  const [useMermaid, setUseMermaid] = useState(false);
  const [microserviceColors, setMicroserviceColors] = useState<Record<string, string>>({});
  const [showMicroserviceGroups, setShowMicroserviceGroups] = useState(true);
  const [layoutAlgorithm, setLayoutAlgorithm] = useState<'grid' | 'circular' | 'force'>('grid');
  const [savedLayouts, setSavedLayouts] = useState<{id: string, name: string}[]>([]);
  const [currentLayoutId, setCurrentLayoutId] = useState<string | null>(null);
  const diagramRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const isDraggingRef = useRef(false);

  // Initialize mermaid
  useEffect(() => {
    mermaid.initialize({
      startOnLoad: true,
      theme: 'neutral',
      securityLevel: 'loose',
      er: {
        diagramPadding: 20,
        layoutDirection: 'TB',
        minEntityWidth: 100,
        minEntityHeight: 75,
        entityPadding: 15,
        stroke: 'gray',
        fill: 'white',
        fontSize: 12
      }
    });
  }, []);

  // Helper: get the service name for an entity by UUID
  const getEntityService = useCallback((entityUuid: string): string => {
    return entityServiceMap[entityUuid] || service || '';
  }, [entityServiceMap, service]);

  // Helper: find an entity by UUID
  const findEntityByUuid = useCallback((uuid: string): Entity | undefined => {
    return entities.find(e => e.uuid === uuid);
  }, [entities]);

  // Helper: get the entityId key used for positions (service_name)
  const getEntityId = useCallback((entityUuid: string): string => {
    const ent = findEntityByUuid(entityUuid);
    const svc = getEntityService(entityUuid);
    return ent ? `${svc}_${ent.name}` : entityUuid;
  }, [findEntityByUuid, getEntityService]);

  // Helper: get relationships relevant to a given entity
  const getEntityRelationships = useCallback((entityUuid: string): Relationship[] => {
    return relationships.filter(
      rel => rel.source.entity === entityUuid || rel.target.entity === entityUuid
    );
  }, [relationships]);

  // Generate consistent colors for microservices
  useEffect(() => {
    const generateMicroserviceColors = () => {
      const colors: Record<string, string> = {};
      const baseColors = [
        '#3498db', // Blue
        '#2ecc71', // Green
        '#e74c3c', // Red
        '#9b59b6', // Purple
        '#f1c40f', // Yellow
        '#1abc9c', // Teal
        '#e67e22', // Orange
        '#34495e', // Dark Blue
        '#16a085', // Dark Green
        '#d35400'  // Dark Orange
      ];

      // Get unique services from entity-service map
      const services = [...new Set(Object.values(entityServiceMap))];

      // Assign colors to each service
      services.forEach((svc, index) => {
        colors[svc] = baseColors[index % baseColors.length];
      });

      setMicroserviceColors(colors);
    };

    if (entities.length > 0) {
      generateMicroserviceColors();
    }
  }, [entities, entityServiceMap]);

  // Load saved diagram layouts
  useEffect(() => {
    const loadSavedLayouts = async () => {
      try {
        const response = await diagramApi.listDiagramLayouts(service);
        if (response.data && Array.isArray(response.data)) {
          setSavedLayouts(response.data.map((layout: DiagramLayout) => ({
            id: layout.id,
            name: layout.name
          })));
        }
      } catch (err) {
        console.warn('Could not load saved layouts:', err);
      }
    };

    if (service) {
      loadSavedLayouts();
    }
  }, [service]);

  // Fetch data and generate diagram
  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        setError(null);

        let fetchedEntities: Entity[] = [];
        let fetchedRelationships: Relationship[] = [];
        const svcMap: EntityServiceMap = {};

        if (service && entity) {
          // Fetch single entity and its service's relationships
          const entityResponse = await servicesApi.getEntitySchema(service, entity);
          const mainEntity = entityResponse.data;
          fetchedEntities = [mainEntity];
          svcMap[mainEntity.uuid] = service;

          // Fetch relationships at the package level
          try {
            fetchedRelationships = await relationshipApi.getPackageRelationships(service);
          } catch (err) {
            console.warn('Could not fetch relationships for service:', service, err);
          }

          // Fetch related entities referenced by relationships
          const entityRels = fetchedRelationships.filter(
            rel => rel.source.entity === mainEntity.uuid || rel.target.entity === mainEntity.uuid
          );

          if (entityRels.length > 0) {
            const relatedUuids = new Set<string>();
            entityRels.forEach(rel => {
              if (rel.source.entity !== mainEntity.uuid) relatedUuids.add(rel.source.entity);
              if (rel.target.entity !== mainEntity.uuid) relatedUuids.add(rel.target.entity);
            });

            // For related entities, try to fetch them from the same service first
            const relatedEntitiesPromises = [...relatedUuids].map(async (uuid) => {
              try {
                // Try to find entity within the same service's entities
                const serviceEntitiesResponse = await servicesApi.getServiceEntities(service);
                const svcEntities = serviceEntitiesResponse.data || [];
                const found = svcEntities.find((e: Entity) => e.uuid === uuid);
                if (found) {
                  svcMap[found.uuid] = service;
                  return found;
                }
              } catch (err) {
                console.warn(`Could not fetch related entity: ${uuid}`, err);
              }
              return null;
            });

            const relatedEntities = await Promise.all(relatedEntitiesPromises);
            fetchedEntities = [...fetchedEntities, ...relatedEntities.filter(Boolean) as Entity[]];
          }
        } else if (service) {
          // Fetch all entities for a service
          const entitiesResponse = await servicesApi.getServiceEntities(service);
          fetchedEntities = entitiesResponse.data;
          fetchedEntities.forEach(e => { svcMap[e.uuid] = service; });

          // Fetch relationships for this service
          try {
            fetchedRelationships = await relationshipApi.getPackageRelationships(service);
          } catch (err) {
            console.warn('Could not fetch relationships for service:', service, err);
          }
        } else {
          // No service specified - fetch all services and their entities
          const servicesResponse = await servicesApi.getAllServices();
          const services = servicesResponse.data || servicesResponse;

          if (services && services.length > 0) {
            // Fetch entities and relationships for all services
            const allDataPromises = services.map(async (svcName: string) => {
              try {
                const entitiesResponse = await servicesApi.getServiceEntities(svcName);
                const svcEntities = entitiesResponse.data || entitiesResponse;
                (svcEntities as Entity[]).forEach(e => { svcMap[e.uuid] = svcName; });

                let svcRelationships: Relationship[] = [];
                try {
                  svcRelationships = await relationshipApi.getPackageRelationships(svcName);
                } catch (err) {
                  console.warn(`Could not fetch relationships for service: ${svcName}`, err);
                }

                return { entities: svcEntities as Entity[], relationships: svcRelationships };
              } catch (err) {
                console.warn(`Could not fetch entities for service: ${svcName}`, err);
                return { entities: [], relationships: [] };
              }
            });

            const allData = await Promise.all(allDataPromises);
            fetchedEntities = allData.flatMap(d => d.entities);
            fetchedRelationships = allData.flatMap(d => d.relationships);
          } else {
            throw new Error('No services found');
          }
        }

        // Store entities, relationships, and entity-service mapping
        setEntities(fetchedEntities);
        setRelationships(fetchedRelationships);
        setEntityServiceMap(svcMap);

        // Initialize entity positions if not already set
        const initialPositions: Record<string, EntityPosition> = {};

        // Apply layout algorithm
        if (layoutAlgorithm === 'grid') {
          // Group entities by service for better organization
          const serviceGroups: Record<string, Entity[]> = {};
          fetchedEntities.forEach(ent => {
            const svc = svcMap[ent.uuid] || 'unknown';
            if (!serviceGroups[svc]) {
              serviceGroups[svc] = [];
            }
            serviceGroups[svc].push(ent);
          });

          // Position entities in a grid, grouped by service
          let rowOffset = 0;
          Object.entries(serviceGroups).forEach(([_svc, serviceEntities]) => {
            serviceEntities.forEach((ent, index) => {
              const entityId = `${svcMap[ent.uuid] || 'unknown'}_${ent.name}`;
              if (!entityPositions[entityId]) {
                initialPositions[entityId] = {
                  x: 100 + (index % 3) * 350,
                  y: 150 + rowOffset + Math.floor(index / 3) * 250,
                  showAttributes: false
                };
              }
            });
            // Add vertical spacing between service groups
            rowOffset += Math.ceil(serviceEntities.length / 3) * 250 + 100;
          });
        } else if (layoutAlgorithm === 'circular') {
          // Position entities in a circle
          const centerX = 600;
          const centerY = 400;
          const radius = Math.min(fetchedEntities.length * 30, 350);

          fetchedEntities.forEach((ent, index) => {
            const entityId = `${svcMap[ent.uuid] || 'unknown'}_${ent.name}`;
            if (!entityPositions[entityId]) {
              const angle = (index / fetchedEntities.length) * 2 * Math.PI;
              initialPositions[entityId] = {
                x: centerX + radius * Math.cos(angle),
                y: centerY + radius * Math.sin(angle),
                showAttributes: false
              };
            }
          });
        } else if (layoutAlgorithm === 'force') {
          // Simple force-directed layout
          // Start with random positions
          fetchedEntities.forEach((ent) => {
            const entityId = `${svcMap[ent.uuid] || 'unknown'}_${ent.name}`;
            if (!entityPositions[entityId]) {
              initialPositions[entityId] = {
                x: 100 + Math.random() * 800,
                y: 100 + Math.random() * 500,
                showAttributes: false
              };
            }
          });

          // Apply simple force algorithm (just a few iterations)
          for (let iteration = 0; iteration < 10; iteration++) {
            // Repulsive forces between all entities
            for (let i = 0; i < fetchedEntities.length; i++) {
              const entityId1 = `${svcMap[fetchedEntities[i].uuid] || 'unknown'}_${fetchedEntities[i].name}`;
              const pos1 = initialPositions[entityId1] || { x: 0, y: 0, showAttributes: false };

              for (let j = i + 1; j < fetchedEntities.length; j++) {
                const entityId2 = `${svcMap[fetchedEntities[j].uuid] || 'unknown'}_${fetchedEntities[j].name}`;
                const pos2 = initialPositions[entityId2] || { x: 0, y: 0, showAttributes: false };

                const dx = pos2.x - pos1.x;
                const dy = pos2.y - pos1.y;
                const distance = Math.sqrt(dx * dx + dy * dy) || 1;
                const force = 5000 / distance;

                const moveX = (dx / distance) * force;
                const moveY = (dy / distance) * force;

                initialPositions[entityId1] = {
                  ...pos1,
                  x: pos1.x - moveX,
                  y: pos1.y - moveY
                };

                initialPositions[entityId2] = {
                  ...pos2,
                  x: pos2.x + moveX,
                  y: pos2.y + moveY
                };
              }
            }

            // Attractive forces between related entities (using package-level relationships)
            fetchedRelationships.forEach(rel => {
              const sourceEntity = fetchedEntities.find(e => e.uuid === rel.source.entity);
              const targetEntity = fetchedEntities.find(e => e.uuid === rel.target.entity);
              if (!sourceEntity || !targetEntity) return;

              const sourceId = `${svcMap[sourceEntity.uuid] || 'unknown'}_${sourceEntity.name}`;
              const targetId = `${svcMap[targetEntity.uuid] || 'unknown'}_${targetEntity.name}`;
              const sourcePos = initialPositions[sourceId];
              const targetPos = initialPositions[targetId];

              if (sourcePos && targetPos) {
                const dx = targetPos.x - sourcePos.x;
                const dy = targetPos.y - sourcePos.y;
                const distance = Math.sqrt(dx * dx + dy * dy) || 1;
                const force = distance / 10;

                const moveX = (dx / distance) * force;
                const moveY = (dy / distance) * force;

                initialPositions[sourceId] = {
                  ...sourcePos,
                  x: sourcePos.x + moveX,
                  y: sourcePos.y + moveY
                };

                initialPositions[targetId] = {
                  ...targetPos,
                  x: targetPos.x - moveX,
                  y: targetPos.y - moveY
                };
              }
            });
          }
        }

        setEntityPositions(prev => ({ ...prev, ...initialPositions }));

        // Generate diagram based on mode
        if (useMermaid) {
          const diagram = generateERDiagram(fetchedEntities, fetchedRelationships, svcMap);
          setMermaidDefinition(diagram);
        }
      } catch (err) {
        console.error('Error fetching data for visualization:', err);
        setError('Failed to load visualization data. Please try again later.');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [service, entity, showCrossServiceRelationships, useMermaid]);

  // Update entity positions when showAttributes changes
  useEffect(() => {
    setEntityPositions(prev => {
      const updated = { ...prev };
      Object.keys(updated).forEach(key => {
        updated[key] = { ...updated[key], showAttributes: showAttributes };
      });
      return updated;
    });
  }, [showAttributes]);

  // Mouse event handlers for dragging entities
  const handleMouseDown = useCallback((e: React.MouseEvent, entityId: string) => {
    if (useMermaid) return; // Disable dragging in Mermaid mode

    e.preventDefault();
    e.stopPropagation();
    const rect = diagramRef.current?.getBoundingClientRect();
    if (!rect) return;

    const x = (e.clientX - rect.left) / zoom;
    const y = (e.clientY - rect.top) / zoom;
    const entityPos = entityPositions[entityId];

    isDraggingRef.current = false; // Reset dragging flag
    setDragState({
      isDragging: true,
      entityId,
      startX: x,
      startY: y,
      offsetX: x - (entityPos?.x || 0),
      offsetY: y - (entityPos?.y || 0),
      hasMoved: false
    });
  }, [zoom, entityPositions, useMermaid]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragState.isDragging || !dragState.entityId || useMermaid) return;

    const rect = diagramRef.current?.getBoundingClientRect();
    if (!rect) return;

    const x = (e.clientX - rect.left) / zoom;
    const y = (e.clientY - rect.top) / zoom;

    // Check if the mouse has moved significantly from the start position
    const deltaX = Math.abs(x - dragState.startX);
    const deltaY = Math.abs(y - dragState.startY);
    const hasMoved = deltaX > 5 || deltaY > 5; // 5px threshold

    if (hasMoved) {
      isDraggingRef.current = true; // Set the ref to indicate dragging occurred
      if (!dragState.hasMoved) {
        setDragState(prev => ({ ...prev, hasMoved: true }));
      }
    }

    setEntityPositions(prev => ({
      ...prev,
      [dragState.entityId!]: {
        ...prev[dragState.entityId!],
        x: x - dragState.offsetX,
        y: y - dragState.offsetY
      }
    }));
  }, [dragState, zoom, useMermaid]);

  const handleMouseUp = useCallback(() => {
    setDragState(prev => ({
      isDragging: false,
      entityId: null,
      startX: 0,
      startY: 0,
      offsetX: 0,
      offsetY: 0,
      hasMoved: false
    }));
  }, []);

  // Render diagram when definition changes (Mermaid mode)
  useEffect(() => {
    if (useMermaid && mermaidDefinition && diagramRef.current) {
      try {
        mermaid.render('mermaid-diagram', mermaidDefinition)
          .then(({ svg }) => {
            if (diagramRef.current) {
              diagramRef.current.innerHTML = svg;

              // Enhanced entity interaction
              setupEntityInteractions();
            }
          })
          .catch(err => {
            console.error('Error rendering diagram:', err);
            setError('Failed to render diagram');
          });
      } catch (err) {
        console.error('Error rendering diagram:', err);
        setError('Failed to render diagram');
      }
    }
  }, [mermaidDefinition, entities]);

  // Setup enhanced entity interactions
  const setupEntityInteractions = () => {
    if (!diagramRef.current) return;

    // Debug: Log the entire DOM structure
    console.log('Diagram DOM structure:', diagramRef.current.innerHTML);

    // Try multiple selectors for different Mermaid versions
    const possibleSelectors = [
      '.er.entityBox',
      '.entityBox',
      '.er-entityBox',
      'g.entityBox',
      'g[class*="entity"]',
      'rect[class*="entity"]',
      'g[id*="entity"]',
      '.entity',
      'g.node',
      'g[class*="node"]'
    ];

    let entityElements: NodeListOf<Element> | null = null;

    for (const selector of possibleSelectors) {
      entityElements = diagramRef.current.querySelectorAll(selector);
      if (entityElements.length > 0) {
        console.log(`Found ${entityElements.length} entities using selector: ${selector}`);
        break;
      }
    }

    // If no entities found with specific selectors, try to find all text elements with entity names
    if (!entityElements || entityElements.length === 0) {
      console.log('Trying text-based detection...');
      const allTextElements = diagramRef.current.querySelectorAll('text');
      console.log(`Found ${allTextElements.length} text elements`);

      const entityTextElements: Element[] = [];

      allTextElements.forEach((textEl, index) => {
        const text = textEl.textContent;
        console.log(`Text element ${index}: "${text}"`);

        if (text && (text.includes('/') || text.includes('.'))) {
          console.log(`Found entity text: "${text}"`);
          // Find the parent group or rect element that can be clicked
          let parent = textEl.parentElement;
          let depth = 0;
          while (parent && parent !== diagramRef.current && depth < 10) {
            console.log(`Parent ${depth}: ${parent.tagName}, class: ${parent.className}, id: ${parent.id}`);
            if (parent.tagName === 'g' || parent.tagName === 'rect') {
              entityTextElements.push(parent);
              console.log(`Added parent element for entity: ${text}`);
              break;
            }
            parent = parent.parentElement;
            depth++;
          }
        }
      });

      if (entityTextElements.length > 0) {
        console.log(`Found ${entityTextElements.length} entities using text-based detection`);
        entityElements = entityTextElements as any;
      }
    }

    // If still no entities found, try a more aggressive approach
    if (!entityElements || entityElements.length === 0) {
      console.log('Trying aggressive detection...');
      // Look for any clickable elements that might contain entity information
      const allElements = diagramRef.current.querySelectorAll('*');
      const potentialEntityElements: Element[] = [];

      allElements.forEach(el => {
        const text = el.textContent;
        // Check for both slash and dot notation
        if (text && ((text.includes('/') && text.split('/').length === 2) ||
                    (text.includes('.') && text.split('.').length === 2))) {
          // This looks like an entity name
          potentialEntityElements.push(el);
        }
      });

      if (potentialEntityElements.length > 0) {
        console.log(`Found ${potentialEntityElements.length} potential entities using aggressive detection`);
        entityElements = potentialEntityElements as any;
      }
    }

    if (!entityElements || entityElements.length === 0) {
      console.warn('No entity elements found in the diagram');
      // Add a fallback: make the entire diagram clickable areas
      const allRects = diagramRef.current.querySelectorAll('rect');
      console.log(`Found ${allRects.length} rect elements as fallback`);

      allRects.forEach((rect, index) => {
        console.log(`Rect ${index}:`, rect);
        // Add basic click handler to each rect
        rect.addEventListener('click', (e) => {
          console.log('Rect clicked:', rect);
          // Try to find associated text
          const nearbyText = rect.parentElement?.querySelector('text')?.textContent;
          console.log('Nearby text:', nearbyText);
        });
      });
      return;
    }

    console.log(`Setting up interactions for ${entityElements.length} entities`);

    entityElements.forEach((element, index) => {
      // Find text content - could be direct child or nested
      let entityText = element.querySelector('text')?.textContent;
      if (!entityText) {
        // Try to find text in the element itself if it's a text element
        entityText = element.textContent;
      }

      console.log(`Entity ${index}: "${entityText}"`);

      if (entityText && (entityText.includes('/') || entityText.includes('.'))) {
        // Support both formats for backward compatibility
        const separator = entityText.includes('.') ? '.' : '/';
        const [entityService, entName] = entityText.split(separator);
        const entityData = entities.find(e => {
          const svc = entityServiceMap[e.uuid];
          return svc === entityService && e.name === entName;
        });

        if (entityService && entName && entityData) {
          console.log(`Setting up interactions for: ${entityService}${separator}${entName}`);

          // Add cursor pointer
          (element as HTMLElement).style.cursor = 'pointer';

          // Click handler - navigate to entity detail
          element.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            console.log(`Navigating to: /services/${entityService}/entities/${entName}`);
            navigate(`/services/${entityService}/entities/${entName}`);
          });

          // Mouse enter - show tooltip
          element.addEventListener('mouseenter', (e) => {
            const rect = element.getBoundingClientRect();
            const containerRect = diagramRef.current!.getBoundingClientRect();

            setTooltip({
              entity: entityData,
              x: rect.left - containerRect.left + rect.width / 2,
              y: rect.top - containerRect.top,
              visible: true
            });
          });

          // Mouse leave - hide tooltip
          element.addEventListener('mouseleave', () => {
            setTooltip(prev => ({ ...prev, visible: false }));
          });

          // Right click - show context menu
          element.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const rect = element.getBoundingClientRect();
            const containerRect = diagramRef.current!.getBoundingClientRect();

            setContextMenu({
              entity: entityData,
              x: rect.left - containerRect.left,
              y: rect.top - containerRect.top + rect.height,
              visible: true
            });
          });
        } else {
          console.log(`No entity data found for: ${entityService}/${entName}`);
        }
      }
    });
  };

  // Handle context menu actions
  const handleContextMenuAction = (action: string, ent: Entity) => {
    setContextMenu(prev => ({ ...prev, visible: false }));
    const svc = entityServiceMap[ent.uuid] || service || '';

    switch (action) {
      case 'view':
        navigate(`/services/${svc}/entities/${ent.name}`);
        break;
      case 'edit':
        navigate(`/services/${svc}/entities/${ent.name}/edit`);
        break;
      case 'viewService':
        navigate(`/services/${svc}`);
        break;
      case 'viewRelated':
        // Show only this entity and its relationships
        navigate(`/diagram/${svc}/${ent.name}`);
        break;
      case 'copyLink':
        const link = `${window.location.origin}/services/${svc}/entities/${ent.name}`;
        navigator.clipboard.writeText(link);
        break;
      case 'toggleAttributes':
        const entityId = `${svc}_${ent.name}`;
        setEntityPositions(prev => ({
          ...prev,
          [entityId]: {
            ...prev[entityId],
            showAttributes: !prev[entityId]?.showAttributes
          }
        }));
        break;
    }
  };

  // Close context menu when clicking outside
  useEffect(() => {
    const handleClickOutside = () => {
      setContextMenu(prev => ({ ...prev, visible: false }));
    };

    if (contextMenu.visible) {
      document.addEventListener('click', handleClickOutside);
      return () => document.removeEventListener('click', handleClickOutside);
    }
  }, [contextMenu.visible]);

  // Generate Mermaid ER diagram definition
  const generateERDiagram = (
    diagramEntities: Entity[],
    diagramRelationships: Relationship[],
    svcMap: EntityServiceMap
  ): string => {
    let diagram = 'erDiagram\n';

    // Helper function to create valid Mermaid entity IDs
    const createEntityId = (svc: string, name: string): string => {
      return `${svc}_${name}`.replace(/[^a-zA-Z0-9_]/g, '_');
    };

    // Build a UUID-to-entity-id map for relationship rendering
    const uuidToEntityId: Record<string, string> = {};
    diagramEntities.forEach(ent => {
      const svc = svcMap[ent.uuid] || 'unknown';
      uuidToEntityId[ent.uuid] = createEntityId(svc, ent.name);
    });

    // Add entities (show only entity name, not service/name)
    diagramEntities.forEach(ent => {
      const svc = svcMap[ent.uuid] || 'unknown';
      const entityId = createEntityId(svc, ent.name);
      const displayName = ent.name;

      diagram += `  ${entityId}["${displayName}"]`;

      // Add attributes only if showAttributes is true
      if (showAttributes && ent.attributes && ent.attributes.length > 0) {
        diagram += ` {\n`;
        ent.attributes.forEach(attr => {
          const required = attr.required ? '*' : '';
          const cleanAttrName = attr.name.replace(/[^a-zA-Z0-9_]/g, '_');
          diagram += `    ${attr.type} ${cleanAttrName}${required}\n`;
        });
        diagram += '  }\n';
      } else {
        // When attributes are hidden, don't add the curly braces to avoid empty property boxes
        diagram += '\n';
      }
    });

    // Add relationships using cardinality notation
    diagramRelationships.forEach(rel => {
      const sourceId = uuidToEntityId[rel.source.entity];
      const targetId = uuidToEntityId[rel.target.entity];

      // Skip if source or target entity is not in our diagram
      if (!sourceId || !targetId) return;

      // Skip cross-service relationships if not showing them
      if (!showCrossServiceRelationships) {
        const sourceSvc = svcMap[rel.source.entity];
        const targetSvc = svcMap[rel.target.entity];
        if (sourceSvc !== targetSvc) return;
      }

      // Build Mermaid ER relationship symbol from cardinalities
      // Source cardinality on the left, target cardinality on the right
      const srcCard = rel.source.cardinality;
      const tgtCard = rel.target.cardinality;

      let leftSymbol: string;
      let rightSymbol: string;

      // Left side (source cardinality)
      if (srcCard === Cardinality.MANY) {
        leftSymbol = '}|';
      } else {
        leftSymbol = '||';
      }

      // Right side (target cardinality)
      if (tgtCard === Cardinality.MANY) {
        rightSymbol = '|{';
      } else {
        rightSymbol = 'o|';
      }

      const relationSymbol = `${leftSymbol}--${rightSymbol}`;
      const label = rel.description || formatCardinalityLabel(srcCard, tgtCard);

      diagram += `  ${sourceId} ${relationSymbol} ${targetId} : "${label}"\n`;
    });

    return diagram;
  };

  const handleZoomIn = () => {
    setZoom(prev => Math.min(prev + 0.1, 2));
  };

  const handleZoomOut = () => {
    setZoom(prev => Math.max(prev - 0.1, 0.5));
  };

  const handleResetZoom = () => {
    setZoom(1);
  };

  const toggleShowAttributes = () => {
    setShowAttributes(!showAttributes);
  };

  const toggleDiagramMode = () => {
    setUseMermaid(!useMermaid);
  };

  const resetLayout = () => {
    // Apply the current layout algorithm
    const resetPositions: Record<string, EntityPosition> = {};

    if (layoutAlgorithm === 'grid') {
      // Group entities by service
      const serviceGroups: Record<string, Entity[]> = {};
      entities.forEach(ent => {
        const svc = entityServiceMap[ent.uuid] || 'unknown';
        if (!serviceGroups[svc]) {
          serviceGroups[svc] = [];
        }
        serviceGroups[svc].push(ent);
      });

      // Position entities in a grid, grouped by service
      let rowOffset = 0;
      Object.entries(serviceGroups).forEach(([_svc, serviceEntities]) => {
        serviceEntities.forEach((ent, index) => {
          const entityId = `${entityServiceMap[ent.uuid] || 'unknown'}_${ent.name}`;
          resetPositions[entityId] = {
            x: 100 + (index % 3) * 350,
            y: 150 + rowOffset + Math.floor(index / 3) * 250,
            showAttributes: showAttributes
          };
        });
        // Add vertical spacing between service groups
        rowOffset += Math.ceil(serviceEntities.length / 3) * 250 + 100;
      });
    } else if (layoutAlgorithm === 'circular') {
      // Position entities in a circle
      const centerX = 600;
      const centerY = 400;
      const radius = Math.min(entities.length * 30, 350);

      entities.forEach((ent, index) => {
        const entityId = `${entityServiceMap[ent.uuid] || 'unknown'}_${ent.name}`;
        const angle = (index / entities.length) * 2 * Math.PI;
        resetPositions[entityId] = {
          x: centerX + radius * Math.cos(angle),
          y: centerY + radius * Math.sin(angle),
          showAttributes: showAttributes
        };
      });
    } else if (layoutAlgorithm === 'force') {
      // Start with random positions
      entities.forEach((ent) => {
        const entityId = `${entityServiceMap[ent.uuid] || 'unknown'}_${ent.name}`;
        resetPositions[entityId] = {
          x: 100 + Math.random() * 800,
          y: 100 + Math.random() * 500,
          showAttributes: showAttributes
        };
      });

      // Apply simple force algorithm (just a few iterations)
      for (let iteration = 0; iteration < 10; iteration++) {
        // Repulsive forces between all entities
        for (let i = 0; i < entities.length; i++) {
          const entityId1 = `${entityServiceMap[entities[i].uuid] || 'unknown'}_${entities[i].name}`;
          const pos1 = resetPositions[entityId1];

          for (let j = i + 1; j < entities.length; j++) {
            const entityId2 = `${entityServiceMap[entities[j].uuid] || 'unknown'}_${entities[j].name}`;
            const pos2 = resetPositions[entityId2];

            const dx = pos2.x - pos1.x;
            const dy = pos2.y - pos1.y;
            const distance = Math.sqrt(dx * dx + dy * dy) || 1;
            const force = 5000 / distance;

            const moveX = (dx / distance) * force;
            const moveY = (dy / distance) * force;

            resetPositions[entityId1] = {
              ...pos1,
              x: pos1.x - moveX,
              y: pos1.y - moveY
            };

            resetPositions[entityId2] = {
              ...pos2,
              x: pos2.x + moveX,
              y: pos2.y + moveY
            };
          }
        }

        // Attractive forces between related entities
        relationships.forEach(rel => {
          const sourceEntity = entities.find(e => e.uuid === rel.source.entity);
          const targetEntity = entities.find(e => e.uuid === rel.target.entity);
          if (!sourceEntity || !targetEntity) return;

          const sourceId = `${entityServiceMap[sourceEntity.uuid] || 'unknown'}_${sourceEntity.name}`;
          const targetId = `${entityServiceMap[targetEntity.uuid] || 'unknown'}_${targetEntity.name}`;
          const sourcePos = resetPositions[sourceId];
          const targetPos = resetPositions[targetId];

          if (sourcePos && targetPos) {
            const dx = targetPos.x - sourcePos.x;
            const dy = targetPos.y - sourcePos.y;
            const distance = Math.sqrt(dx * dx + dy * dy) || 1;
            const force = distance / 10;

            const moveX = (dx / distance) * force;
            const moveY = (dy / distance) * force;

            resetPositions[sourceId] = {
              ...sourcePos,
              x: sourcePos.x + moveX,
              y: sourcePos.y + moveY
            };

            resetPositions[targetId] = {
              ...targetPos,
              x: targetPos.x - moveX,
              y: targetPos.y - moveY
            };
          }
        });
      }
    }

    setEntityPositions(resetPositions);
  };

  // Save current layout
  const saveCurrentLayout = async (layoutName: string) => {
    try {
      const layout = {
        name: layoutName,
        service: service,
        entities: Object.entries(entityPositions).reduce((acc, [entityId, position]) => {
          const [_svc, name] = entityId.split('_');
          acc[entityId] = {
            x: position.x,
            y: position.y,
            showProperties: position.showAttributes,
            name: name
          };
          return acc;
        }, {} as Record<string, any>),
        zoom: zoom,
        pan: { x: 0, y: 0 }
      };

      const response = await diagramApi.saveDiagramLayout(layout);
      if (response.data && response.data.id) {
        setCurrentLayoutId(response.data.id);
        setSavedLayouts(prev => [...prev, { id: response.data.id, name: layoutName }]);
      }
    } catch (err) {
      console.error('Error saving layout:', err);
    }
  };

  // Load a saved layout
  const loadLayout = async (layoutId: string) => {
    try {
      const response = await diagramApi.loadDiagramLayout(layoutId);
      if (response.data && response.data.entities) {
        const loadedPositions: Record<string, EntityPosition> = {};
        Object.entries(response.data.entities).forEach(([entityId, entityData]: [string, any]) => {
          loadedPositions[entityId] = {
            x: entityData.x,
            y: entityData.y,
            showAttributes: entityData.showProperties
          };
        });
        setEntityPositions(loadedPositions);
        setZoom(response.data.zoom || 1);
        setCurrentLayoutId(layoutId);
      }
    } catch (err) {
      console.error('Error loading layout:', err);
    }
  };

  // Render custom SVG diagram
  const renderCustomDiagram = () => {
    if (useMermaid || entities.length === 0) return null;

    const svgWidth = 1200;
    const svgHeight = 800;

    return (
      <svg
        ref={svgRef}
        width={svgWidth}
        height={svgHeight}
        className="border border-base-300 rounded-lg bg-base-100"
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        {/* Render relationships first (so they appear behind entities) */}
        {relationships.map(rel => {
          const sourceEntity = entities.find(e => e.uuid === rel.source.entity);
          const targetEntity = entities.find(e => e.uuid === rel.target.entity);
          if (!sourceEntity || !targetEntity) return null;

          const sourceSvc = entityServiceMap[sourceEntity.uuid] || 'unknown';
          const targetSvc = entityServiceMap[targetEntity.uuid] || 'unknown';
          const sourceId = `${sourceSvc}_${sourceEntity.name}`;
          const targetId = `${targetSvc}_${targetEntity.name}`;
          const sourcePos = entityPositions[sourceId];
          const targetPos = entityPositions[targetId];

          if (!sourcePos || !targetPos) return null;
          if (!showCrossServiceRelationships && sourceSvc !== targetSvc) return null;

          const sourceX = sourcePos.x + 150; // Center of entity box
          const sourceY = sourcePos.y + 40;
          const targetX = targetPos.x + 150;
          const targetY = targetPos.y + 40;

          // Calculate path for curved lines
          const dx = targetX - sourceX;
          const dy = targetY - sourceY;
          const distance = Math.sqrt(dx * dx + dy * dy);

          // Determine control points for the curve
          const controlPointOffset = Math.min(distance * 0.2, 100);
          const midX = (sourceX + targetX) / 2;
          const midY = (sourceY + targetY) / 2;

          // Perpendicular offset for control point
          const perpX = -dy / distance * controlPointOffset;
          const perpY = dx / distance * controlPointOffset;

          // Path for the relationship line
          const path = `M ${sourceX} ${sourceY} Q ${midX + perpX} ${midY + perpY} ${targetX} ${targetY}`;

          // Determine marker and style based on cardinality
          const srcCard = rel.source.cardinality;
          const tgtCard = rel.target.cardinality;
          let markerEnd = '';
          let strokeDasharray = '';

          if (tgtCard === Cardinality.MANY) {
            markerEnd = 'url(#arrowhead-many)';
          } else {
            markerEnd = 'url(#arrowhead-one)';
          }

          // Determine line color based on whether it's cross-service
          const lineColor = targetSvc !== sourceSvc
            ? '#9333ea' // Purple for cross-service
            : '#6b7280'; // Gray for same service

          // Cardinality symbols
          const srcSymbol = srcCard === Cardinality.MANY ? 'N' : '1';
          const tgtSymbol = tgtCard === Cardinality.MANY ? 'N' : '1';
          const cardinalityLabel = formatCardinalityLabel(srcCard, tgtCard);

          return (
            <g key={`${sourceId}-${targetId}-${rel.uuid}`}>
              <path
                d={path}
                fill="none"
                stroke={lineColor}
                strokeWidth="2"
                strokeDasharray={strokeDasharray}
                markerEnd={markerEnd}
              />

              {/* Relationship label (description or cardinality) */}
              <text
                x={midX + perpX}
                y={midY + perpY - 10}
                textAnchor="middle"
                fontSize="12"
                fill="#374151"
                className="pointer-events-none"
              >
                {rel.description || cardinalityLabel}
              </text>

              {/* Source cardinality indicator */}
              <text
                x={sourceX + dx * 0.15}
                y={sourceY + dy * 0.15 - 5}
                textAnchor="middle"
                fontSize="14"
                fontWeight="bold"
                fill="#374151"
                className="pointer-events-none"
              >
                {srcSymbol}
              </text>

              {/* Target cardinality indicator */}
              <text
                x={targetX - dx * 0.15}
                y={targetY - dy * 0.15 - 5}
                textAnchor="middle"
                fontSize="14"
                fontWeight="bold"
                fill="#374151"
                className="pointer-events-none"
              >
                {tgtSymbol}
              </text>
            </g>
          );
        })}

        {/* Arrow marker definitions for different relationship types */}
        <defs>
          {/* Standard arrowhead */}
          <marker
            id="arrowhead"
            markerWidth="10"
            markerHeight="7"
            refX="9"
            refY="3.5"
            orient="auto"
          >
            <polygon
              points="0 0, 10 3.5, 0 7"
              fill="#6b7280"
            />
          </marker>

          {/* One (single) relationship */}
          <marker
            id="arrowhead-one"
            markerWidth="10"
            markerHeight="7"
            refX="9"
            refY="3.5"
            orient="auto"
          >
            <polygon
              points="0 0, 10 3.5, 0 7"
              fill="#3b82f6"
            />
          </marker>

          {/* Many relationship */}
          <marker
            id="arrowhead-many"
            markerWidth="12"
            markerHeight="9"
            refX="11"
            refY="4.5"
            orient="auto"
          >
            <polygon
              points="0 0, 12 4.5, 0 9"
              fill="#ef4444"
            />
          </marker>
        </defs>

        {/* Render entities */}
        {entities.map(ent => {
          const svc = entityServiceMap[ent.uuid] || 'unknown';
          const entityId = `${svc}_${ent.name}`;
          const position = entityPositions[entityId];
          if (!position) return null;

          // Make the box closer to a square: width 120, height 120 (header: 40)
          const entityBoxWidth = 120;
          const entityBoxHeight = 120;
          const headerHeight = 40;
          const entityHeight = position.showAttributes
            ? headerHeight + (ent.attributes.length * 20) + 20
            : headerHeight;

          return (
            <g
              key={entityId}
              transform={`translate(${position.x}, ${position.y})`}
              style={{ cursor: dragState.isDragging && dragState.entityId === entityId ? 'grabbing' : 'grab' }}
              onMouseDown={(e) => handleMouseDown(e, entityId)}
              onClick={(e) => {
                // Only navigate if the entity wasn't dragged
                if (!isDraggingRef.current) {
                  navigate(`/services/${svc}/entities/${ent.name}`);
                }
                // Reset the dragging flag after click
                isDraggingRef.current = false;
              }}
            >
              {/* Entity box */}
              {/* Only render the main box if attributes are shown */}
              {position.showAttributes && (
                <rect
                  width="300"
                  height={entityHeight}
                  fill="white"
                  stroke="#d1d5db"
                  strokeWidth="2"
                  rx="8"
                  className="hover:stroke-blue-400 transition-colors"
                />
              )}

              {/* Always render the header */}
              <rect
                width="300"
                height="40"
                fill="#f3f4f6"
                stroke="#d1d5db"
                strokeWidth="1"
                rx="8"
                className="hover:fill-blue-50 transition-colors"
              />

              {/* Entity title with truncation and tooltip */}
              <text
                x={entityBoxWidth / 2 - 20}
                y="25"
                textAnchor="middle"
                fontSize="14"
                fontWeight="bold"
                fill="#1f2937"
                className="pointer-events-none"
                style={{
                  maxWidth: entityBoxWidth - 48,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  display: 'inline-block'
                }}
              >
                <title>{svc}/{ent.name}</title>
                {`${svc}/${ent.name}`.length > 28
                  ? `${ent.name}`.slice(0, 25) + '...'
                  : `${ent.name}`}
              </text>

              {/* Attributes */}
              {position.showAttributes && ent.attributes.map((attr, index) => (
                <g key={attr.uuid}>
                  <text
                    x="10"
                    y={headerHeight + 20 + index * 20}
                    fontSize="12"
                    fill="#374151"
                    className="pointer-events-none"
                  >
                    <tspan fontWeight={attr.required ? "bold" : "normal"}>
                      {attr.name}: {attr.type}
                      {attr.required && " *"}
                    </tspan>
                  </text>
                </g>
              ))}

              {/* Toggle attributes button */}
              <circle
                cx={entityBoxWidth - 16}
                cy={headerHeight / 2}
                r="8"
                fill="#6b7280"
                className="hover:fill-blue-500 transition-colors cursor-pointer"
                onClick={(e) => {
                  e.stopPropagation();
                  handleContextMenuAction('toggleAttributes', ent);
                }}
              />
              <text
                x={entityBoxWidth - 16}
                y={headerHeight / 2 + 4}
                textAnchor="middle"
                fontSize="10"
                fill="white"
                className="pointer-events-none"
              >
                {position.showAttributes ? '−' : '+'}
              </text>
            </g>
          );
        })}
      </svg>
    );
  };

  // Helper to get the service for the tooltip/context-menu entity
  const getTooltipEntityService = (ent: Entity): string => {
    return entityServiceMap[ent.uuid] || service || '';
  };

  return (
    <div className="card bg-base-100 shadow-xl h-full">
      <div className="card-body p-4 flex flex-col">
        {/* Toolbar row */}
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <h2 className="card-title text-lg mr-auto">
            {service && entity
              ? `ER Diagram: ${entity}`
              : service
                ? `ER Diagram: ${service}`
                : 'Entity Relationship Diagram'
            }
          </h2>

          {/* Primary controls */}
          <div className="flex items-center gap-1">
            <button
              className={`btn btn-xs ${useMermaid ? 'btn-primary' : 'btn-outline'}`}
              onClick={toggleDiagramMode}
              title={useMermaid ? 'Switch to Interactive' : 'Switch to Mermaid'}
            >
              {useMermaid ? 'Mermaid' : 'Interactive'}
            </button>

            <button
              className={`btn btn-xs btn-square ${showAttributes ? 'btn-primary' : 'btn-outline'}`}
              onClick={toggleShowAttributes}
              title={showAttributes ? 'Hide Attributes' : 'Show Attributes'}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M3 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z" clipRule="evenodd" />
              </svg>
            </button>

            {!useMermaid && (
              <>
                {/* Layout algorithm dropdown */}
                <div className="dropdown dropdown-end">
                  <label tabIndex={0} className="btn btn-xs btn-outline">
                    {layoutAlgorithm.charAt(0).toUpperCase() + layoutAlgorithm.slice(1)}
                  </label>
                  <ul tabIndex={0} className="dropdown-content z-[1] menu p-2 shadow bg-base-100 rounded-box w-44">
                    <li><a onClick={() => setLayoutAlgorithm('grid')} className={layoutAlgorithm === 'grid' ? 'active' : ''}>Grid</a></li>
                    <li><a onClick={() => setLayoutAlgorithm('circular')} className={layoutAlgorithm === 'circular' ? 'active' : ''}>Circular</a></li>
                    <li><a onClick={() => setLayoutAlgorithm('force')} className={layoutAlgorithm === 'force' ? 'active' : ''}>Force-Directed</a></li>
                  </ul>
                </div>

                <button
                  className={`btn btn-xs btn-square ${showMicroserviceGroups ? 'btn-primary' : 'btn-outline'}`}
                  onClick={() => setShowMicroserviceGroups(!showMicroserviceGroups)}
                  title="Toggle Microservice Grouping"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                    <path d="M5 3a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2V5a2 2 0 00-2-2H5zM5 11a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2v-2a2 2 0 00-2-2H5zM11 5a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V5zM11 13a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
                  </svg>
                </button>

                <button
                  className="btn btn-xs btn-square btn-outline"
                  onClick={resetLayout}
                  title="Reset Layout"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clipRule="evenodd" />
                  </svg>
                </button>

                {/* Save/Load layout dropdown */}
                <div className="dropdown dropdown-end">
                  <label tabIndex={0} className="btn btn-xs btn-square btn-outline" title="Layouts">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" />
                    </svg>
                  </label>
                  <ul tabIndex={0} className="dropdown-content z-[1] menu p-2 shadow bg-base-100 rounded-box w-52">
                    <li className="menu-title">
                      <span>Save Current Layout</span>
                    </li>
                    <li>
                      <a onClick={() => {
                        const name = prompt('Enter layout name:');
                        if (name) saveCurrentLayout(name);
                      }}>
                        Save As...
                      </a>
                    </li>

                    {savedLayouts.length > 0 && (
                      <>
                        <li className="menu-title">
                          <span>Load Layout</span>
                        </li>
                        {savedLayouts.map(layout => (
                          <li key={layout.id}>
                            <a
                              onClick={() => loadLayout(layout.id)}
                              className={currentLayoutId === layout.id ? 'active' : ''}
                            >
                              {layout.name}
                            </a>
                          </li>
                        ))}
                      </>
                    )}
                  </ul>
                </div>
              </>
            )}
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center items-center flex-1 min-h-[400px]">
            <span className="loading loading-spinner loading-lg"></span>
          </div>
        ) : error ? (
          <div className="alert alert-error">
            <svg xmlns="http://www.w3.org/2000/svg" className="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>{error}</span>
          </div>
        ) : (
          <div className="relative overflow-auto border border-base-300 rounded-lg p-4 flex-1 min-h-[400px]">
            {/* Zoom controls - bottom-right overlay */}
            <div className="absolute bottom-3 right-3 z-10 flex items-center gap-1 bg-base-100/90 backdrop-blur-sm rounded-lg border border-base-300 p-1 shadow-sm">
              <button
                className="btn btn-circle btn-xs btn-ghost"
                onClick={handleZoomOut}
                title="Zoom Out"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M5 10a1 1 0 011-1h8a1 1 0 110 2H6a1 1 0 01-1-1z" clipRule="evenodd" />
                </svg>
              </button>
              <span className="text-xs font-mono min-w-[3ch] text-center">{Math.round(zoom * 100)}%</span>
              <button
                className="btn btn-circle btn-xs btn-ghost"
                onClick={handleZoomIn}
                title="Zoom In"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M10 5a1 1 0 011 1v3h3a1 1 0 110 2h-3v3a1 1 0 11-2 0v-3H6a1 1 0 110-2h3V6a1 1 0 011-1z" clipRule="evenodd" />
                </svg>
              </button>
              <button
                className="btn btn-circle btn-xs btn-ghost"
                onClick={handleResetZoom}
                title="Reset Zoom"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clipRule="evenodd" />
                </svg>
              </button>
            </div>
            {useMermaid ? (
              <div
                ref={diagramRef}
                className="mermaid-diagram"
                style={{
                  transform: `scale(${zoom})`,
                  transformOrigin: 'top left',
                  transition: 'transform 0.2s ease'
                }}
              />
            ) : (
              <div
                ref={diagramRef}
                className="interactive-diagram"
                style={{
                  transform: `scale(${zoom})`,
                  transformOrigin: 'top left',
                  transition: 'transform 0.2s ease'
                }}
              >
                {renderCustomDiagram()}
              </div>
            )}

            {/* Entity Tooltip */}
            {tooltip.visible && (
              <div
                className="absolute z-50 bg-base-100 border border-base-300 rounded-lg shadow-lg p-3 max-w-xs"
                style={{
                  left: tooltip.x - 150,
                  top: tooltip.y - 10,
                  transform: 'translateY(-100%)'
                }}
              >
                <div className="font-semibold text-sm mb-1">
                  {getTooltipEntityService(tooltip.entity)}/{tooltip.entity.name}
                </div>
                <div className="text-xs text-base-content/70 mb-2">
                  {tooltip.entity.description}
                </div>
                <div className="text-xs">
                  <div className="mb-1">
                    <span className="font-medium">Attributes:</span> {tooltip.entity.attributes?.length || 0}
                  </div>
                  <div>
                    <span className="font-medium">Relationships:</span> {tooltip.entity.uuid ? getEntityRelationships(tooltip.entity.uuid).length : 0}
                  </div>
                </div>
                <div className="text-xs text-primary mt-2">
                  Click to view details - Right-click for options
                </div>
              </div>
            )}

            {/* Context Menu */}
            {contextMenu.visible && (
              <div
                className="absolute z-50 bg-base-100 border border-base-300 rounded-lg shadow-lg py-1 min-w-48"
                style={{
                  left: contextMenu.x,
                  top: contextMenu.y
                }}
              >
                <button
                  className="w-full px-4 py-2 text-left text-sm hover:bg-base-200 flex items-center gap-2"
                  onClick={() => handleContextMenuAction('view', contextMenu.entity)}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                  View Entity Details
                </button>
                <button
                  className="w-full px-4 py-2 text-left text-sm hover:bg-base-200 flex items-center gap-2"
                  onClick={() => handleContextMenuAction('edit', contextMenu.entity)}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                  Edit Entity
                </button>
                <hr className="my-1 border-base-300" />
                <button
                  className="w-full px-4 py-2 text-left text-sm hover:bg-base-200 flex items-center gap-2"
                  onClick={() => handleContextMenuAction('viewService', contextMenu.entity)}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                  </svg>
                  View Service: {getTooltipEntityService(contextMenu.entity)}
                </button>
                <button
                  className="w-full px-4 py-2 text-left text-sm hover:bg-base-200 flex items-center gap-2"
                  onClick={() => handleContextMenuAction('viewRelated', contextMenu.entity)}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                  </svg>
                  View Related Entities
                </button>
                <hr className="my-1 border-base-300" />
                <button
                  className="w-full px-4 py-2 text-left text-sm hover:bg-base-200 flex items-center gap-2"
                  onClick={() => handleContextMenuAction('copyLink', contextMenu.entity)}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                  Copy Link
                </button>
              </div>
            )}
          </div>
        )}

        {/* Help text */}
        <div className="text-xs text-base-content/60 mt-2">
          {useMermaid
            ? 'Click entities to view details, right-click for more options, hover for quick info. Use the "Show/Hide Attributes" button to toggle attribute visibility.'
            : 'Drag entities to move them around, click to view details, right-click for options. Try different layout algorithms (Grid, Circular, Force-Directed) and toggle microservice grouping for better visualization. Save your layouts for future use. Cardinality indicators (1, N) are shown on relationship lines.'
          }
        </div>
      </div>
    </div>
  );
};

export default VisualizationComponent;
