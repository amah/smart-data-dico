import { Validator } from 'jsonschema';
import { generateUUID, isValidUUID } from '../utils/uuid.js';
import type { Rule } from './Rule.js';
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
  ARRAY = 'array',
  /**
   * Logical UUID type (#69). Maps to native UUID column types where the
   * target DB supports them (Postgres `uuid`, Oracle `RAW(16)`, etc.) and
   * to STRING elsewhere. The physical mapping (which DB type it becomes)
   * is carried separately in attribute metadata under `physical.dbType`.
   */
  UUID = 'uuid',
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

export type StereotypeTarget = 'package' | 'entity' | 'attribute' | 'model' | 'relationship';

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
  /** Validation rules scoped to this perspective (#74). Use `any[]` to avoid a circular import on Rule. */
  rules?: any[];
  createdAt?: string;
  updatedAt?: string;
}

/**
 * Slim attribute view used on resolved perspective nodes — avoids shipping
 * the full `Attribute` (which carries validation, metadata, nested items,
 * etc.) when the tree view only needs the cheap display fields.
 */
export interface ResolvedAttribute {
  name: string;
  type: AttributeType;
  required: boolean;
  primaryKey?: boolean;
  metadata?: MetadataEntry[];
}

/**
 * A resolved node from BFS traversal of a perspective.
 *
 * The tree view renders each non-root as `<navName> (<navCardinality>) →
 * <entityName>`. `navName` is the relationship end-name at the side the
 * traversal arrives at (the child); `navCardinality` pairs the origin's
 * cardinality with the destination's, UML-style (e.g. "1..*"). Roots
 * carry neither — they are drawn as plain entity rows.
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
  /**
   * Relationship end-name reaching this node from its parent (undefined
   * for roots). Falls back to the relationship `description` when neither
   * `source.name` nor `target.name` is set on the underlying Relationship.
   */
  navName?: string;
  /**
   * Cardinality of the edge that reached this node, in UML order:
   * `from` is the cardinality at the side of the parent, `to` is the
   * cardinality at the side of this node. Undefined for roots.
   */
  navCardinality?: { from: Cardinality; to: Cardinality };
  /**
   * Slim attribute list for the entity — populated so the tree view can
   * expand an entity row without an extra API round-trip per click.
   */
  attributes?: ResolvedAttribute[];
  /**
   * Entity-level metadata entries — used by the perspective tree view to
   * render metadata-as-columns alongside entity rows (#93).
   */
  metadata?: MetadataEntry[];
}

/**
 * A perspective with its resolved entity graph
 */
export interface ResolvedPerspective extends Perspective {
  resolvedNodes: ResolvedNode[];
}

/**
 * Validation metadata for an attribute (#85).
 *
 * Describes how a value must look to be considered valid — JSON-Schema
 * style fields like length, pattern, format, enum, range. This is one of
 * three governance concepts in the model:
 *
 *   - **Validation** (this type) — intrinsic to the attribute, owned by
 *     the data steward, alongside `type` and `required`.
 *   - **Constraint** — physical, DB-enforced (unique, check, foreignKey)
 *     stored under `entity.metadata['physical.constraints']`.
 *   - **Rule** — functional / business invariants, stored as first-class
 *     `Rule` objects with severity, enforcement, and process stage.
 *
 * Replaces the legacy name `AttributeConstraints` — see #85.
 */
