import {
  Case,
  ResolvedNode,
  ResolvedAttribute,
  ResolvedCase,
  CaseNode,
  Cardinality,
  Entity,
  MetadataEntry,
  normalizeRelationshipEnds,
} from '../models/EntitySchema.js';
import { listCases, readCaseFile, getAllRelationships, listAllEntities, readEntityFile, listPackages, loadPackage } from '../utils/fileOperations.js';
import { generateUUID } from '../utils/uuid.js';
import { getProjection } from '../storage/projection/ProjectionRegistry.js';
import { wsId } from '../storage/contract/types.js';
import type { LogicalPath } from '../storage/projection/LogicalProjection.js';

interface AdjacencyEntry {
  neighborUuid: string;
  /**
   * The origin end's role — the field at the origin entity for reaching the
   * neighbor (the edge's display label). Undefined when the end declares no
   * role; we deliberately do NOT fall back to the relationship description,
   * which is a sentence, not a navigation label. Also used to prefer a
   * role-bearing edge when two relationships connect the same pair.
   */
  navName?: string;
  relationshipUuid: string;
  /** Cardinality at the *origin* side of this edge (the side we're on). */
  fromCard: Cardinality;
  /** Cardinality at the *destination* side of this edge (the neighbor). */
  toCard: Cardinality;
  /**
   * True when the *origin* end of this directed edge carries the
   * `composition` stereotype — i.e. traversing origin→neighbor crosses an
   * owner→part containment edge. Asymmetric by construction: the reverse
   * directed entry (part→owner) is false unless the part end is also a
   * composition owner. This is what bounds case auto-expansion.
   */
  isComposition: boolean;
}

interface EntityInfo {
  uuid: string;
  name: string;
  service: string;
  /** Slim attribute list for display in the case tree view. */
  attributes: ResolvedAttribute[];
  /** Entity-level metadata entries (for metadata-as-columns in the tree). */
  metadata: MetadataEntry[];
}

/**
 * Flatten an Entity's attributes to the slim shape used on ResolvedNode.
 * Keeps only the fields the case tree renders, so we don't ship
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

/**
 * Resolve the home package for a case so the caller can construct a
 * logical path of the form `packages/<pkg>/cases/<Name>`. Mirrors the
 * heuristic that `fileOperations.writeCaseFile` uses internally:
 *
 *   1. If a file already owns the case (lookup by uuid), use that package.
 *   2. Otherwise, use the package of the first root entity.
 *   3. Otherwise, fall back to the first package on disk.
 *   4. If nothing is found, return null.
 *
 * The projection's `writeCase` validates name vs path but does NOT enforce
 * that the path's package segment matches the on-disk owning package — the
 * underlying `writeCaseFile` is uuid-keyed and will still place the file
 * correctly even if the heuristic guessed a different package.
 */
async function resolveCaseHomePackage(c: Case): Promise<string | null> {
  const packages = await listPackages();
  // 1. Existing-owner lookup.
  for (const pkg of packages) {
    try {
      const model = await loadPackage(pkg);
      if (model.ownership.caseByUuid.has(c.uuid)) return pkg;
    } catch { /* skip */ }
  }
  // 2. First root entity's package.
  if (c.rootEntities && c.rootEntities.length > 0) {
    const rootUuid = c.rootEntities[0];
    for (const pkg of packages) {
      try {
        const model = await loadPackage(pkg);
        if (model.ownership.entityByUuid.has(rootUuid)) return pkg;
      } catch { /* skip */ }
    }
  }
  // 3. First package.
  return packages[0] || null;
}

class CaseService {
  // --- CRUD ---

  async getAll(): Promise<Case[]> {
    return listCases();
  }

  async getById(uuid: string): Promise<Case | null> {
    return readCaseFile(uuid);
  }

