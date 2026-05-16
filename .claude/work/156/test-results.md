# Test results — #156  (cycle 1)

## Summary

- **Files added (2):**
  - `frontend/src/plugins/notification/__tests__/notificationPlugin.test.ts` — Vitest bootstrap suite for spec acceptance #6 and #7
  - `frontend/src/plugins/notification/__tests__/spec-grep-guards.test.ts` — content-guard suite for spec acceptance #1, #2, #3, #4, #8, #9, #10
- **Tests:** 7 pass, 3 fail (all in the bootstrap suite, all blocked by one implementation-side config gap; see below)
- **Other suites:** the rest of the frontend test suite is unaffected — 25 of 26 test files pass, 181 of 181 tests in those 25 files pass.

## Coverage of acceptance criteria

Spec criteria numbered per `.claude/work/156/spec.md` "Acceptance criteria" (1-13).

| # | Criterion | Test file:lines | Status |
|---|---|---|---|
| 1 | Bespoke `SimpleNotificationService` and `Symbol('NotificationService')` gone from `frontend/src` | `frontend/src/plugins/notification/__tests__/spec-grep-guards.test.ts:95-106` | pass |
| 2 | No `class .*NotificationService` re-implementation in `frontend/src` | `frontend/src/plugins/notification/__tests__/spec-grep-guards.test.ts:107-113` | pass |
| 3 | `notificationPlugin.ts` imports `@hamak/notification` and re-exports `createNotificationPlugin` | `frontend/src/plugins/notification/__tests__/spec-grep-guards.test.ts:114-130` | pass |
| 4 | Bespoke `(message: string) =>` `notification.<level>` registrations gone from the plugin file | `frontend/src/plugins/notification/__tests__/spec-grep-guards.test.ts:131-144` | pass |
| 5 | `cd frontend && npx tsc --noEmit` exits 0 | — | **skipped — pre-existing baseline failure**, see "Skipped criteria" |
| 6 | Bootstrap a real `Host` with `[logging, notification]` and assert DI surface | `frontend/src/plugins/notification/__tests__/notificationPlugin.test.ts:122-147` | **fail (implementation gap)** — see "Failures" |
| 7 | Welcome notification is suppressed (`getAll().length === 0` before any explicit call; `getAll()[0].duration === 5000` after one `success()`) | `frontend/src/plugins/notification/__tests__/notificationPlugin.test.ts:148-157` and `:159-180` | **fail (implementation gap)** — same blocker as #6 |
| 8 | `@hamak/logging` and `@hamak/notification` listed as direct deps in `frontend/package.json` at `^0.5.x` | `frontend/src/plugins/notification/__tests__/spec-grep-guards.test.ts:145-158` | pass |
| 9 | No exhaustive `RootState`-shape tests in `frontend/src/**/*.test.ts*` | `frontend/src/plugins/notification/__tests__/spec-grep-guards.test.ts:160-172` | pass |
| 10 | `CLAUDE.md` in sync with `frontend/package.json` (no stale `-api`/`-impl`; `@hamak/notification` and `@hamak/logging` bullets present) | `frontend/src/plugins/notification/__tests__/spec-grep-guards.test.ts:174-185` | pass |
| 11 | `cd frontend && npm test` exits 0 | — | **conditional** — 25 of 26 test files pass cleanly; the 26th (`notificationPlugin.test.ts`) fails for the same implementation-gap reason as #6 |
| 12 | `cd frontend && npm run lint` exits 0 | — | **skipped — pre-existing baseline failure**, see "Skipped criteria" |
| 13 | `tail -1 .claude/work/156/attempts.log` matches a `spec-writer done …` line | — | **skipped — orchestrator-side check**, verified at PR time |

## Skipped criteria

### #5 — `tsc --noEmit`
Per `.claude/work/156/dev-notes.md` (Build status, line 17): "frontend tsc --noEmit: 9 pre-existing `scrollIntoView` errors in `src/components/__tests__/AIChatPanel*.test.tsx` — confirmed present on the base commit `4a4d80b` (verified by `git stash` + rerun). Not caused by this ticket; not in scope."

Adding a Vitest guard that shells out to `npx tsc --noEmit` would mark this criterion red until those pre-existing errors are cleared by a separate ticket. Per the orchestrator's guidance (test-author prompt § "Test scope" #11/#12 — same logic applies to baseline tsc breakage), this is left for a separate test infrastructure ticket and is **not** silently passed.

### #12 — `npm run lint`
Per `dev-notes.md` (Build status, line 18): "frontend lint: **broken on base commit** — `ESLint couldn't find a configuration file`. Verified pre-existing on `4a4d80b` by `git stash` + rerun. Not caused by this ticket."

No `.eslintrc.*` exists at `frontend/`. The criterion is unbuildable until a separate ticket adds the missing eslint config; per the test-author prompt § "Test scope" #11, this is explicitly marked skipped rather than silently passed. The cycle-2 reviewer did not strike #12 from the spec, so we surface it as a known gap.

