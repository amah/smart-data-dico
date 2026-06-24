import { Request, Response } from 'express';
import { streamText, generateText, tool, jsonSchema, stepCountIs, convertToModelMessages, createUIMessageStream, pipeUIMessageStreamToResponse } from 'ai';
import { z } from 'zod';
import { logger } from '../utils/logger.js';
import { config, AI_MAX_STEPS } from '../kernel/config.js';
import { getConfigSection, setConfigSection, CONFIG_FILE } from '../utils/appDir.js';
import { conversationService } from '../services/conversationService.js';
import { promptService } from '../services/promptService.js';
import { mcpClientRegistry } from '../services/mcpClientRegistry.js';
import { awaitApproval, settleApproval, abortStreamApprovals } from './ai/approvalRegistry.js';
import {
  createEntityInputSchema,
  updateEntityInputSchema,
  deleteEntityInputSchema,
  createRelationshipInputSchema,
  updateRelationshipInputSchema,
  deleteRelationshipInputSchema,
  createEntityParameters,
  updateEntityParameters,
  deleteEntityParameters,
  createRelationshipParameters,
  updateRelationshipParameters,
  deleteRelationshipParameters,
  executeCreateEntity,
  executeUpdateEntity,
  executeDeleteEntity,
  executeCreateRelationship,
  executeUpdateRelationship,
  executeDeleteRelationship,
  type MutationServices,
} from './aiMutationTools.js';

// --- Tool categories (#59) ---
//
// Granular auto-approve groups tools by side-effect class so the user can
// say "auto-approve reads, review writes" rather than flipping a single
// global switch. The category is emitted on tool-input-start so the
// frontend doesn't keep its own duplicate switch.
//
//   read     — pure inspection (listEntities, listStereotypes, getEntityDetails, listPackages)
//   navigate — UI-only side effect (navigateTo)
//   create   — produces new entities/relationships (createEntity, createRelationship)
//   modify   — mutates existing data (future: updateEntity, updateRelationship)
//   delete   — destructive (future: deleteEntity) — UI never offers auto-approve here
export type AIToolCategory = 'read' | 'navigate' | 'create' | 'modify' | 'delete';

const TOOL_CATEGORY_MAP: Record<string, AIToolCategory> = {
  // read
  listEntities: 'read',
  listStereotypes: 'read',
  getEntityDetails: 'read',
  listPackages: 'read',
  listRoutes: 'read',
  // navigate
  navigateTo: 'navigate',
  // create
  createEntity: 'create',
  createRelationship: 'create',
  // modify (reserved for future tools)
  updateEntity: 'modify',
  updateRelationship: 'modify',
  // delete (reserved for future tools)
  deleteEntity: 'delete',
  deleteRelationship: 'delete',
};

// --- Chat modes (#55) ---
//
// Three flavors of AI session that swap the system prompt body and the
// tool subset the model is allowed to call:
//
//   designer  — full toolset (default; preserves pre-#55 behavior).
//   ask       — read-only tools; no creates / mutations / navigations.
//               Pure Q&A and explain mode.
//   review    — read-only tools focused on quality / improvements.
//               Same tool subset as Ask but a different prompt.
//
// The mode is per-conversation; the frontend sends `mode` on every chat
// request and persists it on the conversation record so the choice
// survives page reloads.
export type AIChatMode = 'designer' | 'ask' | 'review';

export const AI_CHAT_MODES: readonly AIChatMode[] = ['designer', 'ask', 'review'] as const;

export function isValidMode(value: unknown): value is AIChatMode {
  return value === 'designer' || value === 'ask' || value === 'review';
}

// Tool subsets per mode. Designer keeps the full set; Ask and Review
// drop everything that mutates state. navigateTo is intentionally
// excluded from Ask/Review — those modes shouldn't move the user away
// from the page they are asking about.
const READ_ONLY_TOOLS: ReadonlySet<string> = new Set([
  'listEntities',
  'listStereotypes',
  'getEntityDetails',
  'listPackages',
]);

export function isToolAllowedForMode(toolName: string, mode: AIChatMode): boolean {
  if (mode === 'designer') return true;
  return READ_ONLY_TOOLS.has(toolName);
}

const MODE_SYSTEM_SUFFIX: Record<AIChatMode, string> = {
  designer: '',
  ask: `\n\nMode: ASK. You are answering questions about the data model. You have read-only tools (listEntities, getEntityDetails, listStereotypes). Do NOT attempt to create, modify, or delete anything — those tools are not available. Explain concepts, summarize structure, and quote the model where helpful. If the user asks for a change, describe what would change but do not perform it.`,
  review: `\n\nMode: REVIEW. You are reviewing the data model for quality issues. Use read-only tools (listEntities, getEntityDetails, listStereotypes) to inspect the model and surface concerns: missing primary keys, inconsistent naming, undocumented attributes, orphaned entities, overly wide tables, ambiguous types. Group findings by severity (high/medium/low). Recommend specific edits but do not perform them — write tools are not available in this mode.`,
};

export function getModeSystemSuffix(mode: AIChatMode): string {
  return MODE_SYSTEM_SUFFIX[mode];
}

/**
 * Drop tools the active mode forbids. Designer keeps everything;
 * Ask / Review keep only the read-only inspection tools so the model
 * literally cannot emit a write call. Designer is a no-op (returns
 * the input map unchanged) so the common path stays cheap.
 */
export function filterToolsForMode<T extends Record<string, unknown>>(
  allTools: T,
  mode: AIChatMode,
): Partial<T> {
  if (mode === 'designer') return allTools;
  const out: Partial<T> = {};
  for (const [name, def] of Object.entries(allTools)) {
    if (isToolAllowedForMode(name, mode)) {
      (out as Record<string, unknown>)[name] = def;
    }
  }
  return out;
}

/**
 * Pull a human-readable provider message out of an AI SDK or
 * OpenAI-compatible error envelope so the frontend can render the
 * actionable line ("requires more credits, visit …") instead of the
 * raw `API error 402: {…}` blob. Pure helper — exported for tests.
 *
 * Recognized shapes:
 *   - `errorText` is a JSON string with `{error: {message, code}}`
 *   - `errorText` matches `API error <status>: <json>`
 *   - anything else: pass through as-is
 */
export function enrichErrorEvent(data: { type: 'error'; errorText: string;[k: string]: unknown }) {
  let providerMessage: string | undefined;
  let providerCode: string | number | undefined;
  let providerHelpUrl: string | undefined;
  let upstreamStatus: number | undefined;
  let providerRaw: string | undefined = data.errorText;

  // The legacy direct-client message format embeds the upstream JSON
  // inside the wrapper string. Split it back apart.
  const wrapped = /^Upstream provider returned (\d+):\s*(.*)$|^API error (\d+):\s*(.*)$/s.exec(data.errorText);
  let body = data.errorText;
  if (wrapped) {
    upstreamStatus = Number(wrapped[1] ?? wrapped[3]);
    body = (wrapped[2] ?? wrapped[4] ?? '').trim();
  }

  try {
    const parsed = JSON.parse(body);
    const e = parsed?.error || parsed;
    if (typeof e?.message === 'string') providerMessage = e.message;
    if (e?.code !== undefined) providerCode = e.code;
    providerRaw = body;
  } catch { /* not JSON */ }

  if (typeof providerMessage === 'string') {
    const urlMatch = providerMessage.match(/https?:\/\/\S+/);
    if (urlMatch) providerHelpUrl = urlMatch[0];
  }

  return {
    type: 'error' as const,
    errorText: providerMessage || data.errorText,
    ...(upstreamStatus !== undefined ? { upstreamStatus } : {}),
    ...(providerMessage ? { providerMessage } : {}),
    ...(providerCode !== undefined ? { providerCode } : {}),
    ...(providerHelpUrl ? { providerHelpUrl } : {}),
    ...(providerRaw ? { providerRaw } : {}),
  };
}

export function getToolCategory(toolName: string): AIToolCategory {
  // Strip "functions." prefix (some providers wrap tool names) and any
  // ":n" suffix (the AI SDK appends the call index when a tool runs
  // multiple times in one stream).
  const clean = toolName.replace(/^functions\./, '').split(':')[0];
  const category = TOOL_CATEGORY_MAP[clean];
  if (category) return category;
  // Unknown tools default to `modify` — the most cautious non-destructive
  // bucket. Better to prompt for review than auto-approve a side effect we
  // didn't plan for.
  return 'modify';
}

