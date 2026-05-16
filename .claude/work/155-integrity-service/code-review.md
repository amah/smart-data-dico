# Code review — #155-integrity-service: Pattern B pilot (cycle 1)

## Verdict
**approve**

The diff matches the cycle-2 spec character-for-character on the public surface, all 13 acceptance criteria are met, 27/27 new tests pass and were re-verified locally, and there are no out-of-scope additions inside production source. Two minor suggestions below — neither blocks.

## Required changes
None.

## Suggestions (optional, won't block)

1. **`frontend/src/pages/IntegrityPage.tsx:176-180` — cookbook §1.5 citation is loose.** The TODO comment cites a "§1.5 ephemeral-UI carve-out" but `frontend/docs/patterns.md` has no §1.5; the relevant prose lives at the bottom of §2 ("Ephemeral UI state (`isExpanded`, `hoveredRow`) does still use `useState`...") and the anti-patterns list at line 128 ("`useState<boolean>(false)` named `loading` ... in a smart component"). The reasoning in the comment is sound (one-shot Pattern B fetch has no Store FS node to hang state on) and the spec's Risk 1 explicitly justifies it, but the literal "§1.5" reference will mislead the next reader running `grep "§1.5" frontend/docs/patterns.md`. Easy fix: rephrase to "the §2 ephemeral-UI carve-out" or "the patterns.md anti-pattern footnote on smart-component scope". Spec carries the same loose citation in lines 20 and 294, so this is inherited, not invented.

2. **`frontend/src/plugins/data-dictionary/services/__tests__/spec-grep-guards.integrity.test.ts` is not in the spec's "Files touched" list.** The spec enumerates exactly three test files (the page rewrite, the service unit, the plugin bootstrap). The test-author added a fourth — a content-walker guard suite that converts acceptance criteria #1-#7 from grep commands into runtime assertions. This mirrors `frontend/src/plugins/store/__tests__/spec-grep-guards.test.ts` (a #166 precedent on the branch base) and the acceptance criteria literally specify greps, so the addition is defensible — but it is technically out of the spec's stated scope. Spec author may want to either codify "grep-guard tests are an accepted way to satisfy grep-shaped criteria" in the spec template, or instruct test-author to stick strictly to the enumerated set. No code change required for this PR.

3. **`frontend/src/plugins/data-dictionary/services/__tests__/IntegrityService.test.ts:66` cast style differs from spec.** Spec criterion #8 says "typed as `Pick<AxiosInstance, 'get'> & Partial<AxiosInstance>`, cast through `unknown` if needed". The actual test uses `{ get: getImpl } as unknown as AxiosInstance`. Both reach the same place; the Pick/Partial intermediate type was a suggestion, not a contract. Worth aligning if the spec template evolves toward stricter prescription.

## Acceptance-criterion coverage

