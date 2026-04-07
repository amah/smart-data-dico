import fs from 'fs';
import path from 'path';
import YAML from 'yaml';
import { logger } from './logger.js';
import { Entity, Relationship, Perspective, ReviewComment, validateEntity } from '../models/EntitySchema.js';
import { Rule } from '../models/Rule.js';
import { Dictionary } from '../models/Dictionary.js';
import { generateEntityFilename, extractUUIDFromFilename } from './uuid.js';
import { config } from '../kernel/config.js';

// Base directory for data dictionaries
const DATA_DICTIONARIES_DIR = config.dataDir;

/**
 * Predicate: is a file in a package directory an entity YAML?
 *
 * Excludes structural / sidecar files that share the .yaml extension:
 *   - metadata.yaml      (package metadata)
 *   - relationships.yaml (package relationships)
 *   - rules.yaml         (package-scoped rules — #74)
 *   - *.comments.yaml    (entity review comments)
 *   - *.rules.yaml       (entity-sidecar rules — #74)
 */
function isEntityFile(file: string): boolean {
  if (!file.endsWith('.yaml') && !file.endsWith('.yml')) return false;
  if (file === 'metadata.yaml') return false;
  if (file === 'relationships.yaml') return false;
  if (file === 'rules.yaml') return false;
  if (file.endsWith('.comments.yaml')) return false;
  if (file.endsWith('.rules.yaml')) return false;
  return true;
}

// Lazy-loaded git service from @hamak/ui-remote-git-fs-backend
let gitServiceInstance: any = null;

async function getGitService() {
  if (gitServiceInstance) return gitServiceInstance;
  try {
    const gitModule = await import('@hamak/ui-remote-git-fs-backend');
    const workspaceRoots = new Map<string, string>([
      ['dictionaries', DATA_DICTIONARIES_DIR],
    ]);
    gitServiceInstance = gitModule.createGitService(workspaceRoots);
    return gitServiceInstance;
  } catch {
    logger.warn('Git service not available');
    return null;
  }
}

/**
 * Ensures the data dictionaries directory structure exists
 */
export async function ensureDirectoryStructure(): Promise<void> {
  const baseDir = DATA_DICTIONARIES_DIR;
  const microservicesDir = path.join(baseDir, 'microservices');

  if (!fs.existsSync(baseDir)) {
    fs.mkdirSync(baseDir, { recursive: true });
    logger.info(`Created base directory: ${baseDir}`);
  }

  if (!fs.existsSync(microservicesDir)) {
    fs.mkdirSync(microservicesDir, { recursive: true });
    logger.info(`Created microservices directory: ${microservicesDir}`);
  }

  const perspectivesDir = path.join(baseDir, 'perspectives');
  if (!fs.existsSync(perspectivesDir)) {
    fs.mkdirSync(perspectivesDir, { recursive: true });
    logger.info(`Created perspectives directory: ${perspectivesDir}`);
  }
}

/**
 * Reads an entity from a YAML file
 * @param packageName Package (service) name
 * @param entityName Entity name
 */
export async function readEntityFile(packageName: string, entityName: string): Promise<Entity | null> {
  const startTime = process.hrtime();
  try {
    const packagePath = path.join(DATA_DICTIONARIES_DIR, 'microservices', packageName);

    if (!fs.existsSync(packagePath)) {
      logger.warn(`Package directory not found: ${packagePath}`);
      return null;
    }

    // Try to find file by name (could be UUID-based or legacy name-based)
    const files = fs.readdirSync(packagePath)
      .filter(file => file.endsWith('.yaml') || file.endsWith('.yml'));

    let filePath: string | null = null;

    // First try legacy naming convention
    const legacyPath = path.join(packagePath, `${entityName}.yaml`);
    if (fs.existsSync(legacyPath)) {
      filePath = legacyPath;
    } else {
      // Try to find by UUID-based filename that contains the entity name
      for (const file of files) {
        if (file === 'metadata.yaml' || file === 'relationships.yaml') continue;
        const fullPath = path.join(packagePath, file);
        try {
          const content = fs.readFileSync(fullPath, 'utf8');
          const entity = YAML.parse(content) as Entity;
          if (entity.name === entityName) {
            filePath = fullPath;
            break;
          }
        } catch (error) {
          continue;
        }
      }
    }

    if (!filePath) {
      logger.warn(`Entity file not found: ${packageName}.${entityName}`);
      return null;
    }

    const readStartTime = process.hrtime();
    const fileContent = fs.readFileSync(filePath, 'utf8');
    const readEndTime = process.hrtime(readStartTime);
    const readTimeMs = Number((readEndTime[0] * 1e3 + readEndTime[1] / 1e6).toFixed(2));

    const parseStartTime = process.hrtime();
    const entity = YAML.parse(fileContent) as Entity;
    const parseEndTime = process.hrtime(parseStartTime);
    const parseTimeMs = Number((parseEndTime[0] * 1e3 + parseEndTime[1] / 1e6).toFixed(2));

    const endTime = process.hrtime(startTime);
    const totalTimeMs = Number((endTime[0] * 1e3 + endTime[1] / 1e6).toFixed(2));

    logger.debug(`Read entity ${packageName}.${entityName}: ${totalTimeMs}ms (read: ${readTimeMs}ms, parse: ${parseTimeMs}ms)`);

    return entity;
  } catch (error) {
    logger.error(`Error reading entity file: ${error}`);
    return null;
  }
}

