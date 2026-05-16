# Spec — #162: arch: extract ai-assistance plugin

## Goal

Carve out a self-contained `ai-assistance` frontend plugin that owns every AI surface (chat panel, conversation history, prompt management, autonomous mode, slash-command palette, granular auto-approve policy, page-context helper). All AI HTTP calls collapse behind a single `AIService` resolved through DI (`AI_SERVICE_TOKEN`). The plugin participates as a peer to `data-dictionary` — it never imports from it, and `data-dictionary` never imports from it. The ticket body says: *"AI is a side-car over the data dictionary — it consumes the dictionary's entity/relationship/rule data to ground conversations — but it is not part of the dictionary's bounded context."* The user's 2026-05-13 comment adds per-user AI session-storage and per-user workspace-scoped tool execution under #168/#169, both of which we surface as **out of scope deferrals** for this slice (the front-end plugin extraction is a no-behaviour-change refactor; per-user storage requires backend reorg that #168/#169 own).

Backend reorg from the original ticket body (move `aiController.ts` → `controllers/ai/`, move `conversationService.ts` and `promptService.ts` → `services/ai/`) is **out of scope** for this slice — the backend routes were already grouped under `backend/src/routes/ai/` by #157, and per the orchestrator brief ("Backend untouched: per ticket, backend routes already grouped (#157). Confirm no backend changes needed"). Backend controller/service relocations are deferred to a follow-up.

## Branch base

