/**
 * Canonical Intermediate Representation (CIR) for the data-dictionary
 * reverse-engineering tool. Mirrors docs/reverse-engineering/schemas/*.json as
 * zod, so extraction output is runtime-validated before it hits the store.
 *
 * Phase 1: deterministic extraction only (Liquibase). No AI here.
 */
import { z } from 'zod';

export const TICKET_RE = /\b([A-Z][A-Z0-9]+-\d+)\b/g;

/** Parse Jira-style ticket ids out of arbitrary text (commit msg, changeSet id…). */
export function extractTickets(...texts: (string | undefined)[]): string[] {
  const found = new Set<string>();
  for (const t of texts) {
    if (!t) continue;
    for (const m of t.matchAll(TICKET_RE)) found.add(m[1]);
  }
  return [...found];
}

export const ProvenanceSchema = z.object({
  source: z.enum(['liquibase', 'jpa', 'flyway', 'ddl', 'git', 'jira', 'confluence', 'pr']),
  ref: z.string(),
  line: z.number().int().optional(),
  commit: z.string().optional(),
  ticket: z.string().regex(/^[A-Z][A-Z0-9]+-\d+$/).optional(),
  author: z.string().optional(),
  fetchedAt: z.string().optional(),
});
export type Provenance = z.infer<typeof ProvenanceSchema>;

export const ElementKind = z.enum(['entity', 'attribute', 'relationship', 'constraint']);

export const CIRElementSchema = z.object({
  id: z.string(),
  kind: ElementKind,
  names: z
    .object({
      physical: z
        .object({ schema: z.string().optional(), table: z.string().optional(), column: z.string().optional() })
        .optional(),
      logical: z.object({ fqcn: z.string().optional(), field: z.string().optional() }).optional(),
    })
    .refine((n) => !!(n.physical || n.logical), 'names needs physical or logical'),
  facts: z.record(z.string(), z.unknown()),
  provenance: z.array(ProvenanceSchema).min(1),
  lifecycle: z.object({
    status: z.enum(['active', 'deprecated', 'removed']),
    bornEvent: z.string().optional(),
    lastChangedEvent: z.string().optional(),
    firstSeen: z.string().optional(),
    lastSeen: z.string().optional(),
  }),
  confidence: z.number().min(0).max(1).optional(),
  flags: z.array(z.string()).optional(),
});
export type CIRElement = z.infer<typeof CIRElementSchema>;

export const CIREventSchema = z.object({
  ts: z.string(),
  element: z.string(),
  type: z.enum(['born', 'modified', 'renamed', 'deprecated', 'removed']),
  change: z.string().optional(),
  source: z.object({
    system: z.enum(['liquibase', 'jpa', 'flyway', 'ddl']),
    file: z.string().optional(),
    repo: z.string().optional(),
    changeSetId: z.string().optional(),
    author: z.string().optional(),
    comment: z.string().optional(),
  }),
  commit: z
    .object({
      sha: z.string(),
      author: z.string().optional(),
      email: z.string().optional(),
      date: z.string().optional(),
      message: z.string().optional(),
      tickets: z.array(z.string()).optional(),
    })
    .optional(),
  details: z.record(z.string(), z.unknown()).optional(),
});
export type CIREvent = z.infer<typeof CIREventSchema>;

/** A change-set as parsed from a Liquibase changelog, before correlation. */
export interface RawChangeSet {
  id: string;
  author?: string;
  comment?: string;
  file: string; // repo-relative changelog path
  changes: Array<Record<string, unknown>>; // each op: { createTable: {...} } etc.
}
