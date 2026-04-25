import { Request, Response } from 'express';
import { caseService } from '../services/caseService.js';
import { logger } from '../utils/logger.js';

export const getAllCases = async (_req: Request, res: Response) => {
  try {
    const cases = await caseService.getAll();
    res.json({ message: 'Success', data: cases });
  } catch (error) {
    logger.error('Error fetching cases', error);
    res.status(500).json({ message: 'Error fetching cases', error });
  }
};

export const getCase = async (req: Request, res: Response) => {
  try {
    const c = await caseService.getById(req.params.id);
    if (!c) return res.status(404).json({ message: 'Case not found' });
    res.json({ message: 'Success', data: c });
  } catch (error) {
    logger.error('Error fetching case', error);
    res.status(500).json({ message: 'Error fetching case', error });
  }
};

export const createCase = async (req: Request, res: Response) => {
  try {
    const result = await caseService.create(req.body);
    if (!result.success) return res.status(400).json({ message: 'Failed to create case', errors: result.errors });
    res.status(201).json({ message: 'Case created successfully', data: result.case });
  } catch (error) {
    logger.error('Error creating case', error);
    res.status(500).json({ message: 'Error creating case', error });
  }
};

export const updateCase = async (req: Request, res: Response) => {
  try {
    const result = await caseService.update(req.params.id, req.body);
    if (!result.success) return res.status(400).json({ message: 'Failed to update case', errors: result.errors });
    res.json({ message: 'Case updated successfully', data: result.case });
  } catch (error) {
    logger.error('Error updating case', error);
    res.status(500).json({ message: 'Error updating case', error });
  }
};

export const deleteCase = async (req: Request, res: Response) => {
  try {
    const result = await caseService.delete(req.params.id);
    if (!result.success) return res.status(400).json({ message: 'Failed to delete case', errors: result.errors });
    res.json({ message: 'Case deleted successfully' });
  } catch (error) {
    logger.error('Error deleting case', error);
    res.status(500).json({ message: 'Error deleting case', error });
  }
};

export const resolveCase = async (req: Request, res: Response) => {
  try {
    const resolved = await caseService.resolve(req.params.id);
    if (!resolved) return res.status(404).json({ message: 'Case not found' });
    res.json({ message: 'Success', data: resolved });
  } catch (error) {
    logger.error('Error resolving case', error);
    res.status(500).json({ message: 'Error resolving case', error });
  }
};

export const getCaseGraph = async (req: Request, res: Response) => {
  try {
    const graph = await caseService.getGraphData(req.params.id);
    if (!graph) return res.status(404).json({ message: 'Case not found' });
    res.json({ message: 'Success', data: graph });
  } catch (error) {
    logger.error('Error getting case graph', error);
    res.status(500).json({ message: 'Error getting case graph', error });
  }
};

export const upsertCaseNode = async (req: Request, res: Response) => {
  try {
    const result = await caseService.upsertNode(req.params.id, req.body);
    if (!result.success) return res.status(400).json({ message: 'Failed to update node', errors: result.errors });
    res.json({ message: 'Node updated successfully' });
  } catch (error) {
    logger.error('Error updating case node', error);
    res.status(500).json({ message: 'Error updating case node', error });
  }
};
