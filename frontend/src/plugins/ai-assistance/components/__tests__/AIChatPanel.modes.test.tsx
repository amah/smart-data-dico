/**
 * #55 — chat modes (Designer / Ask / Review). The selector lives in the
 * panel header and persists per-conversation. The send path includes
 * `mode` in the body for non-default modes; Designer (default) keeps
 * the payload identical to pre-#55.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import AIChatPanel from '../AIChatPanel';
import { server } from '../../../../test/setup';

// Mock the AI command bus so these component tests don't need a full
// kernel bootstrap. Routes each runAiCommand call to a direct fetch.
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
import { http, HttpResponse } from 'msw';


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

interface CapturedRequest {
  url: string;
  body: any;
}

function withMockChatStream(captured: CapturedRequest[]) {
  const realFetch = window.fetch;
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : (input as Request).url || String(input);
    if (url.includes('/api/ai/chat')) {
      const body = init?.body ? JSON.parse(init.body as string) : {};
      captured.push({ url, body });
      const { stream, close } = makeStream();
      // Close immediately — we only care about the request body for these tests.
      close();
      return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    }
    return realFetch(input as RequestInfo, init);
  });
  window.fetch = fetchMock as unknown as typeof window.fetch;
  return () => { window.fetch = realFetch; };
}

describe('AIChatPanel — chat modes (#55)', () => {
  let restoreFetch: () => void = () => {};

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

  it('omits `mode` from the chat payload when the default Designer mode is active', async () => {
    const captured: CapturedRequest[] = [];
    restoreFetch = withMockChatStream(captured);

    render(
      <MemoryRouter>
        <AIChatPanel open={true} onClose={() => {}} />
      </MemoryRouter>,
    );

    const input = await screen.findByPlaceholderText(/Ask about your data model/);
    await waitFor(() => expect(input).not.toBeDisabled());
    await userEvent.type(input, 'hello{Enter}');

    await waitFor(() => expect(captured).toHaveLength(1));
    // Designer is the default; we deliberately leave `mode` off the
    // payload so pre-#55 backends are byte-identical.
    expect(captured[0].body.mode).toBeUndefined();
  });

  it('sends `mode: ask` when the user switches to Ask via the selector', async () => {
    const captured: CapturedRequest[] = [];
    restoreFetch = withMockChatStream(captured);

    render(
      <MemoryRouter>
        <AIChatPanel open={true} onClose={() => {}} />
      </MemoryRouter>,
    );

    const input = await screen.findByPlaceholderText(/Ask about your data model/);
    await waitFor(() => expect(input).not.toBeDisabled());

    const select = screen.getByTestId('ai-mode-select') as HTMLSelectElement;
    await userEvent.selectOptions(select, 'ask');
    expect(select.value).toBe('ask');

    await userEvent.type(input, 'how does it work{Enter}');

    await waitFor(() => expect(captured).toHaveLength(1));
    expect(captured[0].body.mode).toBe('ask');
  });

  it('restores the conversation mode when loading a saved conversation', async () => {
    server.use(
      http.get('/api/ai/conversations', () => HttpResponse.json({
        data: [{ id: 'abc', title: 'Prior chat', messageCount: 1, updatedAt: '2026-04-01T00:00:00Z' }],
      })),
      http.get('/api/ai/conversations/abc', () => HttpResponse.json({
        data: {
          id: 'abc',
          title: 'Prior chat',
          messages: [{ id: 'm1', role: 'user', text: 'hi', timestamp: '2026-04-01T00:00:00Z' }],
          createdAt: '2026-04-01T00:00:00Z',
          updatedAt: '2026-04-01T00:00:00Z',
          mode: 'review',
        },
      })),
    );

    render(
      <MemoryRouter>
        <AIChatPanel open={true} onClose={() => {}} />
      </MemoryRouter>,
    );

    // Auto-resume kicks in on first open and loads the most recent conv.
    await waitFor(() => {
      const select = screen.getByTestId('ai-mode-select') as HTMLSelectElement;
      expect(select.value).toBe('review');
    });
  });

  it('resets to Designer when starting a new conversation', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <AIChatPanel open={true} onClose={() => {}} />
      </MemoryRouter>,
    );

    await screen.findByPlaceholderText(/Ask about your data model/);
    const select = screen.getByTestId('ai-mode-select') as HTMLSelectElement;
    await user.selectOptions(select, 'ask');
    expect(select.value).toBe('ask');

    // The "+" button starts a new conversation; clicking it should
    // pull mode back to the Designer default.
    const newBtn = screen.getByTitle('New');
    await act(async () => {
      await user.click(newBtn);
    });
    expect(select.value).toBe('designer');
  });
});
