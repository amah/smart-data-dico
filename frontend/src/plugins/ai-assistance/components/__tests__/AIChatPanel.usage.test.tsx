/**
 * AIChatPanel — token / cost meter chip tests (#128).
 *
 * The backend emits a `{ type: 'usage', inputTokens, outputTokens, cost? }`
 * SSE event before `done`; the panel aggregates it and renders a header
 * chip. Cost is only shown when the backend has pricing configured.
 *
 * The chip also restores from a saved conversation's `usage` field on
 * resume so reopening a chat preserves the running totals.
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
  const stream = new ReadableStream<Uint8Array>({
    start(c) { controller = c; },
  });
  const encoder = new TextEncoder();
  return {
    stream,
    push: (evt: unknown) => controller?.enqueue(encoder.encode(`data: ${JSON.stringify(evt)}\n\n`)),
    close: () => controller?.close(),
  };
}

function withMockChatStream(impl: (req: { url: string; init: RequestInit | undefined }) => Response | Promise<Response>) {
  const realFetch = window.fetch;
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : (input as Request).url || String(input);
    if (url.includes('/api/ai/chat')) {
      return impl({ url, init });
    }
    return realFetch(input as RequestInfo, init);
  });
  window.fetch = fetchMock as unknown as typeof window.fetch;
  return () => { window.fetch = realFetch; };
}

function mountPanel() {
  return render(
    <MemoryRouter>
      <AIChatPanel open={true} onClose={() => {}} />
    </MemoryRouter>,
  );
}

describe('AIChatPanel — usage meter (#128)', () => {
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

  it('does not render the meter chip before any usage event arrives', async () => {
    mountPanel();
    await screen.findByPlaceholderText(/Ask about your data model/);
    expect(screen.queryByTestId('ai-usage-meter')).not.toBeInTheDocument();
  });

  it('renders ~tokens in / out after a usage event arrives, and hides cost when not provided', async () => {
    const { stream, push, close } = makeStream();
    restoreFetch = withMockChatStream(() => new Response(stream, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    }));

    mountPanel();
    const input = await screen.findByPlaceholderText(/Ask about your data model/);
    await waitFor(() => expect(input).not.toBeDisabled());
    await userEvent.type(input, 'count tokens{Enter}');

    await act(async () => {
      // Emit a usage event with no cost field — simulates "pricing not configured".
      push({ type: 'usage', inputTokens: 3200, outputTokens: 1100, model: 'claude', provider: 'anthropic' });
    });
    await act(async () => { close(); });

    await waitFor(() => {
      expect(screen.getByTestId('ai-usage-meter')).toBeInTheDocument();
    });
    const meter = screen.getByTestId('ai-usage-meter');
    expect(meter.textContent).toMatch(/3\.2k\s*in/);
    expect(meter.textContent).toMatch(/1\.1k\s*out/);
    // No cost chunk should appear when the backend didn't send one.
    expect(screen.queryByTestId('ai-usage-cost')).not.toBeInTheDocument();
  });

  it('renders the cost portion when the usage event carries a cost field', async () => {
    const { stream, push, close } = makeStream();
    restoreFetch = withMockChatStream(() => new Response(stream, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    }));

    mountPanel();
    const input = await screen.findByPlaceholderText(/Ask about your data model/);
    await waitFor(() => expect(input).not.toBeDisabled());
    await userEvent.type(input, 'cost it{Enter}');

    await act(async () => {
      push({
        type: 'usage',
        inputTokens: 1000,
        outputTokens: 500,
        cost: 0.012,
        model: 'kimi',
        provider: 'openai-compatible',
      });
    });
    await act(async () => { close(); });

    await waitFor(() => {
      expect(screen.getByTestId('ai-usage-cost')).toBeInTheDocument();
    });
    expect(screen.getByTestId('ai-usage-cost').textContent).toMatch(/\$0\.012/);
  });

  it('aggregates usage across multiple turns', async () => {
    // First turn — 100/50, second turn — 200/100 → meter shows 300/150.
    let req = 0;
    const streams: Array<ReturnType<typeof makeStream>> = [];
    restoreFetch = withMockChatStream(() => {
      const s = makeStream();
      streams.push(s);
      req++;
      return new Response(s.stream, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      });
    });

    mountPanel();
    const input = await screen.findByPlaceholderText(/Ask about your data model/);
    await waitFor(() => expect(input).not.toBeDisabled());

    await userEvent.type(input, 'first{Enter}');
    await waitFor(() => expect(streams.length).toBe(1));
    await act(async () => {
      streams[0].push({ type: 'usage', inputTokens: 100, outputTokens: 50, model: 'm', provider: 'p' });
    });
    await act(async () => { streams[0].close(); });

    await waitFor(() => {
      expect(screen.getByTestId('ai-usage-meter').textContent).toMatch(/100\s*in/);
    });

    // Wait for the input to re-enable before sending the second turn.
    await waitFor(() => expect(input).not.toBeDisabled());
    await userEvent.type(input, 'second{Enter}');
    await waitFor(() => expect(streams.length).toBe(2));
    await act(async () => {
      streams[1].push({ type: 'usage', inputTokens: 200, outputTokens: 100, model: 'm', provider: 'p' });
    });
    await act(async () => { streams[1].close(); });

    await waitFor(() => {
      const text = screen.getByTestId('ai-usage-meter').textContent || '';
      expect(text).toMatch(/300\s*in/);
      expect(text).toMatch(/150\s*out/);
    });

    expect(req).toBe(2);
  });

  it('restores the meter from a saved conversation on resume', async () => {
    // Override the conversations endpoint to return a stored conversation
    // with a usage block. The panel auto-loads the most recent conversation
    // on first open if `messages.length === 0`, so the chip should appear
    // without any new chat request.
    server.use(
      http.get('/api/ai/conversations', () => HttpResponse.json({
        data: [{ id: 'conv-1', title: 't', messageCount: 2, updatedAt: new Date().toISOString() }],
      })),
      http.get('/api/ai/conversations/conv-1', () => HttpResponse.json({
        data: {
          id: 'conv-1',
          title: 't',
          messages: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          usage: { inputTokens: 5000, outputTokens: 2000, totalCost: 0.0078 },
        },
      })),
    );

    mountPanel();

    await waitFor(() => {
      expect(screen.getByTestId('ai-usage-meter')).toBeInTheDocument();
    });
    const text = screen.getByTestId('ai-usage-meter').textContent || '';
    expect(text).toMatch(/5k\s*in/);
    expect(text).toMatch(/2k\s*out/);
    expect(screen.getByTestId('ai-usage-cost').textContent).toMatch(/\$0\.0078/);
  });
});
