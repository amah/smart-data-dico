# Code review — #156: arch: collapse dual notification systems onto @hamak/notification  (cycle 1)

## Verdict
**approve**

The diff implements the cycle-2 spec verbatim. Every "Public surface" code block in `spec.md` (the two factory wrappers, the bootstrap insertions, the CLAUDE.md replacement, the `package.json` line addition) appears character-for-character in the worktree. The framework imports resolve cleanly against the installed `@hamak/*` 0.5.5 `.d.ts`. The targeted suite is 3/3 green; the full Vitest suite is 184/184; `vite build` is clean. Two non-blocking observations below.

## Required changes (if required-changes)

None.

## Suggestions (optional, won't block)

1. **`vite.config.ts` `test.server.deps.inline: [/^@hamak\//]` is a no-op today** (`frontend/vite.config.ts:37-45`). 0.5.5 ships `.js` extensions on every relative re-export (verified at `@hamak/microkernel-impl/dist/index.js:1-5` — `export * from './runtime/di.js';` etc.), so Node's strict ESM loader accepts the imports without going through Vite's transform pipeline. The block is harmless and arguably useful as a forward-guard against future regressions in framework packaging (which has churned at least once on this exact axis — see `dev-escalation.md` and upstream `amah/app-framework#11`). The orchestrator note says either keep or revert is defensible. Recommendation: keep, but consider re-wording the comment to "guard against regressions in framework `.js`-extension hygiene" rather than the current wording which describes the failure mode the team already observed and fixed upstream. As-is it reads as if it's currently load-bearing.

2. **Doc-comment line citation drift to 0.5.5.** `frontend/src/plugins/notification/notificationPlugin.ts:20-22` cites the welcome-notification gate at `notification-plugin-factory.js` lines 103-109. In the installed 0.5.5 build that gate has moved to line 124 (the `if (config.maxNotifications !== undefined)` block at `frontend/node_modules/@hamak/notification/dist/impl/plugin/notification-plugin-factory.js:124-130`). Behavior is unchanged — `maxNotifications` is omitted and the welcome is suppressed, verified by the test at `notificationPlugin.test.ts:148-157`. Only the line numbers in the explanatory comment are stale. Same drift in `loggingPlugin.ts:18,21,24` (which cite `logging-plugin-factory.js:31-36`, `:39`, `:90-94`). The numbers were accurate against 0.5.2 (the version the spec was authored against). Non-blocking — these are guide comments, not behavior. If the maintainer wants them accurate, a one-pass refresh would help future readers.

