import { Entity, Relationship, EntityStatus, ReviewComment, LineageResult, fillAttributeDefaults } from '../models/EntitySchema.js';
import { stereotypeService } from './stereotypeService.js';
import { logger } from '../utils/logger.js';
import { metadataValueToSearchString } from './metadata/metadataValueToSearchString.js';
import {
  listMicroservices,
  loadPackage,
  readEntityFile,
  listAllEntities,
  readRelationshipsFile,
  getPackagePath,
  getAllRelationships,
  readComments,
  writeComments
} from '../utils/fileOperations.js';
import { generateUUID } from '../utils/uuid.js';
import { listHideRules } from './dicoConfigService.js';
import { compileHideRules, filterHiddenEntities, HIDDEN_META_KEY } from './visibilityService.js';
import { getProjection } from '../storage/projection/ProjectionRegistry.js';
import { wsId } from '../storage/contract/types.js';
import type { LogicalPath } from '../storage/projection/LogicalProjection.js';
import { getSearchIndex } from './search/searchIndexService.js';
import type { SearchKind } from './search/searchDocuments.js';

/**
 * Interface for search result
 */
interface SearchFilters {
  type?: string;
  service?: string;
  stereotype?: string;
  hasMetadata?: string;
}

interface SearchResult {
  type: 'entity' | 'attribute' | 'metadata' | 'relationship' | 'package';
  service: string;
  entityName: string;
  attributeName?: string;
  name: string;
  description: string;
  path: string;
  score: number;
  matchContext?: string;
}

interface ImpactAnalysis {
  relationships: { uuid: string; description: string; service: string; sourceEntity: string; targetEntity: string }[];
  cases: { uuid: string; name: string; path: string }[];
  diagrams: { id: string; name: string }[];
}

/**
 * Interface for graph data
 */
interface GraphNode {
  id: string;
  label: string;
  type: 'entity';
  service: string;
}

interface GraphEdge {
  id: string;
  source: string;
  target: string;
  label: string;
  sourceCardinality: string;
  targetCardinality: string;
}

interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/**
 * Service for managing services and entities
 */
export class ServiceService {
  async getAllServices(): Promise<string[]> {
    logger.info('Getting all services');
    try {
      return await listMicroservices();
    } catch (error) {
      logger.error(`Error getting all services: ${error}`);
      return [];
    }
  }

  async getServiceEntities(service: string): Promise<Entity[]> {
    const startTime = process.hrtime();
    try {
      // Load the whole package once. The previous per-entity readEntityFile
      // loop re-ran loadPackage for every entity (O(n²) on the git backend).
      const pkg = await loadPackage(service);
      const endTime = process.hrtime(startTime);
      const totalTimeMs = Number((endTime[0] * 1e3 + endTime[1] / 1e6).toFixed(2));
      logger.info(`Got ${pkg.entities.length} entities for service ${service} in ${totalTimeMs}ms`);
      return pkg.entities;
    } catch (error) {
      logger.error(`Error getting service entities: ${error}`);
      return [];
    }
  }

  /**
   * Entities for a service filtered by the hide policy (explicit `system.hidden`
   * flag + `hideRules`). Default excludes hidden items so lists/diagrams/search
   * aren't polluted by reverse-engineering waste; pass `includeHidden` to show them
   * (e.g. the "Show hidden" toggle / Hidden-Items manager). `getServiceEntities`
   * itself stays unfiltered so internal graph logic keeps the full set.
   */
  async getVisibleServiceEntities(service: string, includeHidden = false): Promise<Entity[]> {
    const entities = await this.getServiceEntities(service);
    if (includeHidden) return entities;
    const rules = compileHideRules(await listHideRules());
    return filterHiddenEntities(entities, rules, false, service);
  }

  /**
   * Hide or unhide an entity by setting/removing its reserved `system.hidden`
   * metadata. Non-destructive and reversible; the reverse-engineer merge preserves
   * the flag so re-runs don't un-hide.
   */
  async setEntityHidden(service: string, entityName: string, hidden: boolean, reason?: string): Promise<{ success: boolean; errors: string[] }> {
    const entity = await readEntityFile(service, entityName);
    if (!entity) return { success: false, errors: [`Entity ${service}.${entityName} not found`] };
    const meta = (entity.metadata ?? []).filter((m) => m.name !== HIDDEN_META_KEY && m.name !== 'system.hiddenReason' && m.name !== 'system.hiddenAt');
    if (hidden) {
      meta.push({ name: HIDDEN_META_KEY, value: 'true' });
      if (reason) meta.push({ name: 'system.hiddenReason', value: reason });
      meta.push({ name: 'system.hiddenAt', value: new Date().toISOString().slice(0, 10) });
    } else {
      // Explicit pin-visible: an unhide wins over any matching hide rule.
      meta.push({ name: HIDDEN_META_KEY, value: 'false' });
    }
    entity.metadata = meta;
    // Heal any pre-existing attribute gap so this metadata-only change isn't rejected.
    fillAttributeDefaults(entity);
    return this.updateEntity(service, entity);
  }

