# Spec review — #160: arch: replace hand-rolled version-control plugin with @hamak/ui-remote-git-fs  (cycle 2)

## Verdict
**approve**

All six cycle-1 required changes and all three new risks (R6/R7/R8) are addressed. No regressions introduced.

## Required changes (if rework)
None.

## Suggestions (optional, won't block)
- The `dependsOn` extension is documented in prose inside the bootstrap.ts files-touched bullet (line 19) but the diff snippet at lines 294-303 of the spec still shows only the `git` plugin's dependsOn, not the updated `data-dictionary` line. Not blocking — the prose is authoritative — but a quick second diff line would make this 100% mechanical for the implementer.
- R7's "may be dead weight" framing for `PUBLISH_SERVICE_TOKEN` leaves a choice in the implementer's hands. Either keep-for-forward-compat or drop-as-YAGNI is fine; spec is clear either way.

## Delta verification

| Cycle-1 required change | Resolved | Evidence (spec.md line) |
|---|---|---|
| 1. Count unification 19→30 / 18→29 | yes | L20, L42, L58, L61, L403, L449 — all consistent; no stale 26/25 anywhere |
| 2. Revert contradiction resolved (Path A) | yes | L24, L65, L67, L390, L447 — `revertToCommit` kept, new `publish.routes.ts` added, AC #32 explicitly allows it |
| 3. HomePage JSDoc edit | yes | L28 — explicit rewrite of line-16 JSDoc with before/after text |
| 4. `grep -F \|` regex fix | yes | AC #32 (L387-390) and AC #33 (L394-397) each use three independent `grep -cF` calls; `grep -nE 'grep -cF.*\\\|'` returns 0 matches |
| 5. spec-grep-guards.commands.test.ts edits enumerated | yes | L40-61 — five concrete line-level edits; all 11 command names enumerated in declaration order (L44-55); both per-name iteration blocks (commandNames + ddCommands) extended |
| 6. AC #34 preconditions explicit | yes | L398 — preconditions (a) `describe('Version Control', ...)` deletion AND (b) mock slimming both named, with the failure modes explained |
| R6 — `data-dictionary` dependsOn includes `'git'` | yes | L19 (Files-touched bootstrap.ts edit) + L451 (Risk #6 with mitigation) |
| R7 — `PUBLISH_SERVICE_TOKEN` dead weight noted | yes | L453 (Risk #7) — kept-for-forward-compat with drop-as-YAGNI fallback documented |
| R8 — `gitApi` has 9 methods, not 8 | yes | L455 (Risk #8) — both dead methods (`createBranch`, `fetch`) named |

## Framework citation verification

All citations from cycle 1 unchanged. No new citations introduced in cycle 2.

| Cited path | Verified | Notes |
|---|---|---|
| `@hamak/ui-remote-git-fs/dist/impl/plugin/git-plugin-factory.d.ts:32` | yes | verified cycle 1 |
| `@hamak/ui-remote-git-fs/dist/impl/plugin/git-plugin-factory.js:36-151` | yes | verified cycle 1 |
| `@hamak/ui-remote-git-fs/dist/api/tokens.d.ts:5-9` / `tokens.js:5-9` | yes | verified cycle 1 |
| `@hamak/ui-remote-git-fs/dist/spi/providers/i-git-client.d.ts:10-87` | yes | verified cycle 1 |
| `@hamak/ui-remote-git-fs/dist/impl/providers/http-git-client.d.ts:35-104` | yes | verified cycle 1 |
| `Pathway.ofRoot().resolve(...)` from `@hamak/shared-utils` | yes | verified cycle 1 |

## Risk reassessment

Risks 1-8 stand as documented. The Path A revert decision (keep `versionService.revertToCommit` + new `publish.routes.ts`) is the lower-risk option versus removing the revert button mid-migration. The `dependsOn` extension neutralizes R6 at the manifest level — the microkernel honors the ordering. R7 is cosmetic only. R8 is a doc nit.

## Cross-ticket conflicts

None new. The cycle-1 cross-ticket scan stands: no overlap with #164, no conflict with #157 (merged, already consumed), consistent with #155 Pattern B, #163 typed commands, and CLAUDE.md's three-concept governance. The forward-coordinations with #167 and #168 remain correctly captured as Out of Scope with mechanical follow-ups.
