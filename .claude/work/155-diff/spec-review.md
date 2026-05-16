# Spec review — #155-diff: DiffService Pattern B proof  (cycle 1)

## Verdict
**rework**

The spec is structurally sound: it mirrors #173 faithfully, all framework citations are real, the 5th-consumer find (PhysicalDiffPage's local `axios.create`) is correctly diagnosed, and the dead-method drops (`impactAll`, `putPhysicalConfig`) are verified zero-consumer. The acceptance criteria are CI-checkable and the test plan is the right shape.

But one "Files touched" instruction is factually wrong about the source layout, and two smaller issues need clarification before implementation.

## Required changes

1. **Fix the misattributed `// Diff API (#86)` / `// Project management (#95)` comment scrub.**

   The spec (Files touched, `services/api.ts` bullet) says: *"the `// Diff API (#86)` and `// Project management (#95)` adjacent comments are scrubbed so they don't dangle."*

   Verified: these two comments are at `services/api.ts:375-376`, immediately **preceding `filesystemApi` (line 377)** — not adjacent to `diffApi` (line 425). They appear to be a stale leftover from an earlier reorganization. The lines immediately before the `diffApi` block (424) and after (457) are simply blank — there are no `diffApi`-adjacent header comments.

   Pick one path and update the spec body to match:
   - **(a) leave `lines 375-376` alone** in this PR (they are not diff-related) — drop the scrub instruction from the `services/api.ts` bullet entirely, OR
   - **(b) explicitly scope** the scrub: `// Diff API (#86)` is a stale comment that is not adjacent to anything diff-related in current source, so removing it is a tidy-up *separate from* the `diffApi` deletion; if you want to delete it in the same PR, say so in plain language and reference line 375. Either way, do not present it as "adjacent" — it isn't.

   The implementing agent will otherwise edit the wrong region of the file based on the spec's geographic claim.

2. **`PhysicalConfig` typing — pick a posture and pin it.**

   The spec types the return of `getPhysicalConfig` as `Record<string, unknown> | null` (DiffService.ts signature block). PhysicalDiffPage.tsx:327 reads `cfg.dialect` for display. Under TypeScript strict mode, `cfg.dialect` on a `Record<string, unknown>` returns `unknown`, which then cannot be rendered as a `ReactNode` without a cast. The page's `physicalConfigs` state is currently typed `Record<string, any>` (line 90), so the implementing agent has two choices:
   - keep the page's state as `Record<string, any>` and let the service return `unknown | null` (the page absorbs the imprecision at the assignment boundary), or
   - introduce a narrower service-side type (`{ dialect?: string; [k: string]: unknown }`) so the page can read `dialect` directly.

   Pick one in the spec and write it down explicitly. Today the spec text says "the rest of the shape" is intentionally opaque, but the page reads at least one named field. The implementing agent should not have to invent the resolution.

3. **Coordination note for shared-file conflicts with other in-flight #155 slices.**

   Three live spec drafts (`155-diff`, `155-import-export`, `155-search`) all modify `frontend/src/kernel/tokens.ts`, `frontend/src/plugins/data-dictionary/dataDictionaryPlugin.ts`, and `frontend/src/services/api.ts`. All three edits are additive (different token, different `useValue` block, different api export deleted), so conflicts are mechanical, not semantic. The spec's Dependencies section says "No nested branch dependencies; branch off `main`." That is true and correct, but the spec should add a one-line acknowledgement that if either of the sibling specs lands first, this PR will need a trivial rebase to re-anchor the new token/registration after the most-recently-merged sibling's block. (No code change — just an orchestrator-visible note so the merge order is not surprising.)

## Suggestions (won't block)

- The `PhysicalConfig` docblock says *"The backend route returns either the persisted object or `null` (404 → undefined here)."* `null` and `undefined` are different — at the call site the current `diffApi.getPhysicalConfig` returns `response.data.data` which is whatever the envelope's `data` field carries (could be `null`, could be missing). On 404 axios throws, the page's `try/catch` absorbs it. The "`404 → undefined here`" phrasing is misleading because the service contract is success-only — the page (not the service) handles 404. Trim the parenthetical or rewrite as: *"On 404 the underlying axios call rejects; the page's try/catch handles that path."*

