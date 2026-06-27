/**
 * #confab-fix (Vercel path) — buildUiMessagesWithToolParts injects prior tool
 * calls as AI-SDK `output-available` tool parts so convertToModelMessages emits
 * the assistant tool-call + tool-result model messages (the model sees what it
 * actually did, instead of just its own confirmation prose).
 */
import { convertToModelMessages } from 'ai';
import { buildUiMessagesWithToolParts } from '../aiController.js';

const convo = [
  { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'create entity X' }] },
  {
    id: 'a1', role: 'assistant', parts: [{ type: 'text', text: 'Created X.' }],
    toolCalls: [
      { id: 't1', name: 'createEntity', input: { packageName: 'p', name: 'X' }, output: { success: true, summary: 'Created entity X' } },
    ],
  },
  { id: 'u2', role: 'user', parts: [{ type: 'text', text: 'create entity Y' }] },
];

describe('buildUiMessagesWithToolParts', () => {
  it('appends an output-available tool part for each completed call and drops the toolCalls field', () => {
    const out = buildUiMessagesWithToolParts(convo);
    const assistant = out[1];
    expect(assistant).not.toHaveProperty('toolCalls');
    const toolPart = assistant.parts.find((p: any) => p.type === 'tool-createEntity');
    expect(toolPart).toMatchObject({
      type: 'tool-createEntity',
      toolCallId: 't1',
      state: 'output-available',
      input: { packageName: 'p', name: 'X' },
      output: { success: true, summary: 'Created entity X' },
    });
    // text part preserved
    expect(assistant.parts.find((p: any) => p.type === 'text')?.text).toBe('Created X.');
  });

  it('leaves plain turns untouched (no tool parts, no toolCalls field)', () => {
    const out = buildUiMessagesWithToolParts(convo);
    expect(out[0]).toEqual({ id: 'u1', role: 'user', parts: [{ type: 'text', text: 'create entity X' }] });
    expect(out[2]).toEqual({ id: 'u2', role: 'user', parts: [{ type: 'text', text: 'create entity Y' }] });
  });

  it('round-trips through convertToModelMessages into a tool-call + tool-result', async () => {
    const model: any[] = await convertToModelMessages(buildUiMessagesWithToolParts(convo) as any);
    // Find the tool-call (in an assistant message) and the tool-result (in a tool message).
    const flat = model.flatMap((m: any) => Array.isArray(m.content)
      ? m.content.map((c: any) => ({ role: m.role, ...c }))
      : [{ role: m.role, type: 'text', text: m.content }]);
    const call = flat.find((c: any) => c.type === 'tool-call');
    const result = flat.find((c: any) => c.type === 'tool-result');
    expect(call).toBeTruthy();
    expect(call.toolName).toBe('createEntity');
    expect(call.toolCallId).toBe('t1');
    expect(result).toBeTruthy();
    expect(result.toolCallId).toBe('t1');
  });
});
