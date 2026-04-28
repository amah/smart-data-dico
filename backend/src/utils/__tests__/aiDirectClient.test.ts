/**
 * Tests for aiDirectClient — covers the duplicate-toolCallId regression
 * from #124. When the model calls the same tool twice in a single
 * assistant turn (e.g. listEntities() then listEntities({packageName})),
 * each invocation must surface with a distinct toolCallId so the
 * frontend doesn't collapse them onto a single card.
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
