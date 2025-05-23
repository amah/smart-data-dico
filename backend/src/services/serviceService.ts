import { Entity } from '../models/EntitySchema';
import { logger } from '../utils/logger';
import { 
  listMicroservices, 
  listMicroserviceEntities, 
  readEntityFile, 
  writeEntityFile, 
  deleteEntityFile,
  listAllEntities
} from '../utils/fileOperations';

/**
 * Interface for search result
 */
interface SearchResult {
  type: 'entity' | 'attribute';
  service: string;
  entityName: string;
  attributeName?: string;
  description: string;
  path: string;
  score: number;
}

/**
 * Interface for graph data
 */
interface GraphNode {
  id: string;
  label: string;
  type: 'entity';
  service: string;
}

interface GraphEdge {
  id: string;
  source: string;
  target: string;
  label: string;
  type: string;
}

interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/**
 * Service for managing services and entities
 */
export class ServiceService {
  /**
   * Get all services (microservices)
   * @returns Promise<string[]>
   */
  async getAllServices(): Promise<string[]> {
    logger.info('Getting all services');
    
    try {
      const services = await listMicroservices();
      return services;
    } catch (error) {
      logger.error(`Error getting all services: ${error}`);
      return [];
    }
  }

  /**
   * Get all entities for a specific service
   * @param service Service name
   * @returns Promise<Entity[]>
   */
  async getServiceEntities(service: string): Promise<Entity[]> {
    logger.info(`Getting entities for service: ${service}`);
    const startTime = process.hrtime();
    
    try {
      // Measure time to list entity names
      const listStartTime = process.hrtime();
      const entityNames = await listMicroserviceEntities(service);
      const listEndTime = process.hrtime(listStartTime);
      const listTimeMs = Number((listEndTime[0] * 1e3 + listEndTime[1] / 1e6).toFixed(2));
      logger.info(`Listed ${entityNames.length} entity names for service ${service} in ${listTimeMs}ms`);
      
      const entities: Entity[] = [];
      
      // Measure time to read all entity files
      const readStartTime = process.hrtime();
      for (const entityName of entityNames) {
        const entity = await readEntityFile(service, entityName);
        if (entity) {
          entities.push(entity);
        }
      }
      const readEndTime = process.hrtime(readStartTime);
      const readTimeMs = Number((readEndTime[0] * 1e3 + readEndTime[1] / 1e6).toFixed(2));
      logger.info(`Read ${entities.length} entity files for service ${service} in ${readTimeMs}ms`);
      
      // Total execution time
      const endTime = process.hrtime(startTime);
      const totalTimeMs = Number((endTime[0] * 1e3 + endTime[1] / 1e6).toFixed(2));
      logger.info(`Total time to get entities for service ${service}: ${totalTimeMs}ms (list: ${listTimeMs}ms, read: ${readTimeMs}ms)`);
      
      return entities;
    } catch (error) {
      logger.error(`Error getting service entities: ${error}`);
      return [];
    }
  }

  /**
   * Get entity schema by service and entity name
   * @param service Service name
   * @param entityName Entity name
   * @returns Promise<Entity | null>
   */
  async getEntitySchema(service: string, entityName: string): Promise<Entity | null> {
    logger.info(`Getting entity schema: ${service}.${entityName}`);
    
    try {
      const entity = await readEntityFile(service, entityName);
      return entity;
    } catch (error) {
      logger.error(`Error getting entity schema: ${error}`);
      return null;
    }
  }

