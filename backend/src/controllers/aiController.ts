import { Request, Response } from 'express';
import { streamText, tool, convertToModelMessages } from 'ai';
import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { logger } from '../utils/logger.js';
import { config } from '../kernel/config.js';

// --- AI Configuration ---

interface AIConfig {
  provider: 'anthropic' | 'openai' | 'openai-compatible';
  model: string;
  apiKey: string;
  baseURL?: string; // For OpenAI-compatible endpoints
  name?: string;    // Display name for the provider
}

const CONFIG_PATH = path.join(os.homedir(), '.cfg', 'ai-config.json');

function loadAIConfig(): AIConfig | null {
  // 1. Try config file
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
      if (raw.apiKey && raw.provider) {
        return {
          provider: raw.provider,
          model: raw.model || getDefaultModel(raw.provider),
          apiKey: raw.apiKey,
          baseURL: raw.baseURL,
          name: raw.name,
        };
      }
    }
  } catch (err) {
    logger.warn(`Failed to read AI config from ${CONFIG_PATH}: ${err}`);
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
  const dir = path.dirname(CONFIG_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf8');
  logger.info(`AI config saved to ${CONFIG_PATH}`);
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
  const { default: serviceService } = await import('../services/serviceService.js');
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

When the user asks to create a model, create ALL entities first, then ALL relationships.
After creating entities, use the navigateTo tool to show the user the result.

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
          description: 'Create a new entity with attributes in a package. Returns the created entity.',
          parameters: z.object({
            packageName: z.string().describe('The package/service name to create the entity in'),
            name: z.string().describe('Entity name in PascalCase'),
            description: z.string().describe('Entity description'),
            stereotype: z.string().optional().describe('Stereotype id: aggregate-root, reference-data, event, value-object'),
            attributes: z.array(z.object({
              name: z.string().describe('Attribute name in camelCase'),
              type: z.string().describe('Type: string, number, integer, boolean, date, datetime, enum'),
              description: z.string().describe('Attribute description'),
              required: z.boolean().describe('Whether required'),
              primaryKey: z.boolean().optional().describe('Whether this is a primary key'),
              enumValues: z.array(z.string()).optional().describe('Enum values if type is enum'),
            })),
          }),
          execute: async (params) => {
            try {
              const { listMicroservices, ensureDirectoryStructure } = await import('../utils/fileOperations.js');
              const existingServices = await listMicroservices();
              if (!existingServices.includes(params.packageName)) {
                await ensureDirectoryStructure(params.packageName);
              }

              const entity = {
                uuid: crypto.randomUUID(),
                name: params.name,
                description: params.description,
                stereotype: params.stereotype,
                status: 'draft',
                attributes: params.attributes.map(a => ({
                  uuid: crypto.randomUUID(),
                  name: a.name,
                  type: a.type,
                  description: a.description,
                  required: a.required,
                  primaryKey: a.primaryKey,
                  constraints: a.enumValues ? { enumValues: a.enumValues } : undefined,
                })),
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              };

              await services.serviceService.createEntity(params.packageName, entity);
              logger.info(`AI created entity: ${params.packageName}/${params.name}`);
              return {
                success: true,
                message: `Created entity ${params.name} with ${params.attributes.length} attributes`,
                navigate: `/packages/${params.packageName}/entities/${params.name}`,
              };
            } catch (err: any) {
              return { success: false, error: err.message };
            }
          },
        }),

        createRelationship: tool({
          description: 'Create a relationship between two entities in the same package',
          parameters: z.object({
            packageName: z.string().describe('The package name'),
            sourceEntityName: z.string().describe('Source entity name'),
            targetEntityName: z.string().describe('Target entity name'),
            description: z.string().describe('Relationship description'),
            sourceCardinality: z.enum(['one', 'many']).describe('Source cardinality'),
            targetCardinality: z.enum(['one', 'many']).describe('Target cardinality'),
          }),
          execute: async (params) => {
            try {
              // Look up entity UUIDs
              const sourceEntity = await services.serviceService.getEntitySchema(params.packageName, params.sourceEntityName);
              const targetEntity = await services.serviceService.getEntitySchema(params.packageName, params.targetEntityName);

              if (!sourceEntity || !targetEntity) {
                return { success: false, error: `Entity not found: ${!sourceEntity ? params.sourceEntityName : params.targetEntityName}` };
              }

              const relationship = {
                uuid: crypto.randomUUID(),
                description: params.description,
                source: { entity: sourceEntity.uuid, cardinality: params.sourceCardinality },
                target: { entity: targetEntity.uuid, cardinality: params.targetCardinality },
              };
              await services.serviceService.createRelationship(params.packageName, relationship);
              logger.info(`AI created relationship: ${params.sourceEntityName} -> ${params.targetEntityName}`);
              return { success: true, message: `Created relationship: ${params.sourceEntityName} -> ${params.targetEntityName}` };
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
                const entities = await services.serviceService.getServiceEntities(params.packageName);
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
              const entity = await services.serviceService.getEntitySchema(params.packageName, params.entityName);
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
              const stereotypes = await services.stereotypeService.getAll();
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

    // Stream the response using UI message stream (compatible with @ai-sdk/react v3)
    const response = result.toUIMessageStreamResponse();

    // Forward the Response stream to Express res
    res.status(response.status || 200);
    response.headers.forEach((value: string, key: string) => {
      res.setHeader(key, value);
    });

    if (response.body) {
      const reader = response.body.getReader();
      const pump = async () => {
        while (true) {
          const { done, value } = await reader.read();
          if (done) { res.end(); break; }
          res.write(value);
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
    configPath: CONFIG_PATH,
  });
};

export const aiGetConfig = async (_req: Request, res: Response) => {
  const cfg = loadAIConfig();
  res.json({
    provider: cfg?.provider || 'anthropic',
    model: cfg?.model || '',
    apiKey: cfg?.apiKey ? `${cfg.apiKey.slice(0, 8)}...${cfg.apiKey.slice(-4)}` : '', // Masked
    baseURL: cfg?.baseURL || '',
    name: cfg?.name || '',
    configPath: CONFIG_PATH,
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
    res.json({ message: 'AI configuration saved', configPath: CONFIG_PATH });
  } catch (err: any) {
    res.status(500).json({ message: 'Failed to save config', error: err.message });
  }
};
