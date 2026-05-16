# Spec review — #160: arch: replace hand-rolled version-control plugin with @hamak/ui-remote-git-fs  (cycle 1)

## Verdict
**rework**

The spec is well-researched and the framework citations are accurate. The Pattern B choice is correctly justified per cookbook §3b. However, the spec is **internally inconsistent in two places** that block implementation:

1. The CommandMap / register-count numbers conflict between sections (some places say +7, others +11). The dev cannot tell which to satisfy.
2. The `revert` story is contradictory: Files-touched says delete `version.routes.ts` and slim `versionService` to only `getWorkingTreeStatus`; AC #32 enforces removal of `revertToCommit`; but Risk #3 says keep `revertToCommit` AND add a new `publish.routes.ts` that wasn't listed in Files-touched. The backend `/api/revert` endpoint that `PublishService.revert` calls would not exist after the spec's deletions.

Both are fixable with edits to the spec, not framework or architectural escalations.

## Required changes (if rework)

1. **Resolve the command-count inconsistency.** Pick one number and use it everywhere:
   - Line 20: "Increment the documented exact-count from 19 to 26" — should be **30** (19 baseline + 7 git + 4 publish = 30).
   - Line 42: "bump the exact-counts from 19 commands → 26 (CommandMap total), `dataDictionaryPlugin.ts` register count 18 → 25" — should be **19→30** and **18→29**.
   - AC #36 already correctly says 30 and 29. Update lines 20 and 42 to match.

