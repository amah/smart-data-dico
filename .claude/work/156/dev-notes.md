# Dev notes — #156

## Cycle 1

### Changes

- `frontend/package.json:19` — added `"@hamak/logging": "^0.5.2"` direct dep (alphabetical between `@hamak/event-channel` and `@hamak/microkernel-api`). Lockfile updated by `npm install`; `@hamak/logging` now appears at `package-lock.json:14` as a top-level dep (in addition to the pre-existing transitive at line 1182).
- `frontend/src/plugins/logging/loggingPlugin.ts:1-38` — **new file**. Thin adapter exporting `createLoggingPlugin()` that delegates to `@hamak/logging`'s `createLoggingPlugin` with an empty `LoggingPluginConfig` (framework defaults accepted: DEBUG in dev/INFO in prod, dev formatter, `interceptConsole: true`).
- `frontend/src/plugins/notification/notificationPlugin.ts:1-51` — **rewritten** from 68 lines to 51 lines. Deleted: `SimpleNotificationService` class, `NOTIFICATION_TOKEN = Symbol('NotificationService')`, the local `Notification` interface, the local `NotificationType` union, all four `(message: string) => …` `ctx.commands.register('notification.<level>', …)` calls. Now: imports `createNotificationPlugin` (aliased to `createFrameworkNotificationPlugin`) from `@hamak/notification`, declares a const `APP_NOTIFICATION_CONFIG: NotificationPluginConfig` (verbatim from the spec — `defaultDuration: 5000`, `position: 'top-right'`, `enablePersistence: false`, `maxNotifications` deliberately omitted with the explanatory comment about the welcome-notification gate at `notification-plugin-factory.js:103-109`), and re-exports `createNotificationPlugin()` as a thin delegator.
- `frontend/src/kernel/bootstrap.ts:20` — added `import { createLoggingPlugin } from '../plugins/logging/loggingPlugin';` directly after the notification plugin import.
- `frontend/src/kernel/bootstrap.ts:144-149` — added new `host.registerPlugin('logging', …)` block immediately before the notification block. No `dependsOn` on the logging plugin (it has no deps).
- `frontend/src/kernel/bootstrap.ts:151-156` — notification plugin's `dependsOn` upgraded from `['store']` to `['store', 'logging']` (belt-and-braces: registration order + explicit `dependsOn`). No other lines in `bootstrap.ts` changed.
- `CLAUDE.md:121-122` — replaced stale `@hamak/notification-api, @hamak/notification-impl — Notification system` with two lines: `@hamak/notification — Notification system (subpath exports: ., /api, /spi)` and `@hamak/logging — Pluggable logging system (subpath exports: ., /api, /spi)`.

### Build status

- frontend: **vite build clean** (1732 modules transformed in 26.45s, exit 0). The `package.json` `build` script is `vite build` (no `tsc -b` prefix despite what CLAUDE.md line 21 implies).
- frontend tsc --noEmit: 9 pre-existing `scrollIntoView` errors in `src/components/__tests__/AIChatPanel*.test.tsx` — confirmed present on the base commit `4a4d80b` (verified by `git stash` + rerun). Not caused by this ticket; not in scope. See "Unrelated issues" below.
- backend: not touched, not built.
- frontend lint: **broken on base commit** — `ESLint couldn't find a configuration file`. Verified pre-existing on `4a4d80b` by `git stash` + rerun. Not caused by this ticket; not in scope. See "Unrelated issues" below.
- backend lint: not touched, not run.

### Spec acceptance grep checks (run end-to-end)

| # | Check | Result |
|---|---|---|
| 1 | `grep -rn 'SimpleNotificationService\|Symbol(.NotificationService.)' frontend/src` | exit 1 (no hits) ✓ |
| 2 | `grep -rn 'class .*NotificationService' frontend/src` | exit 1 (no hits) ✓ |
| 3 | `grep -n "from '@hamak/notification'" frontend/src/plugins/notification/notificationPlugin.ts` and `grep -n "createNotificationPlugin"` | both match, aliased import + re-exported factory ✓ |
| 4 | `grep -n "ctx.commands.register('notification\\." frontend/src/plugins/notification/notificationPlugin.ts` | exit 1 (no hits) ✓ |
| 8 | `node -e "…@hamak/logging…@hamak/notification…"` | both `^0.5.2` ✓ |
| 9 | `grep -rn 'getState()\|toEqual.*state\|Object.keys.*state' frontend/src --include='*.test.ts*'` | exit 1 (no hits — the auto-registered `state.notifications` slice will not break any existing test) ✓ |
| 10 | `grep -E '@hamak/notification-(api\|impl)' CLAUDE.md` | exit 1 (stale entry gone); new lines `@hamak/notification` and `@hamak/logging` present at lines 121-122 ✓ |

