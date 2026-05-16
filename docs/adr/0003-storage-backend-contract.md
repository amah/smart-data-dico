# ADR-0003: Storage-backend contract foundation

Status: Accepted (2026-05-16)

## Context

Today, every backend service that touches the data dictionary touches the filesystem directly —
reading and writing YAML files via `fileOperations.ts`, `EntityFileAdapter.ts`, or direct `fs`
calls. The workspace is always a git repository on the local filesystem, the concurrency model
is single-user, and paths are always relative to `config.dataDir`.

Issues #167 (dictionary query service) and #168 (pluggable storage backends) identified that
this hard coupling creates two concrete problems:

1. **Alternative persistence targets are not possible.** Adding a Postgres read-model, a
   Neo4j graph backend, or an S3-backed archive would require changing every service.
2. **Testing requires real files.** No domain service can be unit-tested with an in-memory
   stub because there is no interface boundary to swap.

The `@hamak/filesystem-server-impl` `WorkspaceManager` is already the physical I/O layer for
the `/fs` route and for the two adapter functions in `EntityFileAdapter.ts`. A thin contract
layer sitting in front of it is therefore the minimal change to introduce the needed abstraction
without restructuring the existing service layer.

## Decision

Introduce a two-layer storage contract:

**Layer 1 — `IStorageBackend`** (mandatory): a filesystem-like interface (`read`, `list`,
`stat`, `write`, `delete`, `mkdir`, `subscribe`) plus workspace-lifecycle primitives
(`createWorkspace`, `forkWorkspace`, `mergeWorkspace`, `deleteWorkspace`) and a
self-description method (`capabilities()`). Every backend must implement this layer.

**Layer 2 — `IDictionaryQuery`** (optional): high-level query operations whose implementation
is backend-specific (`searchEntities`, `traverse`, `impact`, `lineage`, `resolveCase`). A
backend that does not implement native graph traversal or full-text search returns `undefined`
from `storageRegistry.getQuery()` and callers fall back to in-process logic.

**Capability flags** (`BackendCapabilities`): a flat struct of booleans and discriminated-union
strings returned by `capabilities()`. UI consumers and service callers use these flags to gate
features that require capabilities beyond the git+filesystem baseline (e.g. `branches`,
`nativeSearch`, `multiUser`). This avoids runtime duck-typing and makes it clear what a new
backend must implement before a feature can activate.

**`GitFilesystemStorageBackend`** wraps the existing `IWorkspaceManager` from
`@hamak/filesystem-server-impl`. It is the one concrete backend in this slice. The four
workspace-lifecycle methods and `subscribe` throw `BackendError('not-implemented')` because
the framework has no API for dynamic workspace creation or file-system watching as of this
slice (documented framework gaps in spec §3).

**`storageRegistry` singleton** is the access point — `storageRegistry.setBackend(b)` called
once in `server.ts` at startup; `storageRegistry.getBackend()` used by any future domain
service that needs the backend. The singleton carries a `reset()` method for test isolation.

The singleton deliberately does **not** conflict with ADR-0001 ("no server-side microkernel
DI"). ADR-0001 rejected a microkernel `Host` + plugin registration ceremony; a 30-line
module-scoped registry is not that. The distinction: a DI container is general-purpose
infrastructure that controls the object graph; this registry is a single-purpose switch for
one interface. If `storageRegistry` ever grows beyond two properties, it should be
reconsidered.

## Consequences

### Positive

- Domain services can be refactored one at a time to consume `IStorageBackend` instead of
  calling `fs` or `fileOperations` directly. Each migrated service immediately gains
  backend-agnosticism and testability with an in-memory stub.
- The frontend can read `capabilities()` via a future `/api/storage/capabilities` endpoint
  to gate UI features (branches, time-travel, multi-user indicators) on real backend support.
- An in-memory backend (slice 3) and a Postgres backend (eventual) become drop-in replacements
  without touching domain services.
- The git+filesystem contract is honest: `GIT_FILESYSTEM_CAPABILITIES` reflects what slice 1
  actually implements, not what git eventually will. Capability-gated UI features will not
  activate prematurely.

### Negative / Trade-offs

- **Extra indirection.** Services that were one `fs.readFile` call away from the file now go
  through `storageRegistry.getBackend().read(...)`. This is minor but real.
- **`mkdir(parents=false)` cannot be honored** — the underlying `fs.mkdir` always recurses.
  Callers must not depend on the `false` case in this slice; documented as a known gap.
- **Write is not atomic** — `writeFile` in `WorkspaceManager` is an in-place write with no
  tmp+rename. Concurrent writers or a crash mid-write can produce a torn file. Acceptable
  for slice 1 (no concurrent callers yet); must be addressed in slice 2.
- **ETag is mtime-derived**, not content-hashed. Two writes within the same millisecond
  produce the same etag. Low risk in practice (no caller uses `ifMatch` yet in slice 1).
- **`storageRegistry` is a mutable global.** Tests must call `reset()` in `afterEach`.

## References

- Issue #168 — pluggable storage backends (this ticket)
- Issue #167 — dictionary query service (first consumer of Layer 2)
- Issue #169 — per-user git worktrees (flips `branches`, `multiUser` capabilities)
- ADR-0001 — plain Express, no server-side microkernel
