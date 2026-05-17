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

import type { Entity } from '../../models/EntitySchema.js';
import type { IStorageBackend } from '../contract/IStorageBackend.js';
import type { WorkspaceId } from '../contract/types.js';
import { loadPackage, writeEntityFile, deleteEntityFile } from '../../utils/fileOperations.js';

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
 * - `kind: 'entity-written'` — fires after `writeEntity` succeeds. `uuid` is
 *   always present (taken from `entity.uuid`).
 * - `kind: 'entity-deleted'` — fires after `deleteEntity` returns `true`.
 *   `uuid` is omitted (deletion is by path; the caller did not provide a uuid
 *   and slice 6b does not perform a pre-delete read — see Design Decision 4).
 *
 * Events fire SYNCHRONOUSLY after the underlying file mutation succeeds.
 * Subscriber errors are NOT swallowed — they propagate out of the write/delete
 * call and the caller sees them. (Slice 6c is the first subscriber; if it
 * throws, the entire write/delete throws, which is the correct fail-loud
 * semantic for an inconsistent index.)
 */
export interface ProjectionInvalidationEvent {
  kind: 'entity-written' | 'entity-deleted';
  logicalPath: LogicalPath;
  uuid?: string;
}

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
 * or is actually an entity path containing an `entities` segment).
 *
 * Path shape: `packages/<pkg>/[<sub>/...]`
 * Minimum 2 segments: `packages`, `<pkg>`.
 */
function parsePackagePath(p: LogicalPath): string | null {
  const segs = String(p).split('/').filter(Boolean);
  if (segs.length < 2) return null;
  if (segs[0] !== 'packages') return null;
  if (segs.includes('entities')) return null;  // not a package path, it's an entity path
  return segs.slice(1).join('/');
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
    const ok = await writeEntityFile(entity, parsed.packageName);
    if (!ok) {
      throw new Error(
        `LogicalProjection.writeEntity: writeEntityFile failed for ` +
        `"${logicalPath}" (entity "${entity.name}" uuid "${entity.uuid}"). ` +
        `Check backend logs for the underlying cause.`
      );
    }
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
    const deleted = await deleteEntityFile(parsed.packageName, parsed.entityName);
    if (deleted) {
      this.fireInvalidation({ kind: 'entity-deleted', logicalPath });
    }
    return deleted;
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

  private fireInvalidation(event: ProjectionInvalidationEvent): void {
    // Snapshot to make unsubscribe-during-dispatch safe.
    const snapshot = [...this.invalidationSubscribers];
    for (const cb of snapshot) {
      cb(event);
    }
  }
}
