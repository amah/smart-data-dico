import { useState, useEffect } from 'react';
import { servicesApi, relationshipApi } from '../services/api';
import type { Entity, Relationship, GraphNode, GraphEdge } from '../types';

interface FetchGraphDataResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
  loading: boolean;
  error: string | null;
  services: string[];
}

export function useFetchGraphData(service?: string, entity?: string): FetchGraphDataResult {
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [edges, setEdges] = useState<GraphEdge[]>([]);
  const [services, setServices] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const fetchData = async () => {
      try {
        setLoading(true);
        setError(null);

        const allEntities: Entity[] = [];
        const allRelationships: Relationship[] = [];
        const entityServiceMap: Record<string, string> = {};
        const serviceList: string[] = [];

        if (service && entity) {
          // Single entity + its relationships
          const entityResponse = await servicesApi.getEntitySchema(service, entity);
          const mainEntity = entityResponse.data;
          allEntities.push(mainEntity);
          entityServiceMap[mainEntity.uuid] = service;
          serviceList.push(service);

          try {
            const rels = await relationshipApi.getPackageRelationships(service);
            allRelationships.push(...rels);

            // Fetch related entities
            const relatedUuids = new Set<string>();
            rels.forEach((rel) => {
              if (rel.source.entity === mainEntity.uuid) relatedUuids.add(rel.target.entity);
              if (rel.target.entity === mainEntity.uuid) relatedUuids.add(rel.source.entity);
            });

            if (relatedUuids.size > 0) {
              const svcEntitiesResp = await servicesApi.getServiceEntities(service);
              const svcEntities = (svcEntitiesResp.data || []) as Entity[];
              for (const e of svcEntities) {
                if (relatedUuids.has(e.uuid) && !allEntities.find((x) => x.uuid === e.uuid)) {
                  allEntities.push(e);
                  entityServiceMap[e.uuid] = service;
                }
              }
            }
          } catch {
            // Relationships may not exist
          }
        } else if (service) {
          // All entities for one service
          const entitiesResponse = await servicesApi.getServiceEntities(service);
          const svcEntities = (entitiesResponse.data || []) as Entity[];
          allEntities.push(...svcEntities);
          svcEntities.forEach((e) => { entityServiceMap[e.uuid] = service; });
          serviceList.push(service);

          try {
            const rels = await relationshipApi.getPackageRelationships(service);
            allRelationships.push(...rels);
          } catch {
            // ok
          }
        } else {
          // All services
          const servicesResponse = await servicesApi.getAllServices();
          const svcNames = (servicesResponse.data || servicesResponse) as string[];

          const results = await Promise.all(
            svcNames.map(async (svcName: string) => {
              try {
                const entResp = await servicesApi.getServiceEntities(svcName);
                const ents = (entResp.data || []) as Entity[];
                ents.forEach((e) => { entityServiceMap[e.uuid] = svcName; });

                let rels: Relationship[] = [];
                try {
                  rels = await relationshipApi.getPackageRelationships(svcName);
                } catch {
                  // ok
                }
                return { entities: ents, relationships: rels, service: svcName };
              } catch {
                return { entities: [], relationships: [], service: svcName };
              }
            }),
          );

          for (const r of results) {
            allEntities.push(...r.entities);
            allRelationships.push(...r.relationships);
            if (r.entities.length > 0) serviceList.push(r.service);
          }
        }

        if (cancelled) return;

        // Build graph nodes
        const graphNodes: GraphNode[] = allEntities.map((e) => ({
          id: e.uuid,
          label: e.name,
          type: 'entity' as const,
          service: entityServiceMap[e.uuid] || '',
          data: e,
        }));

        // Build graph edges
        const entityUuids = new Set(allEntities.map((e) => e.uuid));
        const graphEdges: GraphEdge[] = allRelationships
          .filter((rel) => entityUuids.has(rel.source.entity) && entityUuids.has(rel.target.entity))
          .map((rel) => {
            const srcEntity = allEntities.find((e) => e.uuid === rel.source.entity);
            const tgtEntity = allEntities.find((e) => e.uuid === rel.target.entity);
            return {
              id: rel.uuid,
              source: rel.source.entity,
              target: rel.target.entity,
              label: rel.description || `${srcEntity?.name || '?'} -> ${tgtEntity?.name || '?'}`,
              sourceCardinality: rel.source.cardinality,
              targetCardinality: rel.target.cardinality,
            };
          });

        setNodes(graphNodes);
        setEdges(graphEdges);
        setServices(serviceList);
      } catch (err: any) {
        if (!cancelled) {
          setError(err.message || 'Failed to fetch graph data');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    fetchData();
    return () => { cancelled = true; };
  }, [service, entity]);

  return { nodes, edges, loading, error, services };
}