/**
 * Writes an entity to a YAML file
 * @param entity Entity to write
 * @param packageName Package name (directory under microservices/)
 */
export async function writeEntityFile(entity: Entity, packageName?: string): Promise<boolean> {
  try {
    const validation = validateEntity(entity);
    if (!validation.valid) {
      logger.error(`Invalid entity: ${validation.errors.join(', ')}`);
      return false;
    }

    // Use packageName parameter or fall back to a default
    const pkgName = packageName;
    if (!pkgName) {
      logger.error('Package name is required to write entity file');
      return false;
    }

    const packageDir = path.join(DATA_DICTIONARIES_DIR, 'microservices', pkgName);

    if (!fs.existsSync(packageDir)) {
      fs.mkdirSync(packageDir, { recursive: true });
      logger.info(`Created package directory: ${packageDir}`);
    }

    // Check if there's an existing file for this entity (by name) to remove it
    const existingFiles = fs.readdirSync(packageDir).filter(isEntityFile);

    for (const file of existingFiles) {
      const fullPath = path.join(packageDir, file);
      try {
        const content = fs.readFileSync(fullPath, 'utf8');
        const existingEntity = YAML.parse(content) as Entity;
        if (existingEntity.name === entity.name) {
          const newFilename = generateEntityFilename(entity.uuid, entity.name);
          if (file !== newFilename) {
            fs.unlinkSync(fullPath);
            logger.info(`Removed old entity file: ${fullPath}`);
          }
          break;
        }
      } catch (error) {
        continue;
      }
    }

    const filename = generateEntityFilename(entity.uuid, entity.name);
    const filePath = path.join(packageDir, filename);
    const yamlContent = YAML.stringify(entity);

    fs.writeFileSync(filePath, yamlContent, 'utf8');
    logger.info(`Entity written to file: ${filePath}`);

    try {
      await commitChanges(filePath, `Updated entity: ${entity.name} (${entity.uuid})`);
    } catch (gitError) {
      logger.warn(`Git operations failed: ${gitError}`);
    }

    return true;
  } catch (error) {
    logger.error(`Error writing entity file: ${error}`);
    return false;
  }
}

/**
 * Reads relationships from a package's relationships.yaml file
 */
export async function readRelationshipsFile(packagePath: string): Promise<Relationship[]> {
  try {
    const filePath = path.join(packagePath, 'relationships.yaml');
    if (!fs.existsSync(filePath)) {
      return [];
    }

    const content = fs.readFileSync(filePath, 'utf8');
    const parsed = YAML.parse(content);

    if (!parsed || !Array.isArray(parsed)) {
      return [];
    }

    return parsed as Relationship[];
  } catch (error) {
    logger.error(`Error reading relationships file: ${error}`);
    return [];
  }
}

/**
 * Writes relationships to a package's relationships.yaml file
 */
export async function writeRelationshipsFile(packagePath: string, relationships: Relationship[]): Promise<boolean> {
  try {
    if (!fs.existsSync(packagePath)) {
      fs.mkdirSync(packagePath, { recursive: true });
    }

    const filePath = path.join(packagePath, 'relationships.yaml');
    const yamlContent = YAML.stringify(relationships);

    fs.writeFileSync(filePath, yamlContent, 'utf8');
    logger.info(`Relationships written to file: ${filePath}`);

    try {
      await commitChanges(filePath, `Updated relationships in ${path.basename(packagePath)}`);
    } catch (gitError) {
      logger.warn(`Git operations failed: ${gitError}`);
    }

    return true;
  } catch (error) {
    logger.error(`Error writing relationships file: ${error}`);
    return false;
  }
}

