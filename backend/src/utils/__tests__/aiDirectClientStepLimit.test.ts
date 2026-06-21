/**
 * Tests for the step-limit detection in aiDirectClient (#192).
 *
 * When the agentic tool-call loop exhausts its maxSteps budget without
 * the model naturally finishing (i.e. returning a message with no
 * tool_calls), callWithTools must:
 *   - return stoppedAtStepLimit === true
 *   - make one final tool-less summary call whose text becomes `text`
 *   - include no `tools` field in that final summary call's body
 *
 * A natural finish (model returns plain content with no tool_calls) must
 * return stoppedAtStepLimit === false, and an abort must also return false.
 */
import { callWithTools } from '../aiDirectClient.js';

jest.mock('../logger');

type FetchMock = jest.MockedFunction<typeof fetch>;

function jsonResponse(body: any): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** A response that always asks to call another tool — keeps the loop going. */
function toolCallResponse(toolName = 'listEntities'): Response {
  return jsonResponse({
    choices: [{
      message: {
        content: '',
        tool_calls: [
          { id: `call_${Math.random().toString(36).slice(2)}`, function: { name: toolName, arguments: '{}' } },
        ],
      },
    }],
    usage: { prompt_tokens: 10, completion_tokens: 2 },
  });
}

/** A response that finishes naturally — no tool_calls. */
function naturalFinishResponse(text = 'All done.'): Response {
  return jsonResponse({
    choices: [{ message: { content: text, tool_calls: [] } }],
    usage: { prompt_tokens: 5, completion_tokens: 3 },
  });
}

