/**
 * MCP server for Smart Data Dictionary (#62).
 *
 * Exposes the in-app data-dictionary tools — entity CRUD, listing,
 * relationships, stereotypes — over the Model Context Protocol so external
 * clients (Claude Desktop, Cursor, Roo Code, ...) can call them via stdio.
 *
 * Design notes
 * ------------
 * - Reuses the existing services (`serviceService`, `stereotypeService`) and
 *   filesystem helpers — no logic is duplicated from `aiController.ts`.
 * - All log output is forced to stderr: stdio MCP framing requires that
 *   stdout carry only JSON-RPC messages.
 * - The same `DATA_DIR` env var the rest of the backend uses (see
 *   `kernel/config.ts`) drives where YAML files are read from.
 * - Tool factory `createMcpServer()` is exported so tests can drive it via
 *   `InMemoryTransport.createLinkedPair()` without spawning a child process.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import crypto from 'node:crypto';

import {
  AttributeType,
  Cardinality,
  EntityStatus,
  type Attribute,
  type Entity,
} from '../models/EntitySchema.js';

/**
 * stdout is reserved for MCP framing under the stdio transport. Any service
 * that writes to it would corrupt the JSON-RPC stream and break the client.
 * We re-route the in-app logger to stderr before any service module is loaded.
 */
function forceLoggerToStderr(): void {
  const origLog = console.log;
  const origInfo = console.info;
  const origWarn = console.warn;
  const origError = console.error;
  console.log = (...args: unknown[]) => origError(...args);
  console.info = (...args: unknown[]) => origError(...args);
  console.warn = (...args: unknown[]) => origError(...args);
  console.error = (...args: unknown[]) => origError(...args);
  // Silence unused warning for origLog/origInfo/origWarn — they're captured
  // for symmetry, kept in case a future change wants to restore them.
  void origLog;
  void origInfo;
  void origWarn;
}

/**
 * Lazy-load services so unit tests can mock them and so the MCP entrypoint
 * pays zero cost for modules it doesn't need until the first tool call.
 */
async function loadServices() {
  const { serviceService } = await import('../services/serviceService.js');
  const { stereotypeService } = await import('../services/stereotypeService.js');
  const fileOps = await import('../utils/fileOperations.js');
  return { serviceService, stereotypeService, fileOps };
}

/** Helper: package the result as MCP `text` content. */
function asJsonContent(payload: unknown) {
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(payload, null, 2),
      },
    ],
  };
}

function asErrorContent(message: string) {
  return {
    isError: true,
    content: [{ type: 'text' as const, text: message }],
  };
}

/**
 * Build a configured MCP server. Exported so tests can wire an in-memory
 * transport and so a future HTTP transport could share the same surface.
 */
