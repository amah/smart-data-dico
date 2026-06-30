/**
 * Reverse-engineer's contribution to the AI chat agent: the read tools the
 * integrated agent uses to ground its prose pass (descriptions + rules) on a
 * reverse-engineered dictionary. Registered from the plugin's own module so the
 * AI controller has no reverse-engineer-specific code.
 */
import { z } from 'zod';
import { registerAgentTool } from '../ai/agentToolRegistry.js';
import { listSynthesisBriefs, getSynthesisBrief } from './synthesisAccess.js';

let registered = false;

/** Idempotently register the reverse-engineer agent tools. */
export function registerReverseEngineerAgentTools(): void {
  if (registered) return;
  registered = true;

  registerAgentTool({
    name: 'listSynthesisBriefs',
    category: 'read',
    description: 'List entities that have a reverse-engineering synthesis brief in the open project. Use when completing a reverse-engineered dictionary: each brief grounds the prose pass (facts, drift, Jira/Confluence context) for one entity.',
    jsonSchema: { type: 'object', properties: {} },
    inputSchema: z.object({}),
    execute: (_args, ctx) => listSynthesisBriefs(ctx.dataDir),
  });

  registerAgentTool({
    name: 'getSynthesisBrief',
    category: 'read',
    description: 'Get the grounded synthesis brief (markdown) for one entity — its attributes, drift, linked Jira issues and Confluence excerpts. Read this BEFORE writing an entity description or proposing rules, and cite the sources it lists. Do not invent business logic beyond the brief.',
    jsonSchema: { type: 'object', required: ['entityName'], properties: { entityName: { type: 'string' } } },
    inputSchema: z.object({ entityName: z.string() }),
    execute: (args, ctx) => getSynthesisBrief(ctx.dataDir, String(args.entityName)),
  });
}
