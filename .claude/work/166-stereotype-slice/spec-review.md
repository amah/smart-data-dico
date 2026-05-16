# Spec review — #166 (stereotype-slice pilot): Store FS DI plumbing + StereotypeService facade  (cycle 1)

## Verdict
**rework**

## Required changes

1. **Fix the `FileSystemAdapter` import path.** Spec lines 235-239 import `FileSystemAdapter` from `@hamak/ui-store-api`:
   ```ts
   import type {
     FileSystemAdapter,
     FileSystemState,
   } from '@hamak/ui-store-api';
   ```
   `FileSystemAdapter` is **not** exported from `@hamak/ui-store-api` — grep across `frontend/node_modules/@hamak/ui-store-api/dist/` returns zero hits. The class lives in `@hamak/ui-store-impl/dist/fs/core/fs-adapter.d.ts:22`. The implementor reading this spec verbatim will produce a TypeScript error and waste a cycle. Change to:
   ```ts
   import type { FileSystemAdapter } from '@hamak/ui-store-impl';
   import type { FileSystemState } from '@hamak/ui-store-api';
   ```
   (Both packages re-export from their respective top-level entries: `@hamak/ui-store-impl/dist/index.d.ts` includes `export * from './fs'`, and `@hamak/ui-store-api/dist/fs/index.d.ts:1` re-exports `FileSystemState` from `@hamak/shared-utils`.)

2. **Acceptance #2 will fail against the real framework due to a `RemoteFsAutosaveProvider.supports` bug.** The provider's runtime at `frontend/node_modules/@hamak/ui-remote-fs/dist/impl/autosave/remote-fs-autosave-provider.js:41-45`:
   ```js
   supports(path, _node) {
     const remotePath = this.pathTranslator.toRemotePath({ getSegments: () => path });
     return remotePath !== undefined;
   }
   ```
   It passes a duck-typed object `{ getSegments: () => path }` to `PathTranslator.toRemotePath`. Inside, `toRemotePath` (i-path-translator.js:19-30) checks `!Array.isArray(localPath)` and assigns the duck directly to `pathway`. Then it calls `pathway.isAbsolute()` (line 23) — but the duck has no `isAbsolute` method (the real `Pathway` class declares it at `core-utils-pathway.d.ts:41`). The test's call `provider.supports(['dictionaries', '.dico', 'stereotypes.yaml'], <stub>)` will throw `TypeError: pathway.isAbsolute is not a function`.

   This is a framework bug, not a spec bug, but Acceptance #2's second and third assertions ("supports returns true" / "supports for unrelated path returns false") cannot pass without one of: (a) patching the framework, (b) filing a framework issue and gating the assertion on a future fix, (c) reducing the assertion to "the registry's `getAll()` contains a provider with `id === 'remote-fs'`" without invoking `supports`. Pick one and document the trade-off explicitly.

3. **Rewrite the lifecycle JSDoc — it contradicts itself.** Spec lines 116-129 (the JSDoc above `createAppStoreFsPlugin`) contain:
   - Lines 119-123: "calling it from activate works only because createStorePlugin's activate calls applyStoreExtensions BEFORE the store is initialized — VERIFIED at … store-plugin-factory.js:103-107"
   - Lines 124-129: "So we must register the middleware in INITIALIZE, not activate, to ensure it lands before store.activate runs applyStoreExtensions."
   
   These two statements are mutually exclusive. The second is correct (the microkernel host runs all `initialize` calls in topological order across all plugins, then all `activate` calls — verified at `frontend/node_modules/@hamak/microkernel-impl/dist/runtime/host.js:85-133`; by the time `store-fs.activate` runs, `store.activate` has already drained the extension collector and locked the middleware registry at `core/middleware-registry.js:47`). The first statement is misleading and will confuse the implementor. Delete it.

   The lifecycle diagram on lines 125-127 also omits `data-dictionary.initialize`, which is the entire reason the Proxy approach is needed. Replace with:
   ```
   store.initialize → remote-fs.initialize → store-fs.initialize
     → data-dictionary.initialize (here: ctx.resolve(STORE_FS_TOKEN))
     → store.activate (applyStoreExtensions drains and locks middleware registry; redux store created)
     → remote-fs.activate
     → store-fs.activate (here: lazyStoreFs assigned; Proxy starts returning real values)
     → data-dictionary.activate
   ```

