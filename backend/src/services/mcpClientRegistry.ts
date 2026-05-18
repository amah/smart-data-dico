/**
 * MCP Client Registry (#178)
 *
 * Manages live connections to external MCP servers and exposes their tools to
 * the in-app AI agent. Connections are persisted under the `mcp` section of
 * `~/.dico-app/dico-app.json` and opened lazily on first use.
 *
 * Design decisions:
 * - Two registries: built-ins stay hardcoded in aiController.ts; MCP tools
 *   live here. Merged only at chat-request time.
 * - Tool names namespaced as `<connectionId>.<toolName>` (dot separator).
 * - Per-connection trustLevel: 'auto' | 'review' | 'block'.
 *   block  → tools not added to the agent at all.
 *   review → every call prompts the user (mapped to 'modify' category).
 *   auto   → tools default to 'modify' category (under existing policy).
 * - Per-call timeout: default 10 s, override via connection.timeout.
 * - Reconnect on transport error: one retry, then propagate failure.
 * - ${ENV_VAR} interpolation in command, env.*, headers.*, url fields.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { getConfigSection, setConfigSection } from '../utils/appDir.js';
import { logger } from '../utils/logger.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface McpConnection {
  id: string;
  label: string;
  transport: 'stdio' | 'http';
  // stdio
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  // http
  url?: string;
  headers?: Record<string, string>;
  // gating
  enabled: boolean;
  trustLevel: 'auto' | 'review' | 'block';
  /** Per-call timeout in ms. Default: 10 000. */
  timeout?: number;
}

export interface McpConfig {
  connections: McpConnection[];
}

export interface McpToolDef {
  /** Namespaced tool name: `<connectionId>.<toolName>` */
  name: string;
  description: string;
  /** JSON Schema for the tool's input */
  inputSchema: Record<string, unknown>;
  /** Which connection owns this tool */
  connectionId: string;
  /** Raw tool name as returned by the MCP server */
  rawName: string;
  /** Trust level inherited from the connection */
  trustLevel: 'auto' | 'review';
}

// ---------------------------------------------------------------------------
// Built-in tool names (must not clash with MCP connection IDs)
// ---------------------------------------------------------------------------

/** Canonical set of built-in tool names in aiController.ts. */
export const BUILTIN_TOOL_NAMES: ReadonlySet<string> = new Set([
  'createEntity',
  'createRelationship',
  'listEntities',
  'getEntityDetails',
  'listStereotypes',
  'listPackages',
  'navigateTo',
  'listRoutes',
  'updateEntity',
  'updateRelationship',
  'deleteEntity',
  'deleteRelationship',
]);

// ---------------------------------------------------------------------------
// ENV interpolation
// ---------------------------------------------------------------------------

const ENV_VAR_RE = /\$\{([^}]+)\}/g;

function interpolateEnv(value: string): string {
  return value.replace(ENV_VAR_RE, (_, name) => {
    const v = process.env[name];
    if (v === undefined) {
      logger.warn(`[mcpClientRegistry] ENV var ${name} is not set; substituting empty string`);
      return '';
    }
    return v;
  });
}

