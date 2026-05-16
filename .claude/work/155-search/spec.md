# Spec — #155-search: SearchService Pattern B proof

## Goal

Carve out a third Pattern B service from `frontend/src/services/api.ts` per the
#155 catalog: extract `servicesApi.searchEntities(query, filters?)` into a
self-contained `SearchService` registered under `SEARCH_SERVICE_TOKEN` from the
**search plugin** (not `data-dictionary` — unlike the integrity precedent).
Mirror the just-merged `IntegrityService` shape (PR #173 / commit `5a48c44`):
constructor-injectable `AxiosInstance`, no import from `@/services/api`, eager
`useValue` provider in `initialize`. Consumers (`SearchComponent.tsx` and the
Redux thunk in `searchSlice.ts`) move off `servicesApi.searchEntities` to the
new service via `useService<SearchService>(SEARCH_SERVICE_TOKEN)`. After the
PR, `searchEntities` is **gone from `api.ts`** and a grep guard prevents
regressions. This proves the DI-token-per-service pattern works in a second
plugin and continues #155 Phase 4's deletion campaign against `api.ts`.

## Files touched

### Production code
- `frontend/src/plugins/search/services/SearchService.ts` — NEW. Pattern B class with `searchEntities(query, filters?)`. Mirrors `IntegrityService.ts` structure (private `http: AxiosInstance`, optional ctor injection, static `createDefaultHttp()`).
- `frontend/src/plugins/search/searchPlugin.ts` — register `SEARCH_SERVICE_TOKEN` inside `initialize` with an eager `useValue` provider. First service this plugin owns.
- `frontend/src/store/slices/searchSlice.ts` — replace `servicesApi.searchEntities(query)` inside the `createAsyncThunk` with a call to the new service. Slice signature unchanged; remove the `servicesApi` import.
- `frontend/src/components/SearchComponent.tsx` — replace `servicesApi.searchEntities(...)` with `useService<SearchService>(SEARCH_SERVICE_TOKEN).searchEntities(...)`. The `servicesApi.getAllServices()` call stays (out of scope; only `searchEntities` migrates).
- `frontend/src/services/api.ts` — delete the `searchEntities` method from `servicesApi`. All other methods stay.

### Tests
- `frontend/src/plugins/search/services/__tests__/SearchService.test.ts` — NEW. Constructor-injected stub `AxiosInstance`. Covers no-filter, all-filter, partial-filter, and rejection paths. No `vi.mock('axios')`.
- `frontend/src/plugins/search/__tests__/searchPlugin.bootstrap.test.ts` — NEW. `bootstrapApplication()` + `host.rootActivationCtx.resolve(SEARCH_SERVICE_TOKEN)` returns a service with a `searchEntities` method.
- `frontend/src/plugins/search/services/__tests__/spec-grep-guards.search.test.ts` — NEW. Content-guard regressions: token declaration, no `services/api` import in the service, registration shape in plugin, consumer migration, `searchEntities` literal removed from `api.ts`, repo-wide walker for surviving `servicesApi.searchEntities` references.
- `frontend/src/components/__tests__/SearchComponent.test.tsx` — NEW. MSW-driven test: type query, submit, render result row. Mirrors the IntegrityPage test harness (production bootstrap, real `<Provider store={getStore()}>`).

### Files NOT touched (explicitly)
- `frontend/src/kernel/tokens.ts` — `SEARCH_SERVICE_TOKEN` already exists (declared at line 15). No edit required.
- `frontend/src/kernel/bootstrap.ts` — search plugin already registered; reducer registration of `searchSlice` stays in place.
- Any other `servicesApi` method.

## Redux thunk decision — Option (a), with justification

The orchestrator brief asked spec-writer to pick: (a) keep slice+thunk and swap
the internal axios call, (b) eliminate the slice and use component-local state,
or (c) hybrid.

**Decision: Option (a) — keep the slice and thunk; swap the inner call to use
`SearchService`.**

Defence:
1. **Zero observed consumers of the slice.** Grep across `frontend/src` for
   `searchSlice`, `setSearchQuery`, `clearSearch`, and the `searchEntities`
   thunk identifier yields only the slice's own self-references and the
   reducer registration in `bootstrap.ts:35,72`. No component dispatches the
   thunk; no component reads `state.search.results`. `SearchComponent.tsx`
   uses entirely component-local `useState` (`results`, `loading`, `error`)
   for search state. The slice is dead code today.
2. **Eliminating the slice (Option b) is technically cleaner but expands scope
   beyond #155-search's "Pattern B proof" charter.** Removing the slice means
   touching `bootstrap.ts` (drop the reducer line), deleting the slice file,
   and updating `RootState`. That's a separate housekeeping concern owned by
   #154's plugin-slice rehoming work.
3. **The migration of the thunk itself is one-line and proves the pattern.**
   Replacing `servicesApi.searchEntities(query)` inside the thunk with
   `useService<SearchService>(SEARCH_SERVICE_TOKEN).searchEntities(query)`
   exercises the DI resolution path from non-React code (thunks run inside
   Redux middleware, not React render). This is a useful smoke test of the
   "kernel singleton, callable anywhere post-bootstrap" promise.
4. **Risk if the slice has a hidden consumer we missed:** Option (a) preserves
   the public surface bit-for-bit, so the worst case is "thunk still works,
   slice still updates state, just plumbed through a service." Option (b)
   would break that hidden consumer.

Coordination note for #154: when the search plugin's slices/ folder lands,
`searchSlice.ts` moves to `frontend/src/plugins/search/slices/searchSlice.ts`
along with its reducer registration. This spec does NOT pre-do that work;
#154 owners get a slice already wired through the service.

## Public surface (signatures)

```ts
// frontend/src/plugins/search/services/SearchService.ts
import axios, { type AxiosInstance } from 'axios';
import type { SearchResult } from '../../../types';

/** Backend response envelope from `GET /api/search`. */
export interface SearchResponse {
  message: string;
  data: SearchResult[];
}

/** Optional filter object matched 1:1 with the legacy `servicesApi.searchEntities` signature. */
export interface SearchFilters {
  type?: string;
  service?: string;
  stereotype?: string;
  hasMetadata?: string;
}

/**
 * Pattern B service — thin axios wrapper over `GET /api/search`.
 *
 * NOT a Store FS facade: search results are computed server-side and have
 * no file shape (CLAUDE.md). Per cookbook §3 (`frontend/docs/patterns.md`)
 * Pattern B applies. The service owns its own axios instance and does NOT
 * import from `@/services/api` (cookbook anti-pattern). Auth header
 * replication matches `services/api.ts:23-32` for parity with the legacy shim.
 */
export class SearchService {
  private readonly http: AxiosInstance;
  constructor(http?: AxiosInstance);

  /**
   * Returns the response envelope as-is, NOT just `data: SearchResult[]`.
   * Rationale: the legacy `servicesApi.searchEntities` returns `response.data`
   * (axios body), which is `{ message, data: SearchResult[] }`. Both current
   * callers (`SearchComponent.tsx:58` and `searchSlice.ts:22-23`) consume
   * the full envelope. Preserving the same return shape keeps the migration
   * a pure call-site swap with no consumer-side adaptation.
   */
  searchEntities(query: string, filters?: SearchFilters): Promise<SearchResponse>;

  private static createDefaultHttp(): AxiosInstance;
}
```

```ts
// frontend/src/plugins/search/searchPlugin.ts (additions inside initialize)
import { SEARCH_SERVICE_TOKEN } from '../../kernel/tokens';
import { SearchService } from './services/SearchService';

export function createSearchPlugin(): PluginModule {
  return {
    async initialize(ctx) {
      ctx.views.register('routes.search', () => ({
        routes: ['/search', '/entities/flat', '/flat/**', '/tree/**'],
      }));

      // #155-search: Pattern B service registration.
      // Eager useValue — no kernel deps; SearchService is self-contained.
      ctx.provide({
        provide: SEARCH_SERVICE_TOKEN,
        useValue: new SearchService(),
      });
    },

    async activate(_ctx) {
      console.log('[search] Plugin activated');
    },
  };
}
```

```ts
// frontend/src/store/slices/searchSlice.ts (post-migration)
import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import { useService } from '../../kernel/useService';
import { SEARCH_SERVICE_TOKEN } from '../../kernel/tokens';
import type { SearchService } from '../../plugins/search/services/SearchService';
import type { SearchResult } from '../../types';

export const searchEntities = createAsyncThunk(
  'search/searchEntities',
  async (query: string) => {
    // Resolve at call time (after bootstrap). `useService` is just a
    // kernel-resolve wrapper; despite the `use*` name it has no React
    // hooks contract and is safe to call inside thunks.
    const service = useService<SearchService>(SEARCH_SERVICE_TOKEN);
    return await service.searchEntities(query);
  },
);

// setSearchQuery, clearSearch, and the slice itself are UNCHANGED.
```

```tsx
// frontend/src/components/SearchComponent.tsx (delta — header + performSearch only)
import { useService } from '../kernel/useService';
import { SEARCH_SERVICE_TOKEN } from '../kernel/tokens';
import type { SearchService } from '../plugins/search/services/SearchService';
// `servicesApi` import stays — `getAllServices` is still used at line 34.
// `stereotypeApi` import stays.

const SearchComponent = () => {
  // … existing state hooks unchanged …
  const search = useService<SearchService>(SEARCH_SERVICE_TOKEN);

  const performSearch = async (searchQuery: string) => {
    if (!searchQuery.trim()) { setResults([]); return; }
    try {
      setLoading(true);
      setError(null);
      const backendFilters: SearchFilters = {};
      if (filters.type !== 'all') backendFilters.type = filters.type;
      if (filters.service !== 'all') backendFilters.service = filters.service;
      if (filters.stereotype !== 'all') backendFilters.stereotype = filters.stereotype;
      if (filters.hasMetadata) backendFilters.hasMetadata = filters.hasMetadata;
      const response = await search.searchEntities(
        searchQuery,
        Object.keys(backendFilters).length > 0 ? backendFilters : undefined,
      );
      setResults(response.data);
    } catch (err) {
      setError('Failed to perform search.');
    } finally {
      setLoading(false);
    }
  };
  // … rest of component unchanged …
};
```

## Framework APIs used

- `@hamak/microkernel-spi` — `PluginModule`, `InitializationContext` (`frontend/node_modules/@hamak/microkernel-spi/dist/plugin.d.ts`). `PluginModule.initialize(ctx)` receives an `InitializationContext` whose `.provide<T>(prov: Provider<T>): void` accepts a `ValueProvider<T>` shape `{ provide: Token<T>, useValue: T }` — confirmed at `plugin.d.ts:3` and `microkernel-api/dist/types.d.ts:42-45`.
- `@hamak/microkernel-api` — `Token<T>` (`frontend/node_modules/@hamak/microkernel-api/dist/types.d.ts:1`), `Provider<T>` and `ValueProvider<T>` (`types.d.ts:36-51`). `SEARCH_SERVICE_TOKEN: symbol` satisfies `Token<T>` (the union includes `symbol`).
- `frontend/src/kernel/useService.ts` — `useService<T>(token: symbol | string): T` is the DI resolver. Cookbook §3 documents it as the consumer-side mechanism. Confirmed: throws on pre-bootstrap call, throws on missing provider, otherwise returns the resolved instance cast to `T`.
- `@reduxjs/toolkit` — `createAsyncThunk`, `createSlice`. Already used in the file; no signature change.
- `axios` — `AxiosInstance` (and the default `axios.create(...)`/`interceptors.request.use(...)` surface). Already used by `IntegrityService.ts`; no new framework integration.

## Acceptance criteria

These are testable assertions, organized to mirror PR #173's coverage.

### Token + service shape
1. `frontend/src/kernel/tokens.ts` declares `SEARCH_SERVICE_TOKEN` exactly once with `Symbol(...)`. *(Already true on baseline; guard locks against regression.)*
2. `frontend/src/plugins/search/services/SearchService.ts` exists, exports the `SearchService` class, and does **not** import from any `services/api` path (regex: `/from\s+['"][^'"]*services\/api['"]/`).
3. `SearchService` constructor accepts an optional `AxiosInstance` argument; default construction (`new SearchService()`) does not throw and yields an instance with a `searchEntities` method (`typeof service.searchEntities === 'function'`).

### Service unit behavior
4. `searchEntities('alpha')` (no filters) invokes the injected `http.get` exactly once with the URL `/search?q=alpha` (URL-encoded `q` parameter, no other query params).
5. `searchEntities('alpha', { type: 'entity' })` invokes `http.get` with `/search?q=alpha&type=entity`.
6. `searchEntities('alpha', { type: 'entity', service: 'user-service', stereotype: 'Aggregate', hasMetadata: 'pii=true' })` invokes `http.get` with all four query params appended in the same order the legacy `servicesApi.searchEntities` produced (`q`, `type`, `service`, `stereotype`, `hasMetadata`) — preserving the wire-format contract bit-for-bit.
7. `searchEntities('alpha', { service: 'orders' })` (partial filter — only one field set) appends `service` and omits the other filter keys.
8. When `http.get` rejects with `new Error('boom')`, `searchEntities('x')` rejects with the same error (no internal swallow). *(Mirrors IntegrityService criterion #3.)*
9. The promise resolves to the **full backend envelope** `{ message, data: SearchResult[] }` — NOT just the inner array. Verified by asserting `result.data` is an array AND `typeof result.message === 'string'` on the returned object.

### Plugin registration + DI
10. `frontend/src/plugins/search/searchPlugin.ts`'s `initialize` body contains a `ctx.provide(...)` block referencing `SEARCH_SERVICE_TOKEN` with `useValue: ...` (NOT `useClass` or `useFactory`). The provider call sits in `initialize`, not `activate`.
11. `bootstrapApplication()` followed by `host.rootActivationCtx.resolve<SearchService>(SEARCH_SERVICE_TOKEN)` returns a truthy object exposing `searchEntities` as a function. Repeated resolves return the same singleton instance (`===`).

### Consumer migration
12. `frontend/src/components/SearchComponent.tsx` imports `useService` from `../kernel/useService` and contains exactly one `useService<SearchService>(SEARCH_SERVICE_TOKEN)` call. The file contains no `servicesApi.searchEntities` reference. The file MAY still import `servicesApi` (for `getAllServices`).
13. `frontend/src/store/slices/searchSlice.ts` no longer imports anything from `../../services/api`. Its thunk body calls `useService<SearchService>(SEARCH_SERVICE_TOKEN)` and invokes `.searchEntities(query)`.

### `api.ts` deletion
14. `frontend/src/services/api.ts` no longer declares a `searchEntities` method on `servicesApi`. Grep for `searchEntities:` at the property-declaration site returns nothing inside the `servicesApi = {` block. (Other identifiers named `searchEntities` may exist elsewhere — only the `api.ts` declaration is removed.)
15. Repo-wide walk of `frontend/src/**/*.{ts,tsx}` (excluding the grep-guard test file itself by basename suffix) finds zero occurrences of the literal `servicesApi.searchEntities`.

### Component MSW test
16. `SearchComponent.test.tsx` boots the production kernel via `bootstrapApplication()` in `beforeAll`, registers an `/api/search` MSW handler in `beforeEach` (returning `{ message: 'Success', data: [{ type: 'entity', entityName: 'Order', service: 'order-service', name: 'Order', description: 'Order aggregate', path: '...' }] }`), renders `<SearchComponent />` under `<Provider store={getStore()}><MemoryRouter>...</MemoryRouter></Provider>`, types `Order` into the search box, clicks the Search button, and asserts the row containing `Order` appears in the DOM via `findByText`.
17. A second case toggles a filter (`type=entity`) and asserts the request URL captured by the MSW handler contains both `q=Order` and `type=entity`.

## Out of scope

- Migration of any other `servicesApi.*` method (`getAllServices`, `getServiceEntities`, `getLineage`, etc.) — orchestrator brief is explicit.
- Migration of `stereotypeApi.getAll` calls inside `SearchComponent.tsx`.
- Deletion or relocation of `searchSlice.ts` per #154's plugin-slice rehoming. The slice stays where it is; the thunk now calls the service.
- Behavioral changes to search UX (debouncing, ranking, keyboard navigation, filters).
- The eventual `#163 search.entity` command/event integration — deferred entirely.
- Cookbook (`patterns.md`) updates. The existing §3b Pattern B worked example already covers this shape; no additions needed.
- A test for the dead-code slice's thunk (no observed consumer; not worth the harness churn). If a future ticket adds a slice consumer, that ticket adds the test.
- Backend changes to `/api/search` — wire format preserved exactly.

## Dependencies

- **Coordinates with PR #173** — merged on `main` at commit `5a48c44`. This PR is the third Pattern B carve-out from the catalog and the first in a plugin OTHER than `data-dictionary`. The patterns.md §3b worked example documenting Pattern B is already published.
- **Coordinates with #154** — when the search plugin grows its `slices/` folder, `searchSlice.ts` rehomes there along with the reducer registration. This spec leaves the slice in place per (a)-decision above and adds a comment in the slice file noting the future move. Not blocked by #154.
- **Coordinates with #155 catalog** — `SEARCH_SERVICE_TOKEN` was declared in `tokens.ts` (line 15) by an earlier #155 pass. This spec adds the *resolution* (registration + service class).
- Not blocked by anything unmerged.

## Risks

1. **The thunk consumes `useService` at runtime, not at React render.** `useService` is named `use*` but is a plain DI resolver (`frontend/src/kernel/useService.ts:15`). Calling it inside a Redux thunk works because by the time any thunk fires, `bootstrapApplication()` has resolved (the store itself comes from the kernel, so dispatch cannot precede bootstrap). **Mitigation:** the bootstrap-resolves-service test (criterion #11) proves the DI path; if the thunk fires pre-bootstrap in some test, it will throw a clear error from `useService` rather than silently producing `undefined`. No paper-over.

2. **The slice today is dead code; (a)-decision means we ship a thunk no one calls.** **Mitigation:** documented in the spec and called out as a coordination note for #154. Cost of removing it now is scope creep into bootstrap.ts and `RootState`; cost of leaving it is one additional file change in #154's eventual cleanup. Acceptable trade.

3. **Query-string ordering is part of acceptance #6 (`q`, `type`, `service`, `stereotype`, `hasMetadata`).** `URLSearchParams.append` order is insertion-order in all supported browsers and in Node, but a future maintainer reordering the `if` blocks would silently break wire-format parity. **Mitigation:** acceptance #6 explicitly tests the URL string; the test fails on reorder.

4. **`SearchResponse` envelope return.** The legacy method returned `response.data` (the body envelope), and both callers depend on `response.data` (the inner array). If anyone reads the spec quickly and unwraps one layer too many in the service, the consumer sites silently get `undefined.data`. **Mitigation:** acceptance #9 explicitly asserts the returned object has both `message` (string) and `data` (array) fields. The service-level test pins the contract.

5. **`useService` from inside a non-React module (the slice) creates an import cycle risk:** `searchSlice.ts` imports `useService` which imports `bootstrap.ts` which imports `searchSlice.ts` (for the reducer). Vite/Vitest tolerate cycles at runtime but TS module-init ordering can surface odd behavior in CI. **Mitigation:** the import is type-only for `SearchService` (`import type`) and value-only for `useService` and `SEARCH_SERVICE_TOKEN`. The `useService` value is read inside the thunk body (lazy), not at module top-level, so the cycle resolves before the thunk first runs. If a CI failure surfaces a cycle warning, fallback is to resolve once at module top-level via a memoized getter — but defer that change unless the warning fires.