  /**
   * Set or clear an entity's explicit Element Style (#element-style) via the
   * reserved `system.style` metadata. Pass a style name to set it, or
   * ''/'auto'/'none'/null to clear (falling back to rules/role detection).
   */
  async setEntityStyle(service: string, entityName: string, style: string | null): Promise<{ success: boolean; errors: string[] }> {
    const entity = await readEntityFile(service, entityName);
    if (!entity) return { success: false, errors: [`Entity ${service}.${entityName} not found`] };
    const clear = !style || ['auto', 'none', 'default'].includes(style.toLowerCase());
    const meta = (entity.metadata ?? []).filter((m) => m.name !== 'system.style');
    if (!clear) meta.push({ name: 'system.style', value: style! });
    entity.metadata = meta;
    // Heal any pre-existing attribute gap so this metadata-only change isn't rejected.
    fillAttributeDefaults(entity);
    return this.updateEntity(service, entity);
  }

  async getEntitySchema(service: string, entityName: string): Promise<Entity | null> {
    logger.info(`Getting entity schema: ${service}.${entityName}`);
    try {
      return await readEntityFile(service, entityName);
    } catch (error) {
      logger.error(`Error getting entity schema: ${error}`);
      return null;
    }
  }

  /**
   * Resolve an entity by name across all packages. Used by the
   * relationship-creation tools (HTTP AI agent, direct-chat, MCP) so callers
   * can reference an endpoint without forcing the caller to know which
   * package each side lives in — cross-package relationships are first-class.
   *
   * Returns `{ entity, packageName }` for a unique match, `null` when the
   * name isn't found anywhere, and throws on ambiguity so callers can ask the
   * user to disambiguate.
   */
  async findEntityAcrossPackages(
    entityName: string,
    preferredPackage?: string,
  ): Promise<{ entity: Entity; packageName: string } | null> {
    if (preferredPackage) {
      const e = await this.getEntitySchema(preferredPackage, entityName);
      if (e) return { entity: e, packageName: preferredPackage };
    }
    const allPackages = await listMicroservices();
    const matches: { entity: Entity; packageName: string }[] = [];
    for (const p of allPackages) {
      if (p === preferredPackage) continue;
      const e = await this.getEntitySchema(p, entityName);
      if (e) matches.push({ entity: e, packageName: p });
    }
    if (matches.length === 0) return null;
    if (matches.length === 1) return matches[0];
    const where = matches.map(m => m.packageName).join(', ');
    throw new Error(
      `Entity "${entityName}" exists in multiple packages: ${where}. Specify the package explicitly.`,
    );
  }

  async createEntity(service: string, entity: Entity): Promise<{ success: boolean; errors: string[] }> {
    logger.info(`Creating entity: ${service}.${entity.name}`);

    try {
      const existingEntity = await readEntityFile(service, entity.name);
      if (existingEntity) {
        return {
          success: false,
          errors: [`Entity ${service}.${entity.name} already exists`]
        };
      }

      // Validate metadata against stereotype
      if (entity.stereotype) {
        const stereotype = await stereotypeService.getStereotype(entity.stereotype);
        if (stereotype) {
          const metadataErrors = stereotypeService.validateMetadata(stereotype, entity.metadata);
          if (metadataErrors.length > 0) {
            return { success: false, errors: metadataErrors.map(e => e.message) };
          }
        }
      }

      entity.status = entity.status || EntityStatus.DRAFT;
      entity.createdAt = new Date().toISOString();
      entity.updatedAt = new Date().toISOString();

      // Slice 6b'': route through the registered LogicalProjection so the
      // slice-6c UuidIndex sees the invalidation event. Mirrors EntityService
      // .saveEntity from slice 6b'. Closes Risk §11.6 for the controller-routed
      // POST /api/services/:service/entities path.
      try {
        const projection = getProjection(wsId('dictionaries'));
        const logicalPath = `packages/${service}/entities/${entity.name}`;
        await projection.writeEntity(logicalPath, entity);
        return { success: true, errors: [] };
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        return { success: false, errors: [message] };
      }
    } catch (error) {
      logger.error(`Error creating entity: ${error}`);
      return {
        success: false,
        errors: [`Error creating entity: ${error}`]
      };
    }
  }

