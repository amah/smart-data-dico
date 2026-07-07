import { describe, it, expect } from 'vitest';
import { conversationToMarkdown, conversationFilename, dedupeDoubledText } from '../conversationExport';
import type { Conversation } from '../../services/AIService';

const NOW = new Date('2026-07-06T17:05:00Z');

const conv: Conversation = {
  id: 'c1',
  title: 'Design the ordering model',
  createdAt: '2026-07-03T15:20:00Z',
  updatedAt: '2026-07-03T15:40:00Z',
  mode: 'designer',
  usage: { inputTokens: 15230, outputTokens: 8110, totalCost: 0.1234 },
  messages: [
    { id: 'm1', role: 'user', text: 'Create an Order aggregate with line items.', timestamp: '2026-07-03T15:20:00Z' },
    {
      id: 'm2', role: 'assistant', text: 'Created the Order entity with an OrderItem child.', timestamp: '2026-07-03T15:20:05Z',
      toolCalls: [
        { id: 't1', name: 'createEntity', input: { name: 'Order' }, output: { success: true, name: 'Order' } },
        { id: 't2', name: 'createEntity', input: { name: 'OrderItem' }, output: { success: false, error: 'duplicate' } },
      ],
    },
    { id: 'm3', role: 'assistant', text: 'stopped', cancelled: true, condensed: { count: 4 } },
  ],
};

describe('conversationToMarkdown', () => {
  const md = conversationToMarkdown(conv, NOW);

  it('emits the title + metadata table', () => {
    expect(md).toContain('# Design the ordering model');
    expect(md).toContain('| Exported | 2026-07-06 17:05 UTC |');
    expect(md).toContain('| Mode | designer |');
    expect(md).toContain('| Messages | 3 |');
    expect(md).toContain('| Usage | 15.2k in / 8.1k out (~$0.12) |');
  });

  it('renders user/assistant turns with role headers', () => {
    expect(md).toContain('### 👤 User');
    expect(md).toContain('Create an Order aggregate with line items.');
    expect(md).toContain('### 🤖 Assistant');
  });

  it('folds tools into <details> with a result summary + JSON', () => {
    expect(md).toContain('<details><summary>🔧 2 tools</summary>');
    expect(md).toContain('- **createEntity** → ✓ `Order`');   // success summary
    expect(md).toContain('- **createEntity** ✗ duplicate');    // failure summary
    expect(md).toContain('```json');
    expect(md).toContain('"name": "OrderItem"');               // full input present
    expect(md).toContain('</details>');
  });

  it('annotates condensed and cancelled turns', () => {
    expect(md).toContain('_4 earlier messages condensed._');
    expect(md).toContain('_(cancelled)_');
  });

  it('renders the passed system context as "System context (<mode>)"', () => {
    const out = conversationToMarkdown({ ...conv, mode: 'designer' }, NOW, 'You are an AI assistant for a Data Dictionary. AUTHORING_RULES: …');
    expect(out).toContain('<details><summary>⚙️ System context (designer mode)</summary>');
    expect(out).toContain('You are an AI assistant for a Data Dictionary.');
  });

  it('omits system context when none is passed — the plain download excludes it even with an override set', () => {
    const withSys: Conversation = { ...conv, systemPrompt: 'You are a data steward.' };
    expect(conversationToMarkdown(withSys, NOW)).not.toContain('System context');
    expect(md).not.toContain('System context'); // base conv, no context passed
  });

  it('handles an empty/untitled conversation without throwing', () => {
    const empty: Conversation = { id: 'x', title: '', messages: [], createdAt: '', updatedAt: '' };
    const out = conversationToMarkdown(empty, NOW);
    expect(out).toContain('# AI conversation');
    expect(out).toContain('| Messages | 0 |');
  });
});

describe('dedupeDoubledText', () => {
  const line = 'Based on the physical schema, here is a SQL query to select all active loans from the Loan table.';
  it('collapses an exact back-to-back doubling (no separator)', () => {
    expect(dedupeDoubledText(line + line)).toBe(line);
  });
  it('collapses a doubling joined by a single space or newline', () => {
    expect(dedupeDoubledText(`${line} ${line}`)).toBe(line);
    expect(dedupeDoubledText(`${line}\n\n${line}`)).toBe(line);
  });
  it('leaves non-doubled text untouched', () => {
    expect(dedupeDoubledText(line)).toBe(line);
    expect(dedupeDoubledText(`${line} And then a different follow-up sentence entirely.`)).toBe(`${line} And then a different follow-up sentence entirely.`);
  });
  it('ignores short strings and legitimate repetition that is not an exact half-split', () => {
    expect(dedupeDoubledText('hi hi')).toBe('hi hi');           // too short
    expect(dedupeDoubledText(`${line} ${line} ${line}`)).toBe(`${line} ${line} ${line}`); // tripled, not exact halves
  });
});

describe('conversationFilename', () => {
  it('prefixes ai-chat-, slugifies the title, appends the date', () => {
    expect(conversationFilename({ title: 'Design the Ordering Model!' }, NOW)).toBe('ai-chat-design-the-ordering-model-2026-07-06.md');
  });
  it('caps a long auto-title on a word boundary', () => {
    const name = conversationFilename({ title: 'Can generate an SQL that select all active loans in the servicing package?' }, NOW);
    expect(name).toBe('ai-chat-can-generate-an-sql-that-select-all-active-2026-07-06.md');
  });
  it('falls back when there is no title', () => {
    expect(conversationFilename({ title: '' }, NOW)).toBe('ai-chat-conversation-2026-07-06.md');
  });
});
