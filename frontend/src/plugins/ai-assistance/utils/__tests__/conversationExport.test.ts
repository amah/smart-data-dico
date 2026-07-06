import { describe, it, expect } from 'vitest';
import { conversationToMarkdown, conversationFilename } from '../conversationExport';
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

  it('handles an empty/untitled conversation without throwing', () => {
    const empty: Conversation = { id: 'x', title: '', messages: [], createdAt: '', updatedAt: '' };
    const out = conversationToMarkdown(empty, NOW);
    expect(out).toContain('# AI conversation');
    expect(out).toContain('| Messages | 0 |');
  });
});

describe('conversationFilename', () => {
  it('slugifies the title + date', () => {
    expect(conversationFilename({ title: 'Design the Ordering Model!' }, NOW)).toBe('design-the-ordering-model-2026-07-06.md');
  });
  it('falls back when there is no title', () => {
    expect(conversationFilename({ title: '' }, NOW)).toBe('ai-conversation-2026-07-06.md');
  });
});
