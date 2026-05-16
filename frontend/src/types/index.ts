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
  /** Cases owned by this package — slim shape for sidebar tree (#121). */
  cases?: { uuid: string; name: string }[];
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
 * Metadata value types.
 *
 * @deprecated The enum is retained for backwards compatibility with legacy
 * TypeScript consumers and as the seed for built-in registry registrations.
 * It is no longer authoritative — the MetadataTypeRegistry is. New code
 * should use free-form string keys on `MetadataDefinition.type`.
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
 * A recursive metadata value. Scalars are the common case; arrays and
 * nested objects enable structured metadata (PII classification, ownership,
 * lineage steps). YAML serialises this losslessly — no migration required.
 */
export type MetadataValue =
  | string
  | number
  | boolean
  | MetadataValue[]
  | { [key: string]: MetadataValue };

// ── MetadataTypeContributionCore mirror (backend parity — #164 Risk 1) ──────
// These interfaces are duplicated from backend/src/services/metadata/MetadataTypeRegistry.ts.
// A parity test in backend/src/services/metadata/__tests__/parity.test.ts
// asserts that the 9 built-in names are identical between tiers.

export interface JsonSchemaFragment {
  type?: string | string[];
  enum?: unknown[];
  format?: string;
  properties?: Record<string, JsonSchemaFragment>;
  items?: JsonSchemaFragment;
  required?: string[];
  description?: string;
  [k: string]: unknown;
}

export interface MetadataValidationError {
  path: string;
  message: string;
}

export interface MetadataValidationResult {
  ok: boolean;
  errors: MetadataValidationError[];
}

export interface MetadataTypeContributionCore<T extends MetadataValue = MetadataValue> {
  type: string;
  label: string;
  defaultValue: T;
  appliesTo?: Array<'package' | 'entity' | 'attribute' | 'model' | 'relationship'>;
  validate(value: unknown, def: MetadataDefinition): MetadataValidationResult;
  serialize(value: T): MetadataValue;
  parse(raw: unknown): T;
  toJsonSchema(def: MetadataDefinition): JsonSchemaFragment;
  toMarkdown(value: T, def?: MetadataDefinition): string;
}

// ────────────────────────────────────────────
// Validation rules (#74)
// ────────────────────────────────────────────

export type RuleScope = 'entity' | 'package' | 'case' | 'global';
export type RuleSeverityValue = 'info' | 'warning' | 'error';
/** When a rule is checked. Decoupled from severity (#76). */
export type RuleEnforcement = 'save' | 'process' | 'advisory';
export type RuleTargetKind = 'attribute' | 'entity' | 'relationship' | 'case-node';