4. **The `useState` grandfather exception is broader than the acceptance criterion guards against, and the spec's own example violates `patterns.md` anti-pattern #129.** Spec line 587 says: "the `useState` here is provisional… reviewer should reject any additional ones." But:
   - Acceptance #11's grep at line 671 only scans `storeFsPlugin.ts`, `StereotypeService.ts`, `useService.ts` — `StereotypesPage.tsx` is not in the grep targets, so any number of `useState`s in the page would pass CI.
   - The spec's example at line 569-570 shows **two** useStates in `StereotypesPage`: `useState(false)` for `loaded` AND `useState<string | null>(null)` for `error`. The latter is a literal match for `frontend/docs/patterns.md` anti-pattern at line 129 ("`useState<Error | null>(null)` for a fetch error in a smart component"). The narrative claims "one and only one" exception but the code shows two.
   
   Either:
   - (a) Drop `useState(error)` and route load failures through a notification plugin command (`commands.execute('notification.error', { message })`) — keeps Pattern §2 compliance for error.
   - (b) Stash the load error inside the Store FS node's `extensionStates` (the framework's `FileSystemNodeState.extensionStates` exists for exactly this kind of plugin metadata per `core-utils-filesystem.d.ts:24`), and read it back via a selector. This matches the comment-thread on #166 from 2026-05-09 ("Store FS mirrors LOGICAL hierarchy… loading/error/dirty come from the node").
   - (c) Acknowledge two violations explicitly, justify both with citations to `patterns.md`, and add the page itself to the Acceptance #11 grep so the count is fixed at two and can't drift to three.

5. **Add an end-to-end render test that exercises `useService` against the production singleton host.** The cookbook precedent (`notificationPlugin.test.ts`) constructs its own `Host`, so it never exercises the `useService(token)` path that reads from `host.rootActivationCtx` of the singleton imported from `bootstrap.ts`. Spec's Acceptance #4 and #5 use the same own-host pattern — they verify the service resolves from DI, but not that `useService` works in a React component. The first production consumer (`StereotypesPage.tsx`) is the one that hits this path. Add an acceptance criterion (call it #5a) that:
   - Bootstraps the singleton via `bootstrapApplication()` (or asserts an equivalent of it),
   - Renders `<StereotypesPage />` inside `<Provider store={store}>`,
   - Asserts the page does NOT throw "useService called before host bootstrap completed",
   - Asserts the page calls `service.loadAll()` once on mount (MSW spy on GET /api/stereotypes).
   
   Without this, the first integration regression that breaks `host` singleton timing will land in production rather than CI.

6. **Acceptance #12's baseline of "184 ≥ baseline" is from `arch/156-collapse-notification`, not from `main`.** Verified by `git diff main..HEAD --stat`: this branch is one commit ahead, and that commit (#156) adds two test files (`notificationPlugin.test.ts` +189 lines, `spec-grep-guards.test.ts` +186 lines). On `main`, the baseline would be lower (`#156` added 13 net new test cases). Either:
   - Specify that the implementation branches off `arch/156-collapse-notification` (or its descendant), OR
   - Re-baseline against `main` and adjust the target accordingly.
   
   Otherwise the implementor branching off `main` will see a different test count and have no way to know whether their work has caused a regression.

## Suggestions (won't block)

- Acceptance #9 cites `'rfs/PUT_REQUEST'` as the action type to absent-check. Actual value at `frontend/node_modules/@hamak/ui-remote-fs/dist/api/types/remote-fs-action.types.d.ts:23` is `"[Remote FS] Put/Request"`. The spec already notes "Read at test-author time" — fine. Recommend the test import `RemoteFsActionTypes.PUT_REQUEST` symbolically rather than a hard-coded string, so a future framework rename doesn't silently fail to match.

