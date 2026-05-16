# Dev notes — #155-diff  (cycle 1)

## Changes

- `frontend/src/kernel/tokens.ts:54-64` — added `DIFF_SERVICE_TOKEN = Symbol('DiffService')` with docblock mirroring `INTEGRITY_SERVICE_TOKEN` pattern; placed immediately after it.
- `frontend/src/plugins/data-dictionary/services/DiffService.ts` — new file. Pattern B class with `getLogical`, `getPhysicalConfig`, `getPhysicalForService`, `getPhysicalAll` methods, optional injected `AxiosInstance`, private static `createDefaultHttp()` mirroring `IntegrityService.ts` verbatim. Exports `LogicalDiffOperand`, `PhysicalDiffSource`, `PhysicalConfig` (cycle-2 narrow type), and three opaque result types.
- `frontend/src/plugins/data-dictionary/dataDictionaryPlugin.ts:16,21,90-94` — imported `DIFF_SERVICE_TOKEN` and `DiffService`; added `ctx.provide({ provide: DIFF_SERVICE_TOKEN, useValue: new DiffService() })` inside `initialize`, immediately after the `INTEGRITY_SERVICE_TOKEN` provider block.
- `frontend/src/pages/LogicalDiffPage.tsx:18,24-27,235,270,278` — removed `diffApi` from import; added `useService`, `DIFF_SERVICE_TOKEN`, `DiffService` type imports; resolved service as `diffSvc` at component top (named `diffSvc` to avoid collision with `const [diff, setDiff]`); replaced `diffApi.logical(left, right)` with `diffSvc.getLogical(left, right)`; added `diffSvc` to `runDiff` dependency array; fixed stale comment `diffApi.logical` → `diff.getLogical`.
- `frontend/src/pages/PhysicalDiffPage.tsx:10-18,80,99,103,114,143,162-169,176` — removed `import axios from 'axios'`, removed local `axios.create` + interceptor block, removed `diffApi` import; added `useService`, `DIFF_SERVICE_TOKEN`, `DiffService`, `PhysicalConfig` imports; resolved service as `diffSvc`; updated `physicalConfigs` state type from `Record<string, any>` to `Record<string, PhysicalConfig>`; replaced `diffApi.getPhysicalConfig(svc)` with `diffSvc.getPhysicalConfig(svc)`, `diffApi.physicalAll(...)` with `diffSvc.getPhysicalAll(...)`, and bare `api.post('/diff/physical', ...)` with `diffSvc.getPhysicalForService(service, ...)` (result unwrapped directly by service); added `diffSvc` to both the `useEffect` and `runDiff` dependency arrays.
- `frontend/src/services/api.ts:414-445` — deleted `export const diffApi = { ... }` block (32 lines). The `// Diff API (#86)` / `// Project management (#95)` comment pair at lines 375-376 (precede `filesystemApi`, not `diffApi`) were left untouched per spec cycle-2 fix.

## Build status

- frontend: tsc + vite build clean (0 errors, 0 warnings beyond pre-existing chunk-size advisory)
- backend: not touched
- frontend lint: pre-existing baseline failure — no ESLint config file exists in `frontend/` (not introduced by this PR; confirmed same failure on `main` before any changes)

## Unrelated issues noticed (not fixed)

- `frontend/` — no `.eslintrc.*` or `eslint.config.*` file exists; `npm run lint` always fails with "ESLint couldn't find a configuration file". Pre-existing, unrelated to this slice.
- `frontend/src/plugins/data-dictionary/dataDictionaryPlugin.ts` — the worktree already contains concurrent changes from the `155-import-export` slice (`IMPORT_EXPORT_SERVICE_TOKEN` and `ImportExportService` imports). These are additive and non-conflicting; the orchestrator will resolve them at merge order time.

## Anything the spec didn't cover that I had to decide

- **Variable naming in `LogicalDiffPage.tsx`**: The spec used `diff` as the service variable name (matching `IntegrityPage.tsx`'s `service` pattern), but `const [diff, setDiff]` already exists in the component. Renamed the service variable to `diffSvc` (matching `PhysicalDiffPage.tsx`'s natural name) to avoid the collision. The prose comment fix at line 18 still reads `diff.getLogical` per spec (comment convention, not variable name).
- **`PhysicalDiffPage.tsx` single-service result**: After replacing `api.post(...)` with `diffSvc.getPhysicalForService(...)`, the result is the unwrapped `PhysicalDiff` data (the service unwraps `r.data.data`). The original code used `response.data.data` in two places — both updated to use the direct `data` variable. Cast as `PhysicalDiff` at the read site since `getPhysicalForService` returns `PhysicalDiffResult = unknown`.
- **`diffSvc` added to useEffect and useCallback dependency arrays**: `diffSvc` is used inside both closures but was not in the original dependency arrays (original `api`/`diffApi` were module-level singletons). Added it for correctness, though in practice `useService` returns the same singleton every render (DI cache — as noted in cookbook §3 anti-patterns). No behavior change.
