# Code review — #166-stereotype-slice: Store FS DI plumbing + StereotypeService facade  (cycle 1)

## Verdict
**approve**

The diff implements the cycle-3 spec faithfully. All three orchestrator-authorized deviations (positional `message`, notify wiring in `activate`, 4 test files) are correctly applied with TODOs anchored to PR #171. All framework imports verified against `.d.ts` and `.js`. Tests run 28/28; full suite 202/202. `tsc --noEmit` on touched files: 0 errors. Production `npm run build`: pass. Bug-A routed via `setFile` (not `setFileContent`). The two `useState` calls remaining in `StereotypesPage.tsx` are the allow-listed ephemeral-UI declarations per cookbook §1.5. No required changes.

## Required changes
(none)

## Suggestions (optional, won't block)

1. **Failure-path UX gap inherited from spec.** `frontend/src/plugins/data-dictionary/services/StereotypeService.ts:101` calls `hydrate([], false)` on `loadAll()` failure, which dispatches `setFile(..., contentIsPresent: false)`. The resulting node has `contentLoaded: false, contentLoadError: undefined` (verified at `@hamak/shared-utils/dist/core-utils-filesystem.js:2-9`). With the cookbook-canonical loading derivation `loading = !file || (!file.state.contentLoaded && !file.state.contentLoadError)` (`StereotypesPage.tsx:51`), the page evaluates `loading === true` indefinitely after a failure. The notification toast fires once and disappears; the user is left looking at a spinner with no retry affordance. The spec's stated intent (line 429: "shows 'loaded but empty' rather than spinning") doesn't match this code path's actual semantics. The implementation matches the approved spec verbatim, so this is not a required change against the spec, but the next ticket touching this page should either (a) set `contentLoadError` on hydrate failure, or (b) re-derive loading to also flip off when `contentLoaded === false && content === undefined`. Flag for the post-#156-merge cleanup pass.

2. **Module-scope `notifyImpl` leaks across test `Host` instances.** `frontend/src/plugins/data-dictionary/dataDictionaryPlugin.ts:28` declares `let notifyImpl: NotifyFn = () => {};` at module scope. Two `createDataDictionaryPlugin()` factories sharing the same module instance share the same `notifyImpl` slot — the later `activate` overwrites the earlier. This is documented (lines 19-22) and orchestrator-authorized, and is fine for the production singleton. But in `StereotypeService.test.ts` two helpers each bootstrap their own `Host`; if those ran in parallel against the same plugin factory, the later `activate`'s notify would shadow the earlier (in current tests they don't conflict because each test instantiates a fresh factory and the spy-bootstrap path omits `data-dictionary`). Consider closing over the slot inside the factory (`let notifyImpl: NotifyFn = () => {};` moved inside `createDataDictionaryPlugin`) to make each instance independent. The TODO already in place for the `{ message }` signature swap is a natural moment to fix this.

3. **`bootstrap.ts` notification-plugin's `dependsOn` is still `['store']`.** Verified at `frontend/src/kernel/bootstrap.ts:155`. Per the cycle-1 prompt note, this is expected on `main` (no `'logging'` dep). Confirmed unchanged.

4. **`vite.config.ts` `test.server.deps.inline` is an explicit array, scoped to `test:` block.** Verified at `frontend/vite.config.ts:32-60`. Comment names the upstream issue (`amah/app-framework#11`) and the installed-version pin (`0.5.0`). Test-author claimed the inline form was necessary; I did not re-probe (re-stash/run is destructive), but the rationale in `test-results.md:55-62` is plausible and the test suite passes with the current config. Suggestion only: when the framework moves past 0.5.5, the block can be deleted.

5. **PR body should mention coordination notes.** The diff doesn't reference (a) upstream issue `amah/app-framework#12` (Bug A), (b) post-#156-merge `{ message }` signature swap, or (c) state.fs slice auto-registration coordinating with #154. The TODO comments at `dataDictionaryPlugin.ts:24-27` and `:85-87` cover (b), but (a) and (c) live only in `.claude/work/` artifacts. Add to PR description when raising the PR.

## Acceptance-criterion coverage

| Criterion | Implemented | Notes |
|---|---|---|
| 1. `STORE_FS_TOKEN` resolves a working facade | yes | `storeFsPlugin.test.ts:87-123` — truthy + 4 methods + setFile round-trip |
| 2. `AUTOSAVE_REGISTRY_TOKEN` resolves a registry with one provider (id=remote-fs, priority=10) — presence-only | yes | `storeFsPlugin.test.ts:125-135` — never invokes `supports()` per Bug A |
| 3. `state.fs` has framework initial shape | yes | `storeFsPlugin.test.ts:137-158` |
| 4. `STEREOTYPE_SERVICE_TOKEN` resolves with all 8 methods | yes | `StereotypeService.test.ts:160-180` (all 8 methods asserted); bootstrap test asserts 6 of 8 |
| 5. `useAll()` returns Store FS-cached data after hydrate | yes | `StereotypeService.test.ts:184-210` |
| 6. `useFile()` exposes contentLoaded/contentLoadError | yes | `StereotypeService.test.ts:212-263` (both success and failure cases) |
| 7. `loadAll()` populates Store FS through MSW | yes | `StereotypeService.test.ts:265-278` |
| 8. `loadAll()` failure marks not-loaded + fires notify('error') | yes | `StereotypeService.test.ts:280-297` |
| 9. `create()` POSTs and updates cache | yes | `StereotypeService.test.ts:299-333` |
| 10. `update()` and `delete()` refresh cache | yes | `StereotypeService.test.ts:335-394` (two cases) |
| 11. No PUT_REQUEST fires for stereotype writes | yes | `StereotypeService.test.ts:406-444` — uses `RemoteFsActionTypes.PUT_REQUEST` symbolically |
| 12. Singleton-host bootstrap end-to-end | yes | `StereotypesPage.bootstrap.test.tsx:68-119` — first paint loading, GET=1, fixture text after resolution |
| 13. No `useState<boolean\|Error>` in new files; page only has allow-listed ephemeral UI | yes | `spec-grep-guards.test.ts:62-110` (9 sub-cases); manual grep confirms only `editingId` and `showCreate` at `StereotypesPage.tsx:30-31` |
| 14. Touched files typecheck | yes | `npx tsc --noEmit` filtered to touched files: 0 errors (verified) |
| 15. Test-file count +3 | deviation — orchestrator-authorized | 4 new files (baseline 24 → 28); test-results.md §15 documents rationale |
| 16. Lint not regressed | n/a | `.eslintrc.*` absent on main; same as baseline |
| 17. attempts.log appended | yes | trail in `.claude/work/166-stereotype-slice/attempts.log` |

