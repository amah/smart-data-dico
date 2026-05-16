# Dev notes — #155-search (cycle 1)

## Changes

- `frontend/src/plugins/search/services/SearchService.ts` (NEW, lines 1-75) — Pattern B class with `searchEntities(query, filters?)`. Mirrors `IntegrityService.ts` structure: private `http: AxiosInstance`, optional ctor injection, static `createDefaultHttp()`. Exports `SearchResponse` and `SearchFilters` interfaces. Does not import from `@/services/api`.
- `frontend/src/plugins/search/searchPlugin.ts` (lines 9-31) — Added imports for `SEARCH_SERVICE_TOKEN` and `SearchService`; added `ctx.provide({ provide: SEARCH_SERVICE_TOKEN, useValue: new SearchService() })` inside `initialize` per eager `useValue` pattern.
- `frontend/src/store/slices/searchSlice.ts` (lines 1-41) — Replaced `servicesApi` import with `useService`, `SEARCH_SERVICE_TOKEN`, and `import type { SearchService }`. Thunk body now resolves `SearchService` via `useService<SearchService>(SEARCH_SERVICE_TOKEN)` at call time. Added `TODO(#154)` comment about future slice rehoming. Added comment documenting the pre-existing reducer type mismatch bug.
- `frontend/src/components/SearchComponent.tsx` (lines 1-68) — Added imports for `useService`, `SEARCH_SERVICE_TOKEN`, and `SearchService`/`SearchFilters` from the new service. Added `const search = useService<SearchService>(SEARCH_SERVICE_TOKEN)` in component body. Replaced `servicesApi.searchEntities(...)` with `search.searchEntities(...)`. Replaced `const backendFilters: any = {}` with properly typed `const backendFilters: SearchFilters = {}`. `servicesApi` import stays (used for `getAllServices`); `stereotypeApi` import stays.
- `frontend/src/services/api.ts` (lines 72-81 deleted) — Deleted the `searchEntities` method from `servicesApi`. All other methods untouched.

## Build status

- frontend: tsc + vite build clean (1737 modules transformed, 0 errors)
- backend: not touched by this spec
- frontend lint: BASELINE BROKEN (pre-existing) — ESLint cannot find a configuration file. Confirmed by stash-and-recheck: the failure exists on `main` before any of this ticket's changes. Not introduced here.
- backend lint: not applicable

## Unrelated issues noticed (not fixed)

- `frontend/src/store/slices/searchSlice.ts:64` — pre-existing type mismatch: `state.results` is typed `SearchResult[]` but `action.payload` is `SearchResponse` (the envelope). Bug is invisible because no component reads `state.search.results` (dead code). Documented in-code for `#154` owners.
- `frontend/` — missing ESLint config file (`.eslintrc.cjs` or equivalent). The `npm run lint` command has been broken on baseline before this ticket.

## Anything the spec didn't cover that I had to decide

- The `backendFilters` local variable type in `SearchComponent.tsx` was `any` in the original code. Since `SearchFilters` was now available as an import from the new service, I used it (`SearchFilters`) for the typed filter object — this is a safe improvement consistent with the spec's public surface and the `SearchFilters` interface the spec defines.
- Placement of `const search = useService<SearchService>(SEARCH_SERVICE_TOKEN)` inside the component: placed immediately after `initialQuery` derivation and before the `useState` hooks, matching the `IntegrityPage.tsx` precedent pattern.
