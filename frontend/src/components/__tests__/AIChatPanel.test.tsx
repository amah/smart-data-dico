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
import { server } from '../../test/setup';
import { http, HttpResponse } from 'msw';

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
    const input = await screen.findByPlaceholderText('Ask about your data model...');
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

    const input = await screen.findByPlaceholderText('Ask about your data model...');
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
    const input = await screen.findByPlaceholderText('Ask about your data model...');
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
});
