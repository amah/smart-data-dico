/**
 * Search's contribution to the AI chat agent (#search-index): a read-only
 * `searchModel` tool that lets the assistant find model elements by ranked
 * full-text query instead of relying on the truncated whole-model outline in
 * its system prompt. Registered from this module (mirrors elementStyle /
 * reverse-engineer) so the AI controller carries no search-specific code.
 *
 * Grounding win: the agent can now answer "which entity defines an `iban`
 * attribute?" or "find payment-related entities" with one call, then drill in
 * with getEntityDetails — retrieval on demand rather than a fixed dump.
 */
import { z } from 'zod';
import { registerAgentTool } from '../ai/agentToolRegistry.js';
import { getSearchIndex, getSearchIndexHealth } from './searchIndexService.js';
import type { SearchKind } from './searchDocuments.js';

const KINDS: SearchKind[] = ['entity', 'attribute', 'package', 'relationship', 'rule', 'metadata', 'case', 'document', 'documentation-chunk'];

let registered = false;

/** Idempotently register the search agent tool. */
export function registerSearchAgentTools(): void {
  if (registered) return;
  registered = true;

  registerAgentTool({
    name: 'searchModel',
    category: 'read',
    description:
      'Full-text search across the whole data dictionary — entities, attributes, packages, relationships, rules, entity metadata and cases. Ranked prefix matching supports queries such as "iban", "order tot", and "payment". Use this to LOCATE elements when you don\'t already know the exact package/entity name; then call getEntityDetails for the full definition. Returns ranked hits with the owning package and entity.',
    jsonSchema: {
      type: 'object',
      required: ['query'],
      properties: {
        query: { type: 'string', description: 'free-text search, e.g. "iban" or "order total"' },
        kind: { type: 'string', enum: KINDS, description: 'restrict to one kind (optional)' },
        packageName: { type: 'string', description: 'restrict to one package (optional)' },
        limit: { type: 'number', description: 'max results (default 15, max 50)' },
      },
    },
    inputSchema: z.object({
      query: z.string(),
      kind: z.enum(KINDS as [SearchKind, ...SearchKind[]]).optional(),
      packageName: z.string().optional(),
      limit: z.number().optional(),
    }),
    execute: (args) => {
      const idx = getSearchIndex();
      if (!idx) {
        return {
          success: false,
          error: 'Search index is not available. Check getSearchIndexStatus, then use narrowly scoped entity tools.',
          index: getSearchIndexHealth(),
        };
      }
      const query = String(args.query ?? '').trim();
      if (!query) return { success: true, count: 0, results: [] };
      const limit = Math.min(Math.max(Number(args.limit) || 15, 1), 50);
      const hits = idx.search(query, {
        kinds: args.kind ? [args.kind as SearchKind] : undefined,
        package: args.packageName ? String(args.packageName) : undefined,
        limit,
      });
      return {
        success: true,
        count: hits.length,
        index: getSearchIndexHealth(),
        results: hits.map((h) => ({
          kind: h.kind,
          name: h.name,
          package: h.package,
          entity: h.entityName || undefined,
          description: (h.description || '').slice(0, 160),
          route: h.route,
        })),
      };
    },
  });

  registerAgentTool({
    name: 'getSearchIndexStatus',
    category: 'read',
    description:
      'Check whether the full-text model index is ready and how many entities, attributes, packages and other records it contains. Use this when searchModel returns no results unexpectedly or before reviewing a very large project.',
    jsonSchema: { type: 'object', properties: {} },
    inputSchema: z.object({}),
    execute: () => ({ success: true, ...getSearchIndexHealth() }),
  });
}
