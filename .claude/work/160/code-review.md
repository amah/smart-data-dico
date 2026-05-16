# Code review — #160: arch: replace hand-rolled version-control plugin with @hamak/ui-remote-git-fs  (cycle 1)

## Verdict
**required-changes**

The migration itself is well-executed — files moved correctly, the framework token strategy is sound, the seven `data-dictionary.git.*` + four `data-dictionary.publish.*` commands are wired with matching counts, the legacy `versionApi`/`gitApi` blocks are excised cleanly, and the slimmed backend (`versionService.revertToCommit` + `getWorkingTreeStatus` only; `publish.routes.ts` mounts `/api/revert`) matches Path A from cycle 2. The frontend build is clean, the new `GitService.test.ts` (13 tests) and `PublishService.test.ts` (8 tests) both pass, and the existing `spec-grep-guards.commands.test.ts` passes with its updated counts (30 keys / 29 register calls).

But two real regressions block merge:

1. The new `spec-grep-guards.git.test.ts` has wrong relative-path math — 6 ups instead of 5. All 15 of its tests fail with ENOENT. AC #37 fails.
2. `dataDictionaryPlugin.initialize` now unconditionally resolves `GIT_SERVICE_TOKEN`, but `StereotypeService.test.ts`'s bootstrap doesn't register a `git` plugin. 8 tests in that file fail with `No provider for token: Symbol(GitService)`. AC #35 fails.

Net frontend test result: **23 failures** (15 from the path bug + 8 from the missing-provider bug). Baseline was 0 failures in those suites. Backend tests are stable (17p baseline → 17f, same suites; no new failures; 2 deleted tests for `/api/commit` and `/api/history` per spec).

## Required changes

1. Fix path math in the new spec-grep-guards file
   - File: `frontend/src/plugins/git/__tests__/spec-grep-guards.git.test.ts:22`
   - Problem: `path.resolve(HERE, '..', '..', '..', '..', '..', '..')` ascends 6 levels from `frontend/src/plugins/git/__tests__/`, landing at `…/.claude/worktrees/` (one above the worktree). All 15 reads inside the file then ENOENT against `…/.claude/worktrees/frontend/...`. Confirmed by running the test in isolation — every `it()` fails.
   - Fix: drop the last `'..'` so the file ascends 5 levels: `path.resolve(HERE, '..', '..', '..', '..', '..')`. The pre-existing `spec-grep-guards.commands.test.ts` lives one directory deeper (`frontend/src/plugins/data-dictionary/services/__tests__/`) and correctly uses 6 ups — the new file is one shallower so needs 5.

