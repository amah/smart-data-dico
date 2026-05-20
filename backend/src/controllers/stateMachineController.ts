/**
 * State machine controller (#179).
 *
 * Handles HTTP requests for the /api/state-machines and
 * /api/entities/:uuid/state-machines endpoints.
 */

import { Request, Response } from 'express';
import { stateMachineService } from '../services/stateMachineService.js';
import { logger } from '../utils/logger.js';

export const listStateMachinesForEntity = async (req: Request, res: Response) => {
  try {
    const machines = await stateMachineService.list({ ownerRef: req.params.uuid });
    res.json({ message: 'Success', data: machines });
  } catch (error) {
    logger.error('Error listing state machines for entity', error);
    res.status(500).json({ message: 'Error listing state machines for entity', error });
  }
};

export const getStateMachine = async (req: Request, res: Response) => {
  try {
    const sm = await stateMachineService.getByUuid(req.params.uuid);
    if (!sm) return res.status(404).json({ message: 'State machine not found' });
    res.json({ message: 'Success', data: sm });
  } catch (error) {
    logger.error('Error fetching state machine', error);
    res.status(500).json({ message: 'Error fetching state machine', error });
  }
};

export const createStateMachine = async (req: Request, res: Response) => {
  try {
    const result = await stateMachineService.create(req.body);
    if ('errors' in result) {
      return res.status(400).json({ message: 'Failed to create state machine', errors: result.errors });
    }
    res.status(201).json({ message: 'State machine created successfully', data: result });
  } catch (error) {
    logger.error('Error creating state machine', error);
    res.status(500).json({ message: 'Error creating state machine', error });
  }
};

export const updateStateMachine = async (req: Request, res: Response) => {
  try {
    const result = await stateMachineService.update(req.params.uuid, req.body);
    if (result === null) {
      return res.status(404).json({ message: 'State machine not found' });
    }
    if ('errors' in result) {
      return res.status(400).json({ message: 'Failed to update state machine', errors: result.errors });
    }
    res.json({ message: 'State machine updated successfully', data: result });
  } catch (error) {
    logger.error('Error updating state machine', error);
    res.status(500).json({ message: 'Error updating state machine', error });
  }
};

export const deleteStateMachine = async (req: Request, res: Response) => {
  try {
    const ok = await stateMachineService.delete(req.params.uuid);
    if (!ok) return res.status(404).json({ message: 'State machine not found' });
    res.json({ message: 'State machine deleted successfully' });
  } catch (error) {
    logger.error('Error deleting state machine', error);
    res.status(500).json({ message: 'Error deleting state machine', error });
  }
};