- The Proxy mechanism (spec lines 519-548) is correct but fragile. The alternative — moving `data-dictionary`'s STORE_FS resolution from `initialize` to `activate` — would eliminate the Proxy entirely. Both work; the spec commits to Proxy and that's defensible, but the trade-off comment at line 550 understates how much complexity the Proxy adds. Consider an in-spec note that the implementor MAY choose `activate`-side resolution if they prefer; both pass acceptance.

- The framework's `RemoteFsAutosaveProvider.supports` duck-type bug (Required Change #2) is also reachable from the autosave middleware's own internal path (`autosave-middleware.js:255` calls `provider.supports(path, node)` with `path: string[]`). This means autosave for ANY remote-fs file is broken in production today, not just in the test. Recommend filing a framework issue separate from this spec — the spec can land green if Acceptance #2 is weakened, but the dev hand-off note should call this out so the next ticket (#155 Phase 3, when entity migration happens) doesn't trip over it.

- Spec line 188-189 names the `store-fs` plugin `'store-fs'` while the `dependsOn` strings inside the plugin module reference itself as `'store-fs'` for the middleware extension's `plugin` field (line 174). Consistent — fine. Suggestion: assert in Acceptance #1 that `extensionsCollector` shows `'store-fs'` as a middleware source, to catch a future rename drift.

## Framework citation verification

