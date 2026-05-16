// TODO(#167-slice2b): migrate to IStorageBackend once second workspace is registered
/**
 * Conversation persistence service
 *
 * Stores AI chat conversations as JSON files in ~/.dico-app/storage/conversations/
 * Each conversation is a single file: {uuid}.json
 *
 * Future consideration: migrate to SQLite (sql.js or better-sqlite3)
 * when conversation volume exceeds ~1000 or search/analytics are needed.
 */

import fs from 'fs';
import path from 'path';
import { CONVERSATIONS_DIR, ensureAppDir } from '../utils/appDir.js';

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

function convPath(id: string): string {
  return path.join(CONVERSATIONS_DIR, `${id}.json`);
}

export const conversationService = {
  list(query?: string): ConversationSummary[] {
    ensureAppDir();
    if (!fs.existsSync(CONVERSATIONS_DIR)) return [];

    const q = query?.trim().toLowerCase() || '';
    const all = fs.readdirSync(CONVERSATIONS_DIR)
      .filter(f => f.endsWith('.json'))
      .map(f => {
        try {
          const data = JSON.parse(fs.readFileSync(path.join(CONVERSATIONS_DIR, f), 'utf8')) as Conversation;
          // #127 search: title + every message text
          if (q) {
            const haystack = (data.title + ' ' + data.messages.map(m => m.text).join(' ')).toLowerCase();
            if (!haystack.includes(q)) return null;
          }
          return {
            id: data.id,
            title: data.title,
            messageCount: data.messages.length,
            createdAt: data.createdAt,
            updatedAt: data.updatedAt,
            pinned: data.pinned ?? false,
          };
        } catch {
          return null;
        }
      })
      .filter(Boolean) as ConversationSummary[];
    // Pinned first, then most recent. Stable across reloads.
    return all.sort((a, b) => {
      if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
      return b.updatedAt.localeCompare(a.updatedAt);
    });
  },

  /**
   * Patch a subset of conversation fields. Only `title`, `pinned`, and
   * `systemPrompt` are user-editable; everything else is server-managed.
   */
  patch(id: string, patch: { title?: string; pinned?: boolean; systemPrompt?: string; mode?: Conversation['mode'] }): Conversation | null {
    const conv = this.get(id);
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
    this.save(conv);
    return conv;
  },

  get(id: string): Conversation | null {
    try {
      const p = convPath(id);
      if (!fs.existsSync(p)) return null;
      return JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch {
      return null;
    }
  },

  save(conversation: Conversation): void {
    ensureAppDir();
    conversation.updatedAt = new Date().toISOString();
    fs.writeFileSync(convPath(conversation.id), JSON.stringify(conversation, null, 2), 'utf8');
  },

  delete(id: string): boolean {
    try {
      const p = convPath(id);
      if (!fs.existsSync(p)) return false;
      fs.unlinkSync(p);
      return true;
    } catch {
      return false;
    }
  },

  addMessage(conversationId: string, message: ConversationMessage): Conversation {
    let conv = this.get(conversationId);
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
    this.save(conv);
    return conv;
  },
};
