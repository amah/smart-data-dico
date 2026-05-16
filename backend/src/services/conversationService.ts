/**
 * Conversation persistence service
 *
 * Stores AI chat conversations as JSON files in ~/.dico-app/storage/conversations/
 * Each conversation is a single file: {uuid}.json
 *
 * Future consideration: migrate to SQLite (sql.js or better-sqlite3)
 * when conversation volume exceeds ~1000 or search/analytics are needed.
 *
 * Migrated to IStorageBackend in slice-2b (#167).
 */

import { storageRegistry } from '../storage/contract/StorageBackendToken.js';
import type { IStorageBackend } from '../storage/contract/IStorageBackend.js';
import { wsId, pathOf, type WorkspaceId, type Path } from '../storage/contract/types.js';

export interface ConversationMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  timestamp: string;
}

/**
 * Running token totals for a conversation (#128).
 *
 * Aggregated server-side (and resent on resume) so the chat header can
 * surface a "~3.2k in / 1.1k out · $0.012" meter without re-reading
 * every saved message. `totalCost` is only present when the user has
 * configured per-model pricing under `dico-app.json.ai.pricing`; the
 * meter must remain useful (token counts only) without it.
 */
export interface ConversationUsage {
  inputTokens: number;
  outputTokens: number;
  totalCost?: number;
}

export interface Conversation {
  id: string;
  title: string;
  messages: ConversationMessage[];
  createdAt: string;
  updatedAt: string;
  usage?: ConversationUsage;
  // #127 — user-overridable polish
  pinned?: boolean;
  systemPrompt?: string;
  // #55 — chat mode ('designer' | 'ask' | 'review'). Absent on
  // legacy conversations; the frontend defaults to 'designer'.
  mode?: 'designer' | 'ask' | 'review';
}

export interface ConversationSummary {
  id: string;
  title: string;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
  pinned?: boolean;
}

export class ConversationService {
  private _storage?: IStorageBackend;
  private get storage(): IStorageBackend {
    if (!this._storage) this._storage = storageRegistry.getBackend();
    return this._storage;
  }

  constructor(
    storage?: IStorageBackend,
    private readonly ws: WorkspaceId = wsId('app'),
    private readonly conversationsDir: Path = pathOf('conversations'),
  ) {
    this._storage = storage;
  }

  async list(query?: string): Promise<ConversationSummary[]> {
    let entries;
    try {
      entries = await this.storage.list(this.ws, this.conversationsDir);
    } catch (e) {
      if ((e as { code?: string }).code === 'not-found') return [];
      throw e;
    }

    const q = query?.trim().toLowerCase() || '';
    const all: ConversationSummary[] = [];

    for (const entry of entries) {
      if (entry.isDirectory || !entry.name.endsWith('.json')) continue;
      try {
        const raw = await this.storage.read(this.ws, pathOf(`${this.conversationsDir}/${entry.name}`));
        const data = JSON.parse(raw) as Conversation;
        // #127 search: title + every message text
        if (q) {
          const haystack = (data.title + ' ' + data.messages.map((m) => m.text).join(' ')).toLowerCase();
          if (!haystack.includes(q)) continue;
        }
        all.push({
          id: data.id,
          title: data.title,
          messageCount: data.messages.length,
          createdAt: data.createdAt,
          updatedAt: data.updatedAt,
          pinned: data.pinned ?? false,
        });
      } catch {
        // skip corrupt JSON files
      }
    }

    // Pinned first, then most recent. Stable across reloads.
    return all.sort((a, b) => {
      if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
      return b.updatedAt.localeCompare(a.updatedAt);
    });
  }

  /**
   * Patch a subset of conversation fields. Only `title`, `pinned`, and
   * `systemPrompt` are user-editable; everything else is server-managed.
   */
  async patch(
    id: string,
    patch: { title?: string; pinned?: boolean; systemPrompt?: string; mode?: Conversation['mode'] },
  ): Promise<Conversation | null> {
    const conv = await this.get(id);
    if (!conv) return null;
    if (typeof patch.title === 'string') conv.title = patch.title.slice(0, 200);
    if (typeof patch.pinned === 'boolean') conv.pinned = patch.pinned;
    if (typeof patch.systemPrompt === 'string') {
      const trimmed = patch.systemPrompt.trim();
      // Empty clears the override; otherwise cap to keep the system prompt sane.
      conv.systemPrompt = trimmed ? trimmed.slice(0, 8000) : undefined;
    }
    // #55 — only accept the three documented modes; ignore anything else
    // so a stale client can't poison the file with an unknown value.
    if (patch.mode === 'designer' || patch.mode === 'ask' || patch.mode === 'review') {
      conv.mode = patch.mode;
    }
    await this.save(conv);
    return conv;
  }

  async get(id: string): Promise<Conversation | null> {
    try {
      const raw = await this.storage.read(this.ws, pathOf(`${this.conversationsDir}/${id}.json`));
      return JSON.parse(raw) as Conversation;
    } catch (e) {
      if ((e as { code?: string }).code === 'not-found') return null;
      throw e;
    }
  }

  async save(conversation: Conversation): Promise<void> {
    conversation.updatedAt = new Date().toISOString();
    await this.storage.write(
      this.ws,
      pathOf(`${this.conversationsDir}/${conversation.id}.json`),
      JSON.stringify(conversation, null, 2),
      { createParents: true },
    );
  }

  async delete(id: string): Promise<boolean> {
    try {
      await this.storage.delete(this.ws, pathOf(`${this.conversationsDir}/${id}.json`));
      return true;
    } catch (e) {
      if ((e as { code?: string }).code === 'not-found') return false;
      throw e;
    }
  }

  async addMessage(conversationId: string, message: ConversationMessage): Promise<Conversation> {
    let conv = await this.get(conversationId);
    if (!conv) {
      conv = {
        id: conversationId,
        title: message.role === 'user' ? message.text.slice(0, 60) : 'New conversation',
        messages: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    }
    conv.messages.push(message);
    await this.save(conv);
    return conv;
  }
}

export const conversationService = new ConversationService();
