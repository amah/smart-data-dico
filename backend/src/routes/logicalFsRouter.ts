/**
 * logicalFsRouter — #167 slice 6d
 *
 * Express router builder for the `/fs/logical` mount. Translates
 * framework-shaped URLs (`/:workspace/<verb>/*`) into
 * `LogicalProjection.read/write/delete/list` calls against the
 * `LogicalProjection` registered at boot in `ProjectionRegistry`, plus a
 * `GET /:workspace/by-uuid/:uuid` endpoint that consumes
 * `UuidIndex.findPathByUuid` for stale-bookmark resolution.
 *
 * Slice 6d ships only ENTITY routes; relationships, rules, and perspectives
 * are deferred to slice 6e. `GET /:workspace/get/*` and
 * `POST /:workspace/mkdir/*` are intentionally NOT implemented (out of scope
 * per spec §3.2) — directories in the logical view are package-shaped, and
 * `read` already returns the entity payload.
 *
 * Auth posture: inherits the existing `/fs` mount's UNauthenticated stance
 * (spec §4.4). Adding auth to logical routes without also adding it to
 * `/fs` / `/fs/raw` would create a confusing asymmetry; the broader auth
 * migration is its own ticket.
 *
 * No `fs` imports here — slice-5c ESLint rule and the projection-layer
 * separation forbid it.
 */

import { Router, type Request, type Response } from 'express';
import { wsId } from '../storage/contract/types.js';
import type { LogicalPath } from '../storage/projection/LogicalProjection.js';
import { getProjection } from '../storage/projection/ProjectionRegistry.js';
import { getUuidIndex } from '../storage/projection/UuidIndex.js';

// ─────────────────────────────────────────────────────────────────────────────
// Internal types (not exported — wire shape is documented in spec §3.2)
// ─────────────────────────────────────────────────────────────────────────────

interface LogicalReadResponse {
  /** Logical path the entity was read from. */
  path: string;
  /** Entity payload serialized as YAML. */
  content: string;
  /** Always false for entities (entities are leaves, not directories). */
  isDirectory: false;
}

interface LogicalListEntry {
  /** Entity name (last segment of logicalPath). */
  name: string;
  /** Full logical path. */
  path: string;
  /** Entity uuid — included because callers often need it for cross-reference resolution. */
  uuid: string;
  isDirectory: false;
}

interface LogicalByUuidResponse {
  /** The current logical path of the entity with this uuid. */
  logicalPath: string;
}