  /**
   * Create a new entity
   * @param entity Entity to create
   * @returns Promise<{ success: boolean; errors: string[] }>
   */
  async createEntity(entity: Entity): Promise<{ success: boolean; errors: string[] }> {
    logger.info(`Creating entity: ${entity.microservice}.${entity.name}`);
    
    try {
      // Check if entity already exists
      const existingEntity = await readEntityFile(entity.microservice, entity.name);
      if (existingEntity) {
        return {
          success: false,
          errors: [`Entity ${entity.microservice}.${entity.name} already exists`]
        };
      }
      
      // Set creation and update timestamps
      entity.createdAt = new Date().toISOString();
      entity.updatedAt = new Date().toISOString();
      
      // Write entity to file
      const result = await writeEntityFile(entity);
      
      return {
        success: result,
        errors: result ? [] : ['Failed to write entity file']
      };
    } catch (error) {
      logger.error(`Error creating entity: ${error}`);
      return {
        success: false,
        errors: [`Error creating entity: ${error}`]
      };
    }
  }

  /**
   * Update an existing entity
   * @param entity Entity to update
   * @returns Promise<{ success: boolean; errors: string[] }>
   */
  async updateEntity(entity: Entity): Promise<{ success: boolean; errors: string[] }> {
    logger.info(`Updating entity: ${entity.microservice}.${entity.name}`);
    
    try {
      // Check if entity exists
      const existingEntity = await readEntityFile(entity.microservice, entity.name);
      if (!existingEntity) {
        return {
          success: false,
          errors: [`Entity ${entity.microservice}.${entity.name} not found`]
        };
      }
      
      // Preserve creation timestamp and update the update timestamp
      entity.createdAt = existingEntity.createdAt;
      entity.updatedAt = new Date().toISOString();
      
      // Write entity to file
      const result = await writeEntityFile(entity);
      
      return {
        success: result,
        errors: result ? [] : ['Failed to write entity file']
      };
    } catch (error) {
      logger.error(`Error updating entity: ${error}`);
      return {
        success: false,
        errors: [`Error updating entity: ${error}`]
      };
    }
  }

  /**
   * Delete an entity
   * @param service Service name
   * @param entityName Entity name
   * @returns Promise<{ success: boolean; errors: string[] }>
   */
  async deleteEntity(service: string, entityName: string): Promise<{ success: boolean; errors: string[] }> {
    logger.info(`Deleting entity: ${service}.${entityName}`);
    
    try {
      // Check if entity exists
      const existingEntity = await readEntityFile(service, entityName);
      if (!existingEntity) {
        return {
          success: false,
          errors: [`Entity ${service}.${entityName} not found`]
        };
      }
      
      // Check if entity has relationships from other entities
      const relatedEntities = await this.getEntitiesWithRelationshipsTo(service, entityName);
      if (relatedEntities.length > 0) {
        return {
          success: false,
          errors: [
            `Cannot delete entity ${service}.${entityName} because it has relationships from other entities:`,
            ...relatedEntities.map(e => `- ${e.microservice}.${e.name}`)
          ]
        };
      }
      
      // Delete entity file
      const result = await deleteEntityFile(service, entityName);
      
      return {
        success: result,
        errors: result ? [] : ['Failed to delete entity file']
      };
    } catch (error) {
      logger.error(`Error deleting entity: ${error}`);
      return {
        success: false,
        errors: [`Error deleting entity: ${error}`]
      };
    }
  }

  /**
   * Get entities that have relationships to the specified entity
   * @param service Service name
   * @param entityName Entity name
   * @returns Promise<Entity[]>
   */
  private async getEntitiesWithRelationshipsTo(service: string, entityName: string): Promise<Entity[]> {
    const allEntities = await listAllEntities();
    const relatedEntities: Entity[] = [];
    const fullName = `${service}.${entityName}`;
    
    for (const entityInfo of allEntities) {
      if (entityInfo.microservice === service && entityInfo.name === entityName) {
        continue; // Skip the entity itself
      }
      
      const entity = await readEntityFile(entityInfo.microservice, entityInfo.name);
      
      if (entity && entity.relationships && entity.relationships.some(rel => rel.target === fullName)) {
        relatedEntities.push(entity);
      }
    }
    
    return relatedEntities;
  }

