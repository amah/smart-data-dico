import { Entity, EntityRelationship, RelationshipType, validateEntity } from '../models/EntitySchema.js';
import { readEntityFile, writeEntityFile, listAllEntities } from '../utils/fileOperations.js';
import { logger } from '../utils/logger.js';

/**
 * Service for managing entities and their relationships
 */
export class EntityService {
  /**
   * Validates an entity's structure and data
   * @param entity Entity to validate
   * @returns Validation result with errors if any
   */
  validateEntity(entity: Entity): { valid: boolean; errors: string[] } {
    return validateEntity(entity);
  }

  /**
   * Validates relationships between entities
   * @param entity Entity with relationships to validate
   * @returns Validation result with errors if any
   */
  async validateRelationships(entity: Entity): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];
    
    if (!entity.relationships || entity.relationships.length === 0) {
      return { valid: true, errors: [] };
    }
    
    for (const relationship of entity.relationships) {
      const targetEntity = await readEntityFile(relationship.target.split('.')[0], relationship.target.split('.')[1]);
      
      if (!targetEntity) {
        errors.push(`Target entity not found: ${relationship.target}`);
        continue;
      }
      
      // Check if the relationship type is valid for the target entity
      switch (relationship.type) {
        case RelationshipType.BELONGS_TO:
          // Valid if target entity has a primary key
          if (!this.hasPrimaryKey(targetEntity)) {
            errors.push(`Target entity ${relationship.target} does not have a primary key for belongsTo relationship`);
          }
          break;
          
        case RelationshipType.HAS_ONE:
        case RelationshipType.HAS_MANY:
          // Check if the inverse relationship exists in the target entity
          if (relationship.inverseName && !this.hasInverseRelationship(targetEntity, entity.microservice + '.' + entity.name, relationship.inverseName)) {
            errors.push(`Inverse relationship ${relationship.inverseName} not found in target entity ${relationship.target}`);
          }
          break;
          
        case RelationshipType.MANY_TO_MANY:
          // Many-to-many should have an inverse relationship
          if (!relationship.inverseName) {
            errors.push(`Many-to-many relationship ${relationship.name} should have an inverse name`);
          } else if (!this.hasInverseRelationship(targetEntity, entity.microservice + '.' + entity.name, relationship.inverseName)) {
            errors.push(`Inverse relationship ${relationship.inverseName} not found in target entity ${relationship.target}`);
          }
          break;
      }
    }
    
    return {
      valid: errors.length === 0,
      errors
    };
  }
  
  /**
   * Checks if an entity has a primary key attribute
   * @param entity Entity to check
   * @returns True if the entity has a primary key
   */
  private hasPrimaryKey(entity: Entity): boolean {
    return entity.attributes.some(attr => 
      attr.metadata && attr.metadata.isPrimaryKey === true
    );
  }
  
  /**
   * Checks if an entity has an inverse relationship
   * @param entity Entity to check
   * @param sourceName Source entity name (microservice.entity)
   * @param inverseName Name of the inverse relationship
   * @returns True if the inverse relationship exists
   */
  private hasInverseRelationship(entity: Entity, sourceName: string, inverseName: string): boolean {
    return entity.relationships?.some(rel => 
      rel.name === inverseName && rel.target === sourceName
    ) || false;
  }
  
  /**
   * Creates or updates an entity
   * @param entity Entity to save
   * @returns Success status and any validation errors
   */
  async saveEntity(entity: Entity): Promise<{ success: boolean; errors: string[] }> {
    // Validate entity structure
    const structureValidation = this.validateEntity(entity);
    if (!structureValidation.valid) {
      return { 
        success: false, 
        errors: structureValidation.errors 
      };
    }
    
    // Validate relationships
    const relationshipValidation = await this.validateRelationships(entity);
    if (!relationshipValidation.valid) {
      return { 
        success: false, 
        errors: relationshipValidation.errors 
      };
    }
    
    // Save entity to file
    const saved = await writeEntityFile(entity);
    
    return {
      success: saved,
      errors: saved ? [] : ['Failed to write entity file']
    };
  }
  
  /**
   * Gets an entity by microservice and name
   * @param microservice Microservice name
   * @param entityName Entity name
   * @returns Entity or null if not found
   */
  async getEntity(microservice: string, entityName: string): Promise<Entity | null> {
    return await readEntityFile(microservice, entityName);
  }
  
  /**
   * Gets all entities that have a relationship with the specified entity
   * @param microservice Microservice name
   * @param entityName Entity name
   * @returns Array of related entities
   */
  async getRelatedEntities(microservice: string, entityName: string): Promise<Entity[]> {
    const allEntities = await listAllEntities();
    const relatedEntities: Entity[] = [];
    const fullName = `${microservice}.${entityName}`;
    
    for (const entityInfo of allEntities) {
      if (entityInfo.microservice === microservice && entityInfo.name === entityName) {
        continue; // Skip the entity itself
      }
      
      const entity = await readEntityFile(entityInfo.microservice, entityInfo.name);
      
      if (entity && entity.relationships && entity.relationships.some(rel => rel.target === fullName)) {
        relatedEntities.push(entity);
      }
    }
    
    return relatedEntities;
  }
}

// Export a singleton instance
export const entityService = new EntityService();