/**
 * Tests for aiController — token / cost meter SSE event (#128).
 *
 * The controller's openai-compatible (direct-client) path must:
 *   1. Emit a `{ type: 'usage', inputTokens, outputTokens, model, provider }`
 *      SSE event before `done`.
 *   2. Include `cost` on the event when `dico-app.json.ai.pricing[<model>]`
 *      is configured.
 *   3. Omit `cost` (and not crash) when pricing is not configured.
 *
 * We mock the appDir module to drive `loadAIConfig` / `loadPricing`, mock
 * the aiDirectClient so the controller's `callWithTools` invocation
 * resolves without doing real fetch, and capture SSE writes to assert
 * the emitted events.
 */
import { Request, Response } from 'express';
import { EventEmitter } from 'events';

const mockConfig: { ai?: any } = {};

jest.mock('../../utils/appDir', () => ({
  CONFIG_FILE: '/tmp/test-dico-app.json',
  getConfigSection: jest.fn((section: string) => (mockConfig as any)[section]),
  setConfigSection: jest.fn((section: string, value: any) => { (mockConfig as any)[section] = value; }),
}));
jest.mock('../../utils/logger');
jest.mock('../../services/conversationService', () => ({
  conversationService: { list: jest.fn(), get: jest.fn(), save: jest.fn(), delete: jest.fn() },
}));
// Stub out the heavy services so getServices() resolves quickly.
jest.mock('../../services/dictionaryService', () => ({ dictionaryService: {} }));
jest.mock('../../services/serviceService', () => ({ serviceService: {} }));
jest.mock('../../services/caseService', () => ({ caseService: {} }));
jest.mock('../../services/stereotypeService', () => ({ stereotypeService: {} }));

// Mock callWithTools to short-circuit the loop and return canned usage.
const callWithToolsMock = jest.fn();
jest.mock('../../utils/aiDirectClient', () => ({
  callWithTools: (...args: any[]) => callWithToolsMock(...args),
  AbortError: class extends Error {},
}));

import { aiChat } from '../aiController.js';

/**
 * Build a fake Express Request/Response that captures SSE writes.
 * The controller's `req.on('close', ...)` is exercised even though
 * we never fire it — we just need an EventEmitter that supports `on`.
 */
function makeReqRes(body: any) {
  const req = Object.assign(new EventEmitter(), { body }) as unknown as Request;

  const writes: string[] = [];
  const res = Object.assign(new EventEmitter(), {
    setHeader: jest.fn(),
    status: jest.fn().mockImplementation(function (this: any) { return this; }),
    json: jest.fn().mockImplementation(function (this: any) { return this; }),
    write: jest.fn().mockImplementation((chunk: string) => { writes.push(chunk); return true; }),
    end: jest.fn(),
  }) as unknown as Response & { write: jest.Mock };

  return { req, res, writes };
}

/**
 * Pull every `data: {...json}` event out of the captured writes,
 * skipping the trailing `[DONE]` sentinel.
 */
function parseEvents(writes: string[]): any[] {
  const events: any[] = [];
  for (const w of writes) {
    for (const line of w.split('\n')) {
      if (!line.startsWith('data: ')) continue;
      const payload = line.slice(6).trim();
      if (!payload || payload === '[DONE]') continue;
      try {
        events.push(JSON.parse(payload));
      } catch {
        // not JSON — ignore
      }
    }
  }
  return events;
}

beforeEach(() => {
  for (const k of Object.keys(mockConfig)) delete (mockConfig as any)[k];
  callWithToolsMock.mockReset();
  delete process.env.AI_CONFIG_SOURCE;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.AI_PROVIDER;
  delete process.env.AI_MODEL;
  delete process.env.AI_BASE_URL;
});

describe('aiChat (direct path) — usage SSE event (#128)', () => {
  it('emits a usage event with inputTokens / outputTokens / model / provider before done', async () => {
    mockConfig.ai = {
      provider: 'openai-compatible',
      apiKey: 'sk-test',
      model: 'moonshotai/kimi-k2.5',
      baseURL: 'https://example.test/v1',
    };

    callWithToolsMock.mockResolvedValueOnce({
      text: 'all done',
      toolCalls: [],
      usage: { inputTokens: 1234, outputTokens: 567 },
    });

    const { req, res, writes } = makeReqRes({
      messages: [{ id: '1', role: 'user', parts: [{ type: 'text', text: 'hi' }] }],
    });

    await aiChat(req, res);

    const events = parseEvents(writes);
    const usageEvt = events.find(e => e.type === 'usage');
    expect(usageEvt).toBeDefined();
    expect(usageEvt).toMatchObject({
      type: 'usage',
      inputTokens: 1234,
      outputTokens: 567,
      model: 'moonshotai/kimi-k2.5',
      provider: 'openai-compatible',
    });
    // No pricing configured → no cost field.
    expect(usageEvt).not.toHaveProperty('cost');

    // usage must come before the `done` sentinel.
    const usageIdx = events.findIndex(e => e.type === 'usage');
    const doneIdx = events.findIndex(e => e.type === 'done');
    expect(usageIdx).toBeLessThan(doneIdx);
  });

  it('includes cost on the usage event when ai.pricing[<model>] is configured', async () => {
    mockConfig.ai = {
      provider: 'openai-compatible',
      apiKey: 'sk-test',
      model: 'moonshotai/kimi-k2.5',
      baseURL: 'https://example.test/v1',
      pricing: {
        'moonshotai/kimi-k2.5': { inputPerMillion: 1, outputPerMillion: 4 },
      },
    };

    callWithToolsMock.mockResolvedValueOnce({
      text: 'done',
      toolCalls: [],
      usage: { inputTokens: 1_000_000, outputTokens: 500_000 },
    });

    const { req, res, writes } = makeReqRes({
      messages: [{ id: '1', role: 'user', parts: [{ type: 'text', text: 'go' }] }],
    });

    await aiChat(req, res);

    const events = parseEvents(writes);
    const usageEvt = events.find(e => e.type === 'usage');
    expect(usageEvt).toBeDefined();
    // 1M tokens @ $1/M = $1; 0.5M tokens @ $4/M = $2; total = $3.
    expect(usageEvt.cost).toBeCloseTo(3, 6);
  });

  it('does not emit a usage event when upstream usage is zero (no provider data)', async () => {
    mockConfig.ai = {
      provider: 'openai-compatible',
      apiKey: 'sk-test',
      model: 'm',
      baseURL: 'https://example.test/v1',
    };

    callWithToolsMock.mockResolvedValueOnce({
      text: 'ok',
      toolCalls: [],
      usage: { inputTokens: 0, outputTokens: 0 },
    });

    const { req, res, writes } = makeReqRes({
      messages: [{ id: '1', role: 'user', parts: [{ type: 'text', text: 'hi' }] }],
    });

    await aiChat(req, res);

    const events = parseEvents(writes);
    expect(events.find(e => e.type === 'usage')).toBeUndefined();
  });
});
