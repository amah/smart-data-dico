import { Perspective, ResolvedNode, ResolvedPerspective, PerspectiveNode, Relationship } from '../models/EntitySchema.js';
import { listPerspectives, readPerspectiveFile, writePerspectiveFile, deletePerspectiveFile, getAllRelationships, listAllEntities, readEntityFile } from '../utils/fileOperations.js';
import { generateUUID } from '../utils/uuid.js';
import { logger } from '../utils/logger.js';

interface AdjacencyEntry {
  neighborUuid: string;
  navName: string;
}

interface EntityInfo {
  uuid: string;
  name: string;
  service: string;
}

class PerspectiveService {
  // --- CRUD ---

  async getAll(): Promise<Perspective[]> {
    return listPerspectives();
  }

  async getById(uuid: string): Promise<Perspective | null> {
    return readPerspectiveFile(uuid);
  }

  async create(data: Partial<Perspective>): Promise<{ success: boolean; perspective?: Perspective; errors?: string[] }> {
    if (!data.name) return { success: false, errors: ['Name is required'] };
    if (!data.rootEntities?.length) return { success: false, errors: ['At least one root entity is required'] };

    const perspective: Perspective = {
      uuid: data.uuid || generateUUID(),
      name: data.name,
      description: data.description,
      rootEntities: data.rootEntities,
      nodes: data.nodes || [],
      maxDepth: data.maxDepth ?? 10,
      metadata: data.metadata || [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const ok = await writePerspectiveFile(perspective);
    if (!ok) return { success: false, errors: ['Failed to write perspective file'] };
    return { success: true, perspective };
  }

  async update(uuid: string, data: Partial<Perspective>): Promise<{ success: boolean; perspective?: Perspective; errors?: string[] }> {
    const existing = await readPerspectiveFile(uuid);
    if (!existing) return { success: false, errors: ['Perspective not found'] };

    const updated: Perspective = {
      ...existing,
      name: data.name ?? existing.name,
      description: data.description ?? existing.description,
      rootEntities: data.rootEntities ?? existing.rootEntities,
      nodes: data.nodes ?? existing.nodes,
      maxDepth: data.maxDepth ?? existing.maxDepth,
      metadata: data.metadata ?? existing.metadata,
      updatedAt: new Date().toISOString(),
    };

    const ok = await writePerspectiveFile(updated);
    if (!ok) return { success: false, errors: ['Failed to write perspective file'] };
    return { success: true, perspective: updated };
  }

  async delete(uuid: string): Promise<{ success: boolean; errors?: string[] }> {
    const ok = await deletePerspectiveFile(uuid);
    if (!ok) return { success: false, errors: ['Perspective not found'] };
    return { success: true };
  }

  // --- Node (annotation) management ---

  async upsertNode(uuid: string, node: PerspectiveNode): Promise<{ success: boolean; errors?: string[] }> {
    const perspective = await readPerspectiveFile(uuid);
    if (!perspective) return { success: false, errors: ['Perspective not found'] };

    const nodes = perspective.nodes || [];
    const idx = nodes.findIndex(n => n.path === node.path);
    if (idx >= 0) {
      nodes[idx] = node;
    } else {
      nodes.push(node);
    }
    perspective.nodes = nodes;
    perspective.updatedAt = new Date().toISOString();

    const ok = await writePerspectiveFile(perspective);
    if (!ok) return { success: false, errors: ['Failed to write'] };
    return { success: true };
  }

  // --- BFS Resolution ---

  async resolve(uuid: string): Promise<ResolvedPerspective | null> {
    const perspective = await readPerspectiveFile(uuid);
    if (!perspective) return null;

    // Build entity info map: uuid → { name, service }
    const entityMap = await this.buildEntityMap();

    // Build adjacency map from all relationships
    const adjacency = await this.buildAdjacencyMap();

    // Build node lookup for exclude/traverse checks
    const nodesByPath = new Map<string, PerspectiveNode>();
    for (const node of perspective.nodes || []) {
      nodesByPath.set(node.path, node);
    }

    const maxDepth = perspective.maxDepth ?? 10;
    const resolvedNodes: ResolvedNode[] = [];

    // BFS from each root entity
    const queue: { entityUuid: string; hopDistance: number; pathSegments: string[] }[] = [];

    for (const rootUuid of perspective.rootEntities) {
      const info = entityMap.get(rootUuid);
      if (!info) continue;
      queue.push({ entityUuid: rootUuid, hopDistance: 0, pathSegments: [info.name] });
    }

    // Track visited paths (not UUIDs — same entity via different paths is allowed)
    const visitedPaths = new Set<string>();

    while (queue.length > 0) {
      const { entityUuid, hopDistance, pathSegments } = queue.shift()!;
      const currentPath = pathSegments.join('/');

      // Skip if already visited this exact path
      if (visitedPaths.has(currentPath)) continue;
      visitedPaths.add(currentPath);

      // Check for exclusion
      const node = nodesByPath.get(currentPath);
      if (node?.exclude) continue;

      // Check depth
      if (hopDistance > maxDepth) continue;

      const info = entityMap.get(entityUuid);
      if (!info) continue;

      const isFrontier = node?.traverse === false;

      resolvedNodes.push({
        entityUuid,
        entityName: info.name,
        service: info.service,
        path: currentPath,
        hopDistance,
        isRoot: hopDistance === 0,
        isFrontier,
        isManualInclusion: false,
      });

      // Don't traverse further from frontier nodes
      if (isFrontier) continue;

      // Enqueue neighbors
      const neighbors = adjacency.get(entityUuid) || [];
      for (const { neighborUuid, navName } of neighbors) {
        const neighborInfo = entityMap.get(neighborUuid);
        if (!neighborInfo) continue;
        const newPath = [...pathSegments, navName];
        const newPathStr = newPath.join('/');

        // Check if this path prefix is excluded
        const prefixNode = nodesByPath.get(newPathStr);
        if (prefixNode?.exclude) continue;

        queue.push({
          entityUuid: neighborUuid,
          hopDistance: hopDistance + 1,
          pathSegments: newPath,
        });
      }
    }

    return { ...perspective, resolvedNodes };
  }

  // --- Graph Data ---

  async getGraphData(uuid: string): Promise<{ nodes: any[]; edges: any[] } | null> {
    const resolved = await this.resolve(uuid);
    if (!resolved) return null;

    // Deduplicate entities for graph display (same entity shown once as node)
    const entityUuids = new Set(resolved.resolvedNodes.map(n => n.entityUuid));
    const entityMap = await this.buildEntityMap();

    const nodes = [...entityUuids].map(eUuid => {
      const info = entityMap.get(eUuid);
      const resolvedNode = resolved.resolvedNodes.find(n => n.entityUuid === eUuid);
      return {
        id: eUuid,
        label: info?.name || eUuid,
        type: 'entity',
        service: info?.service || '',
        isRoot: resolvedNode?.isRoot || false,
        isFrontier: resolvedNode?.isFrontier || false,
      };
    });

    // Get all relationships that connect entities within the resolved set
    const allRels = await getAllRelationships();
    const edges: any[] = [];
    for (const { relationships } of allRels) {
      for (const rel of relationships) {
        if (entityUuids.has(rel.source.entity) && entityUuids.has(rel.target.entity)) {
          edges.push({
            id: rel.uuid,
            source: rel.source.entity,
            target: rel.target.entity,
            label: rel.description || '',
            sourceCardinality: rel.source.cardinality,
            targetCardinality: rel.target.cardinality,
          });
        }
      }
    }

    return { nodes, edges };
  }

  // --- Internal helpers ---

  private async buildEntityMap(): Promise<Map<string, EntityInfo>> {
    const map = new Map<string, EntityInfo>();
    const allEntities = await listAllEntities();
    for (const entry of allEntities) {
      const entity = await readEntityFile(entry.microservice, entry.name);
      if (entity) {
        map.set(entity.uuid, { uuid: entity.uuid, name: entity.name, service: entry.microservice });
      }
    }
    return map;
  }

  private async buildAdjacencyMap(): Promise<Map<string, AdjacencyEntry[]>> {
    const adjacency = new Map<string, AdjacencyEntry[]>();

    const allRels = await getAllRelationships();
    for (const { relationships } of allRels) {
      for (const rel of relationships) {
        const srcUuid = rel.source.entity;
        const tgtUuid = rel.target.entity;
        const srcNav = rel.source.name || rel.description || rel.uuid;
        const tgtNav = rel.target.name || rel.description || rel.uuid;

        // Source → Target (using target nav name or description)
        if (!adjacency.has(srcUuid)) adjacency.set(srcUuid, []);
        adjacency.get(srcUuid)!.push({ neighborUuid: tgtUuid, navName: tgtNav });

        // Target → Source (using source nav name or description)
        if (!adjacency.has(tgtUuid)) adjacency.set(tgtUuid, []);
        adjacency.get(tgtUuid)!.push({ neighborUuid: srcUuid, navName: srcNav });
      }
    }

    return adjacency;
  }
}

export const perspectiveService = new PerspectiveService();
