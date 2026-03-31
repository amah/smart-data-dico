import fs from 'fs';
import path from 'path';
import YAML from 'yaml';
import { logger } from './logger.js';
import { generateUUID, generateEntityFilename } from './uuid.js';
import { Entity, EntityAttribute, EntityRelationship, createEntityWithUUIDs } from '../models/EntitySchema.js';
import { config } from '../kernel/config.js';

const DATA_DICTIONARIES_DIR = config.dataDir;

/**
 * Migrates all existing entities to use UUIDs
 */
export async function migrateEntitiesToUUID(): Promise<void> {
  logger.info('Starting migration of entities to UUID format...');
  
  const microservicesDir = path.join(DATA_DICTIONARIES_DIR, 'microservices');
  
  if (!fs.existsSync(microservicesDir)) {
    logger.info('No microservices directory found, nothing to migrate');
    return;
  }
  
  const microservices = fs.readdirSync(microservicesDir)
    .filter(item => fs.statSync(path.join(microservicesDir, item)).isDirectory());
  
  let migratedCount = 0;
  let skippedCount = 0;
  
  for (const microservice of microservices) {
    const microservicePath = path.join(microservicesDir, microservice);
    const files = fs.readdirSync(microservicePath)
      .filter(file => file.endsWith('.yaml') || file.endsWith('.yml'));
    
    for (const file of files) {
      const filePath = path.join(microservicePath, file);
      
      try {
        const content = fs.readFileSync(filePath, 'utf8');
        const entity = YAML.parse(content) as any;
        
        // Check if entity already has UUID
        if (entity.uuid) {
          logger.debug(`Entity ${entity.name} already has UUID, skipping`);
          skippedCount++;
          continue;
        }
        
        // Migrate entity to UUID format
        const migratedEntity = migrateEntityToUUID(entity);
        
        // Write to new UUID-based filename
        const newFilename = generateEntityFilename(migratedEntity.uuid, migratedEntity.name);
        const newFilePath = path.join(microservicePath, newFilename);
        
        const yamlContent = YAML.stringify(migratedEntity);
        fs.writeFileSync(newFilePath, yamlContent, 'utf8');
        
        // Remove old file if it has a different name
        if (file !== newFilename) {
          fs.unlinkSync(filePath);
          logger.info(`Migrated ${microservice}/${entity.name}: ${file} -> ${newFilename}`);
        } else {
          logger.info(`Updated ${microservice}/${entity.name} with UUIDs`);
        }
        
        migratedCount++;
        
      } catch (error) {
        logger.error(`Error migrating entity file ${filePath}: ${error}`);
      }
    }
  }
  
  logger.info(`Migration completed: ${migratedCount} entities migrated, ${skippedCount} entities skipped`);
}

/**
 * Migrates a single entity to UUID format
 */
function migrateEntityToUUID(entity: any): Entity {
  // Generate UUID for entity if not present
  if (!entity.uuid) {
    entity.uuid = generateUUID();
  }
  
  // Migrate attributes
  if (entity.attributes) {
    entity.attributes = entity.attributes.map((attr: any) => migrateAttributeToUUID(attr));
  }
  
  // Migrate relationships
  if (entity.relationships) {
    entity.relationships = entity.relationships.map((rel: any) => migrateRelationshipToUUID(rel));
  }
  
  return entity as Entity;
}

/**
 * Migrates a single attribute to UUID format
 */
function migrateAttributeToUUID(attr: any): EntityAttribute {
  if (!attr.uuid) {
    attr.uuid = generateUUID();
  }
  
  // Migrate nested properties if they exist
  if (attr.properties) {
    attr.properties = Object.fromEntries(
      Object.entries(attr.properties).map(([key, prop]: [string, any]) => [
        key,
        migrateAttributeToUUID(prop)
      ])
    );
  }
  
  // Migrate items if they exist
  if (attr.items) {
    attr.items = migrateAttributeToUUID(attr.items);
  }
  
  return attr as EntityAttribute;
}