/**
 * Gets the full path for a package directory
 */
export function getPackagePath(packageName: string): string {
  return path.join(DATA_DICTIONARIES_DIR, 'microservices', packageName);
}

/**
 * Lists all available entities across all packages
 */
export async function listAllEntities(): Promise<Array<{ microservice: string; name: string; path: string }>> {
  try {
    const microservicesDir = path.join(DATA_DICTIONARIES_DIR, 'microservices');
    const entities: Array<{ microservice: string; name: string; path: string }> = [];

    if (!fs.existsSync(microservicesDir)) {
      return entities;
    }

    const microservices = fs.readdirSync(microservicesDir)
      .filter((item: string) => fs.statSync(path.join(microservicesDir, item)).isDirectory());

    for (const microservice of microservices) {
      const microservicePath = path.join(microservicesDir, microservice);
      const files = fs.readdirSync(microservicePath).filter(isEntityFile);

      for (const file of files) {
        const name = path.basename(file, path.extname(file));
        entities.push({
          microservice,
          name,
          path: path.join(microservicePath, file)
        });
      }
    }

    return entities;
  } catch (error) {
    logger.error(`Error listing entities: ${error}`);
    return [];
  }
}

/**
 * Lists all entities for a specific package
 */
export async function listMicroserviceEntities(microservice: string): Promise<string[]> {
  const startTime = process.hrtime();
  try {
    const microservicePath = path.join(DATA_DICTIONARIES_DIR, 'microservices', microservice);

    if (!fs.existsSync(microservicePath)) {
      return [];
    }

    const readStartTime = process.hrtime();
    const allFiles = fs.readdirSync(microservicePath);
    const readEndTime = process.hrtime(readStartTime);
    const readTimeMs = Number((readEndTime[0] * 1e3 + readEndTime[1] / 1e6).toFixed(2));

    const processStartTime = process.hrtime();
    const files = allFiles
      .filter(isEntityFile)
      .map((file: string) => path.basename(file, path.extname(file)));
    const processEndTime = process.hrtime(processStartTime);
    const processTimeMs = Number((processEndTime[0] * 1e3 + processEndTime[1] / 1e6).toFixed(2));

    const endTime = process.hrtime(startTime);
    const totalTimeMs = Number((endTime[0] * 1e3 + endTime[1] / 1e6).toFixed(2));

    logger.debug(`Listed ${files.length} entities for ${microservice}: ${totalTimeMs}ms (read: ${readTimeMs}ms, process: ${processTimeMs}ms)`);

    return files;
  } catch (error) {
    logger.error(`Error listing microservice entities: ${error}`);
    return [];
  }
}

/**
 * Lists all available microservices
 */
export async function listMicroservices(): Promise<string[]> {
  try {
    const microservicesDir = path.join(DATA_DICTIONARIES_DIR, 'microservices');

    if (!fs.existsSync(microservicesDir)) {
      return [];
    }

    const microservices = fs.readdirSync(microservicesDir)
      .filter((item: string) => fs.statSync(path.join(microservicesDir, item)).isDirectory());

    return microservices;
  } catch (error) {
    logger.error(`Error listing microservices: ${error}`);
    return [];
  }
}

/**
 * Commits changes to git via @hamak/ui-remote-git-fs-backend
 */
async function commitChanges(filePath: string, message: string): Promise<void> {
  if (!config.git.autoCommit) return;

  try {
    const gitService = await getGitService();
    if (!gitService) {
      logger.warn('Git service not available, skipping commit');
      return;
    }

    await gitService.commit('dictionaries', '.', { message, paths: [filePath] });
    logger.info(`Changes committed: ${message}`);
  } catch (error) {
    logger.error(`Git error: ${error}`);
    throw error;
  }
}

/**
 * Deletes an entity file
 */