  async create(data: Partial<Case>): Promise<{ success: boolean; case?: Case; errors?: string[] }> {
    if (!data.name) return { success: false, errors: ['Name is required'] };
    if (!data.rootEntities?.length) return { success: false, errors: ['At least one root entity is required'] };

    const newCase: Case = {
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

    // Slice 6e.1: route through the registered projection.
    const targetPackage = await resolveCaseHomePackage(newCase);
    if (!targetPackage) return { success: false, errors: ['Cannot resolve home package for case'] };
    const projection = getProjection(wsId('dictionaries'));
    const caseLogicalPath = `packages/${targetPackage}/cases/${newCase.name}` as LogicalPath;
    try {
      await projection.writeCase(caseLogicalPath, newCase);
      return { success: true, case: newCase };
    } catch (e) {
      return { success: false, errors: [`Failed to write case file: ${(e as Error).message}`] };
    }
  }

  async update(uuid: string, data: Partial<Case>): Promise<{ success: boolean; case?: Case; errors?: string[] }> {
    const existing = await readCaseFile(uuid);
    if (!existing) return { success: false, errors: ['Case not found'] };

    const updated: Case = {
      ...existing,
      name: data.name ?? existing.name,
      description: data.description ?? existing.description,
      rootEntities: data.rootEntities ?? existing.rootEntities,
      nodes: data.nodes ?? existing.nodes,
      maxDepth: data.maxDepth ?? existing.maxDepth,
      metadata: data.metadata ?? existing.metadata,
      updatedAt: new Date().toISOString(),
    };

    const targetPackage = await resolveCaseHomePackage(updated);
    if (!targetPackage) return { success: false, errors: ['Cannot resolve home package for case'] };
    const projection = getProjection(wsId('dictionaries'));
    const caseLogicalPath = `packages/${targetPackage}/cases/${updated.name}` as LogicalPath;
    try {
      await projection.writeCase(caseLogicalPath, updated);
      return { success: true, case: updated };
    } catch (e) {
      return { success: false, errors: [`Failed to write case file: ${(e as Error).message}`] };
    }
  }

  async delete(uuid: string): Promise<{ success: boolean; errors?: string[] }> {
    // Need the case to derive its logical path. `readCaseFile` scans packages
    // by uuid; the path-shape projection.deleteCase wants both pkg + name.
    const existing = await readCaseFile(uuid);
    if (!existing) return { success: false, errors: ['Case not found'] };
    const targetPackage = await resolveCaseHomePackage(existing);
    if (!targetPackage) return { success: false, errors: ['Case not found'] };
    const projection = getProjection(wsId('dictionaries'));
    const caseLogicalPath = `packages/${targetPackage}/cases/${existing.name}` as LogicalPath;
    const ok = await projection.deleteCase(caseLogicalPath);
    if (!ok) return { success: false, errors: ['Case not found'] };
    return { success: true };
  }

  // --- Node (annotation) management ---

  async upsertNode(uuid: string, node: CaseNode): Promise<{ success: boolean; errors?: string[] }> {
    const c = await readCaseFile(uuid);
    if (!c) return { success: false, errors: ['Case not found'] };

    const nodes = c.nodes || [];
    const idx = nodes.findIndex(n => n.path === node.path);
    if (idx >= 0) {
      nodes[idx] = node;
    } else {
      nodes.push(node);
    }
    c.nodes = nodes;
    c.updatedAt = new Date().toISOString();

    const targetPackage = await resolveCaseHomePackage(c);
    if (!targetPackage) return { success: false, errors: ['Failed to write'] };
    const projection = getProjection(wsId('dictionaries'));
    const caseLogicalPath = `packages/${targetPackage}/cases/${c.name}` as LogicalPath;
    try {
      await projection.writeCase(caseLogicalPath, c);
      return { success: true };
    } catch {
      return { success: false, errors: ['Failed to write'] };
    }
  }

  // --- BFS Resolution ---

  async resolve(uuid: string): Promise<ResolvedCase | null> {
    const c = await readCaseFile(uuid);
    if (!c) return null;

    // Build entity info map: uuid → { name, service }
    const entityMap = await this.buildEntityMap();

    // Build adjacency map from all relationships
    const adjacency = await this.buildAdjacencyMap();

    // Build node lookup for exclude/traverse checks
    const nodesByPath = new Map<string, CaseNode>();
    for (const node of c.nodes || []) {
      nodesByPath.set(node.path, node);
    }

    const maxDepth = c.maxDepth ?? 10;
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
        navName?: string;
        fromCard: Cardinality;
        toCard: Cardinality;
      };
      /** True when the inbound edge is a composition (owner→part) edge. */
      inboundIsComposition?: boolean;
      /**
       * True when this node was reached by *manually* crossing a
       * non-composition edge (a CaseNode with traverse:true at this path).
       */
      inboundIsManual?: boolean;
    }
    const queue: QueueItem[] = [];

