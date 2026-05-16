# Next-session prompt — continue the architectural refactor

Paste this into a fresh Claude Code session in `smart-data-dico/` to resume.

---

```
You're continuing the architectural refactor pipeline tracked in issues
#154–#169. Read in order:

  1. CLAUDE.md
  2. ~/.claude/projects/-Users-amah-Devs-projects-smart-data-dico/memory/MEMORY.md
     (especially project_arch_refactor_status.md — it has full state)
  3. frontend/docs/patterns.md (cookbook — §2 and §3 are filled, §1/§4/§5 TODO)
  4. .claude/work/INITIAL-PROMPT.md (the original pipeline prompt — still in force)

STATUS HANDOFF
--------------
4 PRs done so far. 3 merged to main, 1 open:
  - #171 merged: #156 notification collapse (commit 7f0a145)
  - #172 merged: #166-stereotype-slice (commit e76374e)
  - #173 merged: #155-integrity (commit 5a48c44)
  - #174 OPEN: arch/155-batch-pattern-b (Diff + ImportExport + Search)

The user merges PRs manually — don't `gh pr merge` without explicit say-so.

The six agents in .claude/agents/ are calibrated and committed to main
(29a8dbf). Three NEW calibration findings from the #174 batch are
documented in the project_arch_refactor_status memory but NOT YET folded
into the agent .md files — apply them when you spawn the next batch:

  1. Parallel agents MUST be spawned with `isolation: "worktree"`. Three
     parallel devs in the #174 batch shared one worktree and intermingled
     changes across branches; recovered by consolidating. Don't repeat.
  2. Test-author rule "verified/unverified" needs stricter enforcement.
     A test-author recommendation in #174 was unverified-but-unlabeled
     and burned cycles.
  3. spec-grep-guards regexes: `/getState\(\)/` alone is too broad and
     catches benign reads; use `/toEqual.*state|Object\.keys\([^)]*state/`.

PR #174 known limitation: SchemaImportWizard.test.tsx is fully .skip'd
(12 cases) pending a perf-focused follow-up. The OOM is NOT caused by
Redux DevTools (verified during the batch). Suspect MSW request snapshot
retention or RTL DOM retention. TODO(#155-import-export-followup) anchored
in the test file.

UPSTREAM ISSUES OPEN ON amah/app-framework
------------------------------------------
  - #10 hidden Redux coupling in notification (open)
  - #12 RemoteFsAutosaveProvider.supports() throws (open) — blocks any
    future Pattern A using setFileContent (entity, package, diagram,
    prompt migrations all need it). Watch for upstream republish.

REMAINING TICKETS (~14)
-----------------------
Quick wins (smallest blast radius, do first):
  - #158: backend microkernel direction (docs only)
  - #159: make plugin dependsOn load-bearing
  - #163: actually use the action/command/event framework (builds on #156)

Medium:
  - #154: re-home Redux slices into owning plugins (coordinates with #160/#161/#162)
  - #160: replace hand-rolled version-control plugin with @hamak/ui-remote-git-fs
  - #161: fold cases and rules into data-dictionary core
  - #162: extract ai-assistance plugin
  - #157: split backend routes/index.ts by feature domain
  - #164: turn metadata value types into a plugin extension point
  - #165: unify Stereotype with Entity (depends on #164)

Larger (backend; blocking other work):
  - #167: route backend domain reads/writes through @hamak/filesystem-server-impl
    (BLOCKS Pattern A entity migration in #166 and the remaining #155 catalog)
  - #168: pluggable storage-backend contract
  - #169: per-user git worktree as logical workspace

Rest of #155 catalog (blocked on backend):
  - Pattern A: DictionaryService, CaseService, RuleService (need #167)
  - Mixed: VisualizationService, AIService (need #162 + #167)

WORKING RULES (still in force)
------------------------------
- Read first, act second. Calibrated agents read .js runtime + .d.ts.
- Never invent framework APIs. Cite paths.
- Outward-facing actions (gh pr create, gh issue create cross-repo,
  gh pr merge) need explicit user confirmation each time.
- Pause-and-summarize at stage boundaries: spec approved, dev complete,
  tests green, code review approved, PR opened.
- 3-cycle cap per agent per spec version; reset on new spec.
- Use `isolation: "worktree"` for parallel agent batches.
- Model selection per agent role:
    spec-writer:        opus    (reasoning, framework verification)
    spec-reviewer:      opus    (critical analysis)
    developer:          sonnet  (mechanical implementation)
    test-author:        sonnet  (mechanical, follows precedent)
    code-reviewer:      opus    (judgment)
    rework-coordinator: haiku   (deterministic routing)
- Never commit .claude/work/ without say-so. .claude/agents/ IS now committed.

BEGIN
-----
1. Run `git fetch && git log origin/main --oneline -8` to see what's merged.
2. Run `gh pr list --state open` to see open PRs (#174 likely still open
   unless user merged it).
3. If #174 is merged: rebase any local branches; reset state.
4. Surface a one-paragraph status to the user.
5. Ask which ticket(s) to pilot next. Default recommendation: start with
   #158 (docs, near-zero risk) or #163 (action/command framework — builds
   on #156's foundation, foundational for many later tickets).
6. If multiple tickets in parallel: USE isolation: "worktree".
7. If applying calibration findings #1/#2/#3 to .claude/agents/ first
   (recommended), do that as a separate small commit before the next pilot.
```

---

## Notes on this prompt

- Captures the merged-PR state via commit hashes so the new session
  doesn't need to chase git history.
- Lists every NOT-YET-FOLDED calibration finding so the next batch's
  agents get them.
- Pins upstream issue status (especially #12 which blocks Pattern A
  expansion).
- Default recommendation is the lowest-risk next move — but the user
  can override.
- Sets explicit model-per-agent so the next session doesn't have to
  re-derive it.
- Tells the next session to start with a git fetch + PR list — defensive
  against state drift between sessions.

## What's intentionally left out

- Per-ticket spec details (each agent reads the ticket itself per its
  agent prompt).
- The full pipeline history (`.claude/work/<N>/attempts.log` files have it).
- The full cookbook content (loaded from disk per the new session).
- The exact merge order for any future PR chain (depends on what lands
  between sessions).
