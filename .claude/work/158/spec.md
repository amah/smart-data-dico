# Spec — #158: arch: decide and document backend microkernel direction

## Goal

Produce a binary, justified, durable decision on whether the smart-data-dico backend should adopt `@hamak/microkernel-impl` (Option A) or remain plain Express around `@hamak/filesystem-server-impl` + `@hamak/ui-remote-git-fs-backend` (Option B). The ticket explicitly defines itself as "decision + documentation, not implementation"; the deliverable is an ADR plus aligned edits to `CLAUDE.md` and `memory/project_migration.md`. From the ticket: *"Right now the backend is neither — it doesn't follow the framework microkernel pattern, but it also isn't documented as intentionally plain Express. This silent asymmetry leaks into every contributor's mental model."*

`gh issue view 158` confirms zero comments on the ticket as of 2026-05-15; the body is the complete brief.

**Recommendation: Option B (stay plain Express)** — see "Recommendation" subsection below.

## Recommendation (with evidence)

Pick **Option B**. The investigation surfaces four independent signals that all point the same way:

1. **The framework's own reference backend uses Option B.** `apps/demo-back/src/server.ts` in `amah/app-framework` (path: `/Users/amah/Devs/projects/app-framework/apps/demo-back/src/server.ts`, 319 lines) is plain Express wiring `WorkspaceManager`, `FileRouter`, `FileInfoEnricherRegistry` from `@hamak/filesystem-server-impl`, plus `createGitService`/`createGitRoutes` from `@hamak/ui-remote-git-fs-backend`, plus the recently-added `@hamak/event-channel-backend`. It does **not** import `@hamak/microkernel-impl`. The framework authors treat the microkernel as a frontend pattern.
2. **`apps/demo-back/package.json` confirms this:** its `@hamak/*` deps are `filesystem-server-{api,impl,spi}`, `ui-remote-git-fs-backend`, `event-channel-backend`, `shared-utils`. No `microkernel-{api,spi,impl}`. (Path: `/Users/amah/Devs/projects/app-framework/apps/demo-back/package.json`.)
3. **`@hamak/microkernel-impl` is Node-compatible, but that's necessary not sufficient.** It is pure ESM (`"type": "module"`), `sideEffects: false`, with no DOM globals in `src/runtime/{di,host,loader,registries}.ts` or `src/ui/adapter.ts`. Node *could* host it. But Node-compatibility is not a reason to adopt it; the question is payoff.
4. **The concrete refactor cost is high for low payoff.** Today's backend has 14 controllers, 27 services, and **115** `router.<verb>(...)` entries (per `grep -cE "^\s*router\.(get|post|put|delete|patch|options|head)\b" backend/src/routes/index.ts`) in a single 373-line `routes/index.ts`. Option A means: introduce a server-side `Host`, define DI tokens for every service, wrap each controller group as a plugin contributing routes, port the existing Jest+Supertest suite onto the new bootstrap. The framework's own hooks (command bus, lifecycle, DI overrides) buy us nothing concrete the current Express + Jest setup doesn't already buy: services are already imported by tests directly; controllers are already thin; route splitting is a separate ticket (#157) that delivers most of the modularity benefit without DI ceremony.

Option A becomes correct **if and only if** one of these emerges as a real (not speculative) requirement: runtime plugin loading (drop-in `.so`-style features), hot-swap of services in a running process, or sharing a DI graph between frontend and backend (e.g., isomorphic services). None is on the roadmap.

The ticket's non-binding recommendation also leans B; this spec independently arrives at B from the framework-reference signal alone.

## Files touched

