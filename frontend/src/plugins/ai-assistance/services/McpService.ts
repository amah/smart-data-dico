/**
 * MCP connection management client (#178 slice 2).
 *
 * Thin axios wrapper around `/api/ai/mcp/connections` so the Settings
 * page can list/upsert/delete/test MCP server connections without
 * duplicating auth-header logic. Backend keeps secrets masked with
 * `••••••••` — see `MCP_SECRET_MASK` below; the masked-edit guard
 * lives in the backend so the frontend can simply re-submit whatever
 * it received.
 */

import axios, { type AxiosInstance } from 'axios';

/**
 * Sentinel the backend returns in place of saved env/header values.
 * Exported so the UI can render a recognisable placeholder when
 * showing existing secrets — and so tests can assert against the
 * exact wire shape.
 */
export const MCP_SECRET_MASK = '••••••••';

export interface McpConnection {
  id: string;
  label: string;
  transport: 'stdio' | 'http';
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  enabled: boolean;
  trustLevel: 'auto' | 'review' | 'block';
  timeout?: number;
}

export interface McpTestResult {
  ok: boolean;
  toolCount?: number;
  error?: string;
}

/**
 * A single MCP-sourced tool's manifest entry, filtered out of the
 * shared `/api/ai/tools` response by `source: 'mcp'` and connection
 * id. The wire field `name` is the namespaced `<connectionId>.<rawName>`
 * form — `rawName` is parsed here so the UI can show the short label.
 */
export interface McpConnectionTool {
  name: string;
  rawName: string;
  description: string;
}

export class McpService {
  private readonly http: AxiosInstance;

  constructor(http?: AxiosInstance) {
    this.http = http ?? McpService.createDefaultHttp();
  }

  private static createDefaultHttp(): AxiosInstance {
    const instance = axios.create({ baseURL: '/api' });
    instance.interceptors.request.use((config) => {
      const token = localStorage.getItem('auth_token') || 'mock-token-for-testing';
      config.headers = config.headers ?? {};
      config.headers.Authorization = `Bearer ${token}`;
      return config;
    });
    return instance;
  }

  async list(): Promise<McpConnection[]> {
    const response = await this.http.get<{ data: McpConnection[] }>('/ai/mcp/connections');
    return response.data.data ?? [];
  }

  async upsert(connection: McpConnection): Promise<McpConnection> {
    const response = await this.http.post<{ data: McpConnection }>('/ai/mcp/connections', connection);
    return response.data.data;
  }

  async remove(id: string): Promise<void> {
    await this.http.delete(`/ai/mcp/connections/${encodeURIComponent(id)}`);
  }

  /**
   * List the tools surfaced by a single MCP connection by filtering
   * the shared `/api/ai/tools` manifest. Returns `[]` for a connection
   * with no live tools (disabled, blocked, unreachable, or genuinely
   * empty). Throws on transport/auth errors so the UI can surface them.
   */
  async listToolsForConnection(connectionId: string): Promise<McpConnectionTool[]> {
    const response = await this.http.get<{
      data: Array<{ name: string; description?: string; source?: string; connectionId?: string }>;
    }>('/ai/tools');
    const all = response.data.data ?? [];
    return all
      .filter((t) => t.source === 'mcp' && t.connectionId === connectionId)
      .map((t) => {
        const dotIdx = t.name.indexOf('.');
        return {
          name: t.name,
          rawName: dotIdx >= 0 ? t.name.slice(dotIdx + 1) : t.name,
          description: t.description ?? '',
        };
      });
  }

  async test(id: string): Promise<McpTestResult> {
    try {
      const response = await this.http.post<{ data: McpTestResult }>(`/ai/mcp/connections/${encodeURIComponent(id)}/test`);
      return response.data.data;
    } catch (err) {
      // The backend returns 502 with `{ data: { ok: false, error } }` on
      // a probe failure; axios throws on non-2xx so we unwrap that here
      // rather than forcing every caller to write a try/catch.
      if (axios.isAxiosError(err) && err.response?.data?.data) {
        return err.response.data.data as McpTestResult;
      }
      throw err;
    }
  }
}

export const mcpService = new McpService();
