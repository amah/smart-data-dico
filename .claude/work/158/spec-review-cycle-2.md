# Spec review — #158: arch: decide and document backend microkernel direction  (cycle 2)

## Verdict
**approve**

All 5 required changes from cycle 1 are correctly applied. No collateral regressions detected. Suggestions from cycle 1 (ADR Date line, dead-weight criterion 8 for Option A, ticket-comment-count statement) were partly absorbed — the dead-weight criterion is gone, the zero-comments statement is now explicit at line 7, and the ADR-template Status-line convention is preserved. These were non-blocking either way.

## Cycle-1 → cycle-2 delta verification

| # | Required change | Spec change | Verified |
|---|---|---|---|
| 1 | Version 0.5.6 → 0.5.5 | Line 64: "**installed v0.5.5** ... satisfying the `^0.5.2` range ... framework workspace ... has tagged 0.5.6, which is not yet released into this repo". Line 15 in `apps/demo-back` reference unchanged (no version cited there). | `cat frontend/node_modules/@hamak/microkernel-impl/package.json` → `"version": "0.5.5"`. ✅ Matches. |
| 2 | Route count ~99 → 115 | Line 18: "**115** `router.<verb>(...)` entries (per `grep -cE "^\s*router\.(get\|post\|put\|delete\|patch\|options\|head)\b" backend/src/routes/index.ts`)". Command embedded so reader can re-verify. | `grep -cE "^\s*router\.(get\|post\|put\|delete\|patch\|options\|head)\b" backend/src/routes/index.ts` → 115. ✅ Matches. |
| 3 | demo-back 320 → 319 | Lines 15, 67, and ADR-references section all consistently say "319 lines". | `wc -l /Users/amah/Devs/projects/app-framework/apps/demo-back/src/server.ts` → 319. ✅ Matches. |
| 4 | Dep audit pre-decided on false premise → open question | Old criterion 9 reworked into criterion 8 (lines 87-90). Now says: *"audit is **not pre-decided** by this spec"*. Spec honestly lists which deps have zero source refs (`filesystem-server-api`, `filesystem-server-spi`, `shared-utils`) and which are actually imported (`filesystem-server-impl`, `ui-remote-git-fs-backend`), and requires the developer to record a per-dep keep/remove verdict in the ADR's Consequences section. Mechanical check: ADR must contain substring "dependency audit" and name all three currently-unreferenced direct deps with a verdict. | `grep -rh "@hamak/" backend/src/ | grep -oE "@hamak/[a-z-]+" | sort -u` → returns only `@hamak/filesystem-server-impl` and `@hamak/ui-remote-git-fs-backend`. ✅ Spec's enumeration of the three unreferenced direct deps is accurate. |
| 5 | Criterion 5b regex too broad → narrow literal | Old criterion 5b deleted entirely. New criterion 5 (lines 77-84) uses literal-string `grep -Fc "Backend is a plain Express app; the framework provides only the FS and git route mounts." CLAUDE.md` and requires result = 1. The exact fingerprint sentence is locked at line 56 of the spec so the implementer and the test agree verbatim. No alternations, no manual escape clause. | Aligns with calibration finding `4a72ec1` (narrow regex). ✅ Mechanically testable on a CI runner. |

## Collateral regression sweep

| Item | Status |
|---|---|
| demo-back path citation (`/Users/amah/Devs/projects/app-framework/apps/demo-back/src/server.ts`) | ✅ Path still exists; unchanged from cycle 1. |
| 14 controllers / 27 services count | ✅ `ls backend/src/controllers/*.ts \| wc -l` = 14; `ls backend/src/services/*.ts \| wc -l` = 27. Unchanged. |
| File-list scope (ADR + CLAUDE.md edit + memory annotation, no code) | ✅ Lines 26-30 unchanged. Still docs-only. |
| "No implementation tickets" rule | ✅ Line 30: "No follow-up implementation tickets to file (Option B closes this work)." Line 105: "No downstream tickets to file (Option B)." References on lines 94 and 105 to "follow-up tickets" are correctly framed as the Option-A counterfactual / hypothetical ADR-0002 future, not as proposals from this spec. |
| `routes/index.ts` line count (cited as "single 373-line" file) | ✅ `wc -l backend/src/routes/index.ts` = 373. Matches. |
| Zero comments on #158 (newly added in cycle 2 at line 7) | ✅ Adds robustness against "did you read the comments?" — confirmed accurate (cycle-1 review independently noted `gh issue view 158` had zero comments). |

## Framework citation verification (cycle 2)

| Cited path / claim | Verified | Notes |
|---|---|---|
| `frontend/node_modules/@hamak/microkernel-impl/package.json` v0.5.5 | ✅ | `"version": "0.5.5"`, `"type": "module"`. Installed version now correctly cited. |
| `app-framework/.../microkernel-impl/package.json` v0.5.6 (framework workspace) | ✅ | Unchanged from cycle 1; spec now correctly distinguishes workspace vs installed. |
| `apps/demo-back/src/server.ts` (319 lines) | ✅ | Line count corrected. |
| `apps/demo-back/package.json` deps list | ✅ | Unchanged; verified in cycle 1. |
| 115 router verb entries in `backend/src/routes/index.ts` | ✅ | Matches the embedded grep command exactly. |
| 14 controllers, 27 services | ✅ | Unchanged. |
| Only 2 of 5 `@hamak/*` direct deps imported in `backend/src/` | ✅ | Cycle-1 finding now reflected in spec criterion 8. |
| Microkernel src has no DOM/React globals (Node-compat claim) | ✅ | Unchanged from cycle 1. |

## Risk reassessment

The spec absorbed cycle 1's Risk 6 (framework evolving server-side surface) into Risk 1 (lines 109) — it now cites `apps/demo-back/src/server.ts` lines 11 and 67-73 wiring `@hamak/event-channel-backend` as evidence the framework is actively evolving, and names "future framework server-side `Host`" as an ADR revisit trigger. This is a clean improvement.

No new risks surface in cycle 2.

## Cross-ticket conflicts

None new. Cross-cutting check from cycle 1 (other in-flight specs reference `@hamak/microkernel-{api,spi}` only frontend-side; #157 independent) remains valid. The cycle-2 edits do not touch any boundary that could introduce a fresh conflict.

## Summary

Approve. Spec is implementable as written. The Cycle-1 evidence chain (4 independent signals for Option B) is preserved, and the three factual errors plus two methodological flaws (false-premise audit, broad regex) are all repaired. Ready for the implementer.
