# Spec review — #156: arch: collapse dual notification systems onto @hamak/notification  (cycle 2)

## Verdict
**approve**

All six cycle-1 required changes are addressed concretely (not hand-wavily). New framework citations on `@hamak/logging` verified end-to-end against both `.d.ts` and `.js`. Welcome-notification suppression mechanism re-verified at `notification-plugin-factory.js:103` and the spec's omission of `maxNotifications` from `APP_NOTIFICATION_CONFIG` is the correct gate. Test bootstrap is runnable: constructor + `registerPlugin` + `bootstrapAllAtRoot` signatures match what the spec uses; the `try/catch` at `notification-plugin-factory.js:40-55` correctly tolerates a missing `STORE_EXTENSIONS_TOKEN` (a `logger.debug` in the catch branch, with `logger` already assigned at line 34). Plugin-load-order section's insertion point is unambiguous (the spec's "between line 141 closing brace and the `// Notification plugin` comment at 143" matches the current file). Risk reassessment to Medium with boot-failure-without-logging as #1 is in place.

A few non-blocking observations below; none rise to rework.

## Required changes (if rework)
None.

## Cycle-1 → cycle-2 traceability

| Cycle-1 required change | Where in cycle-2 spec | Verdict |
|---|---|---|
| **#1** Add `@hamak/logging` plugin sibling, register before notification, list as direct dep | "Files touched" lines 10-12 (`loggingPlugin.ts` new file, `bootstrap.ts` edit), §"Plugin load order" lines 183-198 with belt-and-braces enforcement (registration order + `dependsOn: ['store', 'logging']`), §"Framework APIs used — @hamak/logging" lines 213-218 | Addressed |
| **#2** Acceptance #6 must register logging too (or stub `ILogManager`) | Acceptance #6 lines 245-298 — bootstraps `[loggingPlugin, notificationPlugin]` (option (a)), both tests register logging first with manifest `dependsOn: ['logging']` on notification | Addressed |
| **#3** Acceptance #4 misleading — framework re-registers same names with different shape | §"Framework command surface (canonical)" lines 165-179 documents the seven commands and the `(args: object)` shape; Acceptance #4 narrowed to grep only the plugin file at line 235-241 with a sound rationale | Addressed |
| **#4** Notification Redux slice will auto-register; spec previously claimed it would not | §"Coordinates with #154" lines 328 documents the slice WILL appear via `STORE_EXTENSIONS_TOKEN`, NOT `REDUCER_REGISTRY_TOKEN`. Risks #3 lines 342 confirms. Acceptance #9 pre-audits exhaustive-shape tests | Addressed |
| **#5** Welcome notification fires when `maxNotifications !== undefined` | `APP_NOTIFICATION_CONFIG` lines 51-55 omits `maxNotifications`; explanatory comment lines 42-49 cites the gate at `notification-plugin-factory.js:103-109`; Acceptance #7 verifies suppression manually | Addressed |
| **#6** Add `@hamak/logging` to `frontend/package.json` direct deps | "Files touched" line 12 specifies `^0.5.2` between `@hamak/event-channel` and `@hamak/microkernel-api`; Acceptance #8 verifies | Addressed |

## Suggestions (optional, won't block)

- **Vitest open-handle risk.** `LogManager` (created in the logging plugin's `initialize`) calls `startFlushTimer()` unconditionally because the framework default `flushInterval` is 5000ms (`log-manager.js:60-62`). `Host` has no `deactivate()` API for tests to call after `bootstrapAllAtRoot()`. The two Vitest cases in Acceptance #6 will each leave a 5s-interval timer running until the JS process exits. Vitest 1.3.1 will likely emit an "unfinished operations" warning. Two non-blocking remediations the implementor can pick from at PR time: (a) set `flushInterval: 0` in the test's `APP_LOGGING_CONFIG` override via a test-local factory, or (b) call `host.rootActivationCtx.resolve(LOG_MANAGER_TOKEN).destroy()` in an `afterEach`. The spec doesn't have to predict this; a one-line note in Risks would be nice but not required.

- **`interceptConsole: true` is the framework default and the spec accepts it.** Reading `console-interceptor.js:48-68` together with `console-transport.js:28-50`: the interceptor replaces `console.error`, and ConsoleTransport's ERROR-level path calls `console.error(formatted)`. Combined with `log-manager.js:149-153` (immediate dispatch for level >= ERROR), an `error()` call would, in principle, recurse infinitely (interceptor → logger.error → dispatch → transport → console.error → interceptor → ...). INFO/DEBUG/WARN are buffered so they don't recurse. This is a framework bug, not a spec bug, but the implementor running Acceptance #6 may want to set `interceptConsole: false` in test mode if any test path emits an error. Worth a one-line note in Risks (alongside risk #1).

- **Acceptance #6's second test asserts `getAll()[0].duration === 5000`.** Verified against `notification-service.js:64-72`: the spread order in `fullNotification` is `{ id, timestamp, duration: defaultDuration, ...notification }`. The input from `success('hello')` is `{ type: 'success', title: 'Success', message: 'hello' }` (no `duration` key). So the spread does not overwrite `duration`. Result: `duration === 5000`. ✅ Match.

- **Subscribe listener firing semantics.** Verified against `notification-service.js:182-190` and `notifyListeners()` at 223-233: `subscribe()` adds to the set but does NOT immediately invoke the listener with current state. `success()` → `notify()` → `notifyListeners()` invokes each listener exactly once with `getAll()`. Test's `expect(listener).toHaveBeenCalled()` and the `lastCall = mock.calls[last][0]` pattern is correct. ✅ Match.

- **The cycle-1 reviewer's broader-grep suggestion went unaddressed in the spec.** Cycle-1 suggested also grepping `frontend/src/test/` and `frontend/src/__mocks__/`. The cycle-2 spec lists the original `frontend/src` greps but doesn't widen to test directories. Not blocking — `frontend/src` already includes `frontend/src/test/` because that's part of the source tree (audited: only `setup.ts` lives there and contains no notification references). The spec's "see Acceptance #9" pre-implementation audit grep covers this implicitly. Worth nothing more than a one-liner; not a rework reason.

## Framework citation verification

| Cited path | Verified | Notes |
|---|---|---|
| `@hamak/notification/dist/impl/plugin/notification-plugin-factory.d.ts:25` (`createNotificationPlugin`) | yes | Signature `function createNotificationPlugin(config?: NotificationPluginConfig): PluginModule` confirmed |
| `@hamak/notification/dist/impl/plugin/notification-plugin-factory.js:33` (`ctx.resolve(LOG_MANAGER_TOKEN)` unconditional) | yes | Line 33 exactly; no default-logger fallback |
| `@hamak/notification/dist/impl/plugin/notification-plugin-factory.js:40-55` (`try/catch` around `STORE_EXTENSIONS_TOKEN`) | yes | Catch branch logs via `logger.debug`; if logger is already assigned, no recursion. ✅ |
| `@hamak/notification/dist/impl/plugin/notification-plugin-factory.js:42-50` (auto-register reducer under `state.notifications`) | yes | Exact lines; key `'notifications'` confirmed |
| `@hamak/notification/dist/impl/plugin/notification-plugin-factory.js:57-83` (seven `notification.*` commands with `(args)` shape) | yes | Lines verified; all seven commands match the spec's table |
| `@hamak/notification/dist/impl/plugin/notification-plugin-factory.js:103-109` (welcome gate on `config.maxNotifications !== undefined`) | yes | Exactly `if (config.maxNotifications !== undefined)`. Omitting the key from APP_NOTIFICATION_CONFIG suppresses the welcome. No default applied before this check (the factory reads `config` directly, not `defaultConfig`). ✅ |
| `@hamak/notification/dist/spi/plugin/plugin-config.d.ts:7,11,38` (NotificationPosition, NotificationPluginConfig, enablePersistence) | yes | All three fields present; `'top-right'` is a valid position |
| `@hamak/notification/dist/api/tokens/service-tokens.d.ts:17` (`NOTIFICATION_SERVICE_TOKEN`) | yes | `unique symbol`; re-exported from root and `/api` |
| `@hamak/notification/dist/api/interfaces/notification-service.d.ts:12` (`INotificationService`) | yes | All nine methods present including `subscribe`/`getAll` |
| `@hamak/logging/dist/impl/plugin/logging-plugin-factory.d.ts:36` (`createLoggingPlugin`) | yes | Signature `function createLoggingPlugin(config?: LoggingPluginConfig): PluginModule` confirmed |
| `@hamak/logging/dist/impl/plugin/logging-plugin-factory.d.ts:6` (`LoggingPluginConfig` extends `LogManagerConfig`) | yes | Exact extension confirmed; importable from `@hamak/logging` root via `impl/plugin/index` |
| `@hamak/logging/dist/impl/plugin/logging-plugin-factory.js:64-73` (provides `LOG_MANAGER_TOKEN`, `LOG_CONFIG_TOKEN`, `LOGGER_TOKEN`) | yes | Exact lines |
| `@hamak/logging/dist/impl/plugin/logging-plugin-factory.js:31-36` (DEBUG in dev / INFO in prod default) | yes | Lines verified |
| `@hamak/logging/dist/impl/plugin/logging-plugin-factory.js:39` (`interceptConsole: true` default) | yes | Lines 38-39: `interceptConsole: true` in defaultConfig |
| `@hamak/logging/dist/impl/plugin/logging-plugin-factory.js:90-94` (console interceptor installed in `activate`) | yes | Conditional on `defaultConfig.interceptConsole` |
| `@hamak/logging/dist/api/tokens/service-tokens.d.ts:17` (`LOG_MANAGER_TOKEN`) | yes | `unique symbol` |
| `@hamak/logging/package.json:8-24` (subpath exports `.`, `./api`, `./spi`) | yes | Confirmed |
| `@hamak/logging/package.json:3` (version `0.5.2` matches spec's `^0.5.2`) | yes | Installed transitively at 0.5.2 |
| `@hamak/microkernel-spi/dist/plugin.d.ts:17` (`PluginModule`) | yes | Shape `{ initialize, activate, deactivate? }` |
| `@hamak/microkernel-impl/dist/runtime/host.d.ts:14,22,34` (`Host` ctor, `registerPlugin`, `bootstrapAllAtRoot`) | yes | Exact lines; constructor `(initialProviders?: Provider[], env?: Record<string, any>, config?: HostConfig)` matches test usage `new Host([], undefined, { debug: false })` |
| `@hamak/microkernel-impl/dist/runtime/di.js:63` (`No provider for token: …` throw) | yes | Exact text |
| `@hamak/notification-impl/...` (old citations from cycle 1) | n/a | Spec correctly switched to the new single-package form |

No incorrect citations. Cycle-2 reads runtime `.js` for both factories (notification and logging) end-to-end, which is what cycle-1 had missed for notification.

## Risk reassessment

Spec's Risk #1 is "Boot-failure-without-logging" with belt-and-braces mitigation (registration order + `dependsOn`). I concur.

Additional risks the spec didn't quite cover (each minor, none blocking):

- **Console-interceptor recursion on ERROR.** As above — framework bug, not spec bug. If the implementor hits it during Vitest run, mitigation is `interceptConsole: false` in `APP_LOGGING_CONFIG`. Suggest a one-line addition under existing Risk #4 or a new Risk #6.
- **Vitest open-handle warning from `LogManager.flushTimer`.** As above. Suggest one-line addition to Risks.

Both are remediable in a later edit (or at PR time by the implementor). Neither warrants rework.

Overall risk remains **Medium** — same as spec's reassessment.

## Cross-ticket conflicts

- **#154 (open).** Spec's "Coordinates with #154" note at line 328 is precise: notification reducer auto-registers via `STORE_EXTENSIONS_TOKEN`, not `REDUCER_REGISTRY_TOKEN`. A future #154 agent will know not to "fix" the notification plugin.
- **#163 (open).** Spec's "Coordinates with #163" at line 332 + "Out of scope" item at line 318 correctly defers the command-renaming decision. Per the user's cycle-2 resolution, the framework commands are canonical for now; #163 may rename later.
- **#155 (open).** No conflict.
- No other in-flight `.claude/work/*/spec.md` exists. ✅
- Multi-kind YAML (#106), V/C/R trinity (#85), path semantics (#168): not relevant to this spec.
- Upstream issue placeholder `<filed upstream: TBD>` at spec line 320 is acceptable per the task notes.
