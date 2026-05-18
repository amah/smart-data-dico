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

// GET /api/ai/mcp/connections
router.get('/api/ai/mcp/connections', (_req: Request, res: Response) => {
  try {
    const connections = mcpClientRegistry.getConnections();
    // Never leak headers/env values that might contain tokens —
    // return the connection shape but mask secret-looking fields.
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
    mcpClientRegistry.upsertConnection(conn);
    res.json({ data: conn });
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
