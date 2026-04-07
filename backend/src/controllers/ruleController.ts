import { Request, Response } from 'express';
import { ruleService } from '../services/ruleService.js';
import { RuleScope } from '../models/Rule.js';
import { logger } from '../utils/logger.js';

export const listRules = async (req: Request, res: Response) => {
  try {
    const rules = await ruleService.listRules({
      scope: req.query.scope as RuleScope | undefined,
      severity: req.query.severity as 'info' | 'warning' | 'error' | undefined,
      enforcement: req.query.enforcement as 'save' | 'process' | 'advisory' | undefined,
      targetUuid: req.query.targetUuid as string | undefined,
      perspectiveUuid: req.query.perspective as string | undefined,
      packageName: req.query.package as string | undefined,
    });
    res.json({ message: 'Success', data: rules });
  } catch (error) {
    logger.error('Error listing rules', error);
    res.status(500).json({ message: 'Error listing rules', error });
  }
};

export const getRule = async (req: Request, res: Response) => {
  try {
    const rule = await ruleService.getRule(req.params.uuid);
    if (!rule) return res.status(404).json({ message: 'Rule not found' });
    res.json({ message: 'Success', data: rule });
  } catch (error) {
    logger.error('Error fetching rule', error);
    res.status(500).json({ message: 'Error fetching rule', error });
  }
};

export const getRulesForEntity = async (req: Request, res: Response) => {
  try {
    const rules = await ruleService.listRulesForEntity(req.params.entityUuid);
    res.json({ message: 'Success', data: rules });
  } catch (error) {
    logger.error('Error fetching rules for entity', error);
    res.status(500).json({ message: 'Error fetching rules for entity', error });
  }
};

export const createRule = async (req: Request, res: Response) => {
  try {
    const result = await ruleService.createRule(req.body);
    if (!result.success) {
      return res.status(400).json({ message: 'Failed to create rule', errors: result.errors });
    }
    res.status(201).json({ message: 'Rule created successfully', data: result.rule });
  } catch (error) {
    logger.error('Error creating rule', error);
    res.status(500).json({ message: 'Error creating rule', error });
  }
};

export const updateRule = async (req: Request, res: Response) => {
  try {
    const result = await ruleService.updateRule(req.params.uuid, req.body);
    if (!result.success) {
      return res.status(400).json({ message: 'Failed to update rule', errors: result.errors });
    }
    res.json({ message: 'Rule updated successfully', data: result.rule });
  } catch (error) {
    logger.error('Error updating rule', error);
    res.status(500).json({ message: 'Error updating rule', error });
  }
};

export const deleteRule = async (req: Request, res: Response) => {
  try {
    const result = await ruleService.deleteRule(req.params.uuid);
    if (!result.success) {
      return res.status(400).json({ message: 'Failed to delete rule', errors: result.errors });
    }
    res.json({ message: 'Rule deleted successfully' });
  } catch (error) {
    logger.error('Error deleting rule', error);
    res.status(500).json({ message: 'Error deleting rule', error });
  }
};