export async function deleteEntityFile(microservice: string, entityName: string): Promise<boolean> {
  try {
    const microservicePath = path.join(DATA_DICTIONARIES_DIR, 'microservices', microservice);

    if (!fs.existsSync(microservicePath)) {
      logger.warn(`Package directory not found: ${microservicePath}`);
      return false;
    }

    const files = fs.readdirSync(microservicePath).filter(isEntityFile);

    let filePath: string | null = null;

    const legacyPath = path.join(microservicePath, `${entityName}.yaml`);
    if (fs.existsSync(legacyPath)) {
      filePath = legacyPath;
    } else {
      for (const file of files) {
        const fullPath = path.join(microservicePath, file);
        try {
          const content = fs.readFileSync(fullPath, 'utf8');
          const entity = YAML.parse(content) as Entity;
          if (entity.name === entityName) {
            filePath = fullPath;
            break;
          }
        } catch (error) {
          continue;
        }
      }
    }

    if (!filePath) {
      logger.warn(`Entity file not found for deletion: ${microservice}.${entityName}`);
      return false;
    }

    fs.unlinkSync(filePath);
    logger.info(`Entity file deleted: ${filePath}`);

    try {
      await commitChanges(filePath, `Deleted entity: ${entityName}`);
    } catch (gitError) {
      logger.warn(`Git operations failed: ${gitError}`);
    }

    return true;
  } catch (error) {
    logger.error(`Error deleting entity file: ${error}`);
    return false;
  }
}

/**
 * Writes dictionary metadata to a YAML file
 */
export async function writeDictionaryMetadata(dictionary: Dictionary): Promise<boolean> {
  try {
    const dictionaryDir = path.join(DATA_DICTIONARIES_DIR, dictionary.id);

    if (!fs.existsSync(dictionaryDir)) {
      fs.mkdirSync(dictionaryDir, { recursive: true });
      logger.info(`Created dictionary directory: ${dictionaryDir}`);
    }

    const filePath = path.join(dictionaryDir, 'metadata.yaml');

    const metadata = {
      id: dictionary.id,
      name: dictionary.name,
      description: dictionary.description,
      metadataDefinitions: dictionary.metadataDefinitions,
      createdAt: dictionary.createdAt,
      updatedAt: dictionary.updatedAt
    };

    const yamlContent = YAML.stringify(metadata);

    fs.writeFileSync(filePath, yamlContent, 'utf8');
    logger.info(`Dictionary metadata written to file: ${filePath}`);

    try {
      await commitChanges(filePath, `Updated dictionary metadata: ${dictionary.name}`);
    } catch (gitError) {
      logger.warn(`Git operations failed: ${gitError}`);
    }

    return true;
  } catch (error) {
    logger.error(`Error writing dictionary metadata: ${error}`);
    return false;
  }
}

/**
 * Lists all available dictionaries
 */
export async function listAllDictionaries(): Promise<string[]> {
  try {
    const baseDir = DATA_DICTIONARIES_DIR;
    const dictionaries: string[] = [];

    if (!fs.existsSync(baseDir)) {
      return [];
    }

    const items = fs.readdirSync(baseDir);

    for (const item of items) {
      const itemPath = path.join(baseDir, item);

      if (fs.statSync(itemPath).isDirectory()) {
        if (item === 'microservices') {
          const microservices = await listMicroservices();
          dictionaries.push(...microservices);
        } else {
          const metadataPath = path.join(itemPath, 'metadata.yaml');
          if (fs.existsSync(metadataPath)) {
            dictionaries.push(item);
          }
        }
      }
    }

    return dictionaries;
  } catch (error) {
    logger.error(`Error listing all dictionaries: ${error}`);
    return [];
  }
}

// --- Perspective file operations ---

const PERSPECTIVES_DIR = path.join(DATA_DICTIONARIES_DIR, 'perspectives');

export async function listPerspectives(): Promise<Perspective[]> {
  try {
    if (!fs.existsSync(PERSPECTIVES_DIR)) return [];
    const files = fs.readdirSync(PERSPECTIVES_DIR).filter(f => f.endsWith('.yaml'));
    return files.map(f => {
      const content = fs.readFileSync(path.join(PERSPECTIVES_DIR, f), 'utf8');
      return YAML.parse(content) as Perspective;
    }).filter(Boolean);
  } catch (error) {
    logger.error(`Error listing perspectives: ${error}`);
    return [];
  }
}

export async function readPerspectiveFile(uuid: string): Promise<Perspective | null> {
  try {
    // First try direct filename match
    const directPath = path.join(PERSPECTIVES_DIR, `${uuid}.yaml`);
    if (fs.existsSync(directPath)) {
      const content = fs.readFileSync(directPath, 'utf8');
      return YAML.parse(content) as Perspective;
    }
    // Fall back to scanning all files for matching uuid field
    if (!fs.existsSync(PERSPECTIVES_DIR)) return null;
    const files = fs.readdirSync(PERSPECTIVES_DIR).filter(f => f.endsWith('.yaml'));
    for (const f of files) {
      const content = fs.readFileSync(path.join(PERSPECTIVES_DIR, f), 'utf8');
      const perspective = YAML.parse(content) as Perspective;
      if (perspective?.uuid === uuid) return perspective;
    }
    return null;
  } catch (error) {
    logger.error(`Error reading perspective ${uuid}: ${error}`);
    return null;
  }
}

