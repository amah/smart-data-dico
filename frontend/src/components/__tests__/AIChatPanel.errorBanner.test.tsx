/**
 * Frontend half of the explicit-error work (companion to the backend
 * enrichErrorEvent helper). Confirms the SSE `error` event with
 * structured upstream fields renders a polished banner — provider
 * message, upstream-status badge, help link, 402-specific tip — instead
 * of leaving the panel mute.
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

describe('AIChatPanel — explicit error banner', () => {
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

  it('renders provider message, status badge, help link, and 402 tip when the SSE error event arrives with enriched fields', async () => {
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
    await userEvent.type(input, 'do something{Enter}');

    await act(async () => {
      push({
        type: 'error',
        errorText: 'This request requires more credits, or fewer max_tokens. To increase, visit https://openrouter.ai/settings/credits and add more credits',
        upstreamStatus: 402,
        providerMessage: 'This request requires more credits, or fewer max_tokens. To increase, visit https://openrouter.ai/settings/credits and add more credits',
        providerCode: 402,
        providerHelpUrl: 'https://openrouter.ai/settings/credits',
      });
    });
    await act(async () => { close(); });

    const banner = await screen.findByTestId('ai-error-banner');
    expect(banner).toHaveTextContent('AI request failed');
    expect(banner).toHaveTextContent(/requires more credits/i);
    expect(banner).toHaveTextContent('402');
    const helpLink = screen.getByTestId('ai-error-help-link');
    expect(helpLink).toHaveAttribute('href', 'https://openrouter.ai/settings/credits');
    expect(banner).toHaveTextContent(/top up your provider account/i);
  });

  it('falls back to the plain errorText when no provider fields are attached', async () => {
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
    await userEvent.type(input, 'go{Enter}');

    await act(async () => {
      push({ type: 'error', errorText: 'connection reset by peer' });
    });
    await act(async () => { close(); });

    const banner = await screen.findByTestId('ai-error-banner');
    expect(banner).toHaveTextContent('connection reset by peer');
    // No status badge, no help link, no 402 tip.
    expect(screen.queryByTestId('ai-error-help-link')).not.toBeInTheDocument();
    expect(banner).not.toHaveTextContent(/top up/i);
  });
});