// --- Server-side approval gate (real human-in-the-loop) ---
//
// The category drives both the SSE event (so the frontend can apply its
// per-category policy) AND the backend gate. Gated categories block the
// executor on `awaitApproval` until the client posts a decision. Reads
// and navigation are never gated.
const GATED_CATEGORIES: ReadonlySet<AIToolCategory> = new Set<AIToolCategory>([
  'create',
  'modify',
  'delete',
]);

/** Whether a category must pass through the approval gate before running. */
export function isGatedCategory(category: AIToolCategory): boolean {
  return GATED_CATEGORIES.has(category);
}

/**
 * Per-request category resolver that honours MCP trust levels.
 *
 * Builtin tools resolve via TOOL_CATEGORY_MAP. MCP tools (name contains a
 * '.') consult the provided trust map: `auto` trust → `read` (non-gated,
 * auto-approve), `review` trust → `modify` (gated). Unknown non-MCP tools
 * fall back to `modify` so an unplanned side effect is reviewed, not run.
 *
 * `trustByName` is built once per chat request from
 * `mcpClientRegistry.listAllTools()` and threaded into every gating /
 * emitting decision so the trustLevel is never ignored (unlike the legacy
 * `getToolCategory`, which has no MCP context and treats MCP as `modify`).
 */
export function resolveToolCategory(
  toolName: string,
  trustByName: Map<string, 'auto' | 'review'>,
): AIToolCategory {
  // Strip provider wrappers / call-index suffixes the same way getToolCategory does.
  const clean = toolName.replace(/^functions\./, '').split(':')[0];
  const builtin = TOOL_CATEGORY_MAP[clean];
  if (builtin) return builtin;
  // MCP tools are namespaced `<connectionId>.<toolName>`.
  if (clean.includes('.')) {
    const trust = trustByName.get(clean);
    return trust === 'auto' ? 'read' : 'modify';
  }
  return 'modify';
}

/**
 * Build the per-request `toolName -> trustLevel` map from the MCP tool
 * definitions, so category resolution can honour each connection's trust.
 */
function buildMcpTrustMap(
  mcpTools: Array<{ name: string; trustLevel: 'auto' | 'review' }>,
): Map<string, 'auto' | 'review'> {
  const map = new Map<string, 'auto' | 'review'>();
  for (const t of mcpTools) map.set(t.name, t.trustLevel);
  return map;
}

/** Stable denied-result object returned to the model when the user rejects a tool. */
const DENIED_RESULT = { success: false, denied: true, message: 'Change rejected by user.' } as const;

// --- AI Configuration ---

interface AIConfig {
  provider: 'anthropic' | 'openai' | 'openai-compatible';
  model: string;
  apiKey: string;
  baseURL?: string;
  name?: string;
}

/**
 * Per-model pricing for the cost meter (#128). Keyed by model id.
 * Both fields are optional; when absent we emit token counts only and
 * the frontend hides the cost portion of the chip.
 */
interface AIPricingEntry {
  inputPerMillion?: number;
  outputPerMillion?: number;
}

/**
 * Look up `ai.pricing[<model>]` in dico-app.json. Returns undefined when
 * pricing is not configured — the cost meter is opt-in.
 */
function loadPricing(model: string): AIPricingEntry | undefined {
  const ai = getConfigSection<{ pricing?: Record<string, AIPricingEntry> }>('ai');
  return ai?.pricing?.[model];
}

function computeCost(
  inputTokens: number,
  outputTokens: number,
  pricing: AIPricingEntry | undefined,
): number | undefined {
  if (!pricing) return undefined;
  const inRate = pricing.inputPerMillion;
  const outRate = pricing.outputPerMillion;
  if (typeof inRate !== 'number' && typeof outRate !== 'number') return undefined;
  const inCost = typeof inRate === 'number' ? (inputTokens / 1_000_000) * inRate : 0;
  const outCost = typeof outRate === 'number' ? (outputTokens / 1_000_000) * outRate : 0;
  return inCost + outCost;
}

// AI_CONFIG_SOURCE=env forces env-only mode: skip the on-disk config entirely
// (for deployments that keep the key in a secret store and never touch ~/.dico-app).
// Audited (#125): cfg.apiKey is never logged or echoed to a response — only used
// to construct upstream provider clients and the Authorization header.
function loadAIConfig(): AIConfig | null {
  const envOnly = process.env.AI_CONFIG_SOURCE === 'env';

  if (!envOnly) {
    // 1. Try app config file (~/.dico-app/dico-app.json → ai section)
    const cfg = getConfigSection<AIConfig>('ai');
    if (cfg?.apiKey && cfg?.provider) {
      // openai-compatible has no sane default model — every backend
      // (OpenRouter, Mammouth, etc.) uses its own ids. Require explicit model.
      if (cfg.provider === 'openai-compatible' && !cfg.model) {
        return null;
      }
      const model = cfg.model || getDefaultModel(cfg.provider);
      if (!model) return null;
      return {
        provider: cfg.provider,
        model,
        apiKey: cfg.apiKey,
        baseURL: cfg.baseURL,
        name: cfg.name,
      };
    }
  }

  // 2. Fall back to env vars (sole source when AI_CONFIG_SOURCE=env)
  const apiKey = process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY;
  if (apiKey) {
    const provider = process.env.AI_PROVIDER || (process.env.ANTHROPIC_API_KEY ? 'anthropic' : 'openai');
    if (provider === 'openai-compatible' && !process.env.AI_MODEL) {
      return null;
    }
    const model = process.env.AI_MODEL || getDefaultModel(provider);
    if (!model) return null;
    return {
      provider: provider as AIConfig['provider'],
      model,
      apiKey,
      baseURL: process.env.AI_BASE_URL,
    };
  }

  return null;
}

function getDefaultModel(provider: string): string {
  switch (provider) {
    case 'anthropic': return 'claude-sonnet-4-6';
    case 'openai': return 'gpt-4o';
    // No default for openai-compatible — every backend uses different ids.
    case 'openai-compatible': return '';
    default: return '';
  }
}

function configReadyError(): string {
  const cfg = getConfigSection<AIConfig>('ai');
  if (cfg?.provider === 'openai-compatible' && !cfg.model) {
    return '`model` is required for `openai-compatible` provider. Edit ' + CONFIG_FILE + ' and set the model id used by your backend (e.g. `openai/gpt-4o-mini`).';
  }
  return `AI not configured. Use Settings page or create ${CONFIG_FILE}.`;
}

function saveAIConfig(cfg: AIConfig): void {
  setConfigSection('ai', cfg);
  logger.info(`AI config saved to ${CONFIG_FILE}`);
}

async function getModel() {
  const cfg = loadAIConfig();
  if (!cfg) throw new Error('AI not configured');

  if (cfg.provider === 'anthropic') {
    const { createAnthropic } = await import('@ai-sdk/anthropic');
    const provider = createAnthropic({ apiKey: cfg.apiKey });
    return provider(cfg.model);
  }

  // openai or openai-compatible (mammouth.ai, openrouter, etc.)
  const { createOpenAI } = await import('@ai-sdk/openai');
  const provider = createOpenAI({
    apiKey: cfg.apiKey,
    ...(cfg.baseURL ? { baseURL: cfg.baseURL } : {}),
  });
  return provider(cfg.model);
}

// Dynamic import of services (they use ESM)
async function getServices() {
  const { dictionaryService } = await import('../services/dictionaryService.js');
  const { serviceService } = await import('../services/serviceService.js');
  const { caseService } = await import('../services/caseService.js');
  const { stereotypeService } = await import('../services/stereotypeService.js');
  return { dictionaryService, serviceService, caseService, stereotypeService };
}

