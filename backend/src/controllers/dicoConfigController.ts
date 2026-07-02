/**
 * dicoConfigController (#107) — HTTP surface for the project config
 * document. Today it only exposes the derived-types array; other config
 * concerns (versioning, feature flags) can be added as sibling endpoints.
 */
import { Request, Response } from 'express';
import { listDerivedTypes, replaceDerivedTypes, DerivedType, listHideRules, replaceHideRules, HideRule } from '../services/dicoConfigService.js';
import { logger } from '../utils/logger.js';

export const getDerivedTypes = async (_req: Request, res: Response) => {
  try {
    const types = await listDerivedTypes();
    res.json({ message: 'Success', data: types });
  } catch (error) {
    logger.error('Error reading derived types', error);
    res.status(500).json({ message: 'Error reading derived types', error });
  }
};

export const putDerivedTypes = async (req: Request, res: Response) => {
  try {
    const body = req.body;
    if (!Array.isArray(body)) {
      return res.status(400).json({ message: 'Body must be an array of derived types' });
    }
    const result = await replaceDerivedTypes(body as DerivedType[]);
    if (!result.success) {
      return res.status(400).json({ message: 'Invalid derived types', errors: result.errors });
    }
    res.json({ message: 'Derived types updated', data: body });
  } catch (error) {
    logger.error('Error writing derived types', error);
    res.status(500).json({ message: 'Error writing derived types', error });
  }
};

export const getHideRules = async (_req: Request, res: Response) => {
  try {
    res.json({ message: 'Success', data: await listHideRules() });
  } catch (error) {
    logger.error('Error reading hide rules', error);
    res.status(500).json({ message: 'Error reading hide rules', error });
  }
};

export const putHideRules = async (req: Request, res: Response) => {
  try {
    const body = req.body;
    if (!Array.isArray(body)) {
      return res.status(400).json({ message: 'Body must be an array of hide rules' });
    }
    const result = await replaceHideRules(body as HideRule[]);
    if (!result.success) {
      return res.status(400).json({ message: 'Invalid hide rules', errors: result.errors });
    }
    res.json({ message: 'Hide rules updated', data: body });
  } catch (error) {
    logger.error('Error writing hide rules', error);
    res.status(500).json({ message: 'Error writing hide rules', error });
  }
};
