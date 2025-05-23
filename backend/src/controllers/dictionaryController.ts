import { Request, Response } from 'express';
import { dictionaryService } from '../services/dictionaryService';
import { entityService } from '../services/entityService';
import { logger } from '../utils/logger';
import { Entity } from '../models/EntitySchema';
import { Dictionary } from '../models/Dictionary';

// Dictionary controller methods
export const getDictionaries = async (req: Request, res: Response) => {
  try {
    const dictionaries = await dictionaryService.getAllDictionaries();
    res.json({
      message: 'Success',
      data: dictionaries
    });
  } catch (error) {
    logger.error('Error fetching dictionaries', error);
    res.status(500).json({ message: 'Error fetching dictionaries', error });
  }
};

export const getDictionaryById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const dictionary = await dictionaryService.getDictionaryById(id);
    
    if (!dictionary) {
      return res.status(404).json({ message: 'Dictionary not found' });
    }
    
    res.json({
      message: 'Success',
      data: dictionary
    });
  } catch (error) {
    logger.error(`Error fetching dictionary with ID: ${req.params.id}`, error);
    res.status(500).json({ message: 'Error fetching dictionary', error });
  }
};

/**
 * Get all entries for a dictionary (entities in a microservice)
 * @param req Express request
 * @param res Express response
 */
export const getDictionaryEntries = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const entries = await dictionaryService.getDictionaryEntries(id);
    
    res.json({
      message: 'Success',
      data: entries
    });
  } catch (error) {
    logger.error(`Error in getDictionaryEntries: ${error}`);
    res.status(500).json({ message: 'Error fetching dictionary entries', error });
  }
};

/**
 * Get entity details as dictionary entries
 * @param req Express request
 * @param res Express response
 */
export const getEntityAttributes = async (req: Request, res: Response) => {
  try {
    const { microservice, entityName } = req.params;
    const attributes = await dictionaryService.getEntityAttributes(microservice, entityName);
    
    if (attributes.length === 0) {
      return res.status(404).json({ message: 'Entity not found' });
    }
    
    res.json({
      message: 'Success',
      data: attributes
    });
  } catch (error) {
    logger.error(`Error in getEntityAttributes: ${error}`);
    res.status(500).json({ message: 'Error fetching entity attributes', error });
  }
};

/**
 * Create or update an entity
 * @param req Express request
 * @param res Express response
 */
export const saveEntity = async (req: Request, res: Response) => {
  try {
    const entity = req.body as Entity;
    
    if (!entity) {
      return res.status(400).json({ message: 'Invalid entity data' });
    }
    
    const result = await entityService.saveEntity(entity);
    
    if (!result.success) {
      return res.status(400).json({ 
        message: 'Failed to save entity', 
        errors: result.errors 
      });
    }
    
    res.status(200).json({ 
      message: 'Entity saved successfully',
      data: entity 
    });
  } catch (error) {
    logger.error(`Error in saveEntity: ${error}`);
    res.status(500).json({ message: 'Error saving entity', error });
  }
};

/**
 * Get related entities
 * @param req Express request
 * @param res Express response
 */
export const getRelatedEntities = async (req: Request, res: Response) => {
  try {
    const { microservice, entityName } = req.params;
    const relatedEntities = await entityService.getRelatedEntities(microservice, entityName);
    
    res.json({
      message: 'Success',
      data: relatedEntities
    });
  } catch (error) {
    logger.error(`Error in getRelatedEntities: ${error}`);
    res.status(500).json({ message: 'Error fetching related entities', error });
  }
};

/**
 * Create a new dictionary
 * @param req Express request
 * @param res Express response
 */
export const createDictionary = async (req: Request, res: Response) => {
  try {
    const dictionaryData = req.body as Dictionary;
    
    if (!dictionaryData || !dictionaryData.name) {
      return res.status(400).json({ message: 'Dictionary name is required' });
    }
    
    const result = await dictionaryService.createDictionary(dictionaryData);
    
    // Handle error cases
    if (result && 'error' in result) {
      if (result.code === 'DUPLICATE_NAME') {
        logger.warn(`Attempted to create dictionary with duplicate name: ${dictionaryData.name}`);
        return res.status(409).json({
          message: result.error,
          code: result.code
        });
      } else if (result.code === 'MISSING_NAME') {
        return res.status(400).json({
          message: result.error,
          code: result.code
        });
      } else {
        return res.status(400).json({
          message: result.error,
          code: result.code
        });
      }
    }
    
    if (!result) {
      return res.status(500).json({ message: 'Failed to create dictionary due to an unknown error' });
    }
    
    res.status(201).json({
      message: 'Dictionary created successfully',
      data: result
    });
  } catch (error) {
    logger.error(`Error in createDictionary: ${error}`);
    res.status(500).json({ message: 'Error creating dictionary', error });
  }
};