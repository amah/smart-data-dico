/**
 * AIChatPanel × granular auto-approve policy (#59).
 *
 * Verifies that when policy.create='review' (the default), a createEntity
 * tool card stays in the `pending` state and shows the per-category
 * indicator — even when the legacy `ai-auto-approve=true` toggle is
 * present in localStorage. The migration path is: the v2 key wins.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import AIChatPanel from '../AIChatPanel';
import { server } from '../../test/setup';
import { http, HttpResponse } from 'msw';
import { AI_AUTO_APPROVE_POLICY_KEY } from '../../utils/aiAutoApprovePolicy';

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

function withMockChatStream(impl: () => Response) {
  const realFetch = window.fetch;
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : (input as Request).url || String(input);
    if (url.includes('/api/ai/chat')) return impl();
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

describe('AIChatPanel — per-category auto-approve policy (#59)', () => {
  let restoreFetch: () => void = () => {};

  beforeEach(() => {
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

  it('keeps a createEntity card in pending state when policy.create=review (default)', async () => {
    // Default policy has create=review. We persist it explicitly so the
    // test doesn't accidentally rely on the migration path.
    localStorage.setItem(
      AI_AUTO_APPROVE_POLICY_KEY,
      JSON.stringify({ read: 'auto', navigate: 'auto', create: 'review', modify: 'review', delete: 'review' }),
    );

    const { stream, push, close } = makeStream();
    restoreFetch = withMockChatStream(() => new Response(stream, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    }));

    mountPanel();

    const input = await screen.findByPlaceholderText(/Ask about your data model/);
    await waitFor(() => expect(input).not.toBeDisabled());
    await userEvent.type(input, 'create thing{Enter}');

    // Drive a complete create-tool exchange. The backend tags the event
    // with category='create'; the panel must look that up against the
    // policy and flag the card as pending.
    await act(async () => {
      push({
        type: 'tool-input-start',
        toolCallId: 'createEntity:0',
        toolName: 'createEntity',
        category: 'create',
      });
    });
    await act(async () => {
      push({
        type: 'tool-input-available',
        toolCallId: 'createEntity:0',
        toolName: 'createEntity',
        category: 'create',
        input: { entityJson: '{"name":"Foo"}' },
      });
    });
    await act(async () => {
      push({
        type: 'tool-output-available',
        toolCallId: 'createEntity:0',
        output: { success: true, message: 'Created entity Foo' },
      });
    });
    await act(async () => { close(); });

    // Card must end up in `pending` (not the auto-approved `ok` terminal
    // state) because policy.create=review.
    await waitFor(() => {
      const card = screen.getByTestId('tool-card');
      expect(card).toHaveAttribute('data-status', 'pending');
    });

    // The per-category indicator must be visible and reflect "create".
    const badge = screen.getByTestId('tool-category-badge');
    expect(badge).toHaveAttribute('data-category', 'create');
    expect(badge.textContent?.toLowerCase()).toContain('create');

    // The Approve All / Undo All bar appears when any tool is pending.
    expect(screen.getByText(/Review required/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Approve All/i })).toBeInTheDocument();
  });

  it('auto-approves a listEntities card when policy.read=auto (default)', async () => {
    localStorage.setItem(
      AI_AUTO_APPROVE_POLICY_KEY,
      JSON.stringify({ read: 'auto', navigate: 'auto', create: 'review', modify: 'review', delete: 'review' }),
    );

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
      push({
        type: 'tool-input-start',
        toolCallId: 'listEntities:0',
        toolName: 'listEntities',
        category: 'read',
      });
    });
    await act(async () => {
      push({
        type: 'tool-output-available',
        toolCallId: 'listEntities:0',
        output: { entities: [] },
      });
    });
    await act(async () => { close(); });

    // read tools auto-approve → terminal-ok state, no Review-required bar.
    await waitFor(() => {
      const card = screen.getByTestId('tool-card');
      expect(card).toHaveAttribute('data-status', 'ok');
    });
    expect(screen.queryByText(/Review required/i)).not.toBeInTheDocument();
    // Indicator still rendered (orientation), but with the muted ghost class.
    const badge = screen.getByTestId('tool-category-badge');
    expect(badge).toHaveAttribute('data-category', 'read');
  });
});
