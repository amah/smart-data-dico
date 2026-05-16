# Spec — #159: arch: make plugin `dependsOn` declarations load-bearing

## Goal

Per the ticket body: "Each `dependsOn` reflects an actual DI dependency the plugin resolves at `initialize` or `activate` time. No false declarations, no missing ones." The audit is now meaningful because the #154 / #155 catalog is substantially landed (post-`6aecd3e` — three Pattern B services merged; stereotype + integrity prior to that; AI in #162; cases/rules in #161; metadata registry in #164). The framework's `topologicalSort` enforces ordering but does *not* enforce that declared deps are actually used or that resolved tokens come from a declared provider (verified at `frontend/node_modules/@hamak/microkernel-impl/dist/runtime/graph-utils.js:10-35` — missing dep names just `console.warn`; `frontend/node_modules/@hamak/microkernel-impl/dist/runtime/di.js:26-64` — `container.resolve` throws on missing provider but doesn't check `dependsOn`). The audit is thus pure hygiene + the smoke test prevents regressions.

The audit (table in "Acceptance criteria" §1 below) finds **zero missing declarations** and **six bogus declarations** spread across five plugins: `shell['store']`, `auth['store']`, `data-dictionary['auth']`, `git['remote-fs']`, `notification['store']` (loosely used via a different symbol — see Risk 2), and `ai-assistance['store','auth','data-dictionary']`. The fix is mechanical edits to `frontend/src/kernel/bootstrap.ts` plus one new smoke test file plus a short convention comment.

## Files touched

- `frontend/src/kernel/bootstrap.ts` — adjust `dependsOn` arrays per the audit table; add a ~12-line convention comment block above `registerPlugins()` documenting what `dependsOn` means in this app.
- `frontend/src/__tests__/plugin-dependency-graph.test.ts` — new smoke test (file does not exist today). Boots the full plugin set via `bootstrapApplication()` and asserts (a) every declared `dependsOn` name resolves to a registered plugin manifest, (b) for every plugin that resolves a token in production source, that token resolves to a non-null value through `host.rootActivationCtx.resolve`.
- `.claude/work/159/spec.md` — this spec (already exists at this path).
- `.claude/work/159/attempts.log` — cycle log (already exists).

No source-file edits in plugin factories themselves — the audit confirms each plugin's `initialize` / `activate` already resolves exactly what it needs; the discrepancies are only in the `bootstrap.ts` manifest entries.

## Public surface (signatures)

No public TypeScript surface changes. The only signature touched is the `PluginManifest.dependsOn?: string[]` payloads, which are inline object literals in `bootstrap.ts`. The smoke test file is internal:

```ts
// frontend/src/__tests__/plugin-dependency-graph.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { bootstrapApplication, host } from '../kernel/bootstrap';
import {
  STORE_FS_TOKEN,
  STEREOTYPE_SERVICE_TOKEN,
  INTEGRITY_SERVICE_TOKEN,
  DIFF_SERVICE_TOKEN,
  IMPORT_EXPORT_SERVICE_TOKEN,
  METADATA_TYPE_REGISTRY_TOKEN,
  GIT_SERVICE_TOKEN,
  PUBLISH_SERVICE_TOKEN,
  CASE_SERVICE_TOKEN,
  RULE_SERVICE_TOKEN,
  SEARCH_SERVICE_TOKEN,
  AI_SERVICE_TOKEN,
  AUTH_SERVICE_TOKEN,
} from '../kernel/tokens';
import { STORE_MANAGER_TOKEN, REDUCER_REGISTRY_TOKEN, STORE_EXTENSIONS_TOKEN } from '@hamak/ui-store-api';
import { PATH_TRANSLATOR_TOKEN, WORKSPACE_CLIENT_TOKEN } from '@hamak/ui-remote-fs';
import { GIT_CLIENT_TOKEN, GIT_PATH_TRANSLATOR_TOKEN } from '@hamak/ui-remote-git-fs';
import { SHELL_TOKEN, THEME_MANAGER_TOKEN, FEATURE_MANAGER_TOKEN, LAYOUT_MANAGER_TOKEN } from '@hamak/ui-shell';
import { LOG_MANAGER_TOKEN, LOG_CONFIG_TOKEN, LOGGER_TOKEN } from '@hamak/logging/api';
import { NOTIFICATION_SERVICE_TOKEN } from '@hamak/notification/api';

// Test cases described in "Acceptance criteria" below.
```