export interface AttributeValidation {
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
  /**
   * Validation metadata (#85). Renamed from `constraints`. See
   * `AttributeValidation` for the field set and the rationale for the
   * three-concept split (validation / constraint / rule).
   */
  validation?: AttributeValidation;

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
 * A single end of a relationship under the symmetric `ends[]` model (#99).
 *
 * Each end is identified by its entity and carries a `role` — the
 * navigation property name **at that entity** for reaching the other end.
 * This is symmetric by construction: going from A to B, use A's end's
 * role as the nav name (= A's field for reaching B).
 *
 * Example — `Order --items--> OrderItem` one-to-many:
 *   ends:
 *     - { entity: OrderUuid,     role: items, cardinality: one  }   // Order.items
 *     - { entity: OrderItemUuid, role: order, cardinality: many }   // OrderItem.order
 */
export interface RelationshipEndNamed {
  /** UUID of the entity at this end */
  entity: string;
  /**
   * Navigation property at **this entity** for reaching the opposite end.
   * Optional for unidirectional relationships (one side has no nav property).
   */
  role?: string;
  cardinality: Cardinality;
  referenceAttributes?: string[];
}

/**
 * A relationship between two entities, stored at package level.
 *
 * Supports two shapes for backward compatibility:
 *   - **New (preferred, #99)**: `ends: [end1, end2]` — symmetric, each end
 *     identifies itself by entity + role.
 *   - **Legacy**: `source` + `target` — asymmetric; retained as fallback
 *     until the migration (#100) converts all existing data.
 *
 * Resolvers prefer `ends[]` when present. Fallback uses source/target
 * with the corrected semantic: `source.name` is the name used when going
 * source→target (= source's field for reaching target).
 */
export type RelationshipType = 'structural' | 'lineage';

export interface Relationship {
  uuid: string;
  description?: string;
  type?: RelationshipType;
  /** Stereotype id (#94); stereotype must have appliesTo === 'relationship'. */
  stereotype?: string;
  /**
   * New symmetric shape (#99) — preferred by new resolvers. On read, this
   * is populated from source/target if the file only has the legacy shape
   * (so consumers can always use `ends[]`). Must contain exactly two ends.
   */
  ends?: RelationshipEndNamed[];
  source: RelationshipEnd;
  target: RelationshipEnd;
  metadata?: MetadataEntry[];
}

/**
 * Normalize a Relationship to the symmetric `ends[]` shape (#99).
 *
 * Always returns a pair of ends. If `ends[]` is present on the input,
 * it wins (the new canonical shape). Otherwise synthesizes from
 * source/target using the corrected semantic: `source.name` IS the role
 * at the source's end (i.e. source entity's field name for reaching
 * target).
 *
 * Callers use this helper to get a consistent two-end view regardless
 * of which shape the stored data uses.
 */
export function normalizeRelationshipEnds(rel: Relationship): [RelationshipEndNamed, RelationshipEndNamed] {
  if (rel.ends && rel.ends.length >= 2) {
    return [rel.ends[0], rel.ends[1]];
  }
  return [
    {
      entity: rel.source.entity,
      cardinality: rel.source.cardinality,
      role: rel.source.name,
      referenceAttributes: rel.source.referenceAttributes,
    },
    {
      entity: rel.target.entity,
      cardinality: rel.target.cardinality,
      role: rel.target.name,
      referenceAttributes: rel.target.referenceAttributes,
    },
  ];
}

export interface LineageNode {
  entityUuid: string;
  entityName: string;
  service: string;
  direction: 'upstream' | 'downstream';
  depth: number;
  relationship: { uuid: string; description: string };
}

export interface LineageResult {
  entity: { uuid: string; name: string; service: string };
  upstream: LineageNode[];
  downstream: LineageNode[];
}

/**
 * Kinds of physical (DB-enforced) constraint that the model captures (#85 R3).
 *
 *   - **unique**     — `UNIQUE (col, …)` — at most one row per column tuple
 *   - **check**      — `CHECK (expression)` — row-level boolean predicate
 *   - **foreignKey** — `FOREIGN KEY (cols) REFERENCES other(cols)` — referential integrity
 *   - **index**      — non-unique index — performance hint, no integrity guarantee
 */
/** SQL referential actions for FK ON DELETE / ON UPDATE clauses (#73). */
export type ReferentialAction = 'CASCADE' | 'SET NULL' | 'SET DEFAULT' | 'RESTRICT' | 'NO ACTION';

export type PhysicalConstraintKind = 'unique' | 'check' | 'foreignKey' | 'index';

/**
 * A physical constraint enforced by the database (#85 R3).
 *
 * Distinct from `attribute.validation` (intrinsic shape rules that the
 * application layer applies) and from the first-class `Rule` type
 * (functional / business invariants). Physical constraints come from
 * SQL DDL or live DB introspection and round-trip cleanly through the
 * schema import wizard.
 *
 * Field set varies by `kind`:
 *
 *   - `unique` / `index` → `columns` (required)
 *   - `check`            → `expression` (required)
 *   - `foreignKey`       → `columns` + `references` (both required)
 *
 * The optional `name` is the DB-side constraint identifier when known
 * (e.g. `uq_orders_number`, `chk_balance_positive`). Used as a stable
 * matching key by the schema diff when both sides expose it.
 */
export interface PhysicalConstraint {
  kind: PhysicalConstraintKind;
  /** Optional DB constraint name — used as a stable identity when both sides have one. */
  name?: string;
  /** Physical column names — required for unique / foreignKey / index. */
  columns?: string[];
  /** Boolean predicate text — required for check constraints. */
  expression?: string;
  /** Referenced table + columns — required for foreignKey. */
  references?: {
    table: string;
    columns: string[];
    /** Referential action on parent row delete (#73). */
    onDelete?: ReferentialAction;
    /** Referential action on parent PK update (#73). */
    onUpdate?: ReferentialAction;
  };
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
  /**
   * Physical, DB-enforced constraints (#85 R3). The word "constraint"
   * here is reserved for physical concerns — see PhysicalConstraint and
   * the AttributeValidation rationale for the three-concept split.
   */
  constraints?: PhysicalConstraint[];
  /**
   * Review comments for this entity (#106). Replaces the legacy
   * `{uuid}.comments.yaml` sidecar files that were eliminated in the
   * multi-kind YAML migration.
   */
  reviewComments?: ReviewComment[];
  /**
   * Entity-scoped rules attached directly to this entity (#106). Replaces
   * the legacy `{uuid}.rules.yaml` sidecar files. Rules listed here have
   * `scope: 'entity'` and `entityUuid` equal to this entity's uuid.
   */
  rules?: Rule[];
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
          validation: {
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
          properties: { type: ['array', 'object'] },
          metadata: { type: 'array' }
        }
      }
    },
    metadata: { type: 'array' },
    constraints: {
      type: 'array',
      items: {
        type: 'object',
        required: ['kind'],
        properties: {
          kind: { type: 'string', enum: ['unique', 'check', 'foreignKey', 'index'] },
          name: { type: 'string' },
          columns: { type: 'array', items: { type: 'string' } },
          expression: { type: 'string' },
          references: {
            type: 'object',
            required: ['table', 'columns'],
            properties: {
              table: { type: 'string' },
              columns: { type: 'array', items: { type: 'string' } },
            },
          },
        },
      },
    },
    reviewComments: { type: 'array' },
    rules: { type: 'array' },
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
