import { Entity } from './EntitySchema.js';

/**
 * Represents a hierarchical package, which can contain subpackages and/or entities.
 * The 'type' annotation distinguishes the package type (e.g., project, microservice, module).
 */
export interface Package {
  id: string;
  name: string;
  description?: string;
  type?: string; // Annotation: project, microservice, module, etc.
  entities: Entity[];
  subPackages: Package[];
  metadata?: Record<string, any>;
}

/**
 * Dictionary model interface.
 * Now supports a hierarchy of packages via the rootPackage property.
 */
export interface Dictionary {
  id: string;
  name: string;
  description?: string;
  version?: string;
  createdAt?: Date;
  updatedAt?: Date;
  rootPackage: Package;
}

// Dictionary entry interface (legacy, may be used for flat APIs)
export interface DictionaryEntry {
  id: string;
  name: string;
  description: string;
  type: string;
  format?: string;
  required?: boolean;
  defaultValue?: any;
  examples?: string[];
  metadata?: Record<string, any>;
}