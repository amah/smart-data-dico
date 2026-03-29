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
  attributes: Attribute[];
  metadata?: MetadataEntry[];
  createdAt?: string;
  updatedAt?: string;
}

/**
 * Interface for search result
 */
export interface SearchResult {
  type: 'entity' | 'attribute' | 'relationship';
  entityName: string;
  service: string;
  name: string;
  description: string;
  path: string;
  matchContext?: string;
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