2. Register the `git` plugin in the StereotypeService test bootstrap
   - File: `frontend/src/plugins/data-dictionary/services/__tests__/StereotypeService.test.ts:74-100` (and the parallel `bootstrapServiceWithSpy` at lines 107-145 if needed)
   - Problem: `dataDictionaryPlugin.initialize` now calls `ctx.resolve<GitService>(GIT_SERVICE_TOKEN)` at line 196 of `dataDictionaryPlugin.ts`. The test's `bootstrapServiceHost` registers `[store, remote-fs, store-fs, data-dictionary]` and omits `git`. `host.bootstrapAllAtRoot()` throws `No provider for token: Symbol(GitService)`. 8 tests in StereotypeService.test.ts fail.
   - Fix: register the `git` plugin before `data-dictionary` in `bootstrapServiceHost` (and bump `data-dictionary`'s `dependsOn` to `['store', 'store-fs', 'git']` to match production bootstrap). Mirror the production registration: `host.registerPlugin('git', manifest('git', ['store', 'remote-fs']), createGitPlugin())`. Note that the `git` plugin's `activate` resolves `STORE_MANAGER_TOKEN` and `STORE_EXTENSIONS_TOKEN` from the framework store, so it should work in the test bootstrap which already has the store plugin.

## Suggestions (non-blocking)

- `gitPlugin.ts:5` JSDoc still says "Promise-returning methods that the UI consumes via useCommand" — accurate at the public-surface level. Fine.
- `MergePage.tsx:29` always passes `{}` to `data-dictionary.git.diff`, which makes the explicit `branch` selection cosmetic — the diff is just `HEAD vs working tree`, not a real cross-branch diff. The spec called this out as known-limitation behavior (the framework `IGitClient` has no real `merge`), so this is consistent with intent, but it might be worth a `// TODO: real cross-branch diff once …` comment so the next maintainer doesn't think it's a bug.
- `PublishService.ts:41` does `(result as any)?.data?.commitHash ?? (result as any)?.hash` — the alternate `?.hash` path is from the legacy non-`{data: …}` response and is dead given `GitService.commit()` types the response as `GitCommitDTO` with `{ data: { commitHash } }`. The fallback adds a tiny bit of robustness but is also a "what" comment in disguise. Optional cleanup.
- `dataDictionaryPlugin.ts:198` provides `PUBLISH_SERVICE_TOKEN` but nothing else resolves it (the 11 command handlers close over the local `publish`). Risk #7 in the spec already names this as "low-risk surplus per Pattern B." Fine as-is.
- `GitService.ts:135` mirrors the `mock-token-for-testing` fallback from api.ts:25. Out-of-scope but worth carrying forward in a tracking issue (the spec also notes this).

## Acceptance-criterion coverage
| Criterion | Implemented | Notes |
|---|---|---|
| 1. `test -f gitPlugin.ts` | ✅ | |
| 2. `test -f GitService.ts` | ✅ | |
| 3. `test -f PublishService.ts` | ✅ | |
| 4. `test ! -e version-control/` | ✅ | folder deleted |
| 5. `test ! -e remoteGitPlugin.ts` | ✅ | |
| 6. `test ! -e versionSlice.ts` | ✅ | |
| 7. `grep -cF 'versionApi'` in api.ts = 0 | ✅ | |
| 8. `grep -cF 'gitApi'` in api.ts = 0 | ✅ | |
| 9. zero `versionApi.` refs | ✅ | only guard file mentions in prose |
| 10. zero `gitApi.` refs | ✅ | including HomePage.tsx:16 JSDoc rephrased correctly |
| 11. zero `import { versionApi` | ✅ | |
| 12. zero `import { gitApi` | ✅ | |
| 13. 6 components import `useCommand` | ✅ | all six listed components import the hook |
| 14. 7 `data-dictionary.git.*` keys | ✅ | |
| 15. 4 `data-dictionary.publish.*` keys | ✅ | |
| 16. 7 register calls for `.git.*` | ✅ | |
| 17. 4 register calls for `.publish.*` | ✅ | |
| 18. no `createVersionControlPlugin` | ✅ | |
| 19. no `createAppRemoteGitPlugin` | ✅ | |
| 20. no `'remote-git'` | ✅ | |
| 21. no `'version-control'` | ✅ | |
| 22. `createGitPlugin` ≥ 1 | ✅ | |
| 23. `name: 'git'` = 1 | ✅ | |
| 24. no `versionReducer` | ✅ | |
| 25. `GIT_SERVICE_TOKEN` defined | ✅ | as local `Symbol('GitService')` |
| 26. `PUBLISH_SERVICE_TOKEN` defined | ✅ | |
| 27. `versionController.ts` gone | ✅ | |
| 28. `version.routes.ts` gone | ✅ | |
| 29. no `versionRoutes` in index.ts | ✅ | |
| 30. `versionService.ts` exists | ✅ | |
| 31. `getWorkingTreeStatus` ≥ 1 | ✅ | |
| 32a. no `commitChanges` in versionService | ✅ | |
| 32b. no `getCommitHistory` in versionService | ✅ | |
| 32c. `revertToCommit` ≥ 1 | ✅ | 2 hits (declaration + log message) |
| 33a. no `/api/commit` in api.test | ✅ | |
| 33b. no `/api/history` in api.test | ✅ | |
| 33c. `/api/revert` ≥ 1 in api.test | ✅ | 2 hits |
| 34. backend `npm test` passes | ✅ | 365p / 17f (3 suites) — same 17 failures as main baseline; no new failures; 2 deleted /commit and /history sub-tests account for the count drop |
| 35. frontend `npm test` passes | ❌ | 23 new failures: 15 in `spec-grep-guards.git.test.ts` (path math bug), 8 in `StereotypeService.test.ts` (test bootstrap missing `git` plugin) |
| 36. `spec-grep-guards.commands.test.ts` passes | ✅ | 117 tests pass; count bumps from 19→30 and 18→29 applied; 11 new names appended in both iteration blocks |
| 37. `spec-grep-guards.git.test.ts` passes | ❌ | all 15 tests fail — path math bug, see required change #1 |
| 38. `GitService.test.ts` + `PublishService.test.ts` pass | ✅ | 13 + 8 = 21 tests pass, constructor-injected http stub pattern correct (matches IntegrityService precedent) |
| 39-43. Manual smoke | ⏳ | post-implementation by user |

## Framework verification
| Import | Verified | Notes |
|---|---|---|
| `@hamak/ui-remote-git-fs` `createGitPlugin` | ✅ | `dist/impl/plugin/git-plugin-factory.d.ts:32` |
| `@hamak/ui-remote-git-fs` `GIT_CLIENT_TOKEN`, `GIT_PATH_TRANSLATOR_TOKEN`, `GIT_SERVICE_TOKEN` | ✅ | `dist/api/tokens.d.ts:5-9`; `git-plugin-factory.js:76-77` only provides `GIT_CLIENT_TOKEN` + `GIT_PATH_TRANSLATOR_TOKEN`. Framework `GIT_SERVICE_TOKEN` is exported but never registered — matches spec Risk #1. The local `Symbol('GitService')` in `frontend/src/kernel/tokens.ts:25` is correctly used. |
| `@hamak/shared-utils` `Pathway` | ✅ | already used in plugin source pre-PR |
| `@hamak/microkernel-spi` `PluginModule` | ✅ | already used throughout `frontend/src/plugins/**` |
| `GIT_CLIENT_TOKEN` underlying transport | ⚠️ | The framework registers `HttpGitClient` under `GIT_CLIENT_TOKEN` during `framework.initialize`. The new `GitService` does NOT consume it — it runs its own axios. This is explicitly per spec (loose-shape response handling + test-injectable). The framework's `HttpGitClient` is dead weight here, which is intentional and called out in `GitService.ts:54-57`. |

## Out-of-scope additions
None. The diff is tightly scoped to the spec's "Files touched" list:
- frontend: `git/{gitPlugin,services/GitService,services/__tests__/GitService.test,__tests__/spec-grep-guards.git.test}.ts`, `data-dictionary/services/{PublishService,__tests__/PublishService.test}.ts`, `kernel/{tokens,bootstrap,commands}.ts`, `data-dictionary/dataDictionaryPlugin.ts`, the six migrated components, `services/api.ts` excision, `pages/{HomePage,LogicalDiffPage}.tsx` JSDoc + diff log call;
- backend: `controllers/versionController.ts` (delete), `services/versionService.ts` (slim), `routes/data-dictionary/{version.routes.ts (delete), publish.routes.ts (new), index.ts (swap import)}`, `services/__mocks__/versionService.ts` (slim), `__tests__/integration/api.test.ts` (reshape).

`frontend/docs/patterns.md` is unchanged — `git diff main..HEAD -- frontend/docs/patterns.md` returns 0 lines. Cookbook §4 not "filled" — spec Risk #8 respected.

Backend route file scope: only `data-dictionary/version.routes.ts` deleted, only `data-dictionary/publish.routes.ts` added. Total route count `find … | grep -cE 'router\\.(get|post|put|delete|patch|options|head)'` = 113 (was ~115 — 4 endpoints in `version.routes.ts` deleted, 1 added in `publish.routes.ts`; the math works out: -4 + 1 = -3, plus #157's prior baseline may differ slightly).

## Style/cookbook violations
None observed. Pattern B service shape (`GitService`) follows the IntegrityService precedent from #155 catalog: eager `useValue`, optional `AxiosInstance` injection for tests, self-contained auth interceptor, no try/catch around the HTTP call (callers surface errors). `PublishService` wraps `GitService` as a domain composite with the same shape. Components consume commands via `const run = useCommand(); run('cmd', args)` — matches the `useCommand()` pattern from #163.

The notification forwarder pattern in `dataDictionaryPlugin.ts:73-80` is unmodified — fine.