const SYSTEM_PROMPT = `You are an AI assistant for a Data Dictionary Management System. You help users create, modify, and analyze data models.

You have tools to:
- Create entities with attributes in a package
- Search and list existing entities
- Get entity details
- Create relationships between entities (cross-package is first-class)
- List stereotypes (metadata schemas for entities/attributes)
- Navigate the user to relevant pages (call listRoutes first if unsure of the URL shape)
- Discover the valid URL taxonomy (listRoutes)

When creating data models:
- Use meaningful names (PascalCase for entities, camelCase for attributes)
- Add descriptions for everything
- Set appropriate types (string, number, integer, boolean, date, datetime, enum)
- Mark primary keys and required fields
- Suggest stereotypes when applicable (aggregate-root, reference-data, event, value-object for entities)
- Create relationships with proper cardinality

Mutation tools take STRUCTURED parameters (not JSON strings):
- createEntity / updateEntity: { packageName, name, description?, stereotype?, attributes: [{ name, type, description?, required?, primaryKey?, enumValues? }] }. For updateEntity the provided description/stereotype/attributes become the new desired state.
- deleteEntity: { packageName, name }. Fails if the entity is still referenced by relationships — delete those relationships first (no auto-cascade).
- createRelationship / updateRelationship: { sourceEntityName, targetEntityName, sourcePackage?, targetPackage?, sourceCardinality, targetCardinality, description? }. Cardinality is "one" or "many".
- deleteRelationship: { packageName, sourceEntityName, targetEntityName } where packageName is the source entity's package.

Cross-package relationships are first-class. When source and target live in different packages, pass sourcePackage and targetPackage explicitly. The relationship is stored under the source's package. If sourcePackage/targetPackage are omitted the resolver scans every package and errors on ambiguity.

When the user asks to create a model:
1. Infer a package name from context (e.g. "e-commerce data model" → packageName: "e-commerce").
2. ALWAYS include packageName when creating entities. For relationships include sourcePackage/targetPackage when the endpoints span multiple packages.
3. Create ALL entities first, then ALL relationships.
4. After creating everything, use navigateTo to show the package page.

Be concise in your responses. Show a summary of what you created.`;

/**
 * Compose the system prompt, optionally weaving in a "Currently viewing …"
 * sentence supplied by the frontend (issue #58). The page-context line is
 * appended as a separate paragraph so it does not pollute the canonical
 * SYSTEM_PROMPT body — and it is sanitized so a malicious or runaway
 * frontend can't inject huge prompts.
 */
function buildSystemPrompt(pageContext?: string, conversationSystemPrompt?: string, mode: AIChatMode = 'designer'): string {
  // #127 — per-conversation override replaces the canonical body when set.
  // It still gets the page-context paragraph appended so cross-cutting hints
  // (current entity, package) don't get lost when the user customizes.
  const base = (typeof conversationSystemPrompt === 'string' && conversationSystemPrompt.trim().length > 0)
    ? conversationSystemPrompt.trim().slice(0, 8000)
    : SYSTEM_PROMPT;
  // #55 — append the mode-specific suffix BEFORE the page-context line so
  // the page context stays the last paragraph (the model is more likely
  // to weight late content for "what is the user looking at right now").
  const withMode = base + getModeSystemSuffix(mode);
  if (typeof pageContext === 'string') {
    const trimmed = pageContext.trim();
    if (trimmed.length > 0) {
      const safe = trimmed.slice(0, 500);
      return `${withMode}\n\nPage context: ${safe}`;
    }
  }
  return withMode;
}

// Direct chat handler for OpenAI-compatible providers (bypasses AI SDK)
async function handleDirectChat(req: Request, res: Response, cfg: AIConfig, rawMessages: any[], services: any, pageContext?: string, conversationSystemPrompt?: string, mode: AIChatMode = 'designer') {
  const { callWithTools } = await import('../utils/aiDirectClient.js');
  // Per-stream id used to target server-side tool-approval decisions. Emitted
  // to the client on the `start` event so the frontend can POST approvals.
  const streamId = crypto.randomUUID();
  // Wire request lifecycle to an AbortController so a client disconnect
  // (or an explicit /api/ai/chat fetch().abort()) breaks both the in-flight
  // fetch to the upstream provider and the surrounding tool-call loop.
  const ac = new AbortController();
  const onAbort = () => {
    ac.abort();
    // Release any executor parked on the approval gate so it unblocks
    // (resolves to 'deny') instead of leaking a promise after disconnect.
    abortStreamApprovals(streamId);
  };
  req.on('close', onAbort);
  req.on('aborted', onAbort);

  // Convert UIMessages to OpenAI format
  const messages: any[] = [
    { role: 'system', content: buildSystemPrompt(pageContext, conversationSystemPrompt, mode) },
  ];
  for (const msg of rawMessages) {
    const text = msg.parts?.find((p: any) => p.type === 'text')?.text || msg.content || '';
    if (text) messages.push({ role: msg.role, content: text });
  }

  // Build tool definitions
  const builtinToolDefs = [
    { type: 'function' as const, function: { name: 'createEntity', description: 'Create a new entity with attributes in a package. Structured fields: packageName, name, description, stereotype, attributes[].', parameters: createEntityParameters as Record<string, unknown> } },
    { type: 'function' as const, function: { name: 'updateEntity', description: 'Update an existing entity. description/stereotype/attributes become the new desired state; uuid and createdAt are preserved.', parameters: updateEntityParameters as Record<string, unknown> } },
    { type: 'function' as const, function: { name: 'deleteEntity', description: 'Delete an entity by package and name. Fails if still referenced by relationships (no auto-cascade).', parameters: deleteEntityParameters as Record<string, unknown> } },
    { type: 'function' as const, function: { name: 'createRelationship', description: 'Create a relationship between two entities. Cross-package is first-class; omit sourcePackage/targetPackage to scan all packages. Stored under the source entity\'s package.', parameters: createRelationshipParameters as Record<string, unknown> } },
    { type: 'function' as const, function: { name: 'updateRelationship', description: 'Update an existing relationship (resolved by matching source/target). Cardinalities and description become the new desired state.', parameters: updateRelationshipParameters as Record<string, unknown> } },
    { type: 'function' as const, function: { name: 'deleteRelationship', description: 'Delete a relationship by its package (source entity\'s package) and source/target entity names.', parameters: deleteRelationshipParameters as Record<string, unknown> } },
    { type: 'function' as const, function: { name: 'listEntities', description: 'List packages or entities in a package', parameters: { type: 'object', properties: { packageName: { type: 'string', description: 'Package name (omit to list all)' } } } } },
    { type: 'function' as const, function: { name: 'listStereotypes', description: 'List available stereotypes', parameters: { type: 'object', properties: {} } } },
    { type: 'function' as const, function: { name: 'navigateTo', description: 'Navigate user to a page. The path MUST be an absolute URL beginning with "/" that matches one of the patterns returned by listRoutes — call listRoutes first if you are unsure of the exact shape.', parameters: { type: 'object', required: ['path', 'reason'], properties: { path: { type: 'string' }, reason: { type: 'string' } } } } },
    { type: 'function' as const, function: { name: 'listRoutes', description: 'List every valid URL pattern in the app with a short description and (where useful) a concrete example. Call this BEFORE navigateTo if you are unsure of the exact path shape — e.g. plural vs singular, where attribute pages live, what the case route is.', parameters: { type: 'object', properties: {} } } },
  ];
  // #178 — merge MCP tools from enabled connections
  const mcpToolDefs = await mcpClientRegistry.listAllTools();
  const mcpFunctionDefs = mcpToolDefs.map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.inputSchema as Record<string, unknown>,
    },
  }));
  const allToolDefs = [...builtinToolDefs, ...mcpFunctionDefs];
  // #55 — drop write/navigate tools when the active mode forbids them.
  // MCP tools are always included in designer mode; excluded from ask/review.
  const toolDefs = allToolDefs.filter(t => isToolAllowedForMode(t.function.name, mode));

  // Per-request MCP trust map so category resolution (and thus the gate)
  // honours each connection's trustLevel rather than treating MCP as modify.
  const mcpTrust = buildMcpTrustMap(mcpToolDefs);

  // The real tool executor — performs the actual work. Wrapped by the
  // gating `executeTool` below, which blocks gated categories on human
  // approval before this ever runs.
  const runTool = async (name: string, args: any): Promise<any> => {
    try {
      const mutationServices = services as MutationServices;
      if (name === 'createEntity') {
        return await executeCreateEntity(args, mutationServices);
      }
      if (name === 'updateEntity') {
        return await executeUpdateEntity(args, mutationServices);
      }
      if (name === 'deleteEntity') {
        return await executeDeleteEntity(args, mutationServices);
      }
      if (name === 'createRelationship') {
        return await executeCreateRelationship(args, mutationServices);
      }
      if (name === 'updateRelationship') {
        return await executeUpdateRelationship(args, mutationServices);
      }
      if (name === 'deleteRelationship') {
        return await executeDeleteRelationship(args, mutationServices);
      }
      if (name === 'listEntities') {
        if (args.packageName) {
          const entities = await services.serviceService.getServiceEntities(args.packageName);
          return { entities: entities.map((e: any) => ({ name: e.name, description: e.description })) };
        }
        const { listMicroservices } = await import('../utils/fileOperations.js');
        return { packages: await listMicroservices() };
      }
      if (name === 'listStereotypes') {
        const stereotypes = await services.stereotypeService.getAllStereotypes();
        return { stereotypes: stereotypes.map((s: any) => ({ id: s.id, name: s.name, appliesTo: s.appliesTo, fields: s.metadataDefinitions?.map((m: any) => m.name) })) };
      }
      if (name === 'navigateTo') {
        return { navigate: args.path, reason: args.reason };
      }
      if (name === 'listRoutes') {
        const { KNOWN_ROUTES } = await import('./routesManifest.js');
        return { routes: KNOWN_ROUTES };
      }
      // #178 — MCP tools are namespaced as <connectionId>.<toolName>
      if (name.includes('.')) {
        return await mcpClientRegistry.callTool(name, args);
      }
      return { error: `Unknown tool: ${name}` };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  };

  // Gating executor: for gated categories (create/modify/delete, plus MCP
  // 'review'-trust tools) park on the server-side approval gate before
  // performing the real work. The tool-input events have already been
  // streamed by the onEvent('tool-start') handler below, so the frontend
  // has rendered the card and can POST approve/deny. On deny, return the
  // canonical rejected result WITHOUT running the real tool.
  const executeTool = async (name: string, args: any, toolCallId?: string): Promise<any> => {
    const category = resolveToolCategory(name, mcpTrust);
    if (isGatedCategory(category) && toolCallId) {
      const decision = await awaitApproval(streamId, toolCallId);
      if (decision === 'deny') {
        return { ...DENIED_RESULT };
      }
    }
    return runTool(name, args);
  };

  // Stream SSE events to frontend
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const sendEvent = (data: any) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  sendEvent({ type: 'start', streamId });

  try {
    const result = await callWithTools(
      { apiKey: cfg.apiKey, baseURL: cfg.baseURL!, model: cfg.model },
      messages,
      toolDefs,
      executeTool,
      AI_MAX_STEPS,
      (event) => {
        if (event.type === 'text') {
          const id = crypto.randomUUID();
          sendEvent({ type: 'text-start', id });
          // Split text into words for streaming effect
          for (const word of event.text.split(' ')) {
            sendEvent({ type: 'text-delta', id, delta: word + ' ' });
          }
        }
        if (event.type === 'tool-start') {
          // Emit tool category so the frontend can apply per-category
          // auto-approve policy without duplicating the switch (#59). Use the
          // trust-aware resolver so MCP tools honour their connection's
          // trustLevel rather than always reporting `modify`.
          const category = resolveToolCategory(event.name, mcpTrust);
          sendEvent({ type: 'tool-input-start', toolCallId: event.toolCallId, toolName: event.name, category });
          sendEvent({ type: 'tool-input-available', toolCallId: event.toolCallId, toolName: event.name, input: event.input, category });
        }
        if (event.type === 'tool-end') {
          sendEvent({ type: 'tool-output-available', toolCallId: event.toolCallId, output: event.output });
        }
      },
      ac.signal,
    );

    if (result.aborted) {
      sendEvent({ type: 'cancelled' });
    } else {
      // If there's final text after tool calls
      if (result.text && result.toolCalls.length > 0) {
        const id = crypto.randomUUID();
        sendEvent({ type: 'text-start', id });
        for (const word of result.text.split(' ')) {
          sendEvent({ type: 'text-delta', id, delta: word + ' ' });
        }
      }

      // Emit usage meter event (#128) before `done` so the frontend
      // header can update before the stream closes. callWithTools sums
      // usage across every step (incl. tool-call rounds).
      if (result.usage && (result.usage.inputTokens > 0 || result.usage.outputTokens > 0)) {
        const cost = computeCost(result.usage.inputTokens, result.usage.outputTokens, loadPricing(cfg.model));
        sendEvent({
          type: 'usage',
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
          model: cfg.model,
          provider: cfg.provider,
          ...(cost !== undefined ? { cost } : {}),
        });
      }

      // Visible, non-error notice that the turn ended because the agentic
      // loop hit its step budget (#192). The model's summary text was already
      // streamed above via the `text` event; this just flags the cause. Mirror
      // the `usage` event's placement — emitted right before `finish`.
      if (result.stoppedAtStepLimit) {
        sendEvent({ type: 'step-limit-reached', limit: AI_MAX_STEPS });
      }

      sendEvent({ type: 'finish', finishReason: 'stop' });
    }
  } catch (err: any) {
    if (ac.signal.aborted || err?.name === 'AbortError') {
      sendEvent({ type: 'cancelled' });
    } else {
      // Forward structured upstream-error fields when the direct client
      // attached them (#150) so the frontend can render a polished
      // explanation instead of `API error 402: {raw blob}`.
      sendEvent({
        type: 'error',
        errorText: err.message,
        ...(err.upstreamStatus ? { upstreamStatus: err.upstreamStatus } : {}),
        ...(err.providerMessage ? { providerMessage: err.providerMessage } : {}),
        ...(err.providerCode !== undefined ? { providerCode: err.providerCode } : {}),
        ...(err.providerHelpUrl ? { providerHelpUrl: err.providerHelpUrl } : {}),
        ...(err.providerRaw ? { providerRaw: err.providerRaw } : {}),
      });
    }
  } finally {
    req.off('close', onAbort);
    req.off('aborted', onAbort);
  }

  sendEvent({ type: 'done' });
  res.write('data: [DONE]\n\n');
  res.end();
}

