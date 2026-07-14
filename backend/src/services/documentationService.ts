import * as crypto from 'crypto';
import type {
  Documentation,
  DocumentationChunk,
  DocumentationChunkPage,
  DocumentationChunkSummary,
  DocumentationReviewCoverage,
  DocumentationScope,
  DocumentationStatus,
} from '../models/Documentation.js';
import { chunkDocumentation } from './documentation/documentationChunker.js';
import { DocumentationRepository, type DocumentationInput } from './documentation/documentationRepository.js';
import { commitChanges } from '../utils/fileOperations.js';

export interface DocumentationFilters {
  scope?: DocumentationScope;
  packageName?: string;
  status?: DocumentationStatus;
  audience?: string;
  language?: string;
  tag?: string;
  concept?: string;
  relatedRef?: string;
}

export interface DocumentationChunkPageOptions {
  cursor?: string;
  limit?: number;
  includeContent?: boolean;
  tokenBudget?: number;
}

export class DocumentationService {
  constructor(private readonly repository = new DocumentationRepository()) {}

  async listDocuments(filters: DocumentationFilters = {}): Promise<Documentation[]> {
    return (await this.repository.list()).filter(document =>
      (!filters.scope || document.scope === filters.scope)
      && (!filters.packageName || document.packageName === filters.packageName)
      && (!filters.status || document.status === filters.status)
      && (!filters.audience || document.audience?.includes(filters.audience))
      && (!filters.language || document.language === filters.language)
      && (!filters.tag || document.tags?.includes(filters.tag))
      && (!filters.concept || document.concepts?.includes(filters.concept))
      && (!filters.relatedRef || document.related?.some(reference => reference.ref === filters.relatedRef)),
    );
  }

  async getDocument(uuid: string): Promise<Documentation | null> {
    return this.repository.get(uuid);
  }

  async getChunks(uuid: string): Promise<DocumentationChunk[] | null> {
    const document = await this.getDocument(uuid);
    return document ? chunkDocumentation(document) : null;
  }

  async getChunkPage(uuid: string, options: DocumentationChunkPageOptions = {}): Promise<DocumentationChunkPage | null> {
    const chunks = await this.getChunks(uuid);
    if (!chunks) return null;
    const cursor = options.cursor ?? '0';
    if (!/^\d+$/.test(cursor)) throw new DocumentationValidationError('Documentation chunk cursor must be a non-negative integer');
    const start = Number(cursor);
    const limit = Math.min(Math.max(Math.floor(options.limit ?? 10), 1), 50);
    const tokenBudget = Math.min(Math.max(Math.floor(options.tokenBudget ?? 4000), 0), 6000);
    let returnedTokenEstimate = 0;
    const pageChunks: DocumentationChunkSummary[] = chunks.slice(start, start + limit).map(chunk => {
      if (!options.includeContent) {
        const { content: _content, ...summary } = chunk;
        return summary;
      }
      if (returnedTokenEstimate + chunk.tokenEstimate > tokenBudget) {
        const { content: _content, ...summary } = chunk;
        return { ...summary, contentOmitted: true };
      }
      returnedTokenEstimate += chunk.tokenEstimate;
      return chunk;
    });
    const next = start + pageChunks.length;
    return {
      documentUuid: uuid,
      total: chunks.length,
      cursor,
      nextCursor: next < chunks.length ? String(next) : undefined,
      returnedTokenEstimate,
      chunks: pageChunks,
    };
  }

  async getDocumentForAgent(uuid: string, includeContent = false, maxTokens = 4000): Promise<Record<string, unknown> | null> {
    const document = await this.getDocument(uuid);
    if (!document) return null;
    const chunks = chunkDocumentation(document);
    const totalTokenEstimate = chunks.reduce((sum, chunk) => sum + chunk.tokenEstimate, 0);
    const boundedMaxTokens = Math.min(Math.max(Math.floor(maxTokens), 1), 8000);
    const { content, ...metadata } = document;
    const outline = chunks.map(chunk => ({
      id: chunk.id,
      title: chunk.title,
      headingPath: chunk.headingPath,
      sequence: chunk.sequence,
      tokenEstimate: chunk.tokenEstimate,
      descriptors: chunk.descriptors,
      sourcePath: chunk.sourcePath,
      startLine: chunk.startLine,
      endLine: chunk.endLine,
    }));
    const contentFits = totalTokenEstimate <= boundedMaxTokens;
    return {
      ...metadata,
      chunkCount: chunks.length,
      totalTokenEstimate,
      outline,
      ...(includeContent && contentFits ? { content } : {}),
      ...(includeContent && !contentFits ? {
        contentOmitted: true,
        contentOmittedReason: `Document estimate ${totalTokenEstimate} exceeds the ${boundedMaxTokens} token retrieval limit; enumerate and retrieve chunks instead.`,
      } : {}),
    };
  }