  /**
   * Search for entities and attributes by keyword
   * @param query Search query
   * @returns Promise<SearchResult[]>
   */
  async searchEntities(query: string): Promise<SearchResult[]> {
    logger.info(`Searching entities with query: ${query}`);
    
    try {
      const results: SearchResult[] = [];
      const allEntities = await listAllEntities();
      const searchTerms = query.toLowerCase().split(/\s+/);
      
      for (const entityInfo of allEntities) {
        const entity = await readEntityFile(entityInfo.microservice, entityInfo.name);
        
        if (!entity) continue;
        
        // Search in entity name and description
        const entityNameMatch = this.calculateMatchScore(entity.name, searchTerms);
        const entityDescMatch = this.calculateMatchScore(entity.description, searchTerms);
        
        if (entityNameMatch > 0 || entityDescMatch > 0) {
          results.push({
            type: 'entity',
            service: entity.microservice,
            entityName: entity.name,
            description: entity.description,
            path: `${entity.microservice}.${entity.name}`,
            score: Math.max(entityNameMatch * 2, entityDescMatch) // Name matches are more important
          });
        }
        
        // Search in attributes
        for (const attr of entity.attributes) {
          const attrNameMatch = this.calculateMatchScore(attr.name, searchTerms);
          const attrDescMatch = this.calculateMatchScore(attr.description, searchTerms);
          
          if (attrNameMatch > 0 || attrDescMatch > 0) {
            results.push({
              type: 'attribute',
              service: entity.microservice,
              entityName: entity.name,
              attributeName: attr.name,
              description: attr.description,
              path: `${entity.microservice}.${entity.name}.${attr.name}`,
              score: Math.max(attrNameMatch * 1.5, attrDescMatch) // Name matches are more important
            });
          }
        }
      }
      
      // Sort results by score (descending)
      return results.sort((a, b) => b.score - a.score);
    } catch (error) {
      logger.error(`Error searching entities: ${error}`);
      return [];
    }
  }

  /**
   * Calculate match score for a text against search terms
   * @param text Text to search in
   * @param searchTerms Search terms
   * @returns Match score
   */
  private calculateMatchScore(text: string, searchTerms: string[]): number {
    if (!text) return 0;
    
    const normalizedText = text.toLowerCase();
    let score = 0;
    
    for (const term of searchTerms) {
      if (normalizedText.includes(term)) {
        // Exact match
        score += 1;
        
        // Bonus for word boundary matches
        const regex = new RegExp(`\\b${term}\\b`, 'i');
        if (regex.test(normalizedText)) {
          score += 0.5;
        }
      }
    }
    
    return score;
  }

  /**
   * Get graph data for visualization
   * @param service Service name
   * @returns Promise<GraphData>
   */
  async getGraphData(service: string): Promise<GraphData> {
    logger.info(`Generating graph data for service: ${service}`);
    
    try {
      const graphData: GraphData = {
        nodes: [],
        edges: []
      };
      
      // Get all entities for the service
      const entities = await this.getServiceEntities(service);
      
      // Add nodes for each entity
      for (const entity of entities) {
        graphData.nodes.push({
          id: `${entity.microservice}.${entity.name}`,
          label: entity.name,
          type: 'entity',
          service: entity.microservice
        });
      }
      
      // Add edges for relationships
      for (const entity of entities) {
        if (!entity.relationships) continue;
        
        for (const rel of entity.relationships) {
          const edgeId = `${entity.microservice}.${entity.name}-${rel.type}-${rel.target}`;
          
          graphData.edges.push({
            id: edgeId,
            source: `${entity.microservice}.${entity.name}`,
            target: rel.target,
            label: rel.name,
            type: rel.type
          });
        }
      }
      
      return graphData;
    } catch (error) {
      logger.error(`Error generating graph data: ${error}`);
      return { nodes: [], edges: [] };
    }
  }
}

// Export a singleton instance
export const serviceService = new ServiceService();