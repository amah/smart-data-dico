/**
 * #mermaid — a ```mermaid fenced block in an assistant message renders as a
 * diagram (data-testid="mermaid-diagram"), and a generateMermaid tool result
 * with no model prose is synthesised into a diagram too. mermaid itself is
 * mocked so jsdom doesn't need a real SVG renderer.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import AIChatPanel from '../AIChatPanel';
import { server } from '../../../../test/setup';
import { http, HttpResponse } from 'msw';

vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn(async (_id: string) => ({ svg: '<svg data-testid="fake-svg"></svg>' })),
  },
}));

vi.mock('../../commands', () => ({
  runAiCommand: vi.fn(async (name: string, input?: any) => {
    if (name === 'ai.status.get') { const r = await fetch('/api/ai/status'); return r.json(); }
    if (name === 'ai.conversation.list') { const r = await fetch('/api/ai/conversations'); const d = await r.json(); return d.data ?? []; }
    if (name === 'ai.conversation.get') { const r = await fetch(`/api/ai/conversations/${input?.id}`); const d = await r.json(); return d.data ?? null; }
    if (name === 'ai.conversation.save') return fetch('/api/ai/conversations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input?.conversation) });
    if (name === 'ai.conversation.patch') return fetch(`/api/ai/conversations/${input?.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input?.patch) });
    if (name === 'ai.chat.send') return input.signal ? fetch('/api/ai/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input.request), signal: input.signal }) : fetch('/api/ai/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input.request) });
    if (name === 'ai.tools.list') { const r = await fetch('/api/ai/tools'); const d = await r.json(); return d.data ?? []; }
    if (name === 'ai.mentions.search') return { entities: [], packages: [] };
    if (name === 'ai.prompt.list') return [];
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

describe('AIChatPanel — Mermaid rendering (#mermaid)', () => {
  let restoreFetch: () => void = () => {};

  beforeEach(() => {
    server.use(
      http.get('/api/ai/status', () => HttpResponse.json({ available: true })),
      http.get('/api/ai/conversations', () => HttpResponse.json({ data: [] })),
      http.post('/api/ai/conversations', () => HttpResponse.json({ message: 'ok' })),
    );
  });
  afterEach(() => { restoreFetch(); });

  it('renders a ```mermaid block in assistant text as a diagram', async () => {
    const { stream, push, close } = makeStream();
    restoreFetch = withMockChatStream(() => new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }));

    render(<MemoryRouter><AIChatPanel open={true} onClose={() => {}} /></MemoryRouter>);
    const input = await screen.findByPlaceholderText(/Ask about your data model/);
    await waitFor(() => expect(input).not.toBeDisabled());
    await userEvent.type(input, 'diagram it{Enter}');

    await act(async () => {
      push({ type: 'text-delta', delta: 'Here is the ERD:\n\n```mermaid\nerDiagram\n  Product { uuid id PK }\n```\n' });
    });
    await act(async () => { push({ type: 'finish', finishReason: 'stop' }); });
    await act(async () => { close(); });

    await waitFor(() => expect(screen.getByTestId('mermaid-diagram')).toBeInTheDocument());
  });

  it('synthesises a diagram from a generateMermaid tool result with no prose', async () => {
    const { stream, push, close } = makeStream();
    restoreFetch = withMockChatStream(() => new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }));

    render(<MemoryRouter><AIChatPanel open={true} onClose={() => {}} /></MemoryRouter>);
    const input = await screen.findByPlaceholderText(/Ask about your data model/);
    await waitFor(() => expect(input).not.toBeDisabled());
    await userEvent.type(input, 'erd{Enter}');

    // Tool call + result, but the model emits NO prose text this turn.
    await act(async () => {
      push({ type: 'tool-input-start', toolCallId: 'tc1', toolName: 'generateMermaid', category: 'read' });
      push({ type: 'tool-output-available', toolCallId: 'tc1', output: { mermaid: 'erDiagram\n  Order { uuid id PK }', diagram: 'er', scope: 'all packages' } });
    });
    await act(async () => { push({ type: 'finish', finishReason: 'stop' }); });
    await act(async () => { close(); });

    await waitFor(() => expect(screen.getByTestId('mermaid-diagram')).toBeInTheDocument());
  });
});
