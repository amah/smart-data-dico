/**
 * AIService — Pattern B REST wrapper for /api/ai/**.
 *
 * Owns its own axios instance (per cookbook §3b). Does NOT import from
 * `@/services/api` (cookbook anti-pattern).
 *
 * AI grounding deferred — see spec #162 Risk 1:
 *   The dictionary DI token is declared in tokens.ts but has no provider
 *   yet. Future grounding methods (e.g., `getEntityContext(name)`) will
 *   resolve individual tokens lazily via
 *   `host.rootActivationCtx.resolve(...)` from within method bodies.
 *
 * Streaming deviation — see spec #162 Risk 2:
 *   `streamChat` uses native `fetch` (NOT axios) because axios does not
 *   expose a `ReadableStream` body. This is the canonical Pattern B
 *   exception for SSE streaming endpoints. All other methods are
 *   axios-shaped.
 */

import axios, { type AxiosInstance } from 'axios';

/** Tool category enum forwarded by the SSE stream. Mirror of backend. */
export type AIToolCategory = 'read' | 'navigate' | 'create' | 'modify' | 'delete';

/** Conversation list-summary row. Matches `GET /api/ai/conversations`. */
export interface ConversationSummary {
  id: string;
  title: string;
  messageCount: number;
  updatedAt: string;
  pinned?: boolean;
}

/** Full conversation. Matches `GET /api/ai/conversations/:id`. */
export interface Conversation {
  id: string;
  title: string;
  messages: ConversationChatMessage[];
  createdAt: string;
  updatedAt: string;
  pinned?: boolean;
  systemPrompt?: string;
  mode?: 'designer' | 'ask' | 'review';
  usage?: { inputTokens: number; outputTokens: number; totalCost?: number };
}

export interface ConversationChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  timestamp?: string;
  toolCalls?: unknown[];
  rawEvents?: unknown[];
  cancelled?: boolean;
  condensed?: { count: number; estimatedTokens?: number };
  autonomous?: boolean;
}

export interface SavedPrompt {
  id: string;
  name: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export interface AIStatus {
  available: boolean;
  provider?: string;
  model?: string;
  name?: string;
}

export interface AIConfigInput {
  provider: 'anthropic' | 'openai' | 'openai-compatible';
  model?: string;
  apiKey: string;
  baseURL?: string;
  name?: string;
}

export interface AIChatRequest {
  messages: Array<{
    id: string;
    role: 'user' | 'assistant';
    parts: Array<{ type: 'text'; text: string }>;
    // #confab-fix — prior tool calls + their outputs, so the model sees what it
    // actually did in earlier turns (reconstructed into OpenAI tool messages
    // server-side). Present only on assistant turns that ran tools.
    toolCalls?: Array<{ id: string; name: string; input: unknown; output: unknown }>;
  }>;
  pageContext?: string;
  systemPrompt?: string;
  mode?: 'designer' | 'ask' | 'review';
}

export interface AIToolDef {
  name: string;
  description: string;
  parameters: Array<{ name: string; type: string; required: boolean; description: string }>;
  /**
   * #178 — `'builtin'` for tools hardcoded in `aiController.ts`,
   * `'mcp'` for tools surfaced via the MCP client registry. When the
   * endpoint comes back without `source` (older backend), the tool is
   * treated as `'builtin'`.
   */
  source?: 'builtin' | 'mcp';
  /** MCP-only: id of the upstream connection (also the prefix in `name`). */
  connectionId?: string;
  /** MCP-only: human-readable connection label for chat-card attribution. */
  connectionLabel?: string;
  /** MCP-only: connection's `trustLevel` ('auto' | 'review' | 'block'). */
  trustLevel?: string;
}

export interface AIMentionsResult {
  entities: Array<{ name: string; packageName: string }>;
  packages: Array<{ name: string }>;
}

export class AIService {
  private readonly http: AxiosInstance;

  /**
   * @param http  Optional injected AxiosInstance. Production code passes
   *              nothing and gets the default instance with the
   *              auth-token interceptor (mirrors IntegrityService).
   */
  constructor(http?: AxiosInstance) {
    this.http = http ?? AIService.createDefaultHttp();
  }

  // ── Status / Config ────────────────────────────────────────────────

  async getStatus(): Promise<AIStatus> {
    const response = await this.http.get<AIStatus>('/ai/status', {
      params: { _: Date.now() }, // cache-bust equivalent of { cache: 'no-store' }
    });
    return response.data;
  }

  async getConfig(): Promise<AIStatus & { configPath?: string }> {
    const response = await this.http.get<AIStatus & { configPath?: string }>('/ai/config');
    return response.data;
  }

