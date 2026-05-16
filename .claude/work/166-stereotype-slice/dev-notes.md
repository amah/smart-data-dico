# Dev notes — #166-stereotype-slice  (cycle 2)

## Status

**COMPLETE.** Cycle-1 escalation resolved by orchestrator-authorized Option A
(modified for current-main state): the `notify` wiring in
`dataDictionaryPlugin.ts` was moved from `initialize` to a second-stage
`activate` step, with a module-scope `notifyImpl` slot that the `initialize`
forwarder resolves at call time. All other cycle-1 work (tokens, store-fs
plugin, StereotypeService, StereotypesPage, bootstrap, useService) is
preserved untouched.

## Branch base

`arch/166-stereotype-slice` off `main` at `4a4d80b` (arch scaffolding for
#154–#169). The in-house `notificationPlugin.ts` is present on `main` and
registers `notification.{success,error,warning,info}` with positional
`(message: string)` signatures (NOT the framework factory). The cycle-2
`activate` handler matches that surface.

## Changes applied this cycle

- `frontend/src/plugins/data-dictionary/dataDictionaryPlugin.ts` — replaced the
  closure-form `notify` inside `initialize` with:
  - Module-scope `let notifyImpl: NotifyFn = () => {};` plus a stable
    forwarder lambda `(level, message) => notifyImpl(level, message)` passed
    to the `StereotypeService` constructor at `initialize` time.
  - An `activate(ctx)` handler that swaps `notifyImpl` to the real
    implementation: `ctx.commands.run(\`notification.${level}\`, message)`
    wrapped in try/catch (notification plugin not present in test bootstrap is
    swallowed).
  - TODO comments at module scope AND at the `activate` site document the
    post-#156-merge cleanup (positional → object signature).

No other files were touched in cycle 2. Cycle-1 outputs were verified intact
via `git status` and per-file inspection of the touched plugin code.

## Build status (frontend; backend not touched)

Verification commands run from `/Users/amah/Devs/projects/smart-data-dico/frontend`.

- `npx tsc --noEmit` (whole project): 9 baseline `AIChatPanel*.test.tsx`
  `scrollIntoView` errors only.
  - **Stash-and-recheck baseline confirmation:** `git stash push -u` then
    `npx tsc --noEmit` on clean main → same 9 errors, identical lines and
    types. `git stash pop` restored cycle-2 worktree. Conclusion: cycle-2 adds
    zero net tsc errors.
- `npx tsc --noEmit` filtered (`grep -v 'AIChatPanel\\.(suffixes)?\\.test\\.tsx'`
  per orchestrator's verification recipe): only `src/components/__tests__/AIChatPanel.test.tsx`
  (no suffix) leaks past the filter; it is also baseline. With a corrected
  filter that includes the bare file, the touched-file tsc result is **0
  errors**.
- `npm run build` → **PASS**. Vite production build: 1693 modules transformed,
  3.27 MB JS bundle, 130.78 kB CSS, exit 0 in 27.29s. Note: `package.json`
  build script is `vite build` only (no separate `tsc -b` step), so vite is
  the gatekeeper here.
- `npm run lint` → **N/A (baseline-broken)**. ESLint reports no config file in
  the workspace — same as cycle-1 baseline, same as `main`. Not regressed.

Backend: not touched this ticket.

## Acceptance criteria — final status

| # | Criterion | Status | Notes |
|---|---|---|---|
| 1 | `STORE_FS_TOKEN` resolves to a `StoreFileSystemFacade<RootState>` | PASS (code) | `storeFsPlugin.ts` provides Proxy in `initialize`, fills in `activate`. |
| 2 | `AUTOSAVE_REGISTRY_TOKEN` resolves with one `remote-fs` provider, priority 10 | PASS (code) | Registry constructed at factory time, provider registered in `activate`. |
| 3 | `state.fs` initial shape | PASS | Framework-provided, untouched. |
| 4 | `STEREOTYPE_SERVICE_TOKEN` resolves a service with the expected method shape | PASS (code) | Now typechecks clean post-cycle-2 fix. |
| 5 | `useAll()` returns Store FS-cached data after `hydrate` | PASS (code) | `hydrate` does `mkdir(parents=true)` then `setFile`. |
| 6 | `useFile()` exposes `contentLoaded`/`contentLoadError` | PASS (code) | Framework behavior, surfaced through facade. |
| 7 | `loadAll()` populates the cache | PASS (code) | REST fetch → `hydrate(list, true)`. |
| 8 | `loadAll()` failure marks `contentLoaded=false` and fires `notify('error', …)` | PASS (code) | Service path complete; notify callback now fully wired post-cycle-2. |
| 9 | `create/update` POST/PUT and refresh cache | PASS (code) | Imperative methods + `loadAll()` reload. |
| 10 | `delete` DELETE and refresh cache | PASS (code) | Imperative method + `loadAll()` reload. |
| 11 | No `PUT_REQUEST` fires for stereotype writes | PASS (by construction) | `hydrate` uses `setFile`, not `setFileContent`; autosave middleware never claims. |
| 12 | Singleton-host bootstrap end-to-end | PASS (code) | Plugin now compiles, `activate` wires the bus. |
| 13 | No `useState<boolean|Error>` in new files OR `StereotypesPage.tsx` | PASS | Page retains only `useState<boolean>(false)` for `showCreate` and `useState<string | null>(null)` for `editingId` (ephemeral UI state, §1.5). |
| 14 | Touched files typecheck | **PASS** | `npx tsc --noEmit` filtered to touched files: 0 errors. |
| 15 | Test-file count + 3 | TEST-AUTHOR SCOPE | Not in my purview. |
| 16 | Lint not regressed | PASS | No `.eslintrc.*` on `main`; same baseline. |
| 17 | `attempts.log` appended | PASS | Cycle-2 line appended. |

## Unrelated issues noticed (not fixed)

- **Post-#156-merge cleanup:** when PR #171 lands and the in-house
  notificationPlugin.ts is replaced by the framework factory, the
  `ctx.commands.run` call needs its signature changed from positional
  `(level, message)` to `(level, { message })`. Single-line edit in
  `dataDictionaryPlugin.ts`'s `activate` handler (the TODO comment is in
  place).
- 9 pre-existing `AIChatPanel*.test.tsx` `scrollIntoView: does not exist on
  type 'never'` errors continue on `main`. Out of scope for this ticket.

## Anything the spec didn't cover that I had to decide

1. **Cycle-2 decision (orchestrator-authorized Option A modified):** module-scope
   mutable `notifyImpl` slot + activate-time wiring. Service receives a stable
   forwarder lambda at `initialize`, so the closure capture works correctly
   even though the real bus call is bound later. Documented inline in the
   plugin file with TODO comments anchored to PR #171.

2. *(carried from cycle 1)* **`Dispatch<Action>` parameterization in
   StereotypeService.** Bare `Dispatch` defaults to `Dispatch<UnknownAction>`,
   which doesn't accept the framework's `FileSystemNodeAction` (extends
   `Action` only). Narrowed to `Dispatch<Action>`; one-line addition of
   `Action` to the import. Semantically equivalent to spec intent.

3. *(carried from cycle 1)* **Branch base = `main`.** Per orchestrator
   guidance. Working tree's pre-existing edits to `.claude/agents/*.md`,
   `.gitignore`, and untracked `.claude/work/` folders carried across — not
   on any branch.

## Files in the working tree (this branch)

Modified:
- `frontend/src/kernel/tokens.ts`
- `frontend/src/kernel/bootstrap.ts`
- `frontend/src/pages/StereotypesPage.tsx`
- `frontend/src/plugins/data-dictionary/dataDictionaryPlugin.ts` (cycle-2 edits)
- `frontend/src/plugins/store/index.ts`
- `.claude/agents/*.md` (carried over, not part of this ticket)
- `.gitignore` (carried over, not part of this ticket)

New:
- `frontend/src/plugins/store/storeFsPlugin.ts`
- `frontend/src/plugins/data-dictionary/services/StereotypeService.ts`
- `frontend/src/kernel/useService.ts`
- `.claude/work/166-stereotype-slice/dev-escalation.md` (from cycle 1)
- `.claude/work/166-stereotype-slice/dev-notes.md` (this file — cycle 2)
