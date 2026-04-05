import { Request, Response } from 'express';
import { streamText, tool, convertToModelMessages, createUIMessageStream, pipeUIMessageStreamToResponse } from 'ai';
import { z } from 'zod';
import { logger } from '../utils/logger.js';
import { config } from '../kernel/config.js';
import { getConfigSection, setConfigSection, CONFIG_FILE } from '../utils/appDir.js';
import { conversationService } from '../services/conversationService.js';

// --- AI Configuration ---

interface AIConfig {
  provider: 'anthropic' | 'openai' | 'openai-compatible';
  model: string;
  apiKey: string;
  baseURL?: string;
  name?: string;
}

function loadAIConfig(): AIConfig | null {
  // 1. Try app config file (~/.dico-app/dico-app.json → ai section)
  const cfg = getConfigSection<AIConfig>('ai');
  if (cfg?.apiKey && cfg?.provider) {
    return {
      provider: cfg.provider,
      model: cfg.model || getDefaultModel(cfg.provider),
      apiKey: cfg.apiKey,
      baseURL: cfg.baseURL,
      name: cfg.name,
    };
  }

  // 2. Fall back to env vars
  const apiKey = process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY;
  if (apiKey) {
    const provider = process.env.AI_PROVIDER || (process.env.ANTHROPIC_API_KEY ? 'anthropic' : 'openai');
    return {
      provider: provider as AIConfig['provider'],
      model: process.env.AI_MODEL || getDefaultModel(provider),
      apiKey,
      baseURL: process.env.AI_BASE_URL,
    };
  }

  return null;
}

function getDefaultModel(provider: string): string {
  switch (provider) {
    case 'anthropic': return 'claude-sonnet-4-5-20250514';
    case 'openai': return 'gpt-4o';
    case 'openai-compatible': return 'gpt-4o';
    default: return 'gpt-4o';
  }
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
  const { perspectiveService } = await import('../services/perspectiveService.js');
  const { stereotypeService } = await import('../services/stereotypeService.js');
  return { dictionaryService, serviceService, perspectiveService, stereotypeService };
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

export const aiChat = async (req: Request, res: Response) => {
  try {
    const cfg = loadAIConfig();
    if (!cfg) {
      return res.status(503).json({
        message: 'AI not configured. Use Settings page or create ~/.cfg/ai-config.json.',
      });
    }

    const { messages: rawMessages } = req.body;
    if (!rawMessages || !Array.isArray(rawMessages)) {
      return res.status(400).json({ message: 'messages array required' });
    }

    // Convert UIMessages (from @ai-sdk/react v3) to ModelMessages (for streamText)
    const messages = await convertToModelMessages(rawMessages);

    const model = await getModel();
    const services = await getServices();

    const result = streamText({
      model,
      system: SYSTEM_PROMPT,
      messages,
      tools: {
        createEntity: tool({
          description: 'Create a new entity with attributes in a package. The entityJson parameter must be a JSON string with this structure: {"packageName":"pkg","name":"EntityName","description":"...","stereotype":"aggregate-root","attributes":[{"name":"id","type":"string","description":"...","required":true,"primaryKey":true}]}',
          parameters: z.object({
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
              const { listMicroservices, ensureDirectoryStructure } = await import('../utils/fileOperations.js');
              const existingServices = await listMicroservices();
              if (!existingServices.includes(pkgName)) {
                await ensureDirectoryStructure(pkgName);
              }

              const attrs = (parsed.attributes || []).map((a: any) => ({
                uuid: crypto.randomUUID(),
                name: a.name,
                type: a.type || 'string',
                description: a.description || '',
                required: a.required ?? false,
                primaryKey: a.primaryKey,
                constraints: a.enumValues ? { enumValues: a.enumValues } : undefined,
              }));

              const entity = {
                uuid: crypto.randomUUID(),
                name: parsed.name,
                description: parsed.description || '',
                stereotype: parsed.stereotype,
                status: 'draft',
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
          parameters: z.object({
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
          parameters: z.object({
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
          parameters: z.object({
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
          parameters: z.object({}),
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
          parameters: z.object({
            path: z.string().describe('The URL path to navigate to, e.g. /packages/e-commerce or /diagram'),
            reason: z.string().describe('Why navigating here'),
          }),
          execute: async (params) => {
            return { navigate: params.path, reason: params.reason };
          },
        }),
      },
      maxSteps: 20,
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

      const pump = async () => {
        while (true) {
          const { done, value } = await reader.read();
          if (done) { res.end(); break; }

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
        res.end();
      });
    } else {
      res.end();
    }

  } catch (err: any) {
    logger.error(`AI chat error: ${err.message}`);
    res.status(500).json({ message: 'AI chat error', error: err.message });
  }
};

export const aiStatus = async (_req: Request, res: Response) => {
  const cfg = loadAIConfig();
  res.json({
    available: !!cfg,
    provider: cfg?.provider || null,
    model: cfg?.model || null,
    name: cfg?.name || cfg?.provider || null,
    baseURL: cfg?.baseURL || null,
    configPath: CONFIG_FILE,
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