  async saveConfig(input: AIConfigInput): Promise<void> {
    await this.http.post('/ai/config', input);
  }

  // ── Chat ───────────────────────────────────────────────────────────

  /**
   * Initiate a streaming chat turn. Returns the raw Response so the
   * caller can read `response.body.getReader()` for SSE. AbortSignal
   * passes through to fetch so the Stop button can cancel mid-stream.
   *
   * Uses native fetch (NOT axios) — axios does not expose a streaming
   * ReadableStream body. This is the canonical Pattern B exception for
   * streaming endpoints (per cookbook §3 "AIService has Pattern A for
   * prompts/conversations and Pattern B for chat streaming" — we
   * implement only Pattern B in this slice; Pattern A would come if
   * conversations were ever migrated to Store FS, which they are not).
   */
  async streamChat(request: AIChatRequest, signal: AbortSignal): Promise<Response> {
    const token = localStorage.getItem('auth_token') || 'mock-token-for-testing';
    return fetch('/api/ai/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify(request),
      signal,
    });
  }

  /**
   * Resolve a server-side tool-approval gate for an in-flight stream.
   *
   * Gated tool calls (create/modify/delete) block on the backend until the
   * client posts a decision here. Auto-approved tools post 'approve'
   * immediately so the stream never visibly stalls; tools held for human
   * review post when the user clicks Approve / Reject. Uses the same
   * Authorization header pattern as `streamChat` (native fetch — but this
   * one is a plain JSON POST, no streaming body to read).
   */
  async approveTool(streamId: string, toolCallId: string, decision: 'approve' | 'deny'): Promise<void> {
    await this.http.post('/ai/chat/approve', { streamId, toolCallId, decision });
  }

  // ── Tools ──────────────────────────────────────────────────────────

  async listTools(): Promise<AIToolDef[]> {
    const response = await this.http.get<{ data: AIToolDef[] }>('/ai/tools');
    return response.data.data ?? [];
  }

  // ── Mentions ───────────────────────────────────────────────────────

  async searchMentions(query: string): Promise<AIMentionsResult> {
    const response = await this.http.get<{ data: AIMentionsResult }>('/ai/mentions/search', {
      params: { q: query },
    });
    return response.data.data ?? { entities: [], packages: [] };
  }

  // ── Conversations ──────────────────────────────────────────────────

  async listConversations(query?: string): Promise<ConversationSummary[]> {
    const params: Record<string, string> = {};
    if (query) params.q = query;
    const response = await this.http.get<{ data: ConversationSummary[] }>('/ai/conversations', { params });
    return response.data.data ?? [];
  }

  async getConversation(id: string): Promise<Conversation | null> {
    const response = await this.http.get<{ data: Conversation | null }>(`/ai/conversations/${encodeURIComponent(id)}`);
    return response.data.data ?? null;
  }

  async saveConversation(conv: Conversation): Promise<void> {
    await this.http.post('/ai/conversations', conv);
  }

  async patchConversation(id: string, patch: Partial<Pick<Conversation, 'title' | 'pinned' | 'systemPrompt'>>): Promise<void> {
    await this.http.patch(`/ai/conversations/${encodeURIComponent(id)}`, patch);
  }

  async deleteConversation(id: string): Promise<void> {
    await this.http.delete(`/ai/conversations/${encodeURIComponent(id)}`);
  }

  // ── Saved Prompts ──────────────────────────────────────────────────

  async listPrompts(): Promise<SavedPrompt[]> {
    const response = await this.http.get<{ data: SavedPrompt[] }>('/ai/prompts');
    return response.data.data ?? [];
  }

  async createPrompt(input: { name: string; content: string }): Promise<SavedPrompt> {
    const response = await this.http.post<{ data: SavedPrompt }>('/ai/prompts', input);
    return response.data.data;
  }

  async updatePrompt(id: string, input: { name: string; content: string }): Promise<SavedPrompt> {
    const response = await this.http.put<{ data: SavedPrompt }>(`/ai/prompts/${encodeURIComponent(id)}`, input);
    return response.data.data;
  }

  async deletePrompt(id: string): Promise<void> {
    await this.http.delete(`/ai/prompts/${encodeURIComponent(id)}`);
  }

  private static createDefaultHttp(): AxiosInstance {
    const instance = axios.create({ baseURL: '/api', headers: { 'Content-Type': 'application/json' } });
    instance.interceptors.request.use((config) => {
      const token = localStorage.getItem('auth_token') || 'mock-token-for-testing';
      if (token) config.headers.Authorization = `Bearer ${token}`;
      return config;
    });
    return instance;
  }
}
