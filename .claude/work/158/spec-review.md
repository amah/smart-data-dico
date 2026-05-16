# Spec review — #158: arch: decide and document backend microkernel direction (cycle 1)

## Verdict
**rework**

The spec arrives at the right recommendation (Option B) and most of its evidence holds up to verification, but it has three concrete factual errors that will mislead a reader of the ADR if copied through, plus one acceptance criterion that is not mechanically testable and one audit claim that is verifiably false. Fix these and re-submit; no escalation needed.

## Required changes

1. **Fix the `@hamak/microkernel-impl` version citation.** Spec line 56 says "v0.5.6" and cites the source-of-truth at `/Users/amah/Devs/projects/app-framework/packages/microkernel/microkernel-impl/package.json`. That file does indeed say 0.5.6, but the version *installed in this repo* (`frontend/node_modules/@hamak/microkernel-impl/package.json`, also `microkernel-api` and `microkernel-spi`) is **0.5.5** (per `frontend/package.json`'s caret range `^0.5.2`). The ADR must cite the *installed* version, otherwise the audit (criterion 9) is grounded on a version we don't actually have. Either change "v0.5.6" to "v0.5.5 installed (framework workspace at 0.5.6)" or drop the version entirely.

2. **Fix the route-count claim.** Spec line 16 says "`~99` router entries". Actual count is **115** (`grep -cE "router\.(get|post|put|delete|patch|all|use)" backend/src/routes/index.ts` returns 116, or 115 if you exclude `router.use`). A ~16% under-count weakens the "high refactor cost" argument's credibility. Either re-count or remove the precise figure and say "well over 100".

3. **Fix the demo-back line count.** Spec line 13 says "320 lines"; `wc -l` reports 319. Trivial alone, but combined with #1 and #2 the spec has a pattern of round-up errors. Round to "~320" or use the precise 319.

4. **Fix the framework dependency audit claim in criterion 9.** Spec says: *"`backend/package.json` lists `@hamak/filesystem-server-{api,impl,spi}`, `@hamak/shared-utils`, `@hamak/ui-remote-git-fs-backend`. All are used by `server.ts` / `EntityFileAdapter.ts` today; the audit confirms no trim is needed."* This is false. `grep -r "@hamak/" backend/src/` shows only **two** of the five are imported in source: `@hamak/filesystem-server-impl` and `@hamak/ui-remote-git-fs-backend`. The other three (`@hamak/filesystem-server-api`, `@hamak/filesystem-server-spi`, `@hamak/shared-utils`) are direct deps with **zero** source references — they may be needed transitively for type resolution, but the spec must not claim they are "used by server.ts / EntityFileAdapter.ts" without evidence. The audit should be written honestly: investigate whether the three unreferenced deps are needed transitively, and if not, propose trimming them (or explicitly defer with a one-line justification). Right now the spec pre-decides the audit's outcome based on a false premise.

5. **Criterion 5b is not mechanically testable.** The current wording:
   > `grep -iE "(server-side )?(host|microkernel)" CLAUDE.md | grep -i backend` either (a) finds no claim of a backend Host, or (b) finds only a sentence explicitly disclaiming one.
   
   The escape clause "or finds only a sentence explicitly disclaiming one" requires human reading. Worse, the regex already matches the existing CLAUDE.md opening paragraph ("In dev mode the backend serves the bundled sample project at `samples/eshop/`... Built on the **@hamak/app-framework** microkernel architecture") — which is a frontend-microkernel claim, not a backend one, but the grep can't tell. Either:
   - Tighten the regex so it only matches a backend-microkernel claim (e.g. anchor on "backend ... host" within N words, not on a single line that happens to mention both); or
   - Drop the mechanical check and replace it with a positive content assertion: "the Backend layers section contains a sentence matching `/plain Express.*(no|without).*(microkernel|server-side Host)/i`". A positive grep is checkable; a negative grep with manual fallback is not.
   
   Per the calibration finding committed in `4a72ec1` (re: regex narrowness for CI-style content guards), this criterion fails the test.

## Suggestions (won't block)

- The ADR template (spec lines 36-50) is good but does not include a "Date" line distinct from `Status: Accepted (YYYY-MM-DD)`. Criterion 3 requires the date inside the Status line, which is fine; just note that some ADR conventions put a separate `Date:` line — your call.
- The risk section is honest about brittleness of memory-file edits (risk 4). Consider stating in the ADR's "Consequences → Negative" section that the canonical record is the in-repo ADR, so a future contributor knows where to look first.
- Acceptance criterion 8 ("For Option A only (not applicable here)") is dead weight in an Option-B spec. Delete it; the special-review notes explicitly say "the spec must NOT propose follow-up implementation tickets" — criterion 8 only exists to satisfy the orchestrator template. Removing it makes the acceptance list cleaner.
- Consider citing the ticket-comment count (zero comments on #158 — verified by `gh issue view 158`); the spec implicitly assumes no comments by treating the body as complete, but stating it explicitly future-proofs against the "did you read the comments?" question.

## Framework citation verification

| Cited path | Verified | Notes |
|---|---|---|
| `/Users/amah/Devs/projects/app-framework/apps/demo-back/src/server.ts` (320 lines) | partial | File exists. Actual length 319, not 320. Imports `WorkspaceManager`, `FileRouter`, `FileInfoEnricherRegistry` from `@hamak/filesystem-server-impl`; `createGitService`, `createGitFileInfoEnricher`, `createGitRoutes`, `gitErrorHandler` from `@hamak/ui-remote-git-fs-backend`; `EventChannelServer`, `createEventChannelRoutes` from `@hamak/event-channel-backend`. No `@hamak/microkernel-*` import. Confirmed. |
| `/Users/amah/Devs/projects/app-framework/apps/demo-back/package.json` | yes | Deps exactly as spec claims: `@hamak/filesystem-server-{api,impl,spi}`, `@hamak/ui-remote-git-fs-backend`, `@hamak/event-channel-backend`, `@hamak/shared-utils`. No microkernel deps. |
| `/Users/amah/Devs/projects/app-framework/packages/microkernel/microkernel-impl/package.json` (v0.5.6) | partial | File exists, version *in the framework workspace* is 0.5.6. **Installed** version in `smart-data-dico/{frontend,backend}/node_modules` is **0.5.5**. Spec should cite the installed version. `"type": "module"`, `"sideEffects": false`, ESM exports — all confirmed. |
| Microkernel src has no `document`/`window`/`navigator`/`React` refs | yes | `grep -lE "(document\|window\|navigator)\b"` returns empty on `src/runtime/*.ts` and `src/ui/adapter.ts`. `grep -lE "React"` returns empty. Node-compatibility claim holds. |
| `backend/src/server.ts:90-99` (git mount), `:107-108` (fs mount) | yes | Line ranges match the current source. |
| `backend/src/routes/index.ts` ~99 router entries | **no** | Actual count 115 (or 116 incl. `router.use`). Cited figure is ~16% low. |
| 14 controllers, 27 services | yes | `ls backend/src/controllers/*.ts | wc -l` = 14; `ls backend/src/services/*.ts | wc -l` = 27. Confirmed. |
| `backend/package.json` deps audit (criterion 9) | **no** | Spec claims all 5 `@hamak/*` deps are used; only 2 are imported in source. See required change #4. |

## Risk reassessment

The spec's own risk list is honest and reasonable. I'd add one more, which is implicit in the special-review notes but worth stating:

- **Risk 6: The ADR is written with confidence that doesn't survive a future framework release that ships a server-side Host pattern.** The spec already handles this (risk 1) but treats it as low-likelihood. Given that `apps/demo-back` recently added `@hamak/event-channel-backend` (not present in the spec's narrative, but visible in `server.ts` lines 11, 67-73), the framework is *actively evolving* its server-side surface. The ADR should note explicitly: "as of YYYY-MM-DD, the framework's server-side surface is FS + git + event-channel; if a future server-side `Host` ships, ADR-0001 should be revisited." This is a one-sentence addition to "Consequences → Negative".

The independence of the recommendation passes my check. The spec did not blindly echo the ticket body's "Lean Option B"; it cites four independent signals (framework demo backend, framework demo package.json, ESM-but-not-sufficient, refactor cost), and three of them are verifiable from outside the ticket. The fourth (refactor cost) has the route-count error noted in required change #2 but the qualitative conclusion ("controllers/services count is high enough that wrapping each as a DI plugin is real work") survives intact.

## Cross-ticket conflicts

None. Other in-flight specs (`155-{diff,import-export,search,integrity-service}`, `156`, `166-stereotype-slice`) reference `@hamak/microkernel-{api,spi}` only on the frontend side via DI tokens, never as a backend Host. ADR-0001's scope (backend only) and the frontend-microkernel goal of those specs do not collide.

#157 (split routes/index.ts) is correctly cited as coordinating-but-independent. Verified open via `gh issue view 157`. The spec does NOT couple #158 to #157.

No follow-up implementation tickets are proposed (correct for Option B).
