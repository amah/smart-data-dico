/**
 * #64 — background autonomous mode.
 *
 * The toggle in the header forces every tool category except `delete`
 * to auto-approve, and the assistant bubble grows a Review / Undo all
 * footer when the autonomous run lands. While the stream is in flight
 * the bubble shows a progress indicator with the running step count.
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

describe('AIChatPanel — background autonomous mode (#64)', () => {
  let restoreFetch: () => void = () => {};

  beforeEach(() => {
    // Force the per-category default for `create` to 'review' so we can
    // observe the autonomous bypass — without it `create` defaults to
    // 'review' anyway, so the test would still work, but clearing the
    // localStorage entry keeps the precondition explicit.
    localStorage.clear();
    server.use(
      http.get('/api/ai/status', () => HttpResponse.json({ available: true })),
      http.get('/api/ai/conversations', () => HttpResponse.json({ data: [] })),
      http.post('/api/ai/conversations', () => HttpResponse.json({ message: 'ok' })),
    );
  });

  afterEach(() => {
    restoreFetch();
    localStorage.clear();
  });

  it('persists the toggle state across rerenders via localStorage', async () => {
    const user = userEvent.setup();
    const { unmount } = render(
      <MemoryRouter>
        <AIChatPanel open={true} onClose={() => {}} />
      </MemoryRouter>,
    );

    const toggle = await screen.findByTestId('ai-autonomous-toggle');
    expect(toggle).toHaveAttribute('data-active', 'false');
    await user.click(toggle);
    expect(toggle).toHaveAttribute('data-active', 'true');

    unmount();
    render(
      <MemoryRouter>
        <AIChatPanel open={true} onClose={() => {}} />
      </MemoryRouter>,
    );
    const toggle2 = await screen.findByTestId('ai-autonomous-toggle');
    expect(toggle2).toHaveAttribute('data-active', 'true');
  });

  it('bypasses the per-category review gate for create tools when autonomous is on', async () => {
    const { stream, push, close } = makeStream();
    restoreFetch = withMockChatStream(() => new Response(stream, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    }));

    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <AIChatPanel open={true} onClose={() => {}} />
      </MemoryRouter>,
    );

    const input = await screen.findByPlaceholderText(/Ask about your data model/);
    await waitFor(() => expect(input).not.toBeDisabled());
    await user.click(screen.getByTestId('ai-autonomous-toggle'));

    await user.type(input, 'create some entities{Enter}');

    await act(async () => {
      push({ type: 'tool-input-start', toolCallId: 'createEntity:0', toolName: 'createEntity', category: 'create' });
    });
    await act(async () => {
      push({ type: 'tool-input-available', toolCallId: 'createEntity:0', toolName: 'createEntity', input: { entityJson: '{"name":"X"}' }, category: 'create' });
    });
    await act(async () => {
      push({ type: 'tool-output-available', toolCallId: 'createEntity:0', output: { success: true, navigate: '/packages/p/entities/X' } });
    });
    await act(async () => { close(); });

    // No "Review required" bar — autonomous mode skipped the per-category
    // pending state for the create tool.
    await waitFor(() => {
      expect(screen.getByTestId('autonomous-summary')).toBeInTheDocument();
    });
    expect(screen.queryByText(/Review required/i)).not.toBeInTheDocument();
    expect(screen.getByTestId('autonomous-summary')).toHaveTextContent(/1 tool executed/);
    // Undo all surfaces because the createEntity output had a navigate path.
    expect(screen.getByTestId('autonomous-undo-all-btn')).toBeInTheDocument();
  });

  it('shows the in-flight progress badge while tools are still running', async () => {
    const { stream, push, close } = makeStream();
    restoreFetch = withMockChatStream(() => new Response(stream, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    }));

    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <AIChatPanel open={true} onClose={() => {}} />
      </MemoryRouter>,
    );

    const input = await screen.findByPlaceholderText(/Ask about your data model/);
    await waitFor(() => expect(input).not.toBeDisabled());
    await user.click(screen.getByTestId('ai-autonomous-toggle'));
    await user.type(input, 'go{Enter}');

    await act(async () => {
      push({ type: 'tool-input-start', toolCallId: 'createEntity:0', toolName: 'createEntity', category: 'create' });
    });

    // Progress badge surfaces while the tool is still in 'starting'.
    await waitFor(() => {
      expect(screen.getByTestId('autonomous-progress')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('autonomous-summary')).not.toBeInTheDocument();

    await act(async () => {
      push({ type: 'tool-output-available', toolCallId: 'createEntity:0', output: { success: true } });
    });
    await act(async () => { close(); });

    // Once the stream lands, the summary swaps in.
    await waitFor(() => {
      expect(screen.getByTestId('autonomous-summary')).toBeInTheDocument();
    });
  });
});
