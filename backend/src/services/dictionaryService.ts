import fs from 'fs';
import path from 'path';
import YAML from 'yaml';

import { Dictionary, Package } from '../models/Dictionary.js';
import { Entity, Relationship } from '../models/EntitySchema.js';
import { ensureDirectoryStructure, listAllDictionaries, listAllEntities, listMicroserviceEntities, listMicroservices, readEntityFile, readRelationshipsFile, writeDictionaryMetadata } from '../utils/fileOperations.js';
import { logger } from '../utils/logger.js';

// Base directory for data dictionaries - use the same path as in fileOperations.ts
const DATA_DICTIONARIES_DIR = path.join(process.cwd(), '..', 'data-dictionaries');

/**
 * Dictionary Service
 * Provides functionality for managing data dictionaries
 */
export class DictionaryService {

  /**
   * Create a new package (subpackage) at the given path.
   */
  public async createPackageAtPath(rootPackageName: string, packagePath: string[], packageData: Partial<Package>): Promise<{ success: boolean; errors?: string[]; package?: Package }> {
    try {
      const baseDir = path.join(DATA_DICTIONARIES_DIR, 'microservices', rootPackageName, ...packagePath);
      if (!fs.existsSync(baseDir)) {
        fs.mkdirSync(baseDir, { recursive: true });
      } else {
        return { success: false, errors: ['Package directory already exists'] };
      }
      const metaPath = path.join(baseDir, 'metadata.yaml');
      const metaContent = YAML.stringify({
        id: packageData.id || packagePath[packagePath.length - 1],
        name: packageData.name || packagePath[packagePath.length - 1],
        description: packageData.description,
        type: packageData.type,
        metadata: packageData.metadata || []
      });
      fs.writeFileSync(metaPath, metaContent, 'utf8');
      return {
        success: true,
        package: {
          id: packageData.id || packagePath[packagePath.length - 1],
          name: packageData.name || packagePath[packagePath.length - 1],
          description: packageData.description,
          type: packageData.type,
          entities: [],
          subPackages: [],
          relationships: [],
          metadata: packageData.metadata || []
        }
      };
    } catch (error: any) {
      logger.error('Error creating package at path', error);
      return { success: false, errors: [error.message || String(error)] };
    }
  }

  /**
   * Update a package's metadata at the given path.
   */
  public async updatePackageAtPath(rootPackageName: string, packagePath: string[], packageData: Partial<Package>): Promise<{ success: boolean; errors?: string[]; package?: Package }> {
    try {
      const baseDir = path.join(DATA_DICTIONARIES_DIR, 'microservices', rootPackageName, ...packagePath);
      if (!fs.existsSync(baseDir)) {
        return { success: false, errors: ['Package directory does not exist'] };
      }
      const metaPath = path.join(baseDir, 'metadata.yaml');
      if (!fs.existsSync(metaPath)) {
        return { success: false, errors: ['metadata.yaml does not exist'] };
      }
      const oldMeta = YAML.parse(fs.readFileSync(metaPath, 'utf8')) || {};
      const newMeta = {
        ...oldMeta,
        ...packageData,
        id: packageData.id || oldMeta.id,
        name: packageData.name || oldMeta.name,
        description: packageData.description ?? oldMeta.description,
        type: packageData.type ?? oldMeta.type,
        metadata: packageData.metadata ?? oldMeta.metadata
      };
      fs.writeFileSync(metaPath, YAML.stringify(newMeta), 'utf8');
      return {
        success: true,
        package: {
          id: newMeta.id,
          name: newMeta.name,
          description: newMeta.description,
          type: newMeta.type,
          entities: [],
          subPackages: [],
          relationships: [],
          metadata: newMeta.metadata
        }
      };
    } catch (error: any) {
      logger.error('Error updating package at path', error);
      return { success: false, errors: [error.message || String(error)] };
    }
  }