- The spec's risk #3 reads: *"the local axios in PhysicalDiffPage at line 167 was using a different envelope shape than the rest of `diffApi`. Specifically, it reads `response.data.data` (line 171) — same as the rest."* The sentence answers its own setup; consider rewriting as "Risk: envelope-mismatch surfaced if the bare `/diff/physical` route returns a non-enveloped body. Verified consistent with the rest of `diffApi.*` (page line 171 reads `response.data.data`). Mitigation: page test asserts an observable DOM signal." Shorter and the answer reads in the same direction as the question.

- The `LogicalDiffOperand` union (`type: 'git-ref'; ref: string; service?: string`) is correct against the page's literal construction at lines 259-264 (the `all-services` git-ref branches at 260 and 263 omit `service`, the per-service branches at 261 and 264 include it). No change needed; flagging only because the spec's risk #5 anticipates this and the actual page code confirms the union shape is correct.

## Framework citation verification

| Cited path | Verified | Notes |
|---|---|---|
| `frontend/node_modules/@hamak/microkernel-api/dist/types.d.ts:36-51` (`Provider<T>` union) | yes | `ClassProvider` lines 36-41, `ValueProvider` lines 42-45, `FactoryProvider` lines 46-50, `Provider<T>` union line 51. Matches spec's claim verbatim. |
| `frontend/node_modules/@hamak/microkernel-spi/dist/plugin.d.ts:3` (`InitializationContext.provide<T>(prov: Provider<T>): void`) | yes | Line 3 of `plugin.d.ts` reads `provide<T>(prov: Provider<T>): void;`. Matches. |
| `frontend/node_modules/@hamak/microkernel-impl/dist/runtime/di.d.ts:14` (`resolve<T>(token)`) | yes | Actually line 15 (`resolve<T>(token: Token<T>): T;`), but `Container.resolve` is what the spec semantically targets. Off-by-one in the line citation; harmless. |
| `host.rootActivationCtx` (used by `useService.ts:23` and the bootstrap test) | yes | `frontend/node_modules/@hamak/microkernel-impl/dist/runtime/host.d.ts:13` declares `rootActivationCtx?: ActivateContext` on `class Host`. Matches. |
| `axios.AxiosInstance` + `axios.create({ baseURL, headers })` + `instance.interceptors.request.use(...)` | yes | Same surface `IntegrityService.createDefaultHttp` uses in merged source (`IntegrityService.ts:60-74`). Pattern copy verified. |
| `msw` v2 `http.post`/`http.get` + `HttpResponse.json(...)` | yes | Same surface `IntegrityPage.test.tsx:92-99` uses; pattern carries. |

No fabricated APIs. The off-by-one on `di.d.ts:14` (real is `:15`) is cosmetic.

## Consumer audit verification

`grep -rnE 'diffApi' frontend/src --include='*.ts' --include='*.tsx'` returns:

- `services/api.ts:425` — declaration
- `LogicalDiffPage.tsx:18` — header doc-comment (prose)
- `LogicalDiffPage.tsx:24` — import
- `LogicalDiffPage.tsx:266` — `diffApi.logical(...)` call
- `PhysicalDiffPage.tsx:11` — import
- `PhysicalDiffPage.tsx:107` — `diffApi.getPhysicalConfig(...)` call
- `PhysicalDiffPage.tsx:143` — `diffApi.physicalAll(...)` call

Zero hits in `__tests__/` or anywhere else. Zero `vi.mock('.*services/api')` references targeting `diffApi`. Spec's consumer list (3 call sites + 1 doc-comment + 2 imports + 1 declaration) is complete.

The 5th-consumer find (`PhysicalDiffPage.tsx:12, :20-25, :167`) is real: line 12 imports `axios`, lines 20-25 create the local instance with auth interceptor, line 167 posts to `/diff/physical` with the singular `service + source` body. Consolidating it onto `DiffService.getPhysicalForService(service, source)` is sound: the body shape (`{ service, source }`) matches what the spec's signature accepts, and the unwrap (`response.data.data` at page line 171) matches the spec's "single `.data` unwrap" body contract.

Dead-method drop verification:
- `grep -rnE '\b(impactAll|putPhysicalConfig)\b' frontend/src --include='*.ts*'` returns only the declarations at `api.ts:439` and `:452`. Zero consumers. Dropping them is safe.

## Naming-alignment with #173

`get*` prefix: `getLogical`, `getPhysicalConfig`, `getPhysicalForService`, `getPhysicalAll`.

