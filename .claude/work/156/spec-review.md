# Spec review — #156: arch: collapse dual notification systems onto @hamak/notification  (cycle 1)

## Verdict
**rework**

The spec's overall direction is right and most framework citations are accurate, but it contains three concrete factual errors about what the framework factory does on `initialize`/`activate`. As written, the rewrite will (a) break app bootstrap in production, (b) make Acceptance #6 unrunnable, and (c) make Acceptance #4 grep-pass while quietly leaving the same command names registered by the framework with a different argument shape. Each is fixable but not by an implementor reading the spec alone — the spec needs to acknowledge them up front and decide a path.

## Required changes (if rework)

1. **The notification plugin requires `@hamak/logging` to be registered as a separate plugin in `bootstrap.ts`.** The factory at `frontend/node_modules/@hamak/notification/dist/impl/plugin/notification-plugin-factory.js` line 30 calls `ctx.resolve(LOG_MANAGER_TOKEN)` unconditionally inside `initialize`. There is no default-logger fallback. `frontend/src/kernel/bootstrap.ts` does NOT currently register a logging plugin (grep over `frontend/src` for `logging|LOG_MANAGER|createLoggingPlugin` returns zero hits). `@hamak/microkernel-impl/dist/runtime/di.js:63` throws `No provider for token: ...` on a missing token. Therefore the rewrite as specified will throw at app boot the moment `host.bootstrapAllAtRoot()` runs. The spec must either:
   - Add `frontend/src/plugins/logging/loggingPlugin.ts` (or similar) that calls `createLoggingPlugin()` from `@hamak/logging`, register it in `bootstrap.ts` BEFORE the notification plugin, and list `@hamak/logging` as a direct dependency in `frontend/package.json` (it is currently only a transitive); OR
   - Document the implementor must do all of the above as part of this ticket; OR
   - Escalate the question to the human (e.g., "should logging be its own ticket sequenced before #156?").
   Risk #2 in the spec ("if logger resolution fails it fails there, catching the issue at PR time") is not a mitigation — it's a description of the failure mode. The required action is to fix it now, not catch it in CI.

2. **Acceptance #6 cannot bootstrap a Host "with only the rewritten plugin registered".** Same reason as #1: the notification plugin's `initialize` will throw because `LOG_MANAGER_TOKEN` is unresolved. The test must also register a logging plugin (real or stub). Rewrite Acceptance #6 to either (a) bootstrap a Host with `[loggingPlugin, notificationPlugin]`, or (b) provide a hand-rolled stub `ILogManager` via `host = new Host([{ provide: LOG_MANAGER_TOKEN, useValue: stubLogManager }])`. Spec needs to pick one and write it down.

3. **Acceptance #4 ("No dead command shims left behind") is misleading.** The framework's `createNotificationPlugin` already registers `notification.show`, `notification.info`, `notification.success`, `notification.warning`, `notification.error`, `notification.dismiss`, `notification.dismissAll` itself (see `notification-plugin-factory.js` lines ~55-90). Dropping the four registrations from `notificationPlugin.ts` does NOT remove these command names — it only changes who registers them and, importantly, **changes their call signature** from `(message: string)` to `(args: { message, title?, ...options })`. Spec must either:
   - Acknowledge the framework still registers them, drop the "dropped, not re-shimmed" language, and update Risk #4 to flag the argument-shape change (not the removal) as the actual public-API break; OR
   - If a string-argument shim is desired for backwards compatibility, re-add wrapper command registrations under different names per #163's `<plugin>.<noun>.<verb>` convention (e.g. `notification.toast.success`).
   The current spec text contradicts itself: §"Public surface" says the commands are "dropped, not re-shimmed", §"Coordinates with #163" says #163 "decides whether/which notification operations get a commands.execute surface", but the framework has already decided. #163's body explicitly says "Coordinates with #156 (notification commands collapse onto framework notification API)" — i.e., #163 EXPECTS the framework's commands to be the canonical surface. The spec misreads the relationship.

4. **The framework factory auto-registers the `notificationReducer` under `state.notifications`.** Lines ~40-50 of `notification-plugin-factory.js` resolve `Symbol.for('@hamak/ui-store:StoreExtensionsRegistry')`, and on success register `{ reducers: { notifications: notificationReducer } }`. The app's store plugin DOES provide this token (verified in `@hamak/ui-store-impl/dist/plugin/store-plugin-factory.js:91`), so this branch will succeed and a `notifications` slice WILL appear in the Redux state tree. Spec's Dependencies section says: "This spec does **not** wire that reducer — notifications are session-ephemeral and don't need to live in the Redux tree." That claim is false. The spec must either:
   - Acknowledge the slice will be added, decide whether that's acceptable, and update the #154 coordination note (and possibly the welcome-notification side effect — see #5); OR
   - Propose a configuration to opt out (none exists in `NotificationPluginConfig`; would require not having ui-store registered first, which is not an option), or hand-write a plugin wrapper that calls the framework factory but does not provide a `StoreExtensionsRegistry`-resolving context. The latter is significant scope.

