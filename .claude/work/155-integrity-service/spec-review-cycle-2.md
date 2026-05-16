# Spec review — #155 (slice): IntegrityService — Pattern B pilot  (cycle 2)

## Verdict
**approve**

All four cycle-1 required changes are addressed concretely. The cycle-2 diff is a tightening pass with no scope expansion. One minor inaccuracy noted in the framework citation table (does not block implementation).

## Cycle-1 issue checklist

| # | Cycle-1 required change | Resolution in cycle 2 | Status |
|---|---|---|---|
| 1 | Resolve criterion #9 `dependsOn: []` vs "register all" contradiction | Criterion #9 rewritten to use `bootstrapApplication()` + singleton `host` exclusively. Lines 255-260 contain no `dependsOn: []` framing, no "Decision: use the second" language. The sentence "no manual `new Host(...)` construction, no manual `dependsOn` list" is explicit. | Fixed |
| 2 | Align bootstrap test with the StereotypesPage.bootstrap.test.tsx precedent | Spec explicitly cites `StereotypesPage.bootstrap.test.tsx` at lines 31, 255, 295, 299. Criterion #9's procedure (`beforeAll` → `bootstrapApplication()` → `host.rootActivationCtx!.resolve(...)` → assert method shape) is a structural match for the precedent (verified by reading the precedent file via `git show arch/166-stereotype-slice:frontend/src/pages/__tests__/StereotypesPage.bootstrap.test.tsx`). | Fixed |
| 3 | `vi.mock('axios')` replaced by constructor injection + MSW | `grep -nE "vi\.mock" spec.md` returns 5 hits — all of them are either (a) describing the OLD test that will be deleted, or (b) explicit negative statements ("No `vi.mock('axios')`", "fully deleted", "the integrity sub-API no longer exists to mock"). The IntegrityService unit test uses constructor-injected stub `AxiosInstance` (criterion #8). The page-level test uses MSW (criterion #10). MSW handler bleed pitfall pinned in criterion #10 and Risk 6. `frontend/package.json` confirms `msw` is a real dependency (`"msw": "^2.2.3"`). | Fixed |
| 4 | Citation `:23-32` consistently | All four mentions in the spec now read `:23-32` (lines 90, 118, 281, 297). Verified against `frontend/src/services/api.ts:23-32` directly — the interceptor block begins with `api.interceptors.request.use((config) => {` on line 23 and ends with `});` on line 32. | Fixed |

## Scope-expansion audit (cycle 2 of 3)

Cycle-1 spec had:
- 7 "Files touched" entries → cycle 2 has 7 entries (no growth).
- 13 acceptance criteria → cycle 2 has 13 (criterion #11 rewritten from "verify before implementation" to "confirmed fact" per cycle-1 suggestion #4 — same count).
- 5 risks → cycle 2 has 7 (Risk 6 "MSW handler bleed" and Risk 7 "Branch-base churn on `arch/166-stereotype-slice`" added).

Risks 6 and 7 were both surfaced by cycle-1 review as risks the spec didn't capture but should — these are absorbed reviewer suggestions, not scope expansion. The two new risks document existing constraints, they do not introduce new work.

The "Cookbook §2 anti-pattern" discussion in Scope discovery (line 20) is unchanged from cycle 1 — preserved verbatim including the `// TODO(#155-followup)` anchor suggestion. No new files-touched, no new acceptance criteria. The HomePage migration remains in Files touched (line 29), captured by acceptance criterion #5, and the `integrityApi` removal is verified by criterion #5's `grep ... HomePage.tsx returns zero hits` clause plus the repo-wide criterion #7.

## HomePage migration verification

- Files touched line 29 still includes HomePage.tsx with the same one-import-and-one-call-site change.
- Acceptance criterion #5 still asserts `grep -n "integrityApi" frontend/src/pages/HomePage.tsx` returns zero hits AND `useService(INTEGRITY_SERVICE_TOKEN)` returns at least one hit. Criterion is testable and non-vacuous.
- Acceptance criterion #7 (repo-wide `grep -rn "integrityApi" frontend/src` returns zero hits) catches any escapee.
- Risk 3 explicitly names HomePage as the second consumer site.

HomePage migration is preserved through cycle 2.

## Framework citation verification (cycle 2 deltas)

Cycle 2 introduces no new framework citations beyond what cycle 1 already had. The only newly-relevant citation is the explicit MSW dependency:

| Cited path | Verified | Notes |
|---|---|---|
| `frontend/package.json` — `"msw": "^2.2.3"` | yes | Line 66 of frontend/package.json |
| `frontend/src/test/setup.ts` — `server.resetHandlers()` in `afterEach` | yes | Line 116 of setup.ts confirms `afterEach(() => { cleanup(); server.resetHandlers(); })`. Risk 6 and criterion #10 correctly require `beforeEach` re-installation |
| `arch/166-stereotype-slice:frontend/src/pages/__tests__/StereotypesPage.bootstrap.test.tsx` — uses `bootstrapApplication()` + `beforeAll` + `beforeEach` MSW re-install pattern | yes | Confirmed; the precedent test re-installs `http.get('/api/stereotypes', ...)` in `beforeEach`. The spec's structural mirror is correct |
| `arch/166-stereotype-slice:frontend/src/kernel/bootstrap.ts` — `bootstrapApplication`, `getStore`, exported `host` | yes | Line 178 declares `export async function bootstrapApplication(): Promise<boolean>` (NOT `Promise<void>` as the spec's "Framework APIs used" section claims at line 233 — see Suggestions) |
| `arch/166-stereotype-slice:frontend/src/kernel/useService.ts` — `useService<T>(token: symbol \| string): T` throws if `host.rootActivationCtx` is null | yes | Exact signature match; the spec's Risk 2 accurately characterizes the throw behavior |
| `frontend/src/services/api.ts:23-32` (auth interceptor) | yes | Block now correctly spans 23-32 in all spec references |
| `frontend/src/services/api.ts:628-651` (integrityApi block) | yes | Unchanged from cycle 1; still verified |

## Suggestions (optional, won't block)

- Minor accuracy nit: spec line 233 declares `bootstrapApplication(): Promise<void>` but the actual signature on the branch base is `Promise<boolean>` (returns `true` on success or rethrows on failure). The spec's test plan only uses `await bootstrapApplication()` (discards return value), so this does not affect implementability — but the citation is technically inaccurate. Easiest fix: change "`Promise<void>`" to "`Promise<boolean>`" in line 233 if/when the spec gets a touch-up pass. Not a blocker.

- Files-touched line 33 says "if PR #172 added one for STEREOTYPE_SERVICE_TOKEN, EXTEND it" — verified that the STEREOTYPE bootstrap test actually lives at `frontend/src/pages/__tests__/StereotypesPage.bootstrap.test.tsx`, NOT under `frontend/src/plugins/data-dictionary/__tests__/`. There is no existing file to "extend" at the spec's proposed path. The conditional reads slightly off but the path itself is correct (a new file). Implementer will simply create the new file; no action required.

## Risk reassessment (independent)

The spec's seven risks are accurate. The cycle-1 review surfaced "register-order pitfall" (now absorbed into the spec's posture — by using `bootstrapApplication()` the test inherits the full production plugin chain with correct `dependsOn` ordering, so the original risk is dissolved by the criterion-#9 rewrite rather than mitigated).

No new substantive risks emerged in cycle 2 beyond what the spec captures.

## Cross-ticket conflicts

Re-checked against in-flight specs:
- `.claude/work/156-notification/spec.md` (PR #171, OPEN): independent. Touches `notificationPlugin.ts` only.
- `arch/166-stereotype-slice` (PR #172, OPEN): branch base. Additive append to `tokens.ts` and `dataDictionaryPlugin.initialize`. Documented as Risk 7.
- No conflict with #106 (multi-kind YAML), #85 (validation/constraint/rule trinity — the integrity endpoint preserves all three), #168 (path semantics — Pattern B is path-agnostic), #163 (command/event naming — this PR adds no commands or events).

No cross-ticket blockers.

## Net assessment

Cycle 2 addressed every cycle-1 required change with concrete, surgical edits. No scope expansion. The single inaccuracy noted (`Promise<void>` vs `Promise<boolean>`) is a citation typo, not a design flaw. Approve and ship.
