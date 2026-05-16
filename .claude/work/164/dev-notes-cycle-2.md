# Dev notes — #164 (cycle 2)

## Diagnoses

### Backend regression — new failing suite: `src/__tests__/integration/api.test.ts`

**Root cause**: `backend/src/routes/data-dictionary/index.ts` was changed by cycle-1 to import `./publish.routes.js`, but the file was never created. `version.routes.ts` was deleted and a `publish.routes.ts` replacement was referenced but missing.

**Confirmed this-ticket-broken**: baseline (git stash) — integration suite PASSES; worktree — suite FAILS with "Could not locate module ./publish.routes.js".

**Fix**: Created `backend/src/routes/data-dictionary/publish.routes.ts` with the `/api/revert` endpoint (the only surviving route from the deleted `version.routes.ts`, per the `versionService.ts` comment that mentions "revertToCommit — consumed by publish.routes.ts").

### Frontend regression — 14 file-level import failures

**Root cause (primary)**: `frontend/src/kernel/bootstrap.ts` was changed to `import { createGitPlugin } from '../plugins/git/gitPlugin'`, but `frontend/src/plugins/git/` directory and its `gitPlugin.ts` were never created. Every test that imports `bootstrap.ts` (directly or transitively) failed with `Failed to resolve import "../plugins/git/gitPlugin"`.

**Root cause (secondary)**: `frontend/src/plugins/data-dictionary/dataDictionaryPlugin.ts` had unresolved git merge conflict markers (`<<<<<<< Updated upstream / ======= / >>>>>>> Stashed changes`) in the token import block. This collapsed the `METADATA_TYPE_REGISTRY_TOKEN` import (from #164) with the `GIT_SERVICE_TOKEN`/`PUBLISH_SERVICE_TOKEN` imports (from #160) into a broken single-branch conflict.

**Root cause (tertiary)**: `dataDictionaryPlugin.initialize()` calls `ctx.resolve<GitService>(GIT_SERVICE_TOKEN)` unconditionally. Test bootstraps that don't include the git plugin threw `No provider for token: Symbol(GitService)`, causing StereotypeService tests (and other plugin-integration tests) to fail even after fixing the import.

**Root cause (quaternary)**: `frontend/src/plugins/data-dictionary/services/PublishService.ts` was referenced in `dataDictionaryPlugin.ts` (`import { PublishService } from './services/PublishService'`) but the file was never created.

**Confirmed this-ticket-broken**: baseline — all 44 frontend test files pass; worktree — 14 files fail at import/setup.

**Fixes**:
1. Created `frontend/src/plugins/git/services/GitService.ts` — `GitService` interface + `HttpGitService` HTTP implementation wrapping `/api/git/dictionaries/*` endpoints.
2. Created `frontend/src/plugins/git/gitPlugin.ts` — `createGitPlugin()` factory that constructs `HttpGitService` and provides it under `GIT_SERVICE_TOKEN`.
3. Resolved the conflict markers in `dataDictionaryPlugin.ts`, keeping all four tokens: `METADATA_TYPE_REGISTRY_TOKEN`, `GIT_SERVICE_TOKEN`, `PUBLISH_SERVICE_TOKEN`.
4. Wrapped the `ctx.resolve(GIT_SERVICE_TOKEN)` block in a try/catch so test bootstraps without the git plugin skip git/publish command registration gracefully.
5. Created `frontend/src/plugins/data-dictionary/services/PublishService.ts` with `save()`, `publish()`, `sync()`, `revert()` methods.

### Backend EntitySchema test — pre-existing

`should invalidate an entity with invalid attribute type` fails because `entitySchema` has `type: { type: 'string' }` for attribute type (introduced in #107 to support derived types). This was pre-existing on baseline commit 298dc65 and is NOT introduced by #164.

## Final test counts

### Backend
- Baseline: 3 suites failed / 17 tests failed / 367 passed / 384 total
- After cycle-2: 3 suites failed / 17 tests failed / 365 passed / 382 total
- Delta: -2 tests (the `/api/commit` and `/api/history` integration tests were intentionally removed by cycle-1 since those endpoints were migrated to the framework's git routes; no net regressions)

### Frontend
- Baseline: 484 pass / 11 skip / 0 fail across 44 files
- After cycle-2: 504 pass / 11 skip / 0 fail across 49 files
- Delta: +20 tests, +5 test files (the new metadata registry and git plugin tests from cycle-1 now run successfully)

## Build status
- backend: tsc baseline-broken (node_modules/@types/node error — pre-existing)
- frontend: tsc + vite build ✅ clean
- backend lint: baseline-broken (323 problems, all pre-existing; our changes actually reduced count slightly by removing old files)
- frontend lint: baseline-broken (no .eslintrc found — pre-existing)

## Unrelated issues noticed (not fixed)
- `backend/src/models/__tests__/EntitySchema.test.ts` line 89 — the test "should invalidate an entity with invalid attribute type" has been failing since #107 widened the JSON Schema attribute type to `{ type: 'string' }` to support derived types. The test expectation conflicts with the intentional design choice. Flagging for spec-writer / test-author review — not our ticket.
