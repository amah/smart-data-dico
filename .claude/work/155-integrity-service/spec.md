# Spec — #155 (slice): IntegrityService — Pattern B pilot

## Goal

Validate the DI-token-per-service pattern declared by #155 on the **simplest possible surface**: one Pattern B (REST wrapper) service over a single computed endpoint, consumed by one page. The #155 ticket body specifies `INTEGRITY_SERVICE_TOKEN` as a `data-dictionary`-owned Pattern B service: *"Computed report over the workspace"*. This pilot creates the token, the service, the DI registration in `dataDictionaryPlugin.ts`, migrates `IntegrityPage.tsx` (and the second consumer found during research — `HomePage.tsx`) to consume it via the `useService(...)` hook already added in PR #172, deletes the `integrityApi` sub-API from `frontend/src/services/api.ts`, and stops there. Per the orchestrator's hard scope this slice deliberately does NOT do any other #155 catalog service, does NOT touch Store FS (Pattern B is REST-shaped — no Store FS facade, no autosave middleware), and does NOT add caching/retry/lint guardrails. The pilot is the first time `api.ts` actually shrinks — the previous proofs (#156 notification, #166 stereotype) added DI surface without removing legacy axios sub-APIs.

## Branch base

This branch is cut from `arch/166-stereotype-slice` (PR #172), **not from `main`**. PR #172 introduces:
- `frontend/src/kernel/useService.ts` (consumer hook — required for the migration)
- `STORE_FS_TOKEN` and `STEREOTYPE_SERVICE_TOKEN` in `frontend/src/kernel/tokens.ts`
- The `STORE_MANAGER_TOKEN`/`STORE_FS_TOKEN` plumbing in `dataDictionaryPlugin.initialize`

When PR #172 merges to `main`, this branch can rebase onto `main` cleanly (no file overlaps with this spec's diff except the additive append to `tokens.ts` and a single-line additive change in `dataDictionaryPlugin.initialize`). If PR #172 is delayed past this PR, the spec MUST be unblocked by either (a) waiting for #172, or (b) cherry-picking `useService.ts` standalone — (a) is recommended.

## Scope discovery (corrections to orchestrator pre-checks)

- **Orchestrator pre-check said `IntegrityPage.tsx` is the only consumer.** Verified WRONG — `HomePage.tsx:27,141` ALSO imports and calls `integrityApi.getReport()` (for the workspace KPI strip — error-severity rule count). Confirmed by `grep -rn integrityApi frontend/src` returning 4 source-file hits across `IntegrityPage.tsx`, `HomePage.tsx`, `api.ts`, and the IntegrityPage test. Since the spec deletes `integrityApi` from `api.ts`, **HomePage must be migrated in the same PR** or the build breaks. This expands the scope by one component but does not change the pattern.
- **Orchestrator pre-check on the route path.** The #155 body cited `/api/integrity-report`; verified the actual route is `/api/integrity` (`backend/src/routes/index.ts:136`). The service calls `/integrity` (axios `baseURL: '/api'` per `frontend/src/services/api.ts:16`). This is unchanged by the spec — the backend route is fixed at `/api/integrity` and #157 will reorganize routes later.
- **Cookbook §2 anti-pattern present.** `IntegrityPage.tsx:171-172` declares `useState<boolean>(false)` named `loading` and `useState<string | null>(null)` named `error`. Per cookbook §2 ("Loading, error, dirty — never `useState`"), these are banned for *file IO state* on smart components. The Pattern B integrity endpoint is **not** a file fetch — it is a computed report with no Store FS node to hang state on. Cookbook §2's prescription (`file?.state.contentLoading`) does NOT apply to Pattern B. Cookbook §1.5 carve-out for "ephemeral UI state" arguably covers a one-shot fetch's loading flag. The pilot resolves this tension as follows: **the existing `useState<loading>` + `useState<error>` shape is preserved as ephemeral UI state**, with an inline code comment citing the cookbook §1.5 exception and noting that #155 Phase 4 may revisit. Rationale: a Pattern B refactor introducing a new state machine is out of the proof's scope, and the cookbook explicitly does not yet provide a worked example for "Pattern B loading state" (§2 worked example #2 is TODO). Surface as Risk 1.
- **`AuthService.ts` (the existing Pattern B precedent)** imports `authApi` from `'../../services/api'` — itself a cookbook §3 anti-pattern. The new IntegrityService MUST NOT follow this precedent. It owns its axios call directly (cookbook anti-patterns explicitly permit `axios` inside `plugins/*/services/*.ts`).

## Files touched

- `frontend/src/kernel/tokens.ts` — append `INTEGRITY_SERVICE_TOKEN` symbol export with a docblock describing Pattern B / data-dictionary owner.
- `frontend/src/plugins/data-dictionary/services/IntegrityService.ts` — **new**. Thin axios wrapper around `GET /api/integrity` with typed return.
- `frontend/src/plugins/data-dictionary/dataDictionaryPlugin.ts` — extend `initialize` to instantiate `IntegrityService` and `ctx.provide({ provide: INTEGRITY_SERVICE_TOKEN, useValue: ... })`. Pattern B needs no `storeFs` / `storeManager` / `notify` plumbing — the constructor takes no kernel args.
- `frontend/src/pages/IntegrityPage.tsx` — replace `import { integrityApi } from '../services/api'` with `useService(INTEGRITY_SERVICE_TOKEN)`. The single call site at line 187 becomes `service.getReport()`. Loading/error `useState` flags retained per Risk 1.
- `frontend/src/pages/HomePage.tsx` — replace `integrityApi,` in the multi-named import (line 27) and the call at line 141 with `useService(INTEGRITY_SERVICE_TOKEN).getReport()`. Other axios sub-APIs in this file (`servicesApi`, `packageApi`, `gitApi`, `importExportApi`) are untouched — only `integrityApi` is being deleted in this PR.
- `frontend/src/services/api.ts` — delete the `integrityApi` export block (lines 628–651). Confirm no in-file references remain. Type imports `PhysicalConstraint`, `Rule` stay (used by other sub-APIs).
- `frontend/src/pages/__tests__/IntegrityPage.test.tsx` — rewrite the test harness to follow the PR #172 precedent (`StereotypesPage.bootstrap.test.tsx`). The existing test uses `vi.mock('../../services/api', ...)`. Post-migration, the page resolves the service via `useService(INTEGRITY_SERVICE_TOKEN)`, so the test must (a) `await bootstrapApplication()` once in `beforeAll`, (b) re-install an MSW `http.get('/api/integrity', ...)` handler in `beforeEach` (because `frontend/src/test/setup.ts` runs `server.resetHandlers()` in `afterEach`), and (c) render the page inside the production `<Provider store={getStore()}>`. The `vi.mock('../../services/api', ...)` block is deleted entirely; MSW alone backs the HTTP fixture.
- `frontend/src/plugins/data-dictionary/services/__tests__/IntegrityService.test.ts` — **new**. Unit-test the service in isolation via **constructor injection of a stub `AxiosInstance`** (the `IntegrityService(http?)` parameter is exposed precisely for this). No `vi.mock` of `axios` — the repo uses MSW for HTTP, and direct stubbing of the injected http client is cleaner for the unit-test layer.
- `frontend/src/plugins/data-dictionary/__tests__/dataDictionaryPlugin.test.ts` — **new** (if it does not already exist on the branch base — verify; if PR #172 added one for STEREOTYPE_SERVICE_TOKEN, EXTEND it with the integrity assertion rather than duplicating). Uses the same `bootstrapApplication()` + singleton `host` precedent as #172's bootstrap test — asserts that bootstrapping the full application registers a non-null value at `INTEGRITY_SERVICE_TOKEN` with a `getReport` method.

## Public surface (signatures)

```ts
// frontend/src/kernel/tokens.ts (append)
/**
 * DI token for the IntegrityService.
 *
 * Pattern B per #155 catalog: a REST wrapper around the computed
 * `GET /api/integrity` endpoint (validation + constraints + rules — see
 * CLAUDE.md "Validation / Constraint / Rule" trinity). Owned by the
 * `data-dictionary` plugin; constructed and provided in
 * `dataDictionaryPlugin.initialize`.
 */
export const INTEGRITY_SERVICE_TOKEN = Symbol('IntegrityService');
```

```ts
// frontend/src/plugins/data-dictionary/services/IntegrityService.ts (new)
import axios, { type AxiosInstance } from 'axios';
import type { PhysicalConstraint, Rule } from '../../../types';

/** Row shape inside `IntegrityReport.validation`. */
export interface IntegrityValidationRow {
  service: string;
  entityUuid: string;
  entityName: string;
  attributeUuid: string;
  attributeName: string;
  kind: string;
  value: number | string | string[];
}

/** Row shape inside `IntegrityReport.constraints`. */
export interface IntegrityConstraintRow {
  service: string;
  entityUuid: string;
  entityName: string;
  constraint: PhysicalConstraint;
}

/** Computed report returned by `GET /api/integrity`. */
export interface IntegrityReport {
  validation: IntegrityValidationRow[];
  constraints: IntegrityConstraintRow[];
  rules: Rule[];
}

/**
 * Pattern B service — thin axios wrapper over `GET /api/integrity`.
 *
 * NOT a Store FS facade: the integrity report is a computed aggregate
 * server-side (CLAUDE.md "three concepts, three homes"). It has no file
 * shape, so per cookbook §3 (`frontend/docs/patterns.md`) Pattern B
 * applies. The service owns its own axios instance — it does NOT import
 * from `@/services/api` (cookbook anti-pattern). Auth header replication
 * matches `services/api.ts:23-32` for parity with the legacy shim.
 */
export class IntegrityService {
  private readonly http: AxiosInstance;

  /**
   * @param http  Optional injected AxiosInstance. The override exists so
   *              unit tests can pass a stub client (see
   *              `__tests__/IntegrityService.test.ts`). Production code
   *              calls `new IntegrityService()` and receives the default
   *              instance built by `createDefaultHttp()`.
   */
  constructor(http?: AxiosInstance) {
    this.http = http ?? IntegrityService.createDefaultHttp();
  }

  /** Fetch the unified validation + constraints + rules report. */
  async getReport(): Promise<IntegrityReport> {
    const response = await this.http.get<{ data: IntegrityReport }>('/integrity');
    return response.data.data;
  }

  private static createDefaultHttp(): AxiosInstance {
    const instance = axios.create({
      baseURL: '/api',
      headers: { 'Content-Type': 'application/json' },
    });
    instance.interceptors.request.use((config) => {
      // Mirrors api.ts:23-32. The `|| 'mock-token-for-testing'` fallback
      // is a dev-environment hack inherited from api.ts:25 — flag for
      // cleanup alongside that file (out of scope for this PR).
      const token = localStorage.getItem('auth_token') || 'mock-token-for-testing';
      if (token) config.headers.Authorization = `Bearer ${token}`;
      return config;
    });
    return instance;
  }
}
```

```ts
// frontend/src/plugins/data-dictionary/dataDictionaryPlugin.ts (modified initialize body — additive)
//
// Inside `async initialize(ctx)`, AFTER the existing STEREOTYPE_SERVICE_TOKEN
// registration introduced by PR #172. The new lines:

import {
  STORE_FS_TOKEN,
  STEREOTYPE_SERVICE_TOKEN,
  INTEGRITY_SERVICE_TOKEN, // <-- new
} from '../../kernel/tokens';
import { IntegrityService } from './services/IntegrityService'; // <-- new

// ... existing storeFs / storeManager / StereotypeService block stays ...

// Pattern B (#155): no kernel deps — register a self-contained axios wrapper.
ctx.provide({
  provide: INTEGRITY_SERVICE_TOKEN,
  useValue: new IntegrityService(),
});
```

```tsx
// frontend/src/pages/IntegrityPage.tsx (diff — only the import and the call site change)
-import { integrityApi } from '../services/api';
+import { useService } from '../kernel/useService';
+import { INTEGRITY_SERVICE_TOKEN } from '../kernel/tokens';
+import type { IntegrityService } from '../plugins/data-dictionary/services/IntegrityService';

 const IntegrityPage = () => {
+  // Pattern B service — resolved once per render; safe because the kernel
+  // returns the same singleton instance registered in dataDictionaryPlugin.
+  const integrity = useService<IntegrityService>(INTEGRITY_SERVICE_TOKEN);
   // ... existing useState (loading, error) retained — see spec Risk 1 ...

   const fetchReport = useCallback(async () => {
     setLoading(true);
     setError(null);
     try {
-      const data = await integrityApi.getReport();
+      const data = await integrity.getReport();
       setValidation(data.validation as ValidationRow[]);
       ...
     } catch {
       setError('Failed to load the Integrity report. Please try again.');
     } finally {
       setLoading(false);
     }
-  }, []);
+  }, [integrity]);
```

```tsx
// frontend/src/pages/HomePage.tsx (diff)
-import {
-  servicesApi,
-  packageApi,
-  gitApi,
-  integrityApi,
-  importExportApi,
-} from '../services/api';
+import {
+  servicesApi,
+  packageApi,
+  gitApi,
+  importExportApi,
+} from '../services/api';
+import { useService } from '../kernel/useService';
+import { INTEGRITY_SERVICE_TOKEN } from '../kernel/tokens';
+import type { IntegrityService } from '../plugins/data-dictionary/services/IntegrityService';

 const HomePage = () => {
   ...
+  const integrity = useService<IntegrityService>(INTEGRITY_SERVICE_TOKEN);

   useEffect(() => {
     let cancelled = false;
-    integrityApi.getReport()
+    integrity.getReport()
       .then((report) => {
         if (cancelled) return;
         const errors = (report.rules || []).filter((r: any) => r.severity === 'error').length;
         setKpis(prev => ({ ...prev, integrityErrors: errors }));
       })
       .catch(() => { /* best effort */ });
     ...
     return () => { cancelled = true; };
-  }, []);
+  }, [integrity]);
```

```ts
// frontend/src/services/api.ts (deletion)
// Delete lines 628-651 entirely (the `// Integrity API (#85 R5)` comment
// block plus the `export const integrityApi = { ... }` declaration).
// No other edits to this file.
```

## Framework APIs used

- `@hamak/microkernel-spi` — `PluginModule`, `InitializationContext.provide<T>(prov: Provider<T>): void` — used to register the service. Confirmed at `frontend/node_modules/@hamak/microkernel-spi/dist/plugin.d.ts:3,17-21`.
- `@hamak/microkernel-api` — `ValueProvider<T> = { provide: Token<T>; useValue: T }`, `Token<T> = string | symbol | Constructor<T>`, `ProvidedServices.resolve<T>(token: Token<T>): T` (the type backing `host.rootActivationCtx`). Confirmed at `frontend/node_modules/@hamak/microkernel-api/dist/types.d.ts:1-3,42-45,52-58`.
- **Local consumer hook** `useService<T>(token: symbol | string): T` from `frontend/src/kernel/useService.ts` — introduced by PR #172, NOT redefined here. Confirmed via `git show arch/166-stereotype-slice:frontend/src/kernel/useService.ts` — signature `export function useService<T>(token: symbol | string): T`.
- **Local bootstrap helper** `bootstrapApplication(): Promise<void>` + singleton `host` + `getStore()` from `frontend/src/kernel/bootstrap.ts` — used by both test files (plugin-bootstrap and page-level). Confirmed via `git show arch/166-stereotype-slice:frontend/src/pages/__tests__/StereotypesPage.bootstrap.test.tsx` — the same precedent pattern is used for the STEREOTYPE_SERVICE_TOKEN proof.
- **No** `@hamak/ui-store-impl` `StoreFileSystemFacade`, `createFileSelector`, `FileSystemNodeAction` usage — Pattern B is REST-shaped and bypasses Store FS entirely. This is a deliberate property of Pattern B per #155 catalog row for `INTEGRITY_SERVICE_TOKEN` and per cookbook §3 ("methods wrap computed REST endpoints (search, integrity, lineage, AI chat)").
- **No** `notification-api` / `commands.run('notification.error', ...)` integration — the IntegrityPage's existing error display (`{error && (<div ...>{error}</div>)}` block) is preserved unchanged. The orchestrator's coordination note ("integrity errors surface via the existing page's error display, not via `notification.error` — keep it simple for the Pattern B proof") is honored.
- `axios` — imported directly into `IntegrityService.ts`. Allowed by cookbook anti-pattern carve-out (`import axios from 'axios'` is forbidden *outside* `plugins/*/services/*.ts`; inside one such file it is the canonical Pattern B transport).
- **`msw` / `http` / `HttpResponse`** — used by both the page-level test and the bootstrap test for HTTP fixtures, matching `frontend/src/test/setup.ts` + `StereotypesPage.bootstrap.test.tsx` precedent. No `vi.mock('axios')` anywhere in this PR.

## Acceptance criteria

The CI baseline rule (post-#156 calibration) applies: do NOT pin acceptance criteria to whole-project `tsc --noEmit` or `npm run lint` — both are baseline-broken. Use targeted greps and `npx vitest run` on the specific test files this PR adds or touches.

1. **Token exists and is unique.** `grep -nE "^export const INTEGRITY_SERVICE_TOKEN" frontend/src/kernel/tokens.ts` returns exactly one line. `typeof INTEGRITY_SERVICE_TOKEN === 'symbol'` at runtime. The token value differs from every other token declared in `tokens.ts` (distinct `Symbol(...)` calls).
2. **Service file is self-contained.** `grep -nE "from ['\"](.*)?services/api['\"]" frontend/src/plugins/data-dictionary/services/IntegrityService.ts` returns no matches (the service does NOT depend on the legacy `api.ts` axios singleton; cookbook §3 compliance).
3. **DI registration happens during initialize, not activate.** Reading `frontend/src/plugins/data-dictionary/dataDictionaryPlugin.ts`: the `ctx.provide({ provide: INTEGRITY_SERVICE_TOKEN, ... })` call appears inside the `async initialize(ctx)` body. `Provider` shape is `useValue` (not `useClass` / `useFactory`) — instance is constructed eagerly at `initialize` time.
4. **The page consumes the service via the kernel hook.** `grep -n "useService(INTEGRITY_SERVICE_TOKEN)" frontend/src/pages/IntegrityPage.tsx` returns at least one hit. `grep -n "integrityApi" frontend/src/pages/IntegrityPage.tsx` returns zero hits.
5. **HomePage migrated in the same PR.** `grep -n "useService(INTEGRITY_SERVICE_TOKEN)" frontend/src/pages/HomePage.tsx` returns at least one hit. `grep -n "integrityApi" frontend/src/pages/HomePage.tsx` returns zero hits.
6. **`integrityApi` is gone from `api.ts`.** `grep -nE "^export const integrityApi" frontend/src/services/api.ts` returns zero hits. `grep -nE "\bintegrityApi\b" frontend/src/services/api.ts` returns zero hits.
7. **No surviving consumer.** Repo-wide `grep -rn "integrityApi" frontend/src` returns zero hits.
8. **IntegrityService unit test green.** `npx vitest run frontend/src/plugins/data-dictionary/services/__tests__/IntegrityService.test.ts` passes. The test:
   - Constructs `new IntegrityService(stubHttp)` where `stubHttp` is a hand-rolled object satisfying the subset of `AxiosInstance` the service uses: `{ get: vi.fn() }` typed as `Pick<AxiosInstance, 'get'> & Partial<AxiosInstance>`, cast through `unknown` if needed. **No `vi.mock('axios')`.**
   - Asserts `getReport()` calls `stubHttp.get` with the literal argument `'/integrity'` (the relative path; `baseURL: '/api'` is configured on the default instance, the call uses the relative form).
   - Asserts the returned promise resolves to `response.data.data` (one layer of `.data` unwrap, matching backend's `{ data: IntegrityReport }` envelope per the existing route).
   - When `stubHttp.get` is configured to reject, the promise rejects (no internal try/catch swallowing — the page is responsible for surfacing the error).
9. **Plugin bootstrap test green.** `npx vitest run frontend/src/plugins/data-dictionary/__tests__/dataDictionaryPlugin.test.ts` passes. The test follows the PR #172 precedent (`frontend/src/pages/__tests__/StereotypesPage.bootstrap.test.tsx`):
   - In a `beforeAll`, calls `await bootstrapApplication()` (imported from `frontend/src/kernel/bootstrap.ts`). This mutates the singleton `host` in place and runs the full production plugin chain (store, store-fs, remote-fs, data-dictionary, etc.) — no manual `new Host(...)` construction, no manual `dependsOn` list.
   - Asserts `host.rootActivationCtx` is defined.
   - Resolves the integrity service: `const svc = host.rootActivationCtx!.resolve<IntegrityService>(INTEGRITY_SERVICE_TOKEN);`
   - Asserts `svc` is truthy and `typeof svc.getReport === 'function'`.
   - Test file is isolated: it does NOT share state with other test files because the production singleton bootstrap is performed once in `beforeAll` and the file has no cross-test interactions that depend on a fresh host.
10. **IntegrityPage page-level test green.** `npx vitest run frontend/src/pages/__tests__/IntegrityPage.test.tsx` passes. The test harness follows the PR #172 precedent:
    - `beforeAll` calls `await bootstrapApplication()`.
    - `beforeEach` (NOT `beforeAll`) registers an MSW handler: `server.use(http.get('/api/integrity', () => HttpResponse.json({ data: sampleReport })))` — re-installation is required because `frontend/src/test/setup.ts` runs `server.resetHandlers()` in `afterEach`.
    - Renders the page inside the production store: `render(<Provider store={getStore()}><MemoryRouter><IntegrityPage /></MemoryRouter></Provider>)`.
    - Existing assertions (tab counts, search filtering, error state) pass against the MSW fixture.
    - The previous `vi.mock('../../services/api', ...)` block is **fully deleted**; the integrity sub-API no longer exists to mock.
11. **HomePage existing test status.** Confirmed via `ls frontend/src/pages/__tests__/ | grep -i home` on the branch base — no `HomePage.test.tsx` file exists. This criterion is therefore vacuously satisfied and requires no work; documented here as a confirmed fact, not a verification step.
12. **Full Vitest suite green on the head commit.** `cd frontend && npm test -- --run` reports zero failing tests. Acceptance: the test count is `baseline-of-arch/166-stereotype-slice` PLUS the two new test files. No previously-passing test goes red.
13. **Does NOT pin tsc/lint.** The above criteria do not include `tsc --noEmit` or `npm run lint`, per the post-#156 calibration note (baseline-broken).

## Out of scope

- **Other #155 catalog services** — `DICTIONARY_SERVICE_TOKEN`, `CASE_SERVICE_TOKEN`, `RULE_SERVICE_TOKEN`, `IMPORT_EXPORT_SERVICE_TOKEN`, `DIFF_SERVICE_TOKEN`, `SEARCH_SERVICE_TOKEN`, `VISUALIZATION_SERVICE_TOKEN`, `AI_SERVICE_TOKEN`. Each gets its own follow-up under the #155 umbrella.
- **Store FS adoption (Pattern A)** — done in PR #172 for STEREOTYPE_SERVICE_TOKEN; not relevant here since integrity is Pattern B.
- **Caching / retry / deduplication** of the integrity REST call. The home page fires one fetch on mount; the integrity page fires another on its mount. Two requests per session is acceptable. Cookbook §3 explicitly defers per-call caching to "if measurements show it matters."
- **ESLint guardrail** (`no-restricted-imports` forbidding `@/services/api` outside `plugins/*/services/`) — deferred per #155's "out of scope" until `api.ts` shrinks further. Adding it now would falsely flag the 65+ remaining legitimate consumers of other sub-APIs.
- **Any UX change to IntegrityPage** beyond switching the data source. The page's loading/error/tab/search/Needs-attention behaviors stay identical.
- **`useService` hook implementation** — defined by PR #172. This spec consumes it, does not redefine it.
- **Cookbook §2 retrofit** for the IntegrityPage's `useState<loading>` / `useState<error>` — captured as Risk 1; defer to a follow-up (or to the eventual cookbook worked-example for Pattern B loading state). Reviewer-suggested follow-up: a `// TODO(#155-followup)` anchor in `IntegrityPage.tsx` referencing the deferred cookbook §2 Pattern B sub-section.
- **`AuthService` cleanup** — the existing `frontend/src/plugins/auth/AuthService.ts` imports from `../../services/api`, an anti-pattern. NOT touched in this PR. The new IntegrityService deliberately diverges from that precedent without breaking it.
- **Tests for the auth-interceptor duplication** — Risk 4 is a deliberate, accepted drift. No tests assert parity between `api.ts:23-32` and `IntegrityService.createDefaultHttp` because the duplication is the explicit cost of cookbook §3.
- **Backend route reshape** (#157) — `/api/integrity` stays at its current URL. When #157 lands, only the service's relative-path constant changes.

## Dependencies

- **Branches off `arch/166-stereotype-slice` (PR #172, OPEN).** Inherits `frontend/src/kernel/useService.ts` and the `bootstrapApplication()` + singleton `host` test precedent. Will merge in sequence after #172, or rebase onto `main` post-#172-merge.
- **Coordinates with PR #171 (#156 notification factory adoption).** Independent — no notification calls in this slice's diff. If both PRs touch `dataDictionaryPlugin.ts` near-simultaneously, the merge conflict is mechanical (PR #171 does not edit `dataDictionaryPlugin.ts`; only `notificationPlugin.ts`).
- **Coordinates with #157 (REST route reorganization).** The `/api/integrity` path is referenced exactly once in this PR (inside `IntegrityService.getReport`). When #157 renames it, that single string is the only change.
- **Coordinates with #161/#162.** `data-dictionary`'s `initialize` gains one additional `ctx.provide` call. Neither #161 (case/rule folding) nor #162 (ai-assistance extraction) shares files with this PR.
- **NOT blocked by amah/app-framework#10/#11/#12.** Those bugs (Store FS / autosave / YAML round-trip) apply only to Pattern A. Pattern B is pure axios over a computed endpoint.

## Risks

1. **Cookbook §2 deferral for Pattern B loading state.** The migration preserves `useState<boolean>(loading)` and `useState<string | null>(error)` in `IntegrityPage.tsx`, contradicting the strict reading of cookbook §2. *Mitigation:* the cookbook §2 worked example is TODO and §2's prescription (`file.state.contentLoading`) is Store-FS-shaped — no equivalent exists for Pattern B today. The pilot adds an inline `// TODO(#155-followup)` comment citing cookbook §1.5 ephemeral-UI-state. Acknowledged as deferred technical debt, not a hidden contradiction.
2. **`useService` resolution before bootstrap.** `useService` throws if `host.rootActivationCtx` is null (per PR #172's implementation). If a test renders `IntegrityPage` outside a bootstrapped host, the test crashes with a clear error message. *Mitigation:* both new test files explicitly call `await bootstrapApplication()` in `beforeAll`, matching the StereotypesPage.bootstrap.test.tsx precedent. Document in the test file headers.
3. **HomePage migration creates a second consumer site.** The orchestrator's pre-check missed HomePage, so the original "single-service slice" framing was slightly off. *Mitigation:* the migration is one-line-per-call-site, the pattern is identical, and acceptance criterion 5 covers it. No expanded blast radius beyond the import + one call line in `HomePage.tsx`.
4. **Auth header parity with `api.ts`.** `IntegrityService.createDefaultHttp` duplicates the `localStorage.getItem('auth_token') || 'mock-token-for-testing'` interceptor from `api.ts:23-32`. If the legacy api.ts interceptor changes (e.g., a future PR adds a 401 retry), the IntegrityService's interceptor will drift. *Mitigation:* none in this PR — duplication is the deliberate cost of cookbook §3 (services don't import from `api.ts`). A follow-up may extract a shared `createAuthedHttp()` helper into the plugin layer. Surface as known drift, accept it.
5. **MSW bootstrap in IntegrityPage test is heavier than the original `vi.mock`.** The rewritten test does more setup (`bootstrapApplication()` once, MSW handler per test, Provider wrap) than the prior import-mock — closer to 30 lines than 10. *Mitigation:* the new test exercises the real DI path, catching wiring regressions that the mock-based test could not. Setup is factorable into a `renderPageWithKernel()` helper. Acceptable tradeoff for a proof.
6. **MSW handler bleed.** `frontend/src/test/setup.ts` registers `afterEach: server.resetHandlers()`. The IntegrityPage page test MUST re-install its `/api/integrity` handler in `beforeEach`, not `beforeAll`, or the handler is wiped after the first test. *Mitigation:* this is pinned in acceptance criterion #10 explicitly. The StereotypesPage.bootstrap.test.tsx precedent already navigates this — copy that pattern.
7. **Branch-base churn on `arch/166-stereotype-slice`.** PR #172 is OPEN and may receive review-requested changes that touch `dataDictionaryPlugin.ts:initialize`. *Mitigation:* sequencing — merge #172 first, then rebase this branch onto `main`. The additive `ctx.provide` block for INTEGRITY_SERVICE_TOKEN sits AFTER the STEREOTYPE registration, so any non-trivial rework of the STEREOTYPE block forces a manual rebase. Cost is bounded to re-applying one `ctx.provide` call.