## Framework verification

| Import | Verified | Notes |
|---|---|---|
| `@hamak/microkernel-spi` `PluginModule`, `InitializationContext` | yes | `plugin.d.ts:1-17` — confirms `InitializationContext.commands` is `{ register }` only; `ActivateContext.commands` is full `CommandRegistry` with `.run` |
| `@hamak/microkernel-api` `CommandRegistry`, `ActivateContext` | yes | `types.d.ts:5-9,57-58` — `.run(id, ...args)` exists, `.execute` does NOT (justifies orchestrator deviation #2) |
| `@hamak/ui-store-api` `STORE_MANAGER_TOKEN`, `STORE_EXTENSIONS_TOKEN`, `AUTOSAVE_REGISTRY_TOKEN`, `IStoreManager`, `FileSystemState`, `StoreExtensionsRegistry` | yes | `service-tokens.d.ts:5,8,9`; `store-manager.d.ts:9`; `extension-types.d.ts:29` |
| `@hamak/ui-store-impl` `StoreFileSystemFacade`, `FileSystemAdapter`, `AutosaveProviderRegistry`, `createAutosaveMiddleware` | yes | `fs/core/fs-facade.d.ts:17-26`; `fs/core/fs-adapter.d.ts:22-58` (mkdir is positional `(path, parents?, extensionStates?)`); `index.d.ts` re-exports all four |
| `@hamak/ui-remote-fs` `RemoteFsAutosaveProvider`, `PATH_TRANSLATOR_TOKEN`, `IPathTranslator` | yes | provider id='remote-fs', priority=10 confirmed in `remote-fs-autosave-provider.js`; Bug A in `supports()` verified — duck-typed `{ getSegments: () => path }` arg breaks `pathway.isAbsolute()` in `PathTranslator.toRemotePath` |
| `@hamak/ui-remote-fs/api` `RemoteFsActionTypes` (test import) | yes | `dist/api/types/remote-fs-action.types.d.ts:11-29` — `PUT_REQUEST = "[Remote FS] Put/Request"` |
| `@hamak/shared-utils` `FileNode`, `fileSystemNodeInitialState` | yes | `core-utils-filesystem.js:2-9` — `contentLoaded: contentPresent`, `contentLoadError: undefined`, `contentLoading: false` |
| In-house `notificationPlugin.ts` `(message: string)` signature | yes | `frontend/src/plugins/notification/notificationPlugin.ts:56-59` — confirms positional signature on main (justifies orchestrator deviation #1) |

## Out-of-scope additions

None. The diff touches exactly the files listed in the spec's "Files touched" section (plus the orchestrator-authorized 4th test file `spec-grep-guards.test.ts` and the orchestrator-authorized `vite.config.ts` test-block edit). No adjacent refactors, no "while I was here" changes.

The `.gitignore` and `.claude/agents/*.md` modifications shown in `git status` are orchestrator artifacts noted as pre-existing in dev-notes §3.3 and are excluded from the review per the prompt.

## Style/cookbook violations

None.

- **§1.5 ephemeral UI useState**: `StereotypesPage.tsx:30-31` keeps `useState<boolean>(false)` for `showCreate` and `useState<string | null>(null)` for `editingId`. Cookbook §1.5 explicitly permits.
- **§2 loading/error/dirty from node**: `StereotypesPage.tsx:51-52` reads `loading` and `loaded` from `file.state.*`, not `useState`. Cookbook-canonical form per cycle-3 spec acceptance #12.
- **Smart-vs-dumb separation**: `StereotypesPage.tsx` is a smart component (resolves service via DI hook). Card subcomponent `StereotypeCard` takes resolved props. Correct.
- **ui/ primitives**: page uses `Button`, `Chip`, `EmptyState`, `Modal`, `Toolbar` from `../components/ui` plus CSS variables (`var(--text)`, `var(--border)`, etc.). No DaisyUI, no hex. Matches the design-system memory rule.
- **Framework usage**: `ctx.commands.register` in init, `ctx.commands.run` in activate. Service resolved via `ctx.resolve(TOKEN)`. Reducer registration unchanged (framework `state.fs` slice auto-registered by `createStorePlugin`). No homegrown duplicates.
- **Multi-kind YAML / derived types / validation-constraint-rule trinity**: not applicable to this pilot (stereotypes are a single-kind sidecar at `.dico/stereotypes.yaml`, no entity attributes, no rules logic).
- **Workspace abstraction**: hardcoded `'dictionaries'` mount remains in `remoteFsPlugin.ts` — explicitly out of scope (spec §"Out of scope" line 976; coordinates with #169).