interface LogicalDeleteResponse {
  path: string;
  deleted: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Read the splat path captured by Express's `*` wildcard back into a
 * `LogicalPath`. Express preserves embedded slashes in the splat — for
 * `/:workspace/read/*` matched against `/dictionaries/read/packages/foo/entities/Bar`,
 * `req.params[0]` is `'packages/foo/entities/Bar'` (no leading slash).
 */
function readLogicalPath(req: Request): LogicalPath {
  return String(req.params[0] ?? '') as LogicalPath;
}

/**
 * Translate a thrown error from `LogicalProjection.{read,write,delete,list}`
 * or `getProjection` / `getUuidIndex` into an HTTP response.
 *
 * The projection throws plain `Error` instances with documented message
 * prefixes (see `LogicalProjection.ts:201,205,213,237`) — duck-type via
 * substring matching rather than `instanceof <Class>`, per spec §6.2.
 *
 * Mapping:
 *   - "malformed path"          → 400 (programmer error / bad URL)
 *   - "path/content mismatch"   → 400 (path entity-name disagrees with body)
 *   - "not registered"          → 503 (projection or uuid index not bootstrapped)
 *   - anything else             → `fallbackStatus` (default 500)
 */
function respondError(res: Response, err: unknown, fallbackStatus = 500): void {
  const message = err instanceof Error ? err.message : String(err);
  if (message.includes('malformed path') || message.includes('path/content mismatch')) {
    res.status(400).json({ error: message });
    return;
  }
  if (message.includes('not registered')) {
    res.status(503).json({ error: message });
    return;
  }
  res.status(fallbackStatus).json({ error: message });
}

// ─────────────────────────────────────────────────────────────────────────────
// Router factory
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Creates an Express Router that serves logical-path operations against
 * the registered `LogicalProjection` for the embedded `:workspace` URL param.
 *
 * Route shape mirrors the framework's `FileRouter` so the frontend's
 * `HttpWorkspaceClient` (workspaceId + verb + path segments) can target it
 * unchanged. URL prefix `/fs/logical` is mounted in `server.ts`.
 *
 * Routes (all relative to the mount point):
 *   GET    /:workspace/files/*                — list entities in package
 *   GET    /:workspace/read/*                 — read one entity
 *   PUT    /:workspace/put/*                  — write one entity
 *   POST   /:workspace/post/*                 — write one entity (alias of PUT)
 *   DELETE /:workspace/delete/*               — delete one entity
 *   GET    /:workspace/by-uuid/:uuid          — reverse-resolve uuid → logicalPath
 *
 * Out of scope for slice 6d (will return Express's default 404):
 *   POST   /:workspace/mkdir/*                — directories are package-shaped, not entity-shaped
 *   GET    /:workspace/get/*                  — `read` already returns content
 */
export function createLogicalFsRouter(): Router {
  const router = Router();

  // ──────────────────────────────────────────────────────────────────────────
  // GET /:workspace/files/* — list entities in package
  //
  // The splat is the workspace-relative PACKAGE name (e.g. `order-service` or
  // `order-service/sub-billing`), NOT a full logical path. We prepend
  // `packages/` here so the projection sees a well-formed `LogicalPath`
  // (`packages/order-service`). The asymmetry with /read|/put|/delete (which
  // take the FULL logical path as the splat) is deliberate — see spec §11.6
  // and the convention discussion at the bottom of §6.2. Documented in
  // dev-notes.
  // ──────────────────────────────────────────────────────────────────────────
  router.get('/:workspace/files/*', async (req, res) => {
    try {
      const ws = wsId(req.params.workspace);
      const projection = getProjection(ws);
      const splat = readLogicalPath(req);
      const path = `packages/${splat}` as LogicalPath;
      const entries = await projection.listEntitiesInPackage(path);
      const body: LogicalListEntry[] = entries.map(e => ({
        name: e.name,
        path: e.logicalPath,
        uuid: e.uuid,
        isDirectory: false,
      }));
      res.json(body);
    } catch (err) {
      respondError(res, err);
    }
  });

  // ──────────────────────────────────────────────────────────────────────────
  // GET /:workspace/read/* — read one entity
  // ──────────────────────────────────────────────────────────────────────────
  router.get('/:workspace/read/*', async (req, res) => {
    try {
      const ws = wsId(req.params.workspace);
      const projection = getProjection(ws);
      const path = readLogicalPath(req);
      const entity = await projection.readEntity(path);
      if (!entity) {
        res.status(404).json({ error: `Entity not found at logical path "${path}"` });
        return;
      }
      const YAML = await import('yaml');
      const content = YAML.stringify(entity);
      const body: LogicalReadResponse = { path, content, isDirectory: false };
      res.json(body);
    } catch (err) {
      respondError(res, err);
    }
  });

  // ──────────────────────────────────────────────────────────────────────────
  // PUT /:workspace/put/* and POST /:workspace/post/* — write one entity
  //
  // Body shape: { content: <YAML string> }. The YAML is parsed into an
  // Entity object and handed to LogicalProjection.writeEntity, which
  // enforces path/name matching and multi-kind safety, then fires the
  // invalidation event that the (same-instance) UuidIndex subscribes to.
  // ──────────────────────────────────────────────────────────────────────────
  const writeHandler = async (req: Request, res: Response): Promise<void> => {
    try {
      const ws = wsId(req.params.workspace);
      const projection = getProjection(ws);
      const path = readLogicalPath(req);
      const rawContent = (req.body as { content?: unknown } | undefined)?.content;
      if (typeof rawContent !== 'string') {
        res.status(400).json({ error: 'Body must be { content: <YAML string> }' });
        return;
      }
      const YAML = await import('yaml');
      let entity;
      try {
        entity = YAML.parse(rawContent);
      } catch (parseErr) {
        const msg = parseErr instanceof Error ? parseErr.message : String(parseErr);
        res.status(400).json({ error: `YAML parse failed: ${msg}` });
        return;
      }
      await projection.writeEntity(path, entity);
      const body: LogicalReadResponse = { path, content: rawContent, isDirectory: false };
      res.json(body);
    } catch (err) {
      respondError(res, err);
    }
  };
  router.put('/:workspace/put/*', writeHandler);
  router.post('/:workspace/post/*', writeHandler);

  // ──────────────────────────────────────────────────────────────────────────
  // DELETE /:workspace/delete/* — delete one entity
  // ──────────────────────────────────────────────────────────────────────────
  router.delete('/:workspace/delete/*', async (req, res) => {
    try {
      const ws = wsId(req.params.workspace);
      const projection = getProjection(ws);
      const path = readLogicalPath(req);
      const deleted = await projection.deleteEntity(path);
      const body: LogicalDeleteResponse = { path, deleted };
      res.json(body);
    } catch (err) {
      respondError(res, err);
    }
  });

  // ──────────────────────────────────────────────────────────────────────────
  // GET /:workspace/by-uuid/:uuid — reverse-resolve uuid → logicalPath
  //
  // First production consumer of slice-6c's UuidIndex.findPathByUuid.
  // ──────────────────────────────────────────────────────────────────────────
  router.get('/:workspace/by-uuid/:uuid', (req, res) => {
    try {
      const ws = wsId(req.params.workspace);
      const index = getUuidIndex(ws);
      const logicalPath = index.findPathByUuid(req.params.uuid);
      if (!logicalPath) {
        res.status(404).json({ error: `uuid "${req.params.uuid}" not found in index` });
        return;
      }
      const body: LogicalByUuidResponse = { logicalPath };
      res.json(body);
    } catch (err) {
      respondError(res, err);
    }
  });

  return router;
}
