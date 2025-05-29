// Dictionary types
export interface Dictionary {
  id: string;
  name: string;
  description?: string;
  version?: string;
  createdAt?: string;
  updatedAt?: string;
}

// Dictionary entry types
export interface DictionaryEntry {
  id: string;
  name: string;
  description: string;
  type: string;
  format?: string;
  required?: boolean;
  defaultValue?: any;
  examples?: string[];
}

/**
 * Hierarchical package structure for nested packages and entities.
 */
export interface Package {
  id: string;
  name: string;
  description?: string;
  parentId?: string;
  subPackages?: Package[];
  entities?: Entity[];
  metadata?: Record<string, any>;
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
  ENUM = 'enum',
  OBJECT = 'object',
  ARRAY = 'array',
  REFERENCE = 'reference',
  RELATIONSHIP = 'relationship'
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
export interface Entity {
  uuid: string;
  id: string; // Keep for backward compatibility, but UUID is primary reference
  name: string;
  description: string;
  microservice: string;
  version: string;
  attributes: EntityAttribute[];
  relationships?: EntityRelationship[];
  metadata?: Record<string, any>;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * Interface for search result
 */
export interface SearchResult {
  type: 'entity' | 'attribute' | 'relationship';
  entityName: string;
  microservice: string;
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
  microservice: string;
  data?: Entity;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  label: string;
  type: RelationshipType;
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