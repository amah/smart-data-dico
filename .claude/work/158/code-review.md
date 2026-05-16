# Code review — #158: arch: decide and document backend microkernel direction  (cycle 1)

## Verdict
**approve**

The diff is small, faithful to the spec, and the dependency removal is safe. The ADR is honest about trade-offs, correctly cites the framework's own reference backend as evidence, and gives Option A a fair (if brief) hearing in Alternatives. All 8 acceptance criteria pass on a mechanical re-check. The dependency removal does not break the build any further than the pre-existing baseline (14 TS errors before, 14 TS errors after — identical set). One small suggestion below; not blocking.

## Required changes
None.

## Suggestions (optional, won't block)

1. **CLAUDE.md line 7 (Project Overview) still says "Built on the **@hamak/app-framework** microkernel architecture for modularity and plugin support."** This is the top-of-file framing that a contributor reads first. It is not in the Backend layers section (so criterion 6 passes) and it is true of the project as a whole (frontend uses microkernel), but a contributor scanning CLAUDE.md may still infer the whole stack — backend included — is microkernel-based. Consider rewording on a future docs pass to make explicit that the microkernel architecture applies to the frontend only. Not in scope for #158 since the spec's CLAUDE.md edit was narrowly scoped to the Backend layers section, but worth a one-line follow-up.

2. **ADR Alternatives §A bullet 4 is the weakest argument.** *"Its `src/ui/adapter.ts` export name suggests the primary design intent is UI-side"* — this is soft inference and conflicts with the ADR's own earlier admission (Decision §3) that the package is genuinely Node-compatible. The first three rejection bullets (framework demo-back, refactor cost, route modularity addressed by #157) are concrete and sufficient. Consider dropping the fourth bullet to tighten the argument; not blocking.

3. **ADR Consequences → Negative could explicitly cite the framework's `event-channel-backend` evidence as a revisit trigger.** The spec's Risk 1 (and cycle-2 spec review) call out that the framework is actively evolving its server-side surface (`apps/demo-back` recently added `@hamak/event-channel-backend`). The ADR mentions "future framework server-side `Host`" as a trigger (Negative bullet 2) but does not cite the concrete evidence of active evolution. A one-sentence reference would harden the ADR against staleness. Not blocking.

## Acceptance-criterion coverage

| # | Criterion | Implemented | Notes |
|---|---|---|---|
| 1 | ADR exists at `docs/adr/0001-backend-architecture.md` | yes | `test -f` confirms; 144 lines |
| 2 | Decision summary in first 30 lines matches `/decision[:\s].*(option b|plain express|no.*microkernel)/i` | yes | Line 4: `Decision: Option B — plain Express; no server-side microkernel adoption.` — matches all three alternations |
| 3 | Status line `Accepted (YYYY-MM-DD)` | yes | Line 3: `Status: Accepted (2026-05-15)` — regex matches |
| 4 | Alternatives section names `@hamak/microkernel-impl` and explains rejection | yes | Lines 109-133; explicit "Why it was rejected" with 4 bullets |
| 5 | CLAUDE.md contains literal fingerprint sentence (grep -Fc returns 1) | yes | Line 36; verified `grep -Fc` returns exactly `1` |
| 6 | No stale backend-microkernel TODO in CLAUDE.md | yes | `grep -iE` returns no matches; the Backend section itself (lines 34-46) is clean of aspirational microkernel/Host language |
| 7 | `project_migration.md` annotated (preserved history) with ADR-0001 ref | yes | Line 13 HTML comment annotates; original "Why" line 12 untouched; `grep -Fc "0001-backend-architecture"` returns 1 |
| 8 | ADR Consequences contains `dependency audit` substring and per-dep verdict for 3 unreferenced deps | yes | ADR §Dependency audit (line 88) names all three (`filesystem-server-api`, `filesystem-server-spi`, `shared-utils`) with **Remove from direct deps** verdict and rationale |

## Per-dep audit verification

| Dep | Removed from `backend/package.json` | Transitive via `filesystem-server-impl`? | Still resolved in `node_modules`? |
|---|---|---|---|
| `@hamak/filesystem-server-api` | yes (line 19 removed) | yes — `filesystem-server-impl/package.json` lists it in `dependencies` | yes — `node_modules/@hamak/filesystem-server-api/` present, package-lock has `node_modules/@hamak/filesystem-server-api` entry |
| `@hamak/filesystem-server-spi` | yes | yes — same source | yes — present in node_modules and lock |
| `@hamak/shared-utils` | yes | yes — same source | yes — present in node_modules and lock |

`backend/node_modules/@hamak/filesystem-server-impl/package.json` line 39-46 confirms the transitive chain: deps include `filesystem-server-api`, `filesystem-server-spi`, `microkernel-api`, `microkernel-spi`, `shared-utils`. Removal of the three direct deps is therefore safe at runtime.

## Baseline-broken vs ticket-broken verification

Ran `git stash` of CLAUDE.md / backend/package.json / backend/package-lock.json, then `cd backend && npm run build`:

| State | TS errors | Error set |
|---|---|---|
| Baseline (main) | 14 | `EntityFileAdapter.ts` × 3 (WorkspaceManager/FileRouter/FileInfoEnricherRegistry TS2339), `aiController.envBypass.test.ts` × 4 (TS2835), `Dictionary.test.ts` × 4 (TS2741/TS2724/TS2339), `appDir.test.ts` × 2 (TS2835), `Dictionary.test.ts` `relationships` TS2741 ×1 |
| With diff applied | 14 | Identical set |