export const aiChat = async (req: Request, res: Response) => {
  try {
    const cfg = loadAIConfig();
    if (!cfg) {
      return res.status(503).json({
        message: configReadyError(),
      });
    }

    const { messages: rawMessages, pageContext, systemPrompt: conversationSystemPrompt, mode: rawMode } = req.body;
    if (!rawMessages || !Array.isArray(rawMessages)) {
      return res.status(400).json({ message: 'messages array required' });
    }
    // #55 — mode gates which tools are exposed to the model and which
    // system-prompt suffix it sees. Default to 'designer' for back-compat
    // with pre-#55 clients that don't send the field.
    const mode: AIChatMode = isValidMode(rawMode) ? rawMode : 'designer';

    const services = await getServices();

    // #54 — resolve @entity / @package mentions in the latest user turn into a
    // short "Mentions: …" paragraph appended to whatever pageContext we have.
    const mentionsContext = await buildMentionsContext(rawMessages);
    const enrichedPageContext = (pageContext || '') + mentionsContext;

    // For OpenAI-compatible providers, use direct client (AI SDK has tool-calling bugs)
    if (cfg.provider === 'openai-compatible' && cfg.baseURL) {
      const { callWithTools } = await import('../utils/aiDirectClient.js');
      return await handleDirectChat(req, res, cfg, rawMessages, services, enrichedPageContext, conversationSystemPrompt, mode);
    }

    // For Anthropic/OpenAI, use Vercel AI SDK (works correctly)
    const model = await getModel();

    // #63 — context condensing. When the rolling input estimate crosses
    // the configured threshold, summarize the older portion of history
    // into a single synthetic turn before sending. Recent turns stay
    // verbatim so tool-call quality is preserved. The on-disk
    // conversation file is unaffected — we only rewrite the per-request
    // payload here.
    let condenseInfo: { condensedCount: number; estimatedTokens: number } | null = null;
    let effectiveRawMessages = rawMessages;
    try {
      const condenseCfg = getConfigSection<{ condensing?: { threshold?: number; enabled?: boolean } }>('ai');
      const enabled = condenseCfg?.condensing?.enabled !== false;
      const threshold = typeof condenseCfg?.condensing?.threshold === 'number'
        ? condenseCfg.condensing.threshold
        : undefined;
      if (enabled) {
        const { maybeCondense } = await import('../utils/contextCondensing.js');
        const result = await maybeCondense(rawMessages, model, threshold);
        if (result) {
          effectiveRawMessages = result.messages;
          condenseInfo = { condensedCount: result.condensedCount, estimatedTokens: result.estimatedTokens };
          logger.info(`AI context condensed: ${result.condensedCount} messages folded (~${result.estimatedTokens} tokens estimated)`);
        }
      }
    } catch (err: any) {
      // Condensing failure shouldn't block the chat — fall back to the
      // original messages and let the model handle (or fail on) the
      // overflow naturally.
      logger.warn(`AI context condensing failed; sending raw history. ${err?.message}`);
    }
    const messages = await convertToModelMessages(effectiveRawMessages);

    // Per-stream id for server-side tool approvals; emitted to the client
    // after headers flush (near the `condensed` event) so the frontend can
    // POST approve/deny targeting this stream.
    const streamId = crypto.randomUUID();
    // #178 — collect MCP tools for this request; build AI SDK tool() entries
    const mcpTools = await mcpClientRegistry.listAllTools();
    // Trust map so category resolution honours each MCP connection's trustLevel.
    const mcpTrust = buildMcpTrustMap(mcpTools);

    // Gate helper: for a gated category, park on the approval registry until
    // the client posts a decision, then either run the real work or return
    // the canonical rejected result. Non-gated categories never call this.
    const gate = async <T>(
      category: AIToolCategory,
      toolCallId: string | undefined,
      run: () => Promise<T>,
    ): Promise<T | typeof DENIED_RESULT> => {
      if (isGatedCategory(category) && toolCallId) {
        const decision = await awaitApproval(streamId, toolCallId);
        if (decision === 'deny') return { ...DENIED_RESULT };
      }
      return run();
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mcpToolEntries: Record<string, any> = {};
    for (const mcpTool of mcpTools) {
      const capturedTool = mcpTool;
      // The AI SDK's tool() generic over the schema's inferred input type
      // doesn't line up with our dynamic Record<string, unknown> execute
      // shape (MCP tool args are only known at runtime). Cast through any
      // — this is a deliberate type-erasure at the dynamic-registration
      // boundary; the JSON-schema validation still runs on the input.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mcpToolEntries[capturedTool.name] = tool({
        description: capturedTool.description,
        // Wrap JSON Schema in the AI SDK's jsonSchema() helper so it satisfies
        // the FlexibleSchema<INPUT> constraint. The MCP SDK ships JSON Schema
        // natively; no Zod conversion required.
        inputSchema: jsonSchema(capturedTool.inputSchema as import('@ai-sdk/provider').JSONSchema7),
        execute: (async (args: Record<string, unknown>, opts: { toolCallId?: string }) => {
          // MCP 'review'-trust tools resolve to the gated `modify` category;
          // 'auto'-trust tools resolve to non-gated `read` and skip the gate.
          const category = resolveToolCategory(capturedTool.name, mcpTrust);
          return await gate(category, opts?.toolCallId, () =>
            mcpClientRegistry.callTool(capturedTool.name, args),
          );
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        }) as any,
      });
    }

    // Wire request lifecycle to an AbortController so client disconnect
    // (Stop button, browser close) propagates into streamText and breaks
    // the agentic loop before the next tool call runs.
    const ac = new AbortController();
    const onAbort = () => {
      ac.abort();
      // Unblock any executor parked on the approval gate for this stream.
      abortStreamApprovals(streamId);
    };
    req.on('close', onAbort);
    req.on('aborted', onAbort);

    // Captured by the onFinish callback below and emitted as a `usage`
    // SSE event before [DONE] so the chat header meter can update
    // (#128). The AI SDK exposes `totalUsage` aggregated across all
    // steps, including intermediate tool-call rounds.
    let aggregatedUsage: { inputTokens: number; outputTokens: number } | null = null;

    // Captured by onFinish (#192): true only when the agentic loop ended by
    // exhausting its step budget while the model still wanted to call tools —
    // i.e. finishReason 'tool-calls' at the cap — rather than a natural 'stop'.
    let stoppedAtStepLimit = false;

    const result = streamText({
      model,
      system: buildSystemPrompt(enrichedPageContext, conversationSystemPrompt, mode),
      messages,
      abortSignal: ac.signal,
      onFinish: (event) => {
        const tu = event.totalUsage;
        if (tu) {
          aggregatedUsage = {
            inputTokens: tu.inputTokens ?? 0,
            outputTokens: tu.outputTokens ?? 0,
          };
        }
        // A natural finish is finishReason 'stop'; a cap-stop ends on
        // 'tool-calls' with all AI_MAX_STEPS steps consumed.
        stoppedAtStepLimit =
          event.finishReason === 'tool-calls' && event.steps.length >= AI_MAX_STEPS;
      },
      tools: filterToolsForMode({
        createEntity: tool({
          description: 'Create a new entity with attributes in a package. Provide structured fields (packageName, name, description, stereotype, attributes[]). Each attribute: { name, type, description, required, primaryKey, enumValues }.',
          inputSchema: createEntityInputSchema,
          execute: async (params, opts) => gate('create', opts?.toolCallId, async () => {
            const result = await executeCreateEntity(params, services as MutationServices);
            if (result.success) logger.info(`AI created entity: ${result.packageName}/${result.name}`);
            return result;
          }),
        }),

        updateEntity: tool({
          description: 'Update an existing entity. The provided description/stereotype/attributes become the new desired state; the entity uuid and createdAt are preserved. Same structured shape as createEntity.',
          inputSchema: updateEntityInputSchema,
          execute: async (params, opts) => gate('modify', opts?.toolCallId, async () => {
            const result = await executeUpdateEntity(params, services as MutationServices);
            if (result.success) logger.info(`AI updated entity: ${result.packageName}/${result.name}`);
            return result;
          }),
        }),

        deleteEntity: tool({
          description: 'Delete an entity by package and name. Fails (and reports) if the entity is still referenced by relationships — remove those relationships first; the tool never auto-cascades.',
          inputSchema: deleteEntityInputSchema,
          execute: async (params, opts) => gate('delete', opts?.toolCallId, async () => {
            const result = await executeDeleteEntity(params, services as MutationServices);
            if (result.success) logger.info(`AI deleted entity: ${result.packageName}/${result.name}`);
            return result;
          }),
        }),

        createRelationship: tool({
          description: 'Create a relationship between two entities. Endpoints may live in the same or different packages (cross-package is first-class). Provide sourceEntityName, targetEntityName, optional sourcePackage/targetPackage (omit to scan all packages, errors on ambiguity), sourceCardinality and targetCardinality (one|many), and an optional description. The relationship is stored under the source entity\'s package.',
          inputSchema: createRelationshipInputSchema,
          execute: async (params, opts) => gate('create', opts?.toolCallId, async () => {
            const result = await executeCreateRelationship(params, services as MutationServices);
            if (result.success) logger.info(`AI created relationship: ${result.name}`);
            return result;
          }),
        }),

        updateRelationship: tool({
          description: 'Update an existing relationship between two entities. The relationship is resolved by matching source/target entities; cardinalities and description become the new desired state.',
          inputSchema: updateRelationshipInputSchema,
          execute: async (params, opts) => gate('modify', opts?.toolCallId, async () => {
            const result = await executeUpdateRelationship(params, services as MutationServices);
            if (result.success) logger.info(`AI updated relationship: ${result.name}`);
            return result;
          }),
        }),

        deleteRelationship: tool({
          description: 'Delete a relationship by its package (the source entity\'s package) and the source/target entity names.',
          inputSchema: deleteRelationshipInputSchema,
          execute: async (params, opts) => gate('delete', opts?.toolCallId, async () => {
            const result = await executeDeleteRelationship(params, services as MutationServices);
            if (result.success) logger.info(`AI deleted relationship: ${result.name}`);
            return result;
          }),
        }),

        listEntities: tool({
          description: 'List all entities in a package or all packages',
          inputSchema: z.object({
            packageName: z.string().optional().describe('Package name, or omit to list all packages'),
          }),
          execute: async (params) => {
            try {
              if (params.packageName) {
                const entities = await services.serviceService.getServiceEntities(params.packageName || 'default');
                return { entities: entities.map((e: any) => ({ name: e.name, description: e.description, attrCount: e.attributes?.length || 0 })) };
              }
              const { listMicroservices } = await import('../utils/fileOperations.js');
              const packages = await listMicroservices();
              return { packages };
            } catch (err: any) {
              return { error: err.message };
            }
          },
        }),

        getEntityDetails: tool({
          description: 'Get detailed information about an entity including attributes and relationships',
          inputSchema: z.object({
            packageName: z.string(),
            entityName: z.string(),
          }),
          execute: async (params) => {
            try {
              const entity = await services.serviceService.getEntitySchema(params.packageName || 'default', params.entityName);
              if (!entity) return { error: 'Entity not found' };
              return {
                name: entity.name,
                description: entity.description,
                stereotype: entity.stereotype,
                attributes: entity.attributes?.map((a: any) => ({
                  name: a.name, type: a.type, description: a.description, required: a.required, primaryKey: a.primaryKey,
                })),
              };
            } catch (err: any) {
              return { error: err.message };
            }
          },
        }),

        listStereotypes: tool({
          description: 'List available stereotypes and their metadata definitions',
          inputSchema: z.object({}),
          execute: async () => {
            try {
              const stereotypes = await services.stereotypeService.getAllStereotypes();
              return { stereotypes: stereotypes.map((s: any) => ({
                id: s.id, name: s.name, appliesTo: s.appliesTo,
                fields: s.metadataDefinitions?.map((m: any) => m.name),
              })) };
            } catch (err: any) {
              return { error: err.message };
            }
          },
        }),

        navigateTo: tool({
          description: 'Navigate the user to a specific page in the application. The path MUST be an absolute URL beginning with "/" that matches one of the patterns returned by listRoutes — call listRoutes first if you are unsure of the exact shape. Common drift: singular vs plural ("/package/foo" → "/packages/foo"), entity URL is "/packages/<pkg>/entities/<Name>".',
          inputSchema: z.object({
            path: z.string().describe('Absolute URL path beginning with "/", matching a pattern from listRoutes. Example: /packages/order-service/entities/Order'),
            reason: z.string().describe('Why navigating here'),
          }),
          execute: async (params) => {
            return { navigate: params.path, reason: params.reason };
          },
        }),

        listRoutes: tool({
          description: 'List every valid URL pattern in the app with a short description and (where useful) a concrete example. Call this BEFORE navigateTo if you are unsure of the exact path shape — turning navigation into a lookup rather than a guess.',
          inputSchema: z.object({}),
          execute: async () => {
            const { KNOWN_ROUTES } = await import('./routesManifest.js');
            return { routes: KNOWN_ROUTES };
          },
        }),

        // #178 — MCP tools merged at chat-request time
        ...mcpToolEntries,
      }, mode),
      stopWhen: stepCountIs(AI_MAX_STEPS),
    });

    // Use toUIMessageStreamResponse and pipe to Express,
    // filtering out text-delta for missing text parts
    const response = result.toUIMessageStreamResponse();

    res.status(response.status || 200);
    response.headers.forEach((value: string, key: string) => {
      res.setHeader(key, value);
    });

    // #63 — emit a `condensed` event before any model output so the
    // frontend can render the "Context condensed" pill above the
    // assistant's response. Done lazily here (not earlier) because
    // headers must be flushed first; res.write before headers throws.
    if (condenseInfo) {
      try {
        res.write(`data: ${JSON.stringify({
          type: 'condensed',
          condensedCount: condenseInfo.condensedCount,
          estimatedTokens: condenseInfo.estimatedTokens,
        })}\n\n`);
      } catch { /* response may have closed already */ }
    }

    // Emit the stream id early so the frontend can target tool-approval
    // POSTs at this stream. The AI SDK's own UI-message stream has no
    // `start`-with-streamId hook, so we write a dedicated `stream-id` event
    // right after headers flush (res.write before headers throws).
    try {
      res.write(`data: ${JSON.stringify({ type: 'stream-id', streamId })}\n\n`);
    } catch { /* response may have closed already */ }

    if (response.body) {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      const seenTextParts = new Set<string>();

      const cleanup = () => {
        req.off('close', onAbort);
        req.off('aborted', onAbort);
      };

      const pump = async () => {
        while (true) {
          if (ac.signal.aborted) {
            // Emit final cancelled event before closing.
            try { res.write(`data: ${JSON.stringify({ type: 'cancelled' })}\n\n`); } catch { /* ok */ }
            try { reader.cancel(); } catch { /* ok */ }
            res.end();
            cleanup();
            break;
          }
          let chunk: { done: boolean; value?: Uint8Array };
          try {
            chunk = await reader.read();
          } catch (err: any) {
            if (ac.signal.aborted || err?.name === 'AbortError') {
              try { res.write(`data: ${JSON.stringify({ type: 'cancelled' })}\n\n`); } catch { /* ok */ }
              res.end();
              cleanup();
              break;
            }
            throw err;
          }
          const { done, value } = chunk;
          if (done) {
            // Graceful summary turn at the cap (#192). onFinish has already
            // run, so stoppedAtStepLimit is known. The main stream ended on a
            // dangling tool call; issue ONE more NON-streaming, tool-less
            // generateText seeded with the full prior history + a nudge, then
            // stream its text to the client with the same text-start /
            // text-delta shapes the frontend already consumes — BEFORE usage
            // and the step-limit-reached notice.
            if (stoppedAtStepLimit && !ac.signal.aborted) {
              try {
                const prior = await result.response;
                const summary = await generateText({
                  model,
                  system: buildSystemPrompt(enrichedPageContext, conversationSystemPrompt, mode),
                  messages: [
                    ...messages,
                    ...prior.messages,
                    {
                      role: 'user',
                      content:
                        "You've reached the step limit and can't call more tools. Summarize what you changed and list the remaining steps to finish.",
                    },
                  ],
                  // No tools — the model cannot call more this turn.
                  abortSignal: ac.signal,
                });
                if (summary.text) {
                  const summaryId = crypto.randomUUID();
                  res.write(`data: ${JSON.stringify({ type: 'text-start', id: summaryId })}\n\n`);
                  for (const word of summary.text.split(' ')) {
                    res.write(`data: ${JSON.stringify({ type: 'text-delta', id: summaryId, delta: word + ' ' })}\n\n`);
                  }
                  // Fold the summary turn's tokens into the running meter.
                  if (summary.usage && aggregatedUsage) {
                    aggregatedUsage = {
                      inputTokens: aggregatedUsage.inputTokens + (summary.usage.inputTokens ?? 0),
                      outputTokens: aggregatedUsage.outputTokens + (summary.usage.outputTokens ?? 0),
                    };
                  }
                }
              } catch (err) {
                // A failed summary turn must not break the stream; the
                // step-limit notice still fires below.
                logger.warn(`AI SDK summary turn failed: ${err instanceof Error ? err.message : String(err)}`);
              }
            }

            // Emit usage meter event (#128) right before closing the
            // stream, after the AI SDK's `finish` chunk so the frontend
            // sees it as the last meaningful payload. onFinish has
            // already run by this point; aggregatedUsage is populated
            // when the upstream provider returned a usage block.
            if (aggregatedUsage && (aggregatedUsage.inputTokens > 0 || aggregatedUsage.outputTokens > 0)) {
              const cost = computeCost(
                aggregatedUsage.inputTokens,
                aggregatedUsage.outputTokens,
                loadPricing(cfg.model),
              );
              try {
                res.write(`data: ${JSON.stringify({
                  type: 'usage',
                  inputTokens: aggregatedUsage.inputTokens,
                  outputTokens: aggregatedUsage.outputTokens,
                  model: cfg.model,
                  provider: cfg.provider,
                  ...(cost !== undefined ? { cost } : {}),
                })}\n\n`);
              } catch { /* response already closed */ }
            }
            // Visible, non-error notice that the loop hit its step budget
            // (#192). Mirrors the `usage` event placement — right before
            // the stream closes. The summary text was already streamed above.
            if (stoppedAtStepLimit) {
              try {
                res.write(`data: ${JSON.stringify({ type: 'step-limit-reached', limit: AI_MAX_STEPS })}\n\n`);
              } catch { /* response already closed */ }
            }
            res.end();
            cleanup();
            break;
          }

          const text = decoder.decode(value, { stream: true });

          // Process each SSE line to inject text-start before first text-delta
          const lines = text.split('\n');
          const output: string[] = [];

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6));
                // Filter out "text part not found" errors from the stream
                if (data.type === 'error' && data.errorText?.includes('not found')) {
                  continue;
                }
                // Enrich AI-SDK error events with structured upstream
                // fields when the errorText embeds a JSON body — same
                // treatment the openai-compatible direct path gets, so
                // the frontend can render a single polished card.
                if (
                  data.type === 'error' &&
                  typeof data.errorText === 'string' &&
                  data.providerMessage === undefined
                ) {
                  const enriched = enrichErrorEvent(data);
                  output.push(`data: ${JSON.stringify(enriched)}`);
                  continue;
                }
                if (data.type === 'text-delta' && data.id && !seenTextParts.has(data.id)) {
                  // Inject text-start before first text-delta for this part
                  seenTextParts.add(data.id);
                  output.push(`data: ${JSON.stringify({ type: 'text-start', id: data.id })}`);
                }
                // Inject tool category on tool-input events so the frontend
                // can drive per-category auto-approve without keeping its
                // own copy of the switch (#59).
                if (
                  (data.type === 'tool-input-start' || data.type === 'tool-input-available') &&
                  data.toolName &&
                  data.category === undefined
                ) {
                  const enriched = { ...data, category: resolveToolCategory(data.toolName, mcpTrust) };
                  output.push(`data: ${JSON.stringify(enriched)}`);
                  continue;
                }
              } catch {
                // Not JSON, pass through
              }
            }
            output.push(line);
          }

          res.write(output.join('\n'));
        }
      };

      pump().catch((err) => {
        logger.error(`AI stream error: ${err}`);
        cleanup();
        res.end();
      });
    } else {
      req.off('close', onAbort);
      req.off('aborted', onAbort);
      res.end();
    }

  } catch (err: any) {
    logger.error(`AI chat error: ${err.message}`);
    res.status(500).json({ message: 'AI chat error', error: err.message });
  }
};