| Criterion | Implemented | Notes |
|---|---|---|
| 1. Token exists and is unique; symbol type; distinct value | ✅ | `frontend/src/kernel/tokens.ts:52` declares `INTEGRITY_SERVICE_TOKEN = Symbol('IntegrityService')`. Verified single declaration; distinct from `STORE_FS_TOKEN`, `STEREOTYPE_SERVICE_TOKEN`, etc. Bootstrap test resolves a real instance via the symbol. |
| 2. Service file is self-contained | ✅ | `frontend/src/plugins/data-dictionary/services/IntegrityService.ts` imports only `axios` and `../../../types`. No `services/api` import. |
| 3. DI registration in `initialize` with `useValue` shape | ✅ | `frontend/src/plugins/data-dictionary/dataDictionaryPlugin.ts:80-84` — `ctx.provide({ provide: INTEGRITY_SERVICE_TOKEN, useValue: new IntegrityService() })` sits inside `async initialize(ctx)`. `useValue` provider shape confirmed; not `useClass` / `useFactory`. |
| 4. IntegrityPage consumes via `useService` | ✅ | `frontend/src/pages/IntegrityPage.tsx:23-25` adds the kernel imports; line 172 calls `useService<IntegrityService>(INTEGRITY_SERVICE_TOKEN)`; line 197 calls `integrity.getReport()`. No `integrityApi` reference. |
| 5. HomePage migrated in same PR | ✅ | `frontend/src/pages/HomePage.tsx:29-31` adds the kernel imports; line 81 calls `useService<IntegrityService>(...)`; line 146 calls `integrity.getReport()`. No `integrityApi` reference. |
| 6. `integrityApi` gone from `api.ts` | ✅ | Diff against branch base shows the entire `integrityApi` export block (lines 628-651) deleted, plus the now-unused `PhysicalConstraint` type-import removed at line 3 (dev's mechanical follow-on, documented in dev-notes). `grep -c "integrityApi\|PhysicalConstraint" api.ts` → 0. |
| 7. Repo-wide no surviving consumer | ✅ | `grep -rn 'integrityApi' frontend/src --include='*.ts*'` returns only references inside `spec-grep-guards.integrity.test.ts` (the guard itself; allowlisted by the walker). |
| 8. IntegrityService unit test green | ✅ | `IntegrityService.test.ts` (4 tests) — constructor-injected stub `AxiosInstance`, asserts `get('/integrity')` call, envelope unwrap to inner report, error propagation, default-construction smoke. No `vi.mock('axios')`. Re-verified locally. |
| 9. Plugin bootstrap test green | ✅ | `dataDictionaryPlugin.integrity.test.ts` (3 tests) — `bootstrapApplication()` in `beforeAll`, asserts `host.rootActivationCtx` defined, resolves a service with `getReport`, and the same instance comes back on repeat resolves (confirming `useValue` provider). Mirrors `StereotypesPage.bootstrap.test.tsx`. Re-verified locally. |
| 10. IntegrityPage page-level test green | ✅ | `IntegrityPage.test.tsx` (10 tests) — `bootstrapApplication()` once in `beforeAll`; MSW `/api/integrity` handler re-installed per `beforeEach` (correctly avoiding the `afterEach: server.resetHandlers()` bleed in setup.ts:114-117); `<Provider store={getStore()}><MemoryRouter>` wrap; prior assertions preserved (tab counts, three-tab filtering, search across categories, search-driven counts, Needs-attention preset, error state via a `failFetch` flag toggled inside the handler closure). Re-verified locally. |
| 11. HomePage existing test status | ✅ | Vacuously satisfied — `ls frontend/src/pages/__tests__/ | grep -i home` returns nothing. Confirmed. |
| 12. Full Vitest suite green | ✅ | Test-author reported 31 files / 219 tests / 0 failures. Re-ran the four affected files locally → 4 files / 27 tests / 0 failures. |
| 13. Does NOT pin tsc/lint | ✅ | None of the four test files invokes `tsc --noEmit` or `npm run lint`. |

## Framework verification

| Import | Verified | Notes |
|---|---|---|
| `axios.create`, `AxiosInstance` | ✅ | Native `axios@1.x`. `axios.create({ baseURL, headers })` + `instance.interceptors.request.use(...)` shape unchanged from `services/api.ts` precedent. |
| `@hamak/microkernel-spi` `PluginModule`, `InitializationContext.provide` | ✅ | `frontend/node_modules/@hamak/microkernel-spi/dist/plugin.d.ts:3` declares `provide<T>(prov: Provider<T>): void`. |
| `@hamak/microkernel-api` `ValueProvider`, `Token`, `ProvidedServices.resolve` | ✅ | `frontend/node_modules/@hamak/microkernel-api/dist/types.d.ts:42-44` (`ValueProvider`), `:1-3` (`Token`), `:52-58` (`ProvidedServices.resolve`). The DI runtime at `frontend/node_modules/@hamak/microkernel-impl/dist/runtime/di.js:26-58` caches resolved instances per token (`this.instances.set(token, value)` at line 57), confirming that `useService` returns the same singleton on every call — which is what makes the `[integrity]` deps array stable in both pages. |
| Local `useService` from `frontend/src/kernel/useService.ts` | ✅ | Signature `useService<T>(token: symbol | string): T`. Throws on missing context or missing provider. The dev's choice of typing the page-side variable as `useService<IntegrityService>(...)` is consistent with the StereotypesPage precedent. |
| Local `bootstrapApplication` + `getStore` + `host` from `frontend/src/kernel/bootstrap.ts` | ✅ | `bootstrapApplication(): Promise<boolean>` is idempotent (line 179 guard on `isBootstrapped`). Used identically by `StereotypesPage.bootstrap.test.tsx` and the new `dataDictionaryPlugin.integrity.test.ts`. |
| `msw` `http`, `HttpResponse`, `server.use` (re-installed per `beforeEach`) | ✅ | `frontend/src/test/setup.ts:114-117` runs `cleanup()` + `server.resetHandlers()` in `afterEach`; the page test correctly re-installs the handler in `beforeEach` per Risk 6. |

## Out-of-scope additions

- `frontend/src/plugins/data-dictionary/services/__tests__/spec-grep-guards.integrity.test.ts` (new, 196 lines) is not enumerated in the spec's "Files touched". It mirrors `frontend/src/plugins/store/__tests__/spec-grep-guards.test.ts` (a #166 precedent on the branch base) and converts acceptance criteria #1-#7 from shell greps into runtime assertions. Defensible but technically additive. See Suggestion #2. No production code is affected.
- The `.claude/agents/*.md` and `.gitignore` changes appear in the working tree diff per the orchestrator note and are explicitly excluded from review scope.

## Style / cookbook violations

None inside production source. The `useState<loading|error>` retention in `IntegrityPage.tsx:181-182` is a documented Risk 1 deferral with a `TODO(#155-followup)` anchor — preserved per spec direction. The cookbook §1.5 citation in the inline comment is loose (see Suggestion #1) but the substantive decision (Pattern B with no Store FS node ⇒ ephemeral `useState` is the only practical shape today) is consistent with `frontend/docs/patterns.md` §2's last paragraph and the anti-patterns list's "in a smart component" qualifier.

## Dev-note follow-on (non-blocking)

The dev's mechanical removal of `PhysicalConstraint` from `frontend/src/services/api.ts:3` is correct: the symbol's only in-file reference was inside the deleted `integrityApi` block, and `noUnusedLocals: true` would otherwise turn the deletion into a fresh tsc error. The decision is documented in dev-notes.md and does not exceed the spec's authorization. `Rule` is preserved (still consumed by `ruleApi` at lines 581-625), matching the spec instruction.

## Net assessment

Spec match is character-for-character on the public surface (constructor `IntegrityService(http?: AxiosInstance)`, method `getReport(): Promise<IntegrityReport>` returning the spec-defined shape, `createDefaultHttp` factory with the `api.ts:23-32` interceptor parity, direct `axios` import). DI registration is precedent-faithful (mirrors STEREOTYPE_SERVICE_TOKEN registration in the same `initialize` block, `useValue` provider, no Proxy needed for Pattern B). Page migrations are mechanical and minimal. Tests cover every grep-shaped criterion and every runtime-shaped criterion. The only review-bench items are stylistic suggestions that the spec itself partially shares.
