/**
 * UuidIndex — #167 slice 6c
 *
 * In-process registry mapping `entity.uuid → LogicalPath`. The index is the
 * single point where cross-reference resolvers (relationships, rules,
 * conversation history) translate a uuid into the entity's current home.
 *
 * **Per-workspace.** One instance per `WorkspaceId`. The `findPathByUuid`
 * API does NOT take a workspaceId — instances are workspace-scoped at
 * construction time. Multi-workspace coordination is slice 6d's mount layer
 * concern, not 6c's.
 *
 * **Lifecycle.** Boot calls `rebuild()` once after the backend is registered,
 * then `start()` to subscribe to `LogicalProjection.onInvalidate(...)`. The
 * index is tolerant of out-of-order init (rebuild can be called before or
 * after start).
 *
 * **In-memory only.** No disk persistence; rebuild on boot. Caching reads is
 * 6a/6b's concern; this slice does not affect `readEntity` performance.
 *
 * **Rename robustness (Design Decision §4.6 of the spec).** The `entity-deleted`
 * handler verifies that `uuidToPath[uuid] === event.logicalPath` before
 * deleting `uuidToPath[uuid]`. This defends against the write-then-delete
 * ordering of a rename: if a new write has already pointed the uuid at a new
 * path, the subsequent delete of the OLD path must not wipe the new entry.
 */

import type { IStorageBackend } from '../contract/IStorageBackend.js';
import type { WorkspaceId } from '../contract/types.js';
import { pathOf } from '../contract/types.js';
import type {
  LogicalProjection,
  LogicalPath,
  Unsubscribe,
  ProjectionInvalidationEvent,
} from './LogicalProjection.js';

// ─────────────────────────────────────────────────────────────────────────────
// Private constants
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Reserved directory names skipped during subpackage walks. Mirrors
 * `fileOperations.ts:60` (`RESERVED_DIRS`). Declared locally to avoid
 * exporting an internal constant from `fileOperations.ts`.
 */
const RESERVED_DIRS = new Set(['.dico', '.git', 'node_modules']);

// ─────────────────────────────────────────────────────────────────────────────
// UuidIndex
// ─────────────────────────────────────────────────────────────────────────────

export class UuidIndex {
  private readonly uuidToPath = new Map<string, LogicalPath>();
  private readonly pathToUuid = new Map<LogicalPath, string>();
  private rebuildInFlight = false;
  private unsubscribe: Unsubscribe | null = null;

  constructor(
    private readonly projection: LogicalProjection,
    private readonly ws: WorkspaceId,
    /** Injected for direct backend enumeration; the projection layer has no
     *  package-enumeration primitive of its own (see Design Decision 6c.2). */
    private readonly backend: IStorageBackend,
  ) {}

  /**
   * Full scan: enumerate every package (including subpackages) and rebuild
   * the index from scratch. Replaces both maps atomically when complete.
   *
   * Throws if a duplicate uuid is found across packages (Design Decision
   * 6c.4 — fail loud; the project's identity contract is violated).
   *
   * Concurrent rebuilds are serialized: a second caller awaits the in-flight
   * rebuild before starting its own.
   */
  async rebuild(): Promise<void> {
    // Serialize: subsequent rebuild() calls await this one.
    while (this.rebuildInFlight) {
      await new Promise<void>(r => setTimeout(r, 0));
    }
    this.rebuildInFlight = true;
    try {
      const { listPackages } = await import('../../utils/fileOperations.js');
      const top = await listPackages();
      const allPackages: string[] = [];
      for (const pkg of top) {
        allPackages.push(pkg);
        await this.collectSubpackages(pkg, allPackages);
      }

      const nextUuidToPath = new Map<string, LogicalPath>();
      const nextPathToUuid = new Map<LogicalPath, string>();

      for (const pkgPath of allPackages) {
        const refs = await this.projection.listEntitiesInPackage(
          `packages/${pkgPath}` as LogicalPath,
        );
        for (const ref of refs) {
          const existing = nextUuidToPath.get(ref.uuid);
          if (existing !== undefined && existing !== ref.logicalPath) {
            throw new Error(
              `UuidIndex.rebuild: duplicate entity uuid "${ref.uuid}" across ` +
              `packages: "${existing}" and "${ref.logicalPath}". Entity uuids ` +
              `MUST be unique across the workspace per CLAUDE.md and slice-5 ` +
              `mergePackageSections.`,
            );
          }
          nextUuidToPath.set(ref.uuid, ref.logicalPath);
          nextPathToUuid.set(ref.logicalPath, ref.uuid);
        }
      }

      // Atomic replace — clear and repopulate. Don't update incrementally
      // during the scan; that would expose half-built state to readers.
      this.uuidToPath.clear();
      this.pathToUuid.clear();
      for (const [k, v] of nextUuidToPath) this.uuidToPath.set(k, v);
      for (const [k, v] of nextPathToUuid) this.pathToUuid.set(k, v);
    } finally {
      this.rebuildInFlight = false;
    }
  }

  /**
   * Subscribe to `projection.onInvalidate(...)` and begin maintaining the
   * index incrementally. Returns an `Unsubscribe` that detaches the handler
   * (used by tests; production calls `start()` once and never unsubscribes).
   *
   * Calling `start()` twice without unsubscribing in between is a programmer
   * error and throws.
   */
  start(): Unsubscribe {
    if (this.unsubscribe !== null) {
      throw new Error('UuidIndex.start: already started; call unsubscribe first');
    }
    this.unsubscribe = this.projection.onInvalidate((event) => {
      // Deliberate floating promise: slice-6b's subscriber contract is that
      // `fireInvalidation` does NOT await the subscriber's return value
      // (LogicalProjection.ts:269 — `for (const cb of snapshot) { cb(event); }`).
      // The handler is async only so it can await an in-flight rebuild; in the
      // steady state (rebuildInFlight === false) it runs its Map.set/delete
      // synchronously before the first `await` is reached. Backend ESLint has
      // `@typescript-eslint/no-floating-promises` OFF; if that ever changes,
      // wrap this in `.catch(e => logger.error(...))`.
      void this.handleEvent(event);
    });
    return () => {
      if (this.unsubscribe !== null) {
        this.unsubscribe();
        this.unsubscribe = null;
      }
    };
  }

  /** Synchronous lookup. Returns `null` on miss (unknown uuid OR empty index). */
  findPathByUuid(uuid: string): LogicalPath | null {
    return this.uuidToPath.get(uuid) ?? null;
  }

  /**
   * Inverse lookup. Returns the uuid of the entity at the given logical
   * path, or `null` if no entity is currently indexed there. Used by the
   * `entity-deleted` event handler (which arrives without a uuid per 6b
   * Design Decision 4.4) and exposed for test/audit purposes.
   */
  getUuidAtPath(logicalPath: LogicalPath): string | null {
    return this.pathToUuid.get(logicalPath) ?? null;
  }

  /** Test/audit helper. Snapshot of the current uuid→path mapping size. */
  size(): number {
    return this.uuidToPath.size;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Private helpers
  // ───────────────────────────────────────────────────────────────────────────

  private async handleEvent(event: ProjectionInvalidationEvent): Promise<void> {
    // Wait for any in-flight rebuild before applying. See Design Decision §4.1.
    while (this.rebuildInFlight) {
      await new Promise<void>(r => setTimeout(r, 0));
    }
    if (event.kind === 'entity-written') {
      // Defensive: write events always carry uuid per 6b §4. If a malformed
      // event arrives without one, skip rather than corrupt the index.
      if (!event.uuid) return;
      this.uuidToPath.set(event.uuid, event.logicalPath);
      this.pathToUuid.set(event.logicalPath, event.uuid);
    } else {
      // entity-deleted: looked up by path (delete events carry no uuid per
      // 6b Design Decision 4.4).
      const uuid = this.pathToUuid.get(event.logicalPath);
      if (uuid !== undefined) {
        this.pathToUuid.delete(event.logicalPath);
        // Only delete the uuid→path mapping if it still points at this path.
        // Defends against the write-then-delete rename ordering described in
        // Design Decision §4.6: if a fresh write has already re-pointed the
        // uuid at a new path, do NOT wipe the new mapping.
        if (this.uuidToPath.get(uuid) === event.logicalPath) {
          this.uuidToPath.delete(uuid);
        }
      }
      // If path is not indexed, silently no-op — a delete of an unknown
      // entity is benign; the index was already in the right state.
    }
  }

  /**
   * Depth-first walk that discovers subpackages under `parent`. A directory
   * is treated as a subpackage iff it contains a `package.yaml` marker.
   * Mirrors the convention used by `listPackages()` at the top level
   * (`fileOperations.ts:191-202`), recursing into nested dirs.
   *
   * Errors from `backend.list` / `backend.stat` are caught and swallowed
   * intentionally: both throw the same `'not-found'` code for missing dir /
   * missing file, and distinguishing them adds zero value here (the only
   * relevant signal is "no marker → not a subpackage, skip"). Spec §9 AC#9
   * permits this bare catch.
   */
  private async collectSubpackages(parent: string, out: string[]): Promise<void> {
    let entries;
    try {
      entries = await this.backend.list(this.ws, pathOf(parent));
    } catch {
      return; // directory does not exist or unreadable; nothing to recurse
    }
    for (const e of entries) {
      if (!e.isDirectory) continue;
      if (RESERVED_DIRS.has(e.name)) continue;
      const childPath = `${parent}/${e.name}`;
      const markerPath = pathOf(`${childPath}/package.yaml`);
      try {
        await this.backend.stat(this.ws, markerPath);
      } catch {
        continue; // no marker → not a subpackage
      }
      out.push(childPath);
      await this.collectSubpackages(childPath, out);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Module-level singleton registry
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Process-wide registry of `UuidIndex` instances, keyed by `String(WorkspaceId)`.
 * Slice 6d's `/fs/logical` route will call `getUuidIndex(ws)` to perform
 * reverse-resolution. One instance per workspace.
 */
const uuidIndexRegistry = new Map<string, UuidIndex>();

export function registerUuidIndex(ws: WorkspaceId, index: UuidIndex): void {
  uuidIndexRegistry.set(String(ws), index);
}

export function getUuidIndex(ws: WorkspaceId): UuidIndex {
  const idx = uuidIndexRegistry.get(String(ws));
  if (!idx) {
    throw new Error(
      `UuidIndex for workspace "${String(ws)}" not registered. ` +
      `server.ts must call registerUuidIndex() during bootstrap.`,
    );
  }
  return idx;
}

/** Test helper. Clears the registry. */
export function resetUuidIndexRegistry(): void {
  uuidIndexRegistry.clear();
}
