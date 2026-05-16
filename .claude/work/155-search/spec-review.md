# Spec review — #155-search: SearchService Pattern B proof  (cycle 1)

## Verdict
**approve**

The spec is implementable as written. All ten specific concerns from the orchestrator brief check out under direct verification. Framework citations are accurate, the Option (a) defence holds against an exhaustive consumer grep, the cookbook §1.5 carve-out is invoked correctly, and the envelope-vs-array decision is forced by both real call sites. Suggestions below are non-blocking nits.

## Required changes (if rework)

None.

## Suggestions (optional, won't block)

1. **Document the pre-existing `searchSlice` bug as a known-acceptable carry-over.** `searchSlice.ts:47` does `state.results = action.payload`, but `action.payload` is the envelope `{ message, data: SearchResult[] }` and `state.results` is typed `SearchResult[]`. The bug is invisible today because no component reads `state.search.results` (the same grep that proves the slice is dead code also proves nothing notices the type mismatch). The spec preserves wire format bit-for-bit, which is the right call — but a one-line comment in the migrated thunk noting "pre-existing reducer bug; #154 owners will clean up when rehoming the slice" would save the next reader a head-scratch. Not blocking; the spec already documents the slice as dead code at multiple points.

2. **Acceptance criterion #15 over-narrowly excludes "the grep-guard test file itself by basename suffix" but the spec doesn't pin a suffix.** The integrity precedent uses `spec-grep-guards.integrity.test.ts` and excludes by that exact basename. The spec calls the new file `spec-grep-guards.search.test.ts` (criterion #15 says "basename suffix"). A future spec-grep-guards file with a different suffix (`.search.spec.ts`?) would fail to self-exclude. Minor — the implementer can default to matching the integrity convention exactly.

3. **Acceptance criterion #16 hard-codes the MSW response shape.** The example payload includes a `path: '...'` field. Verify against the backend response shape in `serviceService.searchEntities` (not just the controller envelope). If the backend doesn't populate `path` on every result, the MSW fixture is wrong and the rendered row will fail (the row uses `getResultLink(result)` which dereferences `result.service` and `result.entityName`, both of which the example does populate — so this is probably fine, but a quick check of `serviceService.searchEntities`'s return shape would harden the test). Not blocking.

4. **Spec section "Framework APIs used" cites `types.d.ts:42-45` for `ValueProvider<T>`.** Verified — line 42 starts `ValueProvider<T>`. Accurate.

## Framework citation verification