5. **The factory emits a welcome notification on activate.** `notification-plugin-factory.js` ~line 100: `if (config.maxNotifications !== undefined) { service.info('Notification system ready', 'System', { duration: 3000, ... }); }`. Spec sets `maxNotifications: 50`, so this fires on every app boot. Two consequences:
   - Acceptance #6's listener assertion ("the call's argument is an array of one notification whose `type === 'success'` and `message === 'hello'`") is wrong: the listener receives an array of TWO notifications because the welcome notification is already in the list. After `svc.success('hello')`, `getAll()` returns `[success-hello, welcome-info]` (most-recent-first). The assertion needs to be rewritten to `expect.arrayContaining([objectContaining({ type: 'success', message: 'hello' })])` or similar.
   - Acceptance #7's `svc.getAll()[0].duration === 5000` is OK (success is at index 0), but the same point: there are 2 items, not 1, after one `success()` call. Tests must not assume length-1.
   - Independently, the welcome notification will surface to end users once the toast renderer follow-up ticket lands. Spec should either omit `maxNotifications` from `APP_NOTIFICATION_CONFIG` (leaving it `undefined` suppresses the welcome) or document the welcome as expected behavior. Setting `maxNotifications: 50` is also the default, so leaving it `undefined` loses nothing.

6. **`@hamak/logging` should become a declared dependency in `frontend/package.json`.** Spec Acceptance #9 says "No new external dependencies. `git diff frontend/package.json` shows no changes." If #1 above is followed (registering a logging plugin), `frontend/package.json` MUST add `@hamak/logging` as a direct dep — it is currently only transitive (`frontend/package-lock.json:1143`), and importing from a package whose direct-dep status depends on another package's pinning is brittle (npm prune or future hoisting changes could break the build). Either Acceptance #9 must drop, or the spec must say "Acceptance #9 adjusted: `frontend/package.json` adds `@hamak/logging` as a direct dependency; no other changes."

## Suggestions (optional, won't block)

- Lines 115-118 of CLAUDE.md (`@hamak/ui-store-api/@hamak/ui-store-impl`, `@hamak/ui-shell-api/@hamak/ui-shell-impl`, `@hamak/ui-remote-fs-api/@hamak/ui-remote-fs-impl`) appear to suffer the same single-package-collapse drift as line 121 (`frontend/package.json` lists `@hamak/ui-store`, `@hamak/ui-shell`, `@hamak/ui-remote-fs` as singles, no `-api`/`-impl` split). Spec is right to scope its edit narrowly to line 121, but the same fixup should ride along here or in a follow-up — flagging because a reader of the new line 121 will reasonably wonder why the surrounding entries weren't fixed. Either fix them all (one-line each), or file a follow-up.
- The risks section calls this "dead-weight thesis" based on grepping `frontend/src` for token usage. Worth also grepping `frontend/src/test/` and `frontend/src/__mocks__/` (none today) so future readers see the audit was thorough.
- Acceptance #7's "Auto-dismiss timing itself is not asserted (timers introduce flakiness)" is the right call. Worth noting `error()` overrides `duration: 0` by default — a future test that asserts an error notification's `duration` will need different expectations. Document in the spec rather than discover at test-write time.
- Spec §"Out of scope" mentions `plans/migration-to-app-framework.md` still has stale `-impl` references. Acceptance #8's grep is `CLAUDE.md` only. Consider grepping the whole repo so the drift question is closed.

## Framework citation verification