| Cited path | Verified | Notes |
|---|---|---|
| `frontend/node_modules/@hamak/ui-store-impl/dist/plugin/store-plugin-factory.js:18` | YES | `createFileSystemAdapter('fs')` on line 18. |
| `frontend/node_modules/@hamak/ui-store-impl/dist/plugin/store-plugin-factory.js:79` | YES | `reducerRegistry.register('fs', fileSystemAdapter.getReducer())` on line 79. |
| `frontend/node_modules/@hamak/ui-store-impl/dist/plugin/store-plugin-factory.js:103` | YES | `applyStoreExtensions(...)` on line 103 inside `activate`. |
| `frontend/node_modules/@hamak/ui-store-impl/dist/autosave/autosave-middleware.js:78` | YES | `const { registry, fsSliceName = 'fileSystem', ... } = config` on line 78 — spec's claim that the default is `'fileSystem'` is correct. Pinning `fsSliceName: 'fs'` is required. |
| `frontend/node_modules/@hamak/ui-store-impl/dist/autosave/autosave-middleware.js:15-18` | YES | `CONTENT_CHANGE_ACTION_TYPES = ['set-file-content', 'update-file-content']` — `setFile` is not in this list. Spec's claim that `setFile` doesn't trigger autosave is correct. |
| `frontend/node_modules/@hamak/ui-remote-fs/dist/impl/middleware/store-sync-middleware.js:87` | YES | `JSON.parse(data.content)` is unconditional on the GET_COMPLETED branch. `transformContent` is applied AFTER (line 89-91), so it cannot save YAML. Risk 1 is real and correctly mitigated. |
| `frontend/node_modules/@hamak/ui-remote-fs/dist/impl/providers/http-workspace-client.js:117-122` | YES | `serializeContent` does `JSON.stringify` on non-string content. |
| `frontend/node_modules/@hamak/ui-remote-fs/dist/impl/plugin/remote-fs-plugin-factory.js:74` | YES | `ctx.provide({ provide: PATH_TRANSLATOR_TOKEN, useValue: pathTranslator })` is in `initialize`. Spec's claim that `PATH_TRANSLATOR_TOKEN` is resolvable from `store-fs.activate` is correct (initialize runs before all activates). |
| `frontend/node_modules/@hamak/ui-remote-fs/dist/impl/plugin/remote-fs-plugin-factory.js:89` | PARTIAL | The cited reference says "remote-fs itself resolves the store manager (remote-fs-plugin-factory.js:83)" — confirmed at line 83. Spec also cites line 89 for the `getFileSystemAdapter()` precedent — that's actually at line 89 of the same file. Both are correct. |
| `frontend/node_modules/@hamak/microkernel-impl/dist/runtime/host.js:85-133` (implied) | YES | All `initialize` calls run sequentially in plugin order, THEN all `activate` calls. Spec's lifecycle reasoning is correct. |
| `frontend/node_modules/@hamak/ui-store-impl/dist/core/middleware-registry.js:44-47` | YES | `lock()` is called by `StoreManager.initialize` at line 44 of `store-manager.js`. Once locked, `register()` throws (lines 10-13). |
| `frontend/node_modules/@hamak/ui-store-impl/dist/fs/core/fs-facade.d.ts:17` | YES | `class StoreFileSystemFacade<S = any>` with the cited constructor signature. |
| `frontend/node_modules/@hamak/ui-store-impl/dist/fs/core/fs-adapter.d.ts:22` | YES | `class FileSystemAdapter` with `getActions()`, `getReducer()`, `createSelector()`. |
| `frontend/node_modules/@hamak/ui-store-impl/dist/autosave/autosave-registry.d.ts:6` | YES | `class AutosaveProviderRegistry` with `register(provider)`, `findProvider(path, node)`, `getAll()`, `get(id)`, `has(id)`, `unregister(id)`. |
| `frontend/node_modules/@hamak/ui-store-impl/dist/autosave/autosave-middleware.d.ts:36` | YES | `createAutosaveMiddleware(config)` exported. |
| `frontend/node_modules/@hamak/ui-store-api/dist/tokens/service-tokens.d.ts:5,8,9` | YES | `STORE_MANAGER_TOKEN`, `STORE_EXTENSIONS_TOKEN`, `AUTOSAVE_REGISTRY_TOKEN` all declared as `unique symbol`. |
| `frontend/node_modules/@hamak/ui-store-api/dist/api/store-manager.d.ts:9-54` | YES | `IStoreManager` interface with `getState<S>()`, `dispatch(action)`. `getFileSystemAdapter()` is NOT in the interface — it's on the impl class only (`store-manager.js:30`). Spec correctly casts to access it, citing remote-fs's same-pattern precedent. |
| `frontend/node_modules/@hamak/ui-remote-fs/dist/api/tokens/remote-fs.tokens.d.ts:20` | YES | `PATH_TRANSLATOR_TOKEN: unique symbol`. |
| `frontend/node_modules/@hamak/ui-remote-fs/dist/spi/providers/i-path-translator.d.ts:25` | YES | `IPathTranslator` interface; methods `toRemotePath`, `toLocalPath`, `isUnderMountPoint`, `getMountPoint`, `formatPath`. |
| `frontend/node_modules/@hamak/ui-remote-fs/dist/impl/autosave/remote-fs-autosave-provider.d.ts:25` | YES | `class RemoteFsAutosaveProvider` with constructor `({ pathTranslator })`, `id = 'remote-fs'`, `priority = 10`. |
| `frontend/node_modules/@hamak/shared-utils/dist/core-utils-filesystem.d.ts:36` | YES | `interface FileNode<T = any>` exported. |
| Spec line 236-239: `FileSystemAdapter` from `@hamak/ui-store-api` | **NO** | `FileSystemAdapter` is only exported from `@hamak/ui-store-impl`. Wrong import path. See Required Change #1. |
| Spec line 663-666: `'rfs/PUT_REQUEST'` action type literal | NO (minor) | Actual value is `"[Remote FS] Put/Request"`. Spec acknowledges "Read at test-author time" — fine but worth nailing down. See Suggestion #1. |

## Risk reassessment

The spec's own Risk 1 (JSON-vs-YAML middleware gap), Risk 2 (lifecycle ordering fragility), Risk 4 (selector memoization) are all real and correctly mitigated.

Risks I would add or amplify:

- **Risk 6 (new): `RemoteFsAutosaveProvider.supports` framework bug.** As detailed in Required Change #2. Impact: any test or production code that exercises the autosave registry's `findProvider` will throw `TypeError: pathway.isAbsolute is not a function`. This means **autosave is currently non-functional in production for any path** — not just stereotypes. The spec's Risk 1 design (write through REST shim) shields stereotypes from this, but future Pattern A services that DO try autosave (per #155 Phase 3) will hit the bug. Mitigation: file a framework issue; weaken Acceptance #2; document for the #155 dev hand-off.

