# Test results — #166-stereotype-slice  (cycle 1)

## Summary

- **Files added (4):**
  - `frontend/src/plugins/store/__tests__/storeFsPlugin.test.ts` — Host bootstrap, covers acceptance #1, #2, #3
  - `frontend/src/plugins/store/__tests__/spec-grep-guards.test.ts` — fs-based content guards, covers acceptance #13
  - `frontend/src/plugins/data-dictionary/services/__tests__/StereotypeService.test.ts` — Pattern A facade behavior, covers acceptance #4–#11
  - `frontend/src/pages/__tests__/StereotypesPage.bootstrap.test.tsx` — production-singleton bootstrap + first-paint loading, covers acceptance #12
- **Tests:** 28 new tests, 28/28 pass. Full suite: 28 test files / 202 tests, 28/28 files pass.
- **No existing tests broken** by this ticket.
- **One implementation-side recommendation** (verified): add `test.server.deps.inline: [...@hamak/* explicit list]` to `frontend/vite.config.ts`. Required for Vitest to load `@hamak/ui-store-impl@0.5.0` (which has directory-imports `export * from './core'` that Node's strict ESM loader rejects). Applied to `vite.config.ts`. Same root cause as #156 cycle-1 escalation but verified by hand this cycle.

## Coverage of acceptance criteria

| # | Criterion | Test file:line | Status |
|---|---|---|---|
| 1 | `STORE_FS_TOKEN` resolves a working facade (truthy + 4 method signatures + setFile populates state.fs) | `storeFsPlugin.test.ts:83-118` | pass |
| 2 | `AUTOSAVE_REGISTRY_TOKEN` resolves a registry with exactly one provider (id='remote-fs', priority=10) — presence-only, never invokes `supports()` (Bug A) | `storeFsPlugin.test.ts:120-131` | pass |
| 3 | `state.fs` populated with framework initial shape (`{ root: { type: 'directory', name: '', children: {}, … } }`) | `storeFsPlugin.test.ts:133-152` | pass |
| 4 | `STEREOTYPE_SERVICE_TOKEN` resolves a `StereotypeService` with the expected method shape | `StereotypeService.test.ts:155-174` | pass |
| 5 | `useAll()` returns Store FS-cached data after `loadAll()` | `StereotypeService.test.ts:177-202` | pass |
| 6 | `useFile()` exposes `contentLoaded` / `contentLoadError` (`true`/`undefined` on success, `false` on failure) | `StereotypeService.test.ts:204-260` | pass (2 cases) |
| 7 | `loadAll()` populates Store FS through MSW-mocked REST | `StereotypeService.test.ts:262-275` | pass |
| 8 | `loadAll()` failure marks node not-loaded AND fires `notify('error', …)` | `StereotypeService.test.ts:277-294` | pass |
| 9 | `create()` POSTs through REST and updates the cache | `StereotypeService.test.ts:296-330` | pass |
| 10 | `update()` and `delete()` likewise refresh the cache | `StereotypeService.test.ts:332-388` | pass (2 cases) |
| 11 | No `RemoteFsActionTypes.PUT_REQUEST` fires for stereotype writes (uses `setFile`, not `setFileContent`) — symbolic via enum | `StereotypeService.test.ts:390-441` | pass |
| 12 | Production singleton bootstrap works end-to-end: `host.rootActivationCtx` defined, service resolvable, page renders without throwing, **first paint = loading**, GET called exactly once on mount, fixture name renders after fetch resolves | `StereotypesPage.bootstrap.test.tsx:60-125` | pass (3 cases) |
| 13 | No `useState<boolean|Error>(…)` in new files; `StereotypesPage.tsx` only has `useState` for ephemeral UI (`showCreate`, `editingId`) per §1.5 | `spec-grep-guards.test.ts:50-104` | pass (4 cases via `it.each`) |
| 14 | Touched files typecheck cleanly | — | pass (per `dev-notes.md` cycle-2 final status; not re-run as Vitest assertion — this is a `tsc --noEmit` shell check executed at PR-review time, not a runtime test) |
| 15 | Existing tests stay green; test-file count grows by exactly 3 | — | **deviation noted** — 4 new test files added (spec lists 3 but agent prompt explicitly required a separate `spec-grep-guards.test.ts`). Existing tests are green (24/24 baseline files unchanged, all 174 baseline tests still pass; the 28 new tests are a clean addition). |
| 16 | Lint not regressed | — | n/a (skipped — `.eslintrc.*` baseline absent from `main`, same as #156) |
| 17 | Attempts log appended | — | pass (line appended at end of cycle) |

## Coverage of file-level grep guards (#13 details)

The grep-guards suite asserts more than just useState bans — it also locks in the page migration and bootstrap wiring:

| Guard | Test |
|---|---|
| `useState<boolean\|Error>(...)` banned in storeFsPlugin.ts | `spec-grep-guards.test.ts:50-78` |
| `useState<boolean\|Error>(...)` banned in StereotypeService.ts | `spec-grep-guards.test.ts:50-78` |
| `useState<boolean\|Error>(...)` banned in useService.ts | `spec-grep-guards.test.ts:50-78` |
| `useState<boolean\|Error>(...)` banned in dataDictionaryPlugin.ts | `spec-grep-guards.test.ts:50-78` |
| StereotypesPage has no `useState<(boolean\|Error\|string \| null)>` except allow-listed ephemeral UI | `spec-grep-guards.test.ts:80-104` |
| StereotypesPage imports `useService` and `STEREOTYPE_SERVICE_TOKEN`; no direct `stereotypeApi` import in the page | `spec-grep-guards.test.ts:106-115` |
| `bootstrap.ts` registers `'store-fs'` with `dependsOn` containing `'store'` and `'remote-fs'` | `spec-grep-guards.test.ts:119-133` |
| `bootstrap.ts` `data-dictionary` `dependsOn` includes `'store-fs'` | `spec-grep-guards.test.ts:135-144` |
| `tokens.ts` exports `STORE_FS_TOKEN` and `STEREOTYPE_SERVICE_TOKEN` | `spec-grep-guards.test.ts:147-156` |

## Implementation-side recommendation (verified)

**File:** `frontend/vite.config.ts`
**Change:** add `test.server.deps.inline: ['@hamak/microkernel-impl', '@hamak/microkernel-api', '@hamak/microkernel-spi', '@hamak/ui-store-impl', '@hamak/ui-store-api', '@hamak/ui-store', '@hamak/ui-remote-fs', '@hamak/ui-remote-git-fs', '@hamak/ui-shell', '@hamak/ui-navigation', '@hamak/shared-utils', '@hamak/event-channel', '@hamak/notification']`.
**Why:** `@hamak/ui-store-impl@0.5.0` (installed) ships with directory-style ESM re-exports (`export * from './core';` in `dist/index.js`). Node's strict ESM loader rejects these with `ERR_UNSUPPORTED_DIR_IMPORT`. Forcing the framework packages through Vite's transform pipeline (which understands directory imports via its resolver) avoids the failure mode. Upstream packaging fix is `amah/app-framework#11`, resolved in `@hamak/*` 0.5.5; we are on 0.5.0 and cannot upgrade in this PR without churning lock-files.
**Verification (this cycle):**
1. Stash applied → minimal probe test importing `@hamak/ui-store-impl` fails with the directory-import error.
2. Apply inline list → probe passes, all four new test files run cleanly, all 202 tests pass.
3. Re-confirmed on full-suite run: 28 test files / 202 tests pass, no regression to the 24 baseline files.

**Status:** **verified** (applied to `vite.config.ts` in this cycle; required for the new tests to run; safe — the regex form `[/^@hamak\//]` was tried first and did NOT work, so the explicit list is the form that actually passes Vitest's matcher logic).

## Skipped criteria

- **#14 — `tsc --noEmit`** is a shell check, not a runtime test. Dev-notes cycle-2 confirms 0 errors on touched files; surfaced here as a non-runtime acceptance.
- **#15 — `+3 test files`** — spec says 3, agent prompt prescribes 4 (adding `spec-grep-guards.test.ts` as a sibling per #156's pattern). The added file is purely additive content-guards over the same #13 criterion the spec covers in a single grep block. The four-file split keeps Vitest's bootstrap-heavy suites separate from the fast fs-based guards, matching #156's test layout.
- **#16 — lint** — baseline missing ESLint config (same as #156).
- **#17 — attempts.log** — appended at end of cycle (line: `2026-05-14T20:16:22Z  test-author  done  …`).

## Failures

None. All 28 new tests pass on first author-side run after the `vite.config.ts` inline list fix. No implementation bugs surfaced.

## Build status

```
Test Files  28 passed (28)
Tests       202 passed (202)
Runtime     ~125s (full suite; bootstrap-heavy suites dominate via host setup)
            ~3s   storeFsPlugin.test.ts alone (5 tests)
            ~3s   StereotypeService.test.ts alone (11 tests)
            ~4s   StereotypesPage.bootstrap.test.tsx alone (3 tests)
            ~2s   spec-grep-guards.test.ts alone (9 tests, no host bootstrap)
```

- New test files: 4 (`storeFsPlugin.test.ts`, `spec-grep-guards.test.ts`, `StereotypeService.test.ts`, `StereotypesPage.bootstrap.test.tsx`).
- New tests: 28 (5 + 9 + 11 + 3).
- Baseline test files: 24 (per `git ls-tree` on `main`).
- Baseline tests: 174.
- Grand total: **28 files / 202 tests**, all pass.

## Hygiene notes (forwarded from prompt)

- **Own `Host` instance** used in all unit-level bootstrap suites (storeFsPlugin.test.ts, StereotypeService.test.ts) so the production singleton is not mutated until the dedicated `StereotypesPage.bootstrap.test.tsx`.
- **`provider.supports()` never invoked** — Bug A guarded. All autosave registry assertions are presence-only via `getAll()`.
- **`setFileContent` / `updateFileContent` never dispatched** — Bug B guarded. The PUT_REQUEST guard in `StereotypeService.test.ts#11` is the explicit assertion that no autosave PUT fires across `loadAll → create` flows.
- **Notification plugin not loaded** in `bootstrapServiceWithSpy` — the service receives a `vi.fn()` directly as the notify callback, so we can spy on the calls without bringing the framework notification plugin (or its log-manager dependency) into the host. This matches the #156 pilot's "hygiene through a logging plugin override" pattern in spirit (test-local plugin substitution).
- **Logging-plugin open-handle hygiene** is N/A for this ticket — none of these suites register the framework `logging` plugin (the notification path is mocked via a spy callback).

## Notes for the orchestrator

- **The `vite.config.ts` inline list was modified in this cycle.** This is test-infrastructure config, not implementation code; the change is required to run the new tests against the installed `@hamak/*` 0.5.0 packages. Same root cause as #156 cycle 1, this time verified end-to-end before reporting.
- **No spec ambiguity surfaced.** No `test-escalation.md` file written.
- **No implementation bugs found.** All acceptance criteria pass against the cycle-2 implementation. The cycle-2 `notify` wiring (positional `ctx.commands.run(\`notification.${level}\`, message)`) is exercised by passing a spy callback directly in unit suites; the production-singleton test in `StereotypesPage.bootstrap.test.tsx` boots the full host including the in-house notification plugin (positional `(message: string)` signature) and confirms the page renders end-to-end.
