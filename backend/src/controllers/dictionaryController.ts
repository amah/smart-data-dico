import { Request, Response } from 'express';

import { Dictionary } from '../models/Dictionary.js';
import { Entity } from '../models/EntitySchema.js';
import { dictionaryService } from '../services/dictionaryService.js';
import { entityService } from '../services/entityService.js';
import { logger } from '../utils/logger.js';

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

export const saveEntity = async (req: Request, res: Response) => {
  try {
    const entity = req.body as Entity;
    const packageName = req.body.packageName || req.query.packageName as string;

    if (!entity) {
      return res.status(400).json({ message: 'Invalid entity data' });
    }

    if (!packageName) {
      return res.status(400).json({ message: 'packageName is required' });
    }

    const result = await entityService.saveEntity(entity, packageName);

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

export const createDictionary = async (req: Request, res: Response) => {
  try {
    const dictionaryData = req.body as Dictionary;

    if (!dictionaryData || !dictionaryData.name) {
      return res.status(400).json({ message: 'Dictionary name is required' });
    }

    const result = await dictionaryService.createDictionary(dictionaryData);

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

export const getPackageHierarchy = async (req: Request, res: Response) => {
  try {
    const { rootPackage } = req.params;
    const hierarchy = await dictionaryService.getPackageHierarchy(rootPackage);
    res.json({ message: 'Success', data: hierarchy });
  } catch (error) {
    logger.error('Error fetching package hierarchy', error);
    res.status(500).json({ message: 'Error fetching package hierarchy', error });
  }
};

export const getTabularData = async (req: Request, res: Response) => {
  try {
    const { rootPackage } = req.params;
    const tabularData = await dictionaryService.getTabularData(rootPackage);
    res.json({ message: 'Success', data: tabularData });
  } catch (error) {
    logger.error('Error fetching tabular data', error);
    res.status(500).json({ message: 'Error fetching tabular data', error });
  }
};

export const getPackageByPath = async (req: Request, res: Response) => {
  try {
    const { rootPackage } = req.params;
    const packagePath = req.params[0]?.split('/').filter(Boolean) || [];
    const pkg = await dictionaryService.getPackageByPath(rootPackage, packagePath);
    if (!pkg) {
      return res.status(404).json({ message: 'Package not found' });
    }
    res.json({ message: 'Success', data: pkg });
  } catch (error) {
    logger.error('Error fetching package by path', error);
    res.status(500).json({ message: 'Error fetching package by path', error });
  }
}

export const listAllPackagesAndEntities = async (req: Request, res: Response) => {
  try {
    const result = await dictionaryService.listAllPackagesAndEntities();
    res.json({ message: 'Success', data: result });
  } catch (error) {
    logger.error('Error listing all packages and entities', error);
    res.status(500).json({ message: 'Error listing all packages and entities', error });
  }
};

export const createPackageAtPath = async (req: Request, res: Response) => {
  try {
    const { rootPackage } = req.params;
    const packagePath = req.params[0]?.split('/').filter(Boolean) || [];
    const packageData = req.body;
    const result = await dictionaryService.createPackageAtPath(rootPackage, packagePath, packageData);
    if (!result.success) {
      return res.status(400).json({ message: 'Failed to create package', errors: result.errors });
    }
    res.status(201).json({ message: 'Package created successfully', data: result.package });
  } catch (error) {
    logger.error('Error creating package', error);
    res.status(500).json({ message: 'Error creating package', error });
  }
};

export const updatePackageAtPath = async (req: Request, res: Response) => {
  try {
    const { rootPackage } = req.params;
    const packagePath = req.params[0]?.split('/').filter(Boolean) || [];
    const packageData = req.body;
    const result = await dictionaryService.updatePackageAtPath(rootPackage, packagePath, packageData);
    if (!result.success) {
      return res.status(400).json({ message: 'Failed to update package', errors: result.errors });
    }
    res.status(200).json({ message: 'Package updated successfully', data: result.package });
  } catch (error) {
    logger.error('Error updating package', error);
    res.status(500).json({ message: 'Error updating package', error });
  }
};

export const deletePackageAtPath = async (req: Request, res: Response) => {
  try {
    const { rootPackage } = req.params;
    const packagePath = req.params[0]?.split('/').filter(Boolean) || [];
    const result = await dictionaryService.deletePackageAtPath(rootPackage, packagePath);
    if (!result.success) {
      return res.status(400).json({ message: 'Failed to delete package', errors: result.errors });
    }
    res.status(200).json({ message: 'Package deleted successfully' });
  } catch (error) {
    logger.error('Error deleting package', error);
    res.status(500).json({ message: 'Error deleting package', error });
  }
};

export const getFlatEntitiesAndAttributes = async (req: Request, res: Response) => {
  try {
    const { name, type, package: pkg } = req.query;
    const filters: any = {};
    if (name) filters.name = String(name);
    if (type) filters.type = String(type);
    if (pkg) filters.package = String(pkg);
    const result = await dictionaryService.getFlatEntitiesAndAttributes(filters);
    res.json({ message: 'Success', data: result });
  } catch (error) {
    logger.error('Error getting flat entities/attributes', error);
    res.status(500).json({ message: 'Error getting flat entities/attributes', error });
  }
};

export const getEntityHierarchy = async (req: Request, res: Response) => {
  try {
    const { microservice, entityName } = req.params;
    const result = await dictionaryService.getEntityHierarchy(microservice, entityName);
    if (!result) {
      return res.status(404).json({ message: 'Entity not found' });
    }
    res.json({ message: 'Success', data: result });
  } catch (error) {
    logger.error('Error getting entity hierarchy', error);
    res.status(500).json({ message: 'Error getting entity hierarchy', error });
  }
};
