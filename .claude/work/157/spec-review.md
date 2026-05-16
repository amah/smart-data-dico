# Spec review — #157: arch: split backend routes/index.ts by feature domain  (cycle 1)

## Verdict
**rework**

The spec is largely sound — route count audit passes, framework citations are real, path-name fidelity is correct, plain-Express constraint is honored, and the project.routes.ts deviation is well-justified. Two factual errors in acceptance criteria and one count-description ambiguity need fixing before this is implementable without ambiguity at test-author time.

## Required changes

1. **Criterion 7's authorizeJwt count is wrong (36 → 47).** The spec asserts `grep -nE "authorizeJwt\(\[" $(find backend/src/routes -name '*.ts') | wc -l` equals `36` on `main`. Actual count on `main` at `/Users/amah/Devs/projects/smart-data-dico/backend/src/routes/index.ts` is **47** (verified by `grep -cE "authorizeJwt\(\[" backend/src/routes/index.ts`). The post-split sum must equal 47, not 36. Fix the number, or replace the criterion with a more robust check that doesn't bake in a magic number — e.g. assert `grep -cE "authorizeJwt\(\[" $(find backend/src/routes -name '*.ts')` summed across all leaf files equals the count on `main` of the same expression on `routes/index.ts` (computed at test time, not hard-coded).

2. **`entity.routes.ts` count description is misleading; `getEntityHierarchy` import is missing.** The Files-touched bullet says `/api/services/:service/entities[...]` is "14 routes" + "legacy `/api/entities/:microservice/:entityName/*` (2 routes)" — total 16. The actual route counts are: 12 `/api/services/**` routes (lines 78-83 + 86-91 in `routes/index.ts`) plus 2 legacy `/api/entities/:microservice/:entityName/*` (lines 68-69) plus `POST /api/entities` (saveEntity, line 70) plus `GET /api/entities/hierarchy/:microservice/:entityName` (getEntityHierarchy, line 75). That totals 16 — the file-level number is right but the breakdown is wrong, and `getEntityHierarchy` is not listed in the entity.routes.ts import comment (only `getEntityAttributes`, `getRelatedEntities`, `saveEntity` from `dictionaryController` are named). Fix the breakdown to read e.g. "12 `/api/services/**` + 2 legacy `/api/entities/:microservice/:entityName/{attributes,related}` + `POST /api/entities` (saveEntity) + `GET /api/entities/hierarchy/:microservice/:entityName` (getEntityHierarchy) = 16", and add `getEntityHierarchy` to the listed imports from `dictionaryController` in the signatures block at spec line 154.

## Suggestions (won't block)

- **`swagger-jsdoc` glob is not recursive.** `backend/src/utils/swagger.ts:337` is `apis: ['./src/routes/*.ts', './src/controllers/*.ts']` — single-segment glob, no recursion into `routes/data-dictionary/` or `routes/ai/`. Today this is fine because `routes/index.ts` has zero `@swagger`/`@openapi` JSDoc annotations (verified by `grep -cE "@swagger|@openapi" routes/index.ts` = 0), so acceptance #8 (`/api-docs.json` unchanged) will hold. But after the split, anyone who later adds a swagger annotation in a `data-dictionary/*.routes.ts` or `ai/*.routes.ts` file will silently lose it. Consider either updating the glob to `./src/routes/**/*.ts` in the same PR, or adding a one-line out-of-scope note pointing at this gotcha for future contributors.
- **Acceptance criterion 5 wording is good but could be sharper.** "`<= 17 failed tests` and `<= 3 failed suites`" with the qualifier "the established baseline on `main`" is correct. Tested against actual baseline: `cd backend && npm test` returns exactly `Test Suites: 3 failed, 29 passed, 32 total / Tests: 17 failed, 362 passed, 379 total` — matches. After the spec's 5 new ordering assertions land, the expected post-split total is `17 failed / 367 passed / 384 total`. Consider stating the post-split expected total explicitly so test-author has no ambiguity.
- **`router.all` count claim is fine.** Spec says 1, code has 1 (`/api/perspectives*` at line 121). ✓
- **Per-file route counts spot-checked** (top-down): auth=2 ✓, search=2 ✓, visualization=8 (graph + impact + lineage + 5 diagrams) ✓, status=1 ✓, project=6 ✓, package=12 (8 packages + 4 dictionaries) ✓, relationship=4 ✓, stereotype=5 ✓, case=8 ✓, rule=6 ✓, integrity=1 ✓, model-metadata=2 ✓, dico-config=2 ✓, diff=10 (3 single + 3 all + 1 export/migration + 3 physical-config) ✓, import-export=10 (7 import + 2 export + 1 quality) ✓, version=3 ✓, ai/chat=7 ✓, ai/conversation=5 ✓, ai/prompt=5 ✓. Sum = 115 ✓.
- **`project.routes.ts` deviation: approved.** The six routes (`/api/filesystem/browse`, `/api/project`, `/api/project/status`, `/api/project/open`, `/api/project/close`, `/api/project/init`) are inline anonymous handlers in `routes/index.ts:189-318` with no controller. The ticket's tree has no slot for them. Folding them into `status.routes.ts` would conflate "is the server up" with "open/close/init project lifecycle" — distinct concerns. Sibling `project.routes.ts` is the right call. The spec's Risks #2 surfaces this correctly.

