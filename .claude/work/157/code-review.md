# Code review — #157: arch: split backend routes/index.ts by feature domain  (cycle 1)

## Verdict
**approve**

## Required changes
None.

## Suggestions (optional, won't block)

1. `ai/index.ts` swallows ALL failures in the `try` block, not just `aiController` import failures. In the original god-file, the catch wrapped only the `aiController` dynamic import. In the refactored version, a bug in `chat.routes.ts`, `conversation.routes.ts`, or `prompt.routes.ts` (e.g., a typo in a route path triggering an Express assertion at registration time) will be silently swallowed because the `router.use(...)` calls also live inside the try block. Pre-existing behavior is roughly equivalent (the original had `router.<verb>` calls inside the same try), so this is not a regression — but a comment narrowing intent (or splitting the try around the imports vs. registration) would prevent silent-failure mode in future contributors. Non-blocking.

2. `ai/chat.routes.ts`, `ai/conversation.routes.ts`, `ai/prompt.routes.ts` use **static** `import` from `../../controllers/aiController.js`. The original god-file used dynamic `await import(...)` of aiController inside the IIFE specifically to avoid loading the module synchronously at app boot when AI deps are missing. The refactor still achieves graceful degradation because the dynamic `import('./chat.routes.js')` in `ai/index.ts` defers evaluation of those static imports until the dynamic import runs — so the failure mode is preserved. The dev-notes anticipate this (line 71). Documenting this load-order contract in a JSDoc on each leaf would help future maintainers. Non-blocking.

3. `data-dictionary/case.routes.ts` line 28: the query-handling `req.url.includes('?')` check is verbatim from the original. The current behavior preserves the query string after the 308. Solid; no action.

## Acceptance-criterion coverage

| Criterion | Implemented | Notes |
|---|---|---|
| 1. Aggregator size < 50 lines | yes | `wc -l backend/src/routes/index.ts` = 18 |
| 2. Folder layout (23 files) | yes | `find … -name '*.ts' \| sort` matches spec list exactly |
| 3. Total route count 115 verb + 1 router.all | yes | per-file grep sums to 115; case.routes.ts has 1 router.all |
| 4. Per-file route counts | yes | every file matches the spec table (see verification below) |
| 5. No test regressions | yes | 17 failed / 367 passed / 3 of 32 suites failed; baseline was 17/362/3 → +5 new tests, all pass |
| 6. 5 new ordering assertions | yes | all 5 in `Route ordering after split` describe; integration suite runs 18 passed (was 13) |
| 7. authorizeJwt count = 47 | yes | post-split sum = pre-split `main` count = 47; full decoration list is byte-identical |
| 8. Swagger glob widened | yes | `backend/src/utils/swagger.ts:337` reads `'./src/routes/**/*.ts'`; no `@swagger` annotations exist on `main` so output unchanged |
| 9. No new dependencies | yes | `git diff main..HEAD -- backend/package.json backend/package-lock.json` is empty |
| 10. No `@hamak/microkernel-*` import | yes | `grep -rE "@hamak/microkernel" backend/src/routes/` returns nothing; also empty across `backend/src/` |
| 11. Deferred AI-import preserved | yes | `(async () => { try { ... } catch { ... } })()` IIFE in `ai/index.ts` |

## Verification of per-file route counts (spot-checked all 20 files)

| File | Spec expects | Actual `router.<verb>(` count | Match |
|---|---|---|---|
| `auth.routes.ts` | 2 | 2 | yes |
| `search.routes.ts` | 2 | 2 | yes |
| `visualization.routes.ts` | 8 | 8 (5 diagrams + graph + impact + lineage) | yes |
| `status.routes.ts` | 1 | 1 | yes |
| `project.routes.ts` | 6 | 6 | yes |
| `data-dictionary/package.routes.ts` | 12 | 12 (3 literals + 5 packages + 4 dictionaries) | yes |
| `data-dictionary/entity.routes.ts` | 16 | 16 (2 legacy + saveEntity + getEntityHierarchy + 12 services) | yes |
| `data-dictionary/relationship.routes.ts` | 4 | 4 | yes |
| `data-dictionary/stereotype.routes.ts` | 5 | 5 | yes |
| `data-dictionary/case.routes.ts` | 8 (+1 router.all) | 8 + 1 router.all | yes |
| `data-dictionary/rule.routes.ts` | 6 | 6 (5 rules + 1 cross-boundary entities/:entityUuid/rules) | yes |
| `data-dictionary/integrity.routes.ts` | 1 | 1 | yes |
| `data-dictionary/model-metadata.routes.ts` | 2 | 2 | yes |
| `data-dictionary/dico-config.routes.ts` | 2 | 2 | yes |
| `data-dictionary/diff.routes.ts` | 10 | 10 | yes |
| `data-dictionary/import-export.routes.ts` | 10 | 10 | yes |
| `data-dictionary/version.routes.ts` | 3 | 3 | yes |
| `ai/chat.routes.ts` | 7 | 7 | yes |
| `ai/conversation.routes.ts` | 5 | 5 | yes |
| `ai/prompt.routes.ts` | 5 | 5 | yes |
| **Total verb** | **115** | **115** | yes |

