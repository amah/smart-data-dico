/**
 * AIChatPanel × server-side approval gate.
 *
 * The backend now blocks every gated tool (create | modify | delete) on a
 * real server-side gate keyed by `${streamId}::${toolCallId}`. The panel
 * captures `streamId` from the `start` / `stream-id` SSE event and resolves
 * each gate by dispatching the `ai.chat.approve` command (which the plugin
 * wires to `AIService.approveTool` → POST /api/ai/chat/approve):
 *
 *   - auto-approved categories POST 'approve' immediately mid-stream;
 *   - review categories hold the card `pending` with Approve (✓) / Reject (✗)
 *     controls that POST on click;
 *   - a `tool-output-available` with `denied:true` resolves the card to the
 *     rejected (`undone`) state.
 *
 * Acceptance criteria 13–16. We mock `../commands` so we can spy on the
 * `ai.chat.approve` dispatch directly (the same seam the existing policy /
 * autonomous tests use), and assert on its arguments.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import AIChatPanel from '../AIChatPanel';
import { server } from '../../../../test/setup';

// Spy we can assert on. Declared before the mock factory so vi.mock's
// hoisting still resolves it (vi.hoisted keeps it in scope).
const approveCalls = vi.hoisted(() => [] as Array<{ streamId: string; toolCallId: string; decision: string }>);

vi.mock('../../commands', () => ({
  runAiCommand: vi.fn(async (name: string, input?: any) => {
    if (name === 'ai.chat.approve') {
      approveCalls.push({ streamId: input.streamId, toolCallId: input.toolCallId, decision: input.decision });
      return undefined;
    }
    if (name === 'ai.status.get') { const r = await fetch('/api/ai/status'); return r.json(); }
    if (name === 'ai.conversation.list') {
      const q = input?.q ? `?q=${encodeURIComponent(input.q)}` : '';
      const r = await fetch(`/api/ai/conversations${q}`); const d = await r.json(); return d.data ?? [];
    }
    if (name === 'ai.conversation.get') { const r = await fetch(`/api/ai/conversations/${input?.id}`); const d = await r.json(); return d.data ?? null; }
    if (name === 'ai.conversation.save') return fetch('/api/ai/conversations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input?.conversation) });
    if (name === 'ai.conversation.patch') return fetch(`/api/ai/conversations/${input?.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input?.patch) });
    if (name === 'ai.conversation.delete') return fetch(`/api/ai/conversations/${input?.id}`, { method: 'DELETE' });
    if (name === 'ai.chat.send') return input.signal ? fetch('/api/ai/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input.request), signal: input.signal }) : fetch('/api/ai/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input.request) });
    if (name === 'ai.tools.list') { const r = await fetch('/api/ai/tools'); const d = await r.json(); return d.data ?? []; }
    if (name === 'ai.mentions.search') { const r = await fetch(`/api/ai/mentions/search?q=${encodeURIComponent(input?.q ?? '')}`); const d = await r.json(); return d.data ?? { entities: [], packages: [] }; }
    if (name === 'ai.prompt.list') { const r = await fetch('/api/ai/prompts'); const d = await r.json(); return d.data ?? []; }
    throw new Error(`Unmocked command: ${name}`);
  }),
}));
import { http, HttpResponse } from 'msw';
import { AI_AUTO_APPROVE_POLICY_KEY } from '../../utils/aiAutoApprovePolicy';

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

const REVIEW_POLICY = JSON.stringify({ read: 'auto', navigate: 'auto', create: 'review', modify: 'review', delete: 'review' });
const AUTO_POLICY = JSON.stringify({ read: 'auto', navigate: 'auto', create: 'auto', modify: 'auto', delete: 'review' });
const STREAM_ID = 'stream-abc';

async function startTurn() {
  mountPanel();
  const input = await screen.findByPlaceholderText(/Ask about your data model/);
  await waitFor(() => expect(input).not.toBeDisabled());
  await userEvent.type(input, 'do a thing{Enter}');
}

/** Push the `start` event so the panel captures the streamId for gating. */
async function pushStart(push: (e: unknown) => void) {
  await act(async () => { push({ type: 'start', streamId: STREAM_ID }); });
}

