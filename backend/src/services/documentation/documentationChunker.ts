import { createHash } from 'node:crypto';
import type { Documentation, DocumentationChunk } from '../../models/Documentation.js';

export const DEFAULT_DOCUMENTATION_CHUNK_TARGET_TOKENS = 900;
export const DEFAULT_DOCUMENTATION_CHUNK_HARD_LIMIT_TOKENS = 1200;

export interface DocumentationChunkingOptions {
  targetTokens?: number;
  hardLimitTokens?: number;
}

interface SourceLine { text: string; line: number }
interface Section { headings: string[]; anchor?: string; lines: SourceLine[] }
interface Block { lines: SourceLine[] }

const DESCRIPTOR_STOP_WORDS = new Set([
  'about', 'after', 'again', 'also', 'and', 'are', 'before', 'being', 'between', 'but',
  'can', 'could', 'does', 'each', 'for', 'from', 'has', 'have', 'into', 'its', 'may',
  'must', 'not', 'only', 'other', 'our', 'should', 'than', 'that', 'the', 'their',
  'then', 'there', 'these', 'this', 'those', 'until', 'was', 'were', 'when', 'where',
  'which', 'will', 'with', 'would', 'your',
]);

function slug(value: string): string {
  return value.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'document';
}

function tokenEstimate(content: string): number {
  return Math.ceil(content.length / 4);
}

function contentOf(lines: SourceLine[]): string {
  return lines.map(line => line.text).join('\n').trim();
}

function splitSections(document: Documentation): Section[] {
  const lines = document.content.replace(/\r\n?/g, '\n').split('\n');
  const sections: Section[] = [];
  const path: string[] = [];
  let pendingAnchor: string | undefined;
  let current: Section | undefined;
  let fenceCharacter: string | undefined;

  const flush = () => {
    if (current && contentOf(current.lines)) sections.push(current);
    current = undefined;
  };

  lines.forEach((text, index) => {
    const line = index + 1;
    const fence = text.match(/^\s*(`{3,}|~{3,})/);
    if (fence) {
      const character = fence[1][0];
      if (!fenceCharacter) fenceCharacter = character;
      else if (fenceCharacter === character) fenceCharacter = undefined;
    }

    if (!fenceCharacter) {
      const marker = text.match(/^\s*<!--\s*chunk:\s*([a-zA-Z0-9][\w.-]*)\s*-->\s*$/);
      if (marker) {
        pendingAnchor = slug(marker[1]);
        return;
      }
      const heading = text.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
      if (heading) {
        flush();
        const level = heading[1].length;
        path.length = level - 1;
        path[level - 1] = heading[2];
        current = {
          headings: [...path].filter(Boolean),
          anchor: pendingAnchor,
          lines: [{ text, line }],
        };
        pendingAnchor = undefined;
        return;
      }
    }

    if (!current) current = { headings: [], anchor: pendingAnchor, lines: [] };
    current.lines.push({ text, line });
  });
  flush();
  return sections;
}

/** Split a section into Markdown-aware blocks without breaking ordinary lists, tables or fences. */
function blocksOf(section: Section): Block[] {
  const blocks: Block[] = [];
  let current: SourceLine[] = [];
  let fenceCharacter: string | undefined;
  const flush = () => {
    if (current.length && contentOf(current)) blocks.push({ lines: current });
    current = [];
  };

  for (const line of section.lines) {
    const fence = line.text.match(/^\s*(`{3,}|~{3,})/);
    if (fence) {
      const character = fence[1][0];
      if (!fenceCharacter) {
        flush();
        fenceCharacter = character;
      }
      current.push(line);
      if (fenceCharacter === character && current.length > 1) {
        fenceCharacter = undefined;
        flush();
      }
      continue;
    }
    if (fenceCharacter) {
      current.push(line);
      continue;
    }
    if (!line.text.trim()) {
      flush();
      continue;
    }
    current.push(line);
  }
  flush();

  // Keep a section heading with the first paragraph instead of producing a
  // nearly-empty heading-only chunk when that paragraph is large.
  if (blocks.length > 1 && /^#{1,6}\s/.test(contentOf(blocks[0].lines))) {
    blocks.splice(0, 2, { lines: [...blocks[0].lines, ...blocks[1].lines] });
  }
  return blocks;
}

function hardSplit(block: Block, hardLimitCharacters: number): Block[] {
  if (contentOf(block.lines).length <= hardLimitCharacters) return [block];
  const pieces: Block[] = [];
  let current: SourceLine[] = [];

  const flush = () => {
    if (current.length) pieces.push({ lines: current });
    current = [];
  };

  for (const sourceLine of block.lines) {
    const linePieces: SourceLine[] = [];
    if (!sourceLine.text.length) linePieces.push(sourceLine);
    else {
      for (let offset = 0; offset < sourceLine.text.length; offset += hardLimitCharacters) {
        linePieces.push({ text: sourceLine.text.slice(offset, offset + hardLimitCharacters), line: sourceLine.line });
      }
    }
    for (const linePiece of linePieces) {
      const candidate = contentOf([...current, linePiece]);
      if (current.length && candidate.length > hardLimitCharacters) flush();
      current.push(linePiece);
    }
  }
  flush();
  return pieces;
}

function boundedParts(section: Section, targetCharacters: number, hardLimitCharacters: number): Block[] {
  const atomic = blocksOf(section).flatMap(block => hardSplit(block, hardLimitCharacters));
  const parts: Block[] = [];
  let current: SourceLine[] = [];
  const flush = () => {
    if (current.length) parts.push({ lines: current });
    current = [];
  };

  for (const block of atomic) {
    const separator = current.length ? [{ text: '', line: block.lines[0].line } as SourceLine] : [];
    const candidate = [...current, ...separator, ...block.lines];
    if (current.length && contentOf(candidate).length > targetCharacters) flush();
    if (current.length) current.push({ text: '', line: block.lines[0].line });
    current.push(...block.lines);
    if (contentOf(current).length > hardLimitCharacters) {
      // This is only reachable when the soft target was configured above the
      // hard limit; keep the hard invariant load-bearing.
      const overflow = hardSplit({ lines: current }, hardLimitCharacters);
      parts.push(...overflow.slice(0, -1));
      current = overflow.at(-1)?.lines ?? [];
    }
  }
  flush();
  return parts;
}

function descriptorsFor(headings: string[], content: string): string[] {
  const text = `${headings.join(' ')} ${content.slice(0, 1200)}`
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/<[^>]+>|[^\p{L}\p{N}\s-]/gu, ' ')
    .toLowerCase();
  const descriptors: string[] = [];
  for (const word of text.match(/[\p{L}\p{N}][\p{L}\p{N}-]{2,}/gu) ?? []) {
    if (DESCRIPTOR_STOP_WORDS.has(word) || descriptors.includes(word)) continue;
    descriptors.push(word);
    if (descriptors.length === 12) break;
  }
  return descriptors;
}

