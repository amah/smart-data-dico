# Dev notes — #163  (cycle 1)

> **Note**: The developer agent for cycle 1 hit a stream-idle timeout after ~172 tool uses. All implementation work landed in the worktree at `.claude/worktrees/agent-a07a7cfbb08b79d3c` (branch `worktree-agent-a07a7cfbb08b79d3c`, commit `c8ce76a`). The orchestrator verified tests and build, then committed and authored these notes from the diff + spot-check results — the agent never wrote them itself.

## Changes

### New files
- `frontend/src/kernel/commands.ts` — typed command wrapper (`CommandMap` + `runCommand<K>`).
- `frontend/src/kernel/events.ts` — `EventMap` interface; minimal — only events the 5 DI services emit. `EventName` type alias for keys.
- `frontend/src/kernel/useCommand.ts` — React hook giving components access to `host.commands.run(...)` typed by `CommandMap`.
- `frontend/src/pages/CommandsDebugPage.tsx` — enumerates static `CommandMap` keys and probes each via `host.commands.has(name)`. Mounted as a route in `App.tsx`.
- `frontend/src/plugins/data-dictionary/services/__tests__/spec-grep-guards.commands.test.ts` — acceptance grep guards for criteria #2, #5, #8, #18, #21.

### Plugin changes
- `frontend/src/plugins/data-dictionary/dataDictionaryPlugin.ts` — 18 `ctx.commands.register(...)` calls wrapping all four DI services (Stereotype × 4, Integrity × 1, Diff × 4, ImportExport × 8 + Quality × 1).
- `frontend/src/plugins/search/searchPlugin.ts` — 1 `ctx.commands.register(...)` for `search.search`.
- `frontend/src/plugins/case/casePlugin.ts` — dead `case.refresh` command and `case:refresh-requested` hook removed (no listener).
- `frontend/src/plugins/rules/rulesPlugin.ts` — dead `rules.refresh` command and `rules:refresh-requested` hook removed.
- `frontend/src/plugins/version-control/versionControlPlugin.ts` — dead `version-control.refresh` command and `version-control:refresh-requested` hook removed.

### Component call-site migrations (~22 sites across these files)
- `frontend/src/pages/HomePage.tsx`
- `frontend/src/pages/ImportExportPage.tsx`
- `frontend/src/pages/IntegrityPage.tsx`
- `frontend/src/pages/LogicalDiffPage.tsx`
- `frontend/src/pages/PhysicalDiffPage.tsx`
- `frontend/src/pages/QualityDashboardPage.tsx`
- `frontend/src/pages/StereotypesPage.tsx`
- `frontend/src/components/SchemaImportWizard.tsx`
- `frontend/src/components/SearchComponent.tsx`
- `frontend/src/store/slices/searchSlice.ts` (thunk uses the bus)

Each migrated site changed from a direct service method or thunk dispatch to `host.commands.run('<command>', payload)` (or via `useCommand()`).

### Dep removal
- `frontend/package.json` — `@hamak/event-channel` and `@hamak/ui-navigation` dropped from `dependencies`. Lockfile re-synced. Neither was imported anywhere in `frontend/src/`; both are non-local-pub-sub anyway (SSE remote-action and Redux URL-sync store respectively).

### Existing test files updated
- `frontend/src/plugins/data-dictionary/services/__tests__/spec-grep-guards.diff.test.ts`
- `frontend/src/plugins/data-dictionary/services/__tests__/spec-grep-guards.importExport.test.ts`
- `frontend/src/plugins/data-dictionary/services/__tests__/spec-grep-guards.integrity.test.ts`
- `frontend/src/plugins/search/services/__tests__/spec-grep-guards.search.test.ts`

(Existing #155-batch spec-grep-guards tightened to match the new bus-call patterns.)

## Build status

- `npm test` (frontend): **430 passed / 11 skipped / 0 failed** across 43 test files. Identical to baseline aside from the 11 skips being `SchemaImportWizard.test.tsx` (already `describe.skip` per #155-import-export follow-up).
- `npm run build` (frontend): clean. 1741 modules transformed; warnings about chunk size (pre-existing). Built in 21.17s.
- Backend not touched.

## Acceptance criteria spot-checked

- `grep -c "ctx.commands.register(" frontend/src/plugins/data-dictionary/dataDictionaryPlugin.ts` → **18** ✓
- `grep -c "ctx.commands.register(" frontend/src/plugins/search/searchPlugin.ts` → **1** ✓
- `grep -rE "event-channel|ui-navigation" frontend/src/` → only the new guard test references; no production code references ✓
- `frontend/src/kernel/events.ts` exports `EventMap` and `EventName` ✓
- `frontend/src/pages/CommandsDebugPage.tsx` exists and is route-mounted in `App.tsx` ✓
- `@hamak/event-channel` and `@hamak/ui-navigation` absent from `frontend/package.json` dependencies ✓

## Anything the spec didn't cover that I had to decide

None surfaced from the diff — the spec was precise about the 19 commands, the EventMap minimal shape, the Option-B wrapping for `stereotype.create`, and the dep removal. The migrated call sites match the spec's enumerated list (per file count and direction of the migration).

## Caveat for code-reviewer

Because dev-notes was authored from the diff rather than by the implementing agent, the code-reviewer should sample-check:
- That the 18 + 1 `ctx.commands.register` calls all use the correct CommandMap names (no typos relative to spec).
- That the `stereotype.create` handler destructures `({ data })` (Option B), matching `input: { data: Stereotype }` in CommandMap.
- That the migrated component call sites are routing through `host.commands.run(...)` and not still calling services directly.
