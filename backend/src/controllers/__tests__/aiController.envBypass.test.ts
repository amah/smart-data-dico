/**
 * Tests for AI config loading hardening (#125).
 *
 * loadAIConfig is module-private; we exercise it through the aiStatus handler,
 * which calls it once and exposes provider/model/baseURL on the response.
 */

jest.mock('../../utils/logger');

// Mock the appDir module so we can assert getConfigSection is NOT invoked
// when AI_CONFIG_SOURCE=env.
const getConfigSectionMock = jest.fn();
const setConfigSectionMock = jest.fn();
jest.mock('../../utils/appDir', () => ({
  __esModule: true,
  getConfigSection: (...args: any[]) => getConfigSectionMock(...args),
  setConfigSection: (...args: any[]) => setConfigSectionMock(...args),
  CONFIG_FILE: '/fake/path/dico-app.json',
}));

// Mock conversationService since aiController imports it eagerly
jest.mock('../../services/conversationService', () => ({
  conversationService: {
    list: jest.fn(),
    get: jest.fn(),
    save: jest.fn(),
    delete: jest.fn(),
  },
}));

import type { Request, Response } from 'express';

function makeRes() {
  const json = jest.fn();
  const res = { json } as unknown as Response;
  return { res, json };
}

describe('aiController.loadAIConfig — AI_CONFIG_SOURCE=env bypass (#125)', () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    jest.resetModules();
    getConfigSectionMock.mockReset();
    // Wipe relevant env vars between tests
    delete process.env.AI_CONFIG_SOURCE;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.AI_PROVIDER;
    delete process.env.AI_MODEL;
    delete process.env.AI_BASE_URL;
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('reads from on-disk config by default (legacy behavior)', async () => {
    getConfigSectionMock.mockReturnValue({
      provider: 'anthropic',
      apiKey: 'sk-from-file',
      model: 'claude-sonnet-4-6',
    });

    const { aiStatus } = await import('../aiController');
    const { res, json } = makeRes();
    await aiStatus({} as Request, res);

    expect(getConfigSectionMock).toHaveBeenCalledWith('ai');
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        available: true,
        provider: 'anthropic',
        model: 'claude-sonnet-4-6',
      }),
    );
  });

  it('skips the file entirely when AI_CONFIG_SOURCE=env (env vars present)', async () => {
    process.env.AI_CONFIG_SOURCE = 'env';
    process.env.ANTHROPIC_API_KEY = 'sk-from-env';
    process.env.AI_MODEL = 'claude-from-env';
    // The file *would* yield a config — but env-only mode must ignore it.
    getConfigSectionMock.mockReturnValue({ provider: 'openai', apiKey: 'sk-from-file', model: 'gpt-4o' });

    const { aiStatus } = await import('../aiController');
    const { res, json } = makeRes();
    await aiStatus({} as Request, res);

    // loadAIConfig must not have consulted the on-disk config — the response
    // reflects env vars (anthropic/claude-from-env), not the file (openai/gpt-4o).
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        available: true,
        provider: 'anthropic',
        model: 'claude-from-env',
      }),
    );
  });

  it('returns available=false in env-only mode when env vars are missing, even if file would have a key', async () => {
    process.env.AI_CONFIG_SOURCE = 'env';
    // Even though the file *would* yield a config, env-only mode must ignore it.
    getConfigSectionMock.mockReturnValue({ provider: 'anthropic', apiKey: 'sk-from-file', model: 'claude-x' });

    const { aiStatus } = await import('../aiController');
    const { res, json } = makeRes();
    await aiStatus({} as Request, res);

    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ available: false }),
    );
  });

  it('does not include configPath in /api/ai/status response (#125)', async () => {
    getConfigSectionMock.mockReturnValue({ provider: 'anthropic', apiKey: 'sk-test', model: 'claude-sonnet-4-6' });

    const { aiStatus } = await import('../aiController');
    const { res, json } = makeRes();
    await aiStatus({} as Request, res);

    const payload = json.mock.calls[0][0];
    expect(payload).not.toHaveProperty('configPath');
  });
});
