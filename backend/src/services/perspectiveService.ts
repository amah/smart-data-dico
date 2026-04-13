import {
  Perspective,
  ResolvedNode,
  ResolvedAttribute,
  ResolvedPerspective,
  PerspectiveNode,
  Relationship,
  Cardinality,
  Entity,
} from '../models/EntitySchema.js';
import { listPerspectives, readPerspectiveFile, writePerspectiveFile, deletePerspectiveFile, getAllRelationships, listAllEntities, readEntityFile } from '../utils/fileOperations.js';
import { generateUUID } from '../utils/uuid.js';
import { logger } from '../utils/logger.js';

interface AdjacencyEntry {
  neighborUuid: string;
  navName: string;
  relationshipUuid: string;
  /** Cardinality at the *origin* side of this edge (the side we're on). */
  fromCard: Cardinality;
  /** Cardinality at the *destination* side of this edge (the neighbor). */
  toCard: Cardinality;
}

interface EntityInfo {
  uuid: string;
  name: string;
  service: string;
  /** Slim attribute list for display in the perspective tree view. */
  attributes: ResolvedAttribute[];
  /** Entity-level metadata entries (for metadata-as-columns in the tree). */
  metadata: MetadataEntry[];
}

/**
 * Flatten an Entity's attributes to the slim shape used on ResolvedNode.
 * Keeps only the fields the perspective tree renders, so we don't ship
 * validation/metadata/nested items for every node.
 *
 * Also honours the legacy `metadata: [{ name: 'isPrimaryKey', value: true }]`
 * shape that predates the top-level `Attribute.primaryKey` field — some
 * older sample data and imported dictionaries still use it, and the tree
 * view should flag those columns as PK without a data migration.
 */
function slimAttributes(entity: Entity): ResolvedAttribute[] {
  return (entity.attributes || []).map(a => {
    const out: ResolvedAttribute = {
      name: a.name,
      type: a.type,
      required: !!a.required,
    };
    const legacyPk = (a.metadata || []).some(
      m => m.name === 'isPrimaryKey' && m.value === true,
    );
    if (a.primaryKey || legacyPk) out.primaryKey = true;
    if (a.metadata && a.metadata.length > 0) out.metadata = a.metadata;
    return out;
  });
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

    /**
     * BFS queue item. `inboundNav` is the edge that reached this node from
     * its parent during the traversal — undefined on roots. We carry it
     * alongside the queue entry so it can be copied directly onto the
     * resolved node without re-walking the adjacency map.
     */
    interface QueueItem {
      entityUuid: string;
      hopDistance: number;
      pathSegments: string[];
      usedRelationships: Set<string>;
      inboundNav?: {
        navName: string;
        fromCard: Cardinality;
        toCard: Cardinality;
      };
    }
    const queue: QueueItem[] = [];

    for (const rootUuid of perspective.rootEntities) {
      const info = entityMap.get(rootUuid);
      if (!info) continue;
      queue.push({ entityUuid: rootUuid, hopDistance: 0, pathSegments: [info.name], usedRelationships: new Set() });
    }

    // Entity-visit-once (#96): each entity UUID resolves at most once,
    // at the shortest hop distance (BFS guarantees this). Prevents
    // exponential path explosion in cyclic relationship graphs.
    const visitedEntities = new Set<string>();

    while (queue.length > 0) {
      const { entityUuid, hopDistance, pathSegments, usedRelationships, inboundNav } = queue.shift()!;

      // Skip if this entity was already resolved via a shorter/earlier path
      if (visitedEntities.has(entityUuid)) continue;
      visitedEntities.add(entityUuid);

      const currentPath = pathSegments.join('/');

      // Check for exclusion
      const node = nodesByPath.get(currentPath);
      if (node?.exclude) continue;

      // Check depth
      if (hopDistance > maxDepth) continue;

      const info = entityMap.get(entityUuid);
      if (!info) continue;

      const isFrontier = node?.traverse === false;

      const resolved: ResolvedNode = {
        entityUuid,
        entityName: info.name,
        service: info.service,
        path: currentPath,
        hopDistance,
        isRoot: hopDistance === 0,
        isFrontier,
        isManualInclusion: false,
        attributes: info.attributes,
        metadata: info.metadata.length > 0 ? info.metadata : undefined,
      };
      if (inboundNav) {
        resolved.navName = inboundNav.navName;
        resolved.navCardinality = {
          from: inboundNav.fromCard,
          to: inboundNav.toCard,
        };
      }
      resolvedNodes.push(resolved);

      // Don't traverse further from frontier nodes
      if (isFrontier) continue;

      // Enqueue neighbors — skip already-visited entities and
      // relationships already used in this path (prevents self-loops)
      const neighbors = adjacency.get(entityUuid) || [];
      for (const { neighborUuid, navName, relationshipUuid, fromCard, toCard } of neighbors) {
        if (visitedEntities.has(neighborUuid)) continue;
        if (usedRelationships.has(relationshipUuid)) continue;

        const neighborInfo = entityMap.get(neighborUuid);
        if (!neighborInfo) continue;
        const newPath = [...pathSegments, navName];
        const newPathStr = newPath.join('/');

        // Check if this path is excluded
        const prefixNode = nodesByPath.get(newPathStr);
        if (prefixNode?.exclude) continue;

        const newUsed = new Set(usedRelationships);
        newUsed.add(relationshipUuid);

        queue.push({
          entityUuid: neighborUuid,
          hopDistance: hopDistance + 1,
          pathSegments: newPath,
          usedRelationships: newUsed,
          inboundNav: { navName, fromCard, toCard },
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
        map.set(entity.uuid, {
          uuid: entity.uuid,
          name: entity.name,
          service: entry.microservice,
          attributes: slimAttributes(entity),
          metadata: entity.metadata || [],
        });
      }
    }
    return map;
  }

  /**
   * Build undirected adjacency across all relationships. Each edge is
   * stored *twice* — once at the source (neighbor = target) and once at
   * the target (neighbor = source) — with nav-name and cardinality
   * flipped for the direction of traversal. The BFS uses these tagged
   * entries verbatim to emit navName/navCardinality on each child node.
   */
  private async buildAdjacencyMap(): Promise<Map<string, AdjacencyEntry[]>> {
    const adjacency = new Map<string, AdjacencyEntry[]>();

    const allRels = await getAllRelationships();
    for (const { relationships } of allRels) {
      for (const rel of relationships) {
        const srcUuid = rel.source.entity;
        const tgtUuid = rel.target.entity;
        const srcNav = rel.source.name || rel.description || rel.uuid;
        const tgtNav = rel.target.name || rel.description || rel.uuid;

        // Source → Target: arriving at the target end; navName is target
        // side, from=source.cardinality, to=target.cardinality.
        if (!adjacency.has(srcUuid)) adjacency.set(srcUuid, []);
        adjacency.get(srcUuid)!.push({
          neighborUuid: tgtUuid,
          navName: tgtNav,
          relationshipUuid: rel.uuid,
          fromCard: rel.source.cardinality,
          toCard: rel.target.cardinality,
        });

        // Target → Source: reverse traversal; flip both names and cards.
        if (!adjacency.has(tgtUuid)) adjacency.set(tgtUuid, []);
        adjacency.get(tgtUuid)!.push({
          neighborUuid: srcUuid,
          navName: srcNav,
          relationshipUuid: rel.uuid,
          fromCard: rel.target.cardinality,
          toCard: rel.source.cardinality,
        });
      }
    }

    return adjacency;
  }
}

export const perspectiveService = new PerspectiveService();