`IntegrityService.getReport()` precedent uses `get*`. Stereotype precedent (Pattern A) uses `useFile / useAll / loadAll / create / update / delete` — different verb space because it's CRUD-shaped, not query-shaped. For a Pattern B REST query wrapper, `get*` is the right verb prefix.

One borderline: `getPhysicalForService` is doing a `POST /diff/physical` under the hood (the action *computes* a diff against pasted DDL, with the body carrying the SQL). Semantically it's closer to a query than a mutation — no resource is created or persisted — so `get*` is defensible. Naming is consistent.

## DI registration shape

`dataDictionaryPlugin.ts` (verified against current main):

```ts
ctx.provide({
  provide: INTEGRITY_SERVICE_TOKEN,
  useValue: new IntegrityService(),
});
```

at lines 81-84, inside the `async initialize(ctx)` body (which spans roughly lines 34-85). Spec's instruction to add the `DIFF_SERVICE_TOKEN` provider "immediately after the existing `INTEGRITY_SERVICE_TOKEN` provider block (Pattern B → Pattern B grouping)" is sound and matches the precedent.

`dependsOn` on the plugin manifest already lists `['store', 'auth', 'store-fs']` (`bootstrap.ts:108`). Pattern B has no kernel deps, so the spec is correct in leaving the manifest untouched.

## Cookbook §1.5 / §2 carve-out

Cookbook §2 (post-642b43c) now explicitly states:

> **Pattern B note.** When the service is a REST wrapper (no Store FS node to read state from), the page falls back to `useState<loading|error>` per the §1.5 ephemeral-UI exception — see `IntegrityPage.tsx` and the §3b worked example. The two patterns are not symmetric here; ban Pattern B `useState` only when a Store FS-backed alternative exists.

The spec's posture (preserve `useState<diff|loading|error>` in both diff pages) is consistent with this carve-out. The "Out of scope" entry for "Removing useState<diff|loading|error>" is correctly framed.

## Acceptance criteria — baseline reproducibility

All 16 criteria are CI-checkable. Spot-check:
- #1 / #6 / #7 / #8: grep-based, deterministic.
- #2: line-count grep on a single export.
- #3 / #4: grep-based, would catch fab/regressions.
- #5: grep against `dataDictionaryPlugin.ts` initialize block.
- #9 / #10 / #11 / #12 / #13 / #14: vitest runs.
- #15: explicitly says "before implementation, files don't exist; after, they pass" — the baseline-CI-command rule is honored.
- #16: cross-suite assertion that the new diff guard does not regress the integrity guard.

Criterion #15's `git stash; ... ; git stash pop` formulation is fine for the spec's narrative but the implementing agent should not actually run it in CI — it's a contract description, not an executable command. The criterion is satisfied if the spec-grep-guards diff test file exists on the PR branch and passes; that's already covered by #11. Optional simplification: trim #15 to "the new test files do not exist on `main`" and merge with #11.

## Risk reassessment

Spec's risks (5 listed) cover token collision, vi.mock survivors, envelope mismatch on the 5th-consumer route, MSW URL prefix, and operand-union duplication. All are correctly diagnosed; mitigations are concrete.

Two additional risks the spec doesn't surface:

- **Merge-order risk with sibling #155 slices** (covered above in Required change #3). Likelihood: low (additive edits). Impact: mechanical rebase. Mitigation: orchestrator decides merge order.

- **`PhysicalDiffPage`'s local `Field` and `fieldStyle` are defined inside the same file** — verifying the local-axios cleanup at lines 20-25 doesn't accidentally take collateral. The spec's instruction (delete lines 13-25 along with the `import axios from 'axios'` line) is precise; verified the surrounding code uses `Field` (a JSX helper) and `fieldStyle` (a style object), neither of which lives in lines 13-25. No collateral risk.

## Cross-ticket conflicts

Three sibling specs share the same three files (`tokens.ts`, `dataDictionaryPlugin.ts`, `services/api.ts`) — all additive. No semantic conflict. Listed above as required change #3.

No conflict with #167 (multi-kind YAML — diff routes are computed REST, no YAML-level concern), #168 (Store FS path semantics — Pattern B has no Store FS surface), #163 (commands and events naming — the spec adds no commands and no events). The "Coordinates with #157" / "Coordinates with #166" callouts in Dependencies are correctly framed: #157 may rewrite the routes later, #166 expansion will not touch Pattern B services.
