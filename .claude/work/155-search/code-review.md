# Code review — #155-search: SearchService Pattern B proof  (cycle 1)

## Verdict
**required-changes**

The migration is structurally clean, mirrors the IntegrityService precedent
faithfully, framework citations all check out under direct verification, and
all 26 acceptance-criterion tests pass. However, the strongly-typed
`SearchService.searchEntities` exposes a latent type bug in `searchSlice.ts`
that the dev consciously left in place. The thunk now returns
`SearchResponse` (the envelope) but the `.fulfilled` reducer still assigns
that to `state.results: SearchResult[]` — `tsc --noEmit` reports a hard
TS2740 error that did not exist on `main` (the old thunk returned `any`
because `servicesApi.searchEntities` was untyped). This is a regression
introduced by this PR, not a pre-existing condition, even though the
underlying semantic mistake was latent on `main`.

A one-line fix (`state.results = action.payload.data;`) eliminates the
error and corrects the reducer at the same time. The "leave it for #154"
framing in the dev notes is wrong: the bug was tolerable on `main` because
the type system couldn't see it. Now it can.

## Required changes

1. **Fix the type-incompatible assignment in `searchSlice.ts` so the build
   type-checks.**
   - File: `frontend/src/store/slices/searchSlice.ts:64`
   - Problem: `state.results = action.payload;` assigns `SearchResponse`
     (the `{ message, data: SearchResult[] }` envelope returned by the
     migrated thunk) to a `SearchResult[]` field. `tsc --noEmit` reports
     `error TS2740: Type 'SearchResponse' is missing the following
     properties from type 'WritableNonArrayDraft<SearchResult>[]': length,
     pop, push, concat, …`. This error does NOT exist on `main` — the old
     thunk's return type was `any` because `servicesApi.searchEntities` had
     no return-type annotation, and Immer's draft accepted the assignment
     silently. The PR's typing tightening surfaces a real bug.
   - Fix: change line 64 to `state.results = action.payload.data;`. This
     fixes the reducer (it now stores the array, not the envelope), aligns
     with the spec's explicit envelope-preservation decision (the thunk
     returns the envelope, the reducer extracts the array), and clears the
     TS error. Update the in-file comment block (lines 34–37) to remove
     the "pre-existing reducer bug … #154 owners will clean up" note,
     replacing it with a one-liner explaining the unwrap.

## Suggestions (optional, won't block)

