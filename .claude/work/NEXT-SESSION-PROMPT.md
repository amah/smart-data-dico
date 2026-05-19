# Next-session prompt — smart-data-dico after #178 wrap

Paste this into a fresh Claude Code session in `smart-data-dico/` to
resume.

---

```
You're picking up after the #178 in-app-AI-agent-uses-MCP-servers
stream landed end-to-end. Slices 1, 2, 3, plus two follow-ups
(closeAll wiring + per-connection tool list) are all on origin/main.
No #178 work remains.

Read in order before doing anything else:

  1. CLAUDE.md
  2. ~/.claude/projects/-Users-amah-Devs-projects-smart-data-dico/memory/MEMORY.md
     — `feedback_slice_triage.md`: skip spec-writer when ticket
       is detailed enough; skip test-author when tests are a direct
       read of the spec. Used inline for every #178 slice — none of
       them spawned a spec or test agent.
  3. frontend/docs/patterns.md (cookbook — §3.5 STILL has a STALE
     reference to METADATA_TYPE_REGISTRY_TOKEN, deleted in #165c.
     The user fills the cookbook — surface the gap, do not author.
     STORE_EXTENSIONS_TOKEN from @hamak/ui-store-api is the in-repo
     analog already cited as "precedent" in §3.5; swapping headline
     ↔ precedent is the cleanest fix when the user is ready.)
  4. `git log origin/main..HEAD --oneline` — should be empty.
  5. `git log --oneline -5` — most recent is 79a1045.

STATE AT HANDOFF
================
origin/main is at `79a1045`. Working tree is clean apart from:
  - `.claude/work/NEXT-SESSION-PROMPT.md` (this file — always modified)
  - `.claude/work/<slice>/` audit dirs (untracked; not deliverables)
  - `samples/eshop/order-service/relationships.model.yaml` (modified)
  - `samples/eshop/{product,user}-service/relationships.model.yaml`
    (untracked)

The three sample-yaml files were produced by the AI chat panel during
a manual playwright session two contexts ago — genuine working
artefacts of the cross-package-relationships feature. User had not
decided whether to keep as exemplars or revert as of session close.
**Ask before touching.**

COMMITS SHIPPED LAST SESSION (2026-05-19)
==========================================
  79a1045  chore(ai): wire mcpClientRegistry.closeAll on shutdown + per-connection tool list (#178 follow-ups)
  13c0393  feat(ai): MCP connection Settings UI + masked-edit guard (#178 slice 2)
  e26d57c  feat(ai): tool-call source attribution for MCP tools (#178 slice 3)

Slice 1 (796df2d) was already on main when the session started.

BASELINES AFTER LAST SESSION
============================
  - Backend tests: 667 passing / 3 baseline failing / 670 total
    (+8 from new mcp.routes.test.ts; baseline failures unchanged)
  - Backend TS errors: 14 (unchanged baseline)
  - Backend lint: 66 errors / 316 warnings (unchanged baseline)
  - Frontend McpServersSection: 10 vitest cases — all pass
  - Frontend AIChatPanel.toolSource: 2 vitest cases — all pass
  - Frontend ai-assistance plugin: 124 vitest pass
  - Frontend pages suite: 1 worker OOM drops LogicalDiffPage
    (5 tests) under parallel run — passes 5/5 in isolation. Known
    hazard #4 — DO NOT chase as a regression.

WHAT'S DONE — #178 OVERVIEW
=============================
The in-app AI agent can now consume external MCP servers as tool
sources. Adding a new tool source is a configuration change, not a
code change.

  Slice 1 (already on main) — backend registry + tool merge
    - `backend/src/services/mcpClientRegistry.ts` (singleton):
      stdio + http transports, lazy live-client cache, ${ENV_VAR}
      interpolation, 10s default per-call timeout
    - Tool names namespaced `<connectionId>.<toolName>` (dot)
    - Three CRUD routes + one /test route under /api/ai/mcp/...
    - Built-in tools still live in aiController.ts; merged with
      MCP tools only at chat-request build time

  Slice 2 — Settings UI + masked-edit guard
    - `frontend/src/components/McpServersSection.tsx` (uses ui/
      primitives + design tokens, NOT DaisyUI — per memory
      `feedback_design_system`)
    - `frontend/src/plugins/ai-assistance/services/McpService.ts`
      thin axios wrapper
    - Backend masks env/header values with `••••••••` on GET; POST
      treats the mask sentinel as "keep stored value"; `${VAR}`
      env-refs pass through unmasked (they're pointers, not secrets)
    - 8 supertest cases for the mask + masked-edit guard contract

  Slice 3 — chat-card source attribution
    - `/api/ai/tools` enriches MCP entries with `connectionLabel`
    - AIChatPanel renders `from <label>` pill on tool-call cards
      whose name is MCP-namespaced; same pill in the Tools catalog
    - `toolDefs` fetch moved from lazy (on-Tools-view-open) to
      eager-on-mount so the chat card has the lookup ready when a
      `tool-input-start` event arrives

  Follow-ups (79a1045)
    - SIGINT/SIGTERM handlers in server.ts drain HTTP, then call
      `mcpClientRegistry.closeAll()` so stdio MCP child processes
      don't outlive the parent
    - McpServersSection rows gained a "Show tools" / "Hide tools"
      toggle; lazy fetch via /api/ai/tools, cached on collapse

REMAINING WORK (none in this stream — these are independent)
=============================================================

**`patterns.md` §3.5 cookbook gap** — still cites the deleted
METADATA_TYPE_REGISTRY_TOKEN. Mechanical fix: swap the §3.5
headline with the STORE_EXTENSIONS_TOKEN "precedent" cited below
it. User-owned doc fix — surface only, don't author.

**Sample yaml files** — three untouched files in `samples/eshop/`:
order-service/relationships.model.yaml (modified), product-service
& user-service relationships.model.yaml (untracked). Created by an
AI playwright session. Decide: keep as sample exemplars (commit) or
revert.

**Enricher `shouldEnrich` bug** — one of yamlEnricher
(server.ts:128-129) or gitEnricher (server.ts:145-146) doesn't
expose `shouldEnrich(context)`. 500s on any /fs/* HTTP file-list/
read. Not blocking — no current UI consumer hits Store FS over
HTTP (dashboards go through /api/* REST). Worth a separate hygiene
ticket.

**Latent hygiene (carry-forward, none block):**
  - `fileOperations.commitChanges()` passes an object where
    `gitService.commit()` expects a string (toString'd silently).
  - `InMemoryStorageBackend.stat('')` workaround `rootDirs.add('')`
    in every projection-fixture test.
  - `@hamak/filesystem-server-impl` WorkspaceManager.resolvePath
    dead-code branch.

**Upstream framework (not blocking):**
  - `amah/app-framework#10` — `@hamak/notification` Symbol.for vs
    Symbol() mismatch silently no-ops store-extension registration.
  - `amah/app-framework#12` — `RemoteFsAutosaveProvider.supports()`
    throws on every invocation.