- `docs/adr/0001-backend-architecture.md` — **new**. The ADR capturing decision, context (ticket #158), and consequences. (`docs/adr/` does not yet exist; the file's parent directory must be created.)
- `CLAUDE.md` — small edit to the "Backend layers" paragraph and the framework dependency note, replacing the implicit "framework-everywhere" reading with an explicit "plain Express; framework is used only for FS (`/fs`) and git (`/api/git`) routes."
- `~/.claude/projects/-Users-amah-Devs-projects-smart-data-dico/memory/project_migration.md` — annotate (do not rewrite) line 9 (*"Better modularity, plugin system, DI, standardized APIs, and testability"*) to mark the backend-microkernel scope as **superseded by ADR-0001 (Option B)**, while preserving the frontend-microkernel goal which remains in force.

No code files. No follow-up implementation tickets to file (Option B closes this work). #157 (split routes/index.ts) is independent and continues on its own track.

## Public surface (signatures)

Not applicable. This is a docs-only ticket. No exported TypeScript surface changes.

The ADR file must contain, at minimum, these top-level sections (Markdown headings):

```text
# ADR-0001: Backend architecture — plain Express, no server-side microkernel
Status: Accepted (YYYY-MM-DD)
Context
Decision
Consequences
  Positive
  Negative / Trade-offs
Alternatives considered
  Option A — Server-side @hamak/microkernel-impl
References
  - #158 (this ticket)
  - app-framework/apps/demo-back (reference backend)
  - #157 (route split — independent)
```

The ADR's "Backend layers" paragraph edit in `CLAUDE.md` must contain the exact literal sentence fingerprint used by acceptance criterion 5 (see below):

> *Backend is a plain Express app; the framework provides only the FS and git route mounts.*

This sentence must appear verbatim (no rephrasing) so a literal-string grep can confirm it.

## Framework APIs used

Decision-level verification only — no APIs are *called*.

- `@hamak/microkernel-impl` — **installed v0.5.5** (`/Users/amah/Devs/projects/smart-data-dico/frontend/node_modules/@hamak/microkernel-impl/package.json`, satisfying the `^0.5.2` range in `frontend/package.json`). The framework workspace at `/Users/amah/Devs/projects/app-framework/packages/microkernel/microkernel-impl/package.json` has tagged 0.5.6, which is not yet released into this repo. Both confirm `"type": "module"`, `sideEffects: false`, pure-ESM with a `legacy` ES2015 export. Entry point `src/index.ts` re-exports from `runtime/{di,registries,loader,host}` and `ui/adapter`. None of those modules references `document` / `window` / `navigator` / `React` (verified by grep). **Conclusion: Node-compatible; suitability is not a technical blocker, but adoption is still rejected on cost/benefit grounds (see Recommendation §4).**
- `@hamak/filesystem-server-impl` — unchanged role under Option B; backend continues to mount via the existing `EntityFileAdapter`/`YamlFileInfoEnricher` shim and `app.use('/fs', fsRouter)` at `backend/src/server.ts:107-108`.
- `@hamak/ui-remote-git-fs-backend` — unchanged role under Option B; backend continues to mount `createGitService` / `createGitRoutes` at `backend/src/server.ts:90-99`.
- **Reference**: `apps/demo-back/src/server.ts` (`/Users/amah/Devs/projects/app-framework/apps/demo-back/src/server.ts`, 319 lines) is the canonical "plain Express + framework routes" pattern this backend already matches.

## Acceptance criteria

All are testable on a clean checkout after this ticket merges.

1. **ADR exists at the expected path.** `test -f docs/adr/0001-backend-architecture.md` returns 0.
2. **ADR states a decision in the first 30 lines.** A grep of `head -n 30 docs/adr/0001-backend-architecture.md` matches the case-insensitive regex `/decision[:\s].*(option b|plain express|no.*microkernel)/i` (or equivalent — the point is the decision is unambiguous near the top, not buried).
3. **ADR Status line is Accepted with a date.** `grep -E '^Status:\s*Accepted\s*\([0-9]{4}-[0-9]{2}-[0-9]{2}\)' docs/adr/0001-backend-architecture.md` returns one match.
4. **ADR documents Option A as a considered alternative** with at least one paragraph explaining why it was rejected; an "Alternatives considered" section exists and references `@hamak/microkernel-impl` by name.
5. **CLAUDE.md contains the literal fingerprint sentence.** The "Backend layers" section must contain verbatim:
   > *Backend is a plain Express app; the framework provides only the FS and git route mounts.*

   Mechanical check (literal-string, narrow):
   ```
   grep -Fc "Backend is a plain Express app; the framework provides only the FS and git route mounts." CLAUDE.md
   ```
   must return exactly `1`.
6. **CLAUDE.md has no stale TODO referring to a future backend microkernel.** `grep -iE "backend.*(microkernel|host).*todo|todo.*backend.*(microkernel|host)" CLAUDE.md` returns no matches.
7. **`memory/project_migration.md` is annotated, not silently rewritten.** The file gains a short header note (or inline annotation near line 9) stating: *"Backend-microkernel scope superseded by `docs/adr/0001-backend-architecture.md` (decided 2026-05-XX, Option B). Frontend-microkernel goal remains in force."* Mechanical check: `grep -Fc "0001-backend-architecture" memory/project_migration.md` returns at least `1`.
8. **Framework dependency audit — open question, must be answered in the ADR.** The ticket says: *"If B: ticket closed; framework dependency list trimmed if anything is unused."* This audit is **not pre-decided** by this spec. The developer must:
   - (a) Identify which `@hamak/*` entries in `backend/package.json` are not imported anywhere under `backend/src/` (current baseline: `grep -rh "@hamak/" backend/src/` matches only `@hamak/filesystem-server-impl` and `@hamak/ui-remote-git-fs-backend`; the other three direct deps — `@hamak/filesystem-server-api`, `@hamak/filesystem-server-spi`, `@hamak/shared-utils` — show zero source references and are also present as transitive deps of `@hamak/filesystem-server-impl`).
   - (b) For each unreferenced direct dep, decide and record in the ADR's "Consequences" section: either justify keeping it as a direct dep (e.g., types resolution, future-proofing, peer-dep contract) or remove it from `backend/package.json` `dependencies`.
   - Mechanical check: the ADR's "Consequences" section contains the substring `dependency audit` (case-insensitive) and explicitly names each of the three currently-unreferenced direct deps with a keep/remove verdict.

## Out of scope

- Any actual backend code change toward microkernel. Under Option B there is no implementation phase; under Option A there would be one or more follow-up tickets, but the spec picks B.
- **#157 (split `routes/index.ts` by feature domain).** Per #157 itself: *"This is the single biggest backend SoC violation and is independent of any microkernel decision (see #158)."* This spec **coordinates with** #157 but does not block or assume it. The ADR should reference #157 to remind future readers that route modularity is being addressed *without* needing a microkernel.
- **Frontend microkernel posture.** The frontend continues to use `@hamak/microkernel-impl` with `Host` + plugins. ADR-0001 is explicitly about the backend only; the migration-memo edit must preserve the frontend goal.
- **Trimming `@hamak/microkernel-api` / `@hamak/microkernel-spi` from `backend/node_modules/`**. These appear in `backend/node_modules/@hamak/` only as transitive dependencies (pulled by `filesystem-server-impl`); they are not in `backend/package.json` direct deps. No action needed unless the audit (criterion 8) flags them.
- Refactoring controllers, services, or DI in any form.
- Renaming `kernel/config.ts` (which is just a config object, not a microkernel `Host`). The name pre-dates this ticket and is not in scope.

## Dependencies

- **Coordinates with #157** (split `backend/src/routes/index.ts` by feature domain). Independent — neither blocks the other. ADR-0001 should cite #157 in its "References" section to document that route modularity is being achieved without a server-side microkernel.
- **No upstream blockers.** This ticket only depends on the framework repo being readable (confirmed at `/Users/amah/Devs/projects/app-framework`) and on the `@hamak/microkernel-impl` package being inspectable (confirmed at `/Users/amah/Devs/projects/app-framework/packages/microkernel/microkernel-impl/` and at `/Users/amah/Devs/projects/smart-data-dico/frontend/node_modules/@hamak/microkernel-impl/`).
- **No downstream tickets to file** (Option B). If a future signal flips the decision to A, a new ADR (ADR-0002) supersedes this one and only then are implementation tickets filed.

## Risks

1. **The framework gains a server-side microkernel pattern after we ship ADR-0001.** If `apps/demo-back` later adds `@hamak/microkernel-impl`, our ADR will look out of date. The framework is already actively evolving its server-side surface — `apps/demo-back/src/server.ts` lines 11 and 67-73 already wire `@hamak/event-channel-backend`, a package that did not exist in earlier snapshots. **Mitigation:** the ADR is dated and explicitly states the decision rests on the framework's *current* server-side reference pattern (FS + git + event-channel as of 2026-05); the "Consequences → Negative" section names "future framework server-side `Host`" as a revisit trigger; superseding the ADR is cheap (ADR-0002 + a follow-up ticket).
2. **A future feature genuinely needs a runtime plugin system on the backend** (e.g., user-supplied dictionary kinds, third-party integrity rules loaded at runtime). **Mitigation:** the ADR's "Consequences → Negative" section names this risk explicitly; revisit ADR before designing such a feature. No mitigation cheaper than re-deciding.
3. **The audit (criterion 8) trims a direct dep that turns out to be needed for TypeScript type resolution** (e.g., `@types`-style usage where the package's `.d.ts` is referenced via a type-only path). **Mitigation:** before any trim, run `npm run build` and `npm test` in the backend; the audit must verify both pass without the removed dep. Acceptance criterion 8 requires the audit be *recorded with a verdict per dep*, not blindly executed.
4. **Memory-file edit is brittle** because `~/.claude/projects/.../memory/project_migration.md` is a *user-scoped* file, not a repo file. A different machine / user account will not see the annotation. **Mitigation:** the canonical source of truth is `docs/adr/0001-backend-architecture.md` in-repo; the memory edit is a courtesy for the local developer's auto-loaded context. The ADR + CLAUDE.md edit must stand alone without the memory annotation. The ADR's "Consequences → Negative" section should explicitly state that the in-repo ADR is the canonical record so future contributors look there first.
5. **CLAUDE.md and `memory/project_migration.md` may drift out of sync with the ADR over time.** No automated linter currently checks for ADR consistency. **Mitigation:** none cheap. Accept that ADRs are the canonical record and that CLAUDE.md will need a periodic audit; flag this as a possible future tooling ticket but do not block on it.
