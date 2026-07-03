/**
 * Element Style's contribution to the AI chat agent (#element-style): tools that
 * let the assistant define named styles, bind them by role, and set a specific
 * entity's style. Registered from the plugin's own module so the AI controller
 * carries no element-style-specific code (mirrors the reverse-engineer plugin).
 */
import { z } from 'zod';
import { registerAgentTool } from '../ai/agentToolRegistry.js';
import {
  listElementStyles, replaceElementStyles, validateElementStyles,
  listStyleRules, replaceStyleRules, validateStyleRules,
  type ElementStyle, type StyleRule,
} from '../dicoConfigService.js';
import { serviceService } from '../serviceService.js';

let registered = false;

/** Idempotently register the element-style agent tools. */
export function registerElementStyleAgentTools(): void {
  if (registered) return;
  registered = true;

  registerAgentTool({
    name: 'defineElementStyle',
    category: 'modify',
    description: 'Define or update a named Element Style used to visually style entities by role in diagrams (e.g. aggregate-root, junction, reference, remote-ref). Upserts by name. Colors are theme tokens (primary, neutral, warning, success, info, accent, base, or a *-subtle variant) or hex.',
    jsonSchema: {
      type: 'object', required: ['name'],
      properties: {
        name: { type: 'string', description: 'kebab-case id, e.g. aggregate-root' },
        label: { type: 'string' },
        fill: { type: 'string', description: 'theme token or hex' },
        border: { type: 'string', description: 'theme token or hex' },
        borderWidth: { type: 'number' },
        borderStyle: { type: 'string', enum: ['solid', 'dashed', 'dotted'] },
        shape: { type: 'string', description: 'cytoscape shape, e.g. roundrectangle, hexagon, ellipse' },
        opacity: { type: 'number' },
        badge: { type: 'string', description: 'short tag, e.g. "AR"' },
        emphasis: { type: 'boolean', description: 'raise z-order + halo' },
        default: { type: 'boolean', description: 'use as the fallback style for any element nothing else styles (at most one)' },
      },
    },
    inputSchema: z.object({
      name: z.string(),
      label: z.string().optional(),
      fill: z.string().optional(),
      border: z.string().optional(),
      borderWidth: z.number().optional(),
      borderStyle: z.enum(['solid', 'dashed', 'dotted']).optional(),
      shape: z.string().optional(),
      opacity: z.number().optional(),
      badge: z.string().optional(),
      emphasis: z.boolean().optional(),
      default: z.boolean().optional(),
    }),
    execute: async (args) => {
      const style = args as ElementStyle;
      let next = (await listElementStyles()).filter((s) => s.name !== style.name);
      // Single-default invariant: a new default clears the flag on the others.
      if (style.default) next = next.map((s) => (s.default ? { ...s, default: false } : s));
      next.push(style);
      const errors = validateElementStyles(next);
      if (errors.length) return { success: false, errors };
      const r = await replaceElementStyles(next);
      return r.success ? { success: true, style: style.name, totalStyles: next.length } : { success: false, errors: r.errors };
    },
  });

  registerAgentTool({
    name: 'addStyleRule',
    category: 'modify',
    description: 'Add a rule that binds an Element Style to elements by role: match a stereotype, a detected role (junction|reference|remote-ref), an entity name, or a physical table name (glob by default, regex opt-in). The referenced style must already be defined — call defineElementStyle first.',
    jsonSchema: {
      type: 'object', required: ['match', 'pattern', 'style'],
      properties: {
        match: { type: 'string', enum: ['stereotype', 'role', 'entityName', 'physicalTableName'] },
        pattern: { type: 'string', description: 'glob (default) or regex' },
        regex: { type: 'boolean' },
        style: { type: 'string', description: 'name of a defined Element Style' },
      },
    },
    inputSchema: z.object({
      match: z.enum(['stereotype', 'role', 'entityName', 'physicalTableName']),
      pattern: z.string(),
      regex: z.boolean().optional(),
      style: z.string(),
    }),
    execute: async (args) => {
      const next = [...(await listStyleRules()), args as StyleRule];
      const known = (await listElementStyles()).map((s) => s.name);
      const errors = validateStyleRules(next, known);
      if (errors.length) return { success: false, errors };
      const r = await replaceStyleRules(next);
      return r.success ? { success: true, totalRules: next.length } : { success: false, errors: r.errors };
    },
  });

  registerAgentTool({
    name: 'setEntityStyle',
    category: 'modify',
    description: "Set (or clear) one entity's Element Style explicitly, overriding rules/role detection. Pass a defined style name, or 'auto' to clear the override and fall back to rules/role.",
    jsonSchema: {
      type: 'object', required: ['packageName', 'entityName', 'style'],
      properties: {
        packageName: { type: 'string' },
        entityName: { type: 'string' },
        style: { type: 'string', description: "a defined style name, or 'auto' to clear" },
      },
    },
    inputSchema: z.object({ packageName: z.string(), entityName: z.string(), style: z.string() }),
    execute: async (args) => {
      const r = await serviceService.setEntityStyle(String(args.packageName), String(args.entityName), String(args.style));
      return r.success ? { success: true, entity: args.entityName, style: args.style } : { success: false, errors: r.errors };
    },
  });
}