- **Dev notes claim "tsc + vite build clean"** but `frontend/package.json`'s
  `build` script is `vite build` only — no `tsc --noEmit` runs in CI either
  (`.github/workflows/ci-cd.yml` has no `tsc` invocation). The dev's claim is
  inaccurate but harmless given how the codebase ships; flag the gap so
  future reviewers don't trust the claim verbatim. After Required Change #1,
  `tsc --noEmit` is no longer regressed by this PR (the residual TS errors
  in `LogicalDiffPage.tsx`, `QualityDashboardPage.tsx`, etc. belong to other
  branches' work).

- **Auth-token interceptor duplication.** `SearchService.createDefaultHttp`
  duplicates the `localStorage.getItem('auth_token') || 'mock-token-for-testing'`
  fallback from `api.ts:25` (and from `IntegrityService.ts:69`). This is the
  precedent and the spec accepts it, but a third copy raises the cost of
  eventually centralising the interceptor. Out of scope for this ticket;
  worth a `// TODO(#155-auth-interceptor)` if such a follow-up exists.

- **`spec-grep-guards.search.test.ts:32` repo-root walk-up depth.** The file
  computes `REPO_ROOT = path.resolve(HERE, '..', '..', '..', '..', '..', '..')`
  — six `..` from `frontend/src/plugins/search/services/__tests__/`. Counted
  by hand: `__tests__` → `services` → `search` → `plugins` → `src` →
  `frontend` → repo root = 6 levels. Correct. Hard to read; a comment
  showing the per-level breakdown (already partially there at line 31) is
  fine. No fix needed.

- **`SearchComponent.test.tsx:97` ESLint disable for `Provider as any`.** The
  cast was inherited from the IntegrityPage test harness — fine for this
  ticket, but if a follow-up updates the React/Redux types, drop the cast.

## Acceptance-criterion coverage

| Criterion | Implemented | Notes |
|---|---|---|
| 1. `SEARCH_SERVICE_TOKEN` declared exactly once in `tokens.ts` | ✅ | `tokens.ts:15` — single Symbol declaration. Guard at `spec-grep-guards.search.test.ts:66-76`. |
| 2. `SearchService.ts` exists, exports class, no `services/api` import | ✅ | Verified — file exists at `frontend/src/plugins/search/services/SearchService.ts:1-75`. |
| 3. Constructor accepts optional `AxiosInstance`; default OK | ✅ | `SearchService.ts:37-39` matches IntegrityService shape. |
| 4. `searchEntities('alpha')` → `/search?q=alpha` | ✅ | Single `http.get` call; URL exact-match asserted. |
| 5. Single filter `{type}` → `/search?q=alpha&type=entity` | ✅ | URL exact-match. |
| 6. All four filters in order `q,type,service,stereotype,hasMetadata` | ✅ | URL exact-match asserts wire-format parity with legacy. |
| 7. Partial filter (only `service`) omits other keys | ✅ | Negative assertions on absent params. |
| 8. `http.get` rejection propagates unchanged | ✅ | `rejects.toThrow('boom')`. |
| 9. Full envelope `{message, data}` returned | ✅ | Asserts both `typeof message === 'string'` and `Array.isArray(data)`. |
| 10. Plugin registers `SEARCH_SERVICE_TOKEN` in `initialize` with `useValue` | ✅ | Verified at `searchPlugin.ts:24-29`. Grep guard checks block contents. |
| 11. Bootstrap + resolve returns service singleton | ✅ | `searchPlugin.search.test.ts:33-57` asserts `===` on repeated resolves. |
| 12. `SearchComponent.tsx` uses `useService<SearchService>(SEARCH_SERVICE_TOKEN)` | ✅ | Line 21. `servicesApi.getAllServices` (line 38) and `stereotypeApi.getAll` (line 39) preserved per spec. |
| 13. `searchSlice.ts` thunk uses `useService` + `SEARCH_SERVICE_TOKEN` | ⚠️ | Thunk body migrated correctly (lines 38-39). HOWEVER, the reducer at line 64 still assigns the envelope to `state.results` — passes spec's narrow grep guard but introduces a TS2740 type error that did not exist on `main`. See Required Change #1. |
| 14. `searchEntities` gone from `api.ts` `servicesApi` block | ✅ | Lines 72-81 deleted from `services/api.ts`. Other methods intact. |
| 15. Repo-wide walk finds zero `servicesApi.searchEntities(` call sites | ✅ | Grep guard limits to call-site pattern, allowing docstring references in `SearchService.ts`. |
| 16. SearchComponent renders result row | ✅ | MSW handler returns fixture; `findAllByText('Order')` passes. |
| 17. Filter forwarded as `type=entity` in captured URL | ✅ | MSW handler captures URL; `URL.searchParams` extraction asserts both `q` and `type`. |

## Framework verification

| Import | Path | Verified | Notes |
|---|---|---|---|
| `@hamak/microkernel-spi` `PluginModule` | `frontend/node_modules/@hamak/microkernel-spi/dist/plugin.d.ts:17-21` | ✅ | `initialize(ctx: InitializationContext)` accepts `void \| Promise<void>`. |
| `InitializationContext.provide<T>(prov: Provider<T>): void` | `plugin.d.ts:3` | ✅ | Exact signature. |
| `@hamak/microkernel-api` `Token<T>` | `types.d.ts:1-3` | ✅ | `string \| symbol \| { new(...args): T }`. `SEARCH_SERVICE_TOKEN: symbol` satisfies the union. |
| `@hamak/microkernel-api` `ValueProvider<T>` | `types.d.ts:42-45` | ✅ | `{ provide: Token<T>; useValue: T }`. Plugin's `ctx.provide({ provide: SEARCH_SERVICE_TOKEN, useValue: new SearchService() })` matches. |
| `@hamak/microkernel-impl` `host.rootActivationCtx` | `runtime/host.d.ts:13` (`rootActivationCtx?: ActivateContext`) | ✅ | Optional — populated by `bootstrapAllAtRoot` (impl/host.js:111). `useService` correctly guards on `!ctx` (frontend/src/kernel/useService.ts:17-22). |
| `ActivateContext.resolve<T>(token: Token<T>): T` | `types.d.ts:53,59` | ✅ | Inherited from `ProvidedServices`. |
| `axios` `AxiosInstance` + `axios.create` | `frontend/node_modules/axios/index.d.ts` | ✅ | Standard axios usage; identical to IntegrityService. |

## Out-of-scope additions

None in the search-ticket files. The diff against `main` shows additional
non-search modifications (`DiffService.ts`, `ImportExportService.ts`,
`LogicalDiffPage.tsx`, `PhysicalDiffPage.tsx`, `QualityDashboardPage.tsx`,
`SchemaImportWizard.tsx`, `HomePage.tsx`, `ImportExportPage.tsx`,
`dataDictionaryPlugin.ts` adding `DIFF_SERVICE_TOKEN` and
`IMPORT_EXPORT_SERVICE_TOKEN` registrations, and `kernel/tokens.ts` adding
those tokens). These belong to the sibling tickets `#155-diff` and
`#155-import-export` that share the same working tree (branch
`arch/155-import-export` at the time of review). They are NOT part of
#155-search and are reviewed by their own tickets. Confirmed by reading
`.claude/work/155-search/spec.md`'s "Files touched" list — none of those
files appear there.

## Style/cookbook violations

None in the search-ticket files. Notes:

- Pattern B service shape matches cookbook §3b's `IntegrityService` worked
  example bit-for-bit: private `http: AxiosInstance`, optional ctor
  injection, static `createDefaultHttp()`, no `@/services/api` import,
  eager `useValue` registration in `initialize`. Verified by direct read of
  `frontend/docs/patterns.md:166-205`.
- `SearchComponent.tsx`'s `useState` for `results`, `loading`, `error`,
  `filters`, `availableServices`, `stereotypes`, `focusedIdx` is the §1.5
  Pattern B carve-out documented at `patterns.md:84` and is consistent
  with `IntegrityPage` precedent. Acceptable.
- `useService` call placed after `useSearchParams`-derived `initialQuery`
  and before the `useState` block (line 21), mirroring `IntegrityPage`.
- The `SearchFilters` type used to replace `any` at the original
  `backendFilters: any` site (line 52) is a minor unrelated improvement.
  Dev notes flagged this explicitly as a deliberate choice; consistent with
  the public-surface contract the spec defines. Acceptable.

## Notes on test isolation

`searchPlugin.search.test.ts` calls `bootstrapApplication()` in `beforeAll`
and relies on its idempotency (verified in the existing
`dataDictionaryPlugin.integrity.test.ts` pattern). The full 4-file suite
runs cleanly in a single Vitest worker (`16s` duration, 26/26 pass).
No cross-test bootstrap collision observed.

The pre-existing `useService` cycle risk flagged in spec Risk #5 is
mitigated as designed — the import-time graph completes because
`useService` reads `host` only inside the thunk body (not at module top
level), and the thunk first fires post-bootstrap. No runtime warning
observed in the Vitest output.