export async function writePerspectiveFile(perspective: Perspective): Promise<boolean> {
  try {
    if (!fs.existsSync(PERSPECTIVES_DIR)) {
      fs.mkdirSync(PERSPECTIVES_DIR, { recursive: true });
    }
    const filePath = path.join(PERSPECTIVES_DIR, `${perspective.uuid}.yaml`);
    fs.writeFileSync(filePath, YAML.stringify(perspective), 'utf8');
    return true;
  } catch (error) {
    logger.error(`Error writing perspective: ${error}`);
    return false;
  }
}

export async function deletePerspectiveFile(uuid: string): Promise<boolean> {
  try {
    // Try direct filename match first, then scan by uuid field
    const directPath = path.join(PERSPECTIVES_DIR, `${uuid}.yaml`);
    if (fs.existsSync(directPath)) {
      fs.unlinkSync(directPath);
      return true;
    }
    if (!fs.existsSync(PERSPECTIVES_DIR)) return false;
    const files = fs.readdirSync(PERSPECTIVES_DIR).filter(f => f.endsWith('.yaml'));
    for (const f of files) {
      const content = fs.readFileSync(path.join(PERSPECTIVES_DIR, f), 'utf8');
      const perspective = YAML.parse(content) as Perspective;
      if (perspective?.uuid === uuid) {
        fs.unlinkSync(path.join(PERSPECTIVES_DIR, f));
        return true;
      }
    }
    return false;
  } catch (error) {
    logger.error(`Error deleting perspective ${uuid}: ${error}`);
    return false;
  }
}

/**
 * Collects all relationships from all packages for cross-service BFS traversal.
 */
export async function getAllRelationships(): Promise<{ packageName: string; relationships: Relationship[] }[]> {
  const result: { packageName: string; relationships: Relationship[] }[] = [];
  try {
    const microservices = await listMicroservices();
    for (const ms of microservices) {
      const pkgPath = path.join(DATA_DICTIONARIES_DIR, 'microservices', ms);
      const rels = await readRelationshipsFile(pkgPath);
      if (rels.length > 0) {
        result.push({ packageName: ms, relationships: rels });
      }
    }
  } catch (error) {
    logger.error(`Error collecting all relationships: ${error}`);
  }
  return result;
}

// --- Review comment file operations ---

export async function readComments(service: string, entityUuid: string): Promise<ReviewComment[]> {
  try {
    const filePath = path.join(DATA_DICTIONARIES_DIR, 'microservices', service, `${entityUuid}.comments.yaml`);
    if (!fs.existsSync(filePath)) return [];
    const content = fs.readFileSync(filePath, 'utf8');
    return YAML.parse(content) || [];
  } catch (error) {
    logger.error(`Error reading comments: ${error}`);
    return [];
  }
}

export async function writeComments(service: string, entityUuid: string, comments: ReviewComment[]): Promise<boolean> {
  try {
    const filePath = path.join(DATA_DICTIONARIES_DIR, 'microservices', service, `${entityUuid}.comments.yaml`);
    fs.writeFileSync(filePath, YAML.stringify(comments), 'utf8');
    return true;
  } catch (error) {
    logger.error(`Error writing comments: ${error}`);
    return false;
  }
}

// --- Rule file operations (#74) ---
//
// Three storage locations:
//   1. Entity-sidecar: data-dictionaries/microservices/{svc}/{entityUuid}.rules.yaml
//   2. Package:        data-dictionaries/microservices/{svc}/rules.yaml
//   3. Perspective:    embedded in data-dictionaries/perspectives/{uuid}.yaml under a `rules` array

/** Read entity-sidecar rules for a single entity. */
export async function readEntityRules(service: string, entityUuid: string): Promise<Rule[]> {
  try {
    const filePath = path.join(DATA_DICTIONARIES_DIR, 'microservices', service, `${entityUuid}.rules.yaml`);
    if (!fs.existsSync(filePath)) return [];
    const content = fs.readFileSync(filePath, 'utf8');
    return YAML.parse(content) || [];
  } catch (error) {
    logger.error(`Error reading entity rules: ${error}`);
    return [];
  }
}

