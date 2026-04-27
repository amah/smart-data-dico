/**
 * Tests for the abort path in aiDirectClient (#61).
 *
 * Cancel-mid-tool-loop: when the request signal aborts mid-stream,
 * the loop must stop running tool calls and surface `aborted: true`
 * back to the controller (which emits `{ type: "cancelled" }` on the
 * SSE stream).
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

describe('callWithTools — abort path (#61)', () => {
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

  it('breaks out of the tool loop when signal aborts between calls', async () => {
    // Turn 1 emits two tool calls. The first executes; we abort while it
    // runs. The second tool call must NOT execute, and the loop must
    // return aborted: true without making a second turn-2 fetch.
    const ac = new AbortController();

    fetchMock
      .mockResolvedValueOnce(jsonResponse({
        choices: [{
          message: {
            content: '',
            tool_calls: [
              { function: { name: 'listEntities', arguments: '{}' } },
              { function: { name: 'listEntities', arguments: '{}' } },
            ],
          },
        }],
      }))
      // Should NOT be reached — but stub it just in case so we can assert
      // it wasn't called.
      .mockResolvedValueOnce(jsonResponse({
        choices: [{ message: { content: 'should not happen', tool_calls: [] } }],
      }));

    const events: any[] = [];
    let executions = 0;

    const executeToolFn = jest.fn().mockImplementation(async () => {
      executions++;
      // Abort during the first tool execution.
      if (executions === 1) ac.abort();
      return { ok: true };
    });

    const result = await callWithTools(
      { apiKey: 'k', baseURL: 'https://example.test/v1', model: 'm' },
      [{ role: 'user', content: 'list' }],
      [],
      executeToolFn,
      5,
      (e) => events.push(e),
      ac.signal,
    );

    expect(result.aborted).toBe(true);
    // Only one tool executed; the second was skipped because of abort.
    expect(executeToolFn).toHaveBeenCalledTimes(1);
    // We never made the turn-2 fetch.
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // tool-end fires for the executed call only.
    const endEvents = events.filter((e) => e.type === 'tool-end');
    expect(endEvents).toHaveLength(1);
  });

  it('aborts the upstream fetch and surfaces aborted: true', async () => {
    // Simulate fetch rejecting with an AbortError because the signal
    // tripped while the request was in flight.
    const ac = new AbortController();
    const abortErr = Object.assign(new Error('aborted'), { name: 'AbortError' });

    fetchMock.mockImplementationOnce(async () => {
      ac.abort();
      throw abortErr;
    });

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
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('exits before issuing a fetch when the signal is already aborted', async () => {
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
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