describe('AIChatPanel — server-side approval gate', () => {
  let restoreFetch: () => void = () => {};

  beforeEach(() => {
    localStorage.clear();
    approveCalls.length = 0;
    localStorage.setItem('ai-autonomous', 'false');
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

  // AC13: gated tool under policy=review renders a pending card with
  // Approve/Reject controls and does NOT auto-POST approve.
  it('holds a gated createEntity card pending under policy=review and does not auto-approve', async () => {
    localStorage.setItem(AI_AUTO_APPROVE_POLICY_KEY, REVIEW_POLICY);
    const { stream, push, close } = makeStream();
    restoreFetch = withMockChatStream(() => new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }));

    await startTurn();
    await pushStart(push);
    await act(async () => { push({ type: 'tool-input-start', toolCallId: 'createEntity:0', toolName: 'createEntity', category: 'create' }); });
    await act(async () => { push({ type: 'tool-input-available', toolCallId: 'createEntity:0', toolName: 'createEntity', category: 'create', input: { entityJson: '{"name":"Foo"}' } }); });

    await waitFor(() => {
      const card = screen.getByTestId('tool-card');
      expect(card).toHaveAttribute('data-status', 'pending');
    });
    // Per-card Approve (✓) / Reject (✗) controls are present.
    expect(screen.getByTitle('Approve this action')).toBeInTheDocument();
    expect(screen.getByTitle('Reject this action')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Approve All/i })).toBeInTheDocument();

    // Crucially: no auto-approve POST happened for a review-gated tool.
    expect(approveCalls).toHaveLength(0);

    await act(async () => { close(); });
  });

  // AC14: gated tool under policy=auto triggers an automatic approve POST.
  it('auto-POSTs approve for a gated createEntity card under policy=auto', async () => {
    localStorage.setItem(AI_AUTO_APPROVE_POLICY_KEY, AUTO_POLICY);
    const { stream, push, close } = makeStream();
    restoreFetch = withMockChatStream(() => new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }));

    await startTurn();
    await pushStart(push);
    await act(async () => { push({ type: 'tool-input-start', toolCallId: 'createEntity:0', toolName: 'createEntity', category: 'create' }); });

    await waitFor(() => expect(approveCalls).toHaveLength(1));
    expect(approveCalls[0]).toEqual({ streamId: STREAM_ID, toolCallId: 'createEntity:0', decision: 'approve' });

    await act(async () => { close(); });
  });

  it('auto-POSTs approve for a gated tool when autonomous mode is on (non-delete)', async () => {
    localStorage.setItem(AI_AUTO_APPROVE_POLICY_KEY, REVIEW_POLICY);
    localStorage.setItem('ai-autonomous', 'true');
    const { stream, push, close } = makeStream();
    restoreFetch = withMockChatStream(() => new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }));

    await startTurn();
    await pushStart(push);
    await act(async () => { push({ type: 'tool-input-start', toolCallId: 'updateEntity:0', toolName: 'updateEntity', category: 'modify' }); });

    await waitFor(() => expect(approveCalls).toHaveLength(1));
    expect(approveCalls[0]).toEqual({ streamId: STREAM_ID, toolCallId: 'updateEntity:0', decision: 'approve' });

    await act(async () => { close(); });
  });

  // AC15: clicking Approve POSTs 'approve'; clicking Reject POSTs 'deny'.
  it('clicking Approve POSTs approve', async () => {
    localStorage.setItem(AI_AUTO_APPROVE_POLICY_KEY, REVIEW_POLICY);
    const { stream, push, close } = makeStream();
    restoreFetch = withMockChatStream(() => new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }));

    await startTurn();
    await pushStart(push);
    await act(async () => { push({ type: 'tool-input-start', toolCallId: 'createEntity:0', toolName: 'createEntity', category: 'create' }); });
    await act(async () => { push({ type: 'tool-input-available', toolCallId: 'createEntity:0', toolName: 'createEntity', category: 'create', input: { entityJson: '{"name":"Foo"}' } }); });

    const approveBtn = await screen.findByTitle('Approve this action');
    expect(approveCalls).toHaveLength(0);
    await userEvent.click(approveBtn);

    await waitFor(() => expect(approveCalls).toHaveLength(1));
    expect(approveCalls[0]).toEqual({ streamId: STREAM_ID, toolCallId: 'createEntity:0', decision: 'approve' });

    await act(async () => { close(); });
  });

  it('clicking Reject POSTs deny', async () => {
    localStorage.setItem(AI_AUTO_APPROVE_POLICY_KEY, REVIEW_POLICY);
    const { stream, push, close } = makeStream();
    restoreFetch = withMockChatStream(() => new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }));

    await startTurn();
    await pushStart(push);
    await act(async () => { push({ type: 'tool-input-start', toolCallId: 'createEntity:0', toolName: 'createEntity', category: 'create' }); });
    await act(async () => { push({ type: 'tool-input-available', toolCallId: 'createEntity:0', toolName: 'createEntity', category: 'create', input: { entityJson: '{"name":"Foo"}' } }); });

    const rejectBtn = await screen.findByTitle('Reject this action');
    await userEvent.click(rejectBtn);

    await waitFor(() => expect(approveCalls).toHaveLength(1));
    expect(approveCalls[0]).toEqual({ streamId: STREAM_ID, toolCallId: 'createEntity:0', decision: 'deny' });

    await act(async () => { close(); });
  });

  // AC16: tool-output-available with denied:true renders the rejected state.
  it('renders the card in the rejected (undone) state on a denied tool-output', async () => {
    localStorage.setItem(AI_AUTO_APPROVE_POLICY_KEY, REVIEW_POLICY);
    const { stream, push, close } = makeStream();
    restoreFetch = withMockChatStream(() => new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }));

    await startTurn();
    await pushStart(push);
    await act(async () => { push({ type: 'tool-input-start', toolCallId: 'createEntity:0', toolName: 'createEntity', category: 'create' }); });
    await act(async () => { push({ type: 'tool-input-available', toolCallId: 'createEntity:0', toolName: 'createEntity', category: 'create', input: { entityJson: '{"name":"Foo"}' } }); });
    await act(async () => { push({ type: 'tool-output-available', toolCallId: 'createEntity:0', output: { success: false, denied: true, message: 'Change rejected by user.' } }); });
    await act(async () => { close(); });

    await waitFor(() => {
      const card = screen.getByTestId('tool-card');
      expect(card).toHaveAttribute('data-status', 'undone');
    });
    expect(screen.getByText('Undone')).toBeInTheDocument();
  });
});
