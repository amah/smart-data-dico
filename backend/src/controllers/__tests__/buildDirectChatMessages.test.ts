/**
 * #confab-fix — buildDirectChatMessages reconstructs the OpenAI tool-call
 * protocol from the frontend conversation so the model sees that it actually
 * called tools in prior turns (not just its own confirmation prose).
 */
import { buildDirectChatMessages } from '../aiController.js';

function userMsg(text: string) {
  return { id: 'u1', role: 'user', parts: [{ type: 'text', text }] };
}

describe('buildDirectChatMessages', () => {
  it('keeps plain user/assistant text turns as-is', () => {
    const out = buildDirectChatMessages([
      userMsg('hello'),
      { id: 'a1', role: 'assistant', parts: [{ type: 'text', text: 'hi there' }] },
    ]);
    expect(out).toEqual([
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi there' },
    ]);
  });

  it('reconstructs assistant tool_calls + a tool result per call', () => {
    const out = buildDirectChatMessages([
      userMsg('create entity X'),
      {
        id: 'a1', role: 'assistant', parts: [{ type: 'text', text: 'Created X.' }],
        toolCalls: [
          { id: 't1', name: 'createEntity', input: { packageName: 'p', name: 'X' }, output: { success: true, summary: 'Created entity X' } },
        ],
      },
      userMsg('create entity Y'),
    ]);

    expect(out).toEqual([
      { role: 'user', content: 'create entity X' },
      {
        role: 'assistant',
        content: 'Created X.',
        tool_calls: [
          { id: 't1', type: 'function', function: { name: 'createEntity', arguments: JSON.stringify({ packageName: 'p', name: 'X' }) } },
        ],
      },
      { role: 'tool', tool_call_id: 't1', content: JSON.stringify({ success: true, summary: 'Created entity X' }) },
      { role: 'user', content: 'create entity Y' },
    ]);
  });

  it('emits one tool message per call, in order', () => {
    const out = buildDirectChatMessages([
      {
        id: 'a1', role: 'assistant', parts: [{ type: 'text', text: '' }],
        toolCalls: [
          { id: 't1', name: 'createEvent', input: { name: 'A' }, output: { success: true } },
          { id: 't2', name: 'createEvent', input: { name: 'B' }, output: { success: true } },
        ],
      },
    ]);
    expect(out.map(m => m.role)).toEqual(['assistant', 'tool', 'tool']);
    expect((out[0] as any).tool_calls).toHaveLength(2);
    expect((out[1] as any).tool_call_id).toBe('t1');
    expect((out[2] as any).tool_call_id).toBe('t2');
  });

  it('skips tool calls missing an id/name/output (e.g. denied or pending)', () => {
    const out = buildDirectChatMessages([
      {
        id: 'a1', role: 'assistant', parts: [{ type: 'text', text: 'done' }],
        toolCalls: [
          { id: 't1', name: 'createRule', input: {}, output: undefined }, // pending — no output
          { name: 'createRule', input: {}, output: { success: true } },    // no id
        ],
      },
    ]);
    // No usable tool call → falls back to a plain assistant text message.
    expect(out).toEqual([{ role: 'assistant', content: 'done' }]);
  });

  it('caps oversized tool-result content', () => {
    const big = { rows: 'x'.repeat(5000) };
    const out = buildDirectChatMessages([
      { id: 'a1', role: 'assistant', parts: [{ type: 'text', text: '' }], toolCalls: [{ id: 't1', name: 'getSqlSchema', input: {}, output: big }] },
    ], 100);
    expect((out[1] as any).content.length).toBe(100);
  });
});
