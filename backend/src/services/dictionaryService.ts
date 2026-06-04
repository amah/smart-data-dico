import path from 'path';
import YAML from 'yaml';

import { Dictionary, Package } from '../models/Dictionary.js';
import { Entity, Relationship } from '../models/EntitySchema.js';
import { listAllDictionaries, listMicroservices, loadPackage, readEntityFile, readRelationshipsFile, writeDictionaryMetadata } from '../utils/fileOperations.js';
import { logger } from '../utils/logger.js';
import { config } from '../kernel/config.js';
import { storageRegistry } from '../storage/contract/StorageBackendToken.js';
import type { IStorageBackend } from '../storage/contract/IStorageBackend.js';
import { wsId, pathOf, type WorkspaceId, type Path, type Stat } from '../storage/contract/types.js';

// Dynamic: reads current config.dataDir so project switching (#95) works.
// Kept only for the getEntityHierarchy bridge that passes an absolute fs path
// to readRelationshipsFile() (fileOperations.ts still on direct fs).
const getDataDir = () => config.dataDir;

/**
 * Dictionary Service
 * Provides functionality for managing data dictionaries
 */
export class DictionaryService {
  private _storage?: IStorageBackend;
  private get storage(): IStorageBackend {
    if (!this._storage) this._storage = storageRegistry.getBackend();
    return this._storage;
  }

  constructor(
    storage?: IStorageBackend,
    private readonly ws: WorkspaceId = wsId('dictionaries'),
  ) {
    this._storage = storage;
  }

  // ── Helpers ─────────────────────────────────────────────────────────

  /**
   * Returns Stat for the given workspace-relative path, or null if not found.
   * Duck-types the error code rather than using instanceof to remain
   * implementation-agnostic.
   */
  private async statOrNull(p: Path): Promise<Stat | null> {
    try {
      return await this.storage.stat(this.ws, p);
    } catch (e) {
      if ((e as { code?: string }).code === 'not-found') return null;
      throw e;
    }
  }

  /**
   * Build the workspace-relative Path for a package directory.
   * e.g. ('e-commerce', ['Customer']) → pathOf('e-commerce/Customer')
   */
  private packagePath(rootPackageName: string, pkgPath: string[]): Path {
    return pathOf([rootPackageName, ...pkgPath].filter(Boolean).join('/'));
  }

  /**
   * Build a child Path by appending path segments to a parent Path.
   */
  private childPath(parent: Path, ...segs: string[]): Path {
    return pathOf([String(parent), ...segs].filter(Boolean).join('/'));
  }

