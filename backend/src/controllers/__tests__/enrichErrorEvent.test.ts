/**
 * #150 follow-up: enrichErrorEvent — pull human-readable provider
 * fields out of upstream error envelopes so the chat panel can render
 * a polished card instead of `API error 402: {raw blob}`.
 */
jest.mock('../../utils/logger');
jest.mock('../../utils/appDir', () => ({
  CONFIG_FILE: '/tmp/test-dico-app.json',
  getConfigSection: jest.fn(),
  setConfigSection: jest.fn(),
}));
jest.mock('../../services/conversationService', () => ({
  conversationService: { list: jest.fn(), get: jest.fn(), save: jest.fn() },
}));

import { enrichErrorEvent } from '../aiController.js';

describe('enrichErrorEvent', () => {
  it('passes a plain-text error through unchanged', () => {
    const out = enrichErrorEvent({ type: 'error', errorText: 'connection reset' });
    expect(out.errorText).toBe('connection reset');
    expect(out.providerMessage).toBeUndefined();
    expect(out.upstreamStatus).toBeUndefined();
  });

  it('extracts provider message + status from "API error <n>: {json}"', () => {
    const blob = JSON.stringify({
      error: {
        message: 'This request requires more credits, or fewer max_tokens. To increase, visit https://openrouter.ai/settings/credits and add more credits',
        code: 402,
      },
    });
    const out = enrichErrorEvent({ type: 'error', errorText: `API error 402: ${blob}` });
    expect(out.upstreamStatus).toBe(402);
    expect(out.providerMessage).toContain('requires more credits');
    expect(out.providerCode).toBe(402);
    expect(out.providerHelpUrl).toBe('https://openrouter.ai/settings/credits');
    // Top-level errorText is rewritten to the human message so older
    // clients that only read errorText still see something useful.
    expect(out.errorText).toContain('requires more credits');
  });

  it('extracts fields from the new "Upstream provider returned <n>" wrapper', () => {
    const blob = JSON.stringify({ error: { message: 'rate limit exceeded', code: 'rate_limit' } });
    const out = enrichErrorEvent({ type: 'error', errorText: `Upstream provider returned 429: ${blob}` });
    expect(out.upstreamStatus).toBe(429);
    expect(out.providerCode).toBe('rate_limit');
    expect(out.providerMessage).toBe('rate limit exceeded');
  });

  it('handles a bare JSON body with no wrapper prefix', () => {
    const blob = JSON.stringify({ error: { message: 'invalid api key', code: 'invalid_key' } });
    const out = enrichErrorEvent({ type: 'error', errorText: blob });
    expect(out.providerMessage).toBe('invalid api key');
    expect(out.providerCode).toBe('invalid_key');
    expect(out.upstreamStatus).toBeUndefined(); // no wrapper means no status
  });

  it('preserves providerRaw so power users can still inspect the body', () => {
    const blob = JSON.stringify({ error: { message: 'something' } });
    const out = enrichErrorEvent({ type: 'error', errorText: `API error 500: ${blob}` });
    expect(out.providerRaw).toBe(blob);
  });

  it('does not invent a help URL when none is in the message', () => {
    const blob = JSON.stringify({ error: { message: 'no link here' } });
    const out = enrichErrorEvent({ type: 'error', errorText: blob });
    expect(out.providerHelpUrl).toBeUndefined();
  });
});
