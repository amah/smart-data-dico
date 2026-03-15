import { Validator } from 'jsonschema';
import { generateUUID, isValidUUID } from '../utils/uuid.js';
type Schema = any; // Using any as a workaround for missing type definitions

/**
 * Supported attribute types in the data dictionary
 */
export enum AttributeType {
  STRING = 'string',
  NUMBER = 'number',
  INTEGER = 'integer',
  BOOLEAN = 'boolean',
  DATETIME = 'datetime',
  DATE = 'date',
  TIME = 'time',
  ENUM = 'enum',
  OBJECT = 'object',
  ARRAY = 'array',
  REFERENCE = 'reference'
}

/**
 * Supported relationship types between entities
 */
export enum RelationshipType {
  HAS_ONE = 'hasOne',
  HAS_MANY = 'hasMany',
  BELONGS_TO = 'belongsTo',
  MANY_TO_MANY = 'manyToMany'
}

/**
 * Interface for entity attribute definition
 */
export interface EntityAttribute {
  uuid: string;
  name: string;
  description: string;
  type: AttributeType;
  required: boolean;
  unique?: boolean;
  defaultValue?: any;
  examples?: any[];
  
  // Type-specific metadata
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  format?: string;
  minimum?: number;
  maximum?: number;
  precision?: number;
  scale?: number;
  enumValues?: string[];
  
  // For object and array types
  items?: EntityAttribute;
  properties?: Record<string, EntityAttribute>;
  
  // Additional metadata
  metadata?: Record<string, any>;
}

/**
 * Interface for entity relationship definition
 */
export interface EntityRelationship {
  uuid: string;
  name: string;
  description: string;
  type: RelationshipType;
  target: string;
  inverseName?: string;
  required: boolean;
  
  // Foreign key information
  foreignKey?: string;
  
  // Additional metadata
  metadata?: Record<string, any>;
}

/**
 * Interface for entity definition
 */
/**
 * Interface for entity definition.
 * Now supports an optional packageId to indicate the parent package.
 */
export interface Entity {
  uuid: string;
  id: string; // Keep for backward compatibility, but UUID is primary reference
  name: string;
  description: string;
  microservice: string;
  version: string;
  /**
   * Optional: the ID of the parent package this entity belongs to.
   */
  packageId?: string;
  attributes: EntityAttribute[];
  relationships?: EntityRelationship[];
  metadata?: Record<string, any>;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * JSON Schema for validating entity definitions
 */
export const entitySchema: Schema = {
  type: 'object',
  required: ['uuid', 'id', 'name', 'description', 'microservice', 'version', 'attributes'],
  properties: {
    uuid: { type: 'string', pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' },
    id: { type: 'string' },
    name: { type: 'string' },
    description: { type: 'string' },
    microservice: { type: 'string' },
    version: { type: 'string' },
    attributes: {
      type: 'array',
      items: {
        type: 'object',
        required: ['uuid', 'name', 'description', 'type', 'required'],
        properties: {
          uuid: { type: 'string', pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' },
          name: { type: 'string' },
          description: { type: 'string' },
          type: {
            type: 'string',
            enum: Object.values(AttributeType)
          },
          required: { type: 'boolean' },
          unique: { type: 'boolean' },
          defaultValue: { },
          examples: { type: 'array' },
          minLength: { type: 'integer', minimum: 0 },
          maxLength: { type: 'integer', minimum: 0 },
          pattern: { type: 'string' },
          format: { type: 'string' },
          minimum: { type: 'number' },
          maximum: { type: 'number' },
          precision: { type: 'integer', minimum: 0 },
          scale: { type: 'integer', minimum: 0 },
          enumValues: {
            type: 'array',
            items: { type: 'string' }
          },
          items: { type: 'object' },
          properties: { type: 'object' },
          metadata: { type: 'object' }
        }
      }
    },
    relationships: {
      type: 'array',
      items: {
        type: 'object',
        required: ['uuid', 'name', 'description', 'type', 'target', 'required'],
        properties: {
          uuid: { type: 'string', pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' },
          name: { type: 'string' },
          description: { type: 'string' },
          type: {
            type: 'string',
            enum: Object.values(RelationshipType)
          },
          target: { type: 'string' },
          inverseName: { type: 'string' },
          required: { type: 'boolean' },
          foreignKey: { type: 'string' },
          metadata: { type: 'object' }
        }
      }
    },
    metadata: { type: 'object' },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' }
  }
};

/**
 * Validates an entity definition against the schema
 * @param entity Entity to validate
 * @returns Validation result
 */
export function validateEntity(entity: Entity): { valid: boolean; errors: string[] } {
  const validator = new Validator();
  const result = validator.validate(entity, entitySchema);
  
  const errors: string[] = result.errors.map((error: any) => error.stack);
  
  // Additional UUID validation
  if (!isValidUUID(entity.uuid)) {
    errors.push('Entity UUID is invalid');
  }
  
  // Validate attribute UUIDs
  entity.attributes.forEach((attr, index) => {
    if (!isValidUUID(attr.uuid)) {
      errors.push(`Attribute ${index} UUID is invalid`);
    }
  });
  
  // Validate relationship UUIDs
  if (entity.relationships) {
    entity.relationships.forEach((rel, index) => {
      if (!isValidUUID(rel.uuid)) {
        errors.push(`Relationship ${index} UUID is invalid`);
      }
    });
  }
  
  return {
    valid: result.valid && errors.length === 0,
    errors
  };
}

/**
 * Creates a new entity with UUIDs for all components
 * @param entityData Partial entity data
 * @returns Complete entity with UUIDs
 */
export function createEntityWithUUIDs(entityData: Omit<Entity, 'uuid' | 'attributes' | 'relationships'> & {
  attributes: Omit<EntityAttribute, 'uuid'>[];
  relationships?: Omit<EntityRelationship, 'uuid'>[];
}): Entity {
  return {
    ...entityData,
    uuid: generateUUID(),
    attributes: entityData.attributes.map(attr => ({
      ...attr,
      uuid: generateUUID(),
      // Recursively add UUIDs to nested properties if they exist
      properties: attr.properties ? Object.fromEntries(
        Object.entries(attr.properties).map(([key, prop]) => [
          key,
          { ...prop, uuid: generateUUID() }
        ])
      ) : attr.properties,
      items: attr.items ? { ...attr.items, uuid: generateUUID() } : attr.items
    })),
    relationships: entityData.relationships?.map(rel => ({
      ...rel,
      uuid: generateUUID()
    })) || []
  };
}