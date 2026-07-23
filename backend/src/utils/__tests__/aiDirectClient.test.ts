/**
 * Tests for aiDirectClient — covers the duplicate-toolCallId regression
 * from #124. When the model calls the same tool twice in a single
 * assistant turn (e.g. listEntities() then listEntities({packageName})),
 * each invocation must surface with a distinct toolCallId so the
 * frontend doesn't collapse them onto a single card.
 */
import {
  boundLiveToolResult,
  callWithTools,
  LIVE_TOOL_RESULT_MAX_CHARS,
} from '../aiDirectClient.js';

jest.mock('../logger');

type FetchMock = jest.MockedFunction<typeof fetch>;

describe('boundLiveToolResult', () => {
  it('preserves normal tool results', () => {
    const result = { entities: [{ name: 'Order' }] };
    expect(boundLiveToolResult(result)).toBe(result);
  });

  it('bounds oversized live results before they are sent back to the model', () => {
    const result = boundLiveToolResult({ payload: 'x'.repeat(LIVE_TOOL_RESULT_MAX_CHARS + 1) }) as any;
    expect(result.truncated).toBe(true);
    expect(result.originalChars).toBeGreaterThan(LIVE_TOOL_RESULT_MAX_CHARS);
    expect(result.preview.length).toBeLessThanOrEqual(LIVE_TOOL_RESULT_MAX_CHARS);
    expect(result.note).toContain('narrower');
  });
});

function jsonResponse(body: any): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function streamingResponse(): {
  response: Response;
  push: (raw: string) => void;
  close: () => void;
} {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(c) { controller = c; },
  });
  return {
    response: new Response(stream, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    }),
    push: (raw) => controller.enqueue(encoder.encode(raw)),
    close: () => controller.close(),
  };
}

describe('callWithTools — upstream text streaming', () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('forwards text deltas before the upstream response finishes and preserves split SSE records', async () => {
    const upstream = streamingResponse();
    global.fetch = jest.fn().mockResolvedValue(upstream.response) as unknown as typeof fetch;
    const events: any[] = [];

    const pending = callWithTools(
      { apiKey: 'k', baseURL: 'https://example.test/v1', model: 'm' },
      [{ role: 'user', content: 'hello' }],
      [],
      jest.fn(),
      5,
      (event) => events.push(event),
    );

    // Deliberately split the JSON payload across network chunks.
    upstream.push('data: {"choices":[{"delta":{"content":"Hel');
    await Promise.resolve();
    expect(events).toHaveLength(0);

    upstream.push('lo"}}]}\n\n');
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(events).toContainEqual({ type: 'text', delta: 'Hello' });

    upstream.push('data: {"choices":[{"delta":{"content":" world"}}]}\n\n');
    upstream.push('data: {"choices":[],"usage":{"prompt_tokens":7,"completion_tokens":2}}\n\n');
    upstream.push('data: [DONE]\n\n');
    upstream.close();

    const result = await pending;
    expect(result.text).toBe('Hello world');
    expect(result.textStreamed).toBe(true);
    expect(result.usage).toEqual({ inputTokens: 7, outputTokens: 2 });

    const request = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
    expect(request).toMatchObject({
      stream: true,
      stream_options: { include_usage: true },
    });
  });
});

