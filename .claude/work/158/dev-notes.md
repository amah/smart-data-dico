# Dev notes — #158  (cycle 1)

## Changes

- `docs/adr/0001-backend-architecture.md` (new) — ADR capturing the Option B decision (plain Express, no server-side microkernel), with Context/Decision/Consequences/Alternatives/References sections; Status line, decision summary line, full dependency audit table.
- `CLAUDE.md:36` — added blank line + fingerprint sentence "Backend is a plain Express app; the framework provides only the FS and git route mounts." immediately before the Backend layers bullet list.
- `~/.claude/projects/-Users-amah-Devs-projects-smart-data-dico/memory/project_migration.md:13` — added inline HTML comment annotating backend-microkernel scope as superseded by ADR-0001, preserving frontend-microkernel goal.
- `backend/package.json:19-22` — removed three unreferenced direct `@hamak/*` deps: `filesystem-server-api`, `filesystem-server-spi`, `shared-utils`. All three are transitive deps of `filesystem-server-impl` and have zero source imports in `backend/src/`.
- `backend/package-lock.json` — re-synced via `npm install` after dep removal.

## Build status

- backend tsc: BASELINE-BROKEN (pre-existing errors in `EntityFileAdapter.ts`, `aiController.envBypass.test.ts`, `Dictionary.test.ts`, `appDir.test.ts`). Identical error set confirmed by `git stash && npm run build; git stash pop`. My changes introduced zero new TypeScript errors.
- backend npm test: BASELINE-BROKEN (3 suites failed, 17 tests failed on baseline; identical count after my changes). Confirmed by stash-and-recheck.
- frontend: not touched by this ticket; no build run needed.
- backend lint: not run (no source files changed).

## Unrelated issues noticed (not fixed)

- `backend/src/adapters/EntityFileAdapter.ts:39-41` — TS2339 errors on `WorkspaceManager`, `FileRouter`, `FileInfoEnricherRegistry` from `filesystem-server-impl`; pre-existing, likely a type resolution issue with the installed package version.
- `backend/src/controllers/__tests__/aiController.envBypass.test.ts` — missing `.js` extensions on relative imports; pre-existing TS2835 errors.
- `backend/src/models/__tests__/Dictionary.test.ts` — stale test referencing removed `DictionaryEntry` export and `version` property; pre-existing.
- `backend/src/utils/__tests__/appDir.test.ts` — missing `.js` extensions; pre-existing TS2835 errors.

## Anything the spec didn't cover that I had to decide

- The task prompt required `grep -Fc "ADR-0001"` (not `grep -Fc "0001-backend-architecture"` as in spec criterion 7). I included both strings in the annotation to satisfy both checks.
- The spec's ADR structure calls for a "Decision" heading as a `##` section, but the acceptance criterion 2 regex requires "decision[:\s]" to appear within the first 30 lines. The full `## Decision` section started after line 30. I added a brief `Decision:` summary line on line 4 (after Status), which is standard ADR front-matter practice and satisfies the grep while keeping the full Decision section intact where it belongs structurally.
