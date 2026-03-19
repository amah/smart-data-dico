import { Request, Response } from 'express';
import { serviceService } from '../services/serviceService.js';
import { logger } from '../utils/logger.js';
import { Entity, Relationship } from '../models/EntitySchema.js';

/**
 * @swagger
 * /api/services:
 *   get:
 *     summary: Get all services (packages)
 *     tags: [Services]
 *     responses:
 *       200:
 *         description: A list of services
 */
export const getAllServices = async (req: Request, res: Response) => {
  try {
    const services = await serviceService.getAllServices();
    res.json({
      message: 'Success',
      data: services
    });
  } catch (error) {
    logger.error('Error fetching services', error);
    res.status(500).json({ message: 'Error fetching services', error });
  }
};

/**
 * @swagger
 * /api/services/{service}/entities:
 *   get:
 *     summary: Get all entities for a specific service
 *     tags: [Entities]
 */
export const getServiceEntities = async (req: Request, res: Response) => {
  try {
    const startTime = process.hrtime();
    const { service } = req.params;

    logger.info(`Starting to fetch entities for service: ${service}`);
    const entities = await serviceService.getServiceEntities(service);

    const endTime = process.hrtime(startTime);
    const executionTimeMs = Number((endTime[0] * 1e3 + endTime[1] / 1e6).toFixed(2));

    logger.info(`Fetched ${entities.length} entities for service: ${service} in ${executionTimeMs}ms`);

    res.json({
      message: 'Success',
      data: entities,
      meta: {
        count: entities.length,
        executionTimeMs
      }
    });
  } catch (error) {
    logger.error(`Error fetching entities for service: ${req.params.service}`, error);
    res.status(500).json({ message: 'Error fetching service entities', error });
  }
};

/**
 * @swagger
 * /api/services/{service}/entities/{entity}:
 *   get:
 *     summary: Get entity schema by service and entity name
 *     tags: [Entities]
 */
export const getEntitySchema = async (req: Request, res: Response) => {
  try {
    const { service, entity } = req.params;
    const entitySchema = await serviceService.getEntitySchema(service, entity);

    if (!entitySchema) {
      return res.status(404).json({ message: 'Entity not found' });
    }

    res.json({
      message: 'Success',
      data: entitySchema
    });
  } catch (error) {
    logger.error(`Error fetching entity schema: ${error}`);
    res.status(500).json({ message: 'Error fetching entity schema', error });
  }
};

/**
 * @swagger
 * /api/services/{service}/entities:
 *   post:
 *     summary: Create a new entity
 *     tags: [Entities]
 */
export const createEntity = async (req: Request, res: Response) => {
  try {
    const { service } = req.params;
    const entityData = req.body as Entity;

    const result = await serviceService.createEntity(service, entityData);

    if (!result.success) {
      return res.status(400).json({
        message: 'Failed to create entity',
        errors: result.errors
      });
    }

    res.status(201).json({
      message: 'Entity created successfully',
      data: entityData
    });
  } catch (error) {
    logger.error(`Error creating entity: ${error}`);
    res.status(500).json({ message: 'Error creating entity', error });
  }
};

/**
 * @swagger
 * /api/services/{service}/entities/{entity}:
 *   put:
 *     summary: Update an existing entity
 *     tags: [Entities]
 */
export const updateEntity = async (req: Request, res: Response) => {
  try {
    const { service, entity } = req.params;
    const entityData = req.body as Entity;

    if (entityData.name !== entity) {
      return res.status(400).json({
        message: 'Entity name mismatch',
        error: `Entity name (${entityData.name}) does not match the URL (${entity})`
      });
    }

    const existingEntity = await serviceService.getEntitySchema(service, entity);
    if (!existingEntity) {
      return res.status(404).json({ message: 'Entity not found' });
    }

    const result = await serviceService.updateEntity(service, entityData);

    if (!result.success) {
      return res.status(400).json({
        message: 'Failed to update entity',
        errors: result.errors
      });
    }

    res.json({
      message: 'Entity updated successfully',
      data: entityData
    });
  } catch (error) {
    logger.error(`Error updating entity: ${error}`);
    res.status(500).json({ message: 'Error updating entity', error });
  }
};

