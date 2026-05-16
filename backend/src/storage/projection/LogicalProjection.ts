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
import { loadPackage } from '../../utils/fileOperations.js';

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
}
