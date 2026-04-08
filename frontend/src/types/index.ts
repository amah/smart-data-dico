// Dictionary types
export interface Dictionary {
  id: string;
  name: string;
  description?: string;
  metadataDefinitions?: MetadataDefinition[];
  createdAt?: string;
  updatedAt?: string;
}

/**
 * Package type annotation
 */
export enum PackageType {
  PROJECT = 'project',
  MICROSERVICE = 'microservice',
  MODULE = 'module'
}

/**
 * Hierarchical package structure for nested packages and entities.
 */
export interface Package {
  id: string;
  name: string;
  description?: string;
  type?: PackageType | string;
  parentId?: string;
  subPackages?: Package[];
  entities?: Entity[];
  relationships?: Relationship[];
  metadata?: MetadataEntry[];
  createdAt?: string;
  updatedAt?: string;
}

// API response types
export interface ApiResponse<T> {
  message: string;
  data: T;
}

export interface ErrorResponse {
  message: string;
  error?: any;
}

// User types
export interface User {
  id: string;
  username: string;
  email: string;
  role: 'admin' | 'editor' | 'viewer';
}

// Form state types
export interface FormState {
  isSubmitting: boolean;
  isError: boolean;
  errorMessage: string;
}

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
   * Logical UUID type (#69). Renders as a distinct badge in the UI.
   * The physical mapping (e.g. Postgres `uuid`, Oracle `RAW(16)`)
   * is carried in attribute metadata under `physical.dbType`.
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
 * Metadata value types
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

// ────────────────────────────────────────────
// Validation rules (#74)
// ────────────────────────────────────────────

export type RuleScope = 'entity' | 'package' | 'perspective';
export type RuleSeverityValue = 'info' | 'warning' | 'error';
/** When a rule is checked. Decoupled from severity (#76). */
export type RuleEnforcement = 'save' | 'process' | 'advisory';
export type RuleTargetKind = 'attribute' | 'entity' | 'relationship' | 'perspective-node';

export interface RuleTarget {
  kind: RuleTargetKind;
  uuid: string;
  entityUuid?: string;
  perspectivePath?: string;
}

export interface RuleExpression {
  language: 'text' | 'jsonata' | 'jexl' | 'sql';
  body: string;
}

/** Free-form metadata entry on a rule (mirrors entity/attribute pattern). */
export interface RuleMetadataEntry {
  name: string;
  value: string | number | boolean;
}

export interface Rule {
  uuid: string;
  name: string;
  description: string;
  severity: RuleSeverityValue;
  /** When the rule is checked (#76) */
  enforcement: RuleEnforcement;
  scope: RuleScope;
  packageName?: string;
  entityUuid?: string;
  perspectiveUuid?: string;
  targets: RuleTarget[];
  expression?: RuleExpression;
  tags?: string[];
  /**
   * Free-form metadata. Used (among other things) for process-stage binding
   * when enforcement === 'process':
   *   metadata: [
   *     { name: 'process-stage-field', value: 'lifecycle-stage' },
   *     { name: 'process-stage-value', value: 'approved' },
   *   ]
   */
  metadata?: RuleMetadataEntry[];
  /** True for rules synthesized from attribute.constraints — read-only (#76) */
  synthetic?: boolean;
  /** For synthetic rules: which constraint field this came from */
  constraintField?: string;
  createdAt?: string;
  updatedAt?: string;
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

/**
 * Metadata definition (schema for metadata entries)
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

export interface PerspectiveNode {
  path: string;
  traverse?: boolean;
  exclude?: boolean;
  metadata?: MetadataEntry[];
}

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

export interface ResolvedPerspective extends Perspective {
  resolvedNodes: ResolvedNode[];
}

export interface Stereotype {
  id: string;
  name: string;
  description?: string;
  appliesTo: StereotypeTarget;
  metadataDefinitions: MetadataDefinition[];
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

// Backward-compatible alias
export type EntityAttribute = Attribute;

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
export type RelationshipType = 'structural' | 'lineage';

export interface Relationship {
  uuid: string;
  description?: string;
  type?: RelationshipType;
  source: RelationshipEnd;
  target: RelationshipEnd;
  metadata?: MetadataEntry[];
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

// ─── Schema Import Wizard (#69) ──────────────────────────────────────────

/** Diff status of an entity (table) returned by the schema import diff API. */
export type EntityDiffStatus = 'added' | 'changed' | 'unchanged' | 'removedInSource';

/** Diff status of an attribute (column) inside an EntityDiff. */
export type AttributeDiffStatus = 'added' | 'changed' | 'unchanged' | 'removedInSource' | 'modelOnly';

/** Per-attribute diff entry returned by /api/import/sql-ddl/diff. */
export interface AttributeDiff {
  status: AttributeDiffStatus;
  name: string;
  source?: Attribute;
  existing?: Attribute;
  changedFields?: string[];
}

/** Per-entity diff entry returned by /api/import/sql-ddl/diff. */
export interface EntityDiff {
  status: EntityDiffStatus;
  name: string;
  physicalTableName?: string;
  source?: Entity;
  existing?: Entity;
  attributes: AttributeDiff[];
  counts: {
    added: number;
    changed: number;
    unchanged: number;
    removedInSource: number;
    modelOnly: number;
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
  createdAt?: string;
  updatedAt?: string;
}

/**
 * Interface for search result
 */
export interface SearchResult {
  type: 'entity' | 'attribute' | 'metadata' | 'relationship' | 'package';
  entityName: string;
  attributeName?: string;
  service: string;
  name: string;
  description: string;
  path: string;
  score?: number;
  matchContext?: string;
}

export interface ImpactAnalysis {
  relationships: { uuid: string; description: string; service: string; sourceEntity: string; targetEntity: string }[];
  perspectives: { uuid: string; name: string; path: string }[];
  diagrams: { id: string; name: string }[];
}

/**
 * Interface for commit information
 */
export interface CommitInfo {
  hash: string;
  message: string;
  author: string;
  date: string;
  changes?: {
    added: string[];
    modified: string[];
    deleted: string[];
  };
}

/**
 * Interface for graph data visualization
 */
export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface GraphNode {
  id: string;
  label: string;
  type: 'entity';
  service: string;
  data?: Entity;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  label: string;
  sourceCardinality?: string;
  targetCardinality?: string;
}

/**
 * Interface for breadcrumb navigation
 */
export interface Breadcrumb {
  label: string;
  path: string;
}

/**
 * Interface for diagram layout storage
 */
export interface DiagramLayout {
  id: string;
  name: string;
  service?: string;
  entities: {
    [entityUuid: string]: {
      x: number;
      y: number;
      showProperties: boolean;
      name?: string; // Include name for readability
    };
  };
  zoom: number;
  pan: {
    x: number;
    y: number;
  };
  createdAt: string;
  updatedAt: string;
}
