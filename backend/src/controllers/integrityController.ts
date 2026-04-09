/**
 * Integrity controller (#85 R5).
 *
 * Single read endpoint that aggregates validation, physical constraints,
 * and functional rules across the whole dictionary. The frontend
 * Integrity page derives per-tab counts from the same payload via
 * useMemo, so one network round-trip covers all four tabs.
 */
import { Request, Response } from 'express';
import { integrityService } from '../services/integrityService.js';
import { logger } from '../utils/logger.js';

export const getIntegrityReport = async (_req: Request, res: Response) => {
  try {
    const report = await integrityService.getReport();
    res.json({ message: 'Success', data: report });
  } catch (error) {
    logger.error('Error building integrity report', error);
    res.status(500).json({ message: 'Error building integrity report', error });
  }
};
