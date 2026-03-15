import fs from 'fs';
import path from 'path';
import YAML from 'yaml';
import { logger } from './logger.js';
import { Entity, validateEntity } from '../models/EntitySchema.js';
import { Dictionary } from '../models/Dictionary.js';
import { generateEntityFilename, extractUUIDFromFilename } from './uuid.js';
import { config } from '../kernel/config.js';

// Base directory for data dictionaries
const DATA_DICTIONARIES_DIR = config.dataDir;

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
  
  // Create base directory if it doesn't exist
  if (!fs.existsSync(baseDir)) {
    fs.mkdirSync(baseDir, { recursive: true });
    logger.info(`Created base directory: ${baseDir}`);
  }
  
  // Create microservices directory if it doesn't exist
  if (!fs.existsSync(microservicesDir)) {
    fs.mkdirSync(microservicesDir, { recursive: true });
    logger.info(`Created microservices directory: ${microservicesDir}`);
  }
}

/**
 * Reads an entity from a YAML file
 * @param microservice Microservice name
 * @param entityName Entity name
 * @returns Entity object or null if not found
 */
export async function readEntityFile(microservice: string, entityName: string): Promise<Entity | null> {
  const startTime = process.hrtime();
  try {
    const microservicePath = path.join(DATA_DICTIONARIES_DIR, 'microservices', microservice);
    
    if (!fs.existsSync(microservicePath)) {
      logger.warn(`Microservice directory not found: ${microservicePath}`);
      return null;
    }
    
    // Try to find file by name (could be UUID-based or legacy name-based)
    const files = fs.readdirSync(microservicePath)
      .filter(file => file.endsWith('.yaml') || file.endsWith('.yml'));
    
    let filePath: string | null = null;
    
    // First try legacy naming convention
    const legacyPath = path.join(microservicePath, `${entityName}.yaml`);
    if (fs.existsSync(legacyPath)) {
      filePath = legacyPath;
    } else {
      // Try to find by UUID-based filename that contains the entity name
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
          // Skip invalid files
          continue;
        }
      }
    }
    
    if (!filePath) {
      logger.warn(`Entity file not found: ${microservice}.${entityName}`);
      return null;
    }
    
    // Measure file read time
    const readStartTime = process.hrtime();
    const fileContent = fs.readFileSync(filePath, 'utf8');
    const readEndTime = process.hrtime(readStartTime);
    const readTimeMs = Number((readEndTime[0] * 1e3 + readEndTime[1] / 1e6).toFixed(2));
    
    // Measure YAML parse time
    const parseStartTime = process.hrtime();
    const entity = YAML.parse(fileContent) as Entity;
    const parseEndTime = process.hrtime(parseStartTime);
    const parseTimeMs = Number((parseEndTime[0] * 1e3 + parseEndTime[1] / 1e6).toFixed(2));
    
    // Total execution time
    const endTime = process.hrtime(startTime);
    const totalTimeMs = Number((endTime[0] * 1e3 + endTime[1] / 1e6).toFixed(2));
    
    logger.debug(`Read entity ${microservice}.${entityName}: ${totalTimeMs}ms (read: ${readTimeMs}ms, parse: ${parseTimeMs}ms)`);
    
    return entity;
  } catch (error) {
    logger.error(`Error reading entity file: ${error}`);
    return null;
  }
}

/**
 * Writes an entity to a YAML file
 * @param entity Entity to write
 * @returns Success status
 */
export async function writeEntityFile(entity: Entity): Promise<boolean> {
  try {
    // Validate entity before writing
    const validation = validateEntity(entity);
    if (!validation.valid) {
      logger.error(`Invalid entity: ${validation.errors.join(', ')}`);
      return false;
    }
    
    const microserviceDir = path.join(DATA_DICTIONARIES_DIR, 'microservices', entity.microservice);
    
    // Create microservice directory if it doesn't exist
    if (!fs.existsSync(microserviceDir)) {
      fs.mkdirSync(microserviceDir, { recursive: true });
      logger.info(`Created microservice directory: ${microserviceDir}`);
    }
    
    // Check if there's an existing file for this entity (by name) to remove it
    const existingFiles = fs.readdirSync(microserviceDir)
      .filter(file => file.endsWith('.yaml') || file.endsWith('.yml'));
    
    for (const file of existingFiles) {
      const fullPath = path.join(microserviceDir, file);
      try {
        const content = fs.readFileSync(fullPath, 'utf8');
        const existingEntity = YAML.parse(content) as Entity;
        if (existingEntity.name === entity.name && existingEntity.microservice === entity.microservice) {
          // Remove old file if it has a different filename (e.g., migrating from legacy to UUID-based)
          const newFilename = generateEntityFilename(entity.uuid, entity.name);
          if (file !== newFilename) {
            fs.unlinkSync(fullPath);
            logger.info(`Removed old entity file: ${fullPath}`);
          }
          break;
        }
      } catch (error) {
        // Skip invalid files
        continue;
      }
    }
    
    // Use UUID-based filename for new entities
    const filename = generateEntityFilename(entity.uuid, entity.name);
    const filePath = path.join(microserviceDir, filename);
    const yamlContent = YAML.stringify(entity);
    
    fs.writeFileSync(filePath, yamlContent, 'utf8');
    logger.info(`Entity written to file: ${filePath}`);
    
    // Commit changes to git if in a git repository
    try {
      await commitChanges(filePath, `Updated entity: ${entity.name} (${entity.uuid})`);
    } catch (gitError) {
      logger.warn(`Git operations failed: ${gitError}`);
      // Continue even if git operations fail
    }
    
    return true;
  } catch (error) {
    logger.error(`Error writing entity file: ${error}`);
    return false;
  }
}