/**
 * Resolve a server-side tool-approval gate. The chat stream blocks the
 * gated tool's executor on `awaitApproval`; this endpoint settles it so
 * the executor either runs the real mutation ('approve') or returns the
 * canonical rejected result ('deny'). Returns 404 when no matching gate is
 * pending (e.g. duplicate POST or the stream already aborted it).
 */
export const aiChatApprove = async (req: Request, res: Response) => {
  const { streamId, toolCallId, decision } = req.body ?? {};
  if (typeof streamId !== 'string' || typeof toolCallId !== 'string') {
    return res.status(400).json({ ok: false, message: 'streamId and toolCallId are required' });
  }
  if (decision !== 'approve' && decision !== 'deny') {
    return res.status(400).json({ ok: false, message: "decision must be 'approve' or 'deny'" });
  }
  const settled = settleApproval(streamId, toolCallId, decision);
  if (!settled) {
    return res.status(404).json({ ok: false, message: 'No pending approval for this stream/tool call' });
  }
  return res.json({ ok: true });
};

export const aiStatus = async (_req: Request, res: Response) => {
  const cfg = loadAIConfig();
  // configPath intentionally omitted (#125): the absolute path under the user's
  // home directory leaks layout. The path is backend-internal — the frontend
  // only needs to know whether AI is configured.
  res.json({
    available: !!cfg,
    provider: cfg?.provider || null,
    model: cfg?.model || null,
    name: cfg?.name || cfg?.provider || null,
    baseURL: cfg?.baseURL || null,
    ...(cfg ? {} : { message: configReadyError() }),
  });
};