  async updateEntity(service: string, entity: Entity): Promise<{ success: boolean; errors: string[] }> {
    logger.info(`Updating entity: ${service}.${entity.name}`);

    try {
      const existingEntity = await readEntityFile(service, entity.name);
      if (!existingEntity) {
        return {
          success: false,
          errors: [`Entity ${service}.${entity.name} not found`]
        };
      }

      // Validate metadata against stereotype (warn but don't block updates)
      if (entity.stereotype) {
        const stereotype = await stereotypeService.getStereotype(entity.stereotype);
        if (stereotype) {
          const metadataErrors = stereotypeService.validateMetadata(stereotype, entity.metadata);
          if (metadataErrors.length > 0) {
            logger.warn(`Metadata validation warnings for ${entity.name}: ${metadataErrors.join(', ')}`);
          }
        }
      }

      entity.createdAt = existingEntity.createdAt;
      entity.updatedAt = new Date().toISOString();

      // Slice 6b''': route through the registered LogicalProjection so the
      // slice-6c UuidIndex sees the invalidation event. Mirrors the 6b''
      // createEntity migration. Closes Risk §11.6 for the controller-routed
      // PUT /api/services/:service/entities/:name path.
      try {
        const projection = getProjection(wsId('dictionaries'));
        const logicalPath = `packages/${service}/entities/${entity.name}`;
        await projection.writeEntity(logicalPath, entity);
        return { success: true, errors: [] };
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        return { success: false, errors: [message] };
      }
    } catch (error) {
      logger.error(`Error updating entity: ${error}`);
      return {
        success: false,
        errors: [`Error updating entity: ${error}`]
      };
    }
  }

  async deleteEntity(service: string, entityName: string): Promise<{ success: boolean; errors: string[] }> {
    logger.info(`Deleting entity: ${service}.${entityName}`);

    try {
      const existingEntity = await readEntityFile(service, entityName);
      if (!existingEntity) {
        return {
          success: false,
          errors: [`Entity ${service}.${entityName} not found`]
        };
      }

      // Check if entity is referenced in package-level relationships
      const packagePath = getPackagePath(service);
      const relationships = await readRelationshipsFile(packagePath);
      const referencingRels = relationships.filter(
        rel => rel.source.entity === existingEntity.uuid || rel.target.entity === existingEntity.uuid
      );

      if (referencingRels.length > 0) {
        return {
          success: false,
          errors: [
            `Cannot delete entity ${service}.${entityName} because it is referenced in ${referencingRels.length} relationship(s). Remove the relationships first.`
          ]
        };
      }

      // Slice 6b'''': route through the registered LogicalProjection so the
      // slice-6c UuidIndex sees the invalidation event. Closes Risk §11.6 for
      // the controller-routed DELETE /api/services/:service/entities/:name
      // path.
      try {
        const projection = getProjection(wsId('dictionaries'));
        const logicalPath = `packages/${service}/entities/${existingEntity.name}`;
        const deleted = await projection.deleteEntity(logicalPath);
        return {
          success: deleted,
          errors: deleted ? [] : ['Failed to delete entity file'],
        };
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        return { success: false, errors: [message] };
      }
    } catch (error) {
      logger.error(`Error deleting entity: ${error}`);
      return {
        success: false,
        errors: [`Error deleting entity: ${error}`]
      };
    }
  }