## Framework APIs used

- `@hamak/microkernel-impl` — `Host.listPlugins(): PluginManifest[]` and `Host.rootActivationCtx: ActivateContext` (`frontend/node_modules/@hamak/microkernel-impl/dist/runtime/host.d.ts:28-46`, runtime at `host.js:73-75` and `host.js:111`).
- `@hamak/microkernel-api` — `PluginManifest.dependsOn?: string[]` (`frontend/node_modules/@hamak/microkernel-api/dist/types.d.ts:23`).
- `@hamak/ui-store-api` — `STORE_MANAGER_TOKEN`, `REDUCER_REGISTRY_TOKEN`, `STORE_EXTENSIONS_TOKEN` (`frontend/node_modules/@hamak/ui-store-api/dist/tokens/service-tokens.d.ts:1-10`, runtime at `service-tokens.js:1-10`). Provided by `createStorePlugin().initialize` (`frontend/node_modules/@hamak/ui-store-impl/dist/plugin/store-plugin-factory.js:81-97`).
- `@hamak/ui-remote-fs` — `PATH_TRANSLATOR_TOKEN`, `WORKSPACE_CLIENT_TOKEN` (`frontend/node_modules/@hamak/ui-remote-fs/dist/api/index.d.ts`, runtime at `frontend/node_modules/@hamak/ui-remote-fs/dist/impl/plugin/remote-fs-plugin-factory.js:73-74`). The framework factory **resolves STORE_MANAGER_TOKEN and STORE_EXTENSIONS_TOKEN in `activate`** (`remote-fs-plugin-factory.js:83-95`) — hard error if missing.
- `@hamak/ui-remote-git-fs` — `GIT_CLIENT_TOKEN`, `GIT_PATH_TRANSLATOR_TOKEN` provided at initialize (`git-plugin-factory.js:76-77`). Framework `createGitPlugin` resolves STORE_MANAGER_TOKEN + STORE_EXTENSIONS_TOKEN in activate (`git-plugin-factory.js:84-95`) but does **NOT** resolve remote-fs's `PATH_TRANSLATOR_TOKEN` — it constructs its own `GitPathTranslator` (line 70). Therefore the `git` plugin does not depend on `remote-fs` for DI.
- `@hamak/ui-shell` — `SHELL_TOKEN`, `THEME_MANAGER_TOKEN`, `FEATURE_MANAGER_TOKEN`, `LAYOUT_MANAGER_TOKEN` provided at initialize (`frontend/node_modules/@hamak/ui-shell/dist/impl/plugin/ShellPluginFactory.js:16-19`). Framework shell factory **performs no `ctx.resolve` at any lifecycle phase** (verified across `ShellPluginFactory.js:11-57`). The shell plugin therefore has zero real DI dependencies.
- `@hamak/logging` — `LOG_MANAGER_TOKEN`, `LOG_CONFIG_TOKEN`, `LOGGER_TOKEN` provided at initialize (`frontend/node_modules/@hamak/logging/dist/impl/plugin/logging-plugin-factory.js:64-72`). Logging framework factory has **no `ctx.resolve` calls** — it only listens to `plugin:error` and `host:activated` hooks during activate (lines 82-87).
- `@hamak/notification` — `NOTIFICATION_SERVICE_TOKEN` provided at initialize. Framework factory **resolves `LOG_MANAGER_TOKEN` unconditionally at initialize** (`frontend/node_modules/@hamak/notification/dist/impl/plugin/notification-plugin-factory.js:47`) — hard error if logging missing. It additionally attempts `ctx.resolve(Symbol.for('@hamak/ui-store:StoreExtensionsRegistry'))` (`notification-plugin-factory.js:59-60`) inside a `try`/`catch` — see Risk 2 for the symbol mismatch.

