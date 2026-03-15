import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import mermaid from 'mermaid';
import { servicesApi, diagramApi } from '../services/api';
import { Entity, EntityRelationship, RelationshipType, DiagramLayout } from '../types';

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
      
      // Get unique microservices
      const microservices = [...new Set(entities.map(e => e.microservice))];
      
      // Assign colors to each microservice
      microservices.forEach((service, index) => {
        colors[service] = baseColors[index % baseColors.length];
      });
      
      setMicroserviceColors(colors);
    };
    
    if (entities.length > 0) {
      generateMicroserviceColors();
    }
  }, [entities]);

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
        
        if (service && entity) {
          // Fetch single entity and related entities
          const entityResponse = await servicesApi.getEntitySchema(service, entity);
          const mainEntity = entityResponse.data;
          fetchedEntities = [mainEntity];
          
          // Fetch related entities
          if (mainEntity.relationships && mainEntity.relationships.length > 0) {
            const relatedEntitiesPromises = mainEntity.relationships.map(async (rel: EntityRelationship) => {
              const [targetService, targetEntity] = rel.target.split('.');
              if (showCrossServiceRelationships || targetService === service) {
                try {
                  const relatedResponse = await servicesApi.getEntitySchema(targetService, targetEntity);
                  return relatedResponse.data;
                } catch (err) {
                  console.warn(`Could not fetch related entity: ${rel.target}`, err);
                  return null;
                }
              }
              return null;
            });
            
            const relatedEntities = await Promise.all(relatedEntitiesPromises);
            fetchedEntities = [...fetchedEntities, ...relatedEntities.filter(Boolean)];
          }
        } else if (service) {
          // Fetch all entities for a service
          const entitiesResponse = await servicesApi.getServiceEntities(service);
          fetchedEntities = entitiesResponse.data;
        } else {
          // No service specified - fetch all services and their entities
          const servicesResponse = await servicesApi.getAllServices();
          const services = servicesResponse.data || servicesResponse;
          
          if (services && services.length > 0) {
            // Fetch entities for all services
            const allEntitiesPromises = services.map(async (serviceName: string) => {
              try {
                const entitiesResponse = await servicesApi.getServiceEntities(serviceName);
                return entitiesResponse.data || entitiesResponse;
              } catch (err) {
                console.warn(`Could not fetch entities for service: ${serviceName}`, err);
                return [];
              }
            });
            
            const allEntitiesArrays = await Promise.all(allEntitiesPromises);
            fetchedEntities = allEntitiesArrays.flat();
          } else {
            throw new Error('No services found');
          }
        }
        
        // Store entities for linking functionality
        setEntities(fetchedEntities);
        
        // Initialize entity positions if not already set
        const initialPositions: Record<string, EntityPosition> = {};
        
        // Apply layout algorithm
        if (layoutAlgorithm === 'grid') {
          // Group entities by microservice for better organization
          const serviceGroups: Record<string, Entity[]> = {};
          fetchedEntities.forEach(entity => {
            if (!serviceGroups[entity.microservice]) {
              serviceGroups[entity.microservice] = [];
            }
            serviceGroups[entity.microservice].push(entity);
          });
          
          // Position entities in a grid, grouped by microservice
          let rowOffset = 0;
          Object.entries(serviceGroups).forEach(([service, serviceEntities]) => {
            serviceEntities.forEach((entity, index) => {
              const entityId = `${entity.microservice}_${entity.name}`;
              if (!entityPositions[entityId]) {
                initialPositions[entityId] = {
                  x: 100 + (index % 3) * 350,
                  y: 150 + rowOffset + Math.floor(index / 3) * 250,
                  showAttributes: false
                };
              }
            });
            // Add vertical spacing between microservice groups
            rowOffset += Math.ceil(serviceEntities.length / 3) * 250 + 100;
          });
        } else if (layoutAlgorithm === 'circular') {
          // Position entities in a circle
          const centerX = 600;
          const centerY = 400;
          const radius = Math.min(fetchedEntities.length * 30, 350);
          
          fetchedEntities.forEach((entity, index) => {
            const entityId = `${entity.microservice}_${entity.name}`;
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
          fetchedEntities.forEach((entity, index) => {
            const entityId = `${entity.microservice}_${entity.name}`;
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
              const entityId1 = `${fetchedEntities[i].microservice}_${fetchedEntities[i].name}`;
              const pos1 = initialPositions[entityId1] || { x: 0, y: 0, showAttributes: false };
              
              for (let j = i + 1; j < fetchedEntities.length; j++) {
                const entityId2 = `${fetchedEntities[j].microservice}_${fetchedEntities[j].name}`;
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
            
            // Attractive forces between related entities
            fetchedEntities.forEach(entity => {
              const sourceId = `${entity.microservice}_${entity.name}`;
              const sourcePos = initialPositions[sourceId];
              
              if (entity.relationships) {
                entity.relationships.forEach(rel => {
                  const [targetService, targetEntity] = rel.target.split('.');
                  const targetId = `${targetService}_${targetEntity}`;
                  const targetPos = initialPositions[targetId];
                  
                  if (targetPos) {
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
            });
          }
        }
        
        setEntityPositions(prev => ({ ...prev, ...initialPositions }));
        
        // Generate diagram based on mode
        if (useMermaid) {
          const diagram = generateERDiagram(fetchedEntities);
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
        const [entityService, entityName] = entityText.split(separator);
        const entityData = entities.find(e => e.microservice === entityService && e.name === entityName);
        
        if (entityService && entityName && entityData) {
          console.log(`Setting up interactions for: ${entityService}${separator}${entityName}`);
          
          // Add cursor pointer
          (element as HTMLElement).style.cursor = 'pointer';
          
          // Click handler - navigate to entity detail
          element.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            console.log(`Navigating to: /services/${entityService}/entities/${entityName}`);
            navigate(`/services/${entityService}/entities/${entityName}`);
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
          console.log(`No entity data found for: ${entityService}/${entityName}`);
        }
      }
    });
  };

  // Handle context menu actions
  const handleContextMenuAction = (action: string, entity: Entity) => {
    setContextMenu(prev => ({ ...prev, visible: false }));
    
    switch (action) {
      case 'view':
        navigate(`/services/${entity.microservice}/entities/${entity.name}`);
        break;
      case 'edit':
        navigate(`/services/${entity.microservice}/entities/${entity.name}/edit`);
        break;
      case 'viewService':
        navigate(`/services/${entity.microservice}`);
        break;
      case 'viewRelated':
        // Show only this entity and its relationships
        navigate(`/diagram/${entity.microservice}/${entity.name}`);
        break;
      case 'copyLink':
        const link = `${window.location.origin}/services/${entity.microservice}/entities/${entity.name}`;
        navigator.clipboard.writeText(link);
        break;
      case 'toggleAttributes':
        const entityId = `${entity.microservice}_${entity.name}`;
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
  const generateERDiagram = (entities: Entity[]): string => {
    let diagram = 'erDiagram\n';
    
    // Helper function to create valid Mermaid entity IDs
    const createEntityId = (microservice: string, name: string): string => {
      return `${microservice}_${name}`.replace(/[^a-zA-Z0-9_]/g, '_');
    };
    
    // Add entities (show only entity name, not service/name)
    entities.forEach(entity => {
      const entityId = createEntityId(entity.microservice, entity.name);
      const displayName = entity.name;
      
      diagram += `  ${entityId}["${displayName}"]`;
      
      // Add attributes only if showAttributes is true
      if (showAttributes && entity.attributes && entity.attributes.length > 0) {
        diagram += ` {\n`;
        entity.attributes.forEach(attr => {
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
    
    // Add relationships
    entities.forEach(entity => {
      const sourceId = createEntityId(entity.microservice, entity.name);
      
      if (entity.relationships) {
        entity.relationships.forEach(rel => {
          const [targetService, targetEntity] = rel.target.split('.');
          const targetId = createEntityId(targetService, targetEntity);
          
          // Skip if target entity is not in our diagram (when not showing cross-service relationships)
          if (!showCrossServiceRelationships && !entities.some(e => createEntityId(e.microservice, e.name) === targetId)) {
            return;
          }
          
          let relationSymbol: string;
          
          switch (rel.type) {
            case RelationshipType.HAS_ONE:
              relationSymbol = '||--o|';
              break;
            case RelationshipType.HAS_MANY:
              relationSymbol = '||--|{';
              break;
            case RelationshipType.BELONGS_TO:
              relationSymbol = '|o--||';
              break;
            case RelationshipType.MANY_TO_MANY:
              relationSymbol = '}|--|{';
              break;
            default:
              relationSymbol = '||--o|';
          }
          
          diagram += `  ${sourceId} ${relationSymbol} ${targetId} : "${rel.name}"\n`;
        });
      }
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
      // Group entities by microservice
      const serviceGroups: Record<string, Entity[]> = {};
      entities.forEach(entity => {
        if (!serviceGroups[entity.microservice]) {
          serviceGroups[entity.microservice] = [];
        }
        serviceGroups[entity.microservice].push(entity);
      });
      
      // Position entities in a grid, grouped by microservice
      let rowOffset = 0;
      Object.entries(serviceGroups).forEach(([service, serviceEntities]) => {
        serviceEntities.forEach((entity, index) => {
          const entityId = `${entity.microservice}_${entity.name}`;
          resetPositions[entityId] = {
            x: 100 + (index % 3) * 350,
            y: 150 + rowOffset + Math.floor(index / 3) * 250,
            showAttributes: showAttributes
          };
        });
        // Add vertical spacing between microservice groups
        rowOffset += Math.ceil(serviceEntities.length / 3) * 250 + 100;
      });
    } else if (layoutAlgorithm === 'circular') {
      // Position entities in a circle
      const centerX = 600;
      const centerY = 400;
      const radius = Math.min(entities.length * 30, 350);
      
      entities.forEach((entity, index) => {
        const entityId = `${entity.microservice}_${entity.name}`;
        const angle = (index / entities.length) * 2 * Math.PI;
        resetPositions[entityId] = {
          x: centerX + radius * Math.cos(angle),
          y: centerY + radius * Math.sin(angle),
          showAttributes: showAttributes
        };
      });
    } else if (layoutAlgorithm === 'force') {
      // Start with random positions
      entities.forEach((entity, index) => {
        const entityId = `${entity.microservice}_${entity.name}`;
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
          const entityId1 = `${entities[i].microservice}_${entities[i].name}`;
          const pos1 = resetPositions[entityId1];
          
          for (let j = i + 1; j < entities.length; j++) {
            const entityId2 = `${entities[j].microservice}_${entities[j].name}`;
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
        entities.forEach(entity => {
          const sourceId = `${entity.microservice}_${entity.name}`;
          const sourcePos = resetPositions[sourceId];
          
          if (entity.relationships) {
            entity.relationships.forEach(rel => {
              const [targetService, targetEntity] = rel.target.split('.');
              const targetId = `${targetService}_${targetEntity}`;
              const targetPos = resetPositions[targetId];
              
              if (targetPos) {
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
          const [microservice, name] = entityId.split('_');
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
        {entities.map(entity => {
          const sourceId = `${entity.microservice}_${entity.name}`;
          const sourcePos = entityPositions[sourceId];
          if (!sourcePos) return null;

          return entity.relationships?.map(rel => {
            const [targetService, targetEntity] = rel.target.split('/');
            const targetId = `${targetService}_${targetEntity}`;
            const targetPos = entityPositions[targetId];
            
            if (!targetPos || (!showCrossServiceRelationships && targetService !== entity.microservice)) {
              return null;
            }

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
            
            // Determine marker based on relationship type
            let markerEnd = '';
            let strokeDasharray = '';
            let relationshipSymbol = '';
            
            switch (rel.type) {
              case RelationshipType.HAS_ONE:
                markerEnd = 'url(#arrowhead-one)';
                relationshipSymbol = '1';
                break;
              case RelationshipType.HAS_MANY:
                markerEnd = 'url(#arrowhead-many)';
                relationshipSymbol = '*';
                break;
              case RelationshipType.BELONGS_TO:
                markerEnd = 'url(#arrowhead-belongs)';
                strokeDasharray = '5,5';
                relationshipSymbol = '1';
                break;
              case RelationshipType.MANY_TO_MANY:
                markerEnd = 'url(#arrowhead-many)';
                relationshipSymbol = '*';
                break;
              default:
                markerEnd = 'url(#arrowhead)';
            }
            
            // Determine line color based on whether it's cross-service
            const lineColor = targetService !== entity.microservice
              ? '#9333ea' // Purple for cross-service
              : '#6b7280'; // Gray for same service

            return (
              <g key={`${sourceId}-${targetId}-${rel.name}`}>
                <path
                  d={path}
                  fill="none"
                  stroke={lineColor}
                  strokeWidth="2"
                  strokeDasharray={strokeDasharray}
                  markerEnd={markerEnd}
                />
                
                {/* Relationship name */}
                <text
                  x={midX + perpX}
                  y={midY + perpY - 10}
                  textAnchor="middle"
                  fontSize="12"
                  fill="#374151"
                  className="pointer-events-none"
                >
                  {rel.name}
                </text>
                
                {/* Cardinality indicators */}
                <text
                  x={sourceX + dx * 0.15}
                  y={sourceY + dy * 0.15 - 5}
                  textAnchor="middle"
                  fontSize="14"
                  fontWeight="bold"
                  fill="#374151"
                  className="pointer-events-none"
                >
                  {rel.type === RelationshipType.BELONGS_TO || rel.type === RelationshipType.MANY_TO_MANY ? '*' : '1'}
                </text>
                
                <text
                  x={targetX - dx * 0.15}
                  y={targetY - dy * 0.15 - 5}
                  textAnchor="middle"
                  fontSize="14"
                  fontWeight="bold"
                  fill="#374151"
                  className="pointer-events-none"
                >
                  {relationshipSymbol}
                </text>
              </g>
            );
          });
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
          
          {/* Has-one relationship */}
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
          
          {/* Has-many relationship */}
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
          
          {/* Belongs-to relationship */}
          <marker
            id="arrowhead-belongs"
            markerWidth="10"
            markerHeight="7"
            refX="9"
            refY="3.5"
            orient="auto"
          >
            <polygon
              points="0 0, 10 3.5, 0 7"
              fill="#10b981"
            />
          </marker>
        </defs>

        {/* Render entities */}
        {entities.map(entity => {
          const entityId = `${entity.microservice}_${entity.name}`;
          const position = entityPositions[entityId];
          if (!position) return null;

          // Make the box closer to a square: width 120, height 120 (header: 40)
          const entityBoxWidth = 120;
          const entityBoxHeight = 120;
          const headerHeight = 40;
          const entityHeight = position.showAttributes
            ? headerHeight + (entity.attributes.length * 20) + 20
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
                  navigate(`/services/${entity.microservice}/entities/${entity.name}`);
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
              
              {/* Entity title */}
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
                <title>{entity.microservice}/{entity.name}</title>
                {`${entity.microservice}/${entity.name}`.length > 28
                  ? `${entity.name}`.slice(0, 25) + '...'
                  : `${entity.name}`}
              </text>

              {/* Attributes */}
              {position.showAttributes && entity.attributes.map((attr, index) => (
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
                  handleContextMenuAction('toggleAttributes', entity);
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
                  {tooltip.entity.microservice}/{tooltip.entity.name}
                </div>
                <div className="text-xs text-base-content/70 mb-2">
                  {tooltip.entity.description}
                </div>
                <div className="text-xs">
                  <div className="mb-1">
                    <span className="font-medium">Attributes:</span> {tooltip.entity.attributes?.length || 0}
                  </div>
                  <div>
                    <span className="font-medium">Relationships:</span> {tooltip.entity.relationships?.length || 0}
                  </div>
                </div>
                <div className="text-xs text-primary mt-2">
                  Click to view details • Right-click for options
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
                  View Service: {contextMenu.entity.microservice}
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
          💡 {useMermaid
            ? 'Click entities to view details, right-click for more options, hover for quick info. Use the "Show/Hide Attributes" button to toggle attribute visibility.'
            : 'Drag entities to move them around, click to view details, right-click for options. Try different layout algorithms (Grid, Circular, Force-Directed) and toggle microservice grouping for better visualization. Save your layouts for future use. Different relationship types are color-coded with cardinality indicators.'
          }
        </div>
      </div>
    </div>
  );
};

export default VisualizationComponent;