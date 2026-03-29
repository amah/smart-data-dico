import { Entity, Relationship, Cardinality } from '../models/EntitySchema.js';
import { stereotypeService } from './stereotypeService.js';
import { logger } from '../utils/logger.js';
import {
  listMicroservices,
  listMicroserviceEntities,
  readEntityFile,
  writeEntityFile,
  deleteEntityFile,
  listAllEntities,
  readRelationshipsFile,
  writeRelationshipsFile,
  getPackagePath,
  getAllRelationships
} from '../utils/fileOperations.js';
import { generateUUID } from '../utils/uuid.js';

/**
 * Interface for search result
 */
interface SearchFilters {
  type?: string;
  service?: string;
  stereotype?: string;
  hasMetadata?: string;
}

interface SearchResult {
  type: 'entity' | 'attribute' | 'metadata' | 'relationship' | 'package';
  service: string;
  entityName: string;
  attributeName?: string;
  name: string;
  description: string;
  path: string;
  score: number;
  matchContext?: string;
}

interface ImpactAnalysis {
  relationships: { uuid: string; description: string; service: string; sourceEntity: string; targetEntity: string }[];
  perspectives: { uuid: string; name: string; path: string }[];
  diagrams: { id: string; name: string }[];
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
  sourceCardinality: string;
  targetCardinality: string;
}

interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/**
 * Service for managing services and entities
 */
export class ServiceService {
  async getAllServices(): Promise<string[]> {
    logger.info('Getting all services');
    try {
      return await listMicroservices();
    } catch (error) {
      logger.error(`Error getting all services: ${error}`);
      return [];
    }
  }

  async getServiceEntities(service: string): Promise<Entity[]> {
    logger.info(`Getting entities for service: ${service}`);
    const startTime = process.hrtime();

    try {
      const listStartTime = process.hrtime();
      const entityNames = await listMicroserviceEntities(service);
      const listEndTime = process.hrtime(listStartTime);
      const listTimeMs = Number((listEndTime[0] * 1e3 + listEndTime[1] / 1e6).toFixed(2));
      logger.info(`Listed ${entityNames.length} entity names for service ${service} in ${listTimeMs}ms`);

      const entities: Entity[] = [];

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

      const endTime = process.hrtime(startTime);
      const totalTimeMs = Number((endTime[0] * 1e3 + endTime[1] / 1e6).toFixed(2));
      logger.info(`Total time to get entities for service ${service}: ${totalTimeMs}ms (list: ${listTimeMs}ms, read: ${readTimeMs}ms)`);

      return entities;
    } catch (error) {
      logger.error(`Error getting service entities: ${error}`);
      return [];
    }
  }

  async getEntitySchema(service: string, entityName: string): Promise<Entity | null> {
    logger.info(`Getting entity schema: ${service}.${entityName}`);
    try {
      return await readEntityFile(service, entityName);
    } catch (error) {
      logger.error(`Error getting entity schema: ${error}`);
      return null;
    }
  }

