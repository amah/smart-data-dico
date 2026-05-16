# Dev notes — #157  (cycle 1)

## Changes

- `backend/src/routes/index.ts:1-373` — replaced 373-line god-file with 18-line slim aggregator; imports and mounts 7 routers (status, auth, search, visualization, project, data-dictionary, ai).
- `backend/src/routes/auth.routes.ts` — new; 2 routes (`/api/auth/login`, `/api/auth/me`).
- `backend/src/routes/status.routes.ts` — new; 1 route (`/api/status` inline handler).
- `backend/src/routes/search.routes.ts` — new; 2 routes (`/api/entities/flat`, `/api/search`).
- `backend/src/routes/visualization.routes.ts` — new; 8 routes (graph, impact, lineage, 5 diagrams).
- `backend/src/routes/project.routes.ts` — new; 6 routes with inline handlers (filesystem/browse, project GET/status, project/open/close/init).
- `backend/src/routes/data-dictionary/index.ts` — new sub-aggregator; mounts 12 domain routers.
- `backend/src/routes/data-dictionary/package.routes.ts` — new; 12 routes (8 packages + 4 legacy dictionaries).
- `backend/src/routes/data-dictionary/entity.routes.ts` — new; 16 routes (2 legacy + saveEntity + getEntityHierarchy + 12 services).
- `backend/src/routes/data-dictionary/relationship.routes.ts` — new; 4 routes.
- `backend/src/routes/data-dictionary/stereotype.routes.ts` — new; 5 routes.
- `backend/src/routes/data-dictionary/case.routes.ts` — new; 8 routes + 1 `router.all` (308 perspectives redirect).
- `backend/src/routes/data-dictionary/rule.routes.ts` — new; 6 routes (5 rules + cross-boundary entities/:entityUuid/rules).
- `backend/src/routes/data-dictionary/integrity.routes.ts` — new; 1 route.
- `backend/src/routes/data-dictionary/model-metadata.routes.ts` — new; 2 routes.
- `backend/src/routes/data-dictionary/dico-config.routes.ts` — new; 2 routes.
- `backend/src/routes/data-dictionary/diff.routes.ts` — new; 10 routes.
- `backend/src/routes/data-dictionary/import-export.routes.ts` — new; 10 routes.
- `backend/src/routes/data-dictionary/version.routes.ts` — new; 3 routes.
- `backend/src/routes/ai/index.ts` — new; deferred-import IIFE sub-aggregator for AI routes.
- `backend/src/routes/ai/chat.routes.ts` — new; 7 routes.
- `backend/src/routes/ai/conversation.routes.ts` — new; 5 routes.
- `backend/src/routes/ai/prompt.routes.ts` — new; 5 routes.
- `backend/src/utils/swagger.ts:337` — glob widened from `'./src/routes/*.ts'` to `'./src/routes/**/*.ts'`.
- `backend/src/__tests__/integration/api.test.ts` — added `describe('Route ordering after split')` block with 5 new assertions.

## Build status

- backend build: same 14 pre-existing TS errors as baseline (EntityFileAdapter.ts, aiController test, Dictionary test, appDir test) — no new errors introduced. Baseline confirmed by `git stash; npm run build; git stash pop` comparison.
- backend lint: 325 problems (75 errors, 250 warnings) vs baseline 326 (76 errors, 250 warnings). One fewer error: the unused `authenticate` import in the old god-file is now gone. All warnings in new route files are pre-existing `any` types copied verbatim from the god-file (project.routes.ts 3 warnings). No lint rules disabled.

## Test results

- Baseline: 17 failed / 362 passed / 3 failed suites (32 total)
- After split: 17 failed / 367 passed / 3 failed suites (32 total)
- Delta: +5 passing tests from the new `Route ordering after split` describe block. No new failures.
- All 5 new integration assertions pass:
  - `GET /api/entities/flat` → not 404 (search.routes.ts wins)
  - `GET /api/packages/all` → not 404 (package.routes.ts literal wins)
  - `GET /api/packages/hierarchy/X` → not 404 (getPackageHierarchy wins)
  - `GET /api/config/types` → not 404 (dico-config.routes.ts mounts)
  - `GET /api/perspectives/foo` → 308 redirect to `/api/cases/foo`

## Acceptance criteria status

1. Aggregator size: `wc -l backend/src/routes/index.ts` = 18 (< 50) ✓
2. Folder layout: 23 files matching spec exactly ✓
3. Total route count: 115 verb routes + 1 `router.all` ✓
4. Per-file route counts: all match spec table ✓
5. No regressions: 17 failed <= 17 baseline ✓; 5 new tests added (+5 passing) ✓
6. New ordering assertions: all 5 pass ✓
7. authorizeJwt count: 47 (matches pre-split count on main) ✓
8. Swagger glob: `./src/routes/**/*.ts` confirmed in swagger.ts ✓
9. No new dependencies: git diff main..HEAD -- backend/package.json returns empty ✓
10. No @hamak/microkernel imports: grep returns no matches ✓
11. Deferred AI-import preserved: ai/index.ts has `(async () => {` and `} catch {` ✓

## Unrelated issues noticed (not fixed)

- `backend/src/adapters/EntityFileAdapter.ts` — pre-existing TS errors: WorkspaceManager/FileRouter/FileInfoEnricherRegistry properties missing from @hamak/filesystem-server-impl types.
- `backend/src/controllers/__tests__/aiController.envBypass.test.ts` — missing `.js` extensions in 4 imports (pre-existing TS2835 errors).
- `backend/src/models/__tests__/Dictionary.test.ts` — stale test against removed `DictionaryEntry` type and missing `relationships` field (pre-existing).
- `backend/src/routes/index.ts` (baseline) — unused `authenticate` import (now gone after split).

## Anything the spec didn't cover that I had to decide

- The `ai/chat.routes.ts`, `ai/conversation.routes.ts`, and `ai/prompt.routes.ts` files use static imports from `../../controllers/aiController.js`. If aiController fails to import, the dynamic import in `ai/index.ts` catches the error gracefully. This is the same behavior as the original god-file (which imported the AI controller inside the IIFE try block). The spec's ai/index.ts signature shows these as dynamically imported sub-routers, so the catch covers any failure in the static imports within the sub-files.
