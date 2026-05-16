# Spec — #157: arch: split backend routes/index.ts by feature domain

## Goal

`backend/src/routes/index.ts` is a 373-line god-file that mounts every API across every domain — auth, dictionaries, packages, entities, services, stereotypes, cases, rules, integrity, diff, version, import/export, derived types, model metadata, project mgmt, diagrams, AI. The ticket calls for "one router file per controller group, mounted from a slim aggregator" whose layout "mirrors the frontend plugin boundaries so the backend and frontend tell the same story." Per ADR-0001 (`docs/adr/0001-backend-architecture.md`, committed in `628e966`), this is a mechanical Express refactor — no `@hamak/microkernel-impl`, no DI, no `Host`. The aggregator must drop below 50 physical lines; the 115 explicit-method route registrations (plus the 1 `router.all` legacy redirect) must be redistributed without changing route order semantics, mounted paths, middleware policies, or handler bindings. Controllers and middleware are untouched.

## Files touched

Edits:
- `backend/src/routes/index.ts` — shrink from 373 → < 50 lines; becomes a pure aggregator that imports six domain routers and mounts them with `router.use(...)`. Aggregator MUST preserve the legacy `(async () => { ... })()` deferred-import pattern for AI routes (see Risks #1) — moved into `routes/ai/index.ts` so the aggregator itself stays static.
- `backend/src/utils/swagger.ts` — one-character widening of the `apis` glob at L337 from `'./src/routes/*.ts'` to `'./src/routes/**/*.ts'`. Today zero behavioral impact (no `@swagger`/`@openapi` JSDoc annotations in `routes/index.ts`, verified by `grep -cE "@swagger|@openapi" backend/src/routes/index.ts` = 0); future-proofs the split so any later contributor adding JSDoc annotations to a `data-dictionary/*.routes.ts` or `ai/*.routes.ts` file is picked up by `swagger-jsdoc`. The companion `./src/controllers/*.ts` glob is untouched.

New files under `backend/src/routes/`:
- `auth.routes.ts` — login, me (uses `verifyToken` middleware directly on `/api/auth/me`).
- `search.routes.ts` — `/api/search`, `/api/entities/flat`. Mounted at aggregator top level so `/api/entities/flat` (literal, 3 segments) is matched before any 4-segment `/api/entities/:uuid/...` route from sibling files. (Express only treats different segment counts as non-collisions, but explicit aggregator ordering documents intent.)
- `visualization.routes.ts` — `/api/graph/:service`, `/api/entities/:uuid/impact`, `/api/entities/:uuid/lineage`, `/api/diagrams[/:id]` (5 verbs).
- `status.routes.ts` — `/api/status`.
- `project.routes.ts` — `/api/filesystem/browse`, `/api/project`, `/api/project/status`, `/api/project/open`, `/api/project/close`, `/api/project/init`. Not in the ticket's prescribed layout; this is a gap (see Risks #2). These six routes are inline handlers in the current god-file with no controller. Holding them in a sibling top-level `project.routes.ts` keeps the data-dictionary folder free of cross-cutting filesystem/project-lifecycle concerns.

New files under `backend/src/routes/data-dictionary/`:
- `index.ts` — sub-aggregator; mounts the 12 domain routers.
- `package.routes.ts` — `/api/packages/**` (8 routes) plus legacy `/api/dictionaries/**` (4 routes from `dictionaryController`). Both live here because they share the same controller.
- `entity.routes.ts` — 12 `/api/services/**` routes (CRUD at L78-83 + review workflow & comments at L86-91 of the current god-file) + 2 legacy `/api/entities/:microservice/:entityName/{attributes,related}` (L68-69) + `POST /api/entities` saveEntity (L70) + `GET /api/entities/hierarchy/:microservice/:entityName` getEntityHierarchy (L75) — total 16. Note `/api/entities/flat`, `/api/entities/:uuid/impact`, `/api/entities/:uuid/lineage`, `/api/entities/:entityUuid/rules` deliberately do NOT live here; they go to `search`, `visualization`, and `rule.routes.ts` respectively per the ticket's URL-prefix-then-domain mapping.
- `relationship.routes.ts` — `/api/packages/:packageName/relationships[/:uuid]` (4 routes).
- `stereotype.routes.ts` — `/api/stereotypes[/:id]` (5 routes).
- `case.routes.ts` — `/api/cases/**` (8 routes) plus the `router.all('/api/perspectives*', ...)` 308 legacy redirect. The redirect lives here because it forwards to `/api/cases`.
- `rule.routes.ts` — `/api/rules[/:uuid]` (5 routes) plus `/api/entities/:entityUuid/rules` (1 route, same controller). #161 (cases+rules folded into data-dictionary) is NOT YET MERGED; this ticket places them under `data-dictionary/` per its own explicit prescription, in advance of #161.
- `integrity.routes.ts` — `/api/integrity` (1 route). Path in the ticket says `/api/integrity-report`; current code is `/api/integrity`. The current code wins (the spec preserves observable behavior).
- `model-metadata.routes.ts` — `/api/model/metadata` GET/PUT (2 routes).
- `dico-config.routes.ts` — `/api/config/types` GET/PUT (2 routes). Ticket comment mis-labels the path as `/api/derived-types`; current code is `/api/config/types`. Current code wins.
- `diff.routes.ts` — `/api/diff/{logical,physical,impact}`, `/api/diff/{physical,impact}/all`, `/api/export/migration[/all]`, `/api/services/:service/physical-config` GET/PUT/DELETE (10 routes). All `diffController`-owned. `/api/export/migration` is NOT in `import-export.routes.ts` despite its URL prefix because it is `diffController.exportMigration` and per the ticket "one file per controller group" wins for grouping.
- `import-export.routes.ts` — `/api/import/**` (7), `/api/export/{json-schema,markdown}/:service` (2), `/api/quality/report` (1) — total 10.
- `version.routes.ts` — `/api/commit`, `/api/history`, `/api/revert` (3 routes). #160 may shrink this to zero; until then these three stay.

New files under `backend/src/routes/ai/`:
- `index.ts` — sub-aggregator. Wraps the deferred-import IIFE pattern from the current god-file (lines 345-371) so AI controller import failure does not crash boot in optional-feature mode.
- `chat.routes.ts` — `/api/ai/chat`, `/status`, `/config` GET/POST, `/tools`, `/mentions/search`, `/test-tools` (7 routes).
- `conversation.routes.ts` — `/api/ai/conversations[/:id]` (5 routes).
- `prompt.routes.ts` — `/api/ai/prompts[/:id]` (5 routes).

Tests:
- `backend/src/__tests__/integration/api.test.ts` — extend with five new assertions exercising literal-vs-param ordering hotspots (see Acceptance #5). Do not modify existing assertions.

No changes to:
- `backend/src/server.ts` — `app.use(routes)` continues to import the default export of `backend/src/routes/index.ts`.
- Any controller, service, middleware, or schema file.
- `backend/package.json` — dependencies untouched (per ADR-0001, #158 already trimmed transitive directs).

## Public surface (signatures)

```ts
// backend/src/routes/index.ts (< 50 lines)
import { Router } from 'express';
import authRoutes from './auth.routes.js';
import dataDictionaryRoutes from './data-dictionary/index.js';
import aiRoutes from './ai/index.js';
import searchRoutes from './search.routes.js';
import visualizationRoutes from './visualization.routes.js';
import statusRoutes from './status.routes.js';
import projectRoutes from './project.routes.js';

const router: Router = Router();
router.use(statusRoutes);
router.use(authRoutes);
router.use(searchRoutes);          // mounted before data-dictionary so `/api/entities/flat` is visible at the same level
router.use(visualizationRoutes);
router.use(projectRoutes);
router.use(dataDictionaryRoutes);
router.use(aiRoutes);
export default router;
```

```ts
// backend/src/routes/auth.routes.ts
import { Router } from 'express';
import { getCurrentUser, login } from '../controllers/authController.js';
import { verifyToken } from '../middleware/jwtAuth.js';

const router: Router = Router();
router.post('/api/auth/login', login);
router.get('/api/auth/me', verifyToken, getCurrentUser);
export default router;
```

```ts
// backend/src/routes/data-dictionary/index.ts
import { Router } from 'express';
import packageRoutes from './package.routes.js';
import entityRoutes from './entity.routes.js';
import relationshipRoutes from './relationship.routes.js';
import stereotypeRoutes from './stereotype.routes.js';
import caseRoutes from './case.routes.js';
import ruleRoutes from './rule.routes.js';
import integrityRoutes from './integrity.routes.js';
import modelMetadataRoutes from './model-metadata.routes.js';
import dicoConfigRoutes from './dico-config.routes.js';
import diffRoutes from './diff.routes.js';
import importExportRoutes from './import-export.routes.js';
import versionRoutes from './version.routes.js';

const router: Router = Router();
// Ordering: literals before :params within /api/packages/** and /api/entities/**.
// Mount specific-prefix routers (relationship under /api/packages/:packageName/relationships)
// AFTER package so package's literal /api/packages/all and /api/packages/hierarchy/...
// still match first. Express matches in order across stacked sub-routers.
router.use(packageRoutes);
router.use(relationshipRoutes);
router.use(entityRoutes);
router.use(stereotypeRoutes);
router.use(caseRoutes);
router.use(ruleRoutes);
router.use(integrityRoutes);
router.use(modelMetadataRoutes);
router.use(dicoConfigRoutes);
router.use(diffRoutes);
router.use(importExportRoutes);
router.use(versionRoutes);
export default router;
```

```ts
// backend/src/routes/data-dictionary/package.routes.ts
import { Router } from 'express';
import {
  createDictionary, getDictionaries, getDictionaryById, getDictionaryEntries,
  getPackageByPath, getPackageHierarchy, getTabularData,
  listAllPackagesAndEntities, createRootPackage, createPackageAtPath,
  updatePackageAtPath, deletePackageAtPath,
} from '../../controllers/dictionaryController.js';
import { UserRole } from '../../middleware/auth.js';
import { authorizeJwt } from '../../middleware/jwtAuth.js';

const router: Router = Router();
// Literals first
router.get('/api/packages/all', listAllPackagesAndEntities);
router.get('/api/packages/hierarchy/:rootPackage', getPackageHierarchy);
router.get('/api/packages/tabular/:rootPackage', getTabularData);
// Mutations
router.post('/api/packages', authorizeJwt([UserRole.ADMIN, UserRole.EDITOR]), createRootPackage);
router.post('/api/packages/:rootPackage/subpackages/*', authorizeJwt([UserRole.ADMIN, UserRole.EDITOR]), createPackageAtPath);
router.put('/api/packages/:rootPackage/path/*', authorizeJwt([UserRole.ADMIN, UserRole.EDITOR]), updatePackageAtPath);
router.delete('/api/packages/:rootPackage/path/*', authorizeJwt([UserRole.ADMIN]), deletePackageAtPath);
router.get('/api/packages/:rootPackage/path/*', getPackageByPath);
// Legacy /api/dictionaries/** (same controller)
router.get('/api/dictionaries', getDictionaries);
router.post('/api/dictionaries', createDictionary);
router.get('/api/dictionaries/:id', getDictionaryById);
router.get('/api/dictionaries/:id/entries', getDictionaryEntries);
export default router;
```

```ts
// backend/src/routes/data-dictionary/entity.routes.ts (16 routes)
// Imports getEntityAttributes, getRelatedEntities, saveEntity, getEntityHierarchy from dictionaryController.
// Imports createEntity, deleteEntity, getAllServices, getEntitySchema,
//   getServiceEntities, updateEntity, submitEntity, approveEntity, returnEntity,
//   getEntityComments, addEntityComment, resolveEntityComment from serviceController.
// Routes (in order): 2 legacy /api/entities/:microservice/:entityName/{attributes,related},
//   POST /api/entities (saveEntity), GET /api/entities/hierarchy/:microservice/:entityName
//   (getEntityHierarchy), then 12 /api/services/** routes (services list, service entities,
//   entity GET/POST/PUT/DELETE, submit/approve/return, 3 comments routes).
// All authorizeJwt(...) decorations preserved exactly as in the current file.
```

```ts
// backend/src/routes/data-dictionary/case.routes.ts (8 routes + 1 router.all redirect)
// Includes:
//   router.all('/api/perspectives*', (req, res) => {
//     const target = '/api/cases' + req.path.replace('/api/perspectives', '');
//     const query = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
//     res.redirect(308, target + query);
//   });
```

```ts
// backend/src/routes/data-dictionary/rule.routes.ts (6 routes)
// Includes the cross-shaped /api/entities/:entityUuid/rules route — owned by ruleController,
// so it lives here despite its /api/entities/** URL prefix.
```

```ts
// backend/src/routes/ai/index.ts
import { Router } from 'express';

const router: Router = Router();
// Deferred-import IIFE preserves the existing graceful-degradation behavior:
// if @hamak/* or AI deps fail to import (optional feature), boot continues
// and AI routes 404 until the import resolves. Pattern lifted verbatim from
// the current god-file lines 345-371.
(async () => {
  try {
    const chatRoutes = (await import('./chat.routes.js')).default;
    const conversationRoutes = (await import('./conversation.routes.js')).default;
    const promptRoutes = (await import('./prompt.routes.js')).default;
    router.use(chatRoutes);
    router.use(conversationRoutes);
    router.use(promptRoutes);
  } catch {
    // AI dependencies not available (optional feature)
  }
})();
export default router;
```

```ts
// backend/src/routes/search.routes.ts (2 routes)
import { Router } from 'express';
import { searchEntities } from '../controllers/serviceController.js';
import { getFlatEntitiesAndAttributes } from '../controllers/dictionaryController.js';

const router: Router = Router();
// /api/entities/flat MUST be declared before any 2-segment /api/entities POST
// at the same router level. Here they are in different routers but with
// different segment counts (3 vs 2), so Express does not collide them.
router.get('/api/entities/flat', getFlatEntitiesAndAttributes);
router.get('/api/search', searchEntities);
export default router;
```

```ts
// backend/src/routes/visualization.routes.ts (8 routes)
// /api/graph/:service, /api/entities/:uuid/impact, /api/entities/:uuid/lineage,
// /api/diagrams (5 verbs incl. :id).
// Uses diagramController.<method>.bind(diagramController) preserved exactly.
```

```ts
// backend/src/routes/status.routes.ts (1 route)
import { Router } from 'express';

const router: Router = Router();
router.get('/api/status', (req, res) => {
  const profile = process.env.PROFILE || 'local';
  res.json({
    status: 'operational',
    mode: profile === 'local' ? 'desktop' : 'server',
    profile,
    version: process.env.npm_package_version || '1.1.1',
    auth: profile === 'local' ? 'none' : 'jwt',
  });
});
export default router;
```

```ts
// backend/src/routes/project.routes.ts (6 routes)
// Holds the inline anonymous handlers for /api/filesystem/browse, /api/project,
// /api/project/status, /api/project/open, /api/project/close, /api/project/init.
// Reads `config` from '../kernel/config.js' and uses fs/path/os/util.
// Uses authorizeJwt([UserRole.ADMIN]) on open/close/init exactly as current.
```

## Framework APIs used

This refactor uses **no `@hamak/*` APIs**. Per ADR-0001, the backend stays plain Express:
- `express` — `Router`, `Request`, `Response`, `NextFunction`. Only `Router()` factory is used.
- `../middleware/jwtAuth.js` — `authorizeJwt(allowedRoles: string[]): RequestHandler`, `verifyToken: RequestHandler` (verified in `backend/src/middleware/jwtAuth.ts` lines 74 and 16).
- `../middleware/auth.js` — `UserRole.{ADMIN,EDITOR,VIEWER}` enum (verified in `backend/src/middleware/auth.ts` lines 5-9).

## Acceptance criteria

1. **Aggregator size.** `wc -l backend/src/routes/index.ts` returns a count `< 50`.
2. **Folder layout.** The output of `find backend/src/routes -type f -name '*.ts' | sort` lists exactly these 22 files (one aggregator + four top-level + project + data-dictionary index + 12 data-dictionary leaf files + ai index + 3 ai leaf files):
   ```
   backend/src/routes/ai/chat.routes.ts
   backend/src/routes/ai/conversation.routes.ts
   backend/src/routes/ai/index.ts
   backend/src/routes/ai/prompt.routes.ts
   backend/src/routes/auth.routes.ts
   backend/src/routes/data-dictionary/case.routes.ts
   backend/src/routes/data-dictionary/dico-config.routes.ts
   backend/src/routes/data-dictionary/diff.routes.ts
   backend/src/routes/data-dictionary/entity.routes.ts
   backend/src/routes/data-dictionary/import-export.routes.ts
   backend/src/routes/data-dictionary/index.ts
   backend/src/routes/data-dictionary/integrity.routes.ts
   backend/src/routes/data-dictionary/model-metadata.routes.ts
   backend/src/routes/data-dictionary/package.routes.ts
   backend/src/routes/data-dictionary/relationship.routes.ts
   backend/src/routes/data-dictionary/rule.routes.ts
   backend/src/routes/data-dictionary/stereotype.routes.ts
   backend/src/routes/data-dictionary/version.routes.ts
   backend/src/routes/index.ts
   backend/src/routes/project.routes.ts
   backend/src/routes/search.routes.ts
   backend/src/routes/status.routes.ts
   backend/src/routes/visualization.routes.ts
   ```
3. **Total route count preserved.** `grep -cE "^\s*router\.(get|post|put|delete|patch|options|head)\b" $(find backend/src/routes -name '*.ts')` summed across all files = `115`. Plus `grep -cE "^\s*router\.all\b" backend/src/routes/data-dictionary/case.routes.ts` = `1` (legacy perspectives redirect).
4. **Per-file route counts** (sum = 115 explicit-method registrations):
   | File | Verb routes |
   |---|---|
   | `auth.routes.ts` | 2 |
   | `search.routes.ts` | 2 |
   | `visualization.routes.ts` | 8 |
   | `status.routes.ts` | 1 |
   | `project.routes.ts` | 6 |
   | `data-dictionary/package.routes.ts` | 12 |
   | `data-dictionary/entity.routes.ts` | 16 |
   | `data-dictionary/relationship.routes.ts` | 4 |
   | `data-dictionary/stereotype.routes.ts` | 5 |
   | `data-dictionary/case.routes.ts` | 8 (+ 1 `router.all`) |
   | `data-dictionary/rule.routes.ts` | 6 |
   | `data-dictionary/integrity.routes.ts` | 1 |
   | `data-dictionary/model-metadata.routes.ts` | 2 |
   | `data-dictionary/dico-config.routes.ts` | 2 |
   | `data-dictionary/diff.routes.ts` | 10 |
   | `data-dictionary/import-export.routes.ts` | 10 |
   | `data-dictionary/version.routes.ts` | 3 |
   | `ai/chat.routes.ts` | 7 |
   | `ai/conversation.routes.ts` | 5 |
   | `ai/prompt.routes.ts` | 5 |
   | **Total** | **115** |
5. **No regressions.** `cd backend && npm test` returns a failure count `<= 17 failed tests` and `<= 3 failed suites` (the established baseline on `main` at `628e966` — same as the current `arch/155-batch-pattern-b` HEAD since neither branch has touched backend yet). The newly-added integration assertions (criterion 6) PASS, increasing the total test count by exactly 5.
6. **New ordering-regression assertions.** `backend/src/__tests__/integration/api.test.ts` gets a new `describe('Route ordering after split')` block that asserts on five surgical paths chosen to exercise literal-vs-param hot spots, all expecting `status !== 404`:
   - `GET /api/entities/flat` → resolves to `getFlatEntitiesAndAttributes` (in `search.routes.ts`), not to any `:microservice/:entityName` shape.
   - `GET /api/packages/all` → resolves to `listAllPackagesAndEntities` (in `package.routes.ts`), not to `:rootPackage/path/*`.
   - `GET /api/packages/hierarchy/X` → resolves to `getPackageHierarchy`, not shadowed by `/api/packages/:rootPackage/path/*`.
   - `GET /api/config/types` → resolves to `getDerivedTypes` (in `dico-config.routes.ts`). Confirms the dico-config router mounts.
   - `GET /api/perspectives/foo` → responds `308` redirect to `/api/cases/foo` (the legacy `router.all` carrier). Use `request(app).get('/api/perspectives/foo').redirects(0)` and assert `response.status === 308` and `response.headers.location === '/api/cases/foo'`.
7. **Middleware policies unchanged.** For every route that had `authorizeJwt([UserRole.X, ...])` in the original file — the exact same `authorizeJwt([...])` decoration with the same role array is present on the same path+verb in its new home. Test-time computed assertion: the post-split sum `grep -cE "authorizeJwt\(\[" $(find backend/src/routes -name '*.ts')` (summed across all leaf files) equals the pre-split count `grep -cE "authorizeJwt\(\[" backend/src/routes/index.ts` as measured on `main` at the merge-base of this branch. As of `main` HEAD `628e966` the pre-split count is **47** (verified by `grep -cE "authorizeJwt\(\[" backend/src/routes/index.ts` = 47); the post-split sum must equal 47 unless `main` advances and the pre-split count changes, in which case both sides update together.
8. **Swagger unaffected today, recursive tomorrow.** `GET /api-docs.json` returns the same spec object as on `main` (verified: `routes/index.ts` carries 0 `@swagger`/`@openapi` annotations on `main`, so the glob widening is a no-op for the current output). `backend/src/utils/swagger.ts:337` reads `apis: ['./src/routes/**/*.ts', './src/controllers/*.ts']` post-split.
9. **No new dependencies.** `git diff main..HEAD -- backend/package.json backend/package-lock.json` is empty.
10. **No `@hamak/microkernel-*` import.** `grep -rn "@hamak/microkernel" backend/src/routes/` returns no matches (per ADR-0001).
11. **Deferred AI-import preserved.** `backend/src/routes/ai/index.ts` matches `(async () => {` and a `catch {` swallowing failures. Boot does NOT throw when `aiController` imports fail.

## Out of scope

- Adding DI / microkernel on the backend (per ADR-0001 / #158, decided closed).
- Refactoring or renaming controllers (e.g. `serviceController` mostly handles entities — a tempting rename — explicitly OUT per the ticket).
- Changing API paths or response shapes (the `/api/integrity` vs ticket's `/api/integrity-report` discrepancy, the `/api/config/types` vs `/api/derived-types` discrepancy: current code wins; do not rename).
- Removing the legacy `router.all('/api/perspectives*', ...)` 308 redirect. Stays under `case.routes.ts`.
- Folding `versionController` routes into framework git mounts — coordinate with #160, not in this ticket.
- Adding new endpoints, new tests beyond the 5 ordering assertions, or migrating any test from `controllers/__tests__/` or `services/__tests__/`.
- Splitting `serviceController.ts` itself (still mixes entities, services, search, lineage, comments). Out of scope per ticket.
- Lifting the deferred-import IIFE for AI to a synchronous `import` even though static analysis would prefer it — this requires `aiController.ts` itself to gracefully no-op on missing optional deps; out of scope here.

## Dependencies

- **Coordinate (not blocked) with #161** — case + rule routes are placed under `data-dictionary/` now per the ticket's explicit prescription, in advance of #161 finalizing the data-dictionary plugin merge. If #161 lands first with different folder names, this ticket adjusts.
- **Coordinate (not blocked) with #162** — `ai/` folder created now per the ticket's explicit prescription, ahead of an `ai-assistance` plugin if/when #162 introduces one.
- **Coordinate (not blocked) with #160** — `data-dictionary/version.routes.ts` may shrink to zero after framework git replaces `versionController`. Until then it carries 3 routes.
- **Built on #158 (already merged via `628e966`)** — ADR-0001 closes the microkernel question; this refactor is plain Express only. No transitive direct deps to manage.

## Risks

1. **Express route ordering across stacked sub-routers.** When the aggregator mounts `router.use(packageRoutes); router.use(entityRoutes); ...`, requests hit each sub-router in order; within each sub-router the local registration order applies. Hot spots: `/api/packages/all` (literal, 3 seg) vs `/api/packages/:rootPackage/path/*` (param + wildcard) — both in `package.routes.ts`, literal goes first. `/api/entities/flat` (3 seg) vs `/api/entities/:uuid/impact` (4 seg) vs `/api/entities/:microservice/:entityName/attributes` (5 seg) — different segment counts, no collision. **Mitigation:** acceptance criterion 6 adds five integration assertions targeting these hot spots; any future addition that shadows them fails the build.
2. **`project.routes.ts` is not in the ticket's prescribed layout.** The ticket layout shows `status.routes.ts` only at the top level (no project lifecycle routes). The current god-file's 6 project-mgmt routes (`/api/filesystem/browse`, `/api/project`, `/api/project/status`, `/api/project/open`, `/api/project/close`, `/api/project/init`) have no controller and no obvious home in the ticket's tree. **Mitigation:** create `project.routes.ts` as a sibling top-level router; surfaced in this Risks section so reviewers can override (e.g., fold into `status.routes.ts` and rename, or punt to a follow-up).
3. **Deferred AI-import is fragile.** The current god-file loads `aiController` inside an `(async () => {})()` IIFE so optional-feature failures don't crash boot (god-file lines 345-371). Moving this into `routes/ai/index.ts` preserves the pattern but introduces a small window where AI routes are not yet registered on the express router (requests in that window 404). **Mitigation:** preserve the IIFE verbatim; document the behavior in `ai/index.ts` JSDoc; add no new functional surface that depends on synchronous AI route availability.
4. **Module-load side effects.** A naive `import './data-dictionary/diff.routes.js'` triggers controller-module evaluation, which transitively loads heavyweight DB drivers (oracle, postgres) via `importService` / `diffController`. The current god-file already does this top-of-file. **Mitigation:** preserve the import surface unchanged — each new file imports exactly the same controller functions the god-file imports — so the side-effect set is invariant.
5. **`backend/src/__tests__/integration/api.test.ts` mocks the `auth` and `jwtAuth` modules.** If a domain file imports `authorizeJwt` via a different path-spec or a typo, the mock won't intercept and authz might block requests under test, producing false 403s. **Mitigation:** every new file imports `authorizeJwt` from `'../middleware/jwtAuth.js'` (or `'../../middleware/jwtAuth.js'` from the `data-dictionary/` and `ai/` subfolders) — i.e. the exact same module specifier (after path-resolution) that `jest.mock('../../middleware/jwtAuth')` targets. Verified by running the existing integration suite against the refactored tree as part of acceptance criterion 5.
