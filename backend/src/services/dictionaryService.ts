import { Dictionary, DictionaryEntry } from '../models/Dictionary';
import { Entity } from '../models/EntitySchema';
import { logger } from '../utils/logger';
import { entityService } from './entityService';
import fs from 'fs';
import path from 'path';
import YAML from 'yaml';
import {
  listMicroservices,
  listMicroserviceEntities,
  listAllEntities,
  writeDictionaryMetadata,
  ensureDirectoryStructure,
  listAllDictionaries
} from '../utils/fileOperations';

/**
 * Dictionary Service
 * Provides functionality for managing data dictionaries
 */
export class DictionaryService {
  /**
   * Get all dictionaries (microservices)
   * @returns Promise<Dictionary[]>
   */
  async getAllDictionaries(): Promise<Dictionary[]> {
    logger.info('Getting all dictionaries');
    
    try {
      const dictionaryIds = await listAllDictionaries();
      const dictionaries: Dictionary[] = [];
      
      for (const id of dictionaryIds) {
        // For microservices, we create a dictionary object on the fly
        if (await this.isMicroservice(id)) {
          const entities = await listMicroserviceEntities(id);
          
          dictionaries.push({
            id: id,
            name: id,
            description: `Data dictionary for ${id}`,
            version: '1.0.0',
            createdAt: new Date(),
            updatedAt: new Date()
          });
        }
        // For standalone dictionaries, read from metadata file
        else {
          const dictionary = await this.readDictionaryMetadata(id);
          if (dictionary) {
            dictionaries.push(dictionary);
          }
        }
      }
      
      return dictionaries;
    } catch (error) {
      logger.error(`Error getting all dictionaries: ${error}`);
      return [];
    }
  }

  /**
   * Get dictionary by ID (microservice name)
   * @param id Dictionary ID (microservice name)
   * @returns Promise<Dictionary | null>
   */
  async getDictionaryById(id: string): Promise<Dictionary | null> {
    logger.info(`Getting dictionary with ID: ${id}`);
    
    try {
      const microservices = await listMicroservices();
      
      if (!microservices.includes(id)) {
        return null;
      }
      
      return {
        id,
        name: id,
        description: `Data dictionary for ${id}`,
        version: '1.0.0',
        createdAt: new Date(),
        updatedAt: new Date()
      };
    } catch (error) {
      logger.error(`Error getting dictionary by ID: ${error}`);
      return null;
    }
  }
  
  /**
   * Get all entries for a dictionary (entities in a microservice)
   * @param dictionaryId Dictionary ID (microservice name)
   * @returns Promise<DictionaryEntry[]>
   */
  async getDictionaryEntries(dictionaryId: string): Promise<DictionaryEntry[]> {
    logger.info(`Getting entries for dictionary: ${dictionaryId}`);
    
    try {
      const entityNames = await listMicroserviceEntities(dictionaryId);
      const entries: DictionaryEntry[] = [];
      
      for (const entityName of entityNames) {
        const entity = await entityService.getEntity(dictionaryId, entityName);
        
        if (entity) {
          entries.push({
            id: entity.id,
            name: entity.name,
            description: entity.description,
            type: 'entity',
            required: false,
            metadata: {
              microservice: entity.microservice,
              attributeCount: entity.attributes.length,
              relationshipCount: entity.relationships?.length || 0
            }
          });
        }
      }
      
      return entries;
    } catch (error) {
      logger.error(`Error getting dictionary entries: ${error}`);
      return [];
    }
  }
  