| Cited path | Verified | Notes |
|---|---|---|
| `impl/plugin/notification-plugin-factory.d.ts:25` (`createNotificationPlugin`) | yes | Exact signature: `function createNotificationPlugin(config?: NotificationPluginConfig): PluginModule`. Re-exported through `impl/index.d.ts` and root `index.d.ts`. |
| `api/tokens/service-tokens.d.ts:17` (`NOTIFICATION_SERVICE_TOKEN`) | yes | `export declare const NOTIFICATION_SERVICE_TOKEN: unique symbol`. Re-exported by `api/index.d.ts` and root. |
| `api/interfaces/notification-service.d.ts:12` (`INotificationService`) | yes | All 9 methods spec claims are present: `notify`, `info`, `success`, `warning`, `error`, `dismiss`, `dismissAll`, `getAll`, `subscribe`. `subscribe`'s contract at line 148 verified. |
| `spi/plugin/plugin-config.d.ts:7,11,38` (`NotificationPosition`, `NotificationPluginConfig`, `enablePersistence`) | yes | `'top-right'` is a valid `NotificationPosition` (one of six). All four config fields the spec uses are present with the claimed defaults. |
| `impl/core/notification-service.d.ts:13` (constructor takes `ILogger`) | yes | Confirmed; logger is resolved via `LOG_MANAGER_TOKEN` inside the factory's `initialize` — **see Required Change #1**: no default logger fallback exists. |
| `api/types/notification.d.ts:6` (`INotification` fields) | yes | All eight fields the spec claims (`id`, `type`, `title`, `message`, `timestamp`, `duration?`, `source?`, `metadata?`) match. |
| `@hamak/microkernel-spi/dist/plugin.d.ts:17` (`PluginModule`) | yes | Exact shape: `{ initialize(ctx): void | Promise<void>; activate(ctx): void | Promise<void>; deactivate?: () => void | Promise<void> }`. |
| `@hamak/notification` package subpath exports `.`, `./api`, `./spi` | yes | `package.json:8-24` confirms; `typesVersions` at 25-34 supplies types for the subpaths. |
| `@hamak/microkernel-impl` `Host`, `bootstrapAllAtRoot`, `rootActivationCtx` | yes | `runtime/host.d.ts` lines 8, 34, 13. Constructor accepts `initialProviders?: Provider[]`. |

No outright wrong citations. The errors are not in what the spec cites but in what it omitted reading — specifically the runtime side effects in `notification-plugin-factory.js` (welcome notification, reducer auto-registration, mandatory logger resolution).

## Risk reassessment

The spec rates this Low/Medium and the ticket body rates it Low. With the framework-side surface fully read, my view is **Medium**:

- App-boot failure if logging plugin isn't added (Required Change #1) — that's a P0 regression risk, not a "monitor and adjust".
- Welcome-notification side effect is benign today (no renderer) but becomes visible the moment the toast-host follow-up lands. It's not a bug today but is a hidden contract a future implementor will hit.
- The Redux `notifications` slice will silently appear in `state` and widen `RootState`. If any current test asserts the shape of `state` exhaustively, this could break it (audit: I did not find such a test, but the spec hasn't either). Worth grepping `Object.keys(getState())` and exhaustive `toEqual` over state in `frontend/src/**/__tests__/`.
- Notification command argument shape changes from `(message: string)` to `(args: object)`. Audit confirms zero current call sites, so impact is zero today. Future code will read the framework signature and use it correctly. No real risk if Required Change #3 reframes the spec text.

## Cross-ticket conflicts

- **#163** (open). Issue body explicitly says: "Coordinates with #156 (notification commands collapse onto framework notification API)". The spec interprets this as "delete the commands and let #163 decide whether to bring them back". Reading #163 more carefully, it actually means "#156 ships the framework commands, #163 then aligns the rest of the codebase to a `<plugin>.<noun>.<verb>` convention and may or may not rename `notification.*` to `notification.toast.*`". The spec's "hands #163 a clean slate" framing is more aggressive than #163 expects. Not a blocker but a misalignment worth softening in the spec.
- **#154** (open, slices into plugins). Spec claims the notification reducer is not wired. False (Required Change #4). The notification reducer WILL appear under `state.notifications`. #154's `bootstrap.ts` rewrite that "Each plugin's `initialize` registers exactly its own reducers" needs to know that the notification plugin already self-registers via the framework's `STORE_EXTENSIONS_TOKEN` path, NOT via `REDUCER_REGISTRY_TOKEN`. The spec should call this out in the #154 coordination note so #154's implementor doesn't try to "fix" the notification plugin to use `REDUCER_REGISTRY_TOKEN`.
- **#155** (open, DI tokens). No conflict. Spec's reading is accurate.
- **#170 (merged)** — the recent scaffolding commit. I didn't read it fully but it's a precursor that doesn't appear to touch notifications.
- No other in-flight `.claude/work/*/spec.md` exists (only #156 is open under that path), so no spec-vs-spec collision.
- Multi-kind YAML (#106) and validation/constraint/rule trinity (#85): not relevant to this spec.
- Path semantics (#168): not relevant.