export const aiGetConfig = async (_req: Request, res: Response) => {
  const cfg = loadAIConfig();
  res.json({
    provider: cfg?.provider || 'anthropic',
    model: cfg?.model || '',
    apiKey: cfg?.apiKey ? `${cfg.apiKey.slice(0, 8)}...${cfg.apiKey.slice(-4)}` : '',
    baseURL: cfg?.baseURL || '',
    name: cfg?.name || '',
    configPath: CONFIG_FILE,
  });
};

export const aiSaveConfig = async (req: Request, res: Response) => {
  try {
    const { provider, model, apiKey, baseURL, name } = req.body;
    if (!provider || !apiKey) {
      return res.status(400).json({ message: 'provider and apiKey are required' });
    }
    if (provider === 'openai-compatible' && !model) {
      return res.status(400).json({
        message: '`model` is required for `openai-compatible` provider (no portable default exists across backends).',
      });
    }
    const cfg: AIConfig = {
      provider,
      model: model || getDefaultModel(provider),
      apiKey,
      ...(baseURL ? { baseURL } : {}),
      ...(name ? { name } : {}),
    };
    saveAIConfig(cfg);
    res.json({ message: 'AI configuration saved', configPath: CONFIG_FILE });
  } catch (err: any) {
    res.status(500).json({ message: 'Failed to save config', error: err.message });
  }
};