    for (const rootUuid of c.rootEntities) {
      const info = entityMap.get(rootUuid);
      if (!info) continue;
      queue.push({ entityUuid: rootUuid, hopDistance: 0, pathSegments: [info.name], usedRelationships: new Set() });
    }

    // Entity-visit-once (#96): each entity UUID resolves at most once,
    // at the shortest hop distance (BFS guarantees this). Prevents
    // exponential path explosion in cyclic relationship graphs.
    const visitedEntities = new Set<string>();

    while (queue.length > 0) {
      const { entityUuid, hopDistance, pathSegments, usedRelationships, inboundNav, inboundIsComposition, inboundIsManual } = queue.shift()!;

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
        isManualInclusion: inboundIsManual === true,
        isComposition: hopDistance === 0 ? undefined : inboundIsComposition === true,
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
      // relationships already used in this path (prevents self-loops).
      //
      // Group parallel edges by neighbor entity so the same target is shown
      // once per parent. Two relationships can connect the same pair (e.g. a
      // package-level composition `Order ◆— OrderItem` plus an entity-embedded
      // `OrderItem.order belongsTo Order`); without grouping the neighbor
      // would appear twice — once expanded, once as a stub.
      const neighbors = adjacency.get(entityUuid) || [];
      const byNeighbor = new Map<string, AdjacencyEntry[]>();
      for (const edge of neighbors) {
        if (!byNeighbor.has(edge.neighborUuid)) byNeighbor.set(edge.neighborUuid, []);
        byNeighbor.get(edge.neighborUuid)!.push(edge);
      }

      for (const [neighborUuid, parallelEdges] of byNeighbor) {
        if (visitedEntities.has(neighborUuid)) continue;

        // Drop edges already used in this path (prevents self-loops).
        const edges = parallelEdges.filter(e => !usedRelationships.has(e.relationshipUuid));
        if (edges.length === 0) continue;

        const neighborInfo = entityMap.get(neighborUuid);
        if (!neighborInfo) continue;
        // Path uses entity names for uniqueness — two different
        // relationships can share the same nav end-name (e.g. Claim→Member
        // and Claim→Provider both have target.name="claims"), which would
        // cause path collisions if we used navName here. Entity-visit-once
        // (#96) guarantees entity names are unique in the resolved tree.
        // navName is still recorded on the resolved node for display.
        const newPath = [...pathSegments, neighborInfo.name];
        const newPathStr = newPath.join('/');

        // Check if this path is excluded
        const prefixNode = nodesByPath.get(newPathStr);
        if (prefixNode?.exclude) continue;

        // Pick the edge to represent this neighbor. Composition wins (so the
        // neighbor resolves as a part). Otherwise prefer an edge that declares
        // a real role, so the label is the end's role (e.g. "product") rather
        // than a role-less relationship's description fallback. Falls back to
        // the first edge when none has a role.
        const edge =
          edges.find(e => e.isComposition) ??
          edges.find(e => e.navName) ??
          edges[0];
        const isComposition = edge.isComposition;

        // Composition-bounded expansion (#case-composition): auto-cross an
        // edge only when it is a composition (owner→part) edge. A non-
        // composition edge is crossed only when the user manually marked the
        // neighbor path with `traverse: true`; otherwise it is emitted as a
        // collapsed frontier stub the user can expand later. An explicit
        // `traverse: false` always collapses — even a composition child.
        const cross = prefixNode?.traverse ?? isComposition;

        if (!cross) {
          // Collapsed frontier stub — shown but not expanded, not enqueued,
          // and NOT marked visited, so the same entity can still resolve via
          // a composition path elsewhere in the tree.
          resolvedNodes.push({
            entityUuid: neighborUuid,
            entityName: neighborInfo.name,
            service: neighborInfo.service,
            path: newPathStr,
            hopDistance: hopDistance + 1,
            isRoot: false,
            isFrontier: true,
            isManualInclusion: false,
            isComposition,
            isExpandable: true,
            navName: edge.navName,
            navCardinality: { from: edge.fromCard, to: edge.toCard },
            attributes: neighborInfo.attributes,
            metadata: neighborInfo.metadata.length > 0 ? neighborInfo.metadata : undefined,
          });
          continue;
        }

        const newUsed = new Set(usedRelationships);
        newUsed.add(edge.relationshipUuid);

        queue.push({
          entityUuid: neighborUuid,
          hopDistance: hopDistance + 1,
          pathSegments: newPath,
          usedRelationships: newUsed,
          inboundNav: { navName: edge.navName, fromCard: edge.fromCard, toCard: edge.toCard },
          inboundIsComposition: isComposition,
          // Manual inclusion = the user force-expanded a non-composition edge.
          inboundIsManual: prefixNode?.traverse === true && !isComposition,
        });
      }
    }