/**
 * Migrates a single relationship to UUID format
 */
function migrateRelationshipToUUID(rel: any): EntityRelationship {
  if (!rel.uuid) {
    rel.uuid = generateUUID();
  }
  
  return rel as EntityRelationship;
}

/**
 * Migrates diagram layouts to use entity UUIDs instead of IDs
 */
export async function migrateDiagramLayoutsToUUID(): Promise<void> {
  logger.info('Starting migration of diagram layouts to UUID format...');
  
  const diagramsDir = path.join(DATA_DICTIONARIES_DIR, 'diagrams');
  
  if (!fs.existsSync(diagramsDir)) {
    logger.info('No diagrams directory found, nothing to migrate');
    return;
  }
  
  const files = fs.readdirSync(diagramsDir)
    .filter(file => file.endsWith('.json'));
  
  let migratedCount = 0;
  
  // First, build a mapping of entity names to UUIDs
  const entityNameToUUID = await buildEntityNameToUUIDMapping();
  
  for (const file of files) {
    const filePath = path.join(diagramsDir, file);
    
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const layout = JSON.parse(content);
      
      // Check if layout already uses UUIDs (UUIDs are 36 characters with dashes)
      const entityKeys = Object.keys(layout.entities || {});
      const hasUUIDs = entityKeys.some(key => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key));
      
      if (hasUUIDs) {
        logger.debug(`Diagram layout ${file} already uses UUIDs, skipping`);
        continue;
      }
      
      // Migrate entity references from IDs to UUIDs
      const newEntities: any = {};
      
      for (const [entityId, entityData] of Object.entries(layout.entities || {})) {
        const uuid = entityNameToUUID.get(entityId);
        if (uuid) {
          newEntities[uuid] = {
            ...(entityData as any),
            name: entityId // Add name for readability
          };
        } else {
          logger.warn(`Could not find UUID for entity ID: ${entityId}`);
          // Keep the original ID as fallback
          newEntities[entityId] = entityData;
        }
      }
      
      layout.entities = newEntities;
      
      // Write back the migrated layout
      fs.writeFileSync(filePath, JSON.stringify(layout, null, 2), 'utf8');
      logger.info(`Migrated diagram layout: ${file}`);
      migratedCount++;
      
    } catch (error) {
      logger.error(`Error migrating diagram layout ${filePath}: ${error}`);
    }
  }
  
  logger.info(`Diagram layout migration completed: ${migratedCount} layouts migrated`);
}

/**
 * Builds a mapping from entity names to UUIDs by reading all entity files
 */
async function buildEntityNameToUUIDMapping(): Promise<Map<string, string>> {
  const mapping = new Map<string, string>();
  
  const microservicesDir = path.join(DATA_DICTIONARIES_DIR, 'microservices');
  
  if (!fs.existsSync(microservicesDir)) {
    return mapping;
  }
  
  const microservices = fs.readdirSync(microservicesDir)
    .filter(item => fs.statSync(path.join(microservicesDir, item)).isDirectory());
  
  for (const microservice of microservices) {
    const microservicePath = path.join(microservicesDir, microservice);
    const files = fs.readdirSync(microservicePath)
      .filter(file => file.endsWith('.yaml') || file.endsWith('.yml'));
    
    for (const file of files) {
      const filePath = path.join(microservicePath, file);
      
      try {
        const content = fs.readFileSync(filePath, 'utf8');
        const entity = YAML.parse(content) as Entity;
        
        if (entity.uuid && entity.id) {
          mapping.set(entity.id, entity.uuid);
        }
      } catch (error) {
        logger.warn(`Error reading entity file for mapping: ${filePath}`);
      }
    }
  }
  
  return mapping;
}

/**
 * Runs all migrations
 */
export async function runAllMigrations(): Promise<void> {
  logger.info('Starting all migrations...');
  
  await migrateEntitiesToUUID();
  await migrateDiagramLayoutsToUUID();
  
  logger.info('All migrations completed');
}