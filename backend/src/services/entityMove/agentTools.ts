/**
 * Move-entity's contribution to the AI chat agent (#move-entity): a tool that
 * relocates an entity from one package to another. Registered from its own
 * module (called at entity-route mount) so the AI controller carries no
 * move-specific code — mirrors the element-style / reverse-engineer plugins.
 */
import { z } from 'zod';
import { registerAgentTool } from '../ai/agentToolRegistry.js';
import { serviceService } from '../serviceService.js';

let registered = false;

/** Idempotently register the moveEntity agent tool. */
export function registerMoveEntityAgentTool(): void {
  if (registered) return;
  registered = true;

  registerAgentTool({
    name: 'moveEntity',
    category: 'modify',
    description:
      "Move an entity from one package to another. The entity keeps its UUID, so relationships (cross-package is first-class), cases and diagrams that reference it keep resolving — nothing is orphaned. Fails if the target package doesn't exist or already has an entity with the same name.",
    jsonSchema: {
      type: 'object',
      required: ['sourcePackage', 'entityName', 'targetPackage'],
      properties: {
        sourcePackage: { type: 'string', description: 'Package the entity currently lives in' },
        entityName: { type: 'string', description: 'Name of the entity to move' },
        targetPackage: { type: 'string', description: 'Package to move the entity into' },
      },
    },
    inputSchema: z.object({
      sourcePackage: z.string(),
      entityName: z.string(),
      targetPackage: z.string(),
    }),
    execute: async (args) => {
      const r = await serviceService.moveEntity(
        String(args.sourcePackage),
        String(args.entityName),
        String(args.targetPackage),
      );
      return r.success
        ? { success: true, entity: args.entityName, from: args.sourcePackage, to: args.targetPackage }
        : { success: false, errors: r.errors };
    },
  });
}