  /**
   * Delete a package (and all its contents) at the given path.
   */
  public async deletePackageAtPath(rootPackageName: string, packagePath: string[]): Promise<{ success: boolean; errors?: string[] }> {
    try {
      const baseDir = path.join(DATA_DICTIONARIES_DIR, 'microservices', rootPackageName, ...packagePath);
      if (!fs.existsSync(baseDir)) {
        return { success: false, errors: ['Package directory does not exist'] };
      }
      fs.rmSync(baseDir, { recursive: true, force: true });
      return { success: true };
    } catch (error: any) {
      logger.error('Error deleting package at path', error);
      return { success: false, errors: [error.message || String(error)] };
    }
  }

  /**
   * Recursively builds a Package hierarchy from a directory.
   * Now also reads relationships.yaml at each package level.
   */
  private async buildPackageHierarchy(dirPath: string, packageName: string): Promise<Package> {
    if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
      return {
        id: packageName,
        name: packageName,
        description: undefined,
        type: undefined,
        entities: [],
        subPackages: [],
        relationships: [],
        metadata: undefined
      };
    }

    // Read package metadata if present
    let packageMeta: Partial<Package> = {};
    const metaPath = path.join(dirPath, 'metadata.yaml');
    if (fs.existsSync(metaPath)) {
      const metaContent = fs.readFileSync(metaPath, 'utf8');
      packageMeta = YAML.parse(metaContent) as Partial<Package>;
    }

    // Read relationships from package-level file
    const relationships = await readRelationshipsFile(dirPath);

    // List all files and subdirectories
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    const entities: Entity[] = [];
    const subPackages: Package[] = [];