### Unrelated issues noticed (not fixed)

- `frontend/src/components/__tests__/AIChatPanel*.test.tsx` (9 files) — `tsc --noEmit` reports `Property 'scrollIntoView' does not exist on type 'never'`. Pre-existing on base commit `4a4d80b`. Unrelated to #156.
- `frontend/` — `npm run lint` fails with "ESLint couldn't find a configuration file". No `.eslintrc.*` file at `frontend/` root. Pre-existing on base commit `4a4d80b`. Unrelated to #156. The build script (`vite build`) compiles fine; only the `lint` script is broken.
- `CLAUDE.md:115-118` — similarly stale `-api`/`-impl` collapsed-package references (`@hamak/ui-store-api/impl`, `@hamak/ui-shell-api/impl`, `@hamak/ui-remote-fs-api/impl`). Per spec "Out of scope", these are deliberately left for a follow-up ticket — flagged here so a future reader of the new line 121 doesn't wonder why the surroundings weren't fixed.

### Notes for test-author (forwarded from spec-reviewer cycle-2 non-blocking suggestions)

The reviewer flagged two test-hygiene risks that aren't dev concerns but the test-author should be aware of when writing `frontend/src/plugins/notification/__tests__/notificationPlugin.test.ts` (Acceptance #6):

1. **Vitest open-handle warning from `LogManager.flushTimer`.** The framework's `LogManager` constructor calls `startFlushTimer()` unconditionally with a 5000ms interval (`@hamak/logging/dist/impl/core/log-manager.js:60-62`). `Host` has no `deactivate()` API. Each test that calls `bootstrapAllAtRoot()` leaves an interval timer alive until process exit; Vitest 1.3.1 may emit "unfinished operations" warnings. Two remediations test-author can pick: (a) `vi.useFakeTimers()` in `beforeEach`/`afterEach`, or (b) resolve `LOG_MANAGER_TOKEN` after bootstrap and call `.destroy()` (or `clearInterval` on the internal `flushTimer`) in `afterEach`. The spec doesn't mandate either; pick the one that keeps the test readable.

2. **`interceptConsole: true` × `ConsoleTransport` ERROR-path recursion risk.** Framework default `interceptConsole: true` replaces `console.error`. `ConsoleTransport`'s ERROR-level path calls `console.error(formatted)`. Combined with `log-manager.js:149-153`'s immediate-dispatch for ERROR, a `logger.error(...)` call could in theory recurse infinitely (interceptor → logger.error → dispatch → transport → console.error → interceptor → …). INFO/DEBUG/WARN are buffered so they don't recurse. The two Acceptance #6 tests don't deliberately emit errors, but if any incidental error path fires during test bootstrap, test-author may want to override `interceptConsole: false` via a test-local logging factory. The production wrapper (`loggingPlugin.ts`) passes `{}` and accepts the framework default — only the test override needs it.

### Anything the spec didn't cover that I had to decide

None. The spec's "Public surface" code blocks were copy-pasted verbatim (including the `maxNotifications`-omitted comment that explains the welcome-notification suppression). All file paths, line insertions, and `dependsOn` arrays match the spec exactly. The `npm install` ran clean (no peer-dep warnings related to `@hamak/logging`; the package was already at `^0.5.2` as a transitive of `@hamak/notification` — promotion to a direct dep added one line to `package.json` and one top-level entry in `package-lock.json`).

---

## Cycle 2

### Changes

- `frontend/vite.config.ts:37-45` — added `server: { deps: { inline: [/^@hamak\//] } }` inside the `test:` block, placed between `css: true,` and `coverage: { … }`. The exact wording prescribed by `test-results.md` "Likely cause" and re-confirmed in `next-step.md` "Decision". 2-space indent, trailing commas, an explanatory comment naming the `ERR_MODULE_NOT_FOUND` failure mode. No other lines in `vite.config.ts` were touched.

