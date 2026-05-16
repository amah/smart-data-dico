# Test results — #155-integrity-service  (cycle 1)

## Files added / updated

- **NEW** `frontend/src/plugins/data-dictionary/services/__tests__/IntegrityService.test.ts` (4 tests) — unit tests with constructor-injected stub `AxiosInstance`.
- **NEW** `frontend/src/plugins/data-dictionary/__tests__/dataDictionaryPlugin.integrity.test.ts` (3 tests) — production `bootstrapApplication()` + `host.rootActivationCtx!.resolve(INTEGRITY_SERVICE_TOKEN)`.
- **UPDATED** `frontend/src/pages/__tests__/IntegrityPage.test.tsx` (10 tests) — replaced `vi.mock('../../services/api', …)` harness with `bootstrapApplication()` + `<Provider store={getStore()}>` + per-`beforeEach` MSW `/api/integrity` handler. Preserved every assertion intent from the prior file (tab counts, three-tab filtering, search across categories, search-driven counts, Needs-attention preset, error state).
- **NEW** `frontend/src/plugins/data-dictionary/services/__tests__/spec-grep-guards.integrity.test.ts` (10 tests) — content-walker guard suite for the criteria the spec defines as greps (token uniqueness, no `services/api` import inside `IntegrityService`, `initialize`-not-`activate` registration with `useValue`, page consumers, deletion from `api.ts`, repo-wide identifier sweep).

## Coverage of acceptance criteria

| Criterion | Test file:lines | Status |
|---|---|---|
| 1. Token exists and is unique; symbol type; distinct value | `spec-grep-guards.integrity.test.ts:80-86` (declaration count); `dataDictionaryPlugin.integrity.test.ts:36-45` (resolves a real instance via the symbol) | pass |
| 2. Service file is self-contained (no `services/api` import) | `spec-grep-guards.integrity.test.ts:89-95` | pass |
| 3. DI registration in `initialize` (not `activate`); `useValue` shape | `spec-grep-guards.integrity.test.ts:98-123`; `dataDictionaryPlugin.integrity.test.ts:47-52` (singleton on repeated resolves confirms eager-`useValue`) | pass |
| 4. IntegrityPage consumes via `useService(INTEGRITY_SERVICE_TOKEN)`; no `integrityApi` | `spec-grep-guards.integrity.test.ts:126-138`; runtime exercise via `IntegrityPage.test.tsx` (all 10 page tests) | pass |
| 5. HomePage migrated in same PR; no `integrityApi` | `spec-grep-guards.integrity.test.ts:141-153` | pass |
| 6. `integrityApi` removed from `api.ts` (no export, no in-file references) | `spec-grep-guards.integrity.test.ts:156-161` | pass |
| 7. Repo-wide no surviving consumer in `frontend/src` | `spec-grep-guards.integrity.test.ts:164-186` (recursive walk excluding only this guard file) | pass |
| 8. `IntegrityService` unit test green — constructor injection, `/integrity` call, envelope unwrap, error propagation | `IntegrityService.test.ts:71-102` (call site assertion 71-79, envelope unwrap 81-93, error propagation 95-100, default construction smoke 102-110) | pass |
| 9. Plugin bootstrap test green — `bootstrapApplication()` + singleton host resolves token with `getReport` method shape | `dataDictionaryPlugin.integrity.test.ts:32-52` | pass |
| 10. IntegrityPage page-level test green — `bootstrapApplication()` once, `beforeEach` re-install of `/api/integrity` MSW handler, `<Provider store={getStore()}>` wrap, prior assertions preserved | `IntegrityPage.test.tsx:1-230` | pass |
| 11. HomePage existing test status — vacuously satisfied; no `HomePage.test.tsx` exists on the branch | — | skipped (vacuous; confirmed via `ls frontend/src/pages/__tests__/` — no `HomePage*` file) |
| 12. Full Vitest suite green on the head commit | `cd frontend && npm test -- --run` → 31 test files / 219 tests, 0 failures (run at the timestamp below) | pass |
| 13. Does NOT pin tsc/lint | n/a — none of the new test files invoke `tsc --noEmit` or `npm run lint` | pass (by construction) |

## Notes on the test design

- **No `vi.mock('axios')` anywhere.** Per the spec's cycle-2 rewrite, the unit test uses constructor-injected stub `{ get: vi.fn() }` cast through `unknown` to `AxiosInstance`; the page-level test uses MSW. Both styles match the precedent (`StereotypeService.test.ts`, `StereotypesPage.bootstrap.test.tsx`).
- **MSW handler re-install in `beforeEach`** (criterion #10 + Risk 6). The suite-wide `frontend/src/test/setup.ts` runs `server.resetHandlers()` in `afterEach`; the per-test `beforeEach` registers the `/api/integrity` handler fresh. A module-level `failFetch` flag is toggled in the error-state test to swap the same handler from 200 to 500 without redeclaring it.
- **Bootstrap singleton isolation.** Both bootstrap-using tests follow the StereotypesPage precedent: a single `await bootstrapApplication()` in `beforeAll`. The function is idempotent (it sets `isBootstrapped = true` and returns early on subsequent calls), so test-order across the suite is safe.
- **Grep-guard walker, not shell `grep`.** Mirrors `frontend/src/plugins/store/__tests__/spec-grep-guards.test.ts`. The walker is allowlist-aware so prose mentions of `integrityApi` in test-author commentary do not falsely trip the guard against itself; the IntegrityPage test header was reworded to remove an inline backtick mention rather than widening the allowlist.

## Failures

None. 27 new tests, 219 total suite tests, 0 failures.

## Build status

- New + updated test files: `npx vitest run` on all four → 4 files / 27 tests pass.
- Full frontend suite: `cd frontend && npm test -- --run` → 31 files / 219 tests pass, 0 failures.
- Test suite runtime: full suite ≈ 46s; the four files this PR adds add ≈ 5.8s when run together.
- No implementation code was modified by test-author. No `tsc --noEmit` or `npm run lint` were invoked (per criterion #13 and the post-#156 calibration: both are baseline-broken).

## Run timestamp

2026-05-14T23:05:43Z (UTC).
