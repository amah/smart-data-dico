# Spec review — #166 (stereotype-slice pilot): Store FS DI plumbing + StereotypeService facade  (cycle 2)

## Verdict
**rework**

Cycle 1's six required changes are all addressed concretely and verifiably. However, cycle 2 introduces a new, real framework-runtime issue: the pilot's chosen path (`['dictionaries', '.dico', 'stereotypes.yaml']`) requires intermediate directories that `setFile` does NOT auto-create, so `StereotypeService.hydrate` will silently no-op against a freshly-bootstrapped store. This breaks Acceptance #5 / #6 / #7 / #8 / #9 / #10. Additionally there is a small but real bug in the spec's example `loading`-derivation expression that flips the "no node yet → still loading" semantics on its head. Both must be fixed before implementation.

## Required changes

1. **`setFile` does not create intermediate directories — `hydrate` will silently no-op for `STEREOTYPES_PATH`.**
   Verified at `frontend/node_modules/@hamak/ui-store-impl/dist/fs/commands/fs-commands.js:126-149`: `executeSetFile` calls `getFileSystemNode(root, parentPath)`; if the parent dir is undefined (which it is in a fresh store, since `getInitialState()` returns `{ root: { ..., children: {} } }` per `fs-adapter.js:25-27`), the function returns silently — no write, no warning. The spec's `hydrate` calls
   ```ts
   this.storeFs.getActions().setFile(['dictionaries', '.dico', 'stereotypes.yaml'], list, ...)
   ```
   against a state where `state.fs.root.children.dictionaries` is undefined. Net effect: dispatching `setFile` is a no-op. The selector returns undefined. `useFile()` returns undefined. Acceptance #5 ("Probe sees the fixture array on first render"), #6 ("After `hydrate(list, true)`, `useFile()` returns a node where `node.state.contentLoaded === true`"), #7, #8, #9, #10 all fail because the cache is never populated.

   The spec's Acceptance #1 point-3 (`setFile(['x'], 42, ...)` populates `state.fs.root.children.x.content === 42`) passes because `['x']` has zero intermediate dirs — the parent is the root itself. So #1 will green while #5–#10 silently red. The implementor's first integration run will hit this and bounce the PR back.

   Fix one of:
   - (a) `StereotypeService.hydrate` first dispatches `this.storeFs.getActions().mkdir(['dictionaries', '.dico'], true, undefined)` before `setFile`. `mkdir` with `parents=true` is verified at `fs-commands.js:69-104` to create missing intermediates idempotently. The constructor or `loadAll`-once-on-construction is fine — but it must run BEFORE the first `setFile`.
   - (b) `storeFsPlugin.activate` dispatches the `mkdir` once (since the path is constant `['dictionaries', '.dico']` for this pilot). Cleaner but mixes responsibility.
   - (c) Change `STEREOTYPES_PATH` to a flat path (e.g. `['stereotypes.yaml']`) for the pilot — but then the path no longer matches the eventual logical path the comment-thread on #166 from 2026-05-11T19:12:37Z points at, so this defers the path-shape problem rather than solving it.
   
   Pick (a), document the `mkdir-then-setFile` sequence in `hydrate`'s JSDoc, and add an acceptance-criteria precondition that the path's parent dirs exist after the service first runs.

