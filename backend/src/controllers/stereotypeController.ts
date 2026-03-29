import { Request, Response } from 'express';
import { stereotypeService } from '../services/stereotypeService.js';
import { StereotypeTarget } from '../models/EntitySchema.js';
import { logger } from '../utils/logger.js';

export const getAllStereotypes = async (req: Request, res: Response) => {
  try {
    const appliesTo = req.query.appliesTo as StereotypeTarget | undefined;
    const stereotypes = await stereotypeService.getAllStereotypes(appliesTo);
    res.json({ message: 'Success', data: stereotypes });
  } catch (error) {
    logger.error('Error fetching stereotypes', error);
    res.status(500).json({ message: 'Error fetching stereotypes', error });
  }
};

export const getStereotype = async (req: Request, res: Response) => {
  try {
    const stereotype = await stereotypeService.getStereotype(req.params.id);
    if (!stereotype) return res.status(404).json({ message: 'Stereotype not found' });
    res.json({ message: 'Success', data: stereotype });
  } catch (error) {
    logger.error('Error fetching stereotype', error);
    res.status(500).json({ message: 'Error fetching stereotype', error });
  }
};

export const createStereotype = async (req: Request, res: Response) => {
  try {
    const result = await stereotypeService.createStereotype(req.body);
    if (!result.success) return res.status(400).json({ message: 'Failed to create stereotype', errors: result.errors });
    res.status(201).json({ message: 'Stereotype created successfully', data: result.stereotype });
  } catch (error) {
    logger.error('Error creating stereotype', error);
    res.status(500).json({ message: 'Error creating stereotype', error });
  }
};

export const updateStereotype = async (req: Request, res: Response) => {
  try {
    const result = await stereotypeService.updateStereotype(req.params.id, req.body);
    if (!result.success) return res.status(400).json({ message: 'Failed to update stereotype', errors: result.errors });
    res.json({ message: 'Stereotype updated successfully', data: result.stereotype });
  } catch (error) {
    logger.error('Error updating stereotype', error);
    res.status(500).json({ message: 'Error updating stereotype', error });
  }
};

export const deleteStereotype = async (req: Request, res: Response) => {
  try {
    const result = await stereotypeService.deleteStereotype(req.params.id);
    if (!result.success) return res.status(400).json({ message: 'Failed to delete stereotype', errors: result.errors });
    res.json({ message: 'Stereotype deleted successfully' });
  } catch (error) {
    logger.error('Error deleting stereotype', error);
    res.status(500).json({ message: 'Error deleting stereotype', error });
  }
};
