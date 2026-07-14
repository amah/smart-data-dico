import type { MetadataEntry } from './EntitySchema.js';

export type DocumentationScope = 'project' | 'package';
export type DocumentationStatus = 'draft' | 'review' | 'approved' | 'deprecated';
export interface DocumentationReference { ref: string; label?: string }
export interface Documentation {
  uuid: string; title: string; summary?: string; scope: DocumentationScope; packageName?: string;
  content: string; status?: DocumentationStatus; audience?: string[]; tags?: string[]; concepts?: string[];
  related?: DocumentationReference[]; owners?: string[]; language?: string; effectiveFrom?: string;
  effectiveTo?: string; metadata?: MetadataEntry[]; sourcePath: string; extensions?: Record<string, unknown>;
  /** One-based source line at which the Markdown body begins. Derived while parsing. */
  contentStartLine?: number;
}
export interface DocumentationChunk {
  id: string; documentUuid: string; scope: DocumentationScope; packageName?: string; title: string;
  headingPath: string[]; anchor: string; content: string; sequence: number; previousChunkId?: string;
  nextChunkId?: string; contentHash: string; tokenEstimate: number; audience: string[]; tags: string[];
  concepts: string[]; descriptors: string[]; relatedRefs: string[]; relatedDocumentUuids: string[];
  relatedChunkIds: string[]; metadata: MetadataEntry[]; status?: DocumentationStatus; language?: string;
  sourcePath: string; startLine: number; endLine: number;
}

export type DocumentationChunkSummary = Omit<DocumentationChunk, 'content'> & {
  content?: string;
  contentOmitted?: boolean;
};

export interface DocumentationChunkPage {
  documentUuid: string;
  total: number;
  cursor: string;
  nextCursor?: string;
  returnedTokenEstimate: number;
  chunks: DocumentationChunkSummary[];
}

export interface DocumentationReviewCoverage {
  documentUuid: string;
  sourcePath: string;
  totalChunks: number;
  reviewedChunks: number;
  missingChunkIds: string[];
  unknownChunkIds: string[];
  complete: boolean;
}
