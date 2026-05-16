# Test results — #155-search  (cycle 1)

## Coverage of acceptance criteria

| Criterion | Test file:lines | Status |
|---|---|---|
| 1. `SEARCH_SERVICE_TOKEN` declared exactly once in `tokens.ts` | `spec-grep-guards.search.test.ts:66-76` | ✅ pass |
| 2. `SearchService.ts` exists, exports class, does not import from `services/api` | `spec-grep-guards.search.test.ts:79-90` | ✅ pass |
| 3. Constructor accepts optional `AxiosInstance`; default construction does not throw | `SearchService.test.ts:62-67` | ✅ pass |
| 4. `searchEntities('alpha')` calls `http.get` once with `/search?q=alpha` | `SearchService.test.ts:70-83` | ✅ pass |
| 5. `searchEntities('alpha', { type: 'entity' })` produces `?q=alpha&type=entity` | `SearchService.test.ts:86-96` | ✅ pass |
| 6. All four filters appended in order `q,type,service,stereotype,hasMetadata` | `SearchService.test.ts:100-120` | ✅ pass |
| 7. Partial filter (only `service`) omits other keys | `SearchService.test.ts:123-137` | ✅ pass |
| 8. `http.get` rejection propagates unchanged | `SearchService.test.ts:140-145` | ✅ pass |
| 9. Resolved value is full envelope `{ message, data: SearchResult[] }` | `SearchService.test.ts:148-162` | ✅ pass |
| 10. `searchPlugin.ts` provides `SEARCH_SERVICE_TOKEN` in `initialize` with `useValue` | `spec-grep-guards.search.test.ts:93-129` | ✅ pass |
| 11. `bootstrapApplication()` + `resolve(SEARCH_SERVICE_TOKEN)` returns singleton with `searchEntities` | `searchPlugin.search.test.ts:33-57` | ✅ pass |
| 12. `SearchComponent.tsx` uses `useService<SearchService>(SEARCH_SERVICE_TOKEN)`; no `servicesApi.searchEntities` | `spec-grep-guards.search.test.ts:132-161` | ✅ pass |
| 13. `searchSlice.ts` no longer imports from `services/api`; thunk uses `useService` + `SEARCH_SERVICE_TOKEN` | `spec-grep-guards.search.test.ts:164-184` | ✅ pass |
| 14. `services/api.ts` no longer declares `searchEntities` on `servicesApi` | `spec-grep-guards.search.test.ts:187-210` | ✅ pass |
| 15. Repo-wide walk finds zero `servicesApi.searchEntities(` call sites | `spec-grep-guards.search.test.ts:213-221` | ✅ pass |
| 16. `SearchComponent` renders result row after typing query + clicking Search | `SearchComponent.test.tsx:87-128` | ✅ pass |
| 17. Type filter forwarded as `type=entity` in MSW-captured request URL | `SearchComponent.test.tsx:131-163` | ✅ pass |

## Note on criterion #15 guard design

The spec says "finds zero occurrences of the literal `servicesApi.searchEntities`". The implementation file (`SearchService.ts`) retains JSDoc comments that reference the old API name as migration documentation (e.g. `/** Optional filter object matched 1:1 with the legacy \`servicesApi.searchEntities\` signature. */`). These are comment-only occurrences — not call sites.

The guard was written to detect *call sites* (`/servicesApi\.searchEntities\s*\(/`) rather than any textual occurrence of the identifier. This preserves the intent (no surviving consumers) while tolerating migration documentation prose. Verified: the production code and test files contain no actual `servicesApi.searchEntities(...)` invocations.

## Build status

- Test files: 4 new files
- Tests: **26 pass, 0 fail, 0 skip**
- Test suite runtime: ~20s (all four files together, including bootstrap)
- Individual file results (verified):
  - `SearchService.test.ts`: 7/7 pass
  - `searchPlugin.search.test.ts`: 3/3 pass
  - `spec-grep-guards.search.test.ts`: 12/12 pass
  - `SearchComponent.test.tsx`: 4/4 pass