describe('callWithTools — toolCallId uniqueness (#124)', () => {
  let originalFetch: typeof fetch;
  let fetchMock: FetchMock;

  beforeEach(() => {
    originalFetch = global.fetch;
    fetchMock = jest.fn() as FetchMock;
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('assigns distinct toolCallIds when the same tool is called twice in one turn (no provider ids)', async () => {
    // Turn 1: model emits two calls to listEntities with no `id` field.
    // Turn 2: model returns plain text — terminates the loop.
    fetchMock
      .mockResolvedValueOnce(jsonResponse({
        choices: [{
          message: {
            content: '',
            tool_calls: [
              { function: { name: 'listEntities', arguments: '{}' } },
              { function: { name: 'listEntities', arguments: '{"packageName":"order-service"}' } },
            ],
          },
        }],
      }))
      .mockResolvedValueOnce(jsonResponse({
        choices: [{ message: { content: 'done', tool_calls: [] } }],
      }));

    const events: any[] = [];
    const executeToolFn = jest.fn().mockResolvedValue({ ok: true });

    await callWithTools(
      { apiKey: 'k', baseURL: 'https://example.test/v1', model: 'm' },
      [{ role: 'user', content: 'list' }],
      [],
      executeToolFn,
      5,
      (e) => events.push(e),
    );

    const startEvents = events.filter((e) => e.type === 'tool-start');
    const endEvents = events.filter((e) => e.type === 'tool-end');

    expect(startEvents).toHaveLength(2);
    expect(endEvents).toHaveLength(2);

    const startIds = startEvents.map((e) => e.toolCallId);
    const endIds = endEvents.map((e) => e.toolCallId);

    // Distinct ids per invocation (the bug: both used to be `listEntities:0`).
    expect(new Set(startIds).size).toBe(2);
    expect(new Set(endIds).size).toBe(2);

    // start/end ids line up pairwise.
    expect(startIds).toEqual(endIds);

    // Both ids should namespace under the tool name.
    for (const id of startIds) {
      expect(id).toMatch(/^listEntities:\d+$/);
    }
  });

  it('aggregates usage across all upstream completions (#128)', async () => {
    // Three upstream calls:
    //  1. assistant → tool_call (consumes 100/20 tokens)
    //  2. assistant → tool_call (consumes 80/15 tokens, after seeing tool result)
    //  3. assistant → final text (consumes 60/10 tokens)
    // Sum: 240 in / 45 out — must be the returned `usage`.
    fetchMock
      .mockResolvedValueOnce(jsonResponse({
        choices: [{
          message: {
            content: '',
            tool_calls: [
              { id: 'call_1', function: { name: 'listEntities', arguments: '{}' } },
            ],
          },
        }],
        usage: { prompt_tokens: 100, completion_tokens: 20 },
      }))
      .mockResolvedValueOnce(jsonResponse({
        choices: [{
          message: {
            content: '',
            tool_calls: [
              { id: 'call_2', function: { name: 'listEntities', arguments: '{"packageName":"order-service"}' } },
            ],
          },
        }],
        usage: { prompt_tokens: 80, completion_tokens: 15 },
      }))
      .mockResolvedValueOnce(jsonResponse({
        choices: [{ message: { content: 'all done', tool_calls: [] } }],
        usage: { prompt_tokens: 60, completion_tokens: 10 },
      }));

    const result = await callWithTools(
      { apiKey: 'k', baseURL: 'https://example.test/v1', model: 'm' },
      [{ role: 'user', content: 'list everything' }],
      [],
      jest.fn().mockResolvedValue({ entities: [] }),
      5,
    );

    expect(result.usage).toEqual({ inputTokens: 240, outputTokens: 45 });
    expect(result.text).toBe('all done');
  });

  it('returns zero usage when upstream omits the usage block', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      choices: [{ message: { content: 'hi', tool_calls: [] } }],
      // No usage field — older / non-conforming providers.
    }));

    const result = await callWithTools(
      { apiKey: 'k', baseURL: 'https://example.test/v1', model: 'm' },
      [{ role: 'user', content: 'hi' }],
      [],
      jest.fn(),
      5,
    );

    expect(result.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
  });

  it('accepts both prompt_tokens/completion_tokens and input_tokens/output_tokens shapes', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({
        choices: [{ message: { content: '', tool_calls: [{ id: 'c1', function: { name: 'noop', arguments: '{}' } }] } }],
        usage: { input_tokens: 50, output_tokens: 5 },
      }))
      .mockResolvedValueOnce(jsonResponse({
        choices: [{ message: { content: 'done', tool_calls: [] } }],
        usage: { prompt_tokens: 70, completion_tokens: 8 },
      }));

    const result = await callWithTools(
      { apiKey: 'k', baseURL: 'https://example.test/v1', model: 'm' },
      [{ role: 'user', content: 'go' }],
      [],
      jest.fn().mockResolvedValue({ ok: true }),
      5,
    );

    expect(result.usage).toEqual({ inputTokens: 120, outputTokens: 13 });
  });

  it('prefers the provider-supplied tool_call id when present', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({
        choices: [{
          message: {
            content: '',
            tool_calls: [
              { id: 'call_abc', function: { name: 'listEntities', arguments: '{}' } },
              { id: 'call_xyz', function: { name: 'listEntities', arguments: '{}' } },
            ],
          },
        }],
      }))
      .mockResolvedValueOnce(jsonResponse({
        choices: [{ message: { content: 'done', tool_calls: [] } }],
      }));

    const events: any[] = [];
    await callWithTools(
      { apiKey: 'k', baseURL: 'https://example.test/v1', model: 'm' },
      [{ role: 'user', content: 'list' }],
      [],
      jest.fn().mockResolvedValue({ ok: true }),
      5,
      (e) => events.push(e),
    );

    const ids = events.filter((e) => e.type === 'tool-start').map((e) => e.toolCallId);
    expect(ids).toEqual(['call_abc', 'call_xyz']);
  });
});

describe('callWithTools — reply never precedes tool calls', () => {
  let originalFetch: typeof fetch;
  let fetchMock: FetchMock;
  beforeEach(() => { originalFetch = global.fetch; fetchMock = jest.fn() as FetchMock; global.fetch = fetchMock as unknown as typeof fetch; });
  afterEach(() => { global.fetch = originalFetch; });

  it('does not emit a text event mid-loop when a step carries both a preamble and tool calls', async () => {
    // A weak tool-caller returns a "reply"-looking preamble alongside its tool
    // call; the final reply comes only in the next, tool-less step.
    fetchMock
      .mockResolvedValueOnce(jsonResponse({
        choices: [{ message: { content: 'Sure, let me update that for you.', tool_calls: [{ id: 't1', function: { name: 'updateEntity', arguments: '{}' } }] } }],
      }))
      .mockResolvedValueOnce(jsonResponse({
        choices: [{ message: { content: 'Done — the entity was updated.', tool_calls: [] } }],
      }));

    const events: any[] = [];
    const result = await callWithTools(
      { apiKey: 'k', baseURL: 'https://example.test/v1', model: 'm' },
      [{ role: 'user', content: 'update it' }],
      [],
      jest.fn().mockResolvedValue({ ok: true }),
      5,
      (e) => events.push(e),
    );

    // The loop emits ONLY tool events — no `text` events (the controller streams
    // the final reply once, after the loop). This is what keeps the reply after
    // the tool calls rather than before them.
    expect(events.filter((e) => e.type === 'text')).toHaveLength(0);
    expect(events.filter((e) => e.type === 'tool-start')).toHaveLength(1);
    expect(events.filter((e) => e.type === 'tool-end')).toHaveLength(1);
    // The returned text is the FINAL reply, not the preamble.
    expect(result.text).toBe('Done — the entity was updated.');
  });
});