3. **0.5.5 added a `registerReducer` config field on `NotificationPluginConfig`.** Verified at `@hamak/notification/dist/spi/plugin/plugin-config.d.ts:44-65` and `@hamak/notification/dist/impl/plugin/notification-plugin-factory.js:56` — when `true` (default) the slice auto-registers via `STORE_EXTENSIONS_TOKEN`; when `false` the side effect is suppressed. The spec was written against 0.5.2, which had no such flag — the slice always registered. Today, `APP_NOTIFICATION_CONFIG` does not set `registerReducer`, so the framework defaults to `true` and behavior matches what the spec describes (slice auto-registers, documented for #154). No change required. Worth knowing for the #154 author: if they want explicit Redux ownership in the host, the cleanest mechanism is now `registerReducer: false` here plus an explicit `host.registerPlugin('store', …)`-level reducer.

## Acceptance-criterion coverage

Spec criteria numbered per `.claude/work/156/spec.md` "Acceptance criteria" (1–13). Cross-checked against the actual diff and `npm test` output, not the dev/test-author summaries.

| Criterion | Implemented | Notes |
|---|---|---|
| 1. `SimpleNotificationService` / `Symbol('NotificationService')` gone from `frontend/src` | yes | `notificationPlugin.ts` reads as a thin delegator (lines 50-52). Guarded by `spec-grep-guards.test.ts:95-105`. |
| 2. No `class .*NotificationService` re-implementation in `frontend/src` | yes | Guarded by `spec-grep-guards.test.ts:107-112`. |
| 3. `notificationPlugin.ts` imports from `@hamak/notification` and re-exports `createNotificationPlugin` | yes | Lines 7 (`createNotificationPlugin as createFrameworkNotificationPlugin`) and 50 (`export function createNotificationPlugin`). Guarded by `spec-grep-guards.test.ts:114-129`. |
| 4. Bespoke `(message: string) => …` `notification.<level>` command registrations gone from the plugin file | yes | Plugin file is now 53 lines with no `ctx.commands.register(...)` call. Guarded by `spec-grep-guards.test.ts:131-143`. The seven framework-canonical commands continue to register inside `node_modules` (the framework's responsibility). |
| 5. `npx tsc --noEmit` exits 0 | partial / pre-existing | 9 pre-existing `scrollIntoView` errors in `AIChatPanel*.test.tsx` on the baseline commit. Verified independent of #156 per `dev-notes.md`. The spec explicitly skipped this in `test-results.md`; cycle-2 spec-reviewer let it stand. Accepting the skip rationale (path a per the orchestrator's framing) — forcing a fix here is out-of-scope creep that the user already declined when approving the spec. |
| 6. Bootstrap a real `Host` with `[logging, notification]` and assert DI surface | yes | `notificationPlugin.test.ts:122-146` resolves `INotificationService` via `NOTIFICATION_SERVICE_TOKEN` and checks all 9 methods. Verified `3/3 pass` locally just now. |
| 7. Welcome notification suppressed | yes | `notificationPlugin.test.ts:148-157` asserts `getAll()` is empty after bootstrap (no welcome) and `:159-188` asserts a subsequent `success('hello')` lands a single notification with `duration === 5000`. Test #2 specifically guards the welcome-suppression mechanism. |
| 8. `@hamak/logging` and `@hamak/notification` are direct deps at `^0.5.x` in `frontend/package.json` | yes | `frontend/package.json:19` adds `"@hamak/logging": "^0.5.2"` between `@hamak/event-channel` and `@hamak/microkernel-api`. Guarded by `spec-grep-guards.test.ts:145-158`. `npm update` since 0.5.5 shipped does not change the manifest; the installed `node_modules/@hamak/logging/package.json:3` is at `0.5.5` (satisfies `^0.5.2`). |
| 9. No exhaustive `RootState`-shape tests exist in the test tree | yes | Guarded by `spec-grep-guards.test.ts:160-172`. Returns no hits. |
| 10. CLAUDE.md in sync with `frontend/package.json` on these two specific packages | yes | `CLAUDE.md:121-122` carry the single-package form. Stale lines 115-118 (other collapsed packages) deliberately untouched per spec "Out of scope". Guarded by `spec-grep-guards.test.ts:174-185`. |
| 11. `npm test` exits 0 | yes | Verified: `Test Files 26 passed (26) / Tests 184 passed (184)`. |
| 12. `npm run lint` exits 0 | partial / pre-existing | No `.eslintrc.*` at `frontend/` on the baseline commit. Per `dev-notes.md` confirmed pre-existing on `4a4d80b`. Same skip rationale as #5. |
| 13. `attempts.log` has the `spec-writer done` line | yes | Verified at `.claude/work/156/attempts.log` line 9 (`2026-05-13T00:32:15Z  spec-writer  done  ticket=156  output=spec.md  notes=cycle 2; …`). |

## Framework verification

Every `@hamak/*` import in the new code opened and verified against the installed `.d.ts` at `frontend/node_modules/@hamak/*/dist/`. All match.

| Import (file:line) | Resolved to | Verified |
|---|---|---|
| `notificationPlugin.ts:7` — `createNotificationPlugin as createFrameworkNotificationPlugin` from `@hamak/notification` | `@hamak/notification/dist/impl/plugin/notification-plugin-factory.d.ts:39` (`function createNotificationPlugin(config?: NotificationPluginConfig): PluginModule`) | yes |
| `notificationPlugin.ts:8` — `PluginModule` from `@hamak/microkernel-spi` | `@hamak/microkernel-spi/dist/plugin.d.ts` (type-only) | yes |
| `notificationPlugin.ts:9` — `NotificationPluginConfig` from `@hamak/notification/spi` | `@hamak/notification/dist/spi/plugin/plugin-config.d.ts:11` (interface with `defaultDuration`, `position`, `enablePersistence`, plus `registerReducer` new in 0.5.5) | yes |
| `loggingPlugin.ts:8` — `createLoggingPlugin as createFrameworkLoggingPlugin` from `@hamak/logging` | `@hamak/logging/dist/impl/plugin/logging-plugin-factory.d.ts:36` (`function createLoggingPlugin(config?: LoggingPluginConfig): PluginModule`); re-exported through `dist/impl/index.d.ts:12` and `dist/index.d.ts:13` | yes |
| `loggingPlugin.ts:9` — `PluginModule` from `@hamak/microkernel-spi` | (same as above) | yes |
| `loggingPlugin.ts:10` — `LoggingPluginConfig` from `@hamak/logging` | `@hamak/logging/dist/impl/plugin/logging-plugin-factory.d.ts:6` (`interface LoggingPluginConfig extends LogManagerConfig`); re-exported through `dist/impl/plugin/index` → `dist/impl/index.d.ts:12` → `dist/index.d.ts:13` | yes |
| `notificationPlugin.test.ts:39` — `Host` from `@hamak/microkernel-impl` | `@hamak/microkernel-impl/dist/runtime/host.d.ts`; root re-export at `dist/index.js:4` (`export * from './runtime/host.js'`) | yes |
| `notificationPlugin.test.ts:40` — `createLoggingPlugin as createFrameworkLoggingPlugin` from `@hamak/logging` | (same as `loggingPlugin.ts:8`) | yes |
| `notificationPlugin.test.ts:41` — `LOG_MANAGER_TOKEN` from `@hamak/logging/api` | `@hamak/logging/dist/api/tokens/service-tokens.d.ts:17` (`export declare const LOG_MANAGER_TOKEN: unique symbol`); re-exported through `dist/api/tokens/index.d.ts:1` → `dist/api/index.d.ts:11` | yes |
| `notificationPlugin.test.ts:42` — `NOTIFICATION_SERVICE_TOKEN` from `@hamak/notification/api` | `@hamak/notification/dist/api/tokens/service-tokens.d.ts:17` | yes |
| `notificationPlugin.test.ts:43` — `INotificationService`, `INotification` from `@hamak/notification/api` | `INotificationService` at `dist/api/interfaces/notification-service.d.ts:12`; `INotification` at `dist/api/types/notification.d.ts:6`; both re-exported through `dist/api/index.d.ts:9-10` | yes |

0.5.2 → 0.5.5 drift surfaced:
- Welcome gate moved from `notification-plugin-factory.js:103-109` (spec citation) to `:124-130` (0.5.5 installed). Behavior identical. Drift only in citation comments. Non-blocking — see Suggestion #2.
- `NotificationPluginConfig` gained an optional `registerReducer` field in 0.5.5 (default `true`). The current code does not set it, so behavior matches the spec's stated assumption that the slice auto-registers. Non-blocking — see Suggestion #3.

## Out-of-scope additions

None inside the production diff for #156. The diff against `arch/baseline-2026-05-13` shows additional changes under `backend/`, `frontend/src/components/AIChatPanel.tsx`, `frontend/src/controllers/`, and `frontend/docs/patterns.md`, but those are pre-existing on the baseline branch (from earlier merged tickets #148, #152, #153 per `git log`) and explicitly excluded from review per the orchestrator's instruction. The `.gitignore` modification (`samples/*/.dico/diagrams/`) is also outside #156's scope, was on the working tree before this ticket, and the orchestrator explicitly noted it should not be attributed to #156. Verified: nothing in the #156 production diff touches code outside the spec's "Files touched" list.

The two test files (`__tests__/notificationPlugin.test.ts`, `__tests__/spec-grep-guards.test.ts`) are within the spec's scope — Acceptance #6 mandates the first, and the second is a legitimate CI-style guard for criteria #1–#4, #8, #9, #10 (a productive addition that the test-author chose; not in the spec's "Files touched" list explicitly, but a content-guard suite is in the spirit of the criteria's "grep returns exit code 1" formulation). Not flagging as out-of-scope.

## Style/cookbook violations

None. The new factories are tiny adapter functions over framework-provided plugin factories; they own no state of their own; they follow the "Services via DI" pattern the cookbook prescribes (consumers `ctx.resolve(NOTIFICATION_SERVICE_TOKEN)` from the framework's own token, not a project-local re-export). Plugin manifest shape matches the existing 11 other registrations in `bootstrap.ts`. No DaisyUI/hex usage (no UI surfaces touched). No `useState(false)` patterns. No bespoke service classes. The "Thin adapter" comment header on both factory files is informative without being verbose.

The cookbook itself does not yet document the "delegate to a framework-provided plugin factory" pattern; the spec acknowledged that gap as a follow-up cookbook update (Risk #2). Not blocking on this review — the pattern in the rewritten files is the correct one and can become the cookbook example post-merge.

## Notes on path (a) vs (b) for criteria #5 and #12

Taking path (a) — accept the skip rationale. Both `tsc --noEmit` and `npm run lint` are pre-existing baseline failures on commit `4a4d80b`, verified by the dev with `git stash` + rerun. The cycle-2 spec-reviewer let this stand silently, the cycle-2 spec explicitly listed them as out-of-scope items the implementor is not expected to remedy, and the user's resolution at spec-approval time was narrow scope. Forcing a fix in this review would be out-of-scope creep that the user already declined. Path (b) would require either fabricating a `.eslintrc.*` (which has design-system implications and is its own multi-file decision) or fixing 9 `scrollIntoView` test-file typing errors that have nothing to do with notifications. Both are legitimate separate tickets, not gates on #156.
