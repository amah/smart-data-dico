/**
 * #confab-guard — no-op-warning pill visibility tests.
 *
 * When the backend emits a `no-op-warning` SSE event (the model claimed a
 * change but no create/update/delete succeeded this turn) the chat panel must
 * render a warning pill (data-testid="no-op-warning-pill"). A turn that
 * finishes normally must NOT render it.
 *
 * Mirrors AIChatPanel.stepLimit.test.tsx.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import AIChatPanel from '../AIChatPanel';
import { server } from '../../../../test/setup';
import { http, HttpResponse } from 'msw';

vi.mock('../../commands', () => ({
  runAiCommand: vi.fn(async (name: string, input?: any) => {
    if (name === 'ai.status.get') { const r = await fetch('/api/ai/status'); return r.json(); }
    if (name === 'ai.conversation.list') {
      const q = input?.q ? `?q=${encodeURIComponent(input.q)}` : '';
      const r = await fetch(`/api/ai/conversations${q}`); const d = await r.json(); return d.data ?? [];
    }
    if (name === 'ai.conversation.get') { const r = await fetch(`/api/ai/conversations/${input?.id}`); const d = await r.json(); return d.data ?? null; }
    if (name === 'ai.conversation.save') return fetch('/api/ai/conversations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input?.conversation) });
    if (name === 'ai.conversation.patch') return fetch(`/api/ai/conversations/${input?.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input?.patch) });
    if (name === 'ai.conversation.delete') return fetch(`/api/ai/conversations/${input?.id}`, { method: 'DELETE' });
    if (name === 'ai.chat.send') return input.signal ? fetch('/api/ai/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input.request), signal: input.signal }) : fetch('/api/ai/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input.request) });
    if (name === 'ai.tools.list') { const r = await fetch('/api/ai/tools'); const d = await r.json(); return d.data ?? []; }
    if (name === 'ai.mentions.search') { const r = await fetch(`/api/ai/mentions/search?q=${encodeURIComponent(input?.q ?? '')}`); const d = await r.json(); return d.data ?? { entities: [], packages: [] }; }
    if (name === 'ai.prompt.list') { const r = await fetch('/api/ai/prompts'); const d = await r.json(); return d.data ?? []; }
    throw new Error(`Unmocked command: ${name}`);
  }),
}));

if (!('scrollIntoView' in HTMLElement.prototype)) {
  HTMLElement.prototype.scrollIntoView = vi.fn();
}

function makeStream() {
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  const stream = new ReadableStream<Uint8Array>({ start(c) { controller = c; } });
  const encoder = new TextEncoder();
  return {
    stream,
    push: (evt: unknown) => controller?.enqueue(encoder.encode(`data: ${JSON.stringify(evt)}\n\n`)),
    close: () => controller?.close(),
  };
}

function withMockChatStream(impl: () => Response | Promise<Response>) {
  const realFetch = window.fetch;
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : (input as Request).url || String(input);
    if (url.includes('/api/ai/chat')) return impl();
    return realFetch(input as RequestInfo, init);
  });
  window.fetch = fetchMock as unknown as typeof window.fetch;
  return () => { window.fetch = realFetch; };
}

describe('AIChatPanel — no-op warning pill (#confab-guard)', () => {
  let restoreFetch: () => void = () => {};

  beforeEach(() => {
    server.use(
      http.get('/api/ai/status', () => HttpResponse.json({ available: true })),
      http.get('/api/ai/conversations', () => HttpResponse.json({ data: [] })),
      http.post('/api/ai/conversations', () => HttpResponse.json({ message: 'ok' })),
    );
  });

  afterEach(() => { restoreFetch(); });

  it('renders a warning pill when the backend emits no-op-warning', async () => {
    const { stream, push, close } = makeStream();
    restoreFetch = withMockChatStream(() => new Response(stream, {
      status: 200, headers: { 'Content-Type': 'text/event-stream' },
    }));

    render(<MemoryRouter><AIChatPanel open={true} onClose={() => {}} /></MemoryRouter>);
    const input = await screen.findByPlaceholderText(/Ask about your data model/);
    await waitFor(() => expect(input).not.toBeDisabled());
    await userEvent.type(input, 'create three events{Enter}');

    // Model claims success but no tool ran → backend emits no-op-warning.
    await act(async () => { push({ type: 'text-delta', delta: 'Done! Created three domain events.' }); });
    await act(async () => { push({ type: 'no-op-warning', message: 'The assistant said it made changes, but no create/update/delete actually ran this turn.' }); });
    await act(async () => { close(); });

    await waitFor(() => expect(screen.getByTestId('no-op-warning-pill')).toBeInTheDocument());
    expect(screen.getByTestId('no-op-warning-pill')).toHaveTextContent(/no create\/update\/delete/i);
    expect(screen.queryByTestId('ai-error-banner')).not.toBeInTheDocument();
  });

  it('does NOT render the warning pill on a normal turn', async () => {
    const { stream, push, close } = makeStream();
    restoreFetch = withMockChatStream(() => new Response(stream, {
      status: 200, headers: { 'Content-Type': 'text/event-stream' },
    }));

    render(<MemoryRouter><AIChatPanel open={true} onClose={() => {}} /></MemoryRouter>);
    const input = await screen.findByPlaceholderText(/Ask about your data model/);
    await waitFor(() => expect(input).not.toBeDisabled());
    await userEvent.type(input, 'what is the order entity?{Enter}');

    await act(async () => { push({ type: 'text-delta', delta: 'The Order entity has an id and total.' }); });
    await act(async () => { push({ type: 'finish', finishReason: 'stop' }); });
    await act(async () => { close(); });

    await waitFor(() => expect(screen.getByText(/The Order entity has an id and total/)).toBeInTheDocument());
    expect(screen.queryByTestId('no-op-warning-pill')).not.toBeInTheDocument();
  });
});