export interface RuleTarget {
  kind: RuleTargetKind;
  uuid: string;
  entityUuid?: string;
  /** Package the target lives in — set on global (cross-package) rules (#75). */
  packageName?: string;
  casePath?: string;
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
  caseUuid?: string;
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

export type StereotypeTarget = 'package' | 'entity' | 'attribute' | 'model' | 'relationship';

/**
 * Metadata definition (schema for metadata entries).
 * `type` is a free-form contribution key validated against the registry.
 * Built-in keys: 'string' | 'number' | 'boolean' | 'date' | 'flag' | 'rule'
 *                | 'object' | 'array' | 'enum'
 */
export interface MetadataDefinition {
  name: string;
  /** Free-form contribution key. Was MetadataValueType enum — now open. */
  type: string;
  description?: string;
  required?: boolean;
  /** Field schemas for 'object' contributions. */
  fields?: MetadataDefinition[];
  /** Item schema for 'array' contributions. */
  items?: MetadataDefinition;
  /** Allowed values for 'enum' contributions. */
  enum?: Array<string | number | { value: string | number; label: string }>;
}

/**
 * A typed metadata entry
 */
export interface MetadataEntry {
  name: string;
  value: MetadataValue;
  severity?: RuleSeverity;
}

export interface CaseNode {
  path: string;
  traverse?: boolean;
  exclude?: boolean;
  metadata?: MetadataEntry[];
}

export interface Case {
  uuid: string;
  name: string;
  description?: string;
  rootEntities: string[];
  nodes?: CaseNode[];
  maxDepth?: number;
  metadata?: MetadataEntry[];
  createdAt?: string;
  updatedAt?: string;
}

/**
 * Slim attribute shape shipped on ResolvedNode — mirrors the backend's
 * ResolvedAttribute. Keeps only what the case tree view needs.
 */
export interface ResolvedAttribute {
  name: string;
  type: string;
  required: boolean;
  primaryKey?: boolean;
  metadata?: MetadataEntry[];
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
  /** End-name of the edge that reached this node (undefined on roots). */
  navName?: string;
  /** Cardinality of the inbound edge — `from` is the parent side. */
  navCardinality?: { from: Cardinality; to: Cardinality };
  /** Attributes for the entity, for the expand-to-attributes tree view. */
  attributes?: ResolvedAttribute[];
  /** Entity-level metadata for metadata-as-columns in the tree view (#93). */
  metadata?: MetadataEntry[];
}

export interface ResolvedCase extends Case {
  resolvedNodes: ResolvedNode[];
}

export interface Stereotype {
  id: string;
  name: string;
  description?: string;
  /** Free-form domain grouping (e.g. "DDD", "Database", "Privacy"). */
  domain?: string;
  appliesTo: StereotypeTarget;
  metadataDefinitions: MetadataDefinition[];
}

/**
 * Validation metadata for an attribute (#85).
 *
 * Renamed from `AttributeConstraints` to clear the word "constraint" for
 * physical, DB-enforced constraints (unique / check / foreignKey, stored
 * under `entity.metadata['physical.constraints']`). The fields here are
 * intrinsic to the attribute and describe how a value must look to be
 * considered valid — JSON-Schema-style metadata.
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
  /** Validation metadata (#85). Renamed from `constraints`. */
  validation?: AttributeValidation;

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
 * Symmetric end (#99). `role` = navigation property at THIS end's entity
 * for reaching the opposite end. Traversal uses the origin end's role.
 */
export interface RelationshipEndNamed {
  entity: string;
  role?: string;
  cardinality: Cardinality;
  referenceAttributes?: string[];
}

/**
 * A relationship between two entities, stored at package level.
 *
 * Dual-shape (#99): prefer `ends[]` (symmetric); falls back to
 * source/target for backward compat until migration (#100) completes.
 */
export type RelationshipType = 'structural' | 'lineage';

export interface Relationship {
  uuid: string;
  description?: string;
  type?: RelationshipType;
  /** Stereotype id (#94); stereotype must have appliesTo === 'relationship'. */
  stereotype?: string;
  /** Preferred symmetric shape (#99) — must contain exactly two ends. */
  ends?: RelationshipEndNamed[];
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
 * Kinds of physical (DB-enforced) constraint (#85 R3).
 *
 *   - unique     — UNIQUE (col, …)
 *   - check      — CHECK (expression)
 *   - foreignKey — FOREIGN KEY (cols) REFERENCES other(cols)
 *   - index      — non-unique index (performance, no integrity)
 */
export type PhysicalConstraintKind = 'unique' | 'check' | 'foreignKey' | 'index';

/**
 * A physical constraint enforced by the database (#85 R3). Distinct from
 * `attribute.validation` (intrinsic shape rules) and from the `Rule`
 * type (functional invariants).
 */
export interface PhysicalConstraint {
  kind: PhysicalConstraintKind;
  name?: string;
  columns?: string[];
  expression?: string;
  references?: { table: string; columns: string[] };
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
  /** Physical, DB-enforced constraints (#85 R3). */
  constraints?: PhysicalConstraint[];
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
  cases: { uuid: string; name: string; path: string }[];
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
