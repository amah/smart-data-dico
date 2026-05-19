/**
 * MCP connection management routes (#178).
 *
 * These routes let the Settings UI manage external MCP server connections
 * without touching code. The connection definitions are persisted in
 * ~/.dico-app/dico-app.json under the `mcp` section.
 *
 * Routes:
 *   GET    /api/ai/mcp/connections         List all connections
 *   POST   /api/ai/mcp/connections         Upsert a connection (add or update by id)
 *   DELETE /api/ai/mcp/connections/:id     Remove a connection
 *   POST   /api/ai/mcp/connections/:id/test  Probe listTools, return ok/error
 */

import { Router, Request, Response } from 'express';
import { mcpClientRegistry } from '../../services/mcpClientRegistry.js';
import type { McpConnection } from '../../services/mcpClientRegistry.js';

const router: Router = Router();

/**
 * Mask sentinel for secret-bearing fields (env values, header values).
 * Returned to the client in place of real values so saved secrets
 * never leak over the wire. The POST handler treats this exact string
 * as "do not overwrite the persisted value" — see the upsert merge
 * below. `${VAR}` placeholders pass through unmasked because they're
 * already references, not secrets.
 */
const MASK = '••••••••';

const looksLikeEnvRef = (v: string): boolean => /\$\{[^}]+\}/.test(v);

function maskRecord(record: Record<string, string> | undefined): Record<string, string> | undefined {
  if (!record) return record;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(record)) {
    out[k] = looksLikeEnvRef(v) || v === '' ? v : MASK;
  }
  return out;
}

function maskConnection(conn: McpConnection): McpConnection {
  return {
    ...conn,
    env: maskRecord(conn.env),
    headers: maskRecord(conn.headers),
  };
}

/**
 * For each masked value in the incoming record, copy through the
 * stored value from the existing connection. Anything the user
 * actually typed (a literal, an env-ref, or an empty string) is
 * preserved. `existing` undefined → masked values are dropped, since
 * there is nothing to preserve from.
 */
function mergeMaskedRecord(
  incoming: Record<string, string> | undefined,
  existing: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!incoming) return incoming;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(incoming)) {
    if (v === MASK) {
      if (existing && existing[k] !== undefined) out[k] = existing[k];
      // else: drop the key — better than persisting the mask sentinel
    } else {
      out[k] = v;
    }
  }
  return out;
}

// GET /api/ai/mcp/connections
router.get('/api/ai/mcp/connections', (_req: Request, res: Response) => {
  try {
    const connections = mcpClientRegistry.getConnections().map(maskConnection);
    res.json({ data: connections });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// POST /api/ai/mcp/connections  (upsert)
router.post('/api/ai/mcp/connections', (req: Request, res: Response) => {
  try {
    const body = req.body as Partial<McpConnection>;
    const errors = mcpClientRegistry.validateConnection(body);
    if (errors.length > 0) {
      return res.status(400).json({ errors });
    }
    const conn = body as McpConnection;
    // Default enabled = true if not supplied
    if (typeof conn.enabled !== 'boolean') conn.enabled = true;
    // Default trustLevel = 'review' (safe default)
    if (!conn.trustLevel) conn.trustLevel = 'review';
    // Masked-edit guard: any env/header value the client sent back as
    // the MASK sentinel was never actually shown to them, so we copy
    // the stored value through. New entries (no existing record) lose
    // masked values silently — there's nothing to preserve.
    const existing = mcpClientRegistry.getConnections().find((c) => c.id === conn.id);
    conn.env = mergeMaskedRecord(conn.env, existing?.env);
    conn.headers = mergeMaskedRecord(conn.headers, existing?.headers);
    mcpClientRegistry.upsertConnection(conn);
    // Echo back the masked shape so the UI can refresh its row state
    // without holding the just-saved secret in browser memory.
    res.json({ data: maskConnection(conn) });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// DELETE /api/ai/mcp/connections/:id
router.delete('/api/ai/mcp/connections/:id', (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const deleted = mcpClientRegistry.deleteConnection(id);
    if (!deleted) {
      return res.status(404).json({ error: `Connection not found: ${id}` });
    }
    res.json({ data: { deleted: true, id } });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// POST /api/ai/mcp/connections/:id/test
router.post('/api/ai/mcp/connections/:id/test', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const result = await mcpClientRegistry.testConnection(id);
    if (result.ok) {
      res.json({ data: result });
    } else {
      res.status(502).json({ data: result });
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

export default router;