  /**
   * Move an entity from one package to another (#move-entity). The entity keeps
   * its UUID, so every UUID-based reference (relationships — cross-package is
   * first-class — cases, diagrams, perspectives) keeps resolving; nothing is
   * orphaned. We write the entity into the target package, then remove it from
   * the source via the projection directly — this bypasses deleteEntity's
   * same-package relationship guard, which is meant for destruction, not a
   * relocation where the references remain valid.
   */
  async moveEntity(
    sourcePackage: string,
    entityName: string,
    targetPackage: string,
  ): Promise<{ success: boolean; errors: string[] }> {
    logger.info(`Moving entity: ${sourcePackage}.${entityName} -> ${targetPackage}`);

    if (!targetPackage || targetPackage === sourcePackage) {
      return { success: false, errors: ['Target package must differ from the source package'] };
    }

    try {
      const entity = await readEntityFile(sourcePackage, entityName);
      if (!entity) {
        return { success: false, errors: [`Entity ${sourcePackage}.${entityName} not found`] };
      }

      const packages = await listMicroservices();
      if (!packages.includes(targetPackage)) {
        return { success: false, errors: [`Target package '${targetPackage}' does not exist`] };
      }

      // A move must not collide with an existing entity of the same name in the
      // target (the loader treats a duplicate name/uuid in a package as a hard error).
      const existingInTarget = await readEntityFile(targetPackage, entityName);
      if (existingInTarget) {
        return {
          success: false,
          errors: [`Target package '${targetPackage}' already has an entity named '${entityName}'`],
        };
      }

      const projection = getProjection(wsId('dictionaries'));
      entity.updatedAt = new Date().toISOString();

      // Write into the target first; only drop the source once the write lands,
      // so a mid-way failure never loses the entity.
      await projection.writeEntity(`packages/${targetPackage}/entities/${entity.name}` as LogicalPath, entity);
      const removed = await projection.deleteEntity(`packages/${sourcePackage}/entities/${entity.name}` as LogicalPath);
      if (!removed) {
        // Roll back the target write so we don't leave a duplicate behind.
        await projection
          .deleteEntity(`packages/${targetPackage}/entities/${entity.name}` as LogicalPath)
          .catch(() => { /* best-effort rollback */ });
        return { success: false, errors: ['Failed to remove the entity from the source package'] };
      }

      return { success: true, errors: [] };
    } catch (error) {
      logger.error(`Error moving entity: ${error}`);
      return { success: false, errors: [`Error moving entity: ${error}`] };
    }
  }

  // --- Relationship CRUD ---

  async getPackageRelationships(packageName: string): Promise<Relationship[]> {
    const packagePath = getPackagePath(packageName);
    return await readRelationshipsFile(packagePath);
  }

  async createRelationship(packageName: string, relationship: Relationship): Promise<{ success: boolean; errors: string[]; relationship?: Relationship }> {
    try {
      if (!relationship.uuid) {
        relationship.uuid = generateUUID();
      }

      const packagePath = getPackagePath(packageName);
      const relationships = await readRelationshipsFile(packagePath);
      relationships.push(relationship);

      // Slice 6e.1: write via projection so the (future) UuidIndex / cache
      // subscribers see the invalidation. Projection throws on failure.
      const projection = getProjection(wsId('dictionaries'));
      const packageLogicalPath = `packages/${packageName}` as LogicalPath;
      await projection.writeRelationships(packageLogicalPath, relationships);
      return {
        success: true,
        errors: [],
        relationship,
      };
    } catch (error) {
      logger.error(`Error creating relationship: ${error}`);
      return { success: false, errors: [`Error creating relationship: ${error}`] };
    }
  }

  async updateRelationship(packageName: string, uuid: string, relationship: Relationship): Promise<{ success: boolean; errors: string[] }> {
    try {
      const packagePath = getPackagePath(packageName);
      const relationships = await readRelationshipsFile(packagePath);
      const index = relationships.findIndex(r => r.uuid === uuid);

      if (index === -1) {
        return { success: false, errors: [`Relationship ${uuid} not found`] };
      }

      relationships[index] = { ...relationship, uuid };
      const projection = getProjection(wsId('dictionaries'));
      const packageLogicalPath = `packages/${packageName}` as LogicalPath;
      await projection.writeRelationships(packageLogicalPath, relationships);
      return { success: true, errors: [] };
    } catch (error) {
      logger.error(`Error updating relationship: ${error}`);
      return { success: false, errors: [`Error updating relationship: ${error}`] };
    }
  }

  async deleteRelationship(packageName: string, uuid: string): Promise<{ success: boolean; errors: string[] }> {
    try {
      const packagePath = getPackagePath(packageName);
      const relationships = await readRelationshipsFile(packagePath);
      const index = relationships.findIndex(r => r.uuid === uuid);

      if (index === -1) {
        return { success: false, errors: [`Relationship ${uuid} not found`] };
      }

      relationships.splice(index, 1);
      const projection = getProjection(wsId('dictionaries'));
      const packageLogicalPath = `packages/${packageName}` as LogicalPath;
      await projection.writeRelationships(packageLogicalPath, relationships);
      return { success: true, errors: [] };
    } catch (error) {
      logger.error(`Error deleting relationship: ${error}`);
      return { success: false, errors: [`Error deleting relationship: ${error}`] };
    }
  }

  // --- Search ---

