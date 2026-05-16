# Spec review — #155-diff: DiffService Pattern B proof  (cycle 2)

## Verdict
**approve**

All three required changes from cycle 1 are applied cleanly. No new bugs or scope expansion introduced. The spec is implementable as written.

## Cycle 1 fix verification

1. **Misattributed comment scrub — option (a) chosen.** Verified:
   - Files-touched bullet for `services/api.ts` (spec line 14) now reads "is **left alone** — those are unrelated stale headers outside this slice's scope." Cycle 2 fix language is explicit and traces back to the cycle 1 review's finding.
   - Out of scope entry (spec line 210) added: "Scrubbing the stale `// Diff API (#86)` / `// Project management (#95)` comment pair at `services/api.ts:375-376` — these precede `filesystemApi`, not `diffApi`, and are unrelated to this slice." Explicit no-scrub posture is documented.

2. **`PhysicalConfig` typing — option (b) chosen.** Verified:
   - DiffService.ts surface (spec line 78): `export type PhysicalConfig = { dialect?: string; [k: string]: unknown } | null;` — narrowed as required.
   - Docblock at lines 64-77 explains the read-site reasoning (PhysicalDiffPage.tsx:327 reads `cfg.dialect`).
   - Page state retyping noted at spec line 154: "the `physicalConfigs` state currently typed `Record<string, any>` (line 90) should retype to `Record<string, PhysicalConfig>`". Confirmed `PhysicalDiffPage.tsx:90` is indeed `useState<Record<string, any>>({})` — the line cite is correct.
   - Acceptance criterion #13 (spec lines 190-192) pins the read-site rendering: "when the MSW handler returns a config row of shape `{ dialect: 'postgres' }`, the rendered radio label reads `Live (postgres)` (line 327 read site, with the cycle-2 narrowed `PhysicalConfig` type)." Pin is explicit and testable.

3. **Sibling-slice rebase note.** Verified:
   - New "Coordination notes — sibling #155 slices" subsection at spec lines 220-228, under Dependencies.
   - All three shared files called out: `frontend/src/kernel/tokens.ts`, `frontend/src/plugins/data-dictionary/dataDictionaryPlugin.ts`, `frontend/src/services/api.ts`.
   - Additive merge semantics documented: "non-overlapping append-or-delete operations on different identifiers" and "trivial mechanical rebase" with "at most one conflict marker per file, resolved by accepting both additions in their original positions."
   - Cross-verified against `.claude/work/155-import-export/spec.md`: that sibling spec edits the same three files (tokens.ts line 23, dataDictionaryPlugin.ts line 25, api.ts line 30) additively, confirming the conflict surface description is accurate.

## Cycle 2 delta scope check