function typedRelatedRefs(document: Documentation): {
  relatedRefs: string[];
  relatedDocumentUuids: string[];
  relatedChunkIds: string[];
} {
  const relatedRefs = document.related?.map(item => item.ref) ?? [];
  return {
    relatedRefs,
    relatedDocumentUuids: relatedRefs.filter(ref => ref.startsWith('document:')).map(ref => ref.slice('document:'.length)),
    relatedChunkIds: relatedRefs.filter(ref => ref.startsWith('chunk:')).map(ref => ref.slice('chunk:'.length)),
  };
}

export function chunkDocumentation(
  document: Documentation,
  options: DocumentationChunkingOptions = {},
): DocumentationChunk[] {
  const hardLimitTokens = Math.max(1, Math.floor(options.hardLimitTokens ?? DEFAULT_DOCUMENTATION_CHUNK_HARD_LIMIT_TOKENS));
  const targetTokens = Math.max(1, Math.min(Math.floor(options.targetTokens ?? DEFAULT_DOCUMENTATION_CHUNK_TARGET_TOKENS), hardLimitTokens));
  const hardLimitCharacters = hardLimitTokens * 4;
  const targetCharacters = targetTokens * 4;
  const counts = new Map<string, number>();
  const related = typedRelatedRefs(document);
  const chunks: DocumentationChunk[] = [];

  for (const section of splitSections(document)) {
    const rawBase = section.anchor ?? slug(section.headings.join('-') || document.title);
    const occurrence = (counts.get(rawBase) ?? 0) + 1;
    counts.set(rawBase, occurrence);
    const base = occurrence === 1 ? rawBase : `${rawBase}-${occurrence}`;
    const parts = boundedParts(section, targetCharacters, hardLimitCharacters);

    parts.forEach((part, partIndex) => {
      const anchor = partIndex === 0 ? base : `${base}-part-${partIndex + 1}`;
      const content = contentOf(part.lines);
      chunks.push({
        id: `doc:${document.uuid}#${anchor}`,
        documentUuid: document.uuid,
        scope: document.scope,
        packageName: document.packageName,
        title: section.headings.at(-1) ?? document.title,
        headingPath: section.headings,
        anchor,
        content,
        sequence: chunks.length,
        contentHash: createHash('sha256').update(content.replace(/\s+/g, ' ').trim()).digest('hex'),
        tokenEstimate: tokenEstimate(content),
        audience: document.audience ?? [],
        tags: document.tags ?? [],
        concepts: document.concepts ?? [],
        descriptors: descriptorsFor(section.headings, content),
        ...related,
        metadata: document.metadata ?? [],
        status: document.status,
        language: document.language,
        sourcePath: document.sourcePath,
        startLine: (document.contentStartLine ?? 1) + part.lines[0].line - 1,
        endLine: (document.contentStartLine ?? 1) + part.lines.at(-1)!.line - 1,
      });
    });
  }

  chunks.forEach((chunk, index) => {
    chunk.previousChunkId = chunks[index - 1]?.id;
    chunk.nextChunkId = chunks[index + 1]?.id;
  });
  return chunks;
}
