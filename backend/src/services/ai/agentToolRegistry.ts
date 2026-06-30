/**
 * Agent-tool contribution registry.
 *
 * Lets a feature/plugin contribute tools to the AI chat agent WITHOUT editing the
 * AI controller. `aiController` consumes the registry to build its tool defs
 * (manual + Vercel-SDK paths), dispatch, category map, read-only set and catalog.
 * A plugin registers from its own module (e.g. on route mount), so the controller
 * stays generic and the feature is self-contained.
 */
import { z } from 'zod';

export type AgentToolCategory = 'read' | 'navigate' | 'create' | 'modify' | 'delete';

/** Context handed to a tool executor (kept minimal; grows as tools need it). */
export interface AgentToolContext {
  /** The active project's data directory. */
  dataDir: string;
}

export interface AgentToolDef {
  name: string;
  description: string;
  category: AgentToolCategory;
  /** JSON-Schema `parameters` for the OpenAI-style / manual tool-call path. */
  jsonSchema: Record<string, unknown>;
  /** zod schema for the Vercel AI SDK path. */
  inputSchema: z.ZodTypeAny;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  execute: (args: any, ctx: AgentToolContext) => unknown | Promise<unknown>;
}

const REGISTRY = new Map<string, AgentToolDef>();

/** Register (or replace) a contributed agent tool. Idempotent by name. */
export function registerAgentTool(tool: AgentToolDef): void {
  REGISTRY.set(tool.name, tool);
}

export function getAgentTools(): AgentToolDef[] {
  return [...REGISTRY.values()];
}

export function getAgentTool(name: string): AgentToolDef | undefined {
  return REGISTRY.get(name);
}

/** Convert a tool's JSON-Schema into the {name,type,required,description}[] the tool catalog uses. */
export function jsonSchemaToParamList(schema: Record<string, unknown>): Array<{ name: string; type: string; required: boolean; description: string }> {
  const props = (schema.properties ?? {}) as Record<string, { type?: string; description?: string }>;
  const required = new Set((schema.required as string[]) ?? []);
  return Object.entries(props).map(([name, p]) => ({ name, type: p.type ?? 'string', required: required.has(name), description: p.description ?? '' }));
}