export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: 'smart-data-dico',
    version: '0.1.0',
  });

  // -------- listPackages --------
  server.registerTool(
    'listPackages',
    {
      title: 'List packages',
      description:
        'List all packages in the data dictionary. A package is a top-level folder under the project root containing YAML model files.',
      inputSchema: {},
    },
    async () => {
      try {
        const { fileOps } = await loadServices();
        const packages = await fileOps.listPackages();
        return asJsonContent({ packages });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return asErrorContent(`listPackages failed: ${msg}`);
      }
    },
  );

  // -------- listEntities --------
  server.registerTool(
    'listEntities',
    {
      title: 'List entities',
      description:
        'List entities in a package. If `packageName` is omitted, returns the list of packages instead (mirrors the in-app `listEntities` AI tool).',
      inputSchema: {
        packageName: z
          .string()
          .optional()
          .describe('Package name. Omit to list all packages.'),
      },
    },
    async ({ packageName }) => {
      try {
        const { serviceService, fileOps } = await loadServices();
        if (packageName) {
          const entities = await serviceService.getServiceEntities(packageName);
          return asJsonContent({
            entities: entities.map((e) => ({
              name: e.name,
              description: e.description,
              attrCount: e.attributes?.length ?? 0,
              stereotype: e.stereotype,
              status: e.status,
            })),
          });
        }
        const packages = await fileOps.listPackages();
        return asJsonContent({ packages });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return asErrorContent(`listEntities failed: ${msg}`);
      }
    },
  );

  // -------- getEntityDetails --------
  server.registerTool(
    'getEntityDetails',
    {
      title: 'Get entity details',
      description:
        'Get the full schema for an entity — name, description, stereotype, status, attributes (name/type/description/required/primaryKey).',
      inputSchema: {
        packageName: z.string().describe('Package name.'),
        entityName: z.string().describe('Entity name.'),
      },
    },
    async ({ packageName, entityName }) => {
      try {
        const { serviceService } = await loadServices();
        const entity = await serviceService.getEntitySchema(packageName, entityName);
        if (!entity) return asErrorContent(`Entity not found: ${packageName}/${entityName}`);
        return asJsonContent({
          name: entity.name,
          description: entity.description,
          stereotype: entity.stereotype,
          status: entity.status,
          attributes: entity.attributes?.map((a) => ({
            name: a.name,
            type: a.type,
            description: a.description,
            required: a.required,
            primaryKey: a.primaryKey,
            validation: a.validation,
          })),
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return asErrorContent(`getEntityDetails failed: ${msg}`);
      }
    },
  );

  // -------- createEntity --------
  // Mirror the schema used by aiController.ts so external clients build the
  // same payload — but expose the fields directly (no JSON-string wrapper)
  // since MCP clients are model-agnostic and can pass typed objects.
  server.registerTool(
    'createEntity',
    {
      title: 'Create entity',
      description:
        'Create a new entity with attributes in the given package. Creates the package directory if it does not already exist.',
      inputSchema: {
        packageName: z.string().describe('Package/service name.'),
        name: z.string().describe('Entity name (PascalCase recommended).'),
        description: z.string().optional().describe('Entity description.'),
        stereotype: z
          .string()
          .optional()
          .describe('Stereotype id (e.g. aggregate-root, value-object).'),
        attributes: z
          .array(
            z.object({
              name: z.string(),
              type: z.string().optional(),
              description: z.string().optional(),
              required: z.boolean().optional(),
              primaryKey: z.boolean().optional(),
              enumValues: z.array(z.string()).optional(),
            }),
          )
          .describe('Attributes for the entity.'),
      },
    },
    async ({ packageName, name, description, stereotype, attributes }) => {
      try {
        const { serviceService, fileOps } = await loadServices();
        const existing = await fileOps.listPackages();
        if (!existing.includes(packageName)) {
          await fileOps.ensurePackageDirectoryStructure(packageName);
        }
        // Coerce the free-form `type` string into the AttributeType enum.
        // We accept anything here (including derived types declared in
        // `dico.config.json.types[]`); the validator inside
        // `serviceService.createEntity` is the source of truth and will
        // reject unknown values with a structured error.
        const toAttributeType = (t: string | undefined): AttributeType =>
          (t ?? AttributeType.STRING) as AttributeType;
        const attrs: Attribute[] = (attributes || []).map((a) => ({
          uuid: crypto.randomUUID(),
          name: a.name,
          type: toAttributeType(a.type),
          description: a.description || '',
          required: a.required ?? false,
          primaryKey: a.primaryKey,
          validation: a.enumValues ? { enumValues: a.enumValues } : undefined,
        }));
        const entity: Entity = {
          uuid: crypto.randomUUID(),
          name,
          description: description || '',
          stereotype,
          status: EntityStatus.DRAFT,
          attributes: attrs,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        const result = await serviceService.createEntity(packageName, entity);
        if (!result.success) {
          return asErrorContent(`createEntity failed: ${result.errors.join('; ')}`);
        }
        return asJsonContent({
          success: true,
          message: `Created entity ${name} with ${attrs.length} attributes`,
          uuid: entity.uuid,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return asErrorContent(`createEntity failed: ${msg}`);
      }
    },
  );

  // -------- createRelationship --------
  server.registerTool(
    'createRelationship',
    {
      title: 'Create relationship',
      description:
        'Create a relationship between two entities. Endpoints may live in the same package or in different packages — cross-package is first-class. The relationship is stored under the source entity\'s package by convention.',
      inputSchema: {
        packageName: z
          .string()
          .optional()
          .describe('Fallback package for both endpoints when sourcePackage/targetPackage are omitted.'),
        sourceEntityName: z.string().describe('Source entity name.'),
        sourcePackage: z
          .string()
          .optional()
          .describe('Package containing the source entity (defaults to packageName, then auto-discovered).'),
        targetEntityName: z.string().describe('Target entity name.'),
        targetPackage: z
          .string()
          .optional()
          .describe('Package containing the target entity (defaults to packageName, then auto-discovered).'),
        description: z.string().optional().describe('Relationship description.'),
        sourceCardinality: z
          .enum(['one', 'many'])
          .optional()
          .describe('Cardinality on the source side (default: one).'),
        targetCardinality: z
          .enum(['one', 'many'])
          .optional()
          .describe('Cardinality on the target side (default: many).'),
      },
    },
    async ({
      packageName,
      sourceEntityName,
      sourcePackage,
      targetEntityName,
      targetPackage,
      description,
      sourceCardinality,
      targetCardinality,
    }) => {
      try {
        const { serviceService } = await loadServices();
        let src, tgt;
        try {
          src = await serviceService.findEntityAcrossPackages(sourceEntityName, sourcePackage || packageName);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          return asErrorContent(`Source: ${msg}`);
        }
        if (!src) return asErrorContent(`Source entity "${sourceEntityName}" not found in any package`);
        try {
          tgt = await serviceService.findEntityAcrossPackages(targetEntityName, targetPackage || packageName);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          return asErrorContent(`Target: ${msg}`);
        }
        if (!tgt) return asErrorContent(`Target entity "${targetEntityName}" not found in any package`);
        const toCardinality = (v: 'one' | 'many'): Cardinality =>
          v === 'one' ? Cardinality.ONE : Cardinality.MANY;
        const homePackage = src.packageName;
        const relationship = {
          uuid: crypto.randomUUID(),
          description: description || '',
          source: {
            entity: src.entity.uuid,
            cardinality: toCardinality(sourceCardinality || 'one'),
          },
          target: {
            entity: tgt.entity.uuid,
            cardinality: toCardinality(targetCardinality || 'many'),
          },
        };
        const result = await serviceService.createRelationship(homePackage, relationship);
        if (!result.success) {
          return asErrorContent(`createRelationship failed: ${result.errors.join('; ')}`);
        }
        const crossNote = src.packageName !== tgt.packageName
          ? ` (cross-package: ${src.packageName} → ${tgt.packageName}, stored under ${homePackage})`
          : '';
        return asJsonContent({
          success: true,
          message: `Created relationship: ${sourceEntityName} -> ${targetEntityName}${crossNote}`,
          uuid: relationship.uuid,
          homePackage,
          sourcePackage: src.packageName,
          targetPackage: tgt.packageName,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return asErrorContent(`createRelationship failed: ${msg}`);
      }
    },
  );

  // -------- listStereotypes --------
  server.registerTool(
    'listStereotypes',
    {
      title: 'List stereotypes',
      description:
        'List the stereotypes (metadata schemas) defined for the project. Includes id, name, what they apply to, and the metadata field names.',
      inputSchema: {},
    },
    async () => {
      try {
        const { stereotypeService } = await loadServices();
        const stereotypes = await stereotypeService.getAllStereotypes();
        return asJsonContent({
          stereotypes: stereotypes.map((s) => ({
            id: s.id,
            name: s.name,
            appliesTo: s.appliesTo,
            domain: s.domain,
            fields: s.metadataDefinitions?.map((m) => m.name) ?? [],
          })),
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return asErrorContent(`listStereotypes failed: ${msg}`);
      }
    },
  );

  return server;
}

/** The set of tool names exposed by this server — exported for tests. */
export const MCP_TOOL_NAMES = [
  'listPackages',
  'listEntities',
  'getEntityDetails',
  'createEntity',
  'createRelationship',
  'listStereotypes',
] as const;

/**
 * stdio entry point. Used by `src/mcp/cli.ts` and re-exported for tests that
 * want to drive the boot path. Honors:
 *   --data-dir <path>   Override DATA_DIR for this process (mirrors bin/cli.js).
 *   DATA_DIR env var    Same semantics as the rest of the backend.
 */
export async function startStdioServer(): Promise<void> {
  forceLoggerToStderr();

  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--data-dir' && args[i + 1]) {
      process.env.DATA_DIR = args[++i];
    }
  }

  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // After connect() the SDK reads stdin and writes responses to stdout. The
  // process stays alive until the client closes the transport; nothing else
  // to do on this side.
  process.stderr.write(
    `[dico-mcp] connected (data dir: ${process.env.DATA_DIR ?? '<default>'})\n`,
  );
}