function interpolateRecord(record: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(record)) {
    out[k] = interpolateEnv(v);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Live connection cache
// ---------------------------------------------------------------------------

interface LiveConnection {
  client: Client;
  transport: Transport;
}

export class McpClientRegistry {
  private _live = new Map<string, LiveConnection>();

  // ---------------------------------------------------------------------------
  // Persistence
  // ---------------------------------------------------------------------------

  getConnections(): McpConnection[] {
    const cfg = getConfigSection<McpConfig>('mcp');
    return cfg?.connections ?? [];
  }

  saveConnections(connections: McpConnection[]): void {
    setConfigSection('mcp', { connections });
  }

  upsertConnection(conn: McpConnection): void {
    const all = this.getConnections();
    const idx = all.findIndex((c) => c.id === conn.id);
    if (idx >= 0) {
      all[idx] = conn;
    } else {
      all.push(conn);
    }
    this.saveConnections(all);
    // Drop cached live client so it reconnects with updated config
    this._dropLive(conn.id);
  }

  deleteConnection(id: string): boolean {
    const all = this.getConnections();
    const idx = all.findIndex((c) => c.id === id);
    if (idx < 0) return false;
    all.splice(idx, 1);
    this.saveConnections(all);
    this._dropLive(id);
    return true;
  }

  // ---------------------------------------------------------------------------
  // Connection validation
  // ---------------------------------------------------------------------------

  /**
   * Validate a connection definition before persisting it.
   * Returns a list of error messages (empty = valid).
   */
  validateConnection(conn: Partial<McpConnection>): string[] {
    const errors: string[] = [];
    if (!conn.id || conn.id.trim() === '') {
      errors.push('id must not be empty');
    } else if (conn.id.includes('.')) {
      errors.push('id must not contain a dot (dots are reserved for tool name namespacing)');
    } else if (BUILTIN_TOOL_NAMES.has(conn.id)) {
      errors.push(`id "${conn.id}" clashes with a built-in tool name`);
    }
    if (!conn.label || conn.label.trim() === '') {
      errors.push('label must not be empty');
    }
    if (conn.transport !== 'stdio' && conn.transport !== 'http') {
      errors.push('transport must be "stdio" or "http"');
    }
    if (conn.transport === 'stdio' && !conn.command) {
      errors.push('command is required for stdio transport');
    }
    if (conn.transport === 'http' && !conn.url) {
      errors.push('url is required for http transport');
    }
    return errors;
  }

  // ---------------------------------------------------------------------------
  // Live client lifecycle
  // ---------------------------------------------------------------------------

  private _dropLive(id: string): void {
    const live = this._live.get(id);
    if (live) {
      this._live.delete(id);
      live.client.close().catch(() => { /* best-effort */ });
    }
  }

  private async _openConnection(conn: McpConnection): Promise<LiveConnection> {
    const client = new Client({ name: 'smart-data-dico', version: '0.1.0' });

    let transport: Transport;

    if (conn.transport === 'stdio') {
      const command = interpolateEnv(conn.command!);
      const args = conn.args ?? [];
      const env = conn.env ? interpolateRecord(conn.env) : undefined;
      transport = new StdioClientTransport({ command, args, env });
    } else {
      const url = interpolateEnv(conn.url!);
      const headers = conn.headers ? interpolateRecord(conn.headers) : undefined;
      transport = new StreamableHTTPClientTransport(new URL(url), { requestInit: headers ? { headers } : undefined });
    }

    await client.connect(transport);
    return { client, transport };
  }

  private async _getLiveClient(conn: McpConnection): Promise<Client> {
    const existing = this._live.get(conn.id);
    if (existing) return existing.client;

    try {
      const live = await this._openConnection(conn);
      this._live.set(conn.id, live);
      return live.client;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to connect to MCP server "${conn.id}": ${msg}`);
    }
  }

  private async _getLiveClientWithReconnect(conn: McpConnection): Promise<Client> {
    try {
      return await this._getLiveClient(conn);
    } catch {
      // First attempt failed — drop cache and retry once
      this._dropLive(conn.id);
      return await this._getLiveClient(conn);
    }
  }

  // ---------------------------------------------------------------------------
  // Tool listing
  // ---------------------------------------------------------------------------

  /**
   * List tools for a single enabled connection.
   * Returns empty array if the connection is blocked or cannot be reached.
   */
  async listToolsForConnection(conn: McpConnection): Promise<McpToolDef[]> {
    if (!conn.enabled || conn.trustLevel === 'block') return [];

    try {
      const client = await this._getLiveClientWithReconnect(conn);
      const result = await client.listTools();
      return result.tools.map((t) => ({
        name: `${conn.id}.${t.name}`,
        description: t.description ?? '',
        inputSchema: (t.inputSchema as Record<string, unknown>) ?? { type: 'object', properties: {} },
        connectionId: conn.id,
        rawName: t.name,
        trustLevel: conn.trustLevel as 'auto' | 'review',
      }));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(`[mcpClientRegistry] listTools failed for "${conn.id}": ${msg}`);
      return [];
    }
  }

  /**
   * List tools across all enabled connections. Blocked connections are skipped.
   * Errors from individual connections are logged but don't fail the whole batch.
   */
  async listAllTools(): Promise<McpToolDef[]> {
    const connections = this.getConnections();
    const results = await Promise.allSettled(
      connections.map((c) => this.listToolsForConnection(c)),
    );
    const tools: McpToolDef[] = [];
    for (const r of results) {
      if (r.status === 'fulfilled') {
        tools.push(...r.value);
      }
    }
    return tools;
  }

  // ---------------------------------------------------------------------------
  // Tool invocation
  // ---------------------------------------------------------------------------

  /**
   * Call a tool on the appropriate MCP server.
   * Tool name must be in `<connectionId>.<rawName>` format.
   *
   * Returns `{ success: true, content: ... }` or `{ success: false, error: "..." }`.
   */
  async callTool(
    namespacedName: string,
    args: Record<string, unknown>,
  ): Promise<{ success: true; content: unknown } | { success: false; error: string }> {
    const dotIdx = namespacedName.indexOf('.');
    if (dotIdx < 0) {
      return { success: false, error: `Invalid MCP tool name (no dot): ${namespacedName}` };
    }
    const connectionId = namespacedName.slice(0, dotIdx);
    const rawName = namespacedName.slice(dotIdx + 1);

    const connections = this.getConnections();
    const conn = connections.find((c) => c.id === connectionId);
    if (!conn) {
      return { success: false, error: `MCP connection not found: ${connectionId}` };
    }
    if (!conn.enabled) {
      return { success: false, error: `MCP connection "${connectionId}" is disabled` };
    }
    if (conn.trustLevel === 'block') {
      return { success: false, error: `MCP connection "${connectionId}" is blocked` };
    }

    const timeoutMs = conn.timeout ?? 10_000;

    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);

    try {
      // Attempt call, with one reconnect on transport error
      let client: Client;
      try {
        client = await this._getLiveClientWithReconnect(conn);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { success: false, error: `Cannot connect to "${connectionId}": ${msg}` };
      }

      const result = await client.callTool({ name: rawName, arguments: args }, undefined, {
        signal: ac.signal,
      });
      clearTimeout(timer);
      return { success: true, content: result.content };
    } catch (err: unknown) {
      clearTimeout(timer);
      if (ac.signal.aborted) {
        return { success: false, error: `Timeout calling ${namespacedName} (>${timeoutMs}ms)` };
      }
      // Transport error → drop live client so next call reconnects
      this._dropLive(connectionId);
      // One reconnect attempt
      try {
        const client2 = await this._getLiveClient(conn);
        const ac2 = new AbortController();
        const timer2 = setTimeout(() => ac2.abort(), timeoutMs);
        try {
          const result2 = await client2.callTool({ name: rawName, arguments: args }, undefined, {
            signal: ac2.signal,
          });
          clearTimeout(timer2);
          return { success: true, content: result2.content };
        } catch (err2: unknown) {
          clearTimeout(timer2);
          if (ac2.signal.aborted) {
            return { success: false, error: `Timeout calling ${namespacedName} (>${timeoutMs}ms)` };
          }
          const msg = err2 instanceof Error ? err2.message : String(err2);
          return { success: false, error: `Tool call failed: ${msg}` };
        }
      } catch (err2: unknown) {
        const msg = err2 instanceof Error ? err2.message : String(err2);
        return { success: false, error: `Cannot reconnect to "${connectionId}": ${msg}` };
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Test connection probe
  // ---------------------------------------------------------------------------

  /**
   * Probe a connection by calling listTools. Returns success/error summary.
   */
  async testConnection(id: string): Promise<{ ok: boolean; toolCount?: number; error?: string }> {
    const connections = this.getConnections();
    const conn = connections.find((c) => c.id === id);
    if (!conn) {
      return { ok: false, error: `Connection not found: ${id}` };
    }

    // Force a fresh connection (drop cached)
    this._dropLive(id);

    try {
      const client = await this._getLiveClient(conn);
      const result = await client.listTools();
      return { ok: true, toolCount: result.tools.length };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this._dropLive(id);
      return { ok: false, error: msg };
    }
  }

  // ---------------------------------------------------------------------------
  // Shutdown
  // ---------------------------------------------------------------------------

  /** Close all live connections. Call on process shutdown. */
  async closeAll(): Promise<void> {
    const ids = [...this._live.keys()];
    await Promise.allSettled(
      ids.map(async (id) => {
        const live = this._live.get(id);
        if (live) {
          this._live.delete(id);
          try {
            await live.client.close();
          } catch { /* best-effort */ }
        }
      }),
    );
  }
}

/** Singleton instance — shared across the process. */
export const mcpClientRegistry = new McpClientRegistry();