    for (const entry of entries) {
      const entryPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        const subpkg = await this.buildPackageHierarchy(entryPath, entry.name);
        subPackages.push(subpkg);
      } else if (
        entry.isFile() &&
        entry.name.endsWith('.yaml') &&
        entry.name !== 'metadata.yaml' &&
        entry.name !== 'relationships.yaml'
      ) {
        try {
          const fileContent = fs.readFileSync(entryPath, 'utf8');
          const entity = YAML.parse(fileContent) as Entity;
          entities.push(entity);
        } catch (e) {
          logger.warn(`Failed to parse entity YAML: ${entryPath}: ${e}`);
        }
      }
    }

    return {
      id: packageMeta.id || packageName,
      name: packageMeta.name || packageName,
      description: packageMeta.description,
      type: packageMeta.type,
      entities,
      subPackages,
      relationships,
      metadata: packageMeta.metadata
    };
  }

  // --- IMPLEMENTED METHODS ---

  public async getAllDictionaries(): Promise<Dictionary[]> {
    try {
      const dictionaryIds = await listAllDictionaries();
      const dictionaries: Dictionary[] = [];

      for (const id of dictionaryIds) {
        const dictionary = await this.getDictionaryById(id);
        if (dictionary) {
          dictionaries.push(dictionary);
        }
      }

      return dictionaries;
    } catch (error) {
      logger.error('Error getting all dictionaries', error);
      return [];
    }
  }

  public async getDictionaryById(id: string): Promise<Dictionary | null> {
    try {
      if (id.includes('microservices')) {
        const rootPackage: Package = {
          id: id,
          name: id.split('/').pop() || id,
          description: `Microservice: ${id}`,
          entities: [],
          subPackages: [],
          relationships: []
        };

        return {
          id,
          name: id.split('/').pop() || id,
          description: `Microservice: ${id}`,
          createdAt: new Date(),
          updatedAt: new Date(),
          rootPackage
        };
      }

      const metadataPath = path.join(DATA_DICTIONARIES_DIR, id, 'metadata.yaml');

      if (!fs.existsSync(metadataPath)) {
        return null;
      }

      const metadataContent = fs.readFileSync(metadataPath, 'utf8');
      const metadata = YAML.parse(metadataContent) as Dictionary;

      return metadata;
    } catch (error) {
      logger.error(`Error getting dictionary by ID: ${id}`, error);
      return null;
    }
  }

  public async getDictionaryEntries(id: string): Promise<any[]> {
    try {
      if (id.startsWith('microservices/')) {
        const microservice = id.replace('microservices/', '');
        const entityNames = await listMicroserviceEntities(microservice);
        const entries: any[] = [];

        for (const entityName of entityNames) {
          const entity = await readEntityFile(microservice, entityName);
          if (entity) {
            for (const attr of entity.attributes || []) {
              entries.push({
                id: `${entity.uuid || ''}_${attr.name}`,
                name: attr.name,
                description: attr.description || '',
                type: attr.type || 'string',
                format: attr.constraints?.format,
                required: attr.required || false
              });
            }
          }
        }

        return entries;
      }

      return [];
    } catch (error) {
      logger.error(`Error getting dictionary entries: ${id}`, error);
      return [];
    }
  }

  public async getEntityAttributes(microservice: string, entityName: string): Promise<any[]> {
    try {
      const entity = await readEntityFile(microservice, entityName);

      if (!entity || !entity.attributes) {
        return [];
      }

      return entity.attributes.map((attr: any) => ({
        id: `${entity.uuid || ''}_${attr.name}`,
        name: attr.name,
        description: attr.description || '',
        type: attr.type || 'string',
        format: attr.constraints?.format,
        required: attr.required || false
      }));
    } catch (error) {
      logger.error(`Error getting entity attributes: ${microservice}.${entityName}`, error);
      return [];
    }
  }

  public async createDictionary(dictionaryData: Dictionary): Promise<Dictionary | { error: string; code: string }> {
    try {
      if (!dictionaryData.name) {
        return { error: 'Dictionary name is required', code: 'MISSING_NAME' };
      }

      if (!dictionaryData.id) {
        dictionaryData.id = dictionaryData.name.toLowerCase().replace(/\s+/g, '-');
      }

      const existingDictionaries = await listAllDictionaries();
      if (existingDictionaries.includes(dictionaryData.id)) {
        return { error: `Dictionary with ID ${dictionaryData.id} already exists`, code: 'DUPLICATE_NAME' };
      }

      dictionaryData.createdAt = new Date();
      dictionaryData.updatedAt = new Date();

      const success = await writeDictionaryMetadata(dictionaryData);

      if (!success) {
        return { error: 'Failed to write dictionary metadata', code: 'WRITE_ERROR' };
      }

      return dictionaryData;
    } catch (error) {
      logger.error('Error creating dictionary', error);
      return { error: 'Internal server error', code: 'INTERNAL_ERROR' };
    }
  }

  public async getPackageHierarchy(rootPackage: string): Promise<Package | null> {
    try {
      const dirPath = path.join(DATA_DICTIONARIES_DIR, 'microservices', rootPackage);
      if (!fs.existsSync(dirPath)) {
        return null;
      }
      return await this.buildPackageHierarchy(dirPath, rootPackage);
    } catch (error) {
      logger.error('Error in getPackageHierarchy', error);
      return null;
    }
  }

  public async getTabularData(rootPackage: string): Promise<any[]> {
    try {
      const hierarchy = await this.getPackageHierarchy(rootPackage);
      if (!hierarchy) {
        return [];
      }

      const result: any[] = [];
      this.flattenHierarchy(hierarchy, result, '');

      return result;
    } catch (error) {
      logger.error(`Error getting tabular data: ${rootPackage}`, error);
      return [];
    }
  }

  private flattenHierarchy(pkg: Package, result: any[], parentPath: string): void {
    const currentPath = parentPath ? `${parentPath}/${pkg.name}` : pkg.name;

    result.push({
      type: 'package',
      id: pkg.id,
      name: pkg.name,
      description: pkg.description,
      path: currentPath,
      level: parentPath.split('/').length
    });

    for (const entity of pkg.entities || []) {
      result.push({
        type: 'entity',
        id: entity.uuid,
        name: entity.name,
        description: entity.description,
        path: `${currentPath}/${entity.name}`,
        level: parentPath.split('/').length + 1
      });
    }

    for (const subpkg of pkg.subPackages || []) {
      this.flattenHierarchy(subpkg, result, currentPath);
    }
  }

  public async getPackageByPath(rootPackage: string, packagePath: string[]): Promise<Package | null> {
    try {
      const rootHierarchy = await this.getPackageHierarchy(rootPackage);
      if (!rootHierarchy) {
        return null;
      }

      if (!packagePath.length) {
        return rootHierarchy;
      }

      let currentPackage = rootHierarchy;

      for (const segment of packagePath) {
        const subPackage = currentPackage.subPackages?.find(p => p.name === segment);

        if (!subPackage) {
          return null;
        }

        currentPackage = subPackage;
      }

      return currentPackage;
    } catch (error) {
      logger.error(`Error getting package by path: ${rootPackage}/${packagePath.join('/')}`, error);
      return null;
    }
  }

  public async listAllPackagesAndEntities(): Promise<Package[]> {
    try {
      const microservices = await listMicroservices();
      const result: Package[] = [];
      for (const ms of microservices) {
        const pkg = await this.getPackageHierarchy(ms);
        if (pkg) {
          result.push(pkg);
        }
      }
      return result;
    } catch (error) {
      logger.error('Error in listAllPackagesAndEntities', error);
      return [];
    }
  }

  public async getFlatEntitiesAndAttributes(filters: any): Promise<any[]> {
    try {
      const microservices = await listMicroservices();
      const result: any[] = [];

      for (const microservice of microservices) {
        const entityNames = await listMicroserviceEntities(microservice);

        for (const entityName of entityNames) {
          const entity = await readEntityFile(microservice, entityName);

          if (!entity) continue;

          if (filters.name && !entity.name.toLowerCase().includes(filters.name.toLowerCase())) {
            continue;
          }

          result.push({
            type: 'entity',
            id: entity.uuid,
            name: entity.name,
            description: entity.description,
            package: microservice
          });

          for (const attr of entity.attributes || []) {
            if (filters.type && attr.type !== filters.type) {
              continue;
            }

            result.push({
              type: 'attribute',
              id: `${entity.uuid}_${attr.name}`,
              name: attr.name,
              description: attr.description,
              dataType: attr.type,
              required: attr.required,
              primaryKey: attr.primaryKey,
              entity: entity.name,
              package: microservice
            });
          }
        }
      }

      return result;
    } catch (error) {
      logger.error('Error getting flat entities and attributes', error);
      return [];
    }
  }

  public async getEntityHierarchy(microservice: string, entityName: string): Promise<any> {
    try {
      const entity = await readEntityFile(microservice, entityName);

      if (!entity) {
        return null;
      }

      const hierarchy: any = {
        id: entity.uuid,
        name: entity.name,
        description: entity.description,
        type: 'entity',
        package: microservice,
        attributes: entity.attributes || [],
        children: [] as any[]
      };

      // Read relationships from package-level file
      const packagePath = path.join(DATA_DICTIONARIES_DIR, 'microservices', microservice);
      const relationships = await readRelationshipsFile(packagePath);

      const children: any[] = [];
      for (const rel of relationships) {
        let targetUuid: string | null = null;
        let relLabel: string = '';

        if (rel.source.entity === entity.uuid) {
          targetUuid = rel.target.entity;
          relLabel = rel.target.name || '';
        } else if (rel.target.entity === entity.uuid) {
          targetUuid = rel.source.entity;
          relLabel = rel.source.name || '';
        }

        if (targetUuid) {
          // Find the target entity
          const entities = await this.getServiceEntities(microservice);
          const relatedEntity = entities.find(e => e.uuid === targetUuid);

          if (relatedEntity) {
            children.push({
              id: relatedEntity.uuid,
              name: relatedEntity.name,
              description: relatedEntity.description,
              type: 'entity',
              package: microservice,
              sourceCardinality: rel.source.entity === entity.uuid ? rel.source.cardinality : rel.target.cardinality,
              targetCardinality: rel.source.entity === entity.uuid ? rel.target.cardinality : rel.source.cardinality,
              relationshipName: relLabel
            });
          }
        }
      }
      hierarchy.children = children;

      return hierarchy;
    } catch (error) {
      logger.error(`Error getting entity hierarchy: ${microservice}.${entityName}`, error);
      return null;
    }
  }

  private async getServiceEntities(service: string): Promise<Entity[]> {
    const entityNames = await listMicroserviceEntities(service);
    const entities: Entity[] = [];
    for (const name of entityNames) {
      const entity = await readEntityFile(service, name);
      if (entity) entities.push(entity);
    }
    return entities;
  }
}
export const dictionaryService = new DictionaryService();
