/**
 * #228 — tool cards render before assistant prose (chronological order) and
 * stale in-flight tools from a loaded conversation are swept to cancelled.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import AIChatPanel from '../AIChatPanel';
import { server } from '../../../../test/setup';
import { http, HttpResponse } from 'msw';

vi.mock('../../commands', () => ({
  runAiCommand: vi.fn(async (name: string, input?: any) => {
    if (name === 'ai.status.get') {
      const r = await fetch('/api/ai/status');
      return r.json();
    }
    if (name === 'ai.conversation.list') {
      const q = input?.q ? `?q=${encodeURIComponent(input.q)}` : '';
      const r = await fetch(`/api/ai/conversations${q}`);
      const d = await r.json(); return d.data ?? [];
    }
    if (name === 'ai.conversation.get') {
      const r = await fetch(`/api/ai/conversations/${input?.id}`);
      const d = await r.json(); return d.data ?? null;
    }
    if (name === 'ai.conversation.save') return fetch('/api/ai/conversations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input?.conversation) });
    if (name === 'ai.conversation.patch') return fetch(`/api/ai/conversations/${input?.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input?.patch) });
    if (name === 'ai.conversation.delete') return fetch(`/api/ai/conversations/${input?.id}`, { method: 'DELETE' });
    if (name === 'ai.chat.send') return input.signal ? fetch('/api/ai/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input.request), signal: input.signal }) : fetch('/api/ai/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input.request) });
    if (name === 'ai.tools.list') { const r = await fetch('/api/ai/tools'); const d = await r.json(); return d.data ?? []; }
    if (name === 'ai.mentions.search') { const r = await fetch(`/api/ai/mentions/search?q=${encodeURIComponent(input?.q ?? '')}`); const d = await r.json(); return d.data ?? { entities: [], packages: [] }; }
    if (name === 'ai.prompt.list') { const r = await fetch('/api/ai/prompts'); const d = await r.json(); return d.data ?? []; }
    if (name === 'ai.prompt.create') { const r = await fetch('/api/ai/prompts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) }); const d = await r.json(); return d.data; }
    if (name === 'ai.prompt.update') { const { id, ...rest } = input; const r = await fetch(`/api/ai/prompts/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(rest) }); const d = await r.json(); return d.data; }
    if (name === 'ai.prompt.delete') return fetch(`/api/ai/prompts/${input?.id}`, { method: 'DELETE' });
    throw new Error(`Unmocked command: ${name}`);
  }),
}));

if (!('scrollIntoView' in HTMLElement.prototype)) {
  HTMLElement.prototype.scrollIntoView = vi.fn();
}

describe('AIChatPanel — tool order and stale state (#228)', () => {
  const restoreFetch: () => void = () => {};

  beforeEach(() => {
    server.use(
      http.get('/api/ai/status', () => HttpResponse.json({ available: true })),
      http.get('/api/ai/conversations', () => HttpResponse.json({ data: [] })),
      http.post('/api/ai/conversations', () => HttpResponse.json({ message: 'ok' })),
    );
  });

  afterEach(() => {
    restoreFetch();
  });

  it('renders tool cards before the assistant prose bubble', async () => {
    const convoId = 'c1';
    server.use(
      http.get('/api/ai/conversations', () => HttpResponse.json({
        data: [{ id: convoId, title: 'Order test', messageCount: 1, createdAt: Date.now(), updatedAt: Date.now() }],
      })),
      http.get(`/api/ai/conversations/${convoId}`, () => HttpResponse.json({
        data: {
          id: convoId,
          title: 'Order test',
          messages: [
            { id: 'user-1', role: 'user', text: 'Create a product' },
            {
              id: 'assistant-1',
              role: 'assistant',
              text: 'Done — I created **Product** for you.',
              toolCalls: [{
                id: 'tc-1',
                name: 'createEntity',
                status: undefined,
                input: { packageName: 'eshop', name: 'Product' },
                output: { success: true, changeKind: 'created', elementType: 'entity', name: 'Product', packageName: 'eshop', summary: 'Created entity Product' },
              }],
            },
          ],
        },
      })),
    );

    render(
      <MemoryRouter>
        <AIChatPanel open={true} onClose={() => {}} />
      </MemoryRouter>,
    );

    const historyButton = await screen.findByTitle('History');
    await userEvent.click(historyButton);
    await userEvent.click(await screen.findByText('Order test'));

    const card = await screen.findByTestId('tool-card');
    const prose = await screen.findByText(/Done — I created/);
    // Card should be physically before the prose in the DOM.
    expect(prose.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_PRECEDING).toBe(Node.DOCUMENT_POSITION_PRECEDING);
  });

  it('sweeps stale in-flight tool states to cancelled when loading a conversation', async () => {
    const convoId = 'c2';
    server.use(
      http.get('/api/ai/conversations', () => HttpResponse.json({
        data: [{ id: convoId, title: 'Stale test', messageCount: 1, createdAt: Date.now(), updatedAt: Date.now() }],
      })),
      http.get(`/api/ai/conversations/${convoId}`, () => HttpResponse.json({
        data: {
          id: convoId,
          title: 'Stale test',
          messages: [
            { id: 'user-1', role: 'user', text: 'Do something' },
            {
              id: 'assistant-1',
              role: 'assistant',
              text: '',
              toolCalls: [{
                id: 'tc-2',
                name: 'createEntity',
                status: 'running',
                input: { packageName: 'eshop', name: 'Order' },
              }],
            },
          ],
        },
      })),
    );

    render(
      <MemoryRouter>
        <AIChatPanel open={true} onClose={() => {}} />
      </MemoryRouter>,
    );

    const historyButton = await screen.findByTitle('History');
    await userEvent.click(historyButton);
    await userEvent.click(await screen.findByText('Stale test'));

    const card = await screen.findByTestId('tool-card');
    await waitFor(() => {
      expect(card).toHaveAttribute('data-status', 'cancelled');
    });
  });
});
