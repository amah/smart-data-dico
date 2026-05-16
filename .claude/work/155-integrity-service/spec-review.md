# Spec review — #155 (slice): IntegrityService — Pattern B pilot  (cycle 1)

## Verdict
**rework**

There is one internal contradiction in acceptance criterion #9 that will derail the plugin bootstrap test as written, plus several small but worth-fixing precision issues (citation off-by-one, axios-mocking convention mismatch with the codebase, missing acknowledgement that the precedent test in PR #172 uses `bootstrapApplication()` not a manual `new Host(...)`). None of these are framework-API misreads — every `.d.ts` citation verifies. The pattern, scope, and overall shape are correct; this is a tightening pass.

## Required changes (if rework)

1. **Resolve the internal contradiction in criterion #9 about `dependsOn`.** Spec says the test "Registers the data-dictionary plugin with `dependsOn: []` (no store dependency needed for the Pattern B resolution — … STEREOTYPE registration that needs STORE_FS_TOKEN can be skipped … OR the test registers both store and store-fs plugins. **Decision: use the second** — match production wiring rather than building a bespoke harness)". These two sentences are mutually exclusive: `dependsOn: []` means the test does NOT register store/store-fs, but the "Decision: use the second" says the test DOES register them. **Pick one and write it cleanly.** Note that the data-dictionary plugin's `initialize` (on the branch base, `arch/166-stereotype-slice`) unconditionally calls `ctx.resolve<StoreFileSystemFacade<RootState>>(STORE_FS_TOKEN)` and `ctx.resolve<IStoreManager>(STORE_MANAGER_TOKEN)` before reaching the Integrity registration — see `git show arch/166-stereotype-slice:frontend/src/plugins/data-dictionary/dataDictionaryPlugin.ts` lines 56-61. So **the test MUST register store and store-fs** (or stub those tokens via overrides) — the `dependsOn: []` framing is impossible. Recommended: explicitly state "register `wrappedStorePlugin`, `createAppStorePlugin`/`createAppStoreFsPlugin`, `createAppRemoteFsPlugin`, and `createDataDictionaryPlugin` with the same `dependsOn` lists used in `bootstrap.ts:105-145`."

2. **Align the plugin-bootstrap test with the established precedent.** PR #172's matching test (`frontend/src/pages/__tests__/StereotypesPage.bootstrap.test.tsx`) does NOT build a host by hand — it calls `bootstrapApplication()` and asserts against the singleton `host`. The spec proposes "Constructs a `new Host([], undefined, { debug: false })`". Either keep the bespoke construction (and add ALL the dependsOn plugins per #1 above), or follow the precedent: `await bootstrapApplication(); host.rootActivationCtx.resolve(INTEGRITY_SERVICE_TOKEN)`. The precedent path is shorter and exercises the real wiring. The spec must pick one and justify it, not leave the reader to reconcile two patterns.

3. **The IntegrityService unit test plan should specify MSW, not `vi.mock('axios')`.** Spec criterion #8 says *"The test mocks `axios.create(...).get` and asserts..."*. The repo-wide convention (per `frontend/src/test/setup.ts` and `StereotypeService.test.ts`) is MSW — `vi.mock('axios')` does not appear anywhere in `frontend/src`. Either (a) use MSW: register `http.get('/api/integrity', () => HttpResponse.json({ data: sample }))` and call the real service, or (b) inject a stub `AxiosInstance` via the `IntegrityService(http?)` constructor override the spec already declares — the spec exposes the constructor's `http?` parameter precisely for tests, so that's the clean path. Either is fine; pick one. `vi.mock('axios')` is the noisiest option and breaks step with the rest of the codebase.

4. **Citation off-by-one in the Risk 4 reference to `api.ts:23-31`.** The interceptor block actually spans lines 23-32 in `frontend/src/services/api.ts` (the closing `});` of the `request.use(...)` call is on line 32). Two places in the spec — "Auth header replication matches `services/api.ts:23-32`" in the IntegrityService docblock and "duplicates the `localStorage.getItem(...)` interceptor from `api.ts:23-31`" in Risk 4 — disagree with each other. Make them consistent. Use `:23-32`.

## Suggestions (optional, won't block)

