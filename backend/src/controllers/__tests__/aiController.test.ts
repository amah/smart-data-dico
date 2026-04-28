/**
 * Tests for aiController — covers the three controller-side fixes from #124:
 *
 *   1. POST /api/ai/config rejects {provider:'openai-compatible'} without
 *      a model with HTTP 400 (no portable default exists).
 *   2. GET /api/ai/status reports `available:false` plus a targeted
 *      message when the saved config is openai-compatible without a model.
 *   3. POST /api/ai/chat returns 503 with the new error message
 *      (interpolated CONFIG_FILE, not the stale ~/.cfg/ai-config.json).
 */
import { Request, Response } from 'express';

// Mock the appDir module so we never touch the real ~/.dico-app/dico-app.json.
const mockConfig: { ai?: any } = {};
jest.mock('../../utils/appDir', () => ({
  CONFIG_FILE: '/tmp/test-dico-app.json',
  getConfigSection: jest.fn((section: string) => (mockConfig as any)[section]),
  setConfigSection: jest.fn((section: string, value: any) => { (mockConfig as any)[section] = value; }),
}));
jest.mock('../../utils/logger');
// Don't pull in heavy services for the controller-only paths we exercise.
jest.mock('../../services/conversationService', () => ({
  conversationService: { list: jest.fn(), get: jest.fn(), save: jest.fn(), delete: jest.fn() },
}));

import { aiSaveConfig, aiStatus, aiChat } from '../aiController.js';

function mockRes() {
  const res: Partial<Response> = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  res.setHeader = jest.fn().mockReturnValue(res);
  return res as Response;
}

beforeEach(() => {
  // Reset env vars that loadAIConfig consults.
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.AI_PROVIDER;
  delete process.env.AI_MODEL;
  delete process.env.AI_BASE_URL;
  // Reset mock config.
  for (const k of Object.keys(mockConfig)) delete (mockConfig as any)[k];
});

describe('aiSaveConfig — openai-compatible model required (#124)', () => {
  it('returns 400 when provider=openai-compatible and model is missing', async () => {
    const req = { body: { provider: 'openai-compatible', apiKey: 'sk-test', baseURL: 'https://x/v1' } } as Request;
    const res = mockRes();

    await aiSaveConfig(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    const body = (res.json as jest.Mock).mock.calls[0][0];
    expect(body.message).toMatch(/model.*required.*openai-compatible/i);
  });

  it('returns 400 when provider=openai-compatible and model is empty string', async () => {
    const req = { body: { provider: 'openai-compatible', apiKey: 'sk-test', model: '', baseURL: 'https://x/v1' } } as Request;
    const res = mockRes();

    await aiSaveConfig(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('saves config when provider=openai-compatible and model is provided', async () => {
    const req = { body: { provider: 'openai-compatible', apiKey: 'sk-test', model: 'openai/gpt-4o-mini', baseURL: 'https://x/v1' } } as Request;
    const res = mockRes();

    await aiSaveConfig(req, res);

    expect(res.status).not.toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: 'AI configuration saved' }));
    expect(mockConfig.ai).toMatchObject({ provider: 'openai-compatible', model: 'openai/gpt-4o-mini' });
  });

  it('saves config without model for anthropic (default applied)', async () => {
    const req = { body: { provider: 'anthropic', apiKey: 'sk-test' } } as Request;
    const res = mockRes();

    await aiSaveConfig(req, res);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: 'AI configuration saved' }));
    expect(mockConfig.ai?.model).toBe('claude-sonnet-4-6');
  });
});

describe('aiStatus — openai-compatible without model surfaces a targeted message (#124)', () => {
  it('reports available=false plus targeted message when config is openai-compatible without model', async () => {
    mockConfig.ai = { provider: 'openai-compatible', apiKey: 'sk-test', baseURL: 'https://x/v1' };
    const res = mockRes();

    await aiStatus({} as Request, res);

    const body = (res.json as jest.Mock).mock.calls[0][0];
    expect(body.available).toBe(false);
    expect(body.message).toMatch(/model.*required.*openai-compatible/i);
    // configPath is interpolated from appDir.CONFIG_FILE — no stale ~/.cfg path.
    expect(body.configPath).toBe('/tmp/test-dico-app.json');
    expect(body.message).not.toMatch(/\.cfg\/ai-config/);
  });

  it('reports available=true when config is complete', async () => {
    mockConfig.ai = { provider: 'anthropic', apiKey: 'sk-test', model: 'claude-sonnet-4-6' };
    const res = mockRes();

    await aiStatus({} as Request, res);

    const body = (res.json as jest.Mock).mock.calls[0][0];
    expect(body.available).toBe(true);
    expect(body.message).toBeUndefined();
  });
});

describe('aiChat — error path uses interpolated CONFIG_FILE, not stale ~/.cfg path (#124)', () => {
  it('returns 503 with error message that references CONFIG_FILE (not ~/.cfg/ai-config.json)', async () => {
    // No config, no env vars → loadAIConfig returns null.
    const req = { body: {} } as Request;
    const res = mockRes();

    await aiChat(req, res);

    expect(res.status).toHaveBeenCalledWith(503);
    const body = (res.json as jest.Mock).mock.calls[0][0];
    expect(body.message).toContain('/tmp/test-dico-app.json');
    expect(body.message).not.toMatch(/\.cfg\/ai-config/);
  });

  it('returns 503 with openai-compatible-specific message when model missing', async () => {
    mockConfig.ai = { provider: 'openai-compatible', apiKey: 'sk-test', baseURL: 'https://x/v1' };
    const req = { body: {} } as Request;
    const res = mockRes();

    await aiChat(req, res);

    expect(res.status).toHaveBeenCalledWith(503);
    const body = (res.json as jest.Mock).mock.calls[0][0];
    expect(body.message).toMatch(/model.*required.*openai-compatible/i);
  });
});