/** Write entity-sidecar rules for a single entity. */
export async function writeEntityRules(service: string, entityUuid: string, rules: Rule[]): Promise<boolean> {
  try {
    const filePath = path.join(DATA_DICTIONARIES_DIR, 'microservices', service, `${entityUuid}.rules.yaml`);
    if (rules.length === 0) {
      // Delete the sidecar file when there are no rules left, to keep the tree clean
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      return true;
    }
    fs.writeFileSync(filePath, YAML.stringify(rules), 'utf8');
    return true;
  } catch (error) {
    logger.error(`Error writing entity rules: ${error}`);
    return false;
  }
}

/** Read package-scoped rules from a single package's rules.yaml. */
export async function readPackageRules(service: string): Promise<Rule[]> {
  try {
    const filePath = path.join(DATA_DICTIONARIES_DIR, 'microservices', service, 'rules.yaml');
    if (!fs.existsSync(filePath)) return [];
    const content = fs.readFileSync(filePath, 'utf8');
    return YAML.parse(content) || [];
  } catch (error) {
    logger.error(`Error reading package rules: ${error}`);
    return [];
  }
}

/** Write package-scoped rules. */
export async function writePackageRules(service: string, rules: Rule[]): Promise<boolean> {
  try {
    const filePath = path.join(DATA_DICTIONARIES_DIR, 'microservices', service, 'rules.yaml');
    if (rules.length === 0) {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      return true;
    }
    fs.writeFileSync(filePath, YAML.stringify(rules), 'utf8');
    return true;
  } catch (error) {
    logger.error(`Error writing package rules: ${error}`);
    return false;
  }
}

/**
 * List all entity-sidecar rule files across all packages.
 * Returns tuples of (service, entityUuid) so callers can read each.
 */
export async function listAllEntityRuleFiles(): Promise<Array<{ service: string; entityUuid: string }>> {
  const result: Array<{ service: string; entityUuid: string }> = [];
  try {
    const microservicesDir = path.join(DATA_DICTIONARIES_DIR, 'microservices');
    if (!fs.existsSync(microservicesDir)) return [];
    const services = fs.readdirSync(microservicesDir).filter(s =>
      fs.statSync(path.join(microservicesDir, s)).isDirectory()
    );
    for (const service of services) {
      const serviceDir = path.join(microservicesDir, service);
      const files = fs.readdirSync(serviceDir).filter(f => f.endsWith('.rules.yaml') && f !== 'rules.yaml');
      for (const file of files) {
        const entityUuid = file.replace('.rules.yaml', '');
        result.push({ service, entityUuid });
      }
    }
  } catch (error) {
    logger.error(`Error listing entity rule files: ${error}`);
  }
  return result;
}

/** List all packages that have a package-level rules.yaml. */
export async function listPackagesWithRules(): Promise<string[]> {
  try {
    const microservicesDir = path.join(DATA_DICTIONARIES_DIR, 'microservices');
    if (!fs.existsSync(microservicesDir)) return [];
    return fs.readdirSync(microservicesDir).filter(service => {
      const serviceDir = path.join(microservicesDir, service);
      if (!fs.statSync(serviceDir).isDirectory()) return false;
      return fs.existsSync(path.join(serviceDir, 'rules.yaml'));
    });
  } catch (error) {
    logger.error(`Error listing packages with rules: ${error}`);
    return [];
  }
}

/** Read perspective-scoped rules from a single perspective YAML. */
export async function readPerspectiveRules(perspectiveUuid: string): Promise<Rule[]> {
  try {
    const perspective = await readPerspectiveFile(perspectiveUuid);
    if (!perspective) return [];
    return (perspective.rules as Rule[]) || [];
  } catch (error) {
    logger.error(`Error reading perspective rules: ${error}`);
    return [];
  }
}

/** Write perspective-scoped rules — preserves the rest of the perspective YAML. */
export async function writePerspectiveRules(perspectiveUuid: string, rules: Rule[]): Promise<boolean> {
  try {
    const perspective = await readPerspectiveFile(perspectiveUuid);
    if (!perspective) return false;
    perspective.rules = rules;
    perspective.updatedAt = new Date().toISOString();
    return await writePerspectiveFile(perspective);
  } catch (error) {
    logger.error(`Error writing perspective rules: ${error}`);
    return false;
  }
}