// --- Debug: test tool calling with generateText (non-streaming) ---
export const aiTestTools = async (req: Request, res: Response) => {
  try {
    const model = await getModel();
    const result = await generateText({
      model,
      system: 'You are a helpful assistant. When asked to create something, use the createEntity tool.',
      messages: [{ role: 'user' as const, content: req.body.prompt || 'Create a Product entity in e-commerce with productId, name, price' }],
      tools: {
        createEntity: tool({
          description: 'Create an entity. entityJson is a JSON string.',
          inputSchema: z.object({
            entityJson: z.string().describe('JSON with name, packageName, attributes'),
          }),
          execute: async (params) => {
            return { received: params, success: true };
          },
        }),
      },
      stopWhen: stepCountIs(3),
    });
    res.json({
      text: result.text,
      toolCalls: result.steps.flatMap(s => s.toolCalls),
      toolResults: result.steps.flatMap(s => s.toolResults),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

// --- Tool definitions endpoint ---

export const aiTools = async (_req: Request, res: Response) => {
  const builtinTools = [
    {
      name: 'createEntity',
      description: 'Create a new entity with attributes in a package',
      source: 'builtin' as const,
      parameters: [
        { name: 'packageName', type: 'string', required: true, description: 'Package/service name' },
        { name: 'name', type: 'string', required: true, description: 'Entity name (PascalCase)' },
        { name: 'description', type: 'string', required: false, description: 'Entity description' },
        { name: 'stereotype', type: 'string', required: false, description: 'Stereotype: aggregate-root, reference-data, event, value-object' },
        { name: 'attributes', type: 'array', required: true, description: 'Array of {name, type, description, required, primaryKey?, enumValues?}' },
      ],
    },
    {
      name: 'updateEntity',
      description: 'Update an existing entity; provided fields become the new desired state (uuid/createdAt preserved)',
      source: 'builtin' as const,
      parameters: [
        { name: 'packageName', type: 'string', required: true, description: 'Package/service name' },
        { name: 'name', type: 'string', required: true, description: 'Entity name (PascalCase)' },
        { name: 'description', type: 'string', required: false, description: 'Entity description' },
        { name: 'stereotype', type: 'string', required: false, description: 'Stereotype id' },
        { name: 'attributes', type: 'array', required: true, description: 'New desired attribute set: {name, type, description, required, primaryKey?, enumValues?}' },
      ],
    },
    {
      name: 'deleteEntity',
      description: 'Delete an entity by package and name (fails if referenced by relationships)',
      source: 'builtin' as const,
      parameters: [
        { name: 'packageName', type: 'string', required: true, description: 'Package/service name' },
        { name: 'name', type: 'string', required: true, description: 'Entity name to delete' },
      ],
    },
    {
      name: 'createRelationship',
      description: 'Create a relationship between two entities. Endpoints may live in the same package or in different packages.',
      source: 'builtin' as const,
      parameters: [
        { name: 'sourceEntityName', type: 'string', required: true, description: 'Source entity name' },
        { name: 'targetEntityName', type: 'string', required: true, description: 'Target entity name' },
        { name: 'sourcePackage', type: 'string', required: false, description: 'Package containing the source entity (omit to scan all)' },
        { name: 'targetPackage', type: 'string', required: false, description: 'Package containing the target entity (omit to scan all)' },
        { name: 'description', type: 'string', required: false, description: 'Relationship description' },
        { name: 'sourceCardinality', type: 'one|many', required: true, description: 'Source cardinality' },
        { name: 'targetCardinality', type: 'one|many', required: true, description: 'Target cardinality' },
      ],
    },
    {
      name: 'updateRelationship',
      description: 'Update an existing relationship (resolved by matching source/target entities)',
      source: 'builtin' as const,
      parameters: [
        { name: 'sourceEntityName', type: 'string', required: true, description: 'Source entity name' },
        { name: 'targetEntityName', type: 'string', required: true, description: 'Target entity name' },
        { name: 'sourcePackage', type: 'string', required: false, description: 'Package containing the source entity (omit to scan all)' },
        { name: 'targetPackage', type: 'string', required: false, description: 'Package containing the target entity (omit to scan all)' },
        { name: 'description', type: 'string', required: false, description: 'Relationship description' },
        { name: 'sourceCardinality', type: 'one|many', required: true, description: 'Source cardinality' },
        { name: 'targetCardinality', type: 'one|many', required: true, description: 'Target cardinality' },
      ],
    },
    {
      name: 'deleteRelationship',
      description: 'Delete a relationship by its package (source entity\'s package) and source/target entity names',
      source: 'builtin' as const,
      parameters: [
        { name: 'packageName', type: 'string', required: true, description: "Package the relationship is stored under (source entity's package)" },
        { name: 'sourceEntityName', type: 'string', required: true, description: 'Source entity name' },
        { name: 'targetEntityName', type: 'string', required: true, description: 'Target entity name' },
      ],
    },
    {
      name: 'listEntities',
      description: 'List all entities in a package or all packages',
      source: 'builtin' as const,
      parameters: [
        { name: 'packageName', type: 'string', required: false, description: 'Package name (omit to list all packages)' },
      ],
    },
    {
      name: 'getEntityDetails',
      description: 'Get detailed info about an entity including attributes',
      source: 'builtin' as const,
      parameters: [
        { name: 'packageName', type: 'string', required: true, description: 'Package name' },
        { name: 'entityName', type: 'string', required: true, description: 'Entity name' },
      ],
    },
    {
      name: 'listStereotypes',
      description: 'List available stereotypes and their metadata definitions',
      source: 'builtin' as const,
      parameters: [],
    },
    {
      name: 'navigateTo',
      description: 'Navigate the user to a specific page. Path must match one of the patterns from listRoutes.',
      source: 'builtin' as const,
      parameters: [
        { name: 'path', type: 'string', required: true, description: 'Absolute URL path beginning with "/" (e.g. /packages/order-service/entities/Order)' },
        { name: 'reason', type: 'string', required: true, description: 'Why navigating here' },
      ],
    },
    {
      name: 'listRoutes',
      description: 'List every valid URL pattern in the app. Call before navigateTo when unsure of the exact path shape.',
      source: 'builtin' as const,
      parameters: [],
    },
  ];

  // #178 — append MCP tools with source: 'mcp' for frontend attribution.
  // connectionLabel is enriched here (not on McpToolDef) so the chat UI
  // can render "from <label>" without an extra round-trip for the
  // connection list. (#178 slice 3)
  let mcpToolsList: Array<{
    name: string;
    description: string;
    source: 'mcp';
    connectionId: string;
    connectionLabel: string;
    trustLevel: string;
    inputSchema: Record<string, unknown>;
  }> = [];
  try {
    const mcpTools = await mcpClientRegistry.listAllTools();
    const labelById = new Map(
      mcpClientRegistry.getConnections().map((c) => [c.id, c.label]),
    );
    mcpToolsList = mcpTools.map((t) => ({
      name: t.name,
      description: t.description,
      source: 'mcp' as const,
      connectionId: t.connectionId,
      connectionLabel: labelById.get(t.connectionId) ?? t.connectionId,
      trustLevel: t.trustLevel,
      inputSchema: t.inputSchema,
    }));
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(`[aiTools] Failed to list MCP tools: ${msg}`);
  }

  res.json({
    data: [...builtinTools, ...mcpToolsList],
  });
};

// --- Mentions (#54) ---
//
// Composer types `@foo` and the frontend hits this endpoint to populate a
// picker. Returns up to 8 entity matches + 8 package matches, ranked by
// case-insensitive prefix-then-substring on the name.
export const aiMentionsSearch = async (req: Request, res: Response) => {
  const q = String(req.query.q ?? '').trim().toLowerCase();
  if (!q) return res.json({ data: { entities: [], packages: [] } });
  try {
    const { listPackages, listAllEntities } = await import('../utils/fileOperations.js');
    const [packages, entities] = await Promise.all([listPackages(), listAllEntities()]);

    const rank = (name: string): number => {
      const n = name.toLowerCase();
      if (n === q) return 0;
      if (n.startsWith(q)) return 1;
      if (n.includes(q)) return 2;
      return 99;
    };

    const matchedPackages = packages
      .map(p => ({ name: p, rank: rank(p) }))
      .filter(p => p.rank < 99)
      .sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name))
      .slice(0, 8)
      .map(p => ({ name: p.name }));

    const matchedEntities = entities
      .map(e => ({ name: e.name, packageName: e.microservice, rank: rank(e.name) }))
      .filter(e => e.rank < 99)
      .sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name))
      .slice(0, 8)
      .map(({ name, packageName }) => ({ name, packageName }));

    res.json({ data: { entities: matchedEntities, packages: matchedPackages } });
  } catch (err: any) {
    logger.warn(`/api/ai/mentions/search failed: ${err?.message}`);
    res.json({ data: { entities: [], packages: [] } });
  }
};

