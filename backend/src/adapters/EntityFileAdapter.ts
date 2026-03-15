/**
 * EntityFileAdapter
 *
 * Wraps @hamak/filesystem-server-impl's WorkspaceManager to provide
 * the same API as current fileOperations.ts functions.
 * Uses dynamic imports since the framework packages are ESM-only.
 */

import path from 'path';
import YAML from 'yaml';
import { logger } from '../utils/logger.js';
import { Entity, validateEntity } from '../models/EntitySchema.js';
import { generateEntityFilename } from '../utils/uuid.js';
import { config } from '../kernel/config.js';

// Lazy-loaded framework modules (ESM)
let WorkspaceManager: any;
let FileRouter: any;
let FileInfoEnricherRegistry: any;

let workspaceManager: any = null;
let enricherRegistry: any = null;
let fileRouter: any = null;

/**
 * Initialize the framework filesystem components.
 * Must be called once at startup (async because of ESM dynamic imports).
 */
export async function initializeFileSystem(): Promise<{
  workspaceManager: any;
  fileRouter: any;
  enricherRegistry: any;
}> {
  if (workspaceManager) {
    return { workspaceManager, fileRouter, enricherRegistry };
  }

  const fsModule = await import('@hamak/filesystem-server-impl');
  WorkspaceManager = fsModule.WorkspaceManager;
  FileRouter = fsModule.FileRouter;
  FileInfoEnricherRegistry = fsModule.FileInfoEnricherRegistry;

  const baseDirectory = config.dataDir;

  // Configure workspace: 'dictionaries' workspace maps to the data-dictionaries root
  const workspacesConfig: Record<string, string> = {
    dictionaries: '.',
  };

  workspaceManager = new WorkspaceManager(workspacesConfig, { baseDirectory });
  enricherRegistry = new FileInfoEnricherRegistry();
  fileRouter = new FileRouter(workspaceManager, { enricherRegistry });

  logger.info('Framework filesystem initialized', { baseDirectory });

  return { workspaceManager, fileRouter, enricherRegistry };
}

/**
 * Get the Express router for the /fs endpoint.
 * Must call initializeFileSystem() first.
 */
export function getFileRouter(): any {
  if (!fileRouter) {
    throw new Error('FileRouter not initialized. Call initializeFileSystem() first.');
  }
  return fileRouter.router;
}

/**
 * Get the enricher registry for registering file info enrichers.
 */
export function getEnricherRegistry(): any {
  if (!enricherRegistry) {
    throw new Error('EnricherRegistry not initialized. Call initializeFileSystem() first.');
  }
  return enricherRegistry;
}

/**
 * Get the workspace manager instance.
 */
export function getWorkspaceManager(): any {
  if (!workspaceManager) {
    throw new Error('WorkspaceManager not initialized. Call initializeFileSystem() first.');
  }
  return workspaceManager;
}

/**
 * Read an entity file using WorkspaceManager.
 * Falls back to scanning files by entity name (matching current behavior).
 */
export async function readEntityViaAdapter(
  microservice: string,
  entityName: string
): Promise<Entity | null> {
  if (!workspaceManager) {
    return null;
  }

  try {
    const dirPath = `microservices/${microservice}`;
    const files = await workspaceManager.listFiles('dictionaries', dirPath);

    for (const file of files) {
      if (!file.name.endsWith('.yaml') && !file.name.endsWith('.yml')) {
        continue;
      }

      const filePath = `${dirPath}/${file.name}`;
      const content = await workspaceManager.readFile('dictionaries', filePath);
      const entity = YAML.parse(content) as Entity;

      if (entity.name === entityName) {
        return entity;
      }
    }

    return null;
  } catch (error) {
    logger.error(`EntityFileAdapter.readEntity error: ${error}`);
    return null;
  }
}

/**
 * Write an entity file using WorkspaceManager.
 */
export async function writeEntityViaAdapter(entity: Entity): Promise<boolean> {
  if (!workspaceManager) {
    return false;
  }

  try {
    const validation = validateEntity(entity);
    if (!validation.valid) {
      logger.error(`Invalid entity: ${validation.errors.join(', ')}`);
      return false;
    }

    const filename = generateEntityFilename(entity.uuid, entity.name);
    const filePath = `microservices/${entity.microservice}/${filename}`;
    const yamlContent = YAML.stringify(entity);

    await workspaceManager.writeFile('dictionaries', filePath, yamlContent);
    logger.info(`Entity written via adapter: ${filePath}`);

    return true;
  } catch (error) {
    logger.error(`EntityFileAdapter.writeEntity error: ${error}`);
    return false;
  }
}