## Verification of path-name fidelity (no ticket-prose renames)

| Path | Used in code | Ticket-prose alternative (NOT used) |
|---|---|---|
| `/api/integrity` | `integrity.routes.ts:6` | `/api/integrity-report` (rejected, current code wins) |
| `/api/config/types` | `dico-config.routes.ts:8-9` | `/api/derived-types` (rejected) |
| `/api/diff/logical`, `/api/diff/physical`, `/api/diff/impact` | `diff.routes.ts:19-21` | `/api/logical-diff` etc (rejected) |

`grep -rE "integrity-report\|derived-types\|logical-diff\|physical-diff\|impact-diff" backend/src/routes/` returns empty. No drift.

## Verification of auth-middleware preservation

`grep -hE "authorizeJwt" $(find backend/src/routes -name '*.ts') | sort` produces an identical sorted list to `git show main:backend/src/routes/index.ts | grep -E "authorizeJwt" | sort` for the 47 route registrations (verbatim path, verb, role-array, handler). Auth policy drift = none.

## Verification of route ordering

- **Aggregator mount order** (`backend/src/routes/index.ts:11-17`): status → auth → search → visualization → project → data-dictionary → ai. Matches spec signature exactly.
- `/api/entities/flat` lives in `search.routes.ts` (mounted at L13), before `data-dictionary` (L16) where `/api/entities/:uuid/impact` and `/api/entities/:microservice/...` live. Express will hit search first. Confirmed by integration test (`GET /api/entities/flat` → not 404).
- **data-dictionary sub-aggregator** (`data-dictionary/index.ts:20-31`): packageRoutes mounted FIRST, then relationship, then entity. Inside `package.routes.ts` the literals `/api/packages/all`, `/api/packages/hierarchy/:rootPackage`, `/api/packages/tabular/:rootPackage` are declared before `/api/packages/:rootPackage/path/*`. Confirmed by integration tests.
- `router.all('/api/perspectives*', ...)` is in `case.routes.ts:26-30`. No router elsewhere handles `/api/perspectives`. Integration test confirms 308 + `Location: /api/cases/foo`.

## Verification of project.routes.ts (the 6 inline handlers)

`/api/filesystem/browse`, `/api/project`, `/api/project/status`, `/api/project/open`, `/api/project/close`, `/api/project/init` — all 6 handlers in `project.routes.ts` lines 18-147 are byte-for-byte identical to the originals in `git show main:backend/src/routes/index.ts:189-321` (verified by side-by-side read). The same `authorizeJwt([UserRole.ADMIN])` decorations on the 3 mutating routes, same `(req.app as any).__workspaceRoots` casts, same `await import('../services/versionService.js')` dynamic import in status, same `endsWith('data-dictionaries')` semantics in init. No drift.

## Verification of deferred-import IIFE

The original god-file (lines 345-371) wraps `await import('../controllers/aiController.js')` in a try/catch IIFE. The new `ai/index.ts` (lines 8-19) wraps three dynamic imports of leaf route files. Because the leaf files use `import { aiChat, ... } from '../../controllers/aiController.js'` at module top-level, a failure to load `aiController` will propagate up through the dynamic import promise rejection and be caught. Failure modes match the original. Boot does not crash if `aiController` deps are unavailable.

## Out-of-scope additions

None. All 25 changed files are in `backend/src/routes/`, `backend/src/utils/swagger.ts` (the documented one-char widening), or `backend/src/__tests__/integration/api.test.ts` (the documented 5 new assertions).

## Style/cookbook violations

None. The cookbook addresses the frontend plugin architecture; this is a backend Express refactor with explicit ADR-0001 directive to stay plain Express. The refactor adheres exactly: no `@hamak/microkernel*`, no DI, no `Host`, pure `Router.use()` composition.

## Test/build verification (re-run by reviewer)

- `cd backend && npm test 2>&1 | tail -3`: `Test Suites: 3 failed, 29 passed, 32 total / Tests: 17 failed, 367 passed, 384 total` — matches dev-notes baseline+5.
- `cd backend && npm test -- --testPathPattern='integration/api'`: 18 passed (13 original + 5 new ordering assertions all pass).
- `cd backend && npm run build 2>&1 | grep -cE "error TS"`: 14 — unchanged from baseline.
- `git diff main..HEAD --stat`: 25 files changed, all in scope.
- `grep -rE "@hamak/microkernel" backend/src/`: 0 matches.

The work is correct, complete, and consistent with the spec.
