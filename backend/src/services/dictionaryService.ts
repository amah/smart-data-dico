import fs from 'fs';
import path from 'path';
import YAML from 'yaml';

import { Dictionary, DictionaryEntry, Package } from '../models/Dictionary';
import { Entity } from '../models/EntitySchema';
import { ensureDirectoryStructure, listAllDictionaries, listAllEntities, listMicroserviceEntities, listMicroservices, readEntityFile, writeDictionaryMetadata } from '../utils/fileOperations';
import { logger } from '../utils/logger';
import { entityService } from './entityService';

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
      // Compute the directory path for the new package
      const baseDir = path.join(DATA_DICTIONARIES_DIR, 'microservices', rootPackageName, ...packagePath);
      if (!fs.existsSync(baseDir)) {
        fs.mkdirSync(baseDir, { recursive: true });
      } else {
        // If already exists, fail
        return { success: false, errors: ['Package directory already exists'] };
      }
      // Write metadata.yaml
      const metaPath = path.join(baseDir, 'metadata.yaml');
      const metaContent = YAML.stringify({
        id: packageData.id || packagePath[packagePath.length - 1],
        name: packageData.name || packagePath[packagePath.length - 1],
        description: packageData.description,
        type: packageData.type,
        metadata: packageData.metadata || {}
      });
      fs.writeFileSync(metaPath, metaContent, 'utf8');
      // Return the created package
      return {
        success: true,
        package: {
          id: packageData.id || packagePath[packagePath.length - 1],
          name: packageData.name || packagePath[packagePath.length - 1],
          description: packageData.description,
          type: packageData.type,
          entities: [],
          subPackages: [],
          metadata: packageData.metadata || {}
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
      // Read existing metadata
      const oldMeta = YAML.parse(fs.readFileSync(metaPath, 'utf8')) || {};
      // Merge updates
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
      // Recursively delete the directory
      fs.rmSync(baseDir, { recursive: true, force: true });
      return { success: true };
    } catch (error: any) {
      logger.error('Error deleting package at path', error);
      return { success: false, errors: [error.message || String(error)] };
    }
  }

  /**
   * Recursively builds a Package hierarchy from a directory.
   * @param dirPath Directory path for the package
   * @param packageName Name of the package (directory name)
   * @returns Promise<Package>
   */
  private async buildPackageHierarchy(dirPath: string, packageName: string): Promise<Package> {
    // If directory does not exist, return an empty package
    if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
      return {
        id: packageName,
        name: packageName,
        description: undefined,
        type: undefined,
        entities: [],
        subPackages: [],
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

    // List all files and subdirectories
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    const entities: Entity[] = [];
    const subPackages: Package[] = [];

    for (const entry of entries) {
      const entryPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        // Recursively build subpackage
        const subpkg = await this.buildPackageHierarchy(entryPath, entry.name);
        subPackages.push(subpkg);
      } else if (
        entry.isFile() &&
        entry.name.endsWith('.yaml') &&
        entry.name !== 'metadata.yaml'
      ) {
        // Load entity YAML
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
      // For microservices, create a dictionary object on the fly
      if (id.includes('microservices')) {
        // Create an empty package structure
        const rootPackage: Package = {
          id: id,
          name: id.split('/').pop() || id,
          description: `Microservice: ${id}`,
          entities: [],
          subPackages: []
        };
        
        return {
          id,
          name: id.split('/').pop() || id,
          description: `Microservice: ${id}`,
          version: '1.0.0',
          createdAt: new Date(),
          updatedAt: new Date(),
          rootPackage
        };
      }
      
      // For standalone dictionaries, read metadata.yaml
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

  public async getDictionaryEntries(id: string): Promise<DictionaryEntry[]> {
    try {
      // For microservices, get all entities and convert to dictionary entries
      if (id.startsWith('microservices/')) {
        const microservice = id.replace('microservices/', '');
        const entityNames = await listMicroserviceEntities(microservice);
        const entries: DictionaryEntry[] = [];
        
        for (const entityName of entityNames) {
          const entity = await readEntityFile(microservice, entityName);
          if (entity) {
            // Convert entity to dictionary entries (one per attribute)
            for (const attr of entity.attributes || []) {
              entries.push({
                id: `${entity.uuid || ''}_${attr.name}`,
                name: attr.name,
                description: attr.description || '',
                type: attr.type || 'string',
                format: attr.format,
                required: attr.required || false
              });
            }
          }
        }
        
        return entries;
      }
      
      // For standalone dictionaries, implement as needed
      return [];
    } catch (error) {
      logger.error(`Error getting dictionary entries: ${id}`, error);
      return [];
    }
  }

  public async getEntityAttributes(microservice: string, entityName: string): Promise<DictionaryEntry[]> {
    try {
      const entity = await readEntityFile(microservice, entityName);
      
      if (!entity || !entity.attributes) {
        return [];
      }
      
      // Convert entity attributes to dictionary entries
      return entity.attributes.map((attr: any) => ({
        id: `${entity.uuid || ''}_${attr.name}`,
        name: attr.name,
        description: attr.description || '',
        type: attr.type || 'string',
        format: attr.format,
        required: attr.required || false
      }));
    } catch (error) {
      logger.error(`Error getting entity attributes: ${microservice}.${entityName}`, error);
      return [];
    }
  }

  public async createDictionary(dictionaryData: Dictionary): Promise<Dictionary | { error: string; code: string }> {
    try {
      // Validate dictionary data
      if (!dictionaryData.name) {
        return { error: 'Dictionary name is required', code: 'MISSING_NAME' };
      }
      
      // Generate ID from name if not provided
      if (!dictionaryData.id) {
        dictionaryData.id = dictionaryData.name.toLowerCase().replace(/\s+/g, '-');
      }
      
      // Check if dictionary with this ID already exists
      const existingDictionaries = await listAllDictionaries();
      if (existingDictionaries.includes(dictionaryData.id)) {
        return { error: `Dictionary with ID ${dictionaryData.id} already exists`, code: 'DUPLICATE_NAME' };
      }
      
      // Set timestamps
      dictionaryData.createdAt = new Date();
      dictionaryData.updatedAt = new Date();
      
      // Write dictionary metadata
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
      
      // Flatten the hierarchy into a tabular format
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
    
    // Add package
    result.push({
      type: 'package',
      id: pkg.id,
      name: pkg.name,
      description: pkg.description,
      path: currentPath,
      level: parentPath.split('/').length
    });
    
    // Add entities
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
    
    // Recursively add subpackages
    for (const subpkg of pkg.subPackages || []) {
      this.flattenHierarchy(subpkg, result, currentPath);
    }
  }

  public async getPackageByPath(rootPackage: string, packagePath: string[]): Promise<Package | null> {
    try {
      // Get the root package hierarchy
      const rootHierarchy = await this.getPackageHierarchy(rootPackage);
      if (!rootHierarchy) {
        return null;
      }
      
      // If no path is provided, return the root package
      if (!packagePath.length) {
        return rootHierarchy;
      }
      
      // Navigate through the path to find the target package
      let currentPackage = rootHierarchy;
      
      for (const segment of packagePath) {
        const subPackage = currentPackage.subPackages?.find(p => p.name === segment);
        
        if (!subPackage) {
          return null; // Path segment not found
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
          
          // Filter by name if specified
          if (filters.name && !entity.name.toLowerCase().includes(filters.name.toLowerCase())) {
            continue;
          }
          
          // Filter by package if specified
          if (filters.package && entity.packageId !== filters.package) {
            continue;
          }
          
          // Add entity
          result.push({
            type: 'entity',
            id: entity.uuid,
            name: entity.name,
            description: entity.description,
            microservice: entity.microservice,
            package: entity.packageId
          });
          
          // Add attributes
          for (const attr of entity.attributes || []) {
            // Filter by type if specified
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
              entity: entity.name,
              microservice: entity.microservice,
              package: entity.packageId
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
      
      // Build hierarchy object
      const hierarchy: any = {
        id: entity.uuid,
        name: entity.name,
        description: entity.description,
        type: 'entity',
        microservice: entity.microservice,
        attributes: entity.attributes || [],
        children: [] as any[]
      };
      
      // Add related entities as children
      if (entity.relationships) {
        const children: any[] = [];
        for (const rel of entity.relationships) {
          const [relMicroservice, relEntityName] = rel.target.split('.');
          const relatedEntity = await readEntityFile(relMicroservice, relEntityName);
          
          if (relatedEntity) {
            children.push({
              id: relatedEntity.uuid,
              name: relatedEntity.name,
              description: relatedEntity.description,
              type: 'entity',
              microservice: relatedEntity.microservice,
              relationshipType: rel.type,
              relationshipName: rel.name
            });
          }
        }
        hierarchy.children = children;
      }
      
      return hierarchy;
    } catch (error) {
      logger.error(`Error getting entity hierarchy: ${microservice}.${entityName}`, error);
      return null;
    }
  }

// ... rest of the class unchanged ...
}
export const dictionaryService = new DictionaryService();