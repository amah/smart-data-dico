/**
 * Action controller (#179).
 *
 * Handles HTTP requests for the /api/actions and /api/entities/:uuid/actions
 * endpoints. Auth: ADMIN/EDITOR for writes, VIEWER for reads.
 */

import { Request, Response } from 'express';
import { actionService } from '../services/actionService.js';
import { logger } from '../utils/logger.js';

export const listActions = async (req: Request, res: Response) => {
  try {
    const packageName = typeof req.query.package === 'string' ? req.query.package : undefined;
    const actions = await actionService.list({ packageName });
    res.json({ message: 'Success', data: actions });
  } catch (error) {
    logger.error('Error listing actions', error);
    res.status(500).json({ message: 'Error listing actions', error });
  }
};

export const listActionsForEntity = async (req: Request, res: Response) => {
  try {
    const actions = await actionService.list({ ownerRef: req.params.uuid });
    res.json({ message: 'Success', data: actions });
  } catch (error) {
    logger.error('Error listing actions for entity', error);
    res.status(500).json({ message: 'Error listing actions for entity', error });
  }
};

export const getAction = async (req: Request, res: Response) => {
  try {
    const action = await actionService.getByUuid(req.params.uuid);
    if (!action) return res.status(404).json({ message: 'Action not found' });
    res.json({ message: 'Success', data: action });
  } catch (error) {
    logger.error('Error fetching action', error);
    res.status(500).json({ message: 'Error fetching action', error });
  }
};

export const createAction = async (req: Request, res: Response) => {
  try {
    const result = await actionService.create(req.body);
    if ('errors' in result) {
      return res.status(400).json({ message: 'Failed to create action', errors: result.errors });
    }
    res.status(201).json({ message: 'Action created successfully', data: result });
  } catch (error) {
    logger.error('Error creating action', error);
    res.status(500).json({ message: 'Error creating action', error });
  }
};

export const updateAction = async (req: Request, res: Response) => {
  try {
    const result = await actionService.update(req.params.uuid, req.body);
    if (result === null) {
      return res.status(404).json({ message: 'Action not found' });
    }
    if ('errors' in result) {
      return res.status(400).json({ message: 'Failed to update action', errors: result.errors });
    }
    res.json({ message: 'Action updated successfully', data: result });
  } catch (error) {
    logger.error('Error updating action', error);
    res.status(500).json({ message: 'Error updating action', error });
  }
};

export const deleteAction = async (req: Request, res: Response) => {
  try {
    const ok = await actionService.delete(req.params.uuid);
    if (!ok) return res.status(404).json({ message: 'Action not found' });
    res.json({ message: 'Action deleted successfully' });
  } catch (error) {
    logger.error('Error deleting action', error);
    res.status(500).json({ message: 'Error deleting action', error });
  }
};
