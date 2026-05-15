# ADR-0001: Backend architecture — plain Express, no server-side microkernel

Status: Accepted (2026-05-15)
Decision: Option B — plain Express; no server-side microkernel adoption.

## Context

Issue #158 surfaced a silent architectural ambiguity: the smart-data-dico backend imports
`@hamak/app-framework` packages but does **not** follow the framework's microkernel pattern
(`Host` + plugins + DI). The frontend does use `@hamak/microkernel-impl` (via `Host` +
`registerPlugin` + `bootstrapAllAtRoot`), creating an asymmetry that leaked into the
codebase's mental model and documentation.

The question was binary: adopt `@hamak/microkernel-impl` on the backend (Option A), or
explicitly decide to remain plain Express (Option B) and document it.

Four independent signals were examined:

1. **The framework's own reference backend (`apps/demo-back`) does not use `@hamak/microkernel-impl`.**
   `apps/demo-back/src/server.ts` (319 lines) is plain Express wiring
   `WorkspaceManager`, `FileRouter`, `FileInfoEnricherRegistry` from
   `@hamak/filesystem-server-impl`, plus `createGitService`/`createGitRoutes` from
   `@hamak/ui-remote-git-fs-backend`, and (recently) `@hamak/event-channel-backend`.
   The framework authors treat the microkernel as a **frontend pattern**.

2. **`apps/demo-back/package.json` confirms this.** Its `@hamak/*` deps are
   `filesystem-server-{api,impl,spi}`, `ui-remote-git-fs-backend`, `event-channel-backend`,
   and `shared-utils`. No `microkernel-{api,spi,impl}`.

3. **`@hamak/microkernel-impl` is Node-compatible, but that is necessary not sufficient.**
   It is pure ESM (`"type": "module"`, `sideEffects: false`) and contains no DOM globals
   in `src/runtime/{di,host,loader,registries}.ts` or `src/ui/adapter.ts`. Node *could*
   host it. Node-compatibility is not a reason to adopt it; the question is payoff.

4. **The concrete refactor cost is high for low payoff.** The backend has 14 controllers,
   27 services, and 115 `router.<verb>(...)` entries in a single 373-line
   `backend/src/routes/index.ts`. Option A would require introducing a server-side `Host`,
   defining DI tokens for every service, wrapping each controller group as a plugin
   contributing routes, and porting the Jest + Supertest suite onto the new bootstrap.
   The framework's hooks (command bus, lifecycle, DI overrides) buy nothing concrete
   that the current Express + Jest setup does not already provide. Services are already
   imported directly by tests; controllers are already thin. Route modularity — the
   tangible SoC benefit — is being addressed by the independent ticket #157, which delivers
   that benefit without any microkernel ceremony.

## Decision

**Option B: stay plain Express.** The backend remains a plain Express application.
`@hamak/filesystem-server-impl` is used only to provide the `/fs` filesystem route mount,
and `@hamak/ui-remote-git-fs-backend` is used only to provide the `/api/git` route mount.
No server-side `Host`, plugin registration, or DI tokens are introduced.

This decision was informed directly by the framework's own reference backend pattern.
Option A becomes correct **if and only if** one of these real (non-speculative) requirements
emerges: runtime plugin loading (drop-in feature modules), hot-swap of services in a running
process, or sharing a DI graph between frontend and backend (isomorphic services). None is on
the roadmap as of 2026-05-15.

## Consequences

### Positive

- **No migration cost.** The existing 14 controllers, 27 services, and 115 routes require no
  structural change.
- **Test suite unchanged.** Jest + Supertest works today and continues unchanged.
- **Aligned with the framework's own reference implementation.** Staying plain Express
  matches `apps/demo-back`; we diverge only in features, not architecture.
- **Route modularity still achieved.** Ticket #157 (split `backend/src/routes/index.ts` by
  feature domain) addresses the biggest backend SoC concern without DI overhead.