  async searchEntities(query: string, filters?: SearchFilters): Promise<SearchResult[]> {
    logger.info(`Searching with query: ${query}, filters: ${JSON.stringify(filters)}`);

    // Fast path (#search-index): serve from the FTS5 index when it's live. The
    // legacy full-scan below stays as a fallback for when the index is absent
    // (SQLite unavailable / not yet built) or when a filter it doesn't model is
    // used (stereotype / hasMetadata).
    const idx = getSearchIndex();
    const unsupportedFilter = Boolean(filters?.stereotype || filters?.hasMetadata);
    if (idx && query.trim() && !unsupportedFilter) {
      const kinds = filters?.type ? [filters.type as SearchKind] : undefined;
      const hits = idx.search(query, { package: filters?.service, kinds, limit: 50 });
      const supported = new Set(['entity', 'attribute', 'metadata', 'relationship', 'package']);
      const filtered = hits.filter((h) => supported.has(h.kind));
      // The index already returns hits best-first (bm25 + per-kind tier). Legacy
      // score semantics are "higher = better", so emit a rank-based descending
      // score in (0,1] that preserves that order regardless of bm25 magnitude.
      return filtered.map((h, i) => ({
        type: h.kind as SearchResult['type'],
        service: h.package,
        entityName: h.entityName,
        attributeName: h.kind === 'attribute' ? h.name : undefined,
        name: h.name,
        description: h.description,
        path: h.kind === 'entity' ? `${h.package}/${h.name}`
          : h.kind === 'attribute' ? `${h.package}/${h.entityName}`
          : h.package,
        score: 1 - i / (filtered.length || 1),
        matchContext: h.snippet,
      }));
    }

    try {
      const results: SearchResult[] = [];
      const allEntities = await listAllEntities();
      const searchTerms = query.toLowerCase().split(/\s+/);
      const microservices = await listMicroservices();

      // Search packages
      if (!filters?.type || filters.type === 'package') {
        for (const ms of microservices) {
          if (filters?.service && filters.service !== ms) continue;
          const score = this.calculateMatchScore(ms, searchTerms);
          if (score > 0) {
            results.push({ type: 'package', service: ms, entityName: '', name: ms, description: '', path: ms, score });
          }
        }
      }

      for (const entityInfo of allEntities) {
        if (filters?.service && filters.service !== entityInfo.microservice) continue;

        // Extract clean entity name from UUID-prefixed filename (e.g. "uuid_Order" → "Order")
        const cleanName = entityInfo.name.includes('_') ? entityInfo.name.split('_').slice(1).join('_') : entityInfo.name;
        const entity = await readEntityFile(entityInfo.microservice, cleanName);
        if (!entity) continue;

        // Stereotype filter
        if (filters?.stereotype && entity.stereotype !== filters.stereotype) continue;

        // hasMetadata filter
        if (filters?.hasMetadata) {
          const hasIt = entity.metadata?.some(m => m.name === filters.hasMetadata) ||
            entity.attributes.some(a => a.metadata?.some(m => m.name === filters.hasMetadata));
          if (!hasIt) continue;
        }

        // Search entity name/description
        if (!filters?.type || filters.type === 'entity') {
          const entityNameMatch = this.calculateMatchScore(entity.name, searchTerms);
          const entityDescMatch = this.calculateMatchScore(entity.description || '', searchTerms);
          const stereotypeMatch = entity.stereotype ? this.calculateMatchScore(entity.stereotype, searchTerms) : 0;

          if (entityNameMatch > 0 || entityDescMatch > 0 || stereotypeMatch > 0) {
            results.push({
              type: 'entity', service: entityInfo.microservice, entityName: entity.name,
              name: entity.name, description: entity.description || '',
              path: `${entityInfo.microservice}/${entity.name}`,
              score: Math.max(entityNameMatch * 2, entityDescMatch, stereotypeMatch * 1.5),
              matchContext: stereotypeMatch > 0 ? `stereotype: ${entity.stereotype}` : undefined,
            });
          }
        }

        // Search attributes
        if (!filters?.type || filters.type === 'attribute') {
          for (const attr of entity.attributes) {
            const attrNameMatch = this.calculateMatchScore(attr.name, searchTerms);
            const attrDescMatch = this.calculateMatchScore(attr.description, searchTerms);

            if (attrNameMatch > 0 || attrDescMatch > 0) {
              results.push({
                type: 'attribute', service: entityInfo.microservice, entityName: entity.name,
                attributeName: attr.name, name: attr.name, description: attr.description,
                path: `${entityInfo.microservice}/${entity.name}/${attr.name}`,
                score: Math.max(attrNameMatch * 1.5, attrDescMatch),
              });
            }
          }
        }

        // Search entity metadata
        if (!filters?.type || filters.type === 'metadata') {
          // Handle metadata as array [{name,value}] or object {key: value}
          const entityMeta = this.normalizeMetadata(entity.metadata);
          for (const m of entityMeta) {
            const nameMatch = this.calculateMatchScore(m.name, searchTerms);
            const valueStr = metadataValueToSearchString(m.value);
            const valueMatch = this.calculateMatchScore(valueStr, searchTerms);

            if (nameMatch > 0 || valueMatch > 0) {
              results.push({
                type: 'metadata', service: entityInfo.microservice, entityName: entity.name,
                name: m.name, description: `${m.name} = ${valueStr}`,
                path: `${entityInfo.microservice}/${entity.name}`,
                score: Math.max(nameMatch * 1.5, valueMatch),
                matchContext: `on entity ${entity.name}`,
              });
            }
          }

          // Search attribute metadata
          for (const attr of entity.attributes) {
            const attrMeta = this.normalizeMetadata(attr.metadata);
            for (const m of attrMeta) {
              const nameMatch = this.calculateMatchScore(m.name, searchTerms);
              const valueStr = metadataValueToSearchString(m.value);
              const valueMatch = this.calculateMatchScore(valueStr, searchTerms);

              if (nameMatch > 0 || valueMatch > 0) {
                results.push({
                  type: 'metadata', service: entityInfo.microservice, entityName: entity.name,
                  attributeName: attr.name, name: m.name, description: `${m.name} = ${valueStr}`,
                  path: `${entityInfo.microservice}/${entity.name}/${attr.name}`,
                  score: Math.max(nameMatch * 1.5, valueMatch),
                  matchContext: `on ${entity.name}.${attr.name}`,
                });
              }
            }
          }
        }
      }

      // Search relationships
      if (!filters?.type || filters.type === 'relationship') {
        const allRels = await getAllRelationships();
        // Build entity name map for display
        const entityNameMap = new Map<string, { name: string; service: string }>();
        for (const entityInfo of allEntities) {
          const e = await readEntityFile(entityInfo.microservice, entityInfo.name);
          if (e) entityNameMap.set(e.uuid, { name: e.name, service: entityInfo.microservice });
        }

        for (const { packageName, relationships } of allRels) {
          if (filters?.service && filters.service !== packageName) continue;
          for (const rel of relationships) {
            const descMatch = this.calculateMatchScore(rel.description || '', searchTerms);
            const srcInfo = entityNameMap.get(rel.source.entity);
            const tgtInfo = entityNameMap.get(rel.target.entity);
            const srcMatch = srcInfo ? this.calculateMatchScore(srcInfo.name, searchTerms) : 0;
            const tgtMatch = tgtInfo ? this.calculateMatchScore(tgtInfo.name, searchTerms) : 0;

            if (descMatch > 0 || srcMatch > 0 || tgtMatch > 0) {
              results.push({
                type: 'relationship', service: packageName, entityName: srcInfo?.name || rel.source.entity,
                name: rel.description || rel.uuid,
                description: `${srcInfo?.name || '?'} → ${tgtInfo?.name || '?'}`,
                path: `${packageName}/relationships/${rel.uuid}`,
                score: Math.max(descMatch, srcMatch, tgtMatch),
              });
            }
          }
        }
      }

      return results.sort((a, b) => b.score - a.score);
    } catch (error) {
      logger.error(`Error searching entities: ${error}`);
      return [];
    }
  }

