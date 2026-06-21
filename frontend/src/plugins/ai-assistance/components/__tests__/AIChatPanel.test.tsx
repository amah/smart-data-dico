/**
 * AIChatPanel tests for #61: streaming tool progress, tool-error red badge,
 * and cancel-mid-loop. The component streams SSE from /api/ai/chat and
 * renders tool cards as events arrive — these tests drive the SSE stream
 * by hand via a ReadableStream and assert the rendered DOM transitions.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import AIChatPanel from '../AIChatPanel';
import { server } from '../../../../test/setup';
import { http, HttpResponse } from 'msw';

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
    if (name === 'ai.chat.send') return fetch('/api/ai/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input?.request), signal: input?.signal });
    if (name === 'ai.tools.list') { const r = await fetch('/api/ai/tools'); const d = await r.json(); return d.data ?? []; }
    if (name === 'ai.mentions.search') { const r = await fetch(`/api/ai/mentions/search?q=${encodeURIComponent(input?.q ?? '')}`); const d = await r.json(); return d.data ?? { entities: [], packages: [] }; }
    if (name === 'ai.prompt.list') { const r = await fetch('/api/ai/prompts'); const d = await r.json(); return d.data ?? []; }
    if (name === 'ai.prompt.create') { const r = await fetch('/api/ai/prompts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) }); const d = await r.json(); return d.data; }
    if (name === 'ai.prompt.update') { const { id, ...rest } = input; const r = await fetch(`/api/ai/prompts/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(rest) }); const d = await r.json(); return d.data; }
    if (name === 'ai.prompt.delete') return fetch(`/api/ai/prompts/${input?.id}`, { method: 'DELETE' });
    throw new Error(`Unmocked command: ${name}`);
  }),
}));


// jsdom doesn't ship scrollIntoView; AIChatPanel calls it on every
// message change.
if (!('scrollIntoView' in HTMLElement.prototype)) {
  HTMLElement.prototype.scrollIntoView = vi.fn();
}

// Lightweight SSE-stream builder: enqueue events with `push`, finish with
// `close`. Each event is a single-line `data: {...json}\n\n` chunk so the
// component's `chunk.split('\n').filter(...)` parser sees them.
function makeStream() {
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  const stream = new ReadableStream<Uint8Array>({
    start(c) { controller = c; },
  });
  const encoder = new TextEncoder();
  return {
    stream,
    push: (evt: unknown) => controller?.enqueue(encoder.encode(`data: ${JSON.stringify(evt)}\n\n`)),
    error: (e: unknown) => controller?.error(e),
    close: () => controller?.close(),
  };
}

// Drive the JSON endpoints (status / conversations) via msw, but the
// streaming /api/ai/chat needs fetch-level control so we patch fetch
// per-test.
function withMockChatStream(impl: (req: { url: string; signal: AbortSignal; init: RequestInit | undefined }) => Response | Promise<Response>) {
  const realFetch = window.fetch;
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : (input as Request).url || String(input);
    if (url.includes('/api/ai/chat')) {
      // Construct an explicit AbortSignal: real fetch passes through
      // init.signal automatically, but we need access to it for the
      // abort assertion in the cancel test.
      const signal = (init?.signal as AbortSignal) || new AbortController().signal;
      return impl({ url, signal, init });
    }
    return realFetch(input as RequestInfo, init);
  });
  window.fetch = fetchMock as unknown as typeof window.fetch;
  return () => { window.fetch = realFetch; };
}

// Standard happy-path msw handlers for the panel's bootstrap fetches.
function mountPanel() {
  return render(
    <MemoryRouter>
      <AIChatPanel open={true} onClose={() => {}} />
    </MemoryRouter>,
  );
}

describe('AIChatPanel — tool progress & error rendering (#61)', () => {
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

  it('renders a red error badge and inline error text when tool-output-available carries success: false', async () => {
    const { stream, push, close } = makeStream();
    restoreFetch = withMockChatStream(() => new Response(stream, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    }));

    mountPanel();

    // Wait for the AI status fetch to settle so the input is enabled.
    const input = await screen.findByPlaceholderText(/Ask about your data model/);
    await waitFor(() => expect(input).not.toBeDisabled());
    await userEvent.type(input, 'do the thing{Enter}');

    // Drive the SSE stream: a tool starts, gets input, then fails.
    await act(async () => {
      push({ type: 'tool-input-start', toolCallId: 'createEntity:0', toolName: 'createEntity' });
    });
    await act(async () => {
      push({ type: 'tool-input-available', toolCallId: 'createEntity:0', toolName: 'createEntity', input: { entityJson: '{"name":"X"}' } });
    });
    await act(async () => {
      push({ type: 'tool-output-available', toolCallId: 'createEntity:0', output: { success: false, error: 'Missing name or attributes' } });
    });
    await act(async () => {
      close();
    });

    // The tool card should have data-status="error", a red badge, and
    // surface the error text inline.
    await waitFor(() => {
      const card = screen.getByTestId('tool-card');
      expect(card).toHaveAttribute('data-status', 'error');
    });
    const card = screen.getByTestId('tool-card');
    expect(screen.getByTestId('tool-error-badge')).toHaveTextContent(/error/i);
    // Inline error message lives inside the card itself (assistant-text
    // fallback may also include the error string in another DOM node, so
    // we scope the query to the card).
    expect(card.textContent).toContain('Missing name or attributes');

    // "Show raw" toggle reveals the raw JSON output (also scoped to the card).
    const showRaw = screen.getByRole('button', { name: /show raw/i });
    await userEvent.click(showRaw);
    const updatedCard = screen.getByTestId('tool-card');
    expect(updatedCard.textContent).toMatch(/"success":\s*false/);
  });

  it('renders a spinner card on tool-input-start and resolves to a checkmark on tool-output-available', async () => {
    const { stream, push, close } = makeStream();
    restoreFetch = withMockChatStream(() => new Response(stream, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    }));

    mountPanel();

    const input = await screen.findByPlaceholderText(/Ask about your data model/);
    await waitFor(() => expect(input).not.toBeDisabled());
    await userEvent.type(input, 'list{Enter}');

    await act(async () => {
      push({ type: 'tool-input-start', toolCallId: 'listEntities:0', toolName: 'listEntities' });
    });

    // While running, the card shows the "Calling …" header with the tool name.
    await waitFor(() => {
      expect(screen.getByText(/Calling listEntities/)).toBeInTheDocument();
    });
    const card = screen.getByTestId('tool-card');
    expect(card).toHaveAttribute('data-status', 'starting');

    await act(async () => {
      push({ type: 'tool-output-available', toolCallId: 'listEntities:0', output: { entities: [] } });
    });

    await waitFor(() => {
      const updated = screen.getByTestId('tool-card');
      // No status (terminal "ok" branch) once output arrived.
      expect(updated.getAttribute('data-status')).toBe('ok');
    });

    await act(async () => { close(); });
  });

  it('renders a spinner card on tool-input-start and resolves to an error card on tool-output-error (#190)', async () => {
    const { stream, push, close } = makeStream();
    restoreFetch = withMockChatStream(() => new Response(stream, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    }));

    mountPanel();

    const input = await screen.findByPlaceholderText(/Ask about your data model/);
    await waitFor(() => expect(input).not.toBeDisabled());
    await userEvent.type(input, 'list{Enter}');

    await act(async () => {
      push({ type: 'tool-input-start', toolCallId: 'listEntities:0', toolName: 'listEntities' });
    });

    // While running, the card shows the "Calling …" header (spinner state).
    await waitFor(() => {
      expect(screen.getByText(/Calling listEntities/)).toBeInTheDocument();
    });
    expect(screen.getByTestId('tool-card')).toHaveAttribute('data-status', 'starting');

    // The AI SDK signals a failed tool via tool-output-error, not
    // tool-output-available.
    await act(async () => {
      push({ type: 'tool-output-error', toolCallId: 'listEntities:0', errorText: 'Boom: tool blew up' });
    });

    // The card resolves to the terminal error state: spinner gone, red ✗
    // card with the error badge and the error text surfaced inline.
    await waitFor(() => {
      const updated = screen.getByTestId('tool-card');
      expect(updated).toHaveAttribute('data-status', 'error');
    });
    expect(screen.queryByText(/Calling listEntities/)).not.toBeInTheDocument();
    const card = screen.getByTestId('tool-card');
    expect(screen.getByTestId('tool-error-badge')).toHaveTextContent(/error/i);
    expect(card.textContent).toContain('Boom: tool blew up');

    await act(async () => { close(); });
  });

  it('shows a Stop button while streaming and aborts the in-flight fetch on click', async () => {
    const { stream, close } = makeStream();
    let aborted = false;

    restoreFetch = withMockChatStream(({ signal }) => {
      // Wire the abort signal so we can assert it tripped.
      signal.addEventListener('abort', () => { aborted = true; });
      return new Response(stream, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      });
    });

    mountPanel();
    const input = await screen.findByPlaceholderText(/Ask about your data model/);
    await waitFor(() => expect(input).not.toBeDisabled());
    await userEvent.type(input, 'go{Enter}');

    // Stop button appears while loading.
    const stopBtn = await screen.findByTestId('ai-stop-button');
    expect(stopBtn).toBeInTheDocument();

    await userEvent.click(stopBtn);

    expect(aborted).toBe(true);

    // Cleanup: close the stream so no async tasks dangle.
    await act(async () => { close(); });
  });

  it('marks an in-flight tool card as cancelled when the user clicks Stop mid-stream', async () => {
    // Cancel-mid-loop must (a) stop the spinner on any running tool card and
    // (b) flag the assistant message so the saved conversation reflects the
    // cancellation rather than carrying a perpetual `running` card. (#61)
    const { stream, push, error } = makeStream();

    restoreFetch = withMockChatStream(({ signal }) => {
      // Wire the signal so a Stop click errors the underlying stream with
      // an AbortError — mirroring what real fetch+ReadableStream does. The
      // test mock owns the ReadableStream lifecycle so we have to plumb it
      // explicitly.
      signal.addEventListener('abort', () => {
        const abortErr = Object.assign(new Error('aborted'), { name: 'AbortError' });
        try { error(abortErr); } catch { /* already closed */ }
      });
      return new Response(stream, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      });
    });

    mountPanel();
    const input = await screen.findByPlaceholderText(/Ask about your data model/);
    await waitFor(() => expect(input).not.toBeDisabled());
    await userEvent.type(input, 'go{Enter}');

    // Drive a tool-input-start so a card enters the `starting` (running) state.
    await act(async () => {
      push({ type: 'tool-input-start', toolCallId: 'listEntities:0', toolName: 'listEntities' });
    });
    await waitFor(() => {
      expect(screen.getByTestId('tool-card')).toHaveAttribute('data-status', 'starting');
    });

    // User clicks Stop — fetch aborts, our catch handler sweeps in-flight
    // tools to `cancelled` and stamps the message with cancelled: true.
    const stopBtn = await screen.findByTestId('ai-stop-button');
    await userEvent.click(stopBtn);

    await waitFor(() => {
      const card = screen.getByTestId('tool-card');
      expect(card).toHaveAttribute('data-status', 'cancelled');
    });
    expect(screen.getByTestId('tool-cancelled-badge')).toBeInTheDocument();
    expect(screen.getByTestId('message-cancelled-badge')).toBeInTheDocument();
  });
});