2. **Resolve the revert contradiction.** Pick one path:
   - **Path A (preferred per Risk #3 mitigation):** Keep `versionService.revertToCommit` for one release. Add a backend "Files touched — new" entry: `backend/src/routes/data-dictionary/publish.routes.ts` (one route: `POST /api/revert` calling `versionService.revertToCommit`). Add `router.use(publishRoutes)` to `backend/src/routes/data-dictionary/index.ts`. Adjust AC #32 to allow `revertToCommit` to remain (only assert `commitChanges` and `getCommitHistory` are gone). Adjust the `__mocks__/versionService.ts` slim-down to keep `revertToCommit`.
   - **Path B:** Truly drop revert from the migration scope — remove `PublishService.revert`, remove `data-dictionary.publish.revert` from the CommandMap and registrations (drops total from 11 to 10 new commands → 29 and 28), and document `CommitHistory.tsx`'s revert button as out-of-scope / removed-in-UI until the framework lands revert.

3. **Fix `gitApi.` grep guard for the JSDoc comment.** Acceptance #10 (`grep -cF 'gitApi.' frontend/src/ ... returns 0`) and AC #37 ("No file under `frontend/src/` contains the literal `gitApi.`") will both fail because `frontend/src/pages/HomePage.tsx:16` contains the JSDoc string `gitApi.getStatus()`. The migration MUST also strip the JSDoc comment line, OR the guard MUST exclude comments. Add to Files-touched > Modified for `HomePage.tsx`: "Update the JSDoc header comment on lines 13-20 to remove the `gitApi.getStatus()` reference."

4. **Fix the `grep -F` regex contradictions in AC #32 and #33.** `grep -cF "a\|b\|c"` searches for the literal string `a\|b\|c` (never matches). The spec acknowledges this in a parenthetical, but the AC text itself is unbuildable. Replace each `\|`-style AC with either:
   - Three separate `grep -cF` lines, each asserting `returns 0`, OR
   - One `grep -cE` line with `-E` (extended regex).
   Same edit applies to AC #33.

5. **Specify the spec-grep-guards test edit precisely.** Line 42 says "drop the `VERSION_CONTROL_PLUGIN` references AND bump the exact-counts." The `VERSION_CONTROL_PLUGIN` deletions are at lines 49, 234, and 235 (per the spec). The exact-count edits live at lines 122-127 (CommandMap count assertion of 19 → 30), lines 506-510 (per-plugin register count of 18 → 29), and the per-command iteration block at lines 129-156 / 186-205 (need to extend with the 11 new command-name strings, otherwise the new commands aren't covered by the existing exhaustive guard). Add this last point explicitly — without it, the new commands sit outside the spec-grep discipline.

6. **State the backend pre-condition for AC #34.** AC #34 says "Backend `npm test` passes (no other test references the deleted endpoints — verified by grep before this spec)." The integration test at lines 121-140 (`describe('Version Control', ...)`) is currently passing on baseline because of the `jest.mock('../../services/versionService')` at line 48 + the mock service in `__mocks__/versionService.ts`. After deleting the routes, the `POST /api/commit`, `GET /api/history`, `POST /api/revert` calls return 404 and tests fail. The spec already lists deletion of these test cases at line 49 — fine — but AC #34 needs to be re-ordered to run AFTER that deletion, not as a standalone post-condition. Make this explicit.

## Suggestions (optional, won't block)

- The framework's `HttpGitClient` is already wired under `GIT_CLIENT_TOKEN` and could be wrapped instead of running a fresh axios. The spec correctly chooses to skip this (justification at line 302: needs loose-shape handling + injection for tests). Keep the choice; consider a follow-up ticket to converge once response shapes are normalized backend-side.
- `gitApi` actually has **9** methods (createBranch and fetch in addition to the 7 the spec lists). The spec misses these in the count at line 5 ("8 methods"). Both are dead — verified by grep, no consumers — so deletion is still correct. Minor doc accuracy nit.
- The PublishService is registered via `useValue` (line 257) without going through `GIT_SERVICE_TOKEN` injection of its own — `git` is resolved by `dataDictionaryPlugin.initialize` from DI and passed by constructor. Make sure the spec is clear that `dataDictionaryPlugin.ts` now `dependsOn: [..., 'git']` (or 'remote-fs' transitively gates), otherwise `ctx.resolve(GIT_SERVICE_TOKEN)` at `initialize` time will throw if `git` plugin hasn't initialized yet. The current `data-dictionary` plugin manifest at `bootstrap.ts:108` reads `dependsOn: ['store', 'auth', 'store-fs']`. Spec doesn't update this dependsOn — implicit ordering risk. Recommend documenting the dependsOn update explicitly.
- Consider whether `PUBLISH_SERVICE_TOKEN` is actually used anywhere (line 257 registers it; line 270's `publish.revert` resolves the local `publish` variable, not the DI token). Token is dead weight unless a consumer outside `dataDictionaryPlugin.initialize` needs it. Either remove it from `tokens.ts` or document the future consumer.
- The framework's `createGitPlugin` calls `ctx.hooks.emit('ui-remote-git-fs:ready', ...)` on activate. The wrapper's `activate` only forwards to `framework.activate(ctx)` — fine — but no one in our codebase subscribes to that hook. Worth a sentence acknowledging this is acceptable in scope.

## Framework citation verification

| Cited path | Verified | Notes |
|---|---|---|
| `@hamak/ui-remote-git-fs/dist/impl/plugin/git-plugin-factory.d.ts:32` | ✅ | `createGitPlugin(config: GitPluginConfig): PluginModule` exists |
| `@hamak/ui-remote-git-fs/dist/impl/plugin/git-plugin-factory.js:36-151` | ✅ | Factory body matches spec's runtime description; only `GIT_CLIENT_TOKEN` and `GIT_PATH_TRANSLATOR_TOKEN` are registered at lines 76-77 |
| `@hamak/ui-remote-git-fs/dist/api/tokens.d.ts:5-9` and `tokens.js:5-9` | ✅ | All three tokens exported; `GIT_SERVICE_TOKEN` is a defined Symbol but never registered by the factory (confirmed) |
| `@hamak/ui-remote-git-fs/dist/spi/providers/i-git-client.d.ts:10-87` | ✅ | Surface verbatim: getStatus, listBranches, checkout, createBranch, stage, unstage, commit, pull, push, fetch, diff, log. **No revert, no merge** (confirmed) |
| `@hamak/ui-remote-git-fs/dist/impl/providers/http-git-client.d.ts:35-104` | ✅ (existence) | `HttpGitClient` class exists; spec correctly does NOT consume it directly |
| Hook event `ui-remote-git-fs:ready` (factory.js:138) | ✅ | Emitted on activate as claimed |
| Middleware registrations `git-ops` (priority 40) + `git-sync` (priority 30) | ✅ | factory.js:117-135 matches |
| `@hamak/shared-utils` `Pathway.ofRoot().resolve(...)` | ✅ | Exists at `dist/core-utils-pathway.d.ts`; already used by `remoteGitPlugin.ts:15` |
| Framework backend `/:workspaceId/log/*` endpoint | ✅ | `backend/node_modules/@hamak/ui-remote-git-fs-backend/dist/routes/git-routes.js:165` — `gitService.log(...)` mounted under `GET /:workspaceId/log/*` |
| Framework backend lack of revert/merge | ✅ | No `revert` or `merge` handlers in `git-routes.js` or `git-service.js` |
| `backend/src/routes/project.routes.ts:63-64` keep `versionService.getWorkingTreeStatus` | ✅ | Confirmed; this is the only other consumer |
| `frontend/src/plugins/data-dictionary/dataDictionaryPlugin.ts` 18 register calls | ✅ | `grep -c` returns 18 — baseline count is accurate |
| `frontend/src/kernel/commands.ts` 19 CommandMap entries | ✅ | Baseline 19 confirmed |
| `gitApi.` call-sites (5 component files + HomePage JSDoc comment) | ✅ with caveat | All five consumers (GitStatusIndicator, SavePublishPage, WorkspacesPage, MergePage, HomePage) confirmed. Additional: the JSDoc comment on `HomePage.tsx:16` matches `grep -F 'gitApi.'` and will fail AC #10 unless updated — see Required change #3 |
| `versionApi.` call-sites (CommitHistory, CommitChanges, SavePublishPage, LogicalDiffPage, versionSlice) | ✅ | All four consumer files + versionSlice confirmed; spec's deletion plan is exhaustive |
| Baseline `spec-grep-guards.commands.test.ts` passes | ✅ | 97/97 tests pass on baseline (verified by running) |
| No other plugin lists `'remote-git'` in `dependsOn` | ✅ | grep confirms only `bootstrap.ts:149` references it |
| Backend `version.routes.ts` only registered consumer in `data-dictionary/index.ts:13,31` | ✅ | Single insertion; clean removal |

## Risk reassessment

The spec's enumerated risks 1-5 are real and bounded. Adding three from my review:

- **R6 (new):** `data-dictionary` plugin's `initialize` resolves `GIT_SERVICE_TOKEN` synchronously. If the `git` plugin initializes after `data-dictionary` because `dependsOn` doesn't list it, the resolve fails at boot. Plugin ordering: `data-dictionary` currently has `dependsOn: ['store', 'auth', 'store-fs']`. Spec's bootstrap diff registers `git` with `dependsOn: ['store', 'remote-fs']` — there's no transitive guarantee that `git` initializes before `data-dictionary`. **Mitigation:** add `'git'` to `data-dictionary`'s `dependsOn`. Spec needs to call this out.
- **R7 (new):** `PublishService.revert` calls a backend `/api/revert` endpoint that ceases to exist under the spec's Files-touched plan. UI revert button breaks at runtime. Same root cause as Required change #2; folded in there.
- **R8 (new):** `spec-grep-guards.commands.test.ts` has an exhaustive per-name iteration (lines 129-156 and 186-205) — if the new commands aren't added to those lists, they remain outside the discipline. Spec's "Tests modified" section says bump the counts but doesn't explicitly add the new strings to the per-name list. Folded into Required change #5.

The spec's R1 (token collision) mitigation is sound: JS Symbols are uniquely identified by Symbol identity, not by debug name. Two `Symbol('GitService')` calls produce two different tokens. Confirmed.

The spec's R4 (capability gating gap) is correctly deferred. The 2026-05-15 ticket comment is explicit about this being post-#168.

## Cross-ticket conflicts

- **#164 (MetadataValue widening):** No overlap. Skimmed; touches only `MetadataValue` types and the metadata-type registry, no git surface.
- **#157 (backend route split):** Already merged; `version.routes.ts` exists where the spec expects. No conflict.
- **#163 (typed commands):** Already merged; CommandMap and useCommand exist. Spec correctly extends the surface.
- **#155 catalog (DI services):** Already merged; Pattern B precedent (IntegrityService) is the cited template. Consistent.
- **#168 (capability gating) and #167 (raw/logical workspaces):** Forward-coordinations correctly captured as Out of Scope.
- **Cookbook §3b:** Spec's Pattern B choice and `GitService` shape match the IntegrityService template. ✅
- **CLAUDE.md three-concept governance:** Not touched; no "git rules" concept introduced. ✅
- **Naming convention (#163):** `data-dictionary.git.<verb>` and `data-dictionary.publish.<verb>` follow the established `<plugin>.<service>.<verb>` pattern. ✅
- **No conflict with multi-kind YAML semantics (#106) or the validation/constraint/rule trinity (#85).** ✅