  private normalizeMetadata(metadata: any): Array<{ name: string; value: any }> {
    if (!metadata) return [];
    if (Array.isArray(metadata)) return metadata;
    // Object format: { key: value } → [{name: key, value}]
    if (typeof metadata === 'object') {
      return Object.entries(metadata).map(([name, value]) => ({ name, value }));
    }
    return [];
  }

  private calculateMatchScore(text: string, searchTerms: string[]): number {
    if (!text) return 0;

    const normalizedText = text.toLowerCase();
    let score = 0;

    for (const term of searchTerms) {
      if (normalizedText.includes(term)) {
        score += 1;
        const regex = new RegExp(`\\b${term}\\b`, 'i');
        if (regex.test(normalizedText)) {
          score += 0.5;
        }
      }
    }

    return score;
  }

  // --- Impact Analysis ---

  async getImpactAnalysis(entityUuid: string): Promise<ImpactAnalysis> {
    const impact: ImpactAnalysis = { relationships: [], cases: [], diagrams: [] };

    try {
      // Find relationships referencing this entity
      const allRels = await getAllRelationships();
      const allEntities = await listAllEntities();
      const entityNameMap = new Map<string, string>();
      for (const info of allEntities) {
        const e = await readEntityFile(info.microservice, info.name);
        if (e) entityNameMap.set(e.uuid, e.name);
      }

      for (const { packageName, relationships } of allRels) {
        for (const rel of relationships) {
          if (rel.source.entity === entityUuid || rel.target.entity === entityUuid) {
            impact.relationships.push({
              uuid: rel.uuid,
              description: rel.description || '',
              service: packageName,
              sourceEntity: entityNameMap.get(rel.source.entity) || rel.source.entity,
              targetEntity: entityNameMap.get(rel.target.entity) || rel.target.entity,
            });
          }
        }
      }

      // Find cases containing this entity
      const { listCases } = await import('../utils/fileOperations.js');
      const cases = await listCases();
      const { caseService } = await import('./caseService.js');
      for (const c of cases) {
        const resolved = await caseService.resolve(c.uuid);
        if (resolved?.resolvedNodes.some(n => n.entityUuid === entityUuid)) {
          const paths = resolved.resolvedNodes.filter(n => n.entityUuid === entityUuid).map(n => n.path);
          impact.cases.push({ uuid: c.uuid, name: c.name, path: paths[0] });
        }
      }

      // Find diagrams referencing this entity
      const { diagramService } = await import('./diagramService.js');
      const layouts = await diagramService.listDiagramLayouts();
      for (const layout of layouts) {
        if (layout.entities && layout.entities[entityUuid]) {
          impact.diagrams.push({ id: layout.id, name: layout.name });
        }
      }
    } catch (error) {
      logger.error(`Error getting impact analysis: ${error}`);
    }

    return impact;
  }

