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
}

export interface ConversationSummary {
  id: string;
  title: string;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
}

function convPath(id: string): string {
  return path.join(CONVERSATIONS_DIR, `${id}.json`);
}

export const conversationService = {
  list(): ConversationSummary[] {
    ensureAppDir();
    if (!fs.existsSync(CONVERSATIONS_DIR)) return [];

    return fs.readdirSync(CONVERSATIONS_DIR)
      .filter(f => f.endsWith('.json'))
      .map(f => {
        try {
          const data = JSON.parse(fs.readFileSync(path.join(CONVERSATIONS_DIR, f), 'utf8')) as Conversation;
          return {
            id: data.id,
            title: data.title,
            messageCount: data.messages.length,
            createdAt: data.createdAt,
            updatedAt: data.updatedAt,
          };
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .sort((a, b) => b!.updatedAt.localeCompare(a!.updatedAt)) as ConversationSummary[];
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