  /**
   * Create a new package (subpackage) at the given path.
   */
  private validatePackageName(name: string): string | null {
    if (!name) return 'Package name is required';
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) return 'Package name must be kebab-case (lowercase letters, numbers, hyphens)';
    return null;
  }

  public async createPackageAtPath(rootPackageName: string, packagePath: string[], packageData: Partial<Package>): Promise<{ success: boolean; errors?: string[]; package?: Package }> {
    try {
      // Validate package name
      const nameToValidate = packagePath.length > 0 ? packagePath[packagePath.length - 1] : rootPackageName;
      const nameError = this.validatePackageName(nameToValidate);
      if (nameError) return { success: false, errors: [nameError] };

      const baseDirPath = this.packagePath(rootPackageName, packagePath);
      const existing = await this.statOrNull(baseDirPath);
      if (existing !== null) {
        return { success: false, errors: ['Package directory already exists'] };
      }

      await this.storage.mkdir(this.ws, baseDirPath, true);

      // `package.yaml` is the #105 package marker that `listPackages()` uses
      // to distinguish a package folder from a plain subdirectory — see
      // fileOperations.ts. Writing `metadata.yaml` here (the pre-#105 name)
      // hid newly created sub-packages from the tree.
      const markerPath = this.childPath(baseDirPath, 'package.yaml');
      const markerContent = YAML.stringify({
        id: packageData.id || packagePath[packagePath.length - 1],
        name: packageData.name || packagePath[packagePath.length - 1],
        description: packageData.description,
        type: packageData.type,
        metadata: packageData.metadata || [],
      });
      await this.storage.write(this.ws, markerPath, markerContent, { createParents: true });

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
      const baseDirPath = this.packagePath(rootPackageName, packagePath);
      if (await this.statOrNull(baseDirPath) === null) {
        return { success: false, errors: ['Package directory does not exist'] };
      }

      // Read the #105 marker, falling back to the legacy name so existing
      // packages on disk still update cleanly.
      const markerPath = this.childPath(baseDirPath, 'package.yaml');
      const legacyPath = this.childPath(baseDirPath, 'metadata.yaml');

      const markerStat = await this.statOrNull(markerPath);
      const legacyStat = markerStat === null ? await this.statOrNull(legacyPath) : null;

      const readPath = markerStat !== null ? markerPath : legacyStat !== null ? legacyPath : null;
      if (!readPath) {
        return { success: false, errors: ['package.yaml does not exist'] };
      }

      const oldMeta = YAML.parse(await this.storage.read(this.ws, readPath)) || {};
      const newMeta = {
        ...oldMeta,
        ...packageData,
        id: packageData.id || oldMeta.id,
        name: packageData.name || oldMeta.name,
        description: packageData.description ?? oldMeta.description,
        type: packageData.type ?? oldMeta.type,
        metadata: packageData.metadata ?? oldMeta.metadata,
      };

      // Always write the canonical #105 marker. If we migrated from a
      // legacy metadata.yaml, delete it to avoid two-source-of-truth drift.
      await this.storage.write(this.ws, markerPath, YAML.stringify(newMeta), { createParents: true });
      if (readPath === legacyPath) {
        await this.storage.delete(this.ws, legacyPath);
      }

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
  public async deletePackageAtPath(rootPackageName: string, packagePath: string[], force = false): Promise<{ success: boolean; errors?: string[] }> {
    try {
      const baseDirPath = this.packagePath(rootPackageName, packagePath);
      if (await this.statOrNull(baseDirPath) === null) {
        return { success: false, errors: ['Package directory does not exist'] };
      }

      // Non-empty check unless force=true. Reserved filenames are the
      // post-#105 package marker (`package.yaml`) and the legacy
      // `metadata.yaml` (still present in some older packages).
      if (!force) {
        const entries = await this.storage.list(this.ws, baseDirPath);
        const hasEntities = entries.some(e =>
          !e.isDirectory &&
          e.name.endsWith('.yaml') &&
          e.name !== 'package.yaml' &&
          e.name !== 'metadata.yaml'
        );
        // DirectoryEntry.isDirectory covers subpackage detection — no second call needed
        const hasSubPackages = entries.some(e => e.isDirectory);
        if (hasEntities || hasSubPackages) {
          return { success: false, errors: ['Package is not empty. Delete its entities and sub-packages first, or use force=true.'] };
        }
      }

      // storage.delete() is recursive (verified: wm.deleteFile → fs.rm({recursive,force}))
      await this.storage.delete(this.ws, baseDirPath);
      return { success: true };
    } catch (error: any) {
      logger.error('Error deleting package at path', error);
      return { success: false, errors: [error.message || String(error)] };
    }
  }

  /**
   * Builds a Package hierarchy via `loadPackage` (#106 — content-driven
   * load that merges all `.yaml` sections regardless of filename).
   */
  private async buildPackageHierarchy(dirPath: Path, packageName: string): Promise<Package> {
    const dirStat = await this.statOrNull(dirPath);
    if (dirStat === null || !dirStat.isDirectory) {
      return {
        id: packageName,
        name: packageName,
        description: undefined,
        type: undefined,
        entities: [],
        subPackages: [],
        relationships: [],
        metadata: undefined,
      };
    }

    // #105 marker first, legacy `metadata.yaml` as fallback.
    let packageMeta: Partial<Package> = {};
    const markerPath = this.childPath(dirPath, 'package.yaml');
    const legacyMetaPath = this.childPath(dirPath, 'metadata.yaml');

    const markerStat = await this.statOrNull(markerPath);
    const legacyStat = markerStat === null ? await this.statOrNull(legacyMetaPath) : null;
    const readPath = markerStat !== null ? markerPath : legacyStat !== null ? legacyMetaPath : null;

    if (readPath) {
      try {
        packageMeta = YAML.parse(await this.storage.read(this.ws, readPath)) as Partial<Package>;
      } catch (e) {
        logger.warn(`Failed to parse package marker: ${readPath}: ${e}`);
      }
    }

    // Content-driven load — pulls entities / relationships / cases from every
    // `.yaml` in the package folder via the #106 sections format.
    let entities: Entity[] = [];
    let relationships: Relationship[] = [];
    let cases: { uuid: string; name: string; description?: string }[] = [];
    try {
      const model = await loadPackage(packageName);
      entities = model.entities;
      relationships = model.relationships;
      cases = model.cases.map(c => ({
        uuid: c.uuid,
        name: c.name,
        ...(c.description !== undefined ? { description: c.description } : {}),
      }));
    } catch (e) {
      logger.warn(`Failed to load package ${packageName}: ${e}`);
    }

    // Walk subdirectories for nested packages (still supported for nested layouts).
    // storage.list() returns DirectoryEntry[] with .isDirectory populated —
    // equivalent to readdir with withFileTypes: true, no second stat call needed.
    const subPackages: Package[] = [];
    const dirEntries = await this.storage.list(this.ws, dirPath);
    for (const entry of dirEntries) {
      if (entry.isDirectory) {
        const subpkg = await this.buildPackageHierarchy(this.childPath(dirPath, entry.name), entry.name);
        subPackages.push(subpkg);
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
      cases,
      metadata: packageMeta.metadata,
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

      // metadataPath is workspace-relative: "<id>/metadata.yaml"
      const metadataPath = pathOf(`${id}/metadata.yaml`);
      if (await this.statOrNull(metadataPath) === null) {
        return null;
      }

      const metadataContent = await this.storage.read(this.ws, metadataPath);
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
        const pkg = await loadPackage(microservice); // one load, not per-entity (O(n²))
        const entries: any[] = [];

        for (const entity of pkg.entities) {
          for (const attr of entity.attributes || []) {
            entries.push({
              id: `${entity.uuid || ''}_${attr.name}`,
              name: attr.name,
              description: attr.description || '',
              type: attr.type || 'string',
              format: attr.validation?.format,
              required: attr.required || false
            });
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
        format: attr.validation?.format,
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
      const dirPath = pathOf(rootPackage);
      if (await this.statOrNull(dirPath) === null) {
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
        // Load the whole package ONCE. The previous code called
        // listMicroserviceEntities() + readEntityFile() per entity, and each
        // of those re-runs loadPackage() (parsing every file in the package) —
        // O(n²) package loads, ~159s for 2000 entities on the git backend.
        const pkg = await loadPackage(microservice);

        for (const entity of pkg.entities) {
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

      // Bridge: getDataDir()+path.join hands an absolute fs path to
      // readRelationshipsFile(), which still reads directly from disk via
      // fileOperations.ts (not yet migrated to IStorageBackend).
      const packagePath = path.join(getDataDir(), microservice);
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
    // Single package load instead of a per-entity readEntityFile loop (O(n²)).
    const pkg = await loadPackage(service);
    return pkg.entities;
  }
}

export const dictionaryService = new DictionaryService();