/**
 * Scan the most recent user turn for @<word> tokens and resolve them to
 * known entities/packages. Returns a short "Mentions: …" paragraph the
 * caller can append to the system prompt for the current turn.
 *
 * Cap at 6 unique mentions to keep the system prompt bounded.
 */
async function buildMentionsContext(rawMessages: any[]): Promise<string> {
  const lastUser = [...rawMessages].reverse().find(m => m.role === 'user');
  if (!lastUser) return '';
  const text: string = lastUser.parts?.find((p: any) => p.type === 'text')?.text || lastUser.content || '';
  const tokens = Array.from(new Set((text.match(/@[A-Za-z][\w-]*/g) || []).map(t => t.slice(1)))).slice(0, 6);
  if (tokens.length === 0) return '';

  try {
    const { listPackages, listAllEntities } = await import('../utils/fileOperations.js');
    const [packages, entities] = await Promise.all([listPackages(), listAllEntities()]);
    const lines: string[] = [];
    for (const t of tokens) {
      const tl = t.toLowerCase();
      const ent = entities.find(e => e.name.toLowerCase() === tl);
      if (ent) { lines.push(`@${t} → entity ${ent.name} in package ${ent.microservice}`); continue; }
      const pkg = packages.find(p => p.toLowerCase() === tl);
      if (pkg) { lines.push(`@${t} → package ${pkg}`); continue; }
      // Unknown @-token: don't fabricate; quietly skip so we don't mislead the model.
    }
    return lines.length ? `\n\nMentions:\n${lines.join('\n')}` : '';
  } catch {
    return '';
  }
}

// --- Conversation persistence endpoints ---

export const listConversations = async (req: Request, res: Response) => {
  const q = typeof req.query.q === 'string' ? req.query.q : undefined;
  res.json({ data: await conversationService.list(q) });
};

export const getConversation = async (req: Request, res: Response) => {
  const conv = await conversationService.get(req.params.id);
  if (!conv) return res.status(404).json({ message: 'Conversation not found' });
  res.json({ data: conv });
};

export const saveConversation = async (req: Request, res: Response) => {
  try {
    await conversationService.save(req.body);
    res.json({ message: 'Conversation saved' });
  } catch (err: any) {
    res.status(500).json({ message: 'Failed to save', error: err.message });
  }
};

// #127 — patch user-editable fields (title rename, pinned, per-conversation
// system prompt). #55 also lets the client set the chat mode here.
export const patchConversation = async (req: Request, res: Response) => {
  const { title, pinned, systemPrompt, mode } = req.body || {};
  const conv = await conversationService.patch(req.params.id, { title, pinned, systemPrompt, mode });
  if (!conv) return res.status(404).json({ message: 'Conversation not found' });
  res.json({ data: conv });
};

export const deleteConversation = async (req: Request, res: Response) => {
  await conversationService.delete(req.params.id);
  res.json({ message: 'Conversation deleted' });
};

// --- Saved prompts endpoints (#123) ---

export const listPrompts = async (_req: Request, res: Response) => {
  res.json({ data: await promptService.list() });
};

export const getPrompt = async (req: Request, res: Response) => {
  const prompt = await promptService.get(req.params.id);
  if (!prompt) return res.status(404).json({ message: 'Prompt not found' });
  res.json({ data: prompt });
};

export const createPrompt = async (req: Request, res: Response) => {
  try {
    const { name, content } = req.body || {};
    if (typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ message: 'name is required' });
    }
    if (typeof content !== 'string') {
      return res.status(400).json({ message: 'content is required' });
    }
    const prompt = await promptService.create({ name, content });
    res.status(201).json({ data: prompt });
  } catch (err: any) {
    res.status(500).json({ message: 'Failed to create prompt', error: err.message });
  }
};

export const updatePrompt = async (req: Request, res: Response) => {
  try {
    const { name, content } = req.body || {};
    const updated = await promptService.update(req.params.id, { name, content });
    if (!updated) return res.status(404).json({ message: 'Prompt not found' });
    res.json({ data: updated });
  } catch (err: any) {
    res.status(500).json({ message: 'Failed to update prompt', error: err.message });
  }
};

export const deletePrompt = async (req: Request, res: Response) => {
  const ok = await promptService.delete(req.params.id);
  if (!ok) return res.status(404).json({ message: 'Prompt not found' });
  res.json({ message: 'Prompt deleted' });
};