- **Risk 7 (new): `state.fs` slice is registered by the framework, but the wrapped store plugin in `bootstrap.ts:56-83` registers domain reducers AFTER `storePlugin.initialize(ctx)`** — and only domain reducers. The `'fs'` slice is registered by the framework's `createStorePlugin.initialize` (verified line 79 of store-plugin-factory.js). Two paths converge on the same `reducerRegistry`. The wrapped store plugin's `initialize` calls `await storePlugin.initialize(ctx)` first (line 58), which already registered `'fs'`. Then domain reducers are added. So the order works. But if a future refactor reorganizes the wrapped store plugin (e.g. inverts the order), `'fs'` could clash with a domain slice. Mitigation: an Acceptance criterion that explicitly asserts `getState()` has both `fs` AND the domain slices present after bootstrap (the spec's Acceptance #3 covers `fs` but not the domain slices — adding the latter is a five-line addition).

- **Risk 8 (new): The Proxy approach can mask bugs.** If `data-dictionary.initialize` accidentally calls a method on the resolved `STORE_FS_TOKEN` (e.g. `storeFs.getActions()` to register some action creator), the Proxy throws the cryptic error at line 530. The implementor will see "[store-fs] STORE_FS_TOKEN accessed before store-fs.activate" and have to understand the lifecycle. Mitigation: the error message is good. Add a runtime warning when ANY property except known-safe ones is accessed pre-activate, to catch the failure mode early. Or document the failure mode in the spec's "code review" note.

Overall risk: **Medium**, same level as the spec's cycle-1 self-assessment. The framework gap (Risk 1) is real and the design is conservative because of it; the spec is rightly cautious about not over-claiming.

## Cross-ticket conflicts

None blocking. Read `.claude/work/156/spec.md` end-to-end:
- #156 ships `loggingPlugin.ts` and rewrites `notificationPlugin.ts`. Both are merged into the current branch (`arch/156-collapse-notification`, commit `11603d9`). PR #171 is still open at the time of this review.
- This spec does not touch `notificationPlugin.ts`, `loggingPlugin.ts`, or any file in `notification/`. No rebase conflict.
- This spec's `bootstrap.ts` modification (insert `store-fs` registration between `remote-git` and `logging`) does not overlap with #156's `bootstrap.ts` change (insert `logging` between `remote-git` and `notification`). Both are pure insertions at adjacent lines — clean three-way merge if needed.
- #156's `spec-grep-guards.test.ts` adds a guard that scans for "exhaustive state shape" assertions. The new `state.fs` slice added by this spec also widens `RootState`, which would have the same exposure as `state.notifications` did. The guard already exists and the spec's Acceptance #9 (no autosave PUT) plus Acceptance #3 (`state.fs` exists) cover the relevant assertions. No conflict.

Cross-ticket reviews:
- #155 (services catalog): OPEN. Spec correctly declares `STEREOTYPE_SERVICE_TOKEN` as the first resolved token from #155's catalog. No conflict.
- #154 (rehome slices): OPEN. Spec correctly notes `state.fs` is framework-owned (registered by `createStorePlugin`), so #154's slice-rehoming work doesn't touch it.
- #167 (backend projection): OPEN. Spec correctly defers logical-path migration until #167 lands; the `STEREOTYPES_PATH` constant is documented as the single migration point.
- #168 (dual logical+raw): OPEN. Spec correctly defers dual-slice split; single `'fs'` slice today.
- #169 (multi-user worktrees): OPEN. Spec correctly defers workspace-id derivation from `currentUser.id`; hardcoded `'dictionaries'` today.
- #163 (action/event framework): OPEN. Spec correctly stays independent (method calls, not command bus).

The notification plugin's `state.notifications` slice combined with this spec's `state.fs` slice now widens `RootState` by two new top-level keys vs. baseline `main`. Both originated from framework auto-registration. Both are covered by #156's `spec-grep-guards.test.ts:160-172` guard. No regression risk.