2. **Spec's example `loading` derivation in `StereotypesPage` flips the "no node yet" semantics.**
   Spec line 662-664:
   ```ts
   const loading = file?.state.contentLoading
     ?? (file?.state.contentLoaded === false && !file?.state.contentLoadError)
     ?? true; // no node yet → still loading
   ```
   Trace with `file === undefined`:
   - `file?.state.contentLoading` = `undefined`
   - `(undefined === false) && X` = `false && X` = `false`
   - `undefined ?? false` = `false`
   - `false ?? true` = `false` (because `false` is NOT nullish; `??` only fires on null/undefined)
   - Result: `loading = false` — opposite of the comment's claim.
   
   So on first mount (before `useEffect` fires the `loadAll`), the page renders the empty-state UI with `stereotypes = []` instead of the loading spinner. After the effect fires, `loadAll` populates the cache and the page re-renders correctly — but the first paint shows "Stereotypes (empty)" for a frame, which is a visible bug. Even worse, if `loadAll` fails BEFORE `hydrate([], false)` succeeds (e.g. the no-op problem in Required Change #1), `file` stays undefined forever and the page shows empty-state permanently, masking the failure that the notification toast is supposed to surface.
   
   Fix: replace the derivation with the cookbook-canonical form. The cookbook's worked example (`patterns.md:40-41`) is:
   ```ts
   const loading = file?.state.contentLoading ?? false;
   const error   = file?.state.contentLoadError;
   ```
   With the additional "node-doesn't-exist-yet" semantics expressed clearly:
   ```ts
   const loaded = file?.state.contentLoaded ?? false;
   const loading = !loaded && !file?.state.contentLoadError;
   ```
   Or equivalently:
   ```ts
   const loading = !file || (!file.state.contentLoaded && !file.state.contentLoadError);
   ```
   Note that even after this fix, `file?.state.contentLoading` is effectively dead code in this pilot because nothing in the framework runtime ever sets `contentLoading: true` — `fileSystemNodeInitialState` always sets it to `false` (verified at `core-utils-filesystem.js:5`) and no code path in `@hamak/ui-store-impl` or `@hamak/ui-remote-fs` mutates it. The pilot does not flow through `LS_REQUEST`/`GET_REQUEST` (those paths might, but they're explicitly bypassed for this pilot per the JSON-vs-YAML gap), so `contentLoading` will always read `false`. That's fine — the page logic should not depend on it for this pilot. Document this in the page comment.

## Suggestions (won't block)

- **Acceptance #14's grep regex misses `useState<string\s*\|\s*null>(null)` on the unfiltered line.** The current page already uses `useState<string | null>(null)` for `editingId` (line 27 of the existing `StereotypesPage.tsx`). The spec's grep includes `string\s*\|\s*null` and then filters out `editingId`/`showCreate` via `-vE`. That works as long as the exclusion identifiers stay stable. If a future refactor renames `editingId` to `selectedId`, the filter silently passes a new `useState<string | null>` introduction. Consider tightening the filter to "exactly the two known lines" or whitelisting by line content. Not blocking — the implementor can choose.

- **Prefer resolving `FILESYSTEM_ADAPTER_TOKEN` over `storeManager.getFileSystemAdapter()`.** The framework explicitly provides `FILESYSTEM_ADAPTER_TOKEN` at `store-plugin-factory.js:94-96` (initialize phase). Resolving it via DI is cleaner than casting `IStoreManager` to access the impl-only method. Both work; the latter is the spec's choice; the former is more idiomatic. Not blocking.

- **The "Upstream framework bugs" section is precise enough that an upstream issue can be drafted directly from it.** Bug A includes file:line, source quote, reproduction snippet, failure-mode explanation, call-site analysis, and a two-character suggested fix. Bug B is shorter but adequate. The orchestrator has what they need. No clarification required.

- **`errorMessage = file?.state.contentLoadError?.message ?? null` in the page is dead code in this pilot.** Nothing sets `contentLoadError` (verified by grepping all of `node_modules/@hamak`). The notification toast is the only error UI. Either delete the binding or comment-flag it explicitly for future when a real `GET_REQUEST` path lands.

- **Acceptance #15's "test-file count grows by exactly 3" assertion is fine as written**, but the implementor's branch-base note should be in the test file itself (e.g. as a comment in `storeFsPlugin.test.ts`), not just in `attempts.log`, so a reviewer reading the test in PR review sees the context immediately.

## Framework citation verification

| Cited path | Verified | Notes |
|---|---|---|
| `@hamak/ui-store-impl/dist/index.d.ts` → `export * from './fs'` | YES | Top-level re-exports `FileSystemAdapter` and `StoreFileSystemFacade` via `./fs/index.d.ts`. Required Change #1 from cycle 1 fixed correctly. |
| `@hamak/ui-store-api/dist/fs/index.d.ts:1` re-exports `FileSystemState` from `@hamak/shared-utils` | YES | Verified line 1 is `export type { ..., FileSystemState, ... } from '@hamak/shared-utils';`. |
| `@hamak/ui-remote-fs/dist/impl/autosave/remote-fs-autosave-provider.js:41-45` `supports()` duck-types | YES | Confirmed: `this.pathTranslator.toRemotePath({ getSegments: () => path })`. |
| `@hamak/ui-remote-fs/dist/spi/providers/i-path-translator.js:19-30` calls `pathway.isAbsolute()` on line 23 | YES | Confirmed: `if (this.mountPoint.isAbsolute() && !pathway.isAbsolute())`. Bug A reproduces. |
| `@hamak/ui-store-impl/dist/autosave/autosave-middleware.js:15-18` `CONTENT_CHANGE_ACTION_TYPES` | YES | Confirmed: `['set-file-content', 'update-file-content']`. |
| `@hamak/ui-store-impl/dist/autosave/autosave-middleware.js:255` calls `registry.findProvider(path, node)` | YES | Confirmed; gated by `isContentChangeAction` at line 242. |
| `@hamak/ui-store-impl/dist/autosave/autosave-registry.js:8-13` `register` does NOT call `supports()` | YES | Confirmed: `this.providers.set(provider.id, provider)`, no `supports` invocation. Bug A dormant for `register`. |
| `@hamak/ui-store-impl/dist/fs/core/fs-adapter.js:62` `setFile` action type is `${sliceName}/createFileNode` | YES | Confirmed line 62: `this._setFileType = ${this.sliceName}/createFileNode`. `setFile` does not match `CONTENT_CHANGE_ACTION_TYPES` patterns; autosave middleware ignores it. |
| `@hamak/microkernel-impl/dist/runtime/host.js:85-138` lifecycle | YES | Confirmed: all `initialize` (lines 85-106), then `this.rootActivationCtx = actCtx` (line 111), then all `activate` (lines 113-138). No interleaving. Required Change #3 from cycle 1 fixed. |
| `@hamak/microkernel-impl/dist/runtime/host.d.ts:13` `rootActivationCtx?: ActivateContext` | YES | Confirmed. |
| `@hamak/shared-utils/dist/core-utils-filesystem.d.ts:15-25` `FileSystemNodeState` shape | YES | Fields `contentLoaded`, `contentLoading`, `contentLoadError`, `memo`, `contentHistory`, `extensionStates` all declared. Required Change #4 from cycle 1 fixed correctly at the type level. |
| `@hamak/shared-utils/dist/core-utils-filesystem.js:2-4` `fileSystemNodeInitialState(contentPresent)` sets `contentLoaded: contentPresent` | YES | Confirmed: lines 3-4 set `contentLoaded: contentPresent, contentLoading: false`. **However**, `contentLoading` is never mutated by any framework code path (grep on all `@hamak/` returns zero writes). So `loading` derived from `contentLoading` alone is always `false` in this pilot. See Required Change #2. |
| `@hamak/ui-store-impl/dist/fs/commands/fs-commands.js:127-149` `executeSetFile` requires parent dir to exist | YES | Confirmed: `parentDir === undefined → return` (no warning). This is the source of the `hydrate` no-op bug — see Required Change #1. |
| `@hamak/ui-store-impl/dist/fs/commands/fs-commands.js:69-104` `executeMkdir` with `parents: true` creates intermediates | YES | Confirmed: `if (parents === true) { child = createDirectoryNode(step); dir.children[step] = child; }` (lines 86-89). This is the proposed fix in Required Change #1. |
| `@hamak/ui-remote-fs/dist/api/types/remote-fs-action.types.d.ts` `RemoteFsActionTypes.PUT_REQUEST = "[Remote FS] Put/Request"` | YES | Confirmed at line 23. Acceptance #11's symbolic import is correct. |
| `@hamak/notification/dist/impl/plugin/notification-plugin-factory.js:94` `notification.error` command | YES | Confirmed: `ctx.commands.register('notification.error', (args) => ...)`. Signature `{ message, title, ...options }`. |
| `@hamak/ui-store-impl/dist/plugin/store-plugin-factory.js:79` registers `'fs'` reducer | YES | Confirmed: `reducerRegistry.register('fs', fileSystemAdapter.getReducer())`. |
| `@hamak/ui-store-impl/dist/plugin/store-plugin-factory.js:94-96` provides `FILESYSTEM_ADAPTER_TOKEN` | YES | Confirmed in `initialize` block. The spec's choice to go via `storeManager.getFileSystemAdapter()` instead is a stylistic divergence — see Suggestions. |
| `frontend/src/kernel/bootstrap.ts` exports `bootstrapApplication` and `getStore`; uses singleton `host` with `isBootstrapped` flag | YES | Lines 40 (`host`), 46 (`isBootstrapped`), 177 (`bootstrapApplication`), 203 (`getStore`). Acceptance #12 is structurally feasible. Risk 7 covers test isolation. |
| `git ls-tree -r main -- frontend/src` test-file count = 24; `arch/156-collapse-notification` = 26 | YES | Reproduced exactly. Required Change #6 from cycle 1 fixed. |

No mis-citations. All cycle-2-new citations resolve to the claimed line numbers.

## Risk reassessment

The spec's own Risks 1–7 are all real and well-mitigated as written, EXCEPT Risk 3 ("`useState` exception was eliminated") which the spec declares closed but is undermined by Required Change #2 (the page's `loading` expression has a logic bug, so the cookbook §2 compliance is only nominal, not functional).

Risks I would add:

- **Risk 8 (new): `setFile` silent no-op on nested paths without pre-existing parent dirs.** Detailed in Required Change #1. Severity: high — without the fix, the entire cache layer is non-functional and 6 of 17 acceptance criteria fail. Mitigation: explicit `mkdir(parents=true)` before first write.

- **Risk 9 (new): `state.contentLoading` is declared but never written by any framework code path.** The cookbook example assumes it gets set during a fetch-in-flight; in this pilot, no fetch flows through the framework's GET path. So any `loading`-from-Store-FS logic must be derived from `contentLoaded` alone, OR from `file === undefined`. This is fine for the pilot, but the cookbook's worked example will mislead implementors of future Pattern A services until #167 brings the framework GET path online and `contentLoading` starts flipping. The cookbook follow-up entry (currently TODO) should clarify.

Overall risk: **Medium-to-High** for this cycle. Cycle 1 was Medium; the two new required changes push it up. After fixes, returns to Medium.

## Cross-ticket conflicts

None new. The cycle-1 cross-ticket analysis remains valid:
- #156 (notification plugin) — merged into the current branch (`arch/156-collapse-notification`, commit `11603d9`). No conflict.
- #155 (services catalog) — coordinated; `STEREOTYPE_SERVICE_TOKEN` is the first resolved token from the catalog.
- #154 (rehome slices), #167 (backend projection), #168 (dual logical+raw), #169 (multi-user worktrees), #163 (action framework), #160 (framework git) — all coordinated; spec explicitly defers what they own.

The `state.fs` slice addition is covered by #156's `spec-grep-guards.test.ts` exhaustive-state-shape guard. No regression.

## Confirmation of cycle 1 fixes

| Cycle 1 required change | Cycle 2 status | Evidence |
|---|---|---|
| #1 — Import `FileSystemAdapter` from `-impl`, `FileSystemState` from `-api` | Fixed | Spec lines 88-93 import `FileSystemAdapter` from `@hamak/ui-store-impl` (line 92), `FileSystemState` from `@hamak/ui-store-api` (line 85). |
| #2 — `RemoteFsAutosaveProvider.supports` framework bug; route around it | Fixed | Spec routes around the bug by using `setFile` exclusively (which doesn't trigger the autosave middleware path, so `supports()` is never invoked). Acceptance #2 verifies presence-only. The bug analysis at lines 789-837 is precise enough for an upstream issue. Documented in Risk 6. |
| #3 — Rewrite lifecycle JSDoc | Fixed | Spec lines 106-145 cite `host.js:85-138` correctly; the diagram lists `data-dictionary.initialize` explicitly between `store-fs.initialize` and `store.activate`. The self-contradiction in cycle 1's JSDoc is gone. |
| #4 — `useState<Error>` exception | Fixed (at the type level), see Required Change #2 (for the derivation bug) | Spec routes loading/loaded/error through Store FS node state per `core-utils-filesystem.d.ts:15-25`. The page has zero `useState<boolean|Error|string\|null>` for IO state. Notifications go via the notification plugin. **However**, the actual `loading` expression is logically broken — see Required Change #2. The structural fix is correct; the inline derivation is wrong. |
| #5 — Singleton-host bootstrap test | Fixed | Acceptance #12 added. Bootstrap-application function exists at `bootstrap.ts:177`; `getStore` at `:203`; singleton `host` at `:40`; `isBootstrapped` flag at `:46`. Risk 7 covers test isolation. |
| #6 — Baseline test count | Fixed | `git ls-tree` baselines confirmed: main = 24, arch/156-collapse-notification = 26. Spec presents both target deltas explicitly. |

## Scope-creep check

Cycle 2 stayed disciplined:
- Only `StereotypesPage.tsx` is touched among pages.
- No other #155 services added.
- `react-query` remains in `package.json` (not removed).
- The seven other stereotype-consuming files (`RelationshipEditor`, `EntityDetail`, etc.) are explicitly out of scope.
- Backend untouched.

No scope creep.

## Summary

Cycle 1's six required changes are all addressed. Cycle 2 introduces two new issues that must be fixed in cycle 3:
1. **Functional**: `setFile` doesn't auto-create parent dirs; `hydrate` silently no-ops; 6 acceptance criteria fail. Add `mkdir(parents=true)` to the service or plugin.
2. **Correctness**: the page's `loading` expression has a logic bug that flips the "no node yet" branch; replace with the cookbook-canonical form.

Both fixes are small (each is a one-line change in the code shown in the spec). No new framework citations to verify after the fix. No upstream-framework bugs of comparable severity to Bug A surfaced in this review.