- **Files touched count:** 10 (same as cycle 1).
- **Acceptance criteria count:** 16 (same as cycle 1). Content largely unchanged; criterion #13 gained the cycle-2 narrowed-type assertion (rendered radio label = "Live (postgres)") which directly serves required change #2 — clean and targeted.
- **Out of scope list:** grew by one entry (the explicit no-scrub posture, required change #1) — expected.
- **Risks:** 5 listed, same set as cycle 1. Risk 5 (last paragraph) was edited to reflect the narrowed `PhysicalConfig` shape; risk count unchanged.
- **Framework citations:** unchanged set; off-by-one on `di.d.ts:14` → `:15` from cycle 1 is now corrected (spec line 160).

No unexpected scope expansion. No new method added to the public surface. No new file added to Files touched. The cycle 2 edit was indeed small and targeted to the three required changes.

## Framework citation verification (re-verified)

| Cited path | Verified | Notes |
|---|---|---|
| `frontend/node_modules/@hamak/microkernel-api/dist/types.d.ts:36-51` (`Provider<T>` union) | yes | `ClassProvider` 36-41, `ValueProvider` 42-45, `FactoryProvider` 46-50, `Provider<T>` union line 51. Matches verbatim. |
| `frontend/node_modules/@hamak/microkernel-spi/dist/plugin.d.ts:3` (`InitializationContext.provide<T>(prov: Provider<T>): void`) | yes | Line 3 reads `provide<T>(prov: Provider<T>): void;`. |
| `frontend/node_modules/@hamak/microkernel-impl/dist/runtime/di.d.ts:15` (`resolve<T>(token)`) | yes | Cycle 2 corrected the line cite from `:14` to `:15`. Verified: `resolve<T>(token: Token<T>): T;` is on line 15. |
| `useService.ts:23` (consumes `host.rootActivationCtx.resolve<T>(token)`) | yes | Pattern present, identical to integrity precedent. |
| `axios.AxiosInstance` + `axios.create({...})` + `interceptors.request.use(...)` | yes | Same surface `IntegrityService.createDefaultHttp` uses (verified at `frontend/src/plugins/data-dictionary/services/IntegrityService.ts:60-74`). |
| `msw` v2 `http.post`/`http.get` + `HttpResponse.json(...)` | yes | Same surface as IntegrityPage tests. |

No fabricated APIs. Every citation maps to a real type or function.

## Suggestions (non-blocking)

These are observations, not required changes. The implementing agent does not need to act on them.

- **Line-number drift in `services/api.ts` cites.** The spec uses `:375-376` for the `// Diff API (#86)` / `// Project management (#95)` comments, `:425-456` for the `diffApi` block, and `:428, 437, 445, 450, 454` for the envelope cites in the method-body contract section. Actual current-main line numbers are `:364-365`, `:414-445`, and `:417, 426, 434, 439, 443` respectively (drift of ~11 lines, likely inherited from a pre-#173 snapshot). The structural claim is correct in every case — the comments do precede `filesystemApi`, the `diffApi` block is the right shape, the envelopes are uniform — so this does not block implementation. The implementing agent will grep for the identifier (`diffApi`, `// Diff API`) rather than blindly editing a line number, and the existing acceptance criteria are grep-based (#1, #2, #4, #5, #6, #7, #8) so they are immune to line drift. Optional follow-up: refresh the line cites against `git show main:frontend/src/services/api.ts | grep -n ...` next time the spec is regenerated.

- **Acceptance criterion #15** still describes a baseline-reproducibility contract (the five new test files don't exist on `main`). Cycle 1 flagged this as redundant with #11. Cycle 2 left it as-is, which is fine — it's not wrong, just slightly redundant. Not worth a rework.

- **Cycle 1 suggestion #1** (trim the misleading "`404 → undefined here`" parenthetical in the `PhysicalConfig` docblock) was partly addressed: the new docblock (spec lines 64-77) does not contain the misleading phrasing — instead it says "The backend route returns `null` when no config is persisted; the page's `try/catch` handles the 404 path (the service contract itself is success-only)." Cleaner than cycle 1.

## Risk reassessment

Spec's risks (5) are unchanged in count and content from cycle 1, with risk 5 minimally updated to reflect the narrowed `PhysicalConfig`. All mitigations remain concrete and testable:
- Token collision — guarded by acceptance criterion #2 (single declaration assertion).
- vi.mock survivors — pre-PR grep documented; current grep confirms zero survivors today.
- Envelope mismatch on `/diff/physical` — verified consistent (page line 171 = `response.data.data`); page test asserts an observable DOM signal.
- MSW prefix — copied from IntegrityPage.test.tsx precedent.
- Type over-tightening — narrowed `PhysicalConfig` admits any backend-row shape via index signature; future read sites narrow at the read site.

No additional risks surfaced in cycle 2.

## Cross-ticket conflicts

None. Sibling specs `155-import-export` and `155-search` modify the same three shared files (`tokens.ts`, `dataDictionaryPlugin.ts`, `services/api.ts`) additively — different token symbols, different `useValue` blocks inside `initialize`, different api.ts exports deleted. The spec's new Coordination notes subsection accurately describes the merge-order semantics. No semantic conflicts.

No conflict with #167 (multi-kind YAML — diff routes are computed REST, no YAML touch), #168 (Store FS path semantics — Pattern B has no Store FS surface), #163 (commands and events naming — no commands or events added by this spec). #157 / #166 coordination callouts in Dependencies are unchanged and accurate.

## Bottom line

Cycle 2 applied all three required cycle 1 changes precisely and with no unintended scope expansion. The spec is implementable as written. Approve.
