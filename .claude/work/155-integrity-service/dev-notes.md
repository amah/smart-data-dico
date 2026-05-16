# Dev notes — #155-integrity-service  (cycle 1)

## Branch
- Base: `arch/166-stereotype-slice` @ `f866160`
- Created: `arch/155-integrity-service`

## Changes
- `frontend/src/kernel/tokens.ts:43-52` — appended `INTEGRITY_SERVICE_TOKEN = Symbol('IntegrityService')` with docblock describing Pattern B / data-dictionary owner.
- `frontend/src/plugins/data-dictionary/services/IntegrityService.ts` — **new** (75 lines). Exposes `IntegrityValidationRow`, `IntegrityConstraintRow`, `IntegrityReport` interfaces and `IntegrityService` class. Constructor accepts an optional `AxiosInstance` for test injection; default instance built by `createDefaultHttp()` (private static factory). `getReport()` calls `this.http.get<{ data: IntegrityReport }>('/integrity')` and returns `response.data.data`. Auth interceptor mirrors `services/api.ts:23-32`. No imports from `@/services/api` (cookbook §3 compliant).
- `frontend/src/plugins/data-dictionary/dataDictionaryPlugin.ts:12-19, 78-83` — added `INTEGRITY_SERVICE_TOKEN` import, `IntegrityService` import, and a `ctx.provide({ provide: INTEGRITY_SERVICE_TOKEN, useValue: new IntegrityService() })` block immediately after the existing STEREOTYPE registration. Pattern B has no kernel dependencies; no Proxy needed.
- `frontend/src/pages/IntegrityPage.tsx:21-26, 166-180, 183-196` — replaced `import { integrityApi }` with `useService`/`INTEGRITY_SERVICE_TOKEN`/`type IntegrityService` imports; added `const integrity = useService<IntegrityService>(INTEGRITY_SERVICE_TOKEN)`; call site changed from `integrityApi.getReport()` to `integrity.getReport()`; `useCallback` dep array updated to `[integrity]`. Loading/error `useState` retained with a `TODO(#155-followup)` inline comment citing cookbook §1.5 carve-out (per spec Risk 1).
- `frontend/src/pages/HomePage.tsx:14, 23-32, 79-81, 143-146, 161-163` — dropped `integrityApi` from the multi-named import; added `useService`/`INTEGRITY_SERVICE_TOKEN`/`type IntegrityService` imports; added `const integrity = useService<IntegrityService>(INTEGRITY_SERVICE_TOKEN)`; the integrity KPI call site became `integrity.getReport()`; `useEffect` dep array updated to `[integrity]`. Doc comment at line 15 updated to reference `IntegrityService.getReport()` (was `integrityApi.getReport()`).
- `frontend/src/services/api.ts:3, 628-651` — deleted the `// Integrity API (#85 R5)` block plus the entire `export const integrityApi = { ... }` declaration (24 lines). Also removed the now-unused `PhysicalConstraint` symbol from the line-3 type-imports list (mechanical follow-on; only consumer was `integrityApi`).

## Build status
- frontend tsc + vite build: PASS (`npm run build` succeeded, 1694 modules, 0 errors).
- frontend tsc --noEmit (incl. tests): pre-existing baseline `AIChatPanel.*.test.tsx scrollIntoView` errors (9 files), confirmed via `git stash` + recheck. New diff-introduced failure: `IntegrityPage.test.tsx:23` references the deleted `integrityApi` export. This is the test-author's rewrite responsibility per spec "Files touched" (test-rewrite line); per agent prompt "Do not write tests".
- frontend lint: BASELINE FAIL (ESLint cannot find a configuration file under `frontend/src` or ancestors). Confirmed pre-existing via stash + recheck. Not caused by this PR.
- backend: not touched.

## Acceptance criteria spot-check
- A1 token exists and is unique: PASS — `tokens.ts:52`.
- A2 service is self-contained: PASS — no `services/api` import.
- A3 DI registration in `initialize` with `useValue` shape: PASS — verified.
- A4 IntegrityPage uses `useService`: PASS — `IntegrityPage.tsx:172`; no `integrityApi` residue.
- A5 HomePage migrated: PASS — `HomePage.tsx:81`; no `integrityApi` residue.
- A6 `integrityApi` gone from `api.ts`: PASS.
- A7 no surviving consumer outside `__tests__`: PASS.
- A8/A9/A10 test acceptance: deferred — test files are test-author's deliverable per the spec's "Files touched" section.

## Spec note (non-blocking)
The spec's `api.ts` deletion instruction said "Type imports `PhysicalConstraint`, `Rule` stay (used by other sub-APIs)." Verified: `Rule` is still used by `ruleApi` (lines 581-625), but `PhysicalConstraint` had a single in-file reference inside the deleted `integrityApi` block — after deletion the symbol becomes unused and `noUnusedLocals: true` fails tsc. Removed `PhysicalConstraint` from the line-3 type-imports list as a mechanical follow-on to the spec's deletion (no semantic divergence). Not escalated since the public-surface change is exactly what the spec asked for; the import line is a trivial corollary edit.

## Unrelated issues noticed (not fixed)
- `frontend/src/services/api.ts:1-32` — the legacy `api` axios singleton, its `mock-token-for-testing` fallback (line 25), and the `getAllPackageHierarchies` function declared *before* the `api` instance (which works only by hoisting) are known cookbook §3 anti-patterns. Out of scope for #155 pilot.
- `frontend/src/plugins/auth/AuthService.ts` — imports `authApi` from `../../services/api`, the precedent anti-pattern called out in the spec's "Scope discovery" section. Out of scope for this PR.
- Baseline `AIChatPanel.*.test.tsx` errors (9 files, `scrollIntoView` on `never`) and missing eslint config remain. Both pre-existed `arch/166-stereotype-slice`.

## Anything the spec didn't cover that I had to decide
- **Removed `PhysicalConstraint` from `api.ts` type-imports** when deletion of `integrityApi` left it unused. Spec said the imports "stay" but `PhysicalConstraint` was only consumed by the deleted block. Rationale: `noUnusedLocals: true` would otherwise turn this into a new tsc failure. No semantic change. Documented above; not escalated because it doesn't alter the public surface or the deletion the spec authorized.
