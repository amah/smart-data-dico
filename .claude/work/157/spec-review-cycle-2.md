# Spec review — #157: arch: split backend routes/index.ts by feature domain  (cycle 2)

## Verdict
**approve**

Cycle-1's two required changes and one suggestion are all resolved. No regressions in the parts cycle-1 already approved.

## Required changes (if rework)
None.

## Suggestions (optional, won't block)
None.

## Delta verification — cycle 1 fixes

| Cycle-1 issue | Cycle-2 fix | Verified |
|---|---|---|
| Criterion 7's hard-coded `= 36` was wrong (real count 47) | Spec line 321 now uses a test-time computed comparison anchored to `main = 628e966`, with `47` cited as a sanity value: "post-split sum ... equals the pre-split count ... on `main` ... As of `main` HEAD `628e966` the pre-split count is **47**" | yes — `grep -cE "authorizeJwt\(\[" backend/src/routes/index.ts` on this checkout returns **47**, matching the stated anchor exactly. The self-updating assertion is robust against `main` advancing. |
| `entity.routes.ts` breakdown wrong (said "14 routes + 2 legacy"); `getEntityHierarchy` missing from imports | Spec line 23 now reads `12 /api/services/** routes (CRUD at L78-83 + review workflow & comments at L86-91) + 2 legacy /api/entities/:microservice/:entityName/{attributes,related} (L68-69) + POST /api/entities saveEntity (L70) + GET /api/entities/hierarchy/:microservice/:entityName getEntityHierarchy (L75) — total 16`. Line 154 signature comment now reads `// Imports getEntityAttributes, getRelatedEntities, saveEntity, getEntityHierarchy from dictionaryController.` | yes — re-read `backend/src/routes/index.ts` L65-91: L68-69 = 2 legacy, L70 = saveEntity, L75 = getEntityHierarchy, L78-83 = 6 services routes (services list, service entities, entity GET/POST/PUT/DELETE), L86-91 = 6 more (submit/approve/return + 3 comments routes). 2 + 1 + 1 + 12 = **16**. The breakdown now matches reality. `getEntityHierarchy` present in the import list. |
| Suggestion: swagger.ts glob `./src/routes/*.ts` non-recursive | Adopted into scope. Spec line 11 adds `backend/src/utils/swagger.ts` to Edits with the one-character widening to `'./src/routes/**/*.ts'`. Removed from "No changes to" (verified — line 45 lists only `server.ts`, controllers/services/middleware/schema, `package.json`). Criterion 8 line 322 asserts the post-split glob value is `'./src/routes/**/*.ts'` while preserving the "spec output unchanged today" claim (justified by `grep -cE "@swagger\|@openapi" routes/index.ts` = 0). | yes — `backend/src/utils/swagger.ts:337` today reads `apis: ['./src/routes/*.ts', './src/controllers/*.ts']` so the proposed widening is a real change. The companion `./src/controllers/*.ts` glob is correctly left untouched. |

## Framework citation verification

No new framework citations introduced in cycle 2. Cycle-1 verifications still hold:

| Cited path | Verified | Notes |
|---|---|---|
| `backend/src/middleware/jwtAuth.ts:74` (`authorizeJwt`) | yes | unchanged from cycle 1 |
| `backend/src/middleware/jwtAuth.ts:16` (`verifyToken`) | yes | unchanged from cycle 1 |
| `backend/src/middleware/auth.ts:5-9` (`UserRole`) | yes | unchanged from cycle 1 |
| `backend/src/utils/swagger.ts:337` glob value | yes | confirmed `apis: ['./src/routes/*.ts', './src/controllers/*.ts']` today — the spec's proposed `**` widening is a one-character edit, not a fabrication |

## Collateral regression sweep

- **Per-file route counts still sum to 115.** Criterion 4 table (spec lines 290-313): 2+2+8+1+6+12+16+4+5+8+6+1+2+2+10+10+3+7+5+5 = 115. ✓
- **`router.all` count still 1** (case.routes.ts, 308 redirect). ✓
- **Path fidelity intact.** `/api/integrity` (not `-report`), `/api/config/types` (not `/api/derived-types`), `/api/diff/logical` — all preserved in criterion 6 and Out of Scope. ✓
- **`project.routes.ts` deviation still flagged in Risks #2.** Line 348 unchanged. ✓
- **ADR-0001 compliance preserved.** Criterion 10 still asserts no `@hamak/microkernel` imports. Plain Express only. ✓
- **Deferred AI-import IIFE preserved.** Criterion 11 unchanged; spec lines 190-201 still carry the `(async () => { try { ... } catch { ... } })()` block verbatim from the god-file. ✓
- **Auth mock specifier compatibility unchanged.** Risks #5 still binds new files to `'../../middleware/jwtAuth.js'` from data-dictionary/ai subfolders. ✓
- **Baseline test state still cited correctly** (`17 failed / 362 passed / 3 of 32 suites` on `main` at `628e966`). ✓

## Risk reassessment

Cycle-1's two additional risks are now resolved:
1. Swagger glob non-recursion — folded into scope; criterion 8 enforces the new value.
2. Criterion 7 hard-coded `= 36` — replaced with a self-updating computed assertion plus sanity anchor of 47.

Remaining risks (per spec Risks 1-5) are the real ones and have testable mitigations.

## Cross-ticket conflicts

None new. Cycle-1's cross-check stands: #163 has no backend overlap; #161/#162/#160 are OPEN coordination items; #158 is CLOSED and the foundation. No in-flight spec under `.claude/work/*` touches `backend/src/routes/` or `backend/src/utils/swagger.ts`.
