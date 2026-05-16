# Dev notes — #154 (reframed)  (cycle 1)

## Changes

- `frontend/src/plugins/search/searchPlugin.ts:1-163` — Full rewrite: added `SearchPluginOptions`, `SearchResultFileContent`, `SearchCommandResult` interfaces; inline 6-char id generator (no `nanoid` dep); `createSearchPlugin(options?)` resolves `STORE_FS_TOKEN` + `STORE_MANAGER_TOKEN` in `initialize`, registers `search.search` command that writes dynamic Store FS files via `actions.setFile` and returns `{ path, response }`.

- `frontend/src/plugins/data-dictionary/dataDictionaryPlugin.ts:30-48` — Added `DataDictionaryPluginOptions` interface with `workingFolder?: string[]`; factory signature updated to `createDataDictionaryPlugin(options?)`. `workingFolder` informational only; `STEREOTYPES_PATH` unchanged.

- `frontend/src/plugins/visualization/visualizationPlugin.ts:9-19` — Added `VisualizationPluginOptions` interface with `workingFolder?: string[]`; factory signature updated to `createVisualizationPlugin(options?)`. Informational only.

- `frontend/src/plugins/ai-assistance/aiPlugin.ts` — **Created** (file did not exist in this worktree). Minimal `createAiAssistancePlugin(options?)` with `AiPluginOptions { enabled?, workingFolder? }`. Informational stub; chat state stays in AIChatPanel's local useState.

- `frontend/src/kernel/bootstrap.ts:35` — Dropped `searchReducer` import; dropped `reducerRegistry.register('search', searchReducer)` call; added `workingFolder` to all four plugin factory calls; added `'store-fs'` to search plugin's `dependsOn`.

- `frontend/src/store/slices/searchSlice.ts` — **Deleted**. Dead code (no consumer read `state.search.*`).

- `frontend/src/components/SearchComponent.tsx:1-30,45-67` — Replaced `useState<SearchResult[]>([])` with `useState<string[] | null>(null)` (`currentPath`); added `useMemo` + `useSelector` to derive `results` from Store FS `FileNode<SearchResultFileContent>` via `storeFs.createFileSelector(currentPath)`; updated `performSearch` to destructure `{ path }` from command result and call `setCurrentPath(path)`. `useState<loading|error>` preserved per cookbook §2.

- `frontend/src/kernel/commands.ts:37-38,124-127` — Updated import to use `SearchCommandResult` instead of `SearchResponse`; changed `search.search` output type from `SearchResponse` to `SearchCommandResult`.

- `frontend/src/plugins/search/services/__tests__/spec-grep-guards.search.test.ts:153-164` — Rewrote criterion #13: assert `searchSlice.ts` does NOT exist + assert plugin registers command + calls `actions.setFile`.

- `frontend/src/plugins/data-dictionary/services/__tests__/spec-grep-guards.commands.test.ts:451-456` — Rewrote criterion #16's `searchSlice.ts calls commands.run for search.search` → `searchSlice.ts does not exist`.

- `frontend/src/plugins/search/services/__tests__/spec-grep-guards.search-workingFolder.test.ts` — **Created** (new file). 26 guards covering #154 acceptance criteria: workingFolder interfaces on all four plugins, `setFile` vs `setFileContent`, bootstrap.ts cleanliness, SearchComponent Store FS pattern, CommandMap output type.

## Build status

- frontend: ✅ vite build clean (1740 modules, no errors)
- frontend tsc: Pre-existing errors only (AIChatPanel.*.test.tsx `scrollIntoView` on `never`; CommandsDebugPage.tsx `React` unused import; dataDictionaryPlugin.commands.test.ts `vi` unused). These are all baseline — unrelated files I did not touch. Zero new errors introduced.
- frontend lint: ⚠️ `npm run lint` fails with "ESLint couldn't find a configuration file" — **baseline broken** (same failure in the main project's frontend directory). No `.eslintrc` file exists anywhere in the frontend tree in either the main checkout or this worktree. This is a pre-existing infra gap, not introduced by this ticket.
- backend: not touched

## Tests

- Before this ticket: 485 passed / 11 skipped / 0 failed (worktree baseline)
- After this ticket: 511 passed / 11 skipped / 0 failed (26 new tests in spec-grep-guards.search-workingFolder.test.ts)
- All existing tests preserved (SearchComponent.test.tsx #16/#17 pass; spec-grep guards pass)

## Spec AC grep results

All pass:
- `test ! -f frontend/src/store/slices/searchSlice.ts` → PASS (file deleted)
- No `reducerRegistry.register('search'` in bootstrap.ts → PASS
- `workingFolder` in `searchPlugin.ts` → PASS
- `workingFolder` in `dataDictionaryPlugin.ts` → PASS
- `search-${id}.json` pattern in `searchPlugin.ts` → PASS

One spec discrepancy (noted):
- Spec AC says `grep -F "search-" frontend/src/plugins/search/services/SearchService.ts` should find the prefix. It won't — the `search-` prefix lives in `searchPlugin.ts` per the spec's own design (service is unchanged). This is a copy-paste error in the spec AC; the correct path is `searchPlugin.ts`. [verified]

## Judgment calls

- **ai-assistance/aiPlugin.ts** did not exist in this worktree (the `#162` AIChatPanel branch had not landed). Created a minimal stub satisfying the spec's signature (`AiPluginOptions { enabled?, workingFolder? }`). Bootstrap.ts does NOT register this plugin (it wasn't registered before, and the spec doesn't say to register it). The spec only says to add `workingFolder?` to the options type.
- **Inline id generator** used instead of `nanoid` (spec Risk 3 recommended this). The generator uses `crypto.getRandomValues(Uint8Array(6))` with base36 encoding, producing 6-char `[a-z0-9]` strings matching the spec's example `'search-xonncv'` shape and the AC regex `/^search-[a-z0-9_-]{6}\.json$/`.
- **`void options.workingFolder`** used in dataDictionaryPlugin and visualizationPlugin to consume the option without triggering an unused-variable lint warning. aiPlugin uses the same pattern. This is a deliberate idiom, not dead code.

## Unrelated issues noticed (not fixed)

- `frontend/src/pages/CommandsDebugPage.tsx:19` — `import React from 'react'` triggers unused-variable TS error (pre-existing baseline). [verified]
- `frontend/src/components/__tests__/AIChatPanel.*.test.tsx` — `scrollIntoView` property not on type `never` (pre-existing; likely from a mock typing issue in the test setup). [verified]