  /**
   * Get entity details as dictionary entries
   * @param microservice Microservice name
   * @param entityName Entity name
   * @returns Promise<DictionaryEntry[]>
   */
  async getEntityAttributes(microservice: string, entityName: string): Promise<DictionaryEntry[]> {
    logger.info(`Getting attributes for entity: ${microservice}.${entityName}`);
    
    try {
      const entity = await entityService.getEntity(microservice, entityName);
      
      if (!entity) {
        return [];
      }
      
      const entries: DictionaryEntry[] = entity.attributes.map(attr => ({
        id: `${entity.id}.${attr.name}`,
        name: attr.name,
        description: attr.description,
        type: attr.type,
        format: attr.format,
        required: attr.required,
        defaultValue: attr.defaultValue,
        examples: attr.examples,
        metadata: {
          ...attr.metadata,
          minLength: attr.minLength,
          maxLength: attr.maxLength,
          pattern: attr.pattern,
          minimum: attr.minimum,
          maximum: attr.maximum,
          precision: attr.precision,
          scale: attr.scale,
          enumValues: attr.enumValues
        }
      }));
      
      return entries;
    } catch (error) {
      logger.error(`Error getting entity attributes: ${error}`);
      return [];
    }
  }
  /**
   * Create a new dictionary (microservice)
   * @param dictionary Dictionary data
   * @returns Promise<Dictionary | { error: string; code: string } | null>
   */
  async createDictionary(dictionary: Dictionary): Promise<Dictionary | { error: string; code: string } | null> {
    logger.info(`Creating new dictionary: ${dictionary.name}`);
    
    try {
      // Validate dictionary data
      if (!dictionary.name) {
        logger.error('Dictionary name is required');
        return { error: 'Dictionary name is required', code: 'MISSING_NAME' };
      }
      
      // Check if dictionary already exists (case-insensitive)
      const existingDictionaries = await this.getAllDictionaries();
      const exists = existingDictionaries.some(dict =>
        dict.name.toLowerCase() === dictionary.name.toLowerCase()
      );
      
      if (exists) {
        logger.error(`Dictionary with name ${dictionary.name} already exists`);
        return { error: `Dictionary with name "${dictionary.name}" already exists`, code: 'DUPLICATE_NAME' };
      }
      
      // Create directory structure for the new dictionary
      const dictionaryId = dictionary.name.toLowerCase().replace(/\s+/g, '-');
      
      // Ensure the base directory structure exists
      await ensureDirectoryStructure();
      
      // Create the new dictionary with generated fields
      const newDictionary: Dictionary = {
        id: dictionaryId,
        name: dictionary.name,
        description: dictionary.description || `Data dictionary for ${dictionary.name}`,
        version: dictionary.version || '1.0.0',
        createdAt: new Date(),
        updatedAt: new Date()
      };
      
      // Save dictionary metadata to disk
      const saved = await writeDictionaryMetadata(newDictionary);
      
      if (!saved) {
        logger.error(`Failed to save dictionary metadata for ${newDictionary.name}`);
        return { error: 'Failed to save dictionary metadata', code: 'SAVE_FAILED' };
      }
      
      logger.info(`Dictionary ${newDictionary.name} created successfully`);
      return newDictionary;
    } catch (error) {
      logger.error(`Error creating dictionary: ${error}`);
      return { error: `Internal server error: ${error}`, code: 'INTERNAL_ERROR' };
    }
  }
  /**
   * Checks if a dictionary ID refers to a microservice
   * @param id Dictionary ID
   * @returns Promise<boolean>
   */
  private async isMicroservice(id: string): Promise<boolean> {
    const microservices = await listMicroservices();
    return microservices.includes(id);
  }

  /**
   * Reads dictionary metadata from file
   * @param id Dictionary ID
   * @returns Promise<Dictionary | null>
   */
  private async readDictionaryMetadata(id: string): Promise<Dictionary | null> {
    try {
      const filePath = path.join(process.cwd(), '..', 'data-dictionaries', id, 'metadata.yaml');
      
      if (!fs.existsSync(filePath)) {
        logger.warn(`Dictionary metadata file not found: ${filePath}`);
        return null;
      }
      
      const fileContent = fs.readFileSync(filePath, 'utf8');
      const metadata = YAML.parse(fileContent) as Dictionary;
      
      return metadata;
    } catch (error) {
      logger.error(`Error reading dictionary metadata: ${error}`);
      return null;
    }
  }
}

// Export a singleton instance
export const dictionaryService = new DictionaryService();