/**
 * @swagger
 * /api/services/{service}/entities/{entity}:
 *   delete:
 *     summary: Delete an entity
 *     tags: [Entities]
 */
export const deleteEntity = async (req: Request, res: Response) => {
  try {
    const { service, entity } = req.params;

    const existingEntity = await serviceService.getEntitySchema(service, entity);
    if (!existingEntity) {
      return res.status(404).json({ message: 'Entity not found' });
    }

    const result = await serviceService.deleteEntity(service, entity);

    if (!result.success) {
      return res.status(400).json({
        message: 'Failed to delete entity',
        errors: result.errors
      });
    }

    res.json({
      message: 'Entity deleted successfully'
    });
  } catch (error) {
    logger.error(`Error deleting entity: ${error}`);
    res.status(500).json({ message: 'Error deleting entity', error });
  }
};

/**
 * @swagger
 * /api/search:
 *   get:
 *     summary: Search for entities and attributes
 *     tags: [Search]
 */
export const searchEntities = async (req: Request, res: Response) => {
  try {
    const { q } = req.query;

    if (!q || typeof q !== 'string') {
      return res.status(400).json({ message: 'Search query is required' });
    }

    const results = await serviceService.searchEntities(q);

    res.json({
      message: 'Success',
      data: results
    });
  } catch (error) {
    logger.error(`Error searching entities: ${error}`);
    res.status(500).json({ message: 'Error searching entities', error });
  }
};

/**
 * @swagger
 * /api/graph/{service}:
 *   get:
 *     summary: Get graph data for visualization
 *     tags: [Visualization]
 */
export const getGraphData = async (req: Request, res: Response) => {
  try {
    const { service } = req.params;
    const graphData = await serviceService.getGraphData(service);

    res.json({
      message: 'Success',
      data: graphData
    });
  } catch (error) {
    logger.error(`Error generating graph data: ${error}`);
    res.status(500).json({ message: 'Error generating graph data', error });
  }
};

// --- Relationship CRUD controllers ---

export const getPackageRelationships = async (req: Request, res: Response) => {
  try {
    const { packageName } = req.params;
    const relationships = await serviceService.getPackageRelationships(packageName);
    res.json({ message: 'Success', data: relationships });
  } catch (error) {
    logger.error(`Error fetching relationships: ${error}`);
    res.status(500).json({ message: 'Error fetching relationships', error });
  }
};

export const createRelationship = async (req: Request, res: Response) => {
  try {
    const { packageName } = req.params;
    const relationship = req.body as Relationship;

    const result = await serviceService.createRelationship(packageName, relationship);

    if (!result.success) {
      return res.status(400).json({ message: 'Failed to create relationship', errors: result.errors });
    }

    res.status(201).json({ message: 'Relationship created successfully', data: result.relationship });
  } catch (error) {
    logger.error(`Error creating relationship: ${error}`);
    res.status(500).json({ message: 'Error creating relationship', error });
  }
};

export const updateRelationship = async (req: Request, res: Response) => {
  try {
    const { packageName, uuid } = req.params;
    const relationship = req.body as Relationship;

    const result = await serviceService.updateRelationship(packageName, uuid, relationship);

    if (!result.success) {
      return res.status(400).json({ message: 'Failed to update relationship', errors: result.errors });
    }

    res.json({ message: 'Relationship updated successfully' });
  } catch (error) {
    logger.error(`Error updating relationship: ${error}`);
    res.status(500).json({ message: 'Error updating relationship', error });
  }
};

export const deleteRelationship = async (req: Request, res: Response) => {
  try {
    const { packageName, uuid } = req.params;

    const result = await serviceService.deleteRelationship(packageName, uuid);

    if (!result.success) {
      return res.status(400).json({ message: 'Failed to delete relationship', errors: result.errors });
    }

    res.json({ message: 'Relationship deleted successfully' });
  } catch (error) {
    logger.error(`Error deleting relationship: ${error}`);
    res.status(500).json({ message: 'Error deleting relationship', error });
  }
};
