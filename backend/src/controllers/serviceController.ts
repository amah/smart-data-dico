import { Request, Response } from 'express';
import { serviceService } from '../services/serviceService';
import { logger } from '../utils/logger';
import { Entity } from '../models/EntitySchema';

/**
 * @swagger
 * /api/services:
 *   get:
 *     summary: Get all services (microservices)
 *     description: Returns a list of all available microservices
 *     tags: [Services]
 *     responses:
 *       200:
 *         description: A list of services
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Success
 *                 data:
 *                   type: array
 *                   items:
 *                     type: string
 *                   example: ["order-service", "product-service", "user-service"]
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Error fetching services
 *                 error:
 *                   type: string
 *
 * @param req Express request
 * @param res Express response
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
 *     description: Returns a list of all entities in a microservice
 *     tags: [Entities]
 *     parameters:
 *       - in: path
 *         name: service
 *         required: true
 *         schema:
 *           type: string
 *         description: Service name
 *     responses:
 *       200:
 *         description: A list of entities
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Success
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Entity'
 *       500:
 *         description: Server error
 *
 * @param req Express request
 * @param res Express response
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
 *     description: Returns the schema for a specific entity
 *     tags: [Entities]
 *     parameters:
 *       - in: path
 *         name: service
 *         required: true
 *         schema:
 *           type: string
 *         description: Service name
 *       - in: path
 *         name: entity
 *         required: true
 *         schema:
 *           type: string
 *         description: Entity name
 *     responses:
 *       200:
 *         description: Entity schema
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Success
 *                 data:
 *                   $ref: '#/components/schemas/Entity'
 *       404:
 *         description: Entity not found
 *       500:
 *         description: Server error
 *
 * @param req Express request
 * @param res Express response
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
 *     description: Creates a new entity in the specified service
 *     tags: [Entities]
 *     security:
 *       - basicAuth: []
 *     parameters:
 *       - in: path
 *         name: service
 *         required: true
 *         schema:
 *           type: string
 *         description: Service name
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/Entity'
 *     responses:
 *       201:
 *         description: Entity created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Entity created successfully
 *                 data:
 *                   $ref: '#/components/schemas/Entity'
 *       400:
 *         description: Invalid entity data or service mismatch
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       500:
 *         description: Server error
 *
 * @param req Express request
 * @param res Express response
 */
export const createEntity = async (req: Request, res: Response) => {
  try {
    const { service } = req.params;
    const entityData = req.body as Entity;
    
    // Ensure the service in the path matches the entity's microservice
    if (entityData.microservice !== service) {
      return res.status(400).json({ 
        message: 'Service mismatch', 
        error: `Entity microservice (${entityData.microservice}) does not match the service in the URL (${service})` 
      });
    }
    
    const result = await serviceService.createEntity(entityData);
    
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
 *     description: Updates an existing entity in the specified service
 *     tags: [Entities]
 *     security:
 *       - basicAuth: []
 *     parameters:
 *       - in: path
 *         name: service
 *         required: true
 *         schema:
 *           type: string
 *         description: Service name
 *       - in: path
 *         name: entity
 *         required: true
 *         schema:
 *           type: string
 *         description: Entity name
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/Entity'
 *     responses:
 *       200:
 *         description: Entity updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Entity updated successfully
 *                 data:
 *                   $ref: '#/components/schemas/Entity'
 *       400:
 *         description: Invalid entity data or service/entity mismatch
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Entity not found
 *       500:
 *         description: Server error
 *
 * @param req Express request
 * @param res Express response
 */
export const updateEntity = async (req: Request, res: Response) => {
  try {
    const { service, entity } = req.params;
    const entityData = req.body as Entity;
    
    // Ensure the service and entity in the path match the entity's data
    if (entityData.microservice !== service || entityData.name !== entity) {
      return res.status(400).json({ 
        message: 'Service or entity name mismatch', 
        error: `Entity data (${entityData.microservice}.${entityData.name}) does not match the URL (${service}.${entity})` 
      });
    }
    
    // Check if entity exists
    const existingEntity = await serviceService.getEntitySchema(service, entity);
    if (!existingEntity) {
      return res.status(404).json({ message: 'Entity not found' });
    }
    
    const result = await serviceService.updateEntity(entityData);
    
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
 *     description: Deletes an entity from the specified service
 *     tags: [Entities]
 *     security:
 *       - basicAuth: []
 *     parameters:
 *       - in: path
 *         name: service
 *         required: true
 *         schema:
 *           type: string
 *         description: Service name
 *       - in: path
 *         name: entity
 *         required: true
 *         schema:
 *           type: string
 *         description: Entity name
 *     responses:
 *       200:
 *         description: Entity deleted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Entity deleted successfully
 *       400:
 *         description: Failed to delete entity
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Entity not found
 *       500:
 *         description: Server error
 *
 * @param req Express request
 * @param res Express response
 */
export const deleteEntity = async (req: Request, res: Response) => {
  try {
    const { service, entity } = req.params;
    
    // Check if entity exists
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
 *     description: Searches for entities and attributes by keyword
 *     tags: [Search]
 *     parameters:
 *       - in: query
 *         name: q
 *         required: true
 *         schema:
 *           type: string
 *         description: Search query
 *     responses:
 *       200:
 *         description: Search results
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Success
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/SearchResult'
 *       400:
 *         description: Search query is required
 *       500:
 *         description: Server error
 *
 * @param req Express request
 * @param res Express response
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
 *     description: Returns graph data for visualizing entity relationships in a service
 *     tags: [Visualization]
 *     parameters:
 *       - in: path
 *         name: service
 *         required: true
 *         schema:
 *           type: string
 *         description: Service name
 *     responses:
 *       200:
 *         description: Graph data
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Success
 *                 data:
 *                   $ref: '#/components/schemas/GraphData'
 *       500:
 *         description: Server error
 *
 * @param req Express request
 * @param res Express response
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