/**
 * LogicalProjection — #167 slice 6a
 *
 * Translates a logical address (`packages/<pkg>/[sub/...]/entities/<Name>`)
 * into a physical multi-kind YAML lookup against the registered
 * `IStorageBackend`, returning a normalized `Entity`.
 *
 * Scope: read-only, entities only. Slice 6b adds writes; 6c adds the uuid
 * index; 6d mounts the logical and raw route endpoints; 6e extends to
 * relationships, rules, and cases.
 */

import type { Entity, Relationship, Case } from '../../models/EntitySchema.js';
import type { Rule } from '../../models/Rule.js';
import type { IStorageBackend } from '../contract/IStorageBackend.js';
import type { WorkspaceId } from '../contract/types.js';
import {
  loadPackage,
  writeEntityFile,
  deleteEntityFile,
  writeRelationshipsFile,
  writePackageRules,
  writeGlobalRules,
  writeCaseFile,
  deleteCaseFile,
  getPackagePath,
} from '../../utils/fileOperations.js';

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A logical address into the projection layer (#168). String value,
 * slash-delimited, MUST start with `packages/`. Plain string type (not a
 * branded type) — see Design Decision 1 in the spec.
 *
 *   packages/<pkg>/[<sub>/...]/entities/<EntityName>   — single entity
 *   packages/<pkg>/[<sub>/...]                          — package directory
 */
export type LogicalPath = string;

/** Lightweight entity reference returned by `listEntitiesInPackage`. */
export interface EntityRef {
  /** Entity name (also the last segment of `logicalPath`). */
  name: string;
  /** uuid of the entity (stable identity, per CLAUDE.md data model). */
  uuid: string;
  /** Full logical address: `packages/.../entities/<name>`. */
  logicalPath: LogicalPath;
}

/**
 * Invalidation event emitted by `LogicalProjection` after a confirmed write
 * or delete. Subscribers consume this to invalidate caches or update indexes.
 *
 * Slice 6a/6b emitted only entity events. Slice 6e.1 extends the union to
 * cover relationships, rules (entity/package/case/global), and cases —
 * additive only, so the existing `UuidIndex` handler (which dispatches on
 * `entity-written` / `entity-deleted` and silently ignores anything else)
 * remains forward-compatible.
 *
 * Entity-scope rule writes do NOT fire `rule-written`: they go through
 * `projection.writeEntity` (which fires `entity-written`). That's why the
 * `scope` literal on `rule-*` events excludes `'entity'`.
 *
 * Events fire SYNCHRONOUSLY after the underlying file mutation succeeds.
 * Subscriber errors are NOT swallowed — they propagate out of the write/delete
 * call and the caller sees them.
 */
export type ProjectionInvalidationEvent =
  | { kind: 'entity-written'; logicalPath: LogicalPath; uuid: string }
  | { kind: 'entity-deleted'; logicalPath: LogicalPath; uuid?: string }
  | { kind: 'relationships-written'; packagePath: LogicalPath; uuids: string[] }
  | { kind: 'rule-written'; scope: 'package' | 'case' | 'global'; ruleUuid: string; anchorLogicalPath?: LogicalPath }
  | { kind: 'rule-deleted'; scope: 'package' | 'case' | 'global'; ruleUuid: string }
  | { kind: 'case-written'; logicalPath: LogicalPath; uuid: string }
  | { kind: 'case-deleted'; logicalPath: LogicalPath; uuid: string }
  | { kind: 'raw-changed'; physicalPath: string; changeKind: 'add' | 'change' | 'unlink' };

/** Callback invoked synchronously when an invalidation event fires. */
export type InvalidationCallback = (event: ProjectionInvalidationEvent) => void;

/** Returned by `onInvalidate` — call to remove the subscription. */
export type Unsubscribe = () => void;

// ─────────────────────────────────────────────────────────────────────────────
// Private path parsers
// ─────────────────────────────────────────────────────────────────────────────

interface ParsedEntityPath {
  /**
   * Workspace-relative package directory (slash-joined):
   * `"order-service"` or `"order-service/sub-x"`.
   */
  packageName: string;
  /** The entity name from the last segment after `entities/`. */
  entityName: string;
}

/**
 * Parse a logical entity path into its package-name and entity-name
 * components. Returns `null` for any malformed input (missing prefix,
 * wrong segment count, invalid entity-name characters).
 *
 * Path shape: `packages/<pkg>/[<sub>/...]/entities/<EntityName>`
 * Minimum 4 segments: `packages`, `<pkg>`, `entities`, `<EntityName>`.
 */
function parseEntityPath(p: LogicalPath): ParsedEntityPath | null {
  const segs = String(p).split('/').filter(Boolean);
  if (segs.length < 4) return null;                        // packages/<pkg>/entities/<Name>
  if (segs[0] !== 'packages') return null;
  const entitiesIdx = segs.lastIndexOf('entities');
  if (entitiesIdx < 2) return null;                        // must be after at least one pkg segment
  if (entitiesIdx !== segs.length - 2) return null;        // exactly one segment after `entities`
  const entityName = segs[segs.length - 1];
  if (!/^[A-Za-z0-9_-]+$/.test(entityName)) return null;  // declared escaping assumption (see DD 4)
  const packageName = segs.slice(1, entitiesIdx).join('/');
  return { packageName, entityName };
}

/**
 * Parse a logical package path into the workspace-relative package name.
 * Returns `null` for any malformed input (missing prefix, too short,
 * or is actually an entity/case path containing those segments).
 *
 * Path shape: `packages/<pkg>/[<sub>/...]`
 * Minimum 2 segments: `packages`, `<pkg>`.
 */
function parsePackagePath(p: LogicalPath): string | null {
  const segs = String(p).split('/').filter(Boolean);
  if (segs.length < 2) return null;
  if (segs[0] !== 'packages') return null;
  if (segs.includes('entities')) return null;  // not a package path, it's an entity path
  if (segs.includes('cases')) return null;     // not a package path, it's a case path
  return segs.slice(1).join('/');
}

interface ParsedCasePath {
  /** Workspace-relative package directory (slash-joined). */
  packageName: string;
  /** The case name from the last segment after `cases/`. */
  caseName: string;
}

/**
 * Parse a logical case path into its package-name and case-name components.
 * Returns `null` for any malformed input.
 *
 * Path shape: `packages/<pkg>/[<sub>/...]/cases/<CaseName>`
 * Mirrors `parseEntityPath` with `cases` in place of `entities`.
 */
function parseCasePath(p: LogicalPath): ParsedCasePath | null {
  const segs = String(p).split('/').filter(Boolean);
  if (segs.length < 4) return null;
  if (segs[0] !== 'packages') return null;
  const casesIdx = segs.lastIndexOf('cases');
  if (casesIdx < 2) return null;
  if (casesIdx !== segs.length - 2) return null;
  const caseName = segs[segs.length - 1];
  // Case names are user-authored. `entities` allows [A-Za-z0-9_-]; for cases
  // we mirror that exactly so the path parsing semantic stays uniform — the
  // file layer sanitises differently via `sanitizeFsName`, but the path-level
  // shape is identical to entities.
  if (!/^[A-Za-z0-9_-]+$/.test(caseName)) return null;
  const packageName = segs.slice(1, casesIdx).join('/');
  return { packageName, caseName };
}

// ─────────────────────────────────────────────────────────────────────────────
// LogicalProjection
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Read-only projection from logical addresses to physical YAML files.
 *
 * The `backend` and `ws` constructor parameters are stored for forward
 * compatibility with slice 6b (writes) and 6c (uuid index). In slice 6a
 * they are accepted but not used — `loadPackage` resolves its own backend
 * via `storageRegistry`.
 */
export class LogicalProjection {
  private readonly invalidationSubscribers: InvalidationCallback[] = [];

  /**
   * Suppression bookkeeping for the raw-fs watcher (slice 6e.2).
   *
   * Every projection write records the physical path it touched in
   * `suppressedPaths` with an expiry timestamp. The `RawFsWatcher` consults
   * `isSuppressed(physicalPath)` before emitting a `raw-changed` event and
   * skips paths whose suppression window is still open. The TTL (1500 ms by
   * default) is long enough to cover chokidar's `awaitWriteFinish.stabilityThreshold`
   * (~200 ms) + the watcher's 250 ms coalesce window + safety.
   */
  private readonly suppressedPaths = new Map<string, number>();

  constructor(
    private readonly backend: IStorageBackend,
    private readonly ws: WorkspaceId,
  ) {}

  /**
   * Read one entity at a logical path. Returns `null` if:
   *   - the path is not a well-formed entity address
   *   - the package directory does not exist
   *   - no YAML file in the package directory contains an entity with this name
   *
   * Throws on collision (duplicate entity name within the package) — relies
   * on `mergePackageSections` to raise the existing "Duplicate entity name"
   * error, which is the project's collision semantic per #106.
   */
  async readEntity(logicalPath: LogicalPath): Promise<Entity | null> {
    const parsed = parseEntityPath(logicalPath);
    if (!parsed) return null;
    const pkg = await loadPackage(parsed.packageName);
    return pkg.entities.find(e => e.name === parsed.entityName) ?? null;
  }

  /**
   * List every entity directly in the package directory. Non-recursive —
   * subpackage entities are NOT included (a subpackage at
   * `order-service/sub-x` requires a separate call with that path).
   *
   * Returns an empty array if:
   *   - the path is malformed (or is an entity path, not a package path)
   *   - the package directory does not exist
   *
   * Order matches `loadPackage` order: filename lexicographic, then
   * `entities[]` array order within each file.
   */
  async listEntitiesInPackage(packagePath: LogicalPath): Promise<EntityRef[]> {
    const parsedPackageName = parsePackagePath(packagePath);
    if (!parsedPackageName) return [];
    const pkg = await loadPackage(parsedPackageName);
    return pkg.entities.map(e => ({
      name: e.name,
      uuid: e.uuid,
      logicalPath: `packages/${parsedPackageName}/entities/${e.name}` as LogicalPath,
    }));
  }

  /**
   * Write an entity at the given logical path. Delegates to
   * `fileOperations.writeEntityFile`, which preserves co-located non-entity
   * sections (relationships, rules, cases — #106 multi-kind).
   *
   * The parsed entity name from `logicalPath` MUST equal `entity.name`;
   * mismatch throws to prevent index/path desync (without this guard, slice
   * 6c's uuid index would silently drift).
   *
   * Throws on:
   *   - malformed `logicalPath` (NOT silently no-op — programmer error)
   *   - parsed entityName !== entity.name (path/content mismatch)
   *   - underlying write failure (writeEntityFile returns false)
   *
   * On success, fires a `{ kind: 'entity-written', logicalPath, uuid }`
   * event to all subscribers BEFORE returning.
   */
  async writeEntity(logicalPath: LogicalPath, entity: Entity): Promise<void> {
    const parsed = parseEntityPath(logicalPath);
    if (!parsed) {
      throw new Error(`LogicalProjection.writeEntity: malformed path "${logicalPath}"`);
    }
    if (parsed.entityName !== entity.name) {
      throw new Error(
        `LogicalProjection.writeEntity: path/content mismatch — ` +
        `path "${logicalPath}" parses to entity name "${parsed.entityName}" ` +
        `but entity.name is "${entity.name}"`
      );
    }
    const { ok, physicalPath } = await writeEntityFile(entity, parsed.packageName);
    if (!ok) {
      throw new Error(
        `LogicalProjection.writeEntity: writeEntityFile failed for ` +
        `"${logicalPath}" (entity "${entity.name}" uuid "${entity.uuid}"). ` +
        `Check backend logs for the underlying cause.`
      );
    }
    if (physicalPath) this.suppressNextWrite(physicalPath);
    this.fireInvalidation({ kind: 'entity-written', logicalPath, uuid: entity.uuid });
  }

  /**
   * Delete the entity at the given logical path. Delegates to
   * `fileOperations.deleteEntityFile`, which removes only the named entity
   * and preserves co-located sections (or removes the file entirely if the
   * entity was its only content — slice-5 behaviour).
   *
   * Throws on malformed `logicalPath` (write-on-bad-path is a programmer
   * error, same rationale as `writeEntity`).
   *
   * Returns `true` if an entity was deleted, `false` if no entity at that
   * path was found. The invalidation event fires ONLY on the `true` path —
   * a `false` return means no state changed and no subscriber needs to act.
   */
  async deleteEntity(logicalPath: LogicalPath): Promise<boolean> {
    const parsed = parseEntityPath(logicalPath);
    if (!parsed) {
      throw new Error(`LogicalProjection.deleteEntity: malformed path "${logicalPath}"`);
    }
    const { ok, physicalPath } = await deleteEntityFile(parsed.packageName, parsed.entityName);
    if (ok) {
      if (physicalPath) this.suppressNextWrite(physicalPath);
      this.fireInvalidation({ kind: 'entity-deleted', logicalPath });
    }
    return ok;
  }

  /**
   * Write the full relationships list for a package. Delegates to
   * `fileOperations.writeRelationshipsFile`, which preserves co-located
   * non-relationship sections (entities, rules, cases — #106 multi-kind).
   *
   * `packagePath` MUST be a `packages/<pkg>` shape (no `/entities/`,
   * `/cases/` segments). Mismatch throws.
   *
   * On success, fires
   * `{ kind: 'relationships-written', packagePath, uuids: relationships.map(r => r.uuid) }`.
   */
  async writeRelationships(packagePath: LogicalPath, relationships: Relationship[]): Promise<void> {
    const parsedPackageName = parsePackagePath(packagePath);
    if (!parsedPackageName) {
      throw new Error(`LogicalProjection.writeRelationships: malformed path "${packagePath}"`);
    }
    const physicalPackagePath = getPackagePath(parsedPackageName);
    const { ok, physicalPath } = await writeRelationshipsFile(physicalPackagePath, relationships);
    if (!ok) {
      throw new Error(
        `LogicalProjection.writeRelationships: writeRelationshipsFile failed for ` +
        `"${packagePath}". Check backend logs for the underlying cause.`
      );
    }
    if (physicalPath) this.suppressNextWrite(physicalPath);
    this.fireInvalidation({
      kind: 'relationships-written',
      packagePath,
      uuids: relationships.map(r => r.uuid),
    });
  }

  /**
   * Write the full package-scope rules list. Mirrors `writeRelationships`.
   * Delegates to `fileOperations.writePackageRules`.
   *
   * Fires one `{ kind: 'rule-written', scope: 'package', ... }` event per
   * rule in the new list (spec §6 AC5: "one event per rule").
   */
  async writePackageRules(packagePath: LogicalPath, rules: Rule[]): Promise<void> {
    const parsedPackageName = parsePackagePath(packagePath);
    if (!parsedPackageName) {
      throw new Error(`LogicalProjection.writePackageRules: malformed path "${packagePath}"`);
    }
    const { ok, physicalPath } = await writePackageRules(parsedPackageName, rules);
    if (!ok) {
      throw new Error(
        `LogicalProjection.writePackageRules: writePackageRules failed for ` +
        `"${packagePath}". Check backend logs for the underlying cause.`
      );
    }
    if (physicalPath) this.suppressNextWrite(physicalPath);
    // One event per rule (spec §6 AC5). The new list is the canonical state
    // after the write; subscribers needing per-rule notifications fan out here.
    for (const r of rules) {
      this.fireInvalidation({
        kind: 'rule-written',
        scope: 'package',
        ruleUuid: r.uuid,
        anchorLogicalPath: packagePath,
      });
    }
  }

  /**
   * Write global (project-root `rules.yaml`) rules. No logical-path argument
   * because global rules are not under `packages/**`. Delegates to
   * `fileOperations.writeGlobalRules`.
   *
   * Fires one `{ kind: 'rule-written', scope: 'global', ... }` event per rule.
   */
  async writeGlobalRules(rules: Rule[]): Promise<void> {
    const { ok, physicalPath } = await writeGlobalRules(rules);
    if (!ok) {
      throw new Error(
        `LogicalProjection.writeGlobalRules: writeGlobalRules failed. ` +
        `Check backend logs for the underlying cause.`
      );
    }
    if (physicalPath) this.suppressNextWrite(physicalPath);
    // One event per rule (spec §6 AC6 wording: "one event per rule").
    for (const r of rules) {
      this.fireInvalidation({
        kind: 'rule-written',
        scope: 'global',
        ruleUuid: r.uuid,
        anchorLogicalPath: undefined,
      });
    }
  }

  /**
   * Write a case at a logical path. Path shape:
   * `packages/<pkg>/cases/<Name>`. `c.name` MUST equal the parsed last
   * segment (mirrors `writeEntity`'s slice-6b' guard at
   * `LogicalProjection.ts:203-209`).
   *
   * Delegates to `fileOperations.writeCaseFile`, which (a) finds the
   * owning package via the case uuid if it already exists, (b) otherwise
   * places the case in the home package resolved from its first root
   * entity. The path-level package segment is therefore validated only as
   * a name-vs-content guard; the actual on-disk placement is `writeCaseFile`'s
   * concern.
   *
   * Fires `{ kind: 'case-written', logicalPath, uuid: c.uuid }`.
   */
  async writeCase(logicalPath: LogicalPath, c: Case): Promise<void> {
    const parsed = parseCasePath(logicalPath);
    if (!parsed) {
      throw new Error(`LogicalProjection.writeCase: malformed path "${logicalPath}"`);
    }
    if (parsed.caseName !== c.name) {
      throw new Error(
        `LogicalProjection.writeCase: path/content mismatch — ` +
        `path "${logicalPath}" parses to case name "${parsed.caseName}" ` +
        `but case.name is "${c.name}"`
      );
    }
    const { ok, physicalPath } = await writeCaseFile(c);
    if (!ok) {
      throw new Error(
        `LogicalProjection.writeCase: writeCaseFile failed for ` +
        `"${logicalPath}" (case "${c.name}" uuid "${c.uuid}"). ` +
        `Check backend logs for the underlying cause.`
      );
    }
    if (physicalPath) this.suppressNextWrite(physicalPath);
    this.fireInvalidation({ kind: 'case-written', logicalPath, uuid: c.uuid });
  }

  /**
   * Delete the case at a logical path. Reads the case via `readCase` to
   * resolve its uuid, then delegates to `fileOperations.deleteCaseFile`.
   *
   * Returns `true` if a case was deleted, `false` if no case was found at
   * that path. Invalidation event fires ONLY on the `true` path.
   */
  async deleteCase(logicalPath: LogicalPath): Promise<boolean> {
    const parsed = parseCasePath(logicalPath);
    if (!parsed) {
      throw new Error(`LogicalProjection.deleteCase: malformed path "${logicalPath}"`);
    }
    const existing = await this.readCase(logicalPath);
    if (!existing) return false;
    const { ok, physicalPath } = await deleteCaseFile(existing.uuid);
    if (!ok) return false;
    if (physicalPath) this.suppressNextWrite(physicalPath);
    this.fireInvalidation({ kind: 'case-deleted', logicalPath, uuid: existing.uuid });
    return true;
  }

  /**
   * Read one case at a logical path. Returns `null` on miss (malformed
   * path, missing package, or no case in the package matching the
   * `cases/<Name>` segment). Symmetric with `readEntity`.
   *
   * Resolution: scans the parsed package's loaded `cases` for an entry
   * whose `name === caseName`. The underlying `loadPackage` is already
   * content-driven (multi-kind, filename-independent), so a case may live
   * in any `.yaml` file under the package folder.
   */
  async readCase(logicalPath: LogicalPath): Promise<Case | null> {
    const parsed = parseCasePath(logicalPath);
    if (!parsed) return null;
    try {
      const pkg = await loadPackage(parsed.packageName);
      return pkg.cases.find(c => c.name === parsed.caseName) ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Register a subscriber for invalidation events. Returns an `Unsubscribe`
   * function that removes this specific subscriber (idempotent).
   *
   * Subscribers are called synchronously, in registration order, after the
   * underlying file mutation succeeds. A subscriber error propagates to the
   * write/delete caller (fail-loud — see `ProjectionInvalidationEvent` jsdoc).
   *
   * Slice 6b ships with zero production subscribers; slice 6c will be the
   * first consumer (uuid → path index). Tests use this hook with spy
   * subscribers to verify events fire.
   */
  onInvalidate(callback: InvalidationCallback): Unsubscribe {
    this.invalidationSubscribers.push(callback);
    return () => {
      const idx = this.invalidationSubscribers.indexOf(callback);
      if (idx !== -1) this.invalidationSubscribers.splice(idx, 1);
    };
  }

  /**
   * Suppression bookkeeping for the raw-fs watcher (slice 6e.2). Records
   * that the next filesystem change on `physicalPath` (within `ttlMs` ms)
   * was authored by the projection itself and must NOT trigger
   * re-projection.
   *
   * Called automatically by every write/delete method on this class before
   * returning. Exposed publicly so tests can drive the suppression directly
   * without an actual write.
   */
  suppressNextWrite(physicalPath: string, ttlMs: number = 1500): void {
    this.suppressedPaths.set(physicalPath, Date.now() + ttlMs);
  }

  /**
   * True iff `physicalPath` was suppressed by a recent projection write and
   * the suppression window has not expired. Called by RawFsWatcher before
   * emitting `raw-changed`. The check is consuming: once a suppressed path
   * is acknowledged, the entry is cleared so a subsequent external write
   * (after the window) is detected normally.
   */
  isSuppressed(physicalPath: string): boolean {
    const expiry = this.suppressedPaths.get(physicalPath);
    if (expiry === undefined) return false;
    if (Date.now() > expiry) {
      this.suppressedPaths.delete(physicalPath);
      return false;
    }
    // Consume on hit: prevents a single registered write from suppressing
    // multiple unrelated subsequent events at the same path.
    this.suppressedPaths.delete(physicalPath);
    return true;
  }

  /**
   * Fire a `raw-changed` invalidation event. Intended only for
   * `RawFsWatcher`; not used by production code elsewhere (no enforcement
   * at type level — convention only).
   */
  fireExternalInvalidation(event: Extract<ProjectionInvalidationEvent, { kind: 'raw-changed' }>): void {
    this.fireInvalidation(event);
  }

  private fireInvalidation(event: ProjectionInvalidationEvent): void {
    // Snapshot to make unsubscribe-during-dispatch safe.
    const snapshot = [...this.invalidationSubscribers];
    for (const cb of snapshot) {
      cb(event);
    }
  }
}