  // --- Lineage ---

  async getLineage(entityUuid: string): Promise<LineageResult> {
    // Build entity name map
    const allEntities = await listAllEntities();
    const entityNameMap = new Map<string, { name: string; service: string }>();
    for (const info of allEntities) {
      const cleanName = info.name.includes('_') ? info.name.split('_').slice(1).join('_') : info.name;
      const e = await readEntityFile(info.microservice, cleanName);
      if (e) entityNameMap.set(e.uuid, { name: e.name, service: info.microservice });
    }

    const entityInfo = entityNameMap.get(entityUuid) || { name: entityUuid, service: '' };
    const result: LineageResult = {
      entity: { uuid: entityUuid, name: entityInfo.name, service: entityInfo.service },
      upstream: [],
      downstream: [],
    };

    // Collect all lineage relationships
    const allRels = await getAllRelationships();
    const lineageRels: Relationship[] = [];
    for (const { relationships } of allRels) {
      for (const rel of relationships) {
        if (rel.type === 'lineage') lineageRels.push(rel);
      }
    }

    // Walk upstream (follow source chains): entity is target, find sources
    const visitedUp = new Set<string>();
    const walkUpstream = (uuid: string, depth: number) => {
      if (visitedUp.has(uuid) || depth > 10) return;
      visitedUp.add(uuid);
      for (const rel of lineageRels) {
        if (rel.target.entity === uuid) {
          const srcInfo = entityNameMap.get(rel.source.entity);
          if (srcInfo) {
            result.upstream.push({
              entityUuid: rel.source.entity,
              entityName: srcInfo.name,
              service: srcInfo.service,
              direction: 'upstream',
              depth,
              relationship: { uuid: rel.uuid, description: rel.description || '' },
            });
            walkUpstream(rel.source.entity, depth + 1);
          }
        }
      }
    };

    // Walk downstream (follow target chains): entity is source, find targets
    const visitedDown = new Set<string>();
    const walkDownstream = (uuid: string, depth: number) => {
      if (visitedDown.has(uuid) || depth > 10) return;
      visitedDown.add(uuid);
      for (const rel of lineageRels) {
        if (rel.source.entity === uuid) {
          const tgtInfo = entityNameMap.get(rel.target.entity);
          if (tgtInfo) {
            result.downstream.push({
              entityUuid: rel.target.entity,
              entityName: tgtInfo.name,
              service: tgtInfo.service,
              direction: 'downstream',
              depth,
              relationship: { uuid: rel.uuid, description: rel.description || '' },
            });
            walkDownstream(rel.target.entity, depth + 1);
          }
        }
      }
    };

    walkUpstream(entityUuid, 1);
    walkDownstream(entityUuid, 1);

    return result;
  }

  // --- Status transitions ---