## Audit table (the actual deliverable of this ticket)

The "verdict" column drives the bootstrap.ts edits. Token-source citations point at the `provide(...)` call site for the token in either the framework factory `.js` or our plugin `.ts`.

| Plugin | Current `dependsOn` | Tokens actually resolved at init/activate (sources) | Hooks listened in plugin source | Verdict |
|---|---|---|---|---|
| `store` (wrapped) | none | `REDUCER_REGISTRY_TOKEN` from `wrappedStorePlugin.initialize` (`bootstrap.ts:58`); this is **self-resolution** of a token the inner factory provides at the same call. No external deps. | none | OK. Leave empty. |
| `shell` | `['store']` | None. `ShellPluginFactory.js:11-57` has zero `ctx.resolve`. Our wrapper `shellPlugin.ts:35` listens to `'shell:theme-changed'` — its own event, emitted by the framework factory just above (line 54 of `ShellPluginFactory.js`). | `'shell:theme-changed'` (own framework's event — not cross-plugin) | **Drop `'store'`.** Final: `dependsOn: []` (omit the field entirely). |
| `auth` | `['store']` | None. `authPlugin.ts` only `provide`s `AUTH_SERVICE_TOKEN` (line 18) and emits `'auth:session-restored'` (line 26). No `ctx.resolve`. | none | **Drop `'store'`.** Final: `dependsOn: []` (omit). |
| `data-dictionary` | `['store', 'auth', 'store-fs', 'git']` | `STORE_FS_TOKEN` (from `store-fs`, `dataDictionaryPlugin.ts:93`); `STORE_MANAGER_TOKEN` (from `store`, line 96); `STEREOTYPE_SERVICE_TOKEN`, `INTEGRITY_SERVICE_TOKEN`, `DIFF_SERVICE_TOKEN`, `IMPORT_EXPORT_SERVICE_TOKEN`, `CASE_SERVICE_TOKEN`, `RULE_SERVICE_TOKEN` (lines 158-163 — **self-resolves**: provided by this same plugin a few lines earlier); `GIT_SERVICE_TOKEN` (from `git`, line 251, wrapped in `try`/`catch` for test bootstraps that omit git). `AUTH_SERVICE_TOKEN` is **never resolved** anywhere (grep `frontend/src/plugins/data-dictionary` — zero hits). | none | **Drop `'auth'`.** Final: `dependsOn: ['store', 'store-fs', 'git']`. The `'git'` dep stays — the try/catch is a soft optionality for test harnesses, not a removal signal; production always loads git first and the `if (git !== null)` branch is the production code path. |
| `visualization` | `['store']` | None. `visualizationPlugin.ts` only does `ctx.views.register('routes.visualization', ...)` (line 23). No `ctx.resolve`. | none | **Drop `'store'`.** Final: `dependsOn: []` (omit). |
| `search` | `['store', 'store-fs']` | `STORE_FS_TOKEN` (from `store-fs`, `searchPlugin.ts:105`); `STORE_MANAGER_TOKEN` (from `store`, line 106); `SEARCH_SERVICE_TOKEN` (self-provided two lines earlier, line 110). | none | OK as-is. |
| `remote-fs` | `['store']` | `STORE_MANAGER_TOKEN` + `STORE_EXTENSIONS_TOKEN` in framework `remote-fs-plugin-factory.js:83-95` (both throw if missing). | none | OK as-is. |
| `store-fs` | `['store', 'remote-fs']` | `STORE_EXTENSIONS_TOKEN` (`storeFsPlugin.ts:124`); `STORE_MANAGER_TOKEN` (line 167) — both from `store`. `PATH_TRANSLATOR_TOKEN` (line 203) — from `remote-fs`. | none (own ready hook emitted) | OK as-is. |
| `git` | `['store', 'remote-fs']` | Framework `git-plugin-factory.js:84-95` resolves `STORE_MANAGER_TOKEN` + `STORE_EXTENSIONS_TOKEN` — both from `store`. Does NOT resolve `PATH_TRANSLATOR_TOKEN` from remote-fs (constructs its own `GitPathTranslator` at `git-plugin-factory.js:70`). Our wrapper `gitPlugin.ts:35` provides `GIT_SERVICE_TOKEN` with no resolve. | none | **Drop `'remote-fs'`.** Final: `dependsOn: ['store']`. |
| `logging` | none | None. `logging-plugin-factory.js:26-100` has zero `ctx.resolve`. Listens to `plugin:error`, `host:activated` (framework hooks, no cross-plugin dep). | (framework: `'plugin:error'`, `'host:activated'`) | OK. Leave empty. |
| `notification` | `['store', 'logging']` | Framework `notification-plugin-factory.js:47` resolves `LOG_MANAGER_TOKEN` (hard) — from `logging`. It also attempts `ctx.resolve(Symbol.for('@hamak/ui-store:StoreExtensionsRegistry'))` (line 60) in a `try/catch` — but `store` provides under `Symbol('StoreExtensions')` (a fresh, non-shared symbol — verified at `frontend/node_modules/@hamak/ui-store-api/dist/tokens/service-tokens.js:8`). The two symbols are **not equal**, so the resolve throws inside the try and is caught; the reducer registration silently fails. See Risk 2. | none | **Drop `'store'`.** Final: `dependsOn: ['logging']`. Pre-existing silent-failure bug stays out of scope. |
| `ai-assistance` | `['store', 'auth', 'data-dictionary']` | None. `aiPlugin.ts` only provides `AI_SERVICE_TOKEN` (line 53) and registers 16 commands. `AIService` is a plain axios wrapper (no DI). The plugin's comment at line 14 acknowledges `DICTIONARY_SERVICE_TOKEN has no provider yet`. `spec-grep-guards.ai.test.ts:86` actively **forbids** importing data-dictionary tokens. | none | **Drop all three deps.** Final: `dependsOn: []` (omit). |

### Resulting bootstrap.ts manifest deltas (summary)

| Plugin | Before | After |
|---|---|---|
| `shell` | `dependsOn: ['store']` | (omit `dependsOn`) |
| `auth` | `dependsOn: ['store']` | (omit `dependsOn`) |
| `data-dictionary` | `dependsOn: ['store', 'auth', 'store-fs', 'git']` | `dependsOn: ['store', 'store-fs', 'git']` |
| `visualization` | `dependsOn: ['store']` | (omit `dependsOn`) |
| `search` | `dependsOn: ['store', 'store-fs']` | unchanged |
| `remote-fs` | `dependsOn: ['store']` | unchanged |
| `store-fs` | `dependsOn: ['store', 'remote-fs']` | unchanged |
| `git` | `dependsOn: ['store', 'remote-fs']` | `dependsOn: ['store']` |
| `logging` | (none) | unchanged |
| `notification` | `dependsOn: ['store', 'logging']` | `dependsOn: ['logging']` |
| `ai-assistance` | `dependsOn: ['store', 'auth', 'data-dictionary']` | (omit `dependsOn`) |

### Convention comment (to add at top of `registerPlugins()` in `bootstrap.ts`)

The block (~12 lines) reads roughly:

```ts
/**
 * Plugin `dependsOn` convention.
 *
 * `dependsOn` lists every plugin whose DI token this plugin resolves at
 * `initialize` or `activate`. The microkernel uses these names solely for
 * topological ordering of `initialize` and `activate` (graph-utils.js:10).
 * They are NOT enforcement — a missing token surfaces only as a runtime
 * `No provider for token: …` throw from container.resolve (di.js:63).
 *
 * Out of scope of this declaration:
 *   - `ctx.commands.run(...)` callers — command bus is name-keyed, loose.
 *   - `ctx.hooks.on(...)` listeners — listeners survive without emitter.
 *   - Best-effort `ctx.resolve` calls wrapped in try/catch.
 *
 * Smoke test enforcing this convention: src/__tests__/plugin-dependency-graph.test.ts.
 */
```

The comment lives in `bootstrap.ts` (not in a separate `plugin-dependencies.md`) per the ticket's "Decide which location" — keeping it next to the call sites maximizes the chance future plugin authors read it.

## Smoke test design — `frontend/src/__tests__/plugin-dependency-graph.test.ts`

Follows the existing precedent of `frontend/src/plugins/search/__tests__/searchPlugin.search.test.ts` and `dataDictionaryPlugin.integrity.test.ts`: `beforeAll(() => bootstrapApplication())`, then assertions on `host.rootActivationCtx.resolve(...)`. The `bootstrapApplication()` singleton is idempotent (guarded by `isBootstrapped` flag at `bootstrap.ts:43`), so running the new test alongside other bootstrap tests in the same Vitest worker is safe.

### Test groupings

```ts
describe('plugin manifests — declared dependencies resolve to registered plugins', () => {
  // For each plugin's manifest in host.listPlugins(), assert that every
  // name in dependsOn appears in the full listPlugins() name set.
  // Failure mode: a typo in dependsOn (e.g. 'remote-git' after the #160
  // rename to 'git') would surface here.
});

describe('plugin DI tokens — each plugin\'s actual resolves succeed', () => {
  // Drive each plugin's known token-resolve set explicitly. These are
  // the SAME calls the plugins make internally; we assert the result
  // is non-null and the same singleton on a second call.

  // 'store' plugin provides:
  it('store → STORE_MANAGER_TOKEN', …);
  it('store → REDUCER_REGISTRY_TOKEN', …);
  it('store → STORE_EXTENSIONS_TOKEN', …);
  it('store → MIDDLEWARE_REGISTRY_TOKEN', …);

  // 'remote-fs' plugin provides:
  it('remote-fs → PATH_TRANSLATOR_TOKEN', …);
  it('remote-fs → WORKSPACE_CLIENT_TOKEN', …);

  // 'store-fs' plugin provides:
  it('store-fs → STORE_FS_TOKEN (lazy Proxy is non-null)', …);
  it('store-fs → AUTOSAVE_REGISTRY_TOKEN', …);

  // 'git' plugin provides:
  it('git → GIT_CLIENT_TOKEN (framework)', …);
  it('git → GIT_PATH_TRANSLATOR_TOKEN (framework)', …);
  it('git → GIT_SERVICE_TOKEN (ours)', …);

  // 'shell' plugin provides:
  it('shell → SHELL_TOKEN / THEME_MANAGER_TOKEN / FEATURE_MANAGER_TOKEN / LAYOUT_MANAGER_TOKEN', …);

  // 'auth' plugin provides:
  it('auth → AUTH_SERVICE_TOKEN', …);

  // 'data-dictionary' plugin provides:
  it('data-dictionary → STEREOTYPE_SERVICE_TOKEN', …);
  it('data-dictionary → INTEGRITY_SERVICE_TOKEN', …);
  it('data-dictionary → DIFF_SERVICE_TOKEN', …);
  it('data-dictionary → IMPORT_EXPORT_SERVICE_TOKEN', …);
  it('data-dictionary → METADATA_TYPE_REGISTRY_TOKEN', …);
  it('data-dictionary → CASE_SERVICE_TOKEN', …);
  it('data-dictionary → RULE_SERVICE_TOKEN', …);
  it('data-dictionary → PUBLISH_SERVICE_TOKEN', …);

  // 'search' plugin provides:
  it('search → SEARCH_SERVICE_TOKEN', …);

  // 'ai-assistance' plugin provides:
  it('ai-assistance → AI_SERVICE_TOKEN', …);

  // 'logging' plugin provides:
  it('logging → LOG_MANAGER_TOKEN / LOG_CONFIG_TOKEN / LOGGER_TOKEN', …);

  // 'notification' plugin provides:
  it('notification → NOTIFICATION_SERVICE_TOKEN', …);
});

describe('plugin manifests — no orphan dependency names', () => {
  // Negative-style check: for each name in the union of all dependsOn
  // arrays, assert host.getPlugin(name) is defined.
});
```

### Why this test catches the regressions of interest

- **Renamed plugin** (e.g. the #160 `remote-git → git` rename): a stale dependsOn entry `'remote-git'` makes the first describe fail with a clear name-not-found.
- **Removed provider**: if a future PR drops `ctx.provide({ provide: SEARCH_SERVICE_TOKEN, … })` from searchPlugin, the matching `it` in the second describe throws `No provider for token: Symbol(SearchService)` from `container.resolve` — caught as a test failure with that exact message.
- **Ordering bug**: if `store-fs.initialize` were to resolve a token that only `remote-fs.activate` provides, the bootstrap itself throws inside the test's `beforeAll`. (This is the existing mechanism, but the smoke test makes the failure visible at the right git bisect step.)

### What the test deliberately does NOT do

- Does not check the **inverse** ("every declared dep is actually used"). That's harder to express programmatically (`ctx.resolve` calls live in plugin source, not in a manifest), and the manual audit table above already enforces it for the current snapshot. Future audits become a code-review checklist.
- Does not enumerate `ctx.commands.run` callers — out of scope per ticket.
- Does not check hook emitter/listener pairs — out of scope per ticket.

## Acceptance criteria

1. Every plugin's `dependsOn` in `frontend/src/kernel/bootstrap.ts` matches the "After" column of the resulting-deltas table above. Specifically `grep -n dependsOn frontend/src/kernel/bootstrap.ts` returns exactly four lines (data-dictionary, search, remote-fs, store-fs, git, notification — i.e. six declarations, the rest omit the field entirely).
2. A new file `frontend/src/__tests__/plugin-dependency-graph.test.ts` exists and passes under `npm test`. Its contents structurally match the "Smoke test design" section above.
3. `bootstrap.ts` contains the convention comment block above `registerPlugins()`. Exact wording flexes; the substantive content (point about non-enforcement, point about out-of-scope categories, pointer to the smoke test path) is required.
4. Frontend Vitest baseline preserved. Pre-change baseline observed in `.claude/work/156/` notes is `641p/11s/0f`. After this PR: total passing test count `>= 641 + N` where `N` is the number of `it` blocks in the new smoke test file (estimated 22-28). No test goes from passing to failing.
5. Boot still works in dev: `npm run dev` from `frontend/` starts without throwing inside `bootstrapApplication()`. (Manually checkable; gating regression is criterion #4's bootstrap-driven tests.)
6. No source-file edits anywhere outside `bootstrap.ts`. Specifically: zero edits to files under `frontend/src/plugins/*/`, `frontend/src/kernel/tokens.ts`, or `frontend/src/store/`. `git diff --stat` shows the only `frontend/src/` touch is `kernel/bootstrap.ts` plus the new `__tests__/plugin-dependency-graph.test.ts`.

## Out of scope

- **Command-bus callers**: `ctx.commands.run(...)` is name-keyed and doesn't impose a manifest-level dep. Per ticket. `data-dictionary` calls `notification.${level}` (line 328) — this is intentionally NOT a reason to depend on `notification`.
- **Hook listeners**: subscribing via `ctx.hooks.on(...)` works whether the emitter is loaded or not. Per ticket.
- **Best-effort resolves wrapped in try/catch**: `data-dictionary`'s `GIT_SERVICE_TOKEN` resolve at line 251 is wrapped in `try/catch` for lightweight test harnesses, but the production code path always has git loaded — so the `'git'` dep stays declared. The try/catch is a safety net, not a deletion signal.
- **Fixing the notification → store reducer registration bug** (Risk 2): the `Symbol.for('@hamak/ui-store:StoreExtensionsRegistry')` vs `Symbol('StoreExtensions')` mismatch is real and predates this ticket. It belongs in a follow-up framework fix or in our notification wrapper.
- **Adding the dual logical+raw STORE_FS slices** from the #166 cookbook comment (deferred to #167 / #168 per `storeFsPlugin.ts:9-13`).
- **Per-plugin `contributes.commands` / `contributes.views`** declarations: present in the framework's `PluginManifest` type but unused across our codebase. Out of scope.
- **Refactoring the topological-sort warning into a hard error** (would catch typos at boot, but is a framework change).

## Dependencies

- Coordinates with #154 (slice rehoming) and #155 (DI services catalog) — both substantially landed. The audit only made sense after the #155-catalog services started provoking real `ctx.resolve` calls; verified by inspecting `dataDictionaryPlugin.ts` at HEAD = `6aecd3e`.
- No blocking dependency on other open architecture tickets.
- Does **not** block any open ticket. #158 (docs only), #163 (commands/events framework adoption) build on #156 independently.

## Risks

1. **The current `dependsOn` graph is already correct in the "all-needed-deps-are-declared" direction; this ticket only removes bogus ones.** Removing `'auth'` from data-dictionary, `'remote-fs'` from git, etc. relaxes the topological-sort constraint, which COULD in theory let a future refactor reorder these plugins in a way that exposes a hidden race. Mitigation: the new smoke test boots the full set and resolves every documented token — any reordering that breaks DI will fail the test in CI. Additionally, the production bootstrap's `console.log('[…] Plugin activated')` lines preserve the existing ordering observability.
2. **Notification → store reducer registration is silently broken.** `notification-plugin-factory.js:60` uses `Symbol.for('@hamak/ui-store:StoreExtensionsRegistry')`, but `store-plugin-factory.js:91` provides under the fresh `Symbol('StoreExtensions')` (verified at `frontend/node_modules/@hamak/ui-store-api/dist/tokens/service-tokens.js:8`). The two are not equal, so the try/catch in notification's initialize swallows a `No provider for token` throw and the `state.notifications` slice is never registered. Our notificationPlugin.ts comment at lines 35-48 INCORRECTLY claims the slice "WILL appear in RootState." This is a pre-existing bug, **not introduced by this ticket**, and out of scope per the ticket body's "no regressions" line. Mitigation: flag in a follow-up ticket; the dropped `'store'` dep does not make the situation worse because the bug was silent regardless.
3. **Test isolation under `pool: 'forks'`.** `bootstrapApplication()` is idempotent (singleton flag), but `host` is module-level state. Other bootstrap tests in the suite (`searchPlugin.search.test.ts`, `dataDictionaryPlugin.*.test.ts`) already share the singleton without issue, so the new smoke test inherits the same proven model. The risk surfaces if a forks-pool worker reuses a process across files — `vitest.config.ts:43-45` has `singleFork: false`, so each file runs in its own worker; the singleton is genuinely per-file. Mitigation: none needed beyond following the existing precedent.
4. **`Host.listPlugins()` returns manifests but framework gives no name introspection on `Container`.** The first `describe` block in the smoke test relies on `host.listPlugins().forEach(m => m.dependsOn?.forEach(d => expect(host.getPlugin(d)).toBeDefined()))`. Both APIs are public (`host.d.ts:28,33`). The second describe relies on `host.rootActivationCtx.resolve(TOKEN)`, also public. **No introspection of "what tokens did each plugin provide"** is exposed by the framework — so we cannot programmatically check "every token has a provider somewhere"; we drive the cross-product manually via the explicit `it` blocks. This is the limit the ticket warns about ("If the framework's DI doesn't expose introspection over registered tokens, the test may need to drive it via specific `ctx.resolve(TOKEN)` calls…"). Mitigation: the manual cross-product is exhaustive; adding a new token in the future requires adding both `ctx.provide` and a corresponding `it` block — call this a code-review responsibility.
5. **Removing `dependsOn: ['store']` from `shell` / `auth` / `visualization` lets the topological sort place them before `store`.** None of those plugins resolve store tokens, so this is safe — but it means in debug-logged init order, the names will appear in an order that no longer reflects "logical" plugin layers (shell/auth/visualization could theoretically initialize before store). Mitigation: the bootstrap.ts registration order (`registerPlugin` call order) becomes the de-facto tiebreaker because `topologicalSort` is stable over `items` insertion order (`graph-utils.js:33-34` — `items.forEach(item => visit(item))` walks insertion order, and `visited`-set guards reentry). So the current observable ordering is preserved as long as `bootstrap.ts` keeps registering `store` first.

