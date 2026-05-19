/**
 * Curated catalog of well-known MCP servers (Phase 6 of #178).
 *
 * Static JSON bundled with the frontend — no live fetch. This shape
 * satisfies the spec's "Browse MCP servers" pane intent (one-click
 * install for popular servers) without coupling to any third-party
 * registry API that might shift.
 *
 * Update protocol: edit `mcpRegistry.json` (bump `version` +
 * `lastUpdated`), no code change needed here.
 */

import data from './mcpRegistry.json';

export interface McpRegistryEnvHint {
  key: string;
  description: string;
  required: boolean;
}

export interface McpRegistryEntry {
  id: string;
  label: string;
  description: string;
  homepage: string;
  transport: 'stdio' | 'http';
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  envHints: McpRegistryEnvHint[];
}

export interface McpRegistry {
  version: number;
  lastUpdated: string;
  source: string;
  entries: McpRegistryEntry[];
}

export const mcpRegistry: McpRegistry = data as McpRegistry;
