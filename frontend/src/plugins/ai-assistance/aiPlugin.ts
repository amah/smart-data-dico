/**
 * AI-Assistance Plugin
 *
 * Carves out a self-contained plugin that owns every AI surface (chat panel,
 * conversation history, prompt management, autonomous mode, slash-command
 * palette, granular auto-approve policy). All AI HTTP calls are behind
 * AIService resolved through DI (AI_SERVICE_TOKEN).
 *
 * No `aiSlice` — chat state stays in AIChatPanel's local useState (25+
 * states — streaming buffers, AbortController refs, scroll-lock). Per
 * cookbook §2 this is correct: streaming buffer references and abort
 * controllers are intrinsically component-local.
 *
 * AI grounding deferred — DICTIONARY_SERVICE_TOKEN has no provider yet.
 * See spec #162 Risk 1.
 *
 * `workingFolder` added in #154 — informational today. Default would be
 * `['dictionaries', '.dico', 'ai']` once AI Pattern A file work (conversations
 * / prompts as files) is implemented in a follow-up.
 */

import type { PluginModule } from '@hamak/microkernel-spi';
import { AI_SERVICE_TOKEN } from '../../kernel/tokens';
import { AIService } from './services/AIService';

export interface AiPluginOptions {
  /** Default true. Set to false to skip all registrations (feature flag). */
  enabled?: boolean;
  /** Reserved for future Pattern A file work (#154 reframe). Informational today. */
  workingFolder?: string[];
}

export function createAiAssistancePlugin(options: AiPluginOptions = {}): PluginModule {
  const enabled = options.enabled !== false;
  // workingFolder is informational at this stage. Captured so future tickets
  // can parameterize AI file paths without another factory signature change.
  void options.workingFolder;

  return {
    async initialize(ctx) {
      if (!enabled) return;

      // Route ownership — reserved namespace. The chat panel renders as
      // a floating side panel (no current /ai/** route), but registering
      // declares intent so future ConversationsPage can live here.
      ctx.views.register('routes.ai-assistance', () => ({
        routes: ['/ai/**', '/conversations/**'],
      }));

      // Pattern B service — no kernel deps, eager useValue (mirrors
      // INTEGRITY_SERVICE_TOKEN / DIFF_SERVICE_TOKEN / IMPORT_EXPORT_SERVICE_TOKEN).
      const ai = new AIService();
      ctx.provide({ provide: AI_SERVICE_TOKEN, useValue: ai });

      // ── 16 ai.* command registrations ────────────────────────────────
      ctx.commands.register('ai.status.get', () => ai.getStatus());
      ctx.commands.register('ai.config.get', () => ai.getConfig());
      ctx.commands.register('ai.config.save', (input: Parameters<typeof ai.saveConfig>[0]) => ai.saveConfig(input));

      ctx.commands.register('ai.chat.send', ({ request, signal }: { request: Parameters<typeof ai.streamChat>[0]; signal: AbortSignal }) => ai.streamChat(request, signal));

      ctx.commands.register('ai.tools.list', () => ai.listTools());
      ctx.commands.register('ai.mentions.search', ({ q }: { q: string }) => ai.searchMentions(q));

      ctx.commands.register('ai.conversation.list', ({ q }: { q?: string } = {}) => ai.listConversations(q));
      ctx.commands.register('ai.conversation.get', ({ id }: { id: string }) => ai.getConversation(id));
      ctx.commands.register('ai.conversation.save', ({ conversation }: { conversation: Parameters<typeof ai.saveConversation>[0] }) => ai.saveConversation(conversation));
      ctx.commands.register('ai.conversation.patch', ({ id, patch }: { id: string; patch: Parameters<typeof ai.patchConversation>[1] }) => ai.patchConversation(id, patch));
      ctx.commands.register('ai.conversation.delete', ({ id }: { id: string }) => ai.deleteConversation(id));

      ctx.commands.register('ai.prompt.list', () => ai.listPrompts());
      ctx.commands.register('ai.prompt.create', ({ name, content }: { name: string; content: string }) => ai.createPrompt({ name, content }));
      ctx.commands.register('ai.prompt.update', ({ id, name, content }: { id: string; name: string; content: string }) => ai.updatePrompt(id, { name, content }));
      ctx.commands.register('ai.prompt.delete', ({ id }: { id: string }) => ai.deletePrompt(id));
    },

    async activate() {
      // Nothing to do — Pattern B service is already wired during initialize.
      // No autosave middleware (chat state is component-local), no hook
      // listeners (data-dictionary does not emit ai-relevant events yet).
    },
  };
}