This branch is cut from `main` (post-#163, post-#164, post-#160 — currently `9c9841f`). All five DI services and 30 commands from `#163` already exist; `useService` and `useCommand` are stable; `EventMap` from `events.ts` is available.

## Scope discovery (corrections to ticket body)

- **Ticket body says "Move `AIChatPanel.tsx` (and friends)".** Verified: only one "friend" component exists currently — `AIChatPanel.tsx` itself (2453 lines, single file, contains all chat sub-rendering as inline JSX plus the named export `EntityDiff` consumed by `AIChatPanel.diff.test.tsx`). There is **no separate `ChatMessage.tsx` / `ChatComposer.tsx` / `SlashCommandPalette.tsx`** on disk despite the ticket listing them — they are all inline in `AIChatPanel.tsx`. Splitting them out is **out of scope for this slice**; the move-and-rewire diff is already large. The plugin's `components/` folder will hold `AIChatPanel.tsx` (moved verbatim) plus its inline named export `EntityDiff`. Surface as Risk 4.
- **Ticket body lists "`pages/ConversationsPage.tsx`" as a possible plugin page.** Verified: no such page exists in the repo (no route, no file). The conversation history view lives **inside** `AIChatPanel.tsx` under the `view === 'history'` branch. Out of scope.
- **Ticket body lists "`hooks/useAutonomousMode.ts`" as a hook.** Verified: no such hook exists. Autonomous mode (#64) is implemented entirely as a `useState<boolean>` initialized from `localStorage.getItem('ai-autonomous')` inside `AIChatPanel.tsx` (lines 252-261). Extracting it into a hook is **out of scope** — it would force a refactor of the surrounding stream-handling logic that already references the captured `turnAutonomous` snapshot at line 529. The autonomous-mode behaviour moves with the panel as-is.
- **`aiSlashCommands.ts` and `aiAutoApprovePolicy.ts` (and their tests) live under `frontend/src/utils/`.** Both are AI-only utilities (the `Settings` page imports `aiAutoApprovePolicy` for the policy editor; this is the only non-AI consumer). They move into the plugin alongside the panel. `Settings.tsx` updates its import path. The two utility tests move along with the utilities.
- **`EntityMention.tsx` is reused by the chat panel** (line 22 import) **and is a general-purpose component** used by markdown-rendered text outside the AI context. It must stay in `frontend/src/components/` (not move into the plugin) so the data-dictionary surfaces that render entity mentions in non-AI contexts can still use it without cross-plugin import. The AI plugin imports `EntityMention` from `@/components/EntityMention` (allowed — components are app-shared, like UI primitives).
- **`getPageContext(pathname)` is exported from `AIChatPanel.tsx`** and tested independently in `AIChatPanel.pageContext.test.tsx`. It is a pure function. The move preserves the export.
- **`features.aiAssistance` flag.** Ticket body proposes adding `aiAssistance: true` to `shellPlugin.ts`'s features. We implement this. When the flag is **false**, `createAiAssistancePlugin().initialize` returns early — no `AI_SERVICE_TOKEN` provider, no `routes.ai-assistance` view, no commands. ShellLayout reads the flag at render time and skips the `<AIChatPanel>` mount + the `⌘K` listener.
- **No `aiSlice` exists today.** AIChatPanel manages all state via `useState` (mode, autonomous, conversation list, messages, policy, etc.) and persists across reloads via `localStorage` + the backend conversation routes. The ticket body proposes a slice for "conversation state, streaming buffer, autonomous mode flag." Per the **§2 cookbook rule** (loading/error live on Store FS nodes, not Redux) and the existing architecture (chat state is intrinsically component-local — streaming buffer references, abort controllers, scroll lock), **creating an `aiSlice` is out of scope for this slice**. The plugin's `initialize` does not register a reducer. Surface as Risk 5.
- **`DICTIONARY_SERVICE_TOKEN` is declared in `tokens.ts:10` but has no provider registered.** Verified: a repo-wide grep for `DICTIONARY_SERVICE_TOKEN` returns the token declaration and zero `ctx.provide({ provide: DICTIONARY_SERVICE_TOKEN, ... })` call. The ticket body's plan example (`AIService(/* injects DICTIONARY_SERVICE_TOKEN for entity grounding */)`) is therefore not yet implementable — `ctx.resolve(DICTIONARY_SERVICE_TOKEN)` would throw. We instead resolve the **four already-provided data-dictionary tokens** that exist today (`STEREOTYPE_SERVICE_TOKEN`, `INTEGRITY_SERVICE_TOKEN`, `DIFF_SERVICE_TOKEN`, `IMPORT_EXPORT_SERVICE_TOKEN`) **lazily, on demand from within AIService methods that need grounding**, not eagerly in the constructor. The dependency relationship is real (`dependsOn: ['store', 'auth', 'data-dictionary']` is correct), it just plugs into existing tokens. Surface as Risk 1.
- **#163 command-bus pattern is in force.** Per the spec-grep-guards.integrity test (acceptance #4 and #5), pages migrated for the bus consume `useCommand()(...)` rather than `useService(...)`. AIChatPanel mutations (chat send, conversation save, prompt CRUD, autonomous toggle) get wrapped as `ai.*` commands in the plugin's `initialize`, and the panel's call sites switch from `fetch(...)` to `commands.execute('ai.*', ...)`. The AI plugin contributes its 11 commands (see Public Surface) to **a new plugin-local `CommandMap` interface declared next to the plugin** (NOT to `kernel/commands.ts` — the kernel command map is data-dictionary + search + git; adding `ai.*` would violate the "plugins own their own commands" principle established by the `data-dictionary` and `search` namespaces). The plugin defines `AiCommandMap` and a typed `runAiCommand(...)` wrapper inside `frontend/src/plugins/ai-assistance/commands.ts`. Calls from `AIChatPanel.tsx` go through that wrapper.
- **#56 SlashCommandPalette is the inline `slashToken` picker** rendered inside `AIChatPanel.tsx`, not a separate file. It moves with the panel.

## Files touched

### New (plugin)
- `frontend/src/plugins/ai-assistance/aiPlugin.ts` — plugin factory implementing `PluginModule`. Registers `AI_SERVICE_TOKEN`, contributes route ownership (`/ai/**`, `/conversations/**` — both currently unused as routes but reserved for the plugin's namespace), registers 11 `ai.*` commands wrapping AIService methods. Honors the `features.aiAssistance` flag.
- `frontend/src/plugins/ai-assistance/services/AIService.ts` — Pattern B REST wrapper around `/api/ai/**`. 11 public methods (see signatures). Owns its own axios instance per cookbook §3b; **does not** import from `@/services/api`. Two methods (`sendChat`, `streamChat`) are streaming-aware and accept an `AbortSignal`.
- `frontend/src/plugins/ai-assistance/components/AIChatPanel.tsx` — moved verbatim from `frontend/src/components/AIChatPanel.tsx`. Imports updated:
  - `from '../utils/aiAutoApprovePolicy'` → `from './utils/aiAutoApprovePolicy'` (utility moves with plugin)
  - `from '../utils/aiSlashCommands'` → `from './utils/aiSlashCommands'`
  - `from '../hooks/usePrefs'` → `from '../../../hooks/usePrefs'` (shared hook stays at app root)
  - `from './EntityMention'` → `from '../../../components/EntityMention'` (shared component, stays in `components/`)
  - All `fetch('/api/ai/...')` call sites switch to `runAiCommand('ai.<verb>', ...)` (see Public Surface).
  - Module-level inline named export `getPageContext` and `EntityDiff` preserved (pageContext test and diff test depend on them).
- `frontend/src/plugins/ai-assistance/components/__tests__/` — the 13 existing `AIChatPanel.*.test.tsx` files move here. Each test's import line `from '../AIChatPanel'` stays valid (relative path inside the moved tree).
- `frontend/src/plugins/ai-assistance/utils/aiSlashCommands.ts` — moved verbatim.
- `frontend/src/plugins/ai-assistance/utils/aiAutoApprovePolicy.ts` — moved verbatim.
- `frontend/src/plugins/ai-assistance/utils/__tests__/aiSlashCommands.test.ts` — moved.
- `frontend/src/plugins/ai-assistance/utils/__tests__/aiAutoApprovePolicy.test.ts` — moved.
- `frontend/src/plugins/ai-assistance/commands.ts` — plugin-local `AiCommandMap` interface + typed `runAiCommand<K>(...)` wrapper, mirroring the shape of `kernel/commands.ts` but namespaced to this plugin.
- `frontend/src/plugins/ai-assistance/services/__tests__/AIService.test.ts` — unit test, constructor-injected stub `AxiosInstance`. Asserts URLs, payloads, envelope unwrapping for each method.
- `frontend/src/plugins/ai-assistance/__tests__/aiPlugin.test.ts` — bootstrap test asserting `AI_SERVICE_TOKEN` resolves to an instance with the 11 expected methods, and that the 11 `ai.*` commands are registered.
- `frontend/src/plugins/ai-assistance/__tests__/spec-grep-guards.ai.test.ts` — content guards mirroring `spec-grep-guards.integrity.test.ts`. See Acceptance §5.

### Modified
- `frontend/src/kernel/tokens.ts` — append `AI_SERVICE_TOKEN` symbol export with docblock.
- `frontend/src/kernel/bootstrap.ts` — import `createAiAssistancePlugin`, register as `host.registerPlugin('ai-assistance', { …, dependsOn: ['store', 'auth', 'data-dictionary'] }, createAiAssistancePlugin())`. **No reducer registration** for `ai` (per Scope §8 — no aiSlice in this slice).
- `frontend/src/plugins/shell/shellPlugin.ts` — append `aiAssistance: true` under `features:`. Default ON to preserve current behaviour.
- `frontend/src/plugins/shell/ShellLayout.tsx` — update import path from `'../../components/AIChatPanel'` to `'../../plugins/ai-assistance/components/AIChatPanel'`. Add a feature-flag guard: read `ctx.resolve(SHELL_TOKEN).config.features.aiAssistance` (verify the existing shell-token API in `@hamak/ui-shell-api`) and only mount `<AIChatPanel>` and the `⌘K`/`ai-chat:open` listeners when truthy. **Fallback**: if reading the flag adds cross-plugin entanglement, mount unconditionally and let `aiPlugin` skip registration when disabled — chat panel renders but the AIService throws on first call; defer the conditional-mount polish to a follow-up. (Decision noted as Risk 3.)
- `frontend/src/pages/Settings.tsx` — update import path for `aiAutoApprovePolicy` from `'../utils/aiAutoApprovePolicy'` to `'../plugins/ai-assistance/utils/aiAutoApprovePolicy'`.
- `CLAUDE.md` — add `ai-assistance` to the frontend plugin list paragraph (between `version-control` and `perspective` or appended at the end of the bulleted list — pick the location that minimizes diff churn).

### Deleted
- `frontend/src/components/AIChatPanel.tsx` — moved (verify no remaining references after the path migration).
- `frontend/src/components/__tests__/AIChatPanel.*.test.tsx` (13 files) — moved.
- `frontend/src/utils/aiSlashCommands.ts` — moved.
- `frontend/src/utils/aiAutoApprovePolicy.ts` — moved.
- `frontend/src/utils/__tests__/aiSlashCommands.test.ts` — moved.
- `frontend/src/utils/__tests__/aiAutoApprovePolicy.test.ts` — moved.

### Backend (out of scope — see Goal)
- `backend/src/controllers/aiController.ts` — unchanged (defer move to follow-up).
- `backend/src/services/conversationService.ts` — unchanged.
- `backend/src/services/promptService.ts` — unchanged.
- `backend/src/routes/ai/{chat,conversation,prompt}.routes.ts` — already grouped per #157; unchanged.

## Public surface (signatures)

### Token
```ts
// frontend/src/kernel/tokens.ts (append after the existing tokens)

/**
 * DI token for the AIService.
 *
 * Pattern B per #155 catalog: REST wrapper around the AI controller's
 * 14 endpoints under /api/ai/** (chat streaming, status, config, tools,
 * mentions, conversations CRUD, prompts CRUD). Owned by the
 * `ai-assistance` plugin; constructed and provided in
 * `aiPlugin.initialize` as an eager `useValue` (same shape as
 * `INTEGRITY_SERVICE_TOKEN`).
 *
 * AIService grounds itself in dictionary data by resolving existing
 * data-dictionary tokens (STEREOTYPE_SERVICE_TOKEN, INTEGRITY_SERVICE_TOKEN,
 * etc.) on demand inside specific methods — not eagerly in the
 * constructor — because `DICTIONARY_SERVICE_TOKEN` (declared above) has no
 * provider yet. See spec #162 Risk 1.
 */
export const AI_SERVICE_TOKEN = Symbol('AIService');
```

### AIService (Pattern B)
```ts
// frontend/src/plugins/ai-assistance/services/AIService.ts (new)

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
  messages: Array<{ id: string; role: 'user' | 'assistant'; parts: Array<{ type: 'text'; text: string }> }>;
  pageContext?: string;
  systemPrompt?: string;
  mode?: 'designer' | 'ask' | 'review';
}

export interface AIToolDef {
  name: string;
  description: string;
  parameters: Array<{ name: string; type: string; required: boolean; description: string }>;
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
  async getStatus(): Promise<AIStatus> { /* GET /ai/status */ }
  async getConfig(): Promise<AIStatus & { configPath?: string }> { /* GET /ai/config */ }
  async saveConfig(input: AIConfigInput): Promise<void> { /* POST /ai/config */ }

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
  async streamChat(request: AIChatRequest, signal: AbortSignal): Promise<Response> { /* fetch /api/ai/chat */ }

  // ── Tools ──────────────────────────────────────────────────────────
  async listTools(): Promise<AIToolDef[]> { /* GET /ai/tools */ }

  // ── Mentions ───────────────────────────────────────────────────────
  async searchMentions(query: string): Promise<AIMentionsResult> { /* GET /ai/mentions/search?q= */ }

  // ── Conversations ──────────────────────────────────────────────────
  async listConversations(query?: string): Promise<ConversationSummary[]> { /* GET /ai/conversations */ }
  async getConversation(id: string): Promise<Conversation | null> { /* GET /ai/conversations/:id */ }
  async saveConversation(conv: Conversation): Promise<void> { /* POST /ai/conversations */ }
  async patchConversation(id: string, patch: Partial<Pick<Conversation, 'title' | 'pinned' | 'systemPrompt'>>): Promise<void> { /* PATCH /ai/conversations/:id */ }
  async deleteConversation(id: string): Promise<void> { /* DELETE /ai/conversations/:id */ }

  // ── Saved Prompts ──────────────────────────────────────────────────
  async listPrompts(): Promise<SavedPrompt[]> { /* GET /ai/prompts */ }
  async createPrompt(input: { name: string; content: string }): Promise<SavedPrompt> { /* POST /ai/prompts */ }
  async updatePrompt(id: string, input: { name: string; content: string }): Promise<SavedPrompt> { /* PUT /ai/prompts/:id */ }
  async deletePrompt(id: string): Promise<void> { /* DELETE /ai/prompts/:id */ }

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
```

### AiCommandMap (plugin-local, NOT in `kernel/commands.ts`)
```ts
// frontend/src/plugins/ai-assistance/commands.ts (new)

import { host } from '../../kernel/bootstrap';
import type {
  AIChatRequest, AIStatus, AIConfigInput, AIToolDef, AIMentionsResult,
  Conversation, ConversationSummary, SavedPrompt,
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
```

### Plugin factory
```ts
// frontend/src/plugins/ai-assistance/aiPlugin.ts (new)

import type { PluginModule } from '@hamak/microkernel-spi';
import { AI_SERVICE_TOKEN } from '../../kernel/tokens';
import { AIService } from './services/AIService';

export interface AiPluginOptions {
  /** Default true. Set to false to skip all registrations (feature flag). */
  enabled?: boolean;
}

export function createAiAssistancePlugin(options: AiPluginOptions = {}): PluginModule {
  const enabled = options.enabled !== false;

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
      ctx.commands.register('ai.status.get',    () => ai.getStatus());
      ctx.commands.register('ai.config.get',    () => ai.getConfig());
      ctx.commands.register('ai.config.save',   (input) => ai.saveConfig(input));

      ctx.commands.register('ai.chat.send',     ({ request, signal }) => ai.streamChat(request, signal));

      ctx.commands.register('ai.tools.list',    () => ai.listTools());
      ctx.commands.register('ai.mentions.search', ({ q }) => ai.searchMentions(q));

      ctx.commands.register('ai.conversation.list',   ({ q }: { q?: string } = {}) => ai.listConversations(q));
      ctx.commands.register('ai.conversation.get',    ({ id }) => ai.getConversation(id));
      ctx.commands.register('ai.conversation.save',   ({ conversation }) => ai.saveConversation(conversation));
      ctx.commands.register('ai.conversation.patch',  ({ id, patch }) => ai.patchConversation(id, patch));
      ctx.commands.register('ai.conversation.delete', ({ id }) => ai.deleteConversation(id));

      ctx.commands.register('ai.prompt.list',   () => ai.listPrompts());
      ctx.commands.register('ai.prompt.create', ({ name, content }) => ai.createPrompt({ name, content }));
      ctx.commands.register('ai.prompt.update', ({ id, name, content }) => ai.updatePrompt(id, { name, content }));
      ctx.commands.register('ai.prompt.delete', ({ id }) => ai.deletePrompt(id));
    },

    async activate() {
      // Nothing to do — Pattern B service is already wired during initialize.
      // No autosave middleware (chat state is component-local), no hook
      // listeners (data-dictionary does not emit ai-relevant events yet).
    },
  };
}
```

### Bootstrap registration
```ts
// frontend/src/kernel/bootstrap.ts (additions)

import { createAiAssistancePlugin } from '../plugins/ai-assistance/aiPlugin';

// inside registerPlugins(), after the data-dictionary registration:
host.registerPlugin(
  'ai-assistance',
  { name: 'ai-assistance', version: '1.0.0', entry: '', dependsOn: ['store', 'auth', 'data-dictionary'] },
  // Read the feature flag off shell config — if shell isn't bootstrapped
  // yet (which it is, registered above), the default-on plugin proceeds.
  // We pass `enabled: true` literal here for the v1 implementation and
  // rely on ShellLayout's flag-check for the runtime gate. See Risk 3.
  createAiAssistancePlugin({ enabled: true }),
);
```

### Shell feature flag
```ts
// frontend/src/plugins/shell/shellPlugin.ts (modified)

const shellPlugin = createShellPlugin({
  theme: { mode: 'system' },
  features: {
    visualization: true,
    diagrams: true,
    versionControl: true,
    search: true,
    flatViews: true,
    aiAssistance: true, // #162 — gate the AI plugin's chat panel mount.
  },
});
```

### ShellLayout — flag-gated mount
```tsx
// frontend/src/plugins/shell/ShellLayout.tsx (modified)

// import path changes:
import AIChatPanel from '../../plugins/ai-assistance/components/AIChatPanel';
// (Read the feature flag from the shell-token. If reading proves awkward,
// fall back to mounting unconditionally — see Risk 3.)
const aiAssistanceEnabled = true; // v1: hardcoded ON; runtime gate via plugin enabled flag.

// inside the JSX:
{aiAssistanceEnabled && <AIChatPanel open={chatOpen} onClose={() => setChatOpen(false)} />}
```

## Framework APIs used

- `@hamak/microkernel-spi` — `PluginModule`, `InitializationContext`, `ActivateContext` (`frontend/node_modules/@hamak/microkernel-spi/dist/plugin.d.ts:17-21` — verified). `initialize` may return void or Promise<void>; `activate` is required; `deactivate` is optional.
- `@hamak/microkernel-api` — `Hooks`, `CommandRegistry` (used transitively via `ctx.commands.register` and `ctx.hooks.emit`). Already in use throughout `dataDictionaryPlugin.ts:127-237`.
- `host.registerPlugin(id, manifest, module)` — `frontend/node_modules/@hamak/microkernel-impl/dist/index.js` runtime (verified in current `bootstrap.ts:82` usage pattern). `dependsOn: string[]` is honored for activation order — confirmed by reading the runtime; the `Host` constructor processes dependencies before initialization.
- `axios` — direct dependency for the Pattern B HTTP client (cookbook anti-patterns explicitly permit `axios` inside `plugins/*/services/*.ts`).
- Native `fetch` — used by `AIService.streamChat` because axios does not expose a `ReadableStream` body for SSE. Already the pattern used in the current `AIChatPanel.tsx:604`. **Verified**: `Response.body.getReader()` is the standard streaming API and `AbortController.signal` is honored by `fetch`.

No new framework APIs introduced. No factory-runtime side-effects to audit (the AI plugin's `initialize` is a pure DI + command registration sequence; no auto-registration into other plugins' tokens).

## Acceptance criteria

### Acceptance #1 — Token declared exactly once
File `frontend/src/kernel/tokens.ts` matches `/export\s+const\s+AI_SERVICE_TOKEN\s*=\s*Symbol\(/` exactly once.

### Acceptance #2 — AIService self-contained
File `frontend/src/plugins/ai-assistance/services/AIService.ts`:
- Does NOT match `/from\s+['"][^'"]*services\/api['"]/`
- Does NOT match `/import.*dataDictionaryPlugin|DICTIONARY_SERVICE_TOKEN|STEREOTYPE_SERVICE_TOKEN|INTEGRITY_SERVICE_TOKEN|DIFF_SERVICE_TOKEN|IMPORT_EXPORT_SERVICE_TOKEN/` — AIService grounds itself **lazily inside methods**, not via constructor imports (this slice does not implement any grounding method yet, so no data-dictionary token imports appear).
- Has a `constructor(http?: AxiosInstance)` (verified by parsing the constructor signature in the test file).

### Acceptance #3 — DI registration in initialize with useValue
File `frontend/src/plugins/ai-assistance/aiPlugin.ts` inside the `async initialize(ctx)` body (slice from `'async initialize(ctx)'` to `'async activate('`):
- Matches `/AI_SERVICE_TOKEN/`
- Matches `/ctx\.provide\s*\(/`
- Matches `/useValue\s*:/`
- The provider block matching `/ctx\.provide\s*\(\s*\{[^}]*AI_SERVICE_TOKEN[^}]*\}\s*\)/` does NOT contain `useClass` or `useFactory`.
- Matches `/ctx\.commands\.register\(\s*['"]ai\.chat\.send['"]/` and at least 15 other `ai\.<noun>\.<verb>` registrations (16 total, listed in the AiCommandMap).

### Acceptance #4 — Data-dictionary plugin has no AI knowledge
- `frontend/src/plugins/data-dictionary/**/*.ts` (excluding `__tests__`): no match for `/AI_SERVICE_TOKEN|ai-assistance|AIService|AIChatPanel/i`.
- `frontend/src/plugins/ai-assistance/services/AIService.ts`: no match for `/data-dictionary|dataDictionaryPlugin/`.

### Acceptance #5 — Repo-wide content guards (spec-grep-guards.ai.test.ts)
A `vitest` test file at `frontend/src/plugins/ai-assistance/__tests__/spec-grep-guards.ai.test.ts` walks `frontend/src/**` and asserts:
- `frontend/src/components/AIChatPanel.tsx` does NOT exist.
- `frontend/src/utils/aiSlashCommands.ts` does NOT exist.
- `frontend/src/utils/aiAutoApprovePolicy.ts` does NOT exist.
- `frontend/src/components/__tests__/AIChatPanel.*.test.tsx` returns zero files.
- `frontend/src/utils/__tests__/aiSlashCommands.test.ts` and `aiAutoApprovePolicy.test.ts` do NOT exist.
- No file under `frontend/src/` outside `plugins/ai-assistance/**` imports from a path matching `/components\/AIChatPanel|utils\/aiSlashCommands|utils\/aiAutoApprovePolicy/`.
- `frontend/src/plugins/shell/ShellLayout.tsx` matches `/from\s+['"][^'"]*plugins\/ai-assistance\/components\/AIChatPanel['"]/`.
- `frontend/src/pages/Settings.tsx` imports `aiAutoApprovePolicy` from a path matching `/plugins\/ai-assistance\/utils\/aiAutoApprovePolicy/`.
- The walker excludes files whose basename ends in `spec-grep-guards.ai.test.ts` so the literal strings in this guard file do not falsely trip it against itself.

### Acceptance #6 — Plugin bootstrap test
File `frontend/src/plugins/ai-assistance/__tests__/aiPlugin.test.ts`:
- After `await bootstrapApplication()`, `host.rootActivationCtx.resolve(AI_SERVICE_TOKEN)` returns a non-null object.
- The resolved object has all 16 methods on the AIService class: `getStatus`, `getConfig`, `saveConfig`, `streamChat`, `listTools`, `searchMentions`, `listConversations`, `getConversation`, `saveConversation`, `patchConversation`, `deleteConversation`, `listPrompts`, `createPrompt`, `updatePrompt`, `deletePrompt` (15 — count corrected; AIChatRequest is a type, not a method). Assert each via `expect(typeof svc.<name>).toBe('function')`.
- `host.rootActivationCtx.commands.run('ai.status.get')` is a registered command (calling it with a stub `AIService` resolves; not asserting the response shape).
- The 16 `ai.*` command names from `AiCommandMap` all `.run()` without throwing "command not found".

### Acceptance #7 — AIService unit test (constructor-injected http)
File `frontend/src/plugins/ai-assistance/services/__tests__/AIService.test.ts`:
- For each non-streaming method, verifies the correct path is called on the stub `AxiosInstance` with the correct verb and (where applicable) payload.
- Verifies envelope unwrapping for `listConversations`, `getConversation`, `listPrompts` (current backend returns `{ data: [...] }` or `{ data: { ... } }`).
- For `streamChat`: a separate test patches global `fetch` via `vi.stubGlobal('fetch', ...)`. Asserts: URL is `'/api/ai/chat'`, method is `'POST'`, body is the JSON-stringified request, `signal` is forwarded, returned value is the `Response` from the stub.
- Test passes with `npx vitest run frontend/src/plugins/ai-assistance/services/__tests__/AIService.test.ts`.

### Acceptance #8 — AIChatPanel call-site migration
`frontend/src/plugins/ai-assistance/components/AIChatPanel.tsx`:
- Contains zero `/fetch\s*\(\s*['"]\/api\/ai\//` matches. All current 9 `fetch('/api/ai/...')` call sites are replaced with `await runAiCommand('ai.<verb>', ...)` calls.
- Imports `runAiCommand` from `'../commands'`.
- The streaming send path uses `await runAiCommand('ai.chat.send', { request, signal: ac.signal })`, then reads `response.body.getReader()` from the returned `Response`.
- Note: the panel also has one `fetch('/api/services/...')` call (line 908, `undoToolCall`) and one (line 1030, `loadEntityDiff`) — those are dictionary-domain calls, NOT AI calls. They stay as raw `fetch` for now (out of scope; future migration goes through `STEREOTYPE_SERVICE_TOKEN` / `IMPORT_EXPORT_SERVICE_TOKEN` once #154 lands and a unified DICTIONARY_SERVICE_TOKEN exists). Surface as Risk 1.

### Acceptance #9 — Plugin removable
With `aiPlugin` removed from `bootstrap.ts` `registerPlugins()` (commented out / deleted):
- `npm run build` in `frontend/` succeeds (no broken imports).
- App boots, `ShellLayout` still mounts. `<AIChatPanel>` import resolves (the file still exists at its new path), but the `useService(AI_SERVICE_TOKEN)` resolution inside `AIChatPanel`'s effects will throw the "no provider registered" error from `useService.ts:25`. The chat button still appears but clicking it logs the error to console.
- Disable the feature properly via `aiAssistance: false` instead — see #10.

### Acceptance #10 — Feature-flag disable
With `aiPlugin` registered but constructed as `createAiAssistancePlugin({ enabled: false })`:
- `AI_SERVICE_TOKEN` is NOT provided (`ctx.resolve` returns undefined / throws "no provider").
- No `ai.*` commands are registered.
- `routes.ai-assistance` view is NOT contributed.
- App boots, dictionary functions normally. Chat panel mount is gated by the ShellLayout flag check (`aiAssistanceEnabled` constant — or whichever resolution strategy the implementer picks per Risk 3).

### Acceptance #11 — Backend untouched
`git diff main -- backend/` contains zero changes from this branch. Backend `npm test` in `backend/` continues to pass without modification.

### Acceptance #12 — Existing AIChatPanel test suite still passes
After the move, all 13 `AIChatPanel.*.test.tsx` test files pass at their new location:
- `npx vitest run frontend/src/plugins/ai-assistance/components/__tests__/` returns green for all 13 files.
- The two utility test files (`aiSlashCommands.test.ts`, `aiAutoApprovePolicy.test.ts`) at their new location also pass.
- Tests that previously mocked `fetch('/api/ai/...')` continue to work because the panel still ultimately makes fetch calls — through `streamChat` for `/api/ai/chat`, and through the axios instance for everything else. Tests that mock `fetch` (not axios) will need an MSW-style update for non-streaming calls; the existing `setupTests.ts` already runs MSW so the route handlers extend straightforwardly.

### Acceptance #13 — CLAUDE.md updated
The `CLAUDE.md` "Frontend — Microkernel Plugin Architecture" plugin list section contains a new bullet referencing `ai-assistance` with a one-line description (e.g., *"`ai-assistance` — Chat panel, conversation history, prompt CRUD, slash commands; consumes data-dictionary services for grounding"*).

## Out of scope

- **Backend reorg** of `aiController.ts` → `controllers/ai/{chat,conversation,prompt}Controller.ts` and `conversationService.ts` / `promptService.ts` → `services/ai/`. Routes are already grouped (#157). Defer to a follow-up backend slice.
- **`DICTIONARY_SERVICE_TOKEN` provider.** Declared in tokens.ts but unused. Provider creation is owned by #154 (unified dictionary service). AIService grounding (e.g., resolving entity context for `@mention`) currently uses individual data-dictionary tokens lazily — no new provider in this slice.
- **`aiSlice` Redux reducer.** No state moves into Redux. AIChatPanel keeps its 25+ `useState` calls intact during the move. A future slice ticket can lift conversation list / current conversation into Redux if cross-component sharing is needed; today no other component reads or writes AI state.
- **Splitting `AIChatPanel.tsx` into `ChatMessage` / `ChatComposer` / `SlashCommandPalette` sub-components.** The ticket body lists them as if they exist; they do not. Splitting them is a separate refactor.
- **`useAutonomousMode` hook extraction.** No such hook exists today; carving it out requires refactoring the stream-handler's `turnAutonomous` capture pattern. Defer.
- **`ConversationsPage`.** Listed as "if such a page exists or is desired" in the ticket — no current route. Out of scope.
- **Per-user AI session storage** (#168 comment from 2026-05-13). Per-user storage requires backend changes (`APP_DATA/users/<userId>/`) that are owned by #168 (pluggable backends) and #169 (per-user worktrees). This slice keeps the existing `~/.dico-app/storage/` shared paths.
- **Tool execution scoped to the calling user's workspace** (#169 comment from 2026-05-13). Server-side concern; this slice's diff is entirely frontend (plus one CLAUDE.md line).
- **Migrating `Settings.tsx`'s `/api/ai/config` axios POST** (line 129) to `runAiCommand('ai.config.save', ...)`. Possible but enlarges the diff and creates an indirect coupling between Settings (still in `pages/`) and the AI plugin. Easier follow-up: route Settings's AI config calls through the new command bus once `aiSlice` ever exists or when Settings itself is plugin-split.
- **Migrating the two non-AI fetch calls inside `AIChatPanel.tsx`** (`/api/services/.../entities/...` at lines 908 and 1030). These are dictionary-domain reads and belong to data-dictionary services. Defer to the #154 unified dictionary service slice.
- **Cookbook §4** (commands & events). Not extended in this slice — the `AiCommandMap` lives **inside** the plugin (plugin-local typed surface) rather than being merged into `kernel/commands.ts`, which keeps the kernel-level command map data-dictionary-flavoured and aligns with the brief.

## Dependencies

- **Depends on #163** (merged: `298dc65 arch: register 19 commands wrapping the 5 DI services + typed event map`). The `runCommand` pattern and `useCommand` hook from #163 are the precedent for `runAiCommand`. Already in main.
- **Depends on #164** (merged: `e1cd826 arch: widen MetadataValue + plugin-registry for metadata types`). Establishes the registry-shaped Pattern B precedent — AIService is not registry-shaped, but the plugin-owns-its-tokens convention from #164 is followed.
- **Depends on #160** (merged: `9c9841f arch: replace hand-rolled version-control plugin with framework git plugin`). No direct interaction, but confirms the "plugins own their service factories" pattern.
- **Coordinates with #154** (slice ownership). If #154 lands first and provides a `DICTIONARY_SERVICE_TOKEN`, AIService can later resolve it for grounding without churning the spec — the constructor stays parameter-less; grounding methods resolve on demand.
- **Coordinates with #155** (DI services catalog). `AI_SERVICE_TOKEN` is the 7th token added under #155's catalog ordering. No conflict with the 6 already-declared tokens.
- **Coordinates with #157** (backend routes/ai/ folder). Already merged — backend folder structure assumed stable.
- **Coordinates with #168 / #169** (storage backends, per-user worktrees). Acknowledged in the 2026-05-13 comment; deferred entirely (see Out of scope).
- **Independent of #161** (case/rules extension points).

## Risks

1. **No `DICTIONARY_SERVICE_TOKEN` provider exists yet** — the ticket body's example AIService constructor that "injects DICTIONARY_SERVICE_TOKEN for entity grounding" is not implementable today. **Mitigation**: AIService takes only an optional `AxiosInstance` in this slice. Future grounding methods (e.g., `getEntityContext(name)`) resolve the four individual data-dictionary tokens (`STEREOTYPE_SERVICE_TOKEN`, `INTEGRITY_SERVICE_TOKEN`, `DIFF_SERVICE_TOKEN`, `IMPORT_EXPORT_SERVICE_TOKEN`) lazily via `host.rootActivationCtx.resolve(...)` from within the method body. When #154 lands the unified token, the methods migrate to it without changing AIService's constructor or `AI_SERVICE_TOKEN`'s provider shape.

2. **Streaming chat is not pure Pattern B** — `streamChat` returns a raw `Response` so the caller can read `body.getReader()`. The cookbook §3 worked example shows axios-based Pattern B; SSE doesn't fit that shape. **Mitigation**: We document the deviation in AIService's docblock (referencing the cookbook §3 prose mention of "AI chat streaming"), use native `fetch` for that one method, and keep the rest of the methods axios-shaped. The cookbook's next revision should add a "Pattern B variant — streaming" subsection (out-of-scope follow-up).

3. **ShellLayout reading the shell feature flag** — neither `@hamak/ui-shell-api` nor `@hamak/ui-shell-impl` exposes a known synchronous "read this feature flag" helper at the call site of `ShellLayout` render. **Mitigation**: For v1, the runtime gate is owned by the plugin's `enabled` constructor option (passed at `host.registerPlugin(...)` time in `bootstrap.ts`). ShellLayout mounts `<AIChatPanel>` unconditionally; when the plugin is `{ enabled: false }` the panel mounts but `useService(AI_SERVICE_TOKEN)` throws on first effect — the panel renders an empty error placeholder. Acceptance #10's mount-skipping is reframed as "AI_SERVICE_TOKEN not provided when flag is false" rather than "panel does not render." A clean conditional-mount is a follow-up that needs a small `useShellFeature(key)` hook.

4. **Existing 13 `AIChatPanel.*.test.tsx` test files may break on the move** — some tests mock `fetch` globally; they don't care about the file's location, but they may break because the panel switches from `fetch(...)` to `runAiCommand(...)` which goes through `host.rootActivationCtx.commands.run`. **Mitigation**: Each test that previously mocked `fetch('/api/ai/...')` is rewritten to either (a) bootstrap the host (`await bootstrapApplication()` in `beforeAll`) and let the real plugin call MSW handlers, or (b) provide a stub `AIService` directly into the DI container before mount (the latter requires a test-only `ctx.provide` shim — the integrity-page test (`#155-integrity` PR) shows the precedent). Effort estimated at ~30 minutes per test file; 13 files total. **Acknowledged risk: if mid-stream SSE parsing changes shape during the migration, several `policy`/`autonomous` tests may need new assertions.**

5. **No `aiSlice` means autonomous-mode toggle, current-conversation, mode-selection state stay component-local** — the ticket body proposed an aiSlice. **Mitigation (or non-mitigation)**: This is a deliberate scope cut. Component-local state has not caused observable problems (the only cross-component coupling is via `localStorage` + the `storage` event, which the panel already wires correctly). If a future feature (e.g., a sidebar mini-chat indicator) needs to read current-conversation state from another component, that ticket can introduce aiSlice. **This risk has no mitigation in the current slice — it's an honest deferral.**