  async createEntity(service: string, entity: Entity): Promise<{ success: boolean; errors: string[] }> {
    logger.info(`Creating entity: ${service}.${entity.name}`);

    try {
      const existingEntity = await readEntityFile(service, entity.name);
      if (existingEntity) {
        return {
          success: false,
          errors: [`Entity ${service}.${entity.name} already exists`]
        };
      }

      // Validate metadata against stereotype
      if (entity.stereotype) {
        const stereotype = await stereotypeService.getStereotype(entity.stereotype);
        if (stereotype) {
          const metadataErrors = stereotypeService.validateMetadata(stereotype, entity.metadata);
          if (metadataErrors.length > 0) {
            return { success: false, errors: metadataErrors };
          }
        }
      }

      entity.createdAt = new Date().toISOString();
      entity.updatedAt = new Date().toISOString();

      const result = await writeEntityFile(entity, service);

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

  async updateEntity(service: string, entity: Entity): Promise<{ success: boolean; errors: string[] }> {
    logger.info(`Updating entity: ${service}.${entity.name}`);

    try {
      const existingEntity = await readEntityFile(service, entity.name);
      if (!existingEntity) {
        return {
          success: false,
          errors: [`Entity ${service}.${entity.name} not found`]
        };
      }

      // Validate metadata against stereotype
      if (entity.stereotype) {
        const stereotype = await stereotypeService.getStereotype(entity.stereotype);
        if (stereotype) {
          const metadataErrors = stereotypeService.validateMetadata(stereotype, entity.metadata);
          if (metadataErrors.length > 0) {
            return { success: false, errors: metadataErrors };
          }
        }
      }

      entity.createdAt = existingEntity.createdAt;
      entity.updatedAt = new Date().toISOString();

      const result = await writeEntityFile(entity, service);

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

  async deleteEntity(service: string, entityName: string): Promise<{ success: boolean; errors: string[] }> {
    logger.info(`Deleting entity: ${service}.${entityName}`);

    try {
      const existingEntity = await readEntityFile(service, entityName);
      if (!existingEntity) {
        return {
          success: false,
          errors: [`Entity ${service}.${entityName} not found`]
        };
      }

      // Check if entity is referenced in package-level relationships
      const packagePath = getPackagePath(service);
      const relationships = await readRelationshipsFile(packagePath);
      const referencingRels = relationships.filter(
        rel => rel.source.entity === existingEntity.uuid || rel.target.entity === existingEntity.uuid
      );

      if (referencingRels.length > 0) {
        return {
          success: false,
          errors: [
            `Cannot delete entity ${service}.${entityName} because it is referenced in ${referencingRels.length} relationship(s). Remove the relationships first.`
          ]
        };
      }

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

  // --- Relationship CRUD ---

  async getPackageRelationships(packageName: string): Promise<Relationship[]> {
    const packagePath = getPackagePath(packageName);
    return await readRelationshipsFile(packagePath);
  }

  async createRelationship(packageName: string, relationship: Relationship): Promise<{ success: boolean; errors: string[]; relationship?: Relationship }> {
    try {
      if (!relationship.uuid) {
        relationship.uuid = generateUUID();
      }

      const packagePath = getPackagePath(packageName);
      const relationships = await readRelationshipsFile(packagePath);
      relationships.push(relationship);

      const result = await writeRelationshipsFile(packagePath, relationships);
      return {
        success: result,
        errors: result ? [] : ['Failed to write relationships file'],
        relationship: result ? relationship : undefined
      };
    } catch (error) {
      logger.error(`Error creating relationship: ${error}`);
      return { success: false, errors: [`Error creating relationship: ${error}`] };
    }
  }

  async updateRelationship(packageName: string, uuid: string, relationship: Relationship): Promise<{ success: boolean; errors: string[] }> {
    try {
      const packagePath = getPackagePath(packageName);
      const relationships = await readRelationshipsFile(packagePath);
      const index = relationships.findIndex(r => r.uuid === uuid);

      if (index === -1) {
        return { success: false, errors: [`Relationship ${uuid} not found`] };
      }

      relationships[index] = { ...relationship, uuid };
      const result = await writeRelationshipsFile(packagePath, relationships);
      return {
        success: result,
        errors: result ? [] : ['Failed to write relationships file']
      };
    } catch (error) {
      logger.error(`Error updating relationship: ${error}`);
      return { success: false, errors: [`Error updating relationship: ${error}`] };
    }
  }

  async deleteRelationship(packageName: string, uuid: string): Promise<{ success: boolean; errors: string[] }> {
    try {
      const packagePath = getPackagePath(packageName);
      const relationships = await readRelationshipsFile(packagePath);
      const index = relationships.findIndex(r => r.uuid === uuid);

      if (index === -1) {
        return { success: false, errors: [`Relationship ${uuid} not found`] };
      }

      relationships.splice(index, 1);
      const result = await writeRelationshipsFile(packagePath, relationships);
      return {
        success: result,
        errors: result ? [] : ['Failed to write relationships file']
      };
    } catch (error) {
      logger.error(`Error deleting relationship: ${error}`);
      return { success: false, errors: [`Error deleting relationship: ${error}`] };
    }
  }

  // --- Search ---

  async searchEntities(query: string, filters?: SearchFilters): Promise<SearchResult[]> {
    logger.info(`Searching with query: ${query}, filters: ${JSON.stringify(filters)}`);

    try {
      const results: SearchResult[] = [];
      const allEntities = await listAllEntities();
      const searchTerms = query.toLowerCase().split(/\s+/);
      const microservices = await listMicroservices();

      // Search packages
      if (!filters?.type || filters.type === 'package') {
        for (const ms of microservices) {
          if (filters?.service && filters.service !== ms) continue;
          const score = this.calculateMatchScore(ms, searchTerms);
          if (score > 0) {
            results.push({ type: 'package', service: ms, entityName: '', name: ms, description: '', path: ms, score });
          }
        }
      }

      for (const entityInfo of allEntities) {
        if (filters?.service && filters.service !== entityInfo.microservice) continue;

        const entity = await readEntityFile(entityInfo.microservice, entityInfo.name);
        if (!entity) continue;

        // Stereotype filter
        if (filters?.stereotype && entity.stereotype !== filters.stereotype) continue;

        // hasMetadata filter
        if (filters?.hasMetadata) {
          const hasIt = entity.metadata?.some(m => m.name === filters.hasMetadata) ||
            entity.attributes.some(a => a.metadata?.some(m => m.name === filters.hasMetadata));
          if (!hasIt) continue;
        }

        // Search entity name/description
        if (!filters?.type || filters.type === 'entity') {
          const entityNameMatch = this.calculateMatchScore(entity.name, searchTerms);
          const entityDescMatch = this.calculateMatchScore(entity.description || '', searchTerms);
          const stereotypeMatch = entity.stereotype ? this.calculateMatchScore(entity.stereotype, searchTerms) : 0;

          if (entityNameMatch > 0 || entityDescMatch > 0 || stereotypeMatch > 0) {
            results.push({
              type: 'entity', service: entityInfo.microservice, entityName: entity.name,
              name: entity.name, description: entity.description || '',
              path: `${entityInfo.microservice}/${entity.name}`,
              score: Math.max(entityNameMatch * 2, entityDescMatch, stereotypeMatch * 1.5),
              matchContext: stereotypeMatch > 0 ? `stereotype: ${entity.stereotype}` : undefined,
            });
          }
        }

        // Search attributes
        if (!filters?.type || filters.type === 'attribute') {
          for (const attr of entity.attributes) {
            const attrNameMatch = this.calculateMatchScore(attr.name, searchTerms);
            const attrDescMatch = this.calculateMatchScore(attr.description, searchTerms);

            if (attrNameMatch > 0 || attrDescMatch > 0) {
              results.push({
                type: 'attribute', service: entityInfo.microservice, entityName: entity.name,
                attributeName: attr.name, name: attr.name, description: attr.description,
                path: `${entityInfo.microservice}/${entity.name}/${attr.name}`,
                score: Math.max(attrNameMatch * 1.5, attrDescMatch),
              });
            }
          }
        }

        // Search entity metadata
        if (!filters?.type || filters.type === 'metadata') {
          for (const m of entity.metadata || []) {
            const nameMatch = this.calculateMatchScore(m.name, searchTerms);
            const valueMatch = this.calculateMatchScore(String(m.value), searchTerms);

            if (nameMatch > 0 || valueMatch > 0) {
              results.push({
                type: 'metadata', service: entityInfo.microservice, entityName: entity.name,
                name: m.name, description: `${m.name} = ${m.value}`,
                path: `${entityInfo.microservice}/${entity.name}`,
                score: Math.max(nameMatch * 1.5, valueMatch),
                matchContext: `on entity ${entity.name}`,
              });
            }
          }

          // Search attribute metadata
          for (const attr of entity.attributes) {
            for (const m of attr.metadata || []) {
              const nameMatch = this.calculateMatchScore(m.name, searchTerms);
              const valueMatch = this.calculateMatchScore(String(m.value), searchTerms);

              if (nameMatch > 0 || valueMatch > 0) {
                results.push({
                  type: 'metadata', service: entityInfo.microservice, entityName: entity.name,
                  attributeName: attr.name, name: m.name, description: `${m.name} = ${m.value}`,
                  path: `${entityInfo.microservice}/${entity.name}/${attr.name}`,
                  score: Math.max(nameMatch * 1.5, valueMatch),
                  matchContext: `on ${entity.name}.${attr.name}`,
                });
              }
            }
          }
        }
      }

      // Search relationships
      if (!filters?.type || filters.type === 'relationship') {
        const allRels = await getAllRelationships();
        // Build entity name map for display
        const entityNameMap = new Map<string, { name: string; service: string }>();
        for (const entityInfo of allEntities) {
          const e = await readEntityFile(entityInfo.microservice, entityInfo.name);
          if (e) entityNameMap.set(e.uuid, { name: e.name, service: entityInfo.microservice });
        }

        for (const { packageName, relationships } of allRels) {
          if (filters?.service && filters.service !== packageName) continue;
          for (const rel of relationships) {
            const descMatch = this.calculateMatchScore(rel.description || '', searchTerms);
            const srcInfo = entityNameMap.get(rel.source.entity);
            const tgtInfo = entityNameMap.get(rel.target.entity);
            const srcMatch = srcInfo ? this.calculateMatchScore(srcInfo.name, searchTerms) : 0;
            const tgtMatch = tgtInfo ? this.calculateMatchScore(tgtInfo.name, searchTerms) : 0;

            if (descMatch > 0 || srcMatch > 0 || tgtMatch > 0) {
              results.push({
                type: 'relationship', service: packageName, entityName: srcInfo?.name || rel.source.entity,
                name: rel.description || rel.uuid,
                description: `${srcInfo?.name || '?'} → ${tgtInfo?.name || '?'}`,
                path: `${packageName}/relationships/${rel.uuid}`,
                score: Math.max(descMatch, srcMatch, tgtMatch),
              });
            }
          }
        }
      }

      return results.sort((a, b) => b.score - a.score);
    } catch (error) {
      logger.error(`Error searching entities: ${error}`);
      return [];
    }
  }

  private calculateMatchScore(text: string, searchTerms: string[]): number {
    if (!text) return 0;

    const normalizedText = text.toLowerCase();
    let score = 0;

    for (const term of searchTerms) {
      if (normalizedText.includes(term)) {
        score += 1;
        const regex = new RegExp(`\\b${term}\\b`, 'i');
        if (regex.test(normalizedText)) {
          score += 0.5;
        }
      }
    }

    return score;
  }

  // --- Impact Analysis ---

  async getImpactAnalysis(entityUuid: string): Promise<ImpactAnalysis> {
    const impact: ImpactAnalysis = { relationships: [], perspectives: [], diagrams: [] };

    try {
      // Find relationships referencing this entity
      const allRels = await getAllRelationships();
      const allEntities = await listAllEntities();
      const entityNameMap = new Map<string, string>();
      for (const info of allEntities) {
        const e = await readEntityFile(info.microservice, info.name);
        if (e) entityNameMap.set(e.uuid, e.name);
      }

      for (const { packageName, relationships } of allRels) {
        for (const rel of relationships) {
          if (rel.source.entity === entityUuid || rel.target.entity === entityUuid) {
            impact.relationships.push({
              uuid: rel.uuid,
              description: rel.description || '',
              service: packageName,
              sourceEntity: entityNameMap.get(rel.source.entity) || rel.source.entity,
              targetEntity: entityNameMap.get(rel.target.entity) || rel.target.entity,
            });
          }
        }
      }

      // Find perspectives containing this entity
      const { listPerspectives } = await import('../utils/fileOperations.js');
      const perspectives = await listPerspectives();
      const { perspectiveService } = await import('./perspectiveService.js');
      for (const p of perspectives) {
        const resolved = await perspectiveService.resolve(p.uuid);
        if (resolved?.resolvedNodes.some(n => n.entityUuid === entityUuid)) {
          const paths = resolved.resolvedNodes.filter(n => n.entityUuid === entityUuid).map(n => n.path);
          impact.perspectives.push({ uuid: p.uuid, name: p.name, path: paths[0] });
        }
      }

      // Find diagrams referencing this entity
      const { diagramService } = await import('./diagramService.js');
      const layouts = await diagramService.listDiagramLayouts();
      for (const layout of layouts) {
        if (layout.entities && layout.entities[entityUuid]) {
          impact.diagrams.push({ id: layout.id, name: layout.name });
        }
      }
    } catch (error) {
      logger.error(`Error getting impact analysis: ${error}`);
    }

    return impact;
  }

  /**
   * Get graph data for visualization - reads relationships from package-level file
   */
  async getGraphData(service: string): Promise<GraphData> {
    logger.info(`Generating graph data for service: ${service}`);

    try {
      const graphData: GraphData = {
        nodes: [],
        edges: []
      };

      const entities = await this.getServiceEntities(service);
      const entityUuidToName = new Map<string, string>();

      for (const entity of entities) {
        entityUuidToName.set(entity.uuid, entity.name);
        graphData.nodes.push({
          id: entity.uuid,
          label: entity.name,
          type: 'entity',
          service
        });
      }

      // Read relationships from package-level file
      const packagePath = getPackagePath(service);
      const relationships = await readRelationshipsFile(packagePath);

      for (const rel of relationships) {
        const sourceName = entityUuidToName.get(rel.source.entity) || rel.source.entity;
        const targetName = entityUuidToName.get(rel.target.entity) || rel.target.entity;

        graphData.edges.push({
          id: rel.uuid,
          source: rel.source.entity,
          target: rel.target.entity,
          label: rel.target.name || `${sourceName} -> ${targetName}`,
          sourceCardinality: rel.source.cardinality,
          targetCardinality: rel.target.cardinality
        });
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