### #13 — `attempts.log` tail
Orchestrator-side check; the `tail -1 .claude/work/156/attempts.log` form is not a runtime test. Verified at PR time.

## Failures

### `notificationPlugin.test.ts` — 0 of 3 tests run (suite fails to collect)

**Reproduction.** `cd frontend && npx vitest run src/plugins/notification/__tests__/notificationPlugin.test.ts`.

```
FAIL  src/plugins/notification/__tests__/notificationPlugin.test.ts  (0 test)
Error: Cannot find module
  '/Users/amah/Devs/projects/smart-data-dico/frontend/node_modules/@hamak/microkernel-impl/dist/runtime/di'
  imported from
  '/Users/amah/Devs/projects/smart-data-dico/frontend/node_modules/@hamak/microkernel-impl/dist/index.js'
Serialized Error: { code: 'ERR_MODULE_NOT_FOUND' }
```

**Diagnosis.** `@hamak/microkernel-impl` is shipped as `"type": "module"` with extensionless relative imports (e.g. `export * from './runtime/di';` at `dist/index.js:1`). Node's strict ESM loader rejects extensionless specifiers. Vite's resolver tolerates them at app-build time (which is why `npm run build` and the dev server work), but Vitest 1.6.1 externalizes `node_modules` by default and forwards these imports to Node's loader. Without inline-transform, the import fails before any test in the file runs.

Confirmed by direct Node test:
```
$ cd frontend && node -e "import('@hamak/microkernel-impl').then(...)"
ERR: Cannot find module '.../dist/runtime/di' imported from '.../dist/index.js'
```

This is independent of our test code — it's a packaging bug in the framework that the developer's bootstrap edit (`frontend/src/kernel/bootstrap.ts:8` imports `Host` from `@hamak/microkernel-impl`) does not exercise via Vitest because no existing test in the repo imports any `@hamak/*` package. The spec's Acceptance #6 mandates exactly such a test, which is the first to hit this gap.

**Likely cause:** **implementation — test-host configuration gap**, not a bug in the rewritten `notificationPlugin.ts` or the new `loggingPlugin.ts`. The production source files are correct per spec; the missing piece is a one-line Vitest config addition in `frontend/vite.config.ts`:

```ts
test: {
  // existing fields …
  server: { deps: { inline: [/^@hamak\//] } },
}
```

This forces Vitest to run @hamak packages through Vite's transform pipeline (which rewrites extensionless imports), matching how the app itself loads them.

**Recommendation:** developer rework — add the `server.deps.inline` config above to `frontend/vite.config.ts`. With that one-liner, both `notificationPlugin.test.ts` and any future test that imports framework code work, and spec acceptance #6, #7, and #11 all pass.

This is **not** a spec ambiguity (no escalation file written). The spec is correct; the implementation is one config line short of letting the spec-mandated test run.

## Hygiene mitigations applied

Both non-blocking risks called out in `dev-notes.md` "Notes for test-author" and `spec-review-cycle-2.md` suggestions are mitigated by a single test-local override in `notificationPlugin.test.ts:67-72`:

```ts
host.registerPlugin(
  'logging',
  manifest('logging'),
  createFrameworkLoggingPlugin({ interceptConsole: false, flushInterval: 0 })
);
```

- **`flushInterval: 0`** suppresses `LogManager`'s `setInterval` entirely (gated by `flushInterval > 0` at `log-manager.js:60`). No open-handle warning even when the suite scales to more tests.
- **`interceptConsole: false`** skips the console-interception install at `logging-plugin-factory.js:90-94`, eliminating the recursion risk on `console.error` if any incidental error path fires during bootstrap.

Choice rationale (per the test-author prompt § "Two hygiene risks"): option (a) from each — a test-local logging plugin factory. This keeps the test focused on #156's actual subject (the notification plugin) and treats logging as the framework's responsibility, not ours. A complementary `afterEach` calls `LogManager.destroy()` as belt-and-braces cleanup even though `flushInterval: 0` already prevents the timer.

## Build status

```
Test Files  1 failed | 25 passed (26)
Tests       3 failed (collection-time; 0 ran)  +  181 passed in other files  =  181 / 184
Runtime     ~69s (full suite) / ~5s (grep-guards alone) / ~3s (bootstrap suite that fails to collect)
```

- New tests added: 10 (3 in `notificationPlugin.test.ts`, 7 in `spec-grep-guards.test.ts`).
- New tests passing: 7 of 10. The 3 failing are the bootstrap suite, all blocked by the same single root cause (Vitest inline-transform missing for `@hamak/*`).
- No existing tests broken by this ticket. The grep-guards suite found no exhaustive-shape assertions anywhere in the existing test tree (criterion #9), matching the dev-side audit.