KNOWN HAZARDS (calibration findings, still in force)
======================================================
1. **Worktree base drift.** Dev agents spawned with
   `isolation: "worktree"` can land off a stale base. The
   `git diff main..worktree-branch` shows BOTH the dev's additions
   AND apparent "deletions" of intervening commits.
   **DO NOT `git merge`** — use `git cherry-pick <commit>` and
   re-run build + tests on main after.

2. **Dev agents write to worktree OR main inconsistently.** Plan
   for both; check both before assuming.

3. **Concurrent npm install in same dir corrupts node_modules** —
   ENOTEMPTY on .eslint-* or .caniuse-lite-*. Fix:
   `rm -rf node_modules/.*-* node_modules/._*` then re-install.

4. **Vitest full-suite OOM** fixed in 2a89319 by `pool: 'forks'`.
   One worker can still OOM and silently drop ~1 file. Last
   session: pages-suite parallel run dropped LogicalDiffPage
   (5 tests). Re-run subsets when investigating.

5. **Bash tool defaults to Node 14.** Real node is 22 via nvm. Run
   `export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh" && nvm use
   --delete-prefix v22.12.0 --silent && node --version` to switch.

6. **`@typescript-eslint/no-floating-promises` is OFF on backend**.
   Frontend toolchain may differ — check before assuming.

