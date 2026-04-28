/**
 * #63 — frontend handles the `condensed` SSE event by rendering a pill
 * above the assistant bubble so the user knows older history was
 * summarized before being sent to the model.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import AIChatPanel from '../AIChatPanel';
import { server } from '../../test/setup';
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

describe('AIChatPanel — context condensed pill (#63)', () => {
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

  it('renders a "Context condensed" pill above the assistant bubble when the backend signals condensing', async () => {
    const { stream, push, close } = makeStream();
    restoreFetch = withMockChatStream(() => new Response(stream, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    }));

    render(
      <MemoryRouter>
        <AIChatPanel open={true} onClose={() => {}} />
      </MemoryRouter>,
    );

    const input = await screen.findByPlaceholderText(/Ask about your data model/);
    await waitFor(() => expect(input).not.toBeDisabled());
    await userEvent.type(input, 'long chat{Enter}');

    await act(async () => {
      push({ type: 'condensed', condensedCount: 7, estimatedTokens: 105_000 });
    });
    await act(async () => {
      push({ type: 'text-delta', delta: 'OK, working with the summary.' });
    });
    await act(async () => { close(); });

    await waitFor(() => {
      const pill = screen.getByTestId('context-condensed-pill');
      expect(pill).toHaveTextContent(/Context condensed/i);
      expect(pill).toHaveTextContent(/7 earlier messages/);
    });
  });

  it('does not render the pill when no condensed event arrives', async () => {
    const { stream, push, close } = makeStream();
    restoreFetch = withMockChatStream(() => new Response(stream, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    }));

    render(
      <MemoryRouter>
        <AIChatPanel open={true} onClose={() => {}} />
      </MemoryRouter>,
    );

    const input = await screen.findByPlaceholderText(/Ask about your data model/);
    await waitFor(() => expect(input).not.toBeDisabled());
    await userEvent.type(input, 'short chat{Enter}');

    await act(async () => {
      push({ type: 'text-delta', delta: 'a normal reply' });
    });
    await act(async () => { close(); });

    await waitFor(() => {
      expect(screen.getByText(/a normal reply/)).toBeInTheDocument();
    });
    expect(screen.queryByTestId('context-condensed-pill')).not.toBeInTheDocument();
  });
});
