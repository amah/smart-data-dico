/**
 * #63 — context condensing helpers. Pure-fn coverage for the estimator
 * and the maybeCondense gate; the SSE-event side of the integration is
 * exercised separately at the controller level.
 */
jest.mock('../logger');

import {
  DEFAULT_CONDENSE_THRESHOLD,
  KEEP_RECENT,
  estimateMessageTokens,
  estimateTokens,
  maybeCondense,
  type RawMessage,
} from '../contextCondensing.js';

describe('estimateTokens', () => {
  it('returns 0 for an empty string', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('uses ~4 chars per token (rounded up)', () => {
    expect(estimateTokens('1234')).toBe(1);
    expect(estimateTokens('12345')).toBe(2);
    expect(estimateTokens('a'.repeat(400))).toBe(100);
  });
});

describe('estimateMessageTokens', () => {
  it('sums text parts across messages', () => {
    const msgs: RawMessage[] = [
      { role: 'user', parts: [{ type: 'text', text: 'a'.repeat(40) }] },        // 10 tokens
      { role: 'assistant', parts: [{ type: 'text', text: 'b'.repeat(80) }] },   // 20 tokens
    ];
    expect(estimateMessageTokens(msgs)).toBe(30);
  });

  it('falls back to .content for non-parts messages', () => {
    const msgs: RawMessage[] = [
      { role: 'user', content: 'a'.repeat(40) },
    ];
    expect(estimateMessageTokens(msgs)).toBe(10);
  });

  it('ignores non-text parts', () => {
    const msgs: RawMessage[] = [
      { role: 'assistant', parts: [
        { type: 'tool-call', text: 'should-be-ignored' },
        { type: 'text', text: 'a'.repeat(40) },
      ] },
    ];
    expect(estimateMessageTokens(msgs)).toBe(10);
  });
});

describe('maybeCondense', () => {
  // Stub model — only generateText calls it, and we mock generateText
  // on the AI SDK.
  const stubModel: any = { specificationVersion: 'v2', provider: 'test', modelId: 'stub' };

  // Mock 'ai' so generateText returns a fixed summary without making
  // network calls. We do this per-test via jest.doMock to keep the
  // import order safe.
  beforeEach(() => {
    jest.resetModules();
  });

  it('returns null when message size is below the threshold', async () => {
    const msgs: RawMessage[] = Array.from({ length: 10 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      parts: [{ type: 'text', text: `short message ${i}` }],
    }));
    // Below threshold by orders of magnitude.
    const result = await maybeCondense(msgs, stubModel);
    expect(result).toBeNull();
  });

  it('returns null even above threshold when there are too few messages to condense', async () => {
    // One huge message — over threshold but only 1 turn, nothing to fold.
    const msgs: RawMessage[] = [
      { role: 'user', parts: [{ type: 'text', text: 'a'.repeat(DEFAULT_CONDENSE_THRESHOLD * 5) }] },
    ];
    const result = await maybeCondense(msgs, stubModel);
    expect(result).toBeNull();
  });

  it('condenses older messages when above the threshold and produces a synthetic summary turn', async () => {
    // generateText is part of the same module; we override the export
    // before requiring contextCondensing fresh.
    jest.doMock('ai', () => ({
      ...jest.requireActual('ai'),
      generateText: jest.fn(async () => ({ text: 'fake summary content' })),
    }));
    const { maybeCondense: freshCondense, KEEP_RECENT: K } = await import('../contextCondensing.js');

    // Build enough messages to push past the default threshold. Each
    // message ~25k tokens × 5 messages = 125k tokens > 100k threshold.
    const big = 'x'.repeat(25_000 * 4);
    const msgs: RawMessage[] = Array.from({ length: K + 4 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      parts: [{ type: 'text', text: big }],
    }));

    const result = await freshCondense(msgs, stubModel as any);
    expect(result).not.toBeNull();
    if (!result) return;

    expect(result.condensedCount).toBe(msgs.length - K);
    expect(result.messages).toHaveLength(K + 1);
    // First message is the synthetic summary turn.
    expect(result.messages[0].role).toBe('user');
    const summaryText = result.messages[0].parts?.[0]?.text || '';
    expect(summaryText).toContain('Earlier conversation summary');
    expect(summaryText).toContain('fake summary content');
    // Recent messages preserved verbatim at the end.
    expect(result.messages.slice(1)).toEqual(msgs.slice(msgs.length - K));
  });

  it('respects a custom threshold when provided', async () => {
    jest.doMock('ai', () => ({
      ...jest.requireActual('ai'),
      generateText: jest.fn(async () => ({ text: 'fake' })),
    }));
    const { maybeCondense: freshCondense } = await import('../contextCondensing.js');

    const msgs: RawMessage[] = Array.from({ length: KEEP_RECENT + 4 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      parts: [{ type: 'text', text: 'a'.repeat(400) }], // 100 tokens each
    }));
    // Above 500-token custom threshold but well below the 100k default.
    const result = await freshCondense(msgs, stubModel as any, 500);
    expect(result).not.toBeNull();
  });
});
