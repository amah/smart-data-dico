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
  DATE_TIME = 'date-time',
  TIMESTAMP = 'timestamp',
  DURATION = 'duration',
  ENUM = 'enum',
  OBJECT = 'object',
  ARRAY = 'array'
}

/**
 * Cardinality for relationship ends
 */
export enum Cardinality {
  ONE = 'one',
  MANY = 'many'
}

/**
 * Metadata value types for typed metadata definitions
 */
export enum MetadataValueType {
  STRING = 'string',
  NUMBER = 'number',
  BOOLEAN = 'boolean',
  DATE = 'date',
  FLAG = 'flag',
  RULE = 'rule',
}

export enum RuleSeverity {
  INFO = 'info',
  WARNING = 'warning',
  ERROR = 'error',
}

/**
 * A metadata definition (schema for metadata entries)
 */
export interface MetadataDefinition {
  name: string;
  type: MetadataValueType;
  description?: string;
  required?: boolean;
}

/**
 * A typed metadata entry
 */
export interface MetadataEntry {
  name: string;
  value: string | number | boolean;
  severity?: RuleSeverity;
}

export enum EntityStatus {
  DRAFT = 'draft',
  SUBMITTED = 'submitted',
  APPROVED = 'approved',
  RETURNED = 'returned',
}

export interface ReviewComment {
  id: string;
  author: string;
  timestamp: string;
  message: string;
  targetField?: string;
  resolved?: boolean;
}

export type StereotypeTarget = 'package' | 'entity' | 'attribute';

export interface Stereotype {
  id: string;
  name: string;
  description?: string;
  appliesTo: StereotypeTarget;
  metadataDefinitions: MetadataDefinition[];
}

/**
 * A node in a perspective — annotates, sets frontier, or excludes a path
 */
export interface PerspectiveNode {
  path: string;
  traverse?: boolean;
  exclude?: boolean;
  metadata?: MetadataEntry[];
}

/**
 * A perspective is a business view over a subset of the data model
 */
export interface Perspective {
  uuid: string;
  name: string;
  description?: string;
  rootEntities: string[];
  nodes?: PerspectiveNode[];
  maxDepth?: number;
  metadata?: MetadataEntry[];
  createdAt?: string;
  updatedAt?: string;
}

/**
 * A resolved node from BFS traversal of a perspective
 */
export interface ResolvedNode {
  entityUuid: string;
  entityName: string;
  service: string;
  path: string;
  hopDistance: number;
  isRoot: boolean;
  isFrontier: boolean;
  isManualInclusion: boolean;
}

/**
 * A perspective with its resolved entity graph
 */
export interface ResolvedPerspective extends Perspective {
  resolvedNodes: ResolvedNode[];
}

/**
 * Grouped constraint fields for attributes
 */
export interface AttributeConstraints {
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  format?: string;
  minimum?: number;
  maximum?: number;
  precision?: number;
  scale?: number;
  enumValues?: string[];
}

/**
 * Interface for entity attribute definition
 */
export interface Attribute {
  uuid: string;
  name: string;
  description: string;
  type: AttributeType;
  required: boolean;
  unique?: boolean;
  primaryKey?: boolean;
  defaultValue?: any;
  examples?: any[];
  constraints?: AttributeConstraints;

  // For object and array types
  items?: Attribute;
  properties?: Attribute[];

  // Typed metadata
  metadata?: MetadataEntry[];
}

/**
 * One end of a relationship
 */
export interface RelationshipEnd {
  entity: string; // UUID of the entity
  cardinality: Cardinality;
  name?: string; // Navigation property name
  referenceAttributes?: string[];
}

/**
 * A relationship between two entities, stored at package level
 */
export interface Relationship {
  uuid: string;
  description?: string;
  source: RelationshipEnd;
  target: RelationshipEnd;
  metadata?: MetadataEntry[];
}

/**
 * Interface for entity definition
 */
export interface Entity {
  uuid: string;
  name: string;
  description?: string;
  stereotype?: string;
  status?: EntityStatus;
  attributes: Attribute[];
  metadata?: MetadataEntry[];
  createdAt?: string;
  updatedAt?: string;
}

// Backward-compatible alias
export type EntityAttribute = Attribute;

/**
 * JSON Schema for validating entity definitions
 */
export const entitySchema: Schema = {
  type: 'object',
  required: ['uuid', 'name', 'attributes'],
  properties: {
    uuid: { type: 'string', pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' },
    name: { type: 'string' },
    description: { type: 'string' },
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
          primaryKey: { type: 'boolean' },
          defaultValue: { },
          examples: { type: 'array' },
          constraints: {
            type: 'object',
            properties: {
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
              }
            }
          },
          items: { type: 'object' },
          properties: { type: 'array' },
          metadata: { type: 'array' }
        }
      }
    },
    metadata: { type: 'array' },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' }
  }
};

/**
 * JSON Schema for validating relationship definitions
 */
export const relationshipSchema: Schema = {
  type: 'object',
  required: ['uuid', 'source', 'target'],
  properties: {
    uuid: { type: 'string', pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' },
    description: { type: 'string' },
    source: {
      type: 'object',
      required: ['entity', 'cardinality'],
      properties: {
        entity: { type: 'string' },
        cardinality: { type: 'string', enum: Object.values(Cardinality) },
        name: { type: 'string' },
        referenceAttributes: { type: 'array', items: { type: 'string' } }
      }
    },
    target: {
      type: 'object',
      required: ['entity', 'cardinality'],
      properties: {
        entity: { type: 'string' },
        cardinality: { type: 'string', enum: Object.values(Cardinality) },
        name: { type: 'string' },
        referenceAttributes: { type: 'array', items: { type: 'string' } }
      }
    },
    metadata: { type: 'array' }
  }
};

/**
 * Validates an entity definition against the schema
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
  if (entity.attributes) {
    entity.attributes.forEach((attr, index) => {
      if (!isValidUUID(attr.uuid)) {
        errors.push(`Attribute ${index} UUID is invalid`);
      }
    });
  }

  return {
    valid: result.valid && errors.length === 0,
    errors
  };
}

/**
 * Validates a relationship definition against the schema
 */
export function validateRelationship(relationship: Relationship): { valid: boolean; errors: string[] } {
  const validator = new Validator();
  const result = validator.validate(relationship, relationshipSchema);

  const errors: string[] = result.errors.map((error: any) => error.stack);

  if (!isValidUUID(relationship.uuid)) {
    errors.push('Relationship UUID is invalid');
  }

  return {
    valid: result.valid && errors.length === 0,
    errors
  };
}

/**
 * Creates a new entity with UUIDs for all components
 */
export function createEntityWithUUIDs(entityData: Omit<Entity, 'uuid' | 'attributes'> & {
  attributes: Omit<Attribute, 'uuid'>[];
}): Entity {
  return {
    ...entityData,
    uuid: generateUUID(),
    attributes: entityData.attributes.map(attr => ({
      ...attr,
      uuid: generateUUID(),
      properties: attr.properties ? attr.properties.map(prop => ({
        ...prop,
        uuid: prop.uuid || generateUUID()
      })) : attr.properties,
      items: attr.items ? { ...attr.items, uuid: attr.items.uuid || generateUUID() } : attr.items
    }))
  };
}
