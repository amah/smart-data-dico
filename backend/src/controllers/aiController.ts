import { Request, Response } from 'express';
import { streamText, generateText, tool, stepCountIs, convertToModelMessages, createUIMessageStream, pipeUIMessageStreamToResponse } from 'ai';
import { z } from 'zod';
import { logger } from '../utils/logger.js';
import { config } from '../kernel/config.js';
import { getConfigSection, setConfigSection, CONFIG_FILE } from '../utils/appDir.js';
import { conversationService } from '../services/conversationService.js';
import { promptService } from '../services/promptService.js';
import { EntityStatus } from '../models/EntitySchema.js';

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
- Create relationships between entities
- List stereotypes (metadata schemas for entities/attributes)
- Navigate the user to relevant pages

When creating data models:
- Use meaningful names (PascalCase for entities, camelCase for attributes)
- Add descriptions for everything
- Set appropriate types (string, number, integer, boolean, date, datetime, enum)
- Mark primary keys and required fields
- Suggest stereotypes when applicable (aggregate-root, reference-data, event, value-object for entities)
- Create relationships with proper cardinality

IMPORTANT: For createEntity and createRelationship tools, you must pass a SINGLE parameter called entityJson or relationshipJson containing a valid JSON string with all the data.

Example createEntity call:
entityJson: '{"packageName":"e-commerce","name":"Product","description":"A product in the catalog","stereotype":"aggregate-root","attributes":[{"name":"productId","type":"string","description":"Unique product ID","required":true,"primaryKey":true},{"name":"name","type":"string","description":"Product name","required":true},{"name":"price","type":"number","description":"Product price","required":true}]}'

