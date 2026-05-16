# Dev notes — #162  (cycle 1)

## Changes

- `frontend/src/kernel/tokens.ts:82-100` — appended `AI_SERVICE_TOKEN = Symbol('AIService')` with full docblock

- `frontend/src/plugins/ai-assistance/aiPlugin.ts` — new plugin factory; registers AI_SERVICE_TOKEN, 16 `ai.*` commands, and the `routes.ai-assistance` view. Honors `enabled` option (feature flag).

- `frontend/src/plugins/ai-assistance/services/AIService.ts` — new Pattern B REST wrapper for `/api/ai/**`; 15 public methods + static createDefaultHttp. `streamChat` uses native `fetch` (Pattern B exception for SSE), all others use axios. AI grounding deferred (comment explains `DICTIONARY_SERVICE_TOKEN` has no provider yet — spec Risk 1). Does NOT import from `@/services/api`.

- `frontend/src/plugins/ai-assistance/commands.ts` — new plugin-local `AiCommandMap` (16 commands) + `runAiCommand<K>` typed wrapper. NOT merged into `kernel/commands.ts` per spec constraint.

- `frontend/src/plugins/ai-assistance/components/AIChatPanel.tsx` — moved verbatim from `frontend/src/components/AIChatPanel.tsx`. Import paths updated: `usePrefs` → `../../../hooks/usePrefs`, `EntityMention` → `../../../components/EntityMention`, `aiAutoApprovePolicy` → `../utils/aiAutoApprovePolicy`, `aiSlashCommands` → `../utils/aiSlashCommands`. Added `import { runAiCommand } from '../commands'`. All 9 `fetch('/api/ai/...')` calls replaced with `runAiCommand('ai.*', ...)`. Two non-AI fetch calls (`/api/services/...`) kept as-is per spec (out of scope for #154).

- `frontend/src/plugins/ai-assistance/utils/aiSlashCommands.ts` — moved verbatim from `frontend/src/utils/aiSlashCommands.ts`

- `frontend/src/plugins/ai-assistance/utils/aiAutoApprovePolicy.ts` — moved verbatim from `frontend/src/utils/aiAutoApprovePolicy.ts`

- `frontend/src/plugins/ai-assistance/utils/__tests__/aiSlashCommands.test.ts` — moved (no import changes needed; relative path to `../aiSlashCommands` still valid)

- `frontend/src/plugins/ai-assistance/utils/__tests__/aiAutoApprovePolicy.test.ts` — moved (no import changes needed)

- `frontend/src/plugins/ai-assistance/components/__tests__/AIChatPanel.*.test.tsx` (13 files) — moved from `frontend/src/components/__tests__/`. Updated imports: `../../test/setup` → `../../../../test/setup`, `../EntityMention` → `../../../../components/EntityMention`. Added `vi.mock('../../commands', ...)` to each file that mounts the panel (routes commands to direct fetch to avoid full kernel bootstrap in component tests). `diff.test.tsx` and `pageContext.test.tsx` needed no mock (no panel mount).

- `frontend/src/plugins/ai-assistance/__tests__/spec-grep-guards.ai.test.ts` — new spec guards for the 18 acceptance criteria from spec.md

- `frontend/src/kernel/bootstrap.ts:22,175-183` — import `createAiAssistancePlugin`; register `ai-assistance` plugin with `dependsOn: ['store', 'auth', 'data-dictionary']`

- `frontend/src/plugins/shell/ShellLayout.tsx:17-18` — updated AIChatPanel import to new plugin path; added `aiAssistanceEnabled` constant; JSX uses feature flag guard

- `frontend/src/plugins/shell/shellPlugin.ts:22` — added `aiAssistance: true` to features

- `frontend/src/pages/Settings.tsx:13` — updated `aiAutoApprovePolicy` import from `'../utils/...'` to `'../plugins/ai-assistance/utils/...'`

- `CLAUDE.md` — added `ai-assistance` bullet to the plugin list

### Deleted (moved)
- `frontend/src/components/AIChatPanel.tsx`
- `frontend/src/utils/aiSlashCommands.ts`
- `frontend/src/utils/aiAutoApprovePolicy.ts`
- `frontend/src/utils/__tests__/aiSlashCommands.test.ts`
- `frontend/src/utils/__tests__/aiAutoApprovePolicy.test.ts`
- `frontend/src/components/__tests__/AIChatPanel.*.test.tsx` (13 files)

## Build status
- frontend: ✅ vite build clean (1744 modules; chunk size warning is pre-existing)
- frontend tests: ✅ 502 passed / 11 skipped / 0 failed (50 test files)
- spec-grep-guards: ✅ 18/18 passed
- backend: ✅ untouched (0 lines diff vs HEAD -- backend/)
- frontend lint: ⚠️ ESLint config not found in worktree (no `.eslintrc.*` in worktree `frontend/` — this is a baseline-broken condition; the lint config lives in the main checkout and is not copied into git worktrees by default). Checked in main checkout: lint is a baseline issue unrelated to this ticket.

## Unrelated issues noticed (not fixed)
- `frontend/src/plugins/ai-assistance/components/__tests__/testHelpers.ts` — created as a helper stub but not actually used (vi.mock inline was used directly in each test). Safe to delete in a follow-up, or keep as documentation.

## Anything the spec didn't cover that I had to decide

1. **vi.mock path for runAiCommand in tests**: The spec says tests should pass but doesn't specify HOW to handle the command-bus requirement in tests. Used `vi.mock('../../commands', ...)` (the module factory routes each command to a direct `fetch()` matching the existing MSW test handlers). This avoids full kernel bootstrap (which would OOM the vitest worker when combined with heavy streaming DOM tests). Path is `'../../commands'` because tests are in `components/__tests__/`, not `components/` — must go two levels up to reach `plugins/ai-assistance/commands.ts`.

2. **`createConversation` type cast**: `runAiCommand('ai.conversation.save', { conversation: conv as any })` uses `as any` because the local `ChatMessage` type in the component doesn't exactly match `ConversationChatMessage` from AIService. The shape is compatible at runtime; the `as any` is safe here as the actual JSON is serialized directly.

3. **`testHelpers.ts` file**: Created but not used. The inline vi.mock approach was cleaner than importing from a helper (vitest module factory can't easily reference imported values). Left in place as documentation; does not affect build or tests.

4. **`beforeAll` retained in `AIChatPanel.test.tsx`**: The sed script that updated vitest imports included `beforeAll` in the import for `AIChatPanel.test.tsx` even though it's not used (the only `beforeAll` was removed along with the bootstrap approach). The unused import doesn't affect tests but is slightly messy. Cleaned up manually.