| Cited path | Verified | Notes |
|---|---|---|
| `frontend/node_modules/@hamak/microkernel-spi/dist/plugin.d.ts:3` (`provide<T>(prov: Provider<T>): void`) | yes | Confirmed verbatim on line 3 of `InitializationContext` body. |
| `frontend/node_modules/@hamak/microkernel-api/dist/types.d.ts:42-45` (`ValueProvider<T>`) | yes | Lines 42-45: `export type ValueProvider<T = any> = { provide: Token<T>; useValue: T; };` |
| `frontend/node_modules/@hamak/microkernel-api/dist/types.d.ts:1` (`Token<T>`) | yes | Line 1: `export type Token<T = any> = string | symbol | { new(...args: any[]): T; };` — union includes `symbol`, so `SEARCH_SERVICE_TOKEN: symbol` satisfies `Token<T>`. |
| `frontend/src/kernel/useService.ts:15` (`useService<T>(token: symbol \| string): T`) | yes | Signature matches at line 15. Throws on pre-bootstrap (line 17-22) and on missing provider (line 24-27). |
| `frontend/src/kernel/tokens.ts:15` (`SEARCH_SERVICE_TOKEN` already declared) | yes | Line 15: `export const SEARCH_SERVICE_TOKEN = Symbol('SearchService');` — spec correctly notes no `tokens.ts` edit needed. |
| `frontend/src/components/SearchComponent.tsx:34` (`servicesApi.getAllServices()` survives) | yes | Confirmed at line 34. |
| `frontend/src/components/SearchComponent.tsx:35` (`stereotypeApi.getAll`) | yes | Confirmed at line 35. |
| `frontend/src/components/SearchComponent.tsx:54` (`servicesApi.searchEntities` call to migrate) | yes | Confirmed at line 54. The `await` and the destructured `setResults(response.data)` at line 58 verify the envelope is consumed. |
| `frontend/src/store/slices/searchSlice.ts:19-22` (thunk body) | yes | Body is exactly `return await servicesApi.searchEntities(query)`. Spec's described migration is a one-line swap. |
| `backend/src/controllers/serviceController.ts:204-228` (search response shape) | yes | Confirmed: `res.json({ message: 'Success', data: results })` at line 220-223. Wire format envelope preserved exactly by the spec's `SearchResponse` interface. |
| `frontend/docs/patterns.md` §3b Pattern B worked example | yes | Documented; IntegrityService precedent matches the proposed SearchService shape. §1.5 carve-out documented at lines 79-84 (Pattern B keeps `useState<loading|error>` because there's no Store FS node). |
| Integrity precedent at `5a48c44` (PR #173) | yes | Commit on main; `IntegrityService.ts`, `dataDictionaryPlugin.ts:80-84` registration, `IntegrityPage.tsx:172` consumer all match the pattern the search spec mirrors. |

## Specific-check disposition

1. **`SEARCH_SERVICE_TOKEN` already at tokens.ts:15** — verified. No edit to `tokens.ts`.

2. **Slice is dead code** — verified. Grep across `frontend/src` for `searchSlice`, `setSearchQuery` (as slice action), `clearSearch`, and the `searchEntities` thunk export shows only:
   - The slice's own self-references inside `searchSlice.ts`.
   - The reducer registration in `bootstrap.ts:35,72`.
   - One unrelated match in `CytoscapeToolbar.tsx:40,45` where `setSearchQuery` is a *local* `useState` setter — different identifier, no connection to the slice.
   The slice is dead code. Option (a) is safe.

3. **Redux thunk Option (a)** — `searchSlice.ts:19-22` body is exactly what the spec describes. Calling `useService` from inside a Redux thunk is **novel in this codebase** — no existing thunk uses `useService` today. The spec's reasoning is correct (thunks fire after dispatch, dispatch needs the store, store comes from kernel, so bootstrap has already completed). The mitigation in Risk #1 is real: if a thunk somehow fired pre-bootstrap, `useService` throws a clear "called before host bootstrap completed" error from line 17-22 of `useService.ts`. No silent undefined. Approve.

4. **SearchComponent partial migration** — verified. Lines 34, 35, 54 are exactly as the spec describes. Only line 54 (`searchEntities`) migrates.

5. **Envelope vs array return shape** — verified. Legacy `servicesApi.searchEntities` at `api.ts:73-81` returns `response.data` (the body, which is the envelope `{ message, data: SearchResult[] }`). Both call sites consume the envelope: `SearchComponent.tsx:58` reads `response.data` for the array; `searchSlice.ts:22` returns the envelope as thunk payload (and the reducer assigns it to `state.results` — a pre-existing bug, see Suggestion #1). Spec correctly pins `SearchResponse = { message, data: SearchResult[] }`.

6. **`searchPlugin.ts` shape** — verified. Current file has `initialize(ctx)` with one `ctx.views.register` call and no `ctx.provide`. No `dependsOn` declared on the plugin (bootstrap.ts:120 wires it with `dependsOn: ['store']`). Adding the eager `useValue` registration disturbs nothing — no Store FS deps, no kernel ordering concerns. First service the plugin owns. The spec's proposed plugin shape is internally consistent.

7. **Backend route shape preservation** — verified. `serviceController.ts:220-223` returns `{ message: 'Success', data: results }`. Spec's `SearchResponse` interface matches bit-for-bit. No backend changes needed.

8. **Cookbook §1.5 carve-out** — SearchComponent has `useState<SearchResult[]>` (results), `useState(false)` (loading), `useState<string | null>` (error), and several filter/UI states. Per cookbook line 84 ("Pattern B note") and IntegrityPage precedent (line 173-182), this is the correct treatment for Pattern B services — there is no Store FS node to back the IO state. Spec preserves this. Note: cookbook line 226 explicitly bans storing **fetched data** (`results`) in `useState` in principle, but allows it specifically for Pattern B because there's nowhere else for it to live until a Pattern B-specific cookbook entry is published. SearchComponent's `useState<SearchResult[]>` for `results` is the existing pattern, mirrored on IntegrityPage's `useState<ValidationRow[]>` etc. Approve.

9. **Import cycle risk** — real but mitigated. Cycle chain: `searchSlice.ts` → `useService.ts` → `bootstrap.ts` → `searchSlice.ts` (line 35 reducer import). At module init, `bootstrap.ts:35` evaluates `import searchReducer from '../store/slices/searchSlice'` BEFORE line 40 where `const host = new Host(...)` runs. So when `searchSlice.ts` triggers `useService.ts`'s `import { host } from './bootstrap'`, `host` is in the TDZ. **BUT** `useService.ts` only reads `host` inside the `useService` function body (line 16: `const ctx = host.rootActivationCtx;`), not at module top-level. As long as `useService` is not CALLED during module evaluation, the cycle resolves. The thunk body only calls `useService` when dispatched, which is post-bootstrap. The spec's `import type` for `SearchService` and value-but-not-call import for `useService` is the right shape. Risk #5 in the spec correctly identifies this; mitigation is the lazy call. Approve.

10. **Acceptance criteria scope** — tightly scoped to search-related artifacts. Criteria #1-9 cover the service unit; #10-11 cover plugin registration + DI; #12-13 cover consumer migration (SearchComponent + slice); #14-15 cover `api.ts` deletion; #16-17 cover the MSW page test. No criterion mentions "all existing tests pass" — that's an unstated CI baseline. Per orchestrator brief this is acceptable since the criteria are otherwise testable and specific.

## Risk reassessment

The spec lists 5 risks. I'd add or re-weight:

- **Risk #1 (thunk-time `useService`)**: spec rates this as the top risk with a strong mitigation. Independent assessment: agree. The novelty of calling `useService` from non-React code in this codebase is worth a one-line comment in the migrated thunk pointing at the cookbook + the bootstrap-completes-before-dispatch invariant. Spec already does this at lines 162-164 of the proposed thunk body. Acceptable.

- **Risk #5 (import cycle)**: spec rates this as mitigated by lazy call. Independent assessment: agree, and TypeScript + Vite will both tolerate this cycle silently. The fallback "memoized getter at module top-level" is not needed unless CI flags it.

- **New risk (not in spec): the search plugin currently has no test directory.** The spec creates one at `frontend/src/plugins/search/__tests__/`. Vitest config picks up `**/__tests__/**/*.test.ts(x)` so this should Just Work; no additional config change needed. Verified by checking the existing structure (`frontend/src/plugins/data-dictionary/__tests__/` is picked up by the same glob). Low risk.

- **New risk (not in spec): the `SearchComponent.test.tsx` MSW fixture's `SearchResult` payload.** The example payload in criterion #16 lists `path: '...'` as a field. The current `SearchResult` type in `frontend/src/types/index.ts` should be checked — if `path` is not a documented field, the test renders fine (extra fields are ignored) but the fixture isn't authoritative for what the real backend returns. Cosmetic; the test still passes.

- **Existing pre-existing reducer bug (not introduced by this PR but adjacent):** `searchSlice.ts:47` assigns `action.payload` (envelope) to `state.results` (array). Pre-exists. Acceptable for this scope; flagged for #154's slice-rehoming cleanup.

## Cross-ticket conflicts

None.

- `#155-integrity-service` (merged as PR #173, commit `5a48c44`): this spec mirrors that pattern exactly — same `useValue` registration, same private-axios constructor, same `createDefaultHttp` helper. No conflict.
- `#155-diff` (in-flight): owns `DIFF_SERVICE_TOKEN` under `data-dictionary`. Different plugin (data-dictionary vs search), different token, no overlap.
- `#155-import-export` (in-flight): owns `IMPORT_EXPORT_SERVICE_TOKEN` under `data-dictionary`. Different plugin, no overlap.
- `#156` and `#166-stereotype-slice`: already-shipped scaffolding; this spec doesn't touch their files.
- `#154` (plugin-slice rehoming): the spec coordinates a future hand-off — `searchSlice.ts` stays at `store/slices/` for now and #154 owners rehome it to `plugins/search/slices/` later. Spec explicitly defers this.
- `#163` (commands/events naming): out of scope per spec. The spec does not register any new commands or emit any events; it only adds a DI provider. No naming-convention exposure.

Multi-kind YAML (#106), validation/constraint/rule trinity (#85), Store FS path semantics (#168): none of these surfaces are touched by this spec.

## Bottom line

The spec is the cleanest of the three #155 Pattern B carve-outs reviewed in this batch. The dead-code-slice framing is unusual but the grep evidence is conclusive, the Option (a) decision is defensible, and every framework citation checks out under direct verification. Approve with the three non-blocking suggestions above.