- **Simpler mental model.** Contributors do not need to learn server-side microkernel
  concepts to work on the backend.

### Negative / Trade-offs

- **Runtime plugin loading is not possible without revisiting this decision.** If a future
  feature requires loading user-supplied dictionary kinds or third-party integrity rules at
  runtime, this ADR must be revisited before the design is finalized.
- **`@hamak/microkernel-impl` evolving to add a server-side `Host` pattern would require
  reassessment.** If `apps/demo-back` in the framework repo later adopts `microkernel-impl`,
  a new ADR (ADR-0002) should supersede this one.
- **The in-repo ADR is the canonical record.** `CLAUDE.md` and
  `memory/project_migration.md` will need periodic audits to stay aligned; no automated
  linter currently checks ADR consistency.
- **Dependency audit (see below).** Three of the five `@hamak/*` direct deps in
  `backend/package.json` are unreferenced in source. They have been removed from direct
  dependencies (see dependency audit section).

### Dependency audit

`grep -rh "@hamak/" backend/src/` confirms that `backend/src/` only imports two `@hamak`
packages:

- `@hamak/filesystem-server-impl` — imported in `EntityFileAdapter.ts` and `server.ts`
- `@hamak/ui-remote-git-fs-backend` — imported in `versionControlService.ts` and `server.ts`

The remaining three direct deps in `backend/package.json` had **zero** source references:

| Package | Source references | Keep / Remove | Rationale |
|---|---|---|---|
| `@hamak/filesystem-server-api` | 0 | **Remove from direct deps** | Already a dependency of `@hamak/filesystem-server-impl`; pulled as a transitive. No direct type-only imports in `backend/src/`. |
| `@hamak/filesystem-server-spi` | 0 | **Remove from direct deps** | Same: transitive via `@hamak/filesystem-server-impl`. Not referenced in source. |
| `@hamak/shared-utils` | 0 | **Remove from direct deps** | Same: transitive via `@hamak/filesystem-server-impl`. Not referenced in source. |

All three have been removed from `backend/package.json` `dependencies`. They continue to be
available at runtime as transitive dependencies of `@hamak/filesystem-server-impl`. The
backend build (`npm run build`) and test suite (`npm test`) were verified to pass after the
removal.

## Alternatives considered

### Option A — Server-side `@hamak/microkernel-impl`

This option would have introduced a server-side `Host` created via
`@hamak/microkernel-impl`, with each controller group refactored into a plugin that
contributes routes. Every service would receive a DI token; unit tests would resolve
dependencies via the DI container.

**Why it was rejected:**

- The framework's own reference backend (`apps/demo-back`) does not use
  `@hamak/microkernel-impl`. This is the single strongest signal; the framework authors
  have chosen the same split (microkernel on frontend only) for their own demo.
- The refactor cost is concrete and high: 14 controllers, 27 services, 115 routes all
  need restructuring. The benefit is abstract and speculative given the current feature set.
- Route modularity — the only tangible benefit we would gain soon — is already being
  delivered by #157 without needing DI ceremony.
- Version `0.5.5` of `@hamak/microkernel-impl` is installed in the frontend. Its
  `src/ui/adapter.ts` export name suggests the primary design intent is UI-side.
  While it is technically Node-compatible (no DOM globals), Node-compatibility is not
  an argument for adoption.

Option A would become the correct choice only if one of the three non-speculative
triggers listed in the Decision section materialises.

## References

- #158 (this ticket) — decision prompt and brief
- `app-framework/apps/demo-back` — reference backend at
  `/Users/amah/Devs/projects/app-framework/apps/demo-back/src/server.ts` (319 lines);
  plain Express + `@hamak/filesystem-server-impl` + `@hamak/ui-remote-git-fs-backend`;
  no `@hamak/microkernel-impl`
- #157 (route split — independent) — splits `backend/src/routes/index.ts` by feature
  domain; addresses route SoC without a server-side microkernel; independent of this ADR
