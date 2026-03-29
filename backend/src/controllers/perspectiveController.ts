import { Request, Response } from 'express';
import { perspectiveService } from '../services/perspectiveService.js';
import { logger } from '../utils/logger.js';

export const getAllPerspectives = async (_req: Request, res: Response) => {
  try {
    const perspectives = await perspectiveService.getAll();
    res.json({ message: 'Success', data: perspectives });
  } catch (error) {
    logger.error('Error fetching perspectives', error);
    res.status(500).json({ message: 'Error fetching perspectives', error });
  }
};

export const getPerspective = async (req: Request, res: Response) => {
  try {
    const perspective = await perspectiveService.getById(req.params.id);
    if (!perspective) return res.status(404).json({ message: 'Perspective not found' });
    res.json({ message: 'Success', data: perspective });
  } catch (error) {
    logger.error('Error fetching perspective', error);
    res.status(500).json({ message: 'Error fetching perspective', error });
  }
};

export const createPerspective = async (req: Request, res: Response) => {
  try {
    const result = await perspectiveService.create(req.body);
    if (!result.success) return res.status(400).json({ message: 'Failed to create perspective', errors: result.errors });
    res.status(201).json({ message: 'Perspective created successfully', data: result.perspective });
  } catch (error) {
    logger.error('Error creating perspective', error);
    res.status(500).json({ message: 'Error creating perspective', error });
  }
};

export const updatePerspective = async (req: Request, res: Response) => {
  try {
    const result = await perspectiveService.update(req.params.id, req.body);
    if (!result.success) return res.status(400).json({ message: 'Failed to update perspective', errors: result.errors });
    res.json({ message: 'Perspective updated successfully', data: result.perspective });
  } catch (error) {
    logger.error('Error updating perspective', error);
    res.status(500).json({ message: 'Error updating perspective', error });
  }
};

export const deletePerspective = async (req: Request, res: Response) => {
  try {
    const result = await perspectiveService.delete(req.params.id);
    if (!result.success) return res.status(400).json({ message: 'Failed to delete perspective', errors: result.errors });
    res.json({ message: 'Perspective deleted successfully' });
  } catch (error) {
    logger.error('Error deleting perspective', error);
    res.status(500).json({ message: 'Error deleting perspective', error });
  }
};

export const resolvePerspective = async (req: Request, res: Response) => {
  try {
    const resolved = await perspectiveService.resolve(req.params.id);
    if (!resolved) return res.status(404).json({ message: 'Perspective not found' });
    res.json({ message: 'Success', data: resolved });
  } catch (error) {
    logger.error('Error resolving perspective', error);
    res.status(500).json({ message: 'Error resolving perspective', error });
  }
};

export const getPerspectiveGraph = async (req: Request, res: Response) => {
  try {
    const graph = await perspectiveService.getGraphData(req.params.id);
    if (!graph) return res.status(404).json({ message: 'Perspective not found' });
    res.json({ message: 'Success', data: graph });
  } catch (error) {
    logger.error('Error getting perspective graph', error);
    res.status(500).json({ message: 'Error getting perspective graph', error });
  }
};

export const upsertPerspectiveNode = async (req: Request, res: Response) => {
  try {
    const result = await perspectiveService.upsertNode(req.params.id, req.body);
    if (!result.success) return res.status(400).json({ message: 'Failed to update node', errors: result.errors });
    res.json({ message: 'Node updated successfully' });
  } catch (error) {
    logger.error('Error updating perspective node', error);
    res.status(500).json({ message: 'Error updating perspective node', error });
  }
};