- The `bootstrapApplication()` precedent in #172's bootstrap test is robust against `host` being the singleton; document it explicitly in the IntegrityPage test header.
- The cookbook §1.5 vs §2 tension (Risk 1) is the right tradeoff for Pattern B but the cookbook genuinely does not document Pattern B's loading state. Suggest the spec's "TODO follow-up" be an actual ticket (or at minimum a `// TODO(#155-followup)` anchor in the page) rather than a free-text note. The orchestrator should land a §2 sub-section ("Pattern B ephemeral fetch state") once this PR merges so future Pattern B slices have a worked example.
- `IntegrityService.createDefaultHttp` falls back to `'mock-token-for-testing'` for parity with `api.ts:25`. That fallback is a dev-environment hack that should not be replicated forever — flag it with an inline comment so it gets cleaned up alongside `api.ts:25` (out of scope for this PR but worth pinning).
- Criterion #11 ("HomePage existing test still green") is vacuously satisfied — there is no `HomePage.test.tsx` on the branch base. Verified: `ls frontend/src/pages/__tests__/ | grep -i home` returns nothing. The spec could state this as a confirmed fact rather than "verify before implementation".

## Framework citation verification

| Cited path | Verified | Notes |
|---|---|---|
| `frontend/node_modules/@hamak/microkernel-spi/dist/plugin.d.ts:3` (InitializationContext.provide) | yes | Exact match, line 3 |
| `frontend/node_modules/@hamak/microkernel-spi/dist/plugin.d.ts:17-21` (PluginModule) | yes | Exact match |
| `frontend/node_modules/@hamak/microkernel-api/dist/types.d.ts:1-3` (Token) | yes | Exact match |
| `frontend/node_modules/@hamak/microkernel-api/dist/types.d.ts:42-45` (ValueProvider) | yes | Exact match |
| `frontend/node_modules/@hamak/microkernel-api/dist/types.d.ts:52-58` (ProvidedServices.resolve) | yes | Exact match |
| `arch/166-stereotype-slice:frontend/src/kernel/useService.ts` | yes | Signature is `export function useService<T>(token: symbol \| string): T` — matches the spec |
| `arch/166-stereotype-slice:frontend/src/kernel/tokens.ts` (STORE_FS_TOKEN, STEREOTYPE_SERVICE_TOKEN, etc.) | yes | Tokens declared as expected; legacy domain tokens still present |
| `arch/166-stereotype-slice:frontend/src/plugins/data-dictionary/dataDictionaryPlugin.ts` precedent | yes | Confirmed; the spec's additive change pattern (`ctx.provide({ provide: INTEGRITY_SERVICE_TOKEN, useValue: ... })`) is consistent |
| `frontend/src/services/api.ts:628-651` (integrityApi block) | yes | Verified location and exact line span |
| `backend/src/routes/index.ts:136` (`GET /api/integrity`) | yes | Exact match |
| `frontend/src/services/api.ts:23-31` (auth interceptor) | partial | Off-by-one — block is `:23-32`. See Required change #4 |
| `frontend/src/kernel/bootstrap.ts:39` (`new Host([], undefined, { debug: false })`) | yes | Confirmed; but note the branch-base precedent test uses `bootstrapApplication()` not bespoke construction (see Required change #2) |

The two-line API surface that Pattern B actually relies on (`InitializationContext.provide`, `ProvidedServices.resolve`) is concrete and verified. There are no `.js` runtime surfaces to inspect because Pattern B doesn't construct framework objects — it just registers a plain class instance against a symbol. The pre-check in the prompt is correct: this is genuinely thinner than Pattern A.

## Scope-discovery audit

- **HomePage second consumer**: confirmed independently. `grep -rn 'integrityApi' frontend/src --include='*.ts*'` returns 4 source-file hits: `IntegrityPage.tsx`, `IntegrityPage.test.tsx`, `HomePage.tsx`, `api.ts`. Spec's "Files touched" list includes both pages and the test — internally consistent. No third consumer hiding.
- **Backend route**: confirmed at `/api/integrity` (`backend/src/routes/index.ts:136`); the ticket body's `/api/integrity-report` was indeed wrong. Spec correctly uses `/integrity` (relative to axios `baseURL: '/api'`).
- **HomePage migration scope**: one named import to drop (line 27), one call site to change (line 141), one `useEffect` dep array to update (line 165 area). The spec's diff captures all three.
- **No HomePage test file** on branch base — verified via `ls frontend/src/pages/__tests__/ | grep -i home` (empty). Criterion #11 is vacuously satisfied; could be tightened (see Suggestions).

## Cookbook §1.5 vs §2 interpretation

The spec's reading is defensible but the cookbook genuinely does not yet provide guidance for Pattern B fetch-state. Reading the actual text:

- §2 (lines 33-47): the prescription is `file?.state.contentLoading` / `file?.state.contentLoadError` — Store FS shaped. The §2 worked example is TODO. The anti-pattern entries at lines 128-129 forbid `useState<boolean>(false)` named `loading` and `useState<Error | null>(null)` for a fetch error **"in a smart component"** — without distinguishing Pattern A vs Pattern B sources.
- §1.5 (line 47): "Ephemeral UI state (`isExpanded`, `hoveredRow`) does still use `useState`. The rule is: state about *a file's IO* lives on Store FS; state about *a component's local UI* lives in `useState`."

A Pattern B REST fetch is not "a file's IO". §1.5's permission rule literally permits the `useState` here. The anti-pattern list at line 128-129 is best read as a Pattern A guardrail that the cookbook will eventually qualify. The spec's choice to preserve `useState<loading>` + `useState<error>` for Pattern B with an inline citation is defensible, NOT a contradiction. Risk 1 captures the deferral correctly.

If the orchestrator wants a clean answer rather than a deferred TODO, the right escalation is "cookbook needs a §2 Pattern B sub-section" — a human call, not a spec rework. The reviewer's recommendation: approve the spec's interpretation as written (after Required changes #1-#4 land), and file a follow-up to update the cookbook with a Pattern B worked example once this PR merges.

## Risk reassessment

The spec's five risks are real and adequately mitigated. Adding three the spec doesn't surface:

6. **Plugin bootstrap test register-order pitfall.** The data-dictionary plugin's `initialize` `ctx.resolve`s `STORE_FS_TOKEN` and `STORE_MANAGER_TOKEN`. If the bootstrap test does not register `store-fs` BEFORE data-dictionary (or use `dependsOn` so the framework topologically orders them), the test crashes with a token-not-providable error well before reaching the Integrity registration the test is trying to assert. Mitigated by Required change #1 making the dependsOn list explicit. Surface as a hard step in the test plan.

7. **MSW handler bleed.** `frontend/src/test/setup.ts` registers `afterEach: server.resetHandlers()`. The IntegrityPage page test (criterion #10) must re-install its `/api/integrity` handler in `beforeEach`, not `beforeAll`. This is the exact pitfall `StereotypesPage.bootstrap.test.tsx` already navigates (see its `beforeEach` block re-installing the handler). The spec mentions MSW but does not pin this convention. Cheap to add to the test plan.

8. **Branch-base churn.** PR #172 is OPEN and may receive review-requested changes that touch `dataDictionaryPlugin.ts:initialize`. If #172 reworks the order or signature of the STEREOTYPE registration block, this PR's additive append will conflict. Mitigated only by sequencing — merge #172 first, rebase this branch onto `main`. The spec's "Branch base" section acknowledges this but understates the cost: a non-trivial rework of #172's `initialize` body would force a manual rebase here.

Spec's Risk 5 (MSW bootstrap is heavier) is fine but possibly understated — the existing `vi.mock('../../services/api', ...)` test is ~10 lines of mock plumbing; the MSW + bootstrap rewrite is closer to 30 lines including the host setup and React-Redux Provider. Still a tradeoff worth taking; just budget the time honestly.

## Cross-ticket conflicts

- **#171 (notification factory adoption, OPEN)**: independent. Does not touch `dataDictionaryPlugin.ts` (only `notificationPlugin.ts`). No conflict.
- **#172 (stereotype slice, OPEN)**: branch base. This spec sequences after #172; conflict surface is one additive line in `tokens.ts` and one additive block in `dataDictionaryPlugin.initialize`. Acceptable.
- **#106 (multi-kind YAML), #85 (validation/constraint/rule trinity)**: preserved. The integrity endpoint and its report shape both honor the trinity (three top-level keys: `validation`, `constraints`, `rules`). No regression.
- **#168 (logical-vs-raw path dual view)**: not relevant — Pattern B is path-agnostic. No conflict.
- **#163 (command/event naming)**: not relevant — this PR adds no commands or events.

No cross-ticket blockers. Sequencing dependency on #172 is the only real coordination cost and is documented.

