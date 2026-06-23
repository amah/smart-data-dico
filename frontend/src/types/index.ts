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
  /** Cases owned by this package — slim shape for sidebar tree (#121) and home-page chip row (#180). */
  cases?: { uuid: string; name: string; description?: string }[];
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
  OBJECT = 'object',
  ARRAY = 'array',
  ENUM = 'enum',
}

/**
 * A metadata field value — scalar or nested (object/array).
 */
export type MetadataValue = string | number | boolean | { [k: string]: MetadataValue } | MetadataValue[];

export enum RuleSeverity {
  INFO = 'info',
  WARNING = 'warning',
  ERROR = 'error',
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
 * Metadata definition (schema for metadata entries)
 */
export interface MetadataDefinition {
  name: string;
  type: MetadataValueType;
  description?: string;
  required?: boolean;
  /** Child definitions for object-typed fields. */
  fields?: MetadataDefinition[];
  /** Item definition for array-typed fields. */
  items?: MetadataDefinition;
  /** Allowed values for enum-typed fields. */
  enum?: string[];
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
  /**
   * True when the inbound edge is a composition (owner→part) edge. Undefined
   * on roots. Non-composition neighbors are emitted as collapsed frontier
   * stubs (isFrontier=true, isExpandable=true) unless manually included.
   */
  isComposition?: boolean;
  /**
   * True when this node is a collapsed stub the user can manually expand into
   * the case ("Expand into case" → persists a CaseNode with traverse:true).
   */
  isExpandable?: boolean;
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
  /** Endpoint stereotype; `composition` marks this end as the owner/whole. */
  stereotype?: string;
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
  /** Endpoint stereotype; `composition` marks this end as the owner/whole. */
  stereotype?: string;
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
  /** Role / endpoint name at the source end (e.g. "items"). */
  sourceName?: string;
  /** Role / endpoint name at the target end (e.g. "order"). */
  targetName?: string;
  /**
   * Relationship metadata carried through to the diagram (#183). The
   * structural view ignores it; the logical (ORM) view reads `orm.*` keys
   * (fetch / cascade / orphanRemoval / owningEnd / mappedBy / joinTable) and
   * the physical view uses it to match relationships against FK constraints
   * for drift detection. Mirrors `Relationship.metadata`.
   */
  metadata?: MetadataEntry[];
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

// ─── Actions & State Machines (#179) ────────────────────────────────────────

/**
 * Flow step kinds for action bodies.
 * Stored as author-time modeling data — not executed in v1.
 */
export type FlowStepKind =
  | 'assign'
  | 'emitEvent'
  | 'invokeAction'
  | 'branch'
  | 'wait'
  | 'callExternal';

export const FLOW_STEP_KINDS: FlowStepKind[] = [
  'assign', 'emitEvent', 'invokeAction', 'branch', 'wait', 'callExternal',
];

/** assign — set an attribute/variable to a value */
export interface AssignStep   { kind: 'assign';       target: string; value: string; }
/** emitEvent — publish a domain event by name */
export interface EmitStep     { kind: 'emitEvent';    name: string; }
/** invokeAction — call another action by UUID */
export interface InvokeStep   { kind: 'invokeAction'; actionRef: string; }
/** branch — conditional fork */
export interface BranchStep   { kind: 'branch';       when: string; then: FlowStep[]; else?: FlowStep[]; }
/** wait — suspend until an event name or duration */
export interface WaitStep     { kind: 'wait';         for: string; }
/** callExternal — invoke an external system */
export interface CallExtStep  { kind: 'callExternal'; target: string; args?: Record<string, string>; }

/**
 * A single step in an action's flow body (modeling only).
 * Discriminated by `kind` so each variant carries only its own fields.
 */
export type FlowStep = AssignStep | EmitStep | InvokeStep | BranchStep | WaitStep | CallExtStep;

export interface ActionParam {
  name: string;
  type: string;
  required?: boolean;
  description?: string;
}

export interface ActionReturn {
  type: string;
  description?: string;
}

/**
 * An action owned by an entity. Modeling only — no execution in v1.
 */
export interface Action {
  uuid: string;
  name: string;
  description?: string;
  ownerRef: string;
  internal?: boolean;
  params?: ActionParam[];
  returns?: ActionReturn;
  flow?: FlowStep[];
  createdAt?: string;
  updatedAt?: string;
}

/**
 * A single state in a state machine.
 */
export interface SMState {
  name: string;
  description?: string;
  terminal?: boolean;
}

/**
 * A transition between states.
 * `from: "*"` means the transition applies from any non-terminal state.
 */
export interface Transition {
  uuid: string;
  from: string;
  to: string;
  on: string;
  guard?: string;
  invoke?: string[];  // action UUIDs
}

/**
 * A state machine owned by an entity. Modeling only — no execution in v1.
 */
export interface StateMachine {
  uuid: string;
  name: string;
  description?: string;
  ownerRef: string;
  stateAttribute?: string;
  initialState: string;
  states: SMState[];
  transitions: Transition[];
  createdAt?: string;
  updatedAt?: string;
}