## Framework citation verification

| Cited path | Verified | Notes |
|---|---|---|
| `backend/src/middleware/jwtAuth.ts:74` (`authorizeJwt`) | yes | `export const authorizeJwt = (allowedRoles: string[]) => ...` matches spec signature. |
| `backend/src/middleware/jwtAuth.ts:16` (`verifyToken`) | yes | `export const verifyToken = (req, res, next) => ...` matches. |
| `backend/src/middleware/auth.ts:5-9` (`UserRole` enum) | yes | `ADMIN`, `EDITOR`, `VIEWER` confirmed. |
| `docs/adr/0001-backend-architecture.md` + commit `628e966` | yes | File exists; commit message confirms "ADR-0001 — backend stays plain Express; trim transitive direct deps (#158)". |
| No `@hamak/microkernel*` imports proposed | yes | `grep -E "@hamak/" .claude/work/157/spec.md` returns only meta-mentions (one in Goal, one in IIFE comment, one in "Framework APIs used" stating none, one in criterion 10). ADR-0001 honored. |
| `backend/src/__tests__/integration/api.test.ts` mocks `'../../middleware/auth'` and `'../../middleware/jwtAuth'` | yes | Verified — the existing mock specifiers will continue to intercept calls from the new files since each new file imports via the same module specifier (resolution-equivalent path). |

## Route count audit

- `grep -cE "^\s*router\.(get|post|put|delete|patch|options|head)\b" backend/src/routes/index.ts` = **115** ✓
- `grep -cE "^\s*router\.all\b" backend/src/routes/index.ts` = **1** ✓
- Per-file table sums to **115** ✓
- Baseline test state on `main` / `arch/155-batch-pattern-b`: `Test Suites: 3 failed, 29 passed, 32 total / Tests: 17 failed, 362 passed, 379 total` — matches spec claim exactly. ✓

## Path-name fidelity (spot checks)

| Spec claim | `routes/index.ts` line | Match |
|---|---|---|
| `/api/integrity` (not `/api/integrity-report`) | L136: `router.get('/api/integrity', getIntegrityReport)` | yes |
| `/api/config/types` (not `/api/derived-types`) | L321, L322 | yes |
| `/api/diff/logical` (not `/api/logical-diff`) | L139 | yes |

The spec correctly chose observed paths over ticket-prose paths. No path renames proposed.

## Cross-controller boundary decisions

All judgment calls reviewed against CLAUDE.md plugin layout:

- `entity/:uuid/rules` → `rule.routes.ts`: aligns with `ruleController` ownership; ticket comments say "one file per controller group wins for grouping". ✓
- `entity/flat` → `search.routes.ts`: matches frontend `search` plugin routes (`/api/entities/flat`, `/search` per CLAUDE.md). ✓
- `impact` + `lineage` → `visualization.routes.ts`: matches frontend `visualization` plugin (lineage + impact analysis are cited under visualization in CLAUDE.md). ✓
- `export/migration` → `diff.routes.ts`: spec correctly notes it's `diffController.exportMigration`. Could arguably go to `import-export.routes.ts` by URL prefix, but controller-ownership wins per the ticket. ✓
- `perspectives*` 308 redirect → `case.routes.ts`: redirect target is `/api/cases`. Belongs with cases. ✓

No surprises. These judgment calls are reasonable; any quibbles are code-review fodder, not spec-blockers.

## Risk reassessment

The spec's listed Risks (route ordering, project.routes.ts deviation, deferred AI-import fragility, module-load side effects, auth-mock specifier preservation) cover the real ones. Two additional risks worth surfacing:

1. **`swagger-jsdoc` glob non-recursion** — silent loss of future JSDoc annotations in subfolders (see Suggestions). Today: zero impact. Tomorrow: easy to step on.
2. **Acceptance criterion 7 as written hard-codes `= 36`**. If test-author treats the spec literally and the post-split grep returns 47, criterion 7 fails. Fix per Required Change #1.

## Cross-ticket conflicts

None. Reviewed:
- `.claude/work/163/spec.md` — frontend-only; references backend only as deferred dependencies (#167, #168, #169) and explicitly avoids backend routes ("no backend route — explicitly per agent guidance"). No overlap with #157.
- `gh issue view` confirms #161 OPEN, #162 OPEN, #160 OPEN, #158 CLOSED. Matches spec's coordination notes.
- `routes/data-dictionary/{case,rule}.routes.ts` placement is consistent with #161's prescribed direction (folding case + rule into data-dictionary). Spec correctly notes #161 is not yet merged and the path is provisional.