No source files under `frontend/src/` were modified. No test files were modified. The cycle-1 worktree is intact (verified via `git status` before editing; all 4 modified files and 2 untracked directories from cycle 1 still present).

### Verification results

#### 1. Targeted bootstrap suite

```
$ cd frontend && npx vitest run src/plugins/notification/__tests__/notificationPlugin.test.ts
```

Exit code: 0 (Vitest does not propagate failing-suite status as non-zero exit when it logs the failure; tracked separately by the test report). **Snippet:**

```
FAIL  src/plugins/notification/__tests__/notificationPlugin.test.ts  (0 test)
Error: Cannot find module
  '/Users/amah/Devs/projects/smart-data-dico/frontend/node_modules/@hamak/microkernel-impl/dist/runtime/di'
  imported from '/Users/amah/Devs/projects/smart-data-dico/frontend/node_modules/@hamak/microkernel-impl/dist/index.js'
Serialized Error: { code: 'ERR_MODULE_NOT_FOUND', url: '…/dist/runtime/di' }

Test Files  1 failed (1)
Tests       no tests
Duration    5.38s
```

Status: **FAIL — same `ERR_MODULE_NOT_FOUND` as cycle 1**, despite the spec-prescribed `server.deps.inline: [/^@hamak\//]` being in place. The Vitest 1.6.1 transform pipeline is not picking up `@hamak/microkernel-impl/dist/index.js`'s extensionless internal imports via this config setting alone.

#### 2. Full suite

Not run after step 1's failure. The bootstrap suite is the only one affected by this config change; the other 25 test files would behave exactly as in cycle 1 (181/181 pass). Re-running the full suite would still leave the 26th file failing with the same error and the totals at 181/184, identical to cycle 1.

#### 3. `npm run build`

Not re-run — `vite.config.ts`'s `test:` block is not consumed by `vite build`. Cycle-1 status holds: 1732 modules transformed clean in 26.45s, exit 0.

### Diagnostic probe

To isolate whether the failure was specific to the test file or to **any** import of `@hamak/microkernel-impl` under Vitest with the new inline config, I created a minimal probe at the frontend root:

```ts
// frontend/probe-vitest-156.test.ts (deleted after the experiment)
import { describe, it, expect } from 'vitest';
describe('probe', () => {
  it('can import @hamak/microkernel-impl', async () => {
    const mod = await import('@hamak/microkernel-impl');
    expect(typeof mod.Host).toBe('function');
  });
});
```

`npx vitest run probe-vitest-156.test.ts` produced the **identical** `ERR_MODULE_NOT_FOUND` on the bare dynamic `import('@hamak/microkernel-impl')`. This confirms the failure is independent of the test file under `src/plugins/notification/__tests__/` and is a config-only issue: `server.deps.inline` alone does not transform this framework package. The probe file was deleted before this notes file was written; it was not placed under `src/`.

### Status

**Escalated.** See `.claude/work/156/dev-escalation.md`.

The hard-rule reminder in the cycle-2 directive is explicit: "If the one-line fix doesn't make the tests pass (e.g., a different framework packaging issue surfaces), DO NOT improvise additional vite-config plumbing or modify any framework-side workaround beyond what's specified. Write `.claude/work/156/dev-escalation.md` and stop."

I followed that path: the spec-prescribed edit is in place (left in the worktree so the reviewer can see exactly what was tried), the failure mode is documented with a reproducible probe, and the escalation file lists four candidate next steps for spec-writer/orchestrator to choose from (Vitest version pin, `deps.optimizer.web.include`, resolver shim, or scope reduction).

### Build status

- frontend: vite build — not re-run; cycle-1 status holds (clean).
- frontend tsc --noEmit: 9 pre-existing `scrollIntoView` errors — not in scope, not run.
- backend: not touched.
- frontend lint: pre-existing baseline failure — not in scope, not run.
- frontend tests targeted at notificationPlugin: **FAIL (0/3 pass)** — same `ERR_MODULE_NOT_FOUND` as cycle 1.

### Unrelated issues noticed (not fixed)

No new ones — same as cycle 1.

### Anything the spec didn't cover that I had to decide

The diagnostic probe is the only thing the spec/test-author guidance didn't anticipate. I created and deleted a single test file (`frontend/probe-vitest-156.test.ts`) at the frontend root — not under `src/` — to confirm the failure is config-level, not test-file-level. Result: it's config-level. The probe file is gone; no test or source file is left modified.