    return { ...c, resolvedNodes };
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
   * stored *twice* — once at each end — with the nav name taken from the
   * ORIGIN end (#99 corrected semantic): when going from entity A to B,
   * the nav name is A's own role (= A's field for reaching B). This is
   * the symmetric form: each end's role is always "MY field for reaching
   * the opposite end", regardless of source/target asymmetry.
   *
   * Uses `normalizeRelationshipEnds` so it works for both the new
   * `ends[]` shape and legacy source/target shape transparently.
   */
  private async buildAdjacencyMap(): Promise<Map<string, AdjacencyEntry[]>> {
    const adjacency = new Map<string, AdjacencyEntry[]>();

    const allRels = await getAllRelationships();
    for (const { relationships } of allRels) {
      for (const rel of relationships) {
        const [endA, endB] = normalizeRelationshipEnds(rel);
        // Label is the end's role only — never the relationship description.
        const roleA = endA.role;
        const roleB = endB.role;

        // Composition is an ENDPOINT property: the owner/whole end carries
        // the `composition` stereotype. The directed edge origin→neighbor is
        // a composition (auto-expand) edge only when the *origin* end is the
        // owner — so A→B is composition iff endA is the owner, and B→A iff
        // endB is. This asymmetry is what stops bidirectional back-references
        // (part→owner) from auto-expanding.
        const aIsOwner = endA.stereotype === 'composition';
        const bIsOwner = endB.stereotype === 'composition';

        // A → B: origin is A, nav name is A's role (A's field for reaching B)
        if (!adjacency.has(endA.entity)) adjacency.set(endA.entity, []);
        adjacency.get(endA.entity)!.push({
          neighborUuid: endB.entity,
          navName: roleA,
          relationshipUuid: rel.uuid,
          fromCard: endA.cardinality,
          toCard: endB.cardinality,
          isComposition: aIsOwner,
        });

        // B → A: origin is B, nav name is B's role
        if (!adjacency.has(endB.entity)) adjacency.set(endB.entity, []);
        adjacency.get(endB.entity)!.push({
          neighborUuid: endA.entity,
          navName: roleB,
          relationshipUuid: rel.uuid,
          fromCard: endB.cardinality,
          toCard: endA.cardinality,
          isComposition: bIsOwner,
        });
      }
    }

    return adjacency;
  }
}

export const caseService = new CaseService();