  async changeEntityStatus(service: string, entityName: string, newStatus: EntityStatus): Promise<{ success: boolean; errors: string[] }> {
    const entity = await readEntityFile(service, entityName);
    if (!entity) return { success: false, errors: ['Entity not found'] };

    const current = entity.status || EntityStatus.DRAFT;
    const validTransitions: Record<string, EntityStatus[]> = {
      [EntityStatus.DRAFT]: [EntityStatus.SUBMITTED],
      [EntityStatus.SUBMITTED]: [EntityStatus.APPROVED, EntityStatus.RETURNED],
      [EntityStatus.RETURNED]: [EntityStatus.SUBMITTED],
      [EntityStatus.APPROVED]: [EntityStatus.DRAFT], // re-open for editing
    };

    if (!validTransitions[current]?.includes(newStatus)) {
      return { success: false, errors: [`Cannot transition from ${current} to ${newStatus}`] };
    }

    entity.status = newStatus;
    entity.updatedAt = new Date().toISOString();

    // Slice 6b''''': route through the registered LogicalProjection so the
    // slice-6c UuidIndex sees the invalidation event. Last serviceService
    // entity-write site. Closes Risk §11.6 for the controller-routed PUT
    // /api/services/:service/entities/:name/status path.
    try {
      const projection = getProjection(wsId('dictionaries'));
      const logicalPath = `packages/${service}/entities/${entity.name}`;
      await projection.writeEntity(logicalPath, entity);
      return { success: true, errors: [] };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return { success: false, errors: [message] };
    }
  }

  // --- Comments ---

  async getComments(service: string, entityName: string): Promise<ReviewComment[]> {
    const entity = await readEntityFile(service, entityName);
    if (!entity) return [];
    return readComments(service, entity.uuid);
  }

  async addComment(service: string, entityName: string, comment: Omit<ReviewComment, 'id' | 'timestamp'>): Promise<{ success: boolean; comment?: ReviewComment; errors?: string[] }> {
    const entity = await readEntityFile(service, entityName);
    if (!entity) return { success: false, errors: ['Entity not found'] };

    const comments = await readComments(service, entity.uuid);
    const newComment: ReviewComment = {
      id: `c-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      author: comment.author,
      timestamp: new Date().toISOString(),
      message: comment.message,
      targetField: comment.targetField,
      resolved: false,
    };
    comments.push(newComment);
    const ok = await writeComments(service, entity.uuid, comments);
    return ok ? { success: true, comment: newComment } : { success: false, errors: ['Failed to write comments'] };
  }

  async resolveComment(service: string, entityName: string, commentId: string): Promise<{ success: boolean; errors?: string[] }> {
    const entity = await readEntityFile(service, entityName);
    if (!entity) return { success: false, errors: ['Entity not found'] };

    const comments = await readComments(service, entity.uuid);
    const comment = comments.find(c => c.id === commentId);
    if (!comment) return { success: false, errors: ['Comment not found'] };

    comment.resolved = true;
    const ok = await writeComments(service, entity.uuid, comments);
    return ok ? { success: true } : { success: false, errors: ['Failed to write comments'] };
  }

  /**
   * Get graph data for visualization - reads relationships from package-level file
   */
  async getGraphData(service: string): Promise<GraphData> {
    logger.info(`Generating graph data for service: ${service}`);

    try {
      const graphData: GraphData = {
        nodes: [],
        edges: []
      };

      const entities = await this.getServiceEntities(service);
      const entityUuidToName = new Map<string, string>();

      for (const entity of entities) {
        entityUuidToName.set(entity.uuid, entity.name);
        graphData.nodes.push({
          id: entity.uuid,
          label: entity.name,
          type: 'entity',
          service
        });
      }

      // Read relationships from package-level file
      const packagePath = getPackagePath(service);
      const relationships = await readRelationshipsFile(packagePath);

      for (const rel of relationships) {
        const sourceName = entityUuidToName.get(rel.source.entity) || rel.source.entity;
        const targetName = entityUuidToName.get(rel.target.entity) || rel.target.entity;

        graphData.edges.push({
          id: rel.uuid,
          source: rel.source.entity,
          target: rel.target.entity,
          label: rel.target.name || `${sourceName} -> ${targetName}`,
          sourceCardinality: rel.source.cardinality,
          targetCardinality: rel.target.cardinality
        });
      }

      return graphData;
    } catch (error) {
      logger.error(`Error generating graph data: ${error}`);
      return { nodes: [], edges: [] };
    }
  }
}

// Export a singleton instance
export const serviceService = new ServiceService();
