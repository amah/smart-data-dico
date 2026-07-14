import type { Request, Response } from 'express';
import { documentationService, DocumentationConflictError, DocumentationValidationError } from '../services/documentationService.js';
import type { DocumentationScope, DocumentationStatus } from '../models/Documentation.js';
import { logger } from '../utils/logger.js';

export async function listDocumentation(req: Request, res: Response): Promise<void> {
  try {
    const data = await documentationService.listDocuments({
      scope: req.query.scope as DocumentationScope | undefined,
      packageName: req.query.package as string | undefined,
      status: req.query.status as DocumentationStatus | undefined,
      audience: req.query.audience as string | undefined,
      language: req.query.language as string | undefined,
      tag: req.query.tag as string | undefined,
      concept: req.query.concept as string | undefined,
      relatedRef: req.query.relatedRef as string | undefined,
    });
    res.json({ message: 'Success', data });
  } catch (error) { handleError(res, 'listing documentation', error); }
}

export async function getDocumentation(req: Request, res: Response): Promise<void> {
  try {
    const data = await documentationService.getDocument(req.params.uuid);
    if (!data) { res.status(404).json({ message: 'Documentation not found' }); return; }
    res.json({ message: 'Success', data });
  } catch (error) { handleError(res, 'fetching documentation', error); }
}

export async function getDocumentationChunks(req: Request, res: Response): Promise<void> {
  try {
    const data = await documentationService.getChunks(req.params.uuid);
    if (!data) { res.status(404).json({ message: 'Documentation not found' }); return; }
    res.json({ message: 'Success', data });
  } catch (error) { handleError(res, 'chunking documentation', error); }
}

export async function getDocumentationForElement(req: Request, res: Response): Promise<void> {
  try {
    const data = await documentationService.getForElement(req.params.kind, req.params.uuid);
    res.json({ message: 'Success', data });
  } catch (error) { handleError(res, 'fetching documentation for element', error); }
}

export async function createDocumentation(req: Request, res: Response): Promise<void> {
  try {
    const data = await documentationService.createDocument(req.body);
    res.status(201).json({ message: 'Documentation created successfully', data });
  } catch (error) { handleError(res, 'creating documentation', error); }
}

export async function updateDocumentation(req: Request, res: Response): Promise<void> {
  try {
    const data = await documentationService.updateDocument(req.params.uuid, req.body);
    if (!data) { res.status(404).json({ message: 'Documentation not found' }); return; }
    res.json({ message: 'Documentation updated successfully', data });
  } catch (error) { handleError(res, 'updating documentation', error); }
}

export async function deleteDocumentation(req: Request, res: Response): Promise<void> {
  try {
    if (!await documentationService.deleteDocument(req.params.uuid)) {
      res.status(404).json({ message: 'Documentation not found' }); return;
    }
    res.json({ message: 'Documentation deleted successfully' });
  } catch (error) { handleError(res, 'deleting documentation', error); }
}

function handleError(res: Response, operation: string, error: unknown): void {
  logger.error(`Error ${operation}`, error);
  if (error instanceof DocumentationConflictError) {
    res.status(409).json({ message: error.message }); return;
  }
  if (error instanceof DocumentationValidationError || error instanceof TypeError || error instanceof Error) {
    res.status(400).json({ message: error.message }); return;
  }
  res.status(500).json({ message: `Error ${operation}` });
}
