/**
 * Plugin-local AI command map and typed runner.
 *
 * This file is intentionally NOT merged into `kernel/commands.ts` — the
 * kernel command map is data-dictionary + search + git flavoured. Adding
 * `ai.*` would violate the "plugins own their own commands" principle
 * established by `data-dictionary` and `search` namespaces.
 *
 * The 16 commands here are registered in `aiPlugin.initialize`.
 */

import { host } from '../../kernel/bootstrap';
import type {
  AIChatRequest,
  AIStatus,
  AIConfigInput,
  AIToolDef,
  AIMentionsResult,
  Conversation,
  ConversationSummary,
  SavedPrompt,
} from './services/AIService';

export interface AiCommandMap {
  // Status / Config
  'ai.status.get':    { input: void;            output: AIStatus };
  'ai.config.get':    { input: void;            output: AIStatus & { configPath?: string } };
  'ai.config.save':   { input: AIConfigInput;   output: void };

  // Streaming chat — the command returns the raw Response so the caller
  // owns SSE reading (the panel uses `response.body.getReader()`).
  'ai.chat.send':     { input: { request: AIChatRequest; signal: AbortSignal }; output: Response };

  // Tools / Mentions
  'ai.tools.list':    { input: void;            output: AIToolDef[] };
  'ai.mentions.search': { input: { q: string }; output: AIMentionsResult };

  // Conversations
  'ai.conversation.list':   { input: { q?: string };                                output: ConversationSummary[] };
  'ai.conversation.get':    { input: { id: string };                                output: Conversation | null };
  'ai.conversation.save':   { input: { conversation: Conversation };                output: void };
  'ai.conversation.patch':  { input: { id: string; patch: Partial<Pick<Conversation, 'title' | 'pinned' | 'systemPrompt'>> }; output: void };
  'ai.conversation.delete': { input: { id: string };                                output: void };

  // Prompts
  'ai.prompt.list':   { input: void;                                       output: SavedPrompt[] };
  'ai.prompt.create': { input: { name: string; content: string };          output: SavedPrompt };
  'ai.prompt.update': { input: { id: string; name: string; content: string }; output: SavedPrompt };
  'ai.prompt.delete': { input: { id: string };                             output: void };
}

export type AiCommandName = keyof AiCommandMap;
export type AiCommandInput<K extends AiCommandName> = AiCommandMap[K]['input'];
export type AiCommandOutput<K extends AiCommandName> = AiCommandMap[K]['output'];

/**
 * Plugin-scoped typed command runner. Same shape as `runCommand` in
 * `kernel/commands.ts` but constrained to the AI namespace. The plugin
 * registers all 16 commands in `aiPlugin.initialize`.
 *
 * Implementation calls `host.rootActivationCtx.commands.run(name, input)`,
 * matching `CommandRegistry.run(id: string, ...args: any[])` from
 * `@hamak/microkernel-api/dist/types.d.ts`.
 */
export function runAiCommand<K extends AiCommandName>(
  name: K,
  ...args: AiCommandInput<K> extends void ? [] : [AiCommandInput<K>]
): Promise<AiCommandOutput<K>> {
  const ctx = host.rootActivationCtx;
  if (!ctx) throw new Error('runAiCommand called before host bootstrap completed.');
  return ctx.commands.run(name, ...(args as any[]));
}
