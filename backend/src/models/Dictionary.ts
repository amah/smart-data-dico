import { Entity, MetadataDefinition, MetadataEntry, Relationship } from './EntitySchema.js';

/**
 * Package type annotation
 */
export enum PackageType {
  PROJECT = 'project',
  MICROSERVICE = 'microservice',
  MODULE = 'module'
}

/**
 * Represents a hierarchical package, which can contain subpackages and/or entities.
 */
export interface Package {
  id: string;
  name: string;
  description?: string;
  type?: PackageType | string;
  entities: Entity[];
  subPackages: Package[];
  relationships: Relationship[];
  /** Cases owned by this package — slim shape (uuid + name + optional description) for sidebar tree (#121) and home-page chip row (#180). */
  cases?: { uuid: string; name: string; description?: string }[];
  metadata?: MetadataEntry[];
}

/**
 * Dictionary model interface.
 * Supports a hierarchy of packages via the rootPackage property.
 */
export interface Dictionary {
  id: string;
  name: string;
  description?: string;
  metadataDefinitions?: MetadataDefinition[];
  createdAt?: Date;
  updatedAt?: Date;
  rootPackage: Package;
}