describe('callWithTools — step-limit detection (#192)', () => {
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

  // -----------------------------------------------------------------------
  // Exhaustion case
  // -----------------------------------------------------------------------

  it('returns stoppedAtStepLimit === true when the loop uses all maxSteps', async () => {
    // maxSteps = 2: both steps return tool calls, exhausting the budget.
    // The (2+1)th fetch is the summary call — return plain text.
    fetchMock
      .mockResolvedValueOnce(toolCallResponse()) // step 0
      .mockResolvedValueOnce(toolCallResponse()) // step 1
      .mockResolvedValueOnce(naturalFinishResponse('Here is a summary of what I did.')); // summary

    const result = await callWithTools(
      { apiKey: 'k', baseURL: 'https://example.test/v1', model: 'm' },
      [{ role: 'user', content: 'do lots of things' }],
      [],
      jest.fn().mockResolvedValue({ ok: true }),
      2, // maxSteps
    );

    expect(result.stoppedAtStepLimit).toBe(true);
  });

  it('makes a final tool-less summary call when step limit is hit', async () => {
    const summaryText = 'I changed A, B. Remaining: C, D.';
    fetchMock
      .mockResolvedValueOnce(toolCallResponse()) // step 0
      .mockResolvedValueOnce(toolCallResponse()) // step 1
      .mockResolvedValueOnce(naturalFinishResponse(summaryText)); // summary

    await callWithTools(
      { apiKey: 'k', baseURL: 'https://example.test/v1', model: 'm' },
      [{ role: 'user', content: 'do things' }],
      [],
      jest.fn().mockResolvedValue({ ok: true }),
      2,
    );

    // Third fetch call is the summary turn.
    expect(fetchMock).toHaveBeenCalledTimes(3);

    // Parse the body of the last (summary) call.
    const lastCallBody = JSON.parse(
      (fetchMock.mock.calls[2][1] as RequestInit).body as string,
    );

    // The summary call must NOT include a `tools` field (tool-less).
    expect(lastCallBody.tools).toBeUndefined();
  });

  it("returns the summary turn's text as the result text", async () => {
    const summaryText = 'Summary: created Entity1. Remaining: add relationships.';
    fetchMock
      .mockResolvedValueOnce(toolCallResponse())
      .mockResolvedValueOnce(toolCallResponse())
      .mockResolvedValueOnce(naturalFinishResponse(summaryText));

    const result = await callWithTools(
      { apiKey: 'k', baseURL: 'https://example.test/v1', model: 'm' },
      [{ role: 'user', content: 'work' }],
      [],
      jest.fn().mockResolvedValue({ ok: true }),
      2,
    );

    expect(result.text).toBe(summaryText);
  });

  it('still returns toolCalls accumulated from the loop steps', async () => {
    fetchMock
      .mockResolvedValueOnce(toolCallResponse('listEntities'))
      .mockResolvedValueOnce(toolCallResponse('listPackages'))
      .mockResolvedValueOnce(naturalFinishResponse('done'));

    const result = await callWithTools(
      { apiKey: 'k', baseURL: 'https://example.test/v1', model: 'm' },
      [{ role: 'user', content: 'go' }],
      [],
      jest.fn().mockResolvedValue({ entities: [] }),
      2,
    );

    expect(result.toolCalls).toHaveLength(2);
    expect(result.stoppedAtStepLimit).toBe(true);
  });

  it('does NOT also push the summary text through onEvent (no double-emit) (#192 review)', async () => {
    // Regression guard: the summary is returned in `result.text` and the
    // controller streams it once. Emitting it via onEvent here too would
    // duplicate it in the chat bubble. The loop's tool-call steps have empty
    // content, so the ONLY possible `text` event would be the summary.
    const summaryText = 'I changed A. Remaining: B.';
    fetchMock
      .mockResolvedValueOnce(toolCallResponse())
      .mockResolvedValueOnce(toolCallResponse())
      .mockResolvedValueOnce(naturalFinishResponse(summaryText));

    const onEvent = jest.fn();
    const result = await callWithTools(
      { apiKey: 'k', baseURL: 'https://example.test/v1', model: 'm' },
      [{ role: 'user', content: 'work' }],
      [],
      jest.fn().mockResolvedValue({ ok: true }),
      2,
      onEvent,
    );

    // Summary is carried by the return value...
    expect(result.text).toBe(summaryText);
    // ...but never streamed through onEvent (which the controller would
    // re-stream, duplicating the bubble).
    const textEvents = onEvent.mock.calls
      .map((c) => c[0])
      .filter((e: any) => e?.type === 'text');
    expect(textEvents.some((e: any) => e.text === summaryText)).toBe(false);
  });

  // -----------------------------------------------------------------------
  // Natural-finish case
  // -----------------------------------------------------------------------

  it('returns stoppedAtStepLimit === false on natural finish', async () => {
    // Model finishes on the first step without any tool calls.
    fetchMock.mockResolvedValueOnce(naturalFinishResponse('I answered directly.'));

    const result = await callWithTools(
      { apiKey: 'k', baseURL: 'https://example.test/v1', model: 'm' },
      [{ role: 'user', content: 'what is 2+2?' }],
      [],
      jest.fn(),
      10,
    );

    expect(result.stoppedAtStepLimit).toBe(false);
    expect(result.text).toBe('I answered directly.');
    // Only one fetch — no summary call.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns stoppedAtStepLimit === false when tool loop finishes within budget', async () => {
    // One tool-call step, then natural finish — still under the budget.
    fetchMock
      .mockResolvedValueOnce(toolCallResponse())
      .mockResolvedValueOnce(naturalFinishResponse('Done within budget.'));

    const result = await callWithTools(
      { apiKey: 'k', baseURL: 'https://example.test/v1', model: 'm' },
      [{ role: 'user', content: 'go' }],
      [],
      jest.fn().mockResolvedValue({ ok: true }),
      5, // budget is 5, only used 2
    );

    expect(result.stoppedAtStepLimit).toBe(false);
    // No extra summary fetch — only the 2 loop-step calls.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  // -----------------------------------------------------------------------
  // Abort case
  // -----------------------------------------------------------------------

  it('returns stoppedAtStepLimit === false when aborted before first fetch', async () => {
    const ac = new AbortController();
    ac.abort();

    const result = await callWithTools(
      { apiKey: 'k', baseURL: 'https://example.test/v1', model: 'm' },
      [{ role: 'user', content: 'list' }],
      [],
      jest.fn(),
      5,
      undefined,
      ac.signal,
    );

    expect(result.aborted).toBe(true);
    expect(result.stoppedAtStepLimit).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns stoppedAtStepLimit === false when aborted mid-loop', async () => {
    const ac = new AbortController();
    fetchMock
      .mockResolvedValueOnce(toolCallResponse())
      // The abort fires before the second call.
      .mockImplementationOnce(async () => {
        ac.abort();
        throw Object.assign(new Error('aborted'), { name: 'AbortError' });
      });

    const result = await callWithTools(
      { apiKey: 'k', baseURL: 'https://example.test/v1', model: 'm' },
      [{ role: 'user', content: 'go' }],
      [],
      jest.fn().mockResolvedValue({ ok: true }),
      5,
      undefined,
      ac.signal,
    );

    expect(result.aborted).toBe(true);
    expect(result.stoppedAtStepLimit).toBe(false);
  });
});