  async getChunkForAgent(documentUuid: string, chunkId: string, includeNeighbors = false, tokenBudget = 4000): Promise<Record<string, unknown> | null> {
    const chunks = await this.getChunks(documentUuid);
    if (!chunks) return null;
    const index = chunks.findIndex(chunk => chunk.id === chunkId);
    if (index < 0) return null;
    const boundedBudget = Math.min(Math.max(Math.floor(tokenBudget), chunks[index].tokenEstimate), 6000);
    const candidates = includeNeighbors ? [chunks[index - 1], chunks[index + 1]].filter(Boolean) : [];
    let used = chunks[index].tokenEstimate;
    const neighbors = candidates.filter(candidate => {
      if (used + candidate.tokenEstimate > boundedBudget) return false;
      used += candidate.tokenEstimate;
      return true;
    });
    return {
      chunk: chunks[index],
      neighbors: includeNeighbors ? neighbors : undefined,
      returnedTokenEstimate: used,
      neighborContentOmitted: includeNeighbors && neighbors.length < candidates.length,
    };
  }

  async getReviewCoverage(documentUuid: string, reviewedChunkIds: string[]): Promise<DocumentationReviewCoverage | null> {
    const chunks = await this.getChunks(documentUuid);
    if (!chunks) return null;
    const known = new Set(chunks.map(chunk => chunk.id));
    const reviewed = new Set(reviewedChunkIds.filter(id => known.has(id)));
    return {
      documentUuid,
      sourcePath: chunks[0]?.sourcePath ?? '',
      totalChunks: chunks.length,
      reviewedChunks: reviewed.size,
      missingChunkIds: chunks.map(chunk => chunk.id).filter(id => !reviewed.has(id)),
      unknownChunkIds: [...new Set(reviewedChunkIds.filter(id => !known.has(id)))],
      complete: reviewed.size === chunks.length,
    };
  }

  async getForElement(kind: string, uuid: string): Promise<Documentation[]> {
    const canonical = `${kind}:${uuid}`;
    return (await this.repository.list()).filter(document => document.related?.some(reference =>
      reference.ref === uuid || reference.ref === canonical,
    ));
  }

  async createDocument(input: DocumentationInput): Promise<Documentation> {
    const uuid = input.uuid ?? crypto.randomUUID();
    if (await this.getDocument(uuid)) throw new DocumentationConflictError(`Documentation ${uuid} already exists`);
    const document = await this.repository.write({ ...input, uuid });
    await commitChanges(document.sourcePath, `Added documentation: ${document.title} (${document.uuid})`);
    await this.refreshSearchIndex();
    return document;
  }

  async updateDocument(uuid: string, input: Partial<DocumentationInput>): Promise<Documentation | null> {
    const existing = await this.getDocument(uuid);
    if (!existing) return null;
    if (input.uuid && input.uuid !== uuid) throw new DocumentationValidationError('Documentation uuid cannot be changed');
    const { sourcePath: _sourcePath, ...authored } = existing;
    const document = await this.repository.write({ ...authored, ...input, uuid }, existing);
    await commitChanges(document.sourcePath, `Updated documentation: ${document.title} (${document.uuid})`);
    await this.refreshSearchIndex();
    return document;
  }

  async deleteDocument(uuid: string): Promise<boolean> {
    const existing = await this.getDocument(uuid);
    if (!existing) return false;
    await this.repository.delete(existing);
    await commitChanges(existing.sourcePath, `Deleted documentation: ${existing.title} (${existing.uuid})`);
    await this.refreshSearchIndex();
    return true;
  }

  private async refreshSearchIndex(): Promise<void> {
    // Dynamic import avoids the search-index startup cycle: its initial build
    // loads this service to discover authored documentation.
    const { reindexDocumentation } = await import('./search/searchIndexService.js');
    await reindexDocumentation();
  }
}

export class DocumentationValidationError extends Error {}
export class DocumentationConflictError extends Error {}
export const documentationService = new DocumentationService();
