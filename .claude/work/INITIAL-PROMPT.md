# Initial prompt — kick off the architectural refactor

Paste this into a fresh Claude Code session in `smart-data-dico/` to begin the work.

The prompt is structured in three parts:
1. **Context** — what's in flight and what's been prepared
2. **First objective** — concrete first ticket
3. **Working rules** — guardrails the orchestrator follows

---

```
You're driving the architectural refactor tracked in issues #154–#169. The
plan is fully captured: each ticket has a body and comments that together
form the spec input. Read CLAUDE.md first, then ~/.claude/projects/-Users-amah-Devs-projects-smart-data-dico/memory/MEMORY.md, then frontend/docs/patterns.md.

CONTEXT PREPARED
----------------
- Baseline tagged locally: arch/baseline-2026-05-13. Compare against this
  tag at any point with `git diff arch/baseline-2026-05-13...HEAD`.
- Six custom agents defined in .claude/agents/:
    spec-writer, spec-reviewer, developer, test-author, code-reviewer,
    rework-coordinator
  Read each agent's frontmatter and prompt before invoking it.
- Cookbook outline at frontend/docs/patterns.md. Five worked examples are
  TODO and must be filled in by a human (you, with my review). Do NOT
  delegate the cookbook examples to agents — they will invent patterns.
- Per-ticket workspace under .claude/work/<ticket>/. Initialize as needed.

FIRST OBJECTIVE — PILOT THE PIPELINE ON ISSUE #156
--------------------------------------------------
Issue #156 is "collapse dual notification systems onto @hamak/notification."
It is the smallest contained ticket, has no path semantics, and exercises
the full spec → review → dev → tests → review → PR flow without engaging
the highest-risk areas. Use it to validate the agent pipeline.

Sequence:
  1. Read issue #156 in full including all comments:
       gh issue view 156 --comments
  2. Spawn the spec-writer agent for #156. Pass the ticket number; it
     produces .claude/work/156/spec.md.
  3. Spawn the spec-reviewer agent. It reads the spec, ticket, and code,
     verifies framework citations against node_modules/@hamak, and emits
     spec-review.md with verdict approve / rework / escalate.
  4. If rework: cycle back to spec-writer with the review attached. Max
     3 cycles before escalating to me.
  5. On approve: spawn the developer agent. It implements per spec, no
     tests, no commits.
  6. Spawn the test-author agent. It writes tests per acceptance criteria,
     runs them, reports failures.
  7. Failures: route per rework-coordinator's rules.
  8. On clean: spawn the code-reviewer agent. It reviews the diff against
     spec + cookbook + framework + CLAUDE.md.
  9. On approve from code-reviewer: open a PR with `gh pr create`. Don't
     merge — that's my call.

After #156 ships, we calibrate the agent prompts based on what you saw,
fill in cookbook examples that the work surfaced, then move to #154 and
#166's stereotype-slice proof.

WORKING RULES
-------------
- Read first, act second. Every agent invocation must have read its
  inputs (ticket, comments, spec, code, framework .d.ts files) before
  producing output.
- Never invent framework APIs. If a @hamak/* import doesn't exist with
  the signature an agent assumed, escalate to spec-writer for revision.
- Never push or merge without my explicit say-so. Tags, branches, PRs
  are fine to create locally; remote-state-changing operations need
  confirmation.
- Never commit the .claude/ directory or frontend/docs/patterns.md
  without my explicit say-so. These are pre-work artifacts; I want to
  decide when they land in main.
- Respect the 3-cycle cap. The rework-coordinator enforces it; you
  don't override it.
- When the cookbook lacks a pattern for what's needed, surface it as
  a question, don't invent. I fill in the cookbook from real code.
- For each ticket: at start, create .claude/work/<N>/attempts.log if
  missing. Every agent invocation appends one line.
- Stop and summarize at clean stage boundaries: spec approved, dev
  complete, tests green, code review approved, PR opened. Give me a
  one-paragraph status before moving to the next stage.

BEGIN
-----
Start with step 1 of the FIRST OBJECTIVE: read issue #156 in full,
then report back what you found and propose the spec-writer prompt
parameters before spawning the agent. Don't spawn the first agent
until I confirm.
```

---

## Notes on the prompt

- **It deliberately starts with read-and-report**, not "go run the pipeline." The first agent invocation is the highest-risk moment to get wrong; pausing for confirmation prevents wasted cycles.
- **It pins #156 as the pilot**, not #154 or #166. #156 has the smallest blast radius — if the pipeline fails on #156, you've lost a day. If it fails on #166, you've lost a week.
- **It says "open a PR; don't merge."** Merge is a human decision, especially for the first ticket through the pipeline.
- **It blocks committing `.claude/` and the cookbook.** Those need a deliberate decision about whether to commit them to main (publishing the agent setup to the team) or keep them local.

## Next actions for you

1. **Optional — push the tag.** I created it locally only. If you want it shared:
   ```bash
   git push origin arch/baseline-2026-05-13
   ```
2. **Optional — commit the agent setup.** The agents and cookbook are uncommitted. If you want them in:
   ```bash
   git add .claude/agents/ frontend/docs/patterns.md .claude/work/INITIAL-PROMPT.md
   git commit -m "arch: add agent definitions and cookbook outline for refactor pipeline"
   ```
   Or keep them local while you experiment.
3. **Run the pilot.** Open a fresh Claude Code session in this repo, paste the prompt from `.claude/work/INITIAL-PROMPT.md`.