Dev's baseline-broken claim verified. The dep removal introduces zero new build failures. (Note: `EntityFileAdapter.ts` failure is independent of the removed direct deps — it imports from `@hamak/filesystem-server-impl`, which remains a direct dep; the TS2339 errors point at a pre-existing version-skew between the installed `0.5.2` impl package and its `.d.ts` exports, not at this ticket.)

## Package-lock.json sanity check

The lock-file diff is larger than the strict 3-dep removal would suggest, but it is benign:

- 3 direct-dep entries removed at the top-level `packages.""` block (matches package.json).
- `optionalDependencies` block in package-lock renamed to `peerDependencies` with `peerDependenciesMeta.*.optional: true`. This re-synchronises the lock file to the current `package.json` (which already had `peerDependencies` on `main` — the lock was stale).
- `oracledb` moved from `dependencies` to `peerDependencies` block at the top-level — matches the package.json on `main`.
- Many `+      "peer": true,` additions on existing `@azure/*` / driver-related entries — npm flagging that these are now reachable via peer rather than direct deps.

None of these are unauthorised scope creep; they are the natural output of `npm install` re-synchronising the lock against a `package.json` that was already (pre-existing on `main`) using `peerDependencies` for the four DB drivers. The 3-dep removal is the only semantic change.

## Memory file annotation verification

`~/.claude/projects/-Users-amah-Devs-projects-smart-data-dico/memory/project_migration.md` line 13:

```
<!-- NOTE: Backend-microkernel scope superseded by ADR-0001 (`docs/adr/0001-backend-architecture.md`, decided 2026-05-15, Option B). Frontend-microkernel goal remains in force. -->
```

History preserved: original line 10 ("Migrating smart-data-dico to use @hamak/app-framework microkernel architecture") and line 12 ("Why: Better modularity ...") untouched. HTML comment is appropriate for markdown — it renders invisibly to readers but is indexable by Claude's memory loader. Annotation is honest about scope split (backend superseded, frontend in force). Satisfies criterion 7.

## ADR quality

- **Context** (lines 6-44): Honest framing of the binary question (A vs B). Cites four independent signals, each verifiable.
- **Decision** (lines 46-57): Unambiguous. Names the three non-speculative triggers that would flip the decision (runtime plugin loading, hot-swap, isomorphic services). Dated.
- **Consequences** (lines 59-107): Both Positive and Negative sections; Negative explicitly names what we give up (runtime plugin loading; framework drift requires ADR-0002; ADR is canonical record; periodic audits needed; dep audit). This is the right shape for an ADR.
- **Alternatives** (lines 109-133): Option A is described concretely (what the refactor would look like) before being rejected. Four rejection bullets — three concrete, one soft (suggestion #2 above).
- **References** (lines 135-143): Cites #158, the framework's `apps/demo-back`, and #157 (route split). Per spec criterion 4 and template.

The ADR matches the framework's own server-side reference pattern (`apps/demo-back/src/server.ts`, 319 lines, plain Express + filesystem-server-impl + ui-remote-git-fs-backend, no microkernel-impl) — verified independently.

## Framework verification

| Citation | Verified | Notes |
|---|---|---|
| `apps/demo-back/src/server.ts` 319 lines, plain Express, no `microkernel-impl` import | yes | `wc -l` = 319 confirmed |
| `@hamak/microkernel-impl` v0.5.5 installed in frontend | yes | `frontend/node_modules/@hamak/microkernel-impl/package.json` → `"version": "0.5.5"` |
| `backend/src/routes/index.ts` has 115 `router.<verb>` entries | yes | `grep -cE "^\s*router\.(get|post|put|delete|patch|options|head)\b"` returns 115 |
| `@hamak/filesystem-server-impl` deps include 3 removed packages | yes | `backend/node_modules/@hamak/filesystem-server-impl/package.json` lines 39-46 |
| Only `filesystem-server-impl` and `ui-remote-git-fs-backend` imported in `backend/src/` | yes | `grep -rh "@hamak/" backend/src/ | grep -oE "@hamak/[a-z-]+" | sort -u` returns exactly those two |

## Out-of-scope additions

None. The diff touches exactly the files the spec listed: `docs/adr/0001-backend-architecture.md` (new), `CLAUDE.md` (3-line insert at Backend layers), `~/.claude/.../memory/project_migration.md` (annotation), `backend/package.json` (3 deps removed), `backend/package-lock.json` (re-synced by `npm install`). No other source files touched. No "while I was here" refactors. The `oracledb` / peer-dep re-sync in the lock is npm doing its job, not an authored change.

## Style/cookbook violations

None. Docs-only ticket. ADR uses standard heading conventions; CLAUDE.md edit preserves surrounding tone.

## Calibration finding compliance

Criterion 5 uses literal `grep -Fc "Backend is a plain Express app; the framework provides only the FS and git route mounts."` with required count `1` — no alternations, no character classes, no manual escape clauses. Complies with the narrow-regex calibration from `4a72ec1`. Other criteria (2 / 3) use regexes, but they are positive content assertions (decision summary, status line format), not negative guards, which is the right place for regexes.

## Summary

Approve. Docs are sound, dep removal is safe and verified transitive, all 8 acceptance criteria pass mechanically, baseline-broken claim is verified, no scope creep, history preserved in memory file. The three suggestions are improvements not blockers.
