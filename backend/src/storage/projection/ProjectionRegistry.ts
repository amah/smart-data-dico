/**
 * ProjectionRegistry — #167 slice 6d
 *
 * Process-wide registry of `LogicalProjection` instances, keyed by
 * `String(WorkspaceId)`. Mirrors the slice-6c `uuidIndexRegistry` shape
 * defined at the bottom of `UuidIndex.ts`.
 *
 * Slice 6d's `/fs/logical` route handlers call `getProjection(ws)` to resolve
 * the projection; boot wiring in `server.ts` constructs ONE projection per
 * workspace and registers it BEFORE constructing `UuidIndex` (so that the
 * index subscribes to the SAME instance the route handlers will write to —
 * closing slice-6c Risk §11.6 for projection-routed writes).
 *
 * Multi-workspace coordination (#169) extends this registry naturally:
 * fork-on-demand instances register additional entries keyed by their
 * per-user workspace id.
 *
 * Kept in its own module (NOT inside `LogicalProjection.ts`) so the slice
 * 6a/6b/6c diff guards (AC#7 in slice 6d spec) remain intact.
 */

import type { WorkspaceId } from '../contract/types.js';
import type { LogicalProjection } from './LogicalProjection.js';

const projectionRegistry = new Map<string, LogicalProjection>();

export function registerProjection(ws: WorkspaceId, projection: LogicalProjection): void {
  projectionRegistry.set(String(ws), projection);
}

/** Throws if no projection has been registered for the workspace. */
export function getProjection(ws: WorkspaceId): LogicalProjection {
  const projection = projectionRegistry.get(String(ws));
  if (!projection) {
    throw new Error(
      `LogicalProjection for workspace "${String(ws)}" not registered. ` +
      `server.ts must call registerProjection() during bootstrap.`,
    );
  }
  return projection;
}

/** Test helper. Clears the registry. */
export function resetProjectionRegistry(): void {
  projectionRegistry.clear();
}