/**
 * Lists all available entities across all microservices
 * @returns Array of entity information
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
      const files = fs.readdirSync(microservicePath)
        .filter((file: string) => file.endsWith('.yaml') || file.endsWith('.yml'));
      
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
 * Lists all entities for a specific microservice
 * @param microservice Microservice name
 * @returns Array of entity names
 */
export async function listMicroserviceEntities(microservice: string): Promise<string[]> {
  const startTime = process.hrtime();
  try {
    const microservicePath = path.join(DATA_DICTIONARIES_DIR, 'microservices', microservice);
    
    if (!fs.existsSync(microservicePath)) {
      return [];
    }
    
    // Measure directory read time
    const readStartTime = process.hrtime();
    const allFiles = fs.readdirSync(microservicePath);
    const readEndTime = process.hrtime(readStartTime);
    const readTimeMs = Number((readEndTime[0] * 1e3 + readEndTime[1] / 1e6).toFixed(2));
    
    // Measure filter and map time
    const processStartTime = process.hrtime();
    const files = allFiles
      .filter((file: string) => file.endsWith('.yaml') || file.endsWith('.yml'))
      .map((file: string) => path.basename(file, path.extname(file)));
    const processEndTime = process.hrtime(processStartTime);
    const processTimeMs = Number((processEndTime[0] * 1e3 + processEndTime[1] / 1e6).toFixed(2));
    
    // Total execution time
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
 * @returns Array of microservice names
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
 * @param filePath Path to the file that was changed
 * @param message Commit message
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
 * @param microservice Microservice name
 * @param entityName Entity name
 * @returns Success status
 */
export async function deleteEntityFile(microservice: string, entityName: string): Promise<boolean> {
  try {
    const microservicePath = path.join(DATA_DICTIONARIES_DIR, 'microservices', microservice);
    
    if (!fs.existsSync(microservicePath)) {
      logger.warn(`Microservice directory not found: ${microservicePath}`);
      return false;
    }
    
    // Find the file by entity name (could be UUID-based or legacy)
    const files = fs.readdirSync(microservicePath)
      .filter(file => file.endsWith('.yaml') || file.endsWith('.yml'));
    
    let filePath: string | null = null;
    
    // First try legacy naming convention
    const legacyPath = path.join(microservicePath, `${entityName}.yaml`);
    if (fs.existsSync(legacyPath)) {
      filePath = legacyPath;
    } else {
      // Try to find by UUID-based filename that contains the entity name
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
          // Skip invalid files
          continue;
        }
      }
    }
    
    if (!filePath) {
      logger.warn(`Entity file not found for deletion: ${microservice}.${entityName}`);
      return false;
    }
    
    // Delete the file
    fs.unlinkSync(filePath);
    logger.info(`Entity file deleted: ${filePath}`);
    
    // Commit the deletion to git if in a git repository
    try {
      await commitChanges(filePath, `Deleted entity: ${entityName}`);
    } catch (gitError) {
      logger.warn(`Git operations failed: ${gitError}`);
      // Continue even if git operations fail
    }
    
    return true;
  } catch (error) {
    logger.error(`Error deleting entity file: ${error}`);
    return false;
  }
}

/**
 * Writes dictionary metadata to a YAML file
 * @param dictionary Dictionary to write
 * @returns Success status
 */
export async function writeDictionaryMetadata(dictionary: Dictionary): Promise<boolean> {
  try {
    const dictionaryDir = path.join(DATA_DICTIONARIES_DIR, dictionary.id);
    
    // Create dictionary directory if it doesn't exist
    if (!fs.existsSync(dictionaryDir)) {
      fs.mkdirSync(dictionaryDir, { recursive: true });
      logger.info(`Created dictionary directory: ${dictionaryDir}`);
    }
    
    const filePath = path.join(dictionaryDir, 'metadata.yaml');
    
    // Prepare metadata object (exclude any functions or circular references)
    const metadata = {
      id: dictionary.id,
      name: dictionary.name,
      description: dictionary.description,
      version: dictionary.version,
      createdAt: dictionary.createdAt,
      updatedAt: dictionary.updatedAt
    };
    
    const yamlContent = YAML.stringify(metadata);
    
    fs.writeFileSync(filePath, yamlContent, 'utf8');
    logger.info(`Dictionary metadata written to file: ${filePath}`);
    
    // Commit changes to git if in a git repository
    try {
      await commitChanges(filePath, `Updated dictionary metadata: ${dictionary.name}`);
    } catch (gitError) {
      logger.warn(`Git operations failed: ${gitError}`);
      // Continue even if git operations fail
    }
    
    return true;
  } catch (error) {
    logger.error(`Error writing dictionary metadata: ${error}`);
    return false;
  }
}

/**
 * Lists all available dictionaries (both microservices and standalone dictionaries)
 * @returns Array of dictionary IDs
 */
export async function listAllDictionaries(): Promise<string[]> {
  try {
    const baseDir = DATA_DICTIONARIES_DIR;
    const dictionaries: string[] = [];
    
    if (!fs.existsSync(baseDir)) {
      return [];
    }
    
    // Get all directories in the base directory
    const items = fs.readdirSync(baseDir);
    
    for (const item of items) {
      const itemPath = path.join(baseDir, item);
      
      // Check if it's a directory
      if (fs.statSync(itemPath).isDirectory()) {
        // If it's the microservices directory, add all microservices
        if (item === 'microservices') {
          const microservices = await listMicroservices();
          dictionaries.push(...microservices);
        }
        // Otherwise, check if it has a metadata.yaml file (indicating it's a dictionary)
        else {
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