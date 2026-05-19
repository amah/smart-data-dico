/**
 * Tests for the MCP connection management routes (#178 slice 2).
 *
 * Focus is the secrets contract: GET must return `••••••••` in
 * place of stored env/header values; POST must round-trip those
 * masks unchanged so a user who edits an unrelated field without
 * touching a secret doesn't accidentally clobber it. `${VAR}` env
 * refs pass through unmasked because they're not secrets — just
 * pointers.
 */

import express, { type Express } from 'express';
import request from 'supertest';

const storedConnections: Array<Record<string, unknown>> = [];

jest.mock('../../services/mcpClientRegistry', () => ({
  mcpClientRegistry: {
    getConnections: jest.fn(() => storedConnections),
    upsertConnection: jest.fn((conn: Record<string, unknown>) => {
      const idx = storedConnections.findIndex((c) => c.id === conn.id);
      if (idx >= 0) storedConnections[idx] = conn;
      else storedConnections.push(conn);
    }),
    deleteConnection: jest.fn((id: string) => {
      const idx = storedConnections.findIndex((c) => c.id === id);
      if (idx < 0) return false;
      storedConnections.splice(idx, 1);
      return true;
    }),
    validateConnection: jest.fn(() => []),
    testConnection: jest.fn(),
  },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const mcpRouter = require('../ai/mcp.routes').default;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { mcpClientRegistry } = require('../../services/mcpClientRegistry');

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use(mcpRouter);
  return app;
}

const MASK = '••••••••';

beforeEach(() => {
  storedConnections.length = 0;
  (mcpClientRegistry.validateConnection as jest.Mock).mockReturnValue([]);
  (mcpClientRegistry.testConnection as jest.Mock).mockReset();
  (mcpClientRegistry.upsertConnection as jest.Mock).mockClear();
  (mcpClientRegistry.deleteConnection as jest.Mock).mockClear();
});

describe('MCP routes — secrets handling (#178 slice 2)', () => {
  it('GET masks env values and leaves ${VAR} refs untouched', async () => {
    storedConnections.push({
      id: 'slack',
      label: 'Slack',
      transport: 'stdio',
      command: 'npx',
      env: { SLACK_TOKEN: 'xoxb-real-secret-abc', PUBLIC_FLAG: 'on', SHELL_VAR: '${SHELL}' },
      enabled: true,
      trustLevel: 'auto',
    });

    const res = await request(buildApp()).get('/api/ai/mcp/connections');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    const conn = res.body.data[0];
    expect(conn.env.SLACK_TOKEN).toBe(MASK);
    expect(conn.env.PUBLIC_FLAG).toBe(MASK);
    // ${VAR} references are not secrets — they pass through unmasked
    // because the user explicitly chose not to persist a value here.
    expect(conn.env.SHELL_VAR).toBe('${SHELL}');
  });

  it('GET masks header values for http transport', async () => {
    storedConnections.push({
      id: 'remote',
      label: 'Remote',
      transport: 'http',
      url: 'https://example.com/mcp',
      headers: { Authorization: 'Bearer real-token', 'X-Trace': '${TRACE_ID}' },
      enabled: true,
      trustLevel: 'review',
    });

    const res = await request(buildApp()).get('/api/ai/mcp/connections');
    expect(res.body.data[0].headers.Authorization).toBe(MASK);
    expect(res.body.data[0].headers['X-Trace']).toBe('${TRACE_ID}');
  });

  it('POST preserves the stored value when the client returns the mask sentinel', async () => {
    // Pretend a previous save persisted a real token.
    storedConnections.push({
      id: 'slack',
      label: 'Slack',
      transport: 'stdio',
      command: 'npx',
      env: { SLACK_TOKEN: 'xoxb-real-secret-abc' },
      enabled: true,
      trustLevel: 'auto',
    });

    // The client fetches, sees `••••••••`, edits only the label, and
    // sends the connection back with the mask still in env.SLACK_TOKEN.
    const res = await request(buildApp())
      .post('/api/ai/mcp/connections')
      .send({
        id: 'slack',
        label: 'Slack (renamed)',
        transport: 'stdio',
        command: 'npx',
        env: { SLACK_TOKEN: MASK },
        enabled: true,
        trustLevel: 'auto',
      });

    expect(res.status).toBe(200);
    // Persisted value must be the original, not the mask.
    const stored = storedConnections.find((c) => c.id === 'slack') as Record<string, unknown>;
    expect((stored.env as Record<string, string>).SLACK_TOKEN).toBe('xoxb-real-secret-abc');
    // Response shape echoes back masked again (no leakage even in the response).
    expect(res.body.data.env.SLACK_TOKEN).toBe(MASK);
  });

  it('POST writes the new value when the client provides a real value', async () => {
    storedConnections.push({
      id: 'slack',
      label: 'Slack',
      transport: 'stdio',
      command: 'npx',
      env: { SLACK_TOKEN: 'xoxb-old' },
      enabled: true,
      trustLevel: 'auto',
    });

    await request(buildApp())
      .post('/api/ai/mcp/connections')
      .send({
        id: 'slack',
        label: 'Slack',
        transport: 'stdio',
        command: 'npx',
        env: { SLACK_TOKEN: 'xoxb-new' },
        enabled: true,
        trustLevel: 'auto',
      });

    const stored = storedConnections.find((c) => c.id === 'slack') as Record<string, unknown>;
    expect((stored.env as Record<string, string>).SLACK_TOKEN).toBe('xoxb-new');
  });

  it('POST drops masked values for new connections (no prior to preserve from)', async () => {
    await request(buildApp())
      .post('/api/ai/mcp/connections')
      .send({
        id: 'fresh',
        label: 'Fresh',
        transport: 'stdio',
        command: 'npx',
        env: { TOKEN: MASK, REAL: 'literal' },
        enabled: true,
        trustLevel: 'review',
      });

    const stored = storedConnections.find((c) => c.id === 'fresh') as Record<string, unknown>;
    // The mask had no source to preserve from, so it's dropped.
    // The literal entry round-trips intact.
    expect(stored.env).toEqual({ REAL: 'literal' });
  });

  it('POST returns 400 with validation errors and never calls upsert', async () => {
    (mcpClientRegistry.validateConnection as jest.Mock).mockReturnValue(['id must not be empty']);

    const res = await request(buildApp()).post('/api/ai/mcp/connections').send({ label: 'x' });
    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual(['id must not be empty']);
    expect(mcpClientRegistry.upsertConnection).not.toHaveBeenCalled();
  });

  it('DELETE removes a connection and returns 404 when unknown', async () => {
    storedConnections.push({ id: 'slack', label: 'Slack', transport: 'stdio', enabled: true, trustLevel: 'auto' });

    const ok = await request(buildApp()).delete('/api/ai/mcp/connections/slack');
    expect(ok.status).toBe(200);
    expect(storedConnections.find((c) => c.id === 'slack')).toBeUndefined();

    const missing = await request(buildApp()).delete('/api/ai/mcp/connections/nope');
    expect(missing.status).toBe(404);
  });

  it('POST .../test surfaces a probe success and a probe failure', async () => {
    (mcpClientRegistry.testConnection as jest.Mock)
      .mockResolvedValueOnce({ ok: true, toolCount: 3 })
      .mockResolvedValueOnce({ ok: false, error: 'connection refused' });

    const okRes = await request(buildApp()).post('/api/ai/mcp/connections/slack/test');
    expect(okRes.status).toBe(200);
    expect(okRes.body.data).toEqual({ ok: true, toolCount: 3 });

    const failRes = await request(buildApp()).post('/api/ai/mcp/connections/slack/test');
    expect(failRes.status).toBe(502);
    expect(failRes.body.data).toEqual({ ok: false, error: 'connection refused' });
  });
});
