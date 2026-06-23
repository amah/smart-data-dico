/**
 * AIChatPanel — ChangeSummaryCard (#191 §A).
 *
 * Verifies:
 *   1. A tool-output-available event whose output carries `changeKind` and
 *      `elementType` renders a structured `data-testid="ai-change-summary"`
 *      card (instead of the raw-JSON fallback) once the card is expanded.
 *   2. The summary card shows the change kind, entity name, packageName, and
 *      the summary string.
 *   3. An output WITHOUT `changeKind` / `elementType` falls back to the raw
 *      JSON `<pre>` dump and does NOT render `ai-change-summary`.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import AIChatPanel from '../AIChatPanel';
import { server } from '../../../../test/setup';
import { http, HttpResponse } from 'msw';
import { AI_AUTO_APPROVE_POLICY_KEY } from '../../utils/aiAutoApprovePolicy';

// Mock the AI command bus (same boilerplate as all other AIChatPanel tests).
vi.mock('../../commands', () => ({
  runAiCommand: vi.fn(async (name: string, input?: any) => {
    if (name === 'ai.status.get') {
      const r = await fetch('/api/ai/status'); return r.json();
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

if (!('scrollIntoView' in HTMLElement.prototype)) {
  HTMLElement.prototype.scrollIntoView = vi.fn();
}

// Build a ReadableStream that we can push SSE events into.
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

// The structured mutation output the backend now emits (#191).
const ENTITY_MUTATION_OUTPUT = {
  success: true,
  changeKind: 'created' as const,
  elementType: 'entity' as const,
  name: 'Product',
  packageName: 'product-service',
  summary: 'Created entity Product (+3 attributes, stereotype aggregate-root)',
  navigate: '/packages/product-service/entities/Product',
  highlight: 'Product',
  message: 'Created entity Product with 3 attributes',
};

describe('AIChatPanel — ChangeSummaryCard (#191)', () => {
  let restoreFetch: () => void = () => {};

  beforeEach(() => {
    // Set policy to auto-approve everything (including `create`) so the tool
    // card reaches terminal `ok` state — we're testing summary rendering, not
    // the review gate (that's covered by AIChatPanel.policy.test.tsx).
    localStorage.setItem(
      AI_AUTO_APPROVE_POLICY_KEY,
      JSON.stringify({ read: 'auto', navigate: 'auto', create: 'auto', modify: 'auto', delete: 'review' }),
    );
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

  it('renders ai-change-summary card with kind, name, packageName, summary when output has changeKind+elementType', async () => {
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

    const inputEl = await screen.findByPlaceholderText(/Ask about your data model/);
    await waitFor(() => expect(inputEl).not.toBeDisabled());
    await userEvent.type(inputEl, 'create a Product entity{Enter}');

    // Simulate the full tool call sequence.
    // `category: 'create'` mirrors what the backend emits and drives the
    // auto-approve policy check — without it shouldAutoApprove returns false.
    await act(async () => {
      push({ type: 'tool-input-start', toolCallId: 'createEntity:0', toolName: 'createEntity', category: 'create' });
    });
    await act(async () => {
      push({
        type: 'tool-input-available',
        toolCallId: 'createEntity:0',
        toolName: 'createEntity',
        category: 'create',
        input: { name: 'Product', packageName: 'product-service', attributes: [] },
      });
    });
    await act(async () => {
      push({
        type: 'tool-output-available',
        toolCallId: 'createEntity:0',
        output: ENTITY_MUTATION_OUTPUT,
      });
    });
    await act(async () => { close(); });

    // Wait for the tool card to settle in the terminal 'ok' state.
    await waitFor(() => {
      expect(screen.getByTestId('tool-card')).toHaveAttribute('data-status', 'ok');
    });

    // Expand the card by clicking the toggle button (identified by tool name text).
    const card = screen.getByTestId('tool-card');
    const toggleBtn = card.querySelector('button');
    expect(toggleBtn).not.toBeNull();
    await userEvent.click(toggleBtn!);

    // After expanding, the structured summary card must be present.
    await waitFor(() => {
      expect(screen.getByTestId('ai-change-summary')).toBeInTheDocument();
    });

    const summaryCard = screen.getByTestId('ai-change-summary');
    // Change kind
    expect(summaryCard.textContent).toContain('created');
    // Entity name
    expect(summaryCard.textContent).toContain('Product');
    // Package name
    expect(summaryCard.textContent).toContain('product-service');
    // Summary string
    expect(summaryCard.textContent).toContain('+3 attributes');
    expect(summaryCard.textContent).toContain('aggregate-root');
  });

  it('falls back to raw JSON <pre> when output has NO changeKind/elementType', async () => {
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

    const inputEl = await screen.findByPlaceholderText(/Ask about your data model/);
    await waitFor(() => expect(inputEl).not.toBeDisabled());
    await userEvent.type(inputEl, 'list entities{Enter}');

    // A non-structured output (e.g. listEntities) — no changeKind / elementType.
    const nonStructuredOutput = {
      entities: [
        { name: 'Order', packageName: 'order-service' },
        { name: 'Product', packageName: 'product-service' },
      ],
    };

    // `category: 'read'` is auto-approved by default so card goes to 'ok'.
    await act(async () => {
      push({ type: 'tool-input-start', toolCallId: 'listEntities:0', toolName: 'listEntities', category: 'read' });
    });
    await act(async () => {
      push({
        type: 'tool-output-available',
        toolCallId: 'listEntities:0',
        output: nonStructuredOutput,
      });
    });
    await act(async () => { close(); });

    await waitFor(() => {
      expect(screen.getByTestId('tool-card')).toHaveAttribute('data-status', 'ok');
    });

    // Expand the card.
    const card = screen.getByTestId('tool-card');
    const toggleBtn = card.querySelector('button');
    await userEvent.click(toggleBtn!);

    // Wait for expansion.
    await waitFor(() => {
      // The card should show the Output section (raw JSON).
      const cardText = screen.getByTestId('tool-card').textContent;
      expect(cardText).toContain('Output');
    });

    // The structured summary card must NOT be present.
    expect(screen.queryByTestId('ai-change-summary')).not.toBeInTheDocument();

    // The raw-JSON <pre> must be present within the card.
    const expandedCard = screen.getByTestId('tool-card');
    const preEl = expandedCard.querySelector('pre');
    expect(preEl).not.toBeNull();
    expect(preEl!.textContent).toContain('entities');
    expect(preEl!.textContent).toContain('Order');
  });
});
