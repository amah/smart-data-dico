import { Entity, Relationship, validateEntity, validateRelationship } from '../models/EntitySchema.js';
import { readEntityFile, listAllEntities, readRelationshipsFile, getPackagePath } from '../utils/fileOperations.js';
import { logger } from '../utils/logger.js';
import { getProjection } from '../storage/projection/ProjectionRegistry.js';
import { wsId } from '../storage/contract/types.js';

/**
 * Service for managing entities and their relationships
 */
export class EntityService {
  /**
   * Validates an entity's structure and data
   */
  validateEntity(entity: Entity): { valid: boolean; errors: string[] } {
    return validateEntity(entity);
  }

  /**
   * Validates relationships at the package level
   */
  async validateRelationships(packageName: string, relationships: Relationship[]): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];

    for (const rel of relationships) {
      const relValidation = validateRelationship(rel);
      if (!relValidation.valid) {
        errors.push(...relValidation.errors);
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Creates or updates an entity
   */
  async saveEntity(entity: Entity, packageName: string): Promise<{ success: boolean; errors: string[] }> {
    const structureValidation = this.validateEntity(entity);
    if (!structureValidation.valid) {
      return {
        success: false,
        errors: structureValidation.errors
      };
    }

    // Slice 6b': route through the registered LogicalProjection so the
    // slice-6c UuidIndex sees the invalidation event. Closes Risk §11.6
    // for this write path.
    try {
      const projection = getProjection(wsId('dictionaries'));
      const logicalPath = `packages/${packageName}/entities/${entity.name}`;
      await projection.writeEntity(logicalPath, entity);
      return { success: true, errors: [] };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return { success: false, errors: [message] };
    }
  }

  /**
   * Gets an entity by package and name
   */
  async getEntity(packageName: string, entityName: string): Promise<Entity | null> {
    return await readEntityFile(packageName, entityName);
  }

  /**
   * Gets all entities that have a relationship with the specified entity
   * Uses package-level relationships.yaml files
   */
  async getRelatedEntities(packageName: string, entityName: string): Promise<Entity[]> {
    const entity = await readEntityFile(packageName, entityName);
    if (!entity) return [];

    const entityUuid = entity.uuid;
    const packagePath = getPackagePath(packageName);
    const relationships = await readRelationshipsFile(packagePath);
    const relatedEntities: Entity[] = [];

    // Find relationships involving this entity
    for (const rel of relationships) {
      let targetUuid: string | null = null;

      if (rel.source.entity === entityUuid) {
        targetUuid = rel.target.entity;
      } else if (rel.target.entity === entityUuid) {
        targetUuid = rel.source.entity;
      }

      if (targetUuid) {
        // Find the entity by UUID across all entities in the package
        const allEntities = await listAllEntities();
        for (const entityInfo of allEntities) {
          const candidate = await readEntityFile(entityInfo.microservice, entityInfo.name);
          if (candidate && candidate.uuid === targetUuid && !relatedEntities.some(e => e.uuid === candidate.uuid)) {
            relatedEntities.push(candidate);
          }
        }
      }
    }

    return relatedEntities;
  }
}

// Export a singleton instance
export const entityService = new EntityService();
