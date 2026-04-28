import { Request, Response } from 'express';
import { streamText, generateText, tool, stepCountIs, convertToModelMessages, createUIMessageStream, pipeUIMessageStreamToResponse } from 'ai';
import { z } from 'zod';
import { logger } from '../utils/logger.js';
import { config } from '../kernel/config.js';
import { getConfigSection, setConfigSection, CONFIG_FILE } from '../utils/appDir.js';
import { conversationService } from '../services/conversationService.js';
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

// Direct chat handler for OpenAI-compatible providers (bypasses AI SDK)
async function handleDirectChat(req: Request, res: Response, cfg: AIConfig, rawMessages: any[], services: any) {
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
    { role: 'system', content: SYSTEM_PROMPT },
  ];
  for (const msg of rawMessages) {
    const text = msg.parts?.find((p: any) => p.type === 'text')?.text || msg.content || '';
    if (text) messages.push({ role: msg.role, content: text });
  }

  // Build tool definitions
  const toolDefs = [
    { type: 'function' as const, function: { name: 'createEntity', description: 'Create an entity. entityJson is a JSON string with packageName, name, description, stereotype, attributes array.', parameters: { type: 'object', required: ['entityJson'], properties: { entityJson: { type: 'string', description: 'JSON: {"packageName":"pkg","name":"Entity","description":"...","attributes":[{"name":"id","type":"string","required":true,"primaryKey":true}]}' } } } } },
    { type: 'function' as const, function: { name: 'createRelationship', description: 'Create a relationship. JSON string parameter.', parameters: { type: 'object', required: ['relationshipJson'], properties: { relationshipJson: { type: 'string', description: 'JSON: {"packageName":"pkg","sourceEntityName":"A","targetEntityName":"B","sourceCardinality":"one","targetCardinality":"many","description":"..."}' } } } } },
    { type: 'function' as const, function: { name: 'listEntities', description: 'List packages or entities in a package', parameters: { type: 'object', properties: { packageName: { type: 'string', description: 'Package name (omit to list all)' } } } } },
    { type: 'function' as const, function: { name: 'listStereotypes', description: 'List available stereotypes', parameters: { type: 'object', properties: {} } } },
    { type: 'function' as const, function: { name: 'navigateTo', description: 'Navigate user to a page', parameters: { type: 'object', required: ['path', 'reason'], properties: { path: { type: 'string' }, reason: { type: 'string' } } } } },
  ];

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
        if (!existing.includes(pkgName)) ensurePackageDirectoryStructure(pkgName);

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

      sendEvent({ type: 'finish', finishReason: 'stop' });
    }
  } catch (err: any) {
    if (ac.signal.aborted || err?.name === 'AbortError') {
      sendEvent({ type: 'cancelled' });
    } else {
      sendEvent({ type: 'error', errorText: err.message });
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

    const { messages: rawMessages } = req.body;
    if (!rawMessages || !Array.isArray(rawMessages)) {
      return res.status(400).json({ message: 'messages array required' });
    }

    const services = await getServices();

    // For OpenAI-compatible providers, use direct client (AI SDK has tool-calling bugs)
    if (cfg.provider === 'openai-compatible' && cfg.baseURL) {
      const { callWithTools } = await import('../utils/aiDirectClient.js');
      return await handleDirectChat(req, res, cfg, rawMessages, services);
    }

    // For Anthropic/OpenAI, use Vercel AI SDK (works correctly)
    const messages = await convertToModelMessages(rawMessages);
    const model = await getModel();

    // Wire request lifecycle to an AbortController so client disconnect
    // (Stop button, browser close) propagates into streamText and breaks
    // the agentic loop before the next tool call runs.
    const ac = new AbortController();
    const onAbort = () => ac.abort();
    req.on('close', onAbort);
    req.on('aborted', onAbort);

    const result = streamText({
      model,
      system: SYSTEM_PROMPT,
      messages,
      abortSignal: ac.signal,
      tools: {
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
                ensurePackageDirectoryStructure(pkgName);
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
      },
      stopWhen: stepCountIs(20),
    });

    // Use toUIMessageStreamResponse and pipe to Express,
    // filtering out text-delta for missing text parts
    const response = result.toUIMessageStreamResponse();

    res.status(response.status || 200);
    response.headers.forEach((value: string, key: string) => {
      res.setHeader(key, value);
    });

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
          if (done) { res.end(); cleanup(); break; }

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

// --- Conversation persistence endpoints ---

export const listConversations = async (_req: Request, res: Response) => {
  res.json({ data: conversationService.list() });
};

export const getConversation = async (req: Request, res: Response) => {
  const conv = conversationService.get(req.params.id);
  if (!conv) return res.status(404).json({ message: 'Conversation not found' });
  res.json({ data: conv });
};

export const saveConversation = async (req: Request, res: Response) => {
  try {
    conversationService.save(req.body);
    res.json({ message: 'Conversation saved' });
  } catch (err: any) {
    res.status(500).json({ message: 'Failed to save', error: err.message });
  }
};

export const deleteConversation = async (req: Request, res: Response) => {
  conversationService.delete(req.params.id);
  res.json({ message: 'Conversation deleted' });
};