When the user asks to create a model:
1. Infer a package name from context (e.g. "e-commerce data model" → packageName: "e-commerce").
2. ALWAYS include packageName in every entityJson and relationshipJson.
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
  // Wire request lifecycle to an AbortController so a client disconnect
  // (or an explicit /api/ai/chat fetch().abort()) breaks both the in-flight
  // fetch to the upstream provider and the surrounding tool-call loop.
  const ac = new AbortController();
  const onAbort = () => ac.abort();
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
  const allToolDefs = [
    { type: 'function' as const, function: { name: 'createEntity', description: 'Create an entity. entityJson is a JSON string with packageName, name, description, stereotype, attributes array.', parameters: { type: 'object', required: ['entityJson'], properties: { entityJson: { type: 'string', description: 'JSON: {"packageName":"pkg","name":"Entity","description":"...","attributes":[{"name":"id","type":"string","required":true,"primaryKey":true}]}' } } } } },
    { type: 'function' as const, function: { name: 'createRelationship', description: 'Create a relationship. JSON string parameter.', parameters: { type: 'object', required: ['relationshipJson'], properties: { relationshipJson: { type: 'string', description: 'JSON: {"packageName":"pkg","sourceEntityName":"A","targetEntityName":"B","sourceCardinality":"one","targetCardinality":"many","description":"..."}' } } } } },
    { type: 'function' as const, function: { name: 'listEntities', description: 'List packages or entities in a package', parameters: { type: 'object', properties: { packageName: { type: 'string', description: 'Package name (omit to list all)' } } } } },
    { type: 'function' as const, function: { name: 'listStereotypes', description: 'List available stereotypes', parameters: { type: 'object', properties: {} } } },
    { type: 'function' as const, function: { name: 'navigateTo', description: 'Navigate user to a page', parameters: { type: 'object', required: ['path', 'reason'], properties: { path: { type: 'string' }, reason: { type: 'string' } } } } },
  ];
  // #55 — drop write/navigate tools when the active mode forbids them.
  const toolDefs = allToolDefs.filter(t => isToolAllowedForMode(t.function.name, mode));

  // Tool executor
  const executeTool = async (name: string, args: any): Promise<any> => {
    try {
      if (name === 'createEntity') {
        let parsed: any;
        try { parsed = JSON.parse(args.entityJson || '{}'); } catch { return { success: false, error: 'Invalid JSON' }; }
        if (!parsed.name || !parsed.attributes) return { success: false, error: 'Missing name or attributes' };

        const pkgName = parsed.packageName || 'default';
        const { listPackages, ensurePackageDirectoryStructure } = await import('../utils/fileOperations.js');
        const existing = await listPackages();
        if (!existing.includes(pkgName)) await ensurePackageDirectoryStructure(pkgName);

        const entity = {
          uuid: crypto.randomUUID(),
          name: parsed.name,
          description: parsed.description || '',
          stereotype: parsed.stereotype,
          status: 'draft',
          attributes: (parsed.attributes || []).map((a: any) => ({
            uuid: crypto.randomUUID(), name: a.name, type: a.type || 'string',
            description: a.description || '', required: a.required ?? false, primaryKey: a.primaryKey,
            validation: a.enumValues ? { enumValues: a.enumValues } : undefined,
          })),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        await services.serviceService.createEntity(pkgName, entity);
        return { success: true, message: `Created entity ${parsed.name} with ${entity.attributes.length} attributes`, navigate: `/packages/${pkgName}/entities/${parsed.name}` };
      }
      if (name === 'createRelationship') {
        let p: any;
        try { p = JSON.parse(args.relationshipJson || '{}'); } catch { return { success: false, error: 'Invalid JSON' }; }
        if (!p.sourceEntityName || !p.targetEntityName) return { success: false, error: 'Missing entity names' };
        const pkgName = p.packageName || 'default';
        const src = await services.serviceService.getEntitySchema(pkgName, p.sourceEntityName);
        const tgt = await services.serviceService.getEntitySchema(pkgName, p.targetEntityName);
        if (!src || !tgt) return { success: false, error: `Entity not found` };
        await services.serviceService.createRelationship(pkgName, {
          uuid: crypto.randomUUID(), description: p.description || '',
          source: { entity: src.uuid, cardinality: p.sourceCardinality || 'one' },
          target: { entity: tgt.uuid, cardinality: p.targetCardinality || 'many' },
        });
        return { success: true, message: `Created relationship: ${p.sourceEntityName} -> ${p.targetEntityName}` };
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
      return { error: `Unknown tool: ${name}` };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  };

  // Stream SSE events to frontend
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const sendEvent = (data: any) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  sendEvent({ type: 'start' });

  try {
    const result = await callWithTools(
      { apiKey: cfg.apiKey, baseURL: cfg.baseURL!, model: cfg.model },
      messages,
      toolDefs,
      executeTool,
      15,
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
          // auto-approve policy without duplicating the switch (#59).
          const category = getToolCategory(event.name);
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

    // Wire request lifecycle to an AbortController so client disconnect
    // (Stop button, browser close) propagates into streamText and breaks
    // the agentic loop before the next tool call runs.
    const ac = new AbortController();
    const onAbort = () => ac.abort();
    req.on('close', onAbort);
    req.on('aborted', onAbort);

    // Captured by the onFinish callback below and emitted as a `usage`
    // SSE event before [DONE] so the chat header meter can update
    // (#128). The AI SDK exposes `totalUsage` aggregated across all
    // steps, including intermediate tool-call rounds.
    let aggregatedUsage: { inputTokens: number; outputTokens: number } | null = null;

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
      },
      tools: filterToolsForMode({
        createEntity: tool({
          description: 'Create a new entity with attributes in a package. The entityJson parameter must be a JSON string with this structure: {"packageName":"pkg","name":"EntityName","description":"...","stereotype":"aggregate-root","attributes":[{"name":"id","type":"string","description":"...","required":true,"primaryKey":true}]}',
          inputSchema: z.object({
            entityJson: z.string().describe('JSON string containing packageName, name, description, stereotype (optional), and attributes array. Each attribute has name, type, description, required, primaryKey (optional), enumValues (optional).'),
          }),
          execute: async (params) => {
            try {
              let parsed: any;
              try {
                parsed = JSON.parse(params.entityJson || '{}');
              } catch {
                return { success: false, error: 'Invalid JSON in entityJson parameter' };
              }
              if (!parsed.name || !parsed.attributes) {
                return {
                  success: false,
                  error: 'entityJson must contain name and attributes. Example: {"packageName":"e-commerce","name":"Product","description":"...","attributes":[{"name":"id","type":"string","description":"...","required":true}]}',
                };
              }
              const pkgName = parsed.packageName || 'default';
              const { listPackages, ensurePackageDirectoryStructure } = await import('../utils/fileOperations.js');
              const existingServices = await listPackages();
              if (!existingServices.includes(pkgName)) {
                await ensurePackageDirectoryStructure(pkgName);
              }

              const attrs = (parsed.attributes || []).map((a: any) => ({
                uuid: crypto.randomUUID(),
                name: a.name,
                type: a.type || 'string',
                description: a.description || '',
                required: a.required ?? false,
                primaryKey: a.primaryKey,
                validation: a.enumValues ? { enumValues: a.enumValues } : undefined,
              }));

              const entity = {
                uuid: crypto.randomUUID(),
                name: parsed.name,
                description: parsed.description || '',
                stereotype: parsed.stereotype,
                status: EntityStatus.DRAFT,
                attributes: attrs,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              };

              await services.serviceService.createEntity(pkgName, entity);
              logger.info(`AI created entity: ${pkgName}/${parsed.name}`);
              return {
                success: true,
                message: `Created entity ${parsed.name} with ${attrs.length} attributes`,
                navigate: `/packages/${pkgName}/entities/${parsed.name}`,
              };
            } catch (err: any) {
              return { success: false, error: err.message };
            }
          },
        }),

        createRelationship: tool({
          description: 'Create a relationship. Pass a JSON string: {"packageName":"pkg","sourceEntityName":"Order","targetEntityName":"Customer","description":"...","sourceCardinality":"many","targetCardinality":"one"}',
          inputSchema: z.object({
            relationshipJson: z.string().describe('JSON string with packageName, sourceEntityName, targetEntityName, description, sourceCardinality (one|many), targetCardinality (one|many)'),
          }),
          execute: async (params) => {
            try {
              let p: any;
              try { p = JSON.parse(params.relationshipJson || '{}'); } catch { return { success: false, error: 'Invalid JSON in relationshipJson' }; }
              if (!p.sourceEntityName || !p.targetEntityName) {
                return { success: false, error: 'Missing sourceEntityName or targetEntityName in JSON' };
              }
              const pkgName = p.packageName || 'default';
              const sourceEntity = await services.serviceService.getEntitySchema(pkgName, p.sourceEntityName);
              const targetEntity = await services.serviceService.getEntitySchema(pkgName, p.targetEntityName);

              if (!sourceEntity || !targetEntity) {
                return { success: false, error: `Entity not found: ${!sourceEntity ? p.sourceEntityName : p.targetEntityName}` };
              }

              const relationship = {
                uuid: crypto.randomUUID(),
                description: p.description || '',
                source: { entity: sourceEntity.uuid, cardinality: p.sourceCardinality || 'one' },
                target: { entity: targetEntity.uuid, cardinality: p.targetCardinality || 'many' },
              };
              await services.serviceService.createRelationship(pkgName, relationship);
              logger.info(`AI created relationship: ${p.sourceEntityName} -> ${p.targetEntityName}`);
              return { success: true, message: `Created relationship: ${p.sourceEntityName} -> ${p.targetEntityName}` };
            } catch (err: any) {
              return { success: false, error: err.message };
            }
          },
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
          description: 'Navigate the user to a specific page in the application',
          inputSchema: z.object({
            path: z.string().describe('The URL path to navigate to, e.g. /packages/e-commerce or /diagram'),
            reason: z.string().describe('Why navigating here'),
          }),
          execute: async (params) => {
            return { navigate: params.path, reason: params.reason };
          },
        }),
      }, mode),
      stopWhen: stepCountIs(20),
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
                  const enriched = { ...data, category: getToolCategory(data.toolName) };
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
  res.json({
    data: [
      {
        name: 'createEntity',
        description: 'Create a new entity with attributes in a package',
        parameters: [
          { name: 'packageName', type: 'string', required: true, description: 'Package/service name' },
          { name: 'name', type: 'string', required: true, description: 'Entity name (PascalCase)' },
          { name: 'description', type: 'string', required: true, description: 'Entity description' },
          { name: 'stereotype', type: 'string', required: false, description: 'Stereotype: aggregate-root, reference-data, event, value-object' },
          { name: 'attributes', type: 'array', required: true, description: 'Array of {name, type, description, required, primaryKey?, enumValues?}' },
        ],
      },
      {
        name: 'createRelationship',
        description: 'Create a relationship between two entities',
        parameters: [
          { name: 'packageName', type: 'string', required: true, description: 'Package name' },
          { name: 'sourceEntityName', type: 'string', required: true, description: 'Source entity name' },
          { name: 'targetEntityName', type: 'string', required: true, description: 'Target entity name' },
          { name: 'description', type: 'string', required: true, description: 'Relationship description' },
          { name: 'sourceCardinality', type: 'one|many', required: true, description: 'Source cardinality' },
          { name: 'targetCardinality', type: 'one|many', required: true, description: 'Target cardinality' },
        ],
      },
      {
        name: 'listEntities',
        description: 'List all entities in a package or all packages',
        parameters: [
          { name: 'packageName', type: 'string', required: false, description: 'Package name (omit to list all packages)' },
        ],
      },
      {
        name: 'getEntityDetails',
        description: 'Get detailed info about an entity including attributes',
        parameters: [
          { name: 'packageName', type: 'string', required: true, description: 'Package name' },
          { name: 'entityName', type: 'string', required: true, description: 'Entity name' },
        ],
      },
      {
        name: 'listStereotypes',
        description: 'List available stereotypes and their metadata definitions',
        parameters: [],
      },
      {
        name: 'navigateTo',
        description: 'Navigate the user to a specific page',
        parameters: [
          { name: 'path', type: 'string', required: true, description: 'URL path (e.g. /packages/e-commerce)' },
          { name: 'reason', type: 'string', required: true, description: 'Why navigating here' },
        ],
      },
    ],
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