7. **Frontend lint config is broken** — no eslintrc in `frontend/`.
   `npm run lint` from frontend errors. Baseline; not a target.

8. **Build error baseline is 14 pre-existing TS errors** in:
   - src/adapters/EntityFileAdapter.ts (3)
   - src/controllers/__tests__/aiController.envBypass.test.ts (4)
   - src/models/__tests__/Dictionary.test.ts (5)
   - src/utils/__tests__/appDir.test.ts (2)
   Any new count is a regression.

9. **Dev's build/test claims sometimes wrong.** Validate on main
   independently — require exact paste of `npm run build`,
   `npm test`, `npm run lint` tail output before trusting.

10. **Sub-agent token-budget is real.** Reserve sub-agents for
    novel work; mechanical migrations may run cleaner inline.

11. **Auto-mode classifier blocks `git push origin main`** even
    when user said "push" — requires explicit "push to main"
    authorization per push, even after a prior push in the same
    session. Surface and re-ask if blocked.

12. **MCP `node_modules` already includes
    `@modelcontextprotocol/sdk` at ^1.29.0** and `@ai-sdk/provider`
    — both used by the slice 1/2 code, no `npm install` needed.

WORKFLOW IN FORCE
==================
Per memory `feedback_slice_triage.md`:

  TRIAGE AT SLICE START
  ─────────────────────
  ┌─ Is there a NEW public API, design call, error semantic, or
  │  novel constraint to resolve?
  │      YES → spawn spec-writer (opus, isolation:worktree)
  │      NO  → orchestrator briefs dev directly, OR writes inline
  │
  ├─ Do tests require judgment (failing-entity construction,
  │  fixture extension, ordering reasoning, supertest setup)?
  │      YES → spawn test-author (sonnet)
  │      NO  → orchestrator writes tests inline
  │
  └─ When in doubt: SKIP the agent. Going the other way is harder
     to undo.

Every #178 slice last session went inline — no agents spawned. The
ticket was specific enough, and "follow the apiKey precedent" was a
clear enough handle for slice 2's form work.

WORKING RULES (carry across sessions)
=====================================
- Read first, act second. Verify every spec claim about existing
  code with file:line.
- Never push or merge without explicit user say-so each time — the
  classifier enforces this on main pushes regardless of prior
  authorization.
- Never commit .claude/work/ artifacts blindly — audit, not
  deliverables. NEXT-SESSION-PROMPT.md is the ONE exception, and
  only when the session asks for it.
- Pause and surface at clean stage boundaries: spec ready (if any),
  dev complete, tests green, merge done.
- isolation:"worktree" for parallel agent batches; optional
  otherwise. When using it, be PREPARED for base drift —
  cherry-pick over merge.
- After every dev pass, RE-RUN `npm run build` AND `npm test` on
  main BEFORE commit. Don't trust dev's pasted output blindly.
- Commit messages: detailed body so the next session understands
  intent without re-reading the spec.
- New UI code MUST use ui/ primitives + tokens, not DaisyUI/hex
  (memory `feedback_design_system`). Existing DaisyUI code is
  baseline — don't migrate proactively.

BEGIN
=====
1. `git fetch && git log --oneline -3` to confirm origin/main state
   (should show 79a1045 as the most recent).
2. `git log origin/main..HEAD --oneline` to check for unpushed local
   commits (should be empty — prior session pushed everything).
3. Ask the user what's next. There is no in-flight stream — pick
   the surfacing the cookbook §3.5 fix, the sample-yaml decision,
   the enricher 500 bug, or the latent hygiene items, or wait for
   a new ticket. Don't autopilot into a session of mechanical drift.
```
