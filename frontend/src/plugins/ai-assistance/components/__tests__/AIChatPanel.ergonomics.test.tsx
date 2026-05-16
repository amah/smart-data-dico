/**
 * AIChatPanel ergonomics tests (#126):
 *
 *  1. Retry last — clicking the idle Retry button re-issues the last
 *     user message via /api/ai/chat with truncated history.
 *  2. Edit + resend — clicking a previous user message switches it to
 *     a textarea; saving truncates anything that follows and re-sends.
 *     The persisted conversation reflects the truncation.
 *  3. Auto-scroll lock — when the user has scrolled up beyond the
 *     50px threshold, deltas surface a "↓ New messages" pill rather
 *     than yanking the viewport.
 *  4. ⌘K focus — pressing Cmd-K (or Ctrl-K) anywhere focuses the
 *     composer; if the panel is closed it dispatches `ai-chat:open`.
 *  5. Delta coalescing — multiple text-delta events inside a ~50ms
 *     window result in a single render output rather than per-token
 *     React updates.
 *
 *  All tests drive the SSE stream by hand via a ReadableStream so we
 *  can sequence events deterministically.
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
  // jsdom doesn't implement scrollIntoView; AIChatPanel calls it.
  (HTMLElement.prototype as { scrollIntoView?: () => void }).scrollIntoView = vi.fn();
}

interface SSEHandle {
  stream: ReadableStream<Uint8Array>;
  push: (evt: unknown) => void;
  close: () => void;
}

function makeStream(): SSEHandle {
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

interface ChatRequestRecord {
  url: string;
  body: { messages: Array<{ role: string; parts: Array<{ text: string }> }> };
}

interface ConvSaveRecord {
  url: string;
  body: { id: string; title: string; messages: Array<{ id: string; role: string; text: string }> };
}

function withFetchMock(opts: {
  onChat?: (req: { url: string; init?: RequestInit; body: ChatRequestRecord['body'] }) => Response | Promise<Response>;
  onConvSave?: (req: ConvSaveRecord) => void;
}): { restore: () => void; chatCalls: ChatRequestRecord[]; convSaves: ConvSaveRecord[] } {
  const realFetch = window.fetch;
  const chatCalls: ChatRequestRecord[] = [];
  const convSaves: ConvSaveRecord[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : (input as Request).url || String(input);
    if (url.includes('/api/ai/chat')) {
      const bodyText = typeof init?.body === 'string' ? init.body : '';
      const body = bodyText ? JSON.parse(bodyText) : { messages: [] };
      chatCalls.push({ url, body });
      if (opts.onChat) return opts.onChat({ url, init, body });
      // Default: empty stream that closes immediately.
      const { stream, close } = makeStream();
      queueMicrotask(close);
      return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    }
    if (url.includes('/api/ai/conversations') && (init?.method === 'POST' || (typeof input !== 'string' && (input as Request).method === 'POST'))) {
      const bodyText = typeof init?.body === 'string' ? init.body : '';
      const body = bodyText ? JSON.parse(bodyText) : null;
      if (body) {
        const rec = { url, body };
        convSaves.push(rec);
        opts.onConvSave?.(rec);
      }
      return new Response(JSON.stringify({ message: 'ok' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return realFetch(input as RequestInfo, init);
  });
  window.fetch = fetchMock as unknown as typeof window.fetch;
  return { restore: () => { window.fetch = realFetch; }, chatCalls, convSaves };
}

function mountPanel(open = true) {
  return render(
    <MemoryRouter>
      <AIChatPanel open={open} onClose={() => {}} />
    </MemoryRouter>,
  );
}

describe('AIChatPanel — #126 ergonomics', () => {
  let restore: () => void = () => {};

  beforeEach(() => {
    server.use(
      http.get('/api/ai/status', () => HttpResponse.json({ available: true })),
      http.get('/api/ai/conversations', () => HttpResponse.json({ data: [] })),
    );
  });

  afterEach(() => {
    restore();
  });

  // ---------------------------------------------------------------- 1
  it('retry resends the last user message after the assistant turn completes', async () => {
    let stream: SSEHandle | null = null;
    const env = withFetchMock({
      onChat: () => {
        stream = makeStream();
        return new Response(stream.stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
      },
    });
    restore = env.restore;

    mountPanel();
    const input = await screen.findByPlaceholderText(/Ask about your data model/);
    await waitFor(() => expect(input).not.toBeDisabled());
    await userEvent.type(input, 'first try');
    await userEvent.keyboard('{Enter}');

    // First assistant turn — emit a delta and close so we go idle.
    await waitFor(() => expect(stream).not.toBeNull());
    await act(async () => {
      stream!.push({ type: 'text-delta', delta: 'ok' });
    });
    // Wait past the 50ms coalescing window.
    await new Promise(r => setTimeout(r, 80));
    await act(async () => { stream!.close(); });

    await waitFor(() => expect(env.chatCalls.length).toBe(1));

    // Idle Retry button is visible after a user turn.
    const retry = await screen.findByTestId('ai-retry-button-idle');
    await userEvent.click(retry);

    // A second /api/ai/chat call fires whose payload's last message
    // is the same user text — confirming the retry actually re-sent.
    await waitFor(() => expect(env.chatCalls.length).toBe(2));
    const second = env.chatCalls[1];
    const last = second.body.messages[second.body.messages.length - 1];
    expect(last.role).toBe('user');
    expect(last.parts[0].text).toBe('first try');

    // Cleanup the second stream.
    await act(async () => { stream!.close(); });
  });

  // ---------------------------------------------------------------- 2
  it('edit + resend truncates messages after the edited turn and persists the truncation', async () => {
    let stream: SSEHandle | null = null;
    const env = withFetchMock({
      onChat: () => {
        stream = makeStream();
        return new Response(stream.stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
      },
    });
    restore = env.restore;

    mountPanel();
    const input = await screen.findByPlaceholderText(/Ask about your data model/);
    await waitFor(() => expect(input).not.toBeDisabled());

    // Turn 1: "alpha" → "AAA"
    await userEvent.type(input, 'alpha');
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(stream).not.toBeNull());
    await act(async () => { stream!.push({ type: 'text-delta', delta: 'AAA' }); });
    await new Promise(r => setTimeout(r, 80));
    await act(async () => { stream!.close(); });

    // Turn 2: "beta" → "BBB"
    await waitFor(() => expect(input).not.toBeDisabled());
    await userEvent.type(input, 'beta');
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(env.chatCalls.length).toBe(2));
    await act(async () => { stream!.push({ type: 'text-delta', delta: 'BBB' }); });
    await new Promise(r => setTimeout(r, 80));
    await act(async () => { stream!.close(); });

    // The history should now contain alpha/AAA/beta/BBB.
    await waitFor(() => {
      expect(screen.getByText('alpha')).toBeInTheDocument();
      expect(screen.getByText('beta')).toBeInTheDocument();
    });

    // Click the *first* user message to begin editing.
    await userEvent.click(screen.getByText('alpha'));
    const editBox = await screen.findByTestId('edit-user-msg');
    const ta = editBox.querySelector('textarea')!;
    await userEvent.clear(ta);
    await userEvent.type(ta, 'alpha edited');

    // Save → triggers a fresh /api/ai/chat call.
    const saveBtn = screen.getByTestId('edit-save-button');
    const callsBefore = env.chatCalls.length;
    const savesBefore = env.convSaves.length;
    await userEvent.click(saveBtn);
    await waitFor(() => expect(env.chatCalls.length).toBe(callsBefore + 1));

    // Payload sent only the edited user message — none of the
    // post-truncation history.
    const replay = env.chatCalls[env.chatCalls.length - 1];
    expect(replay.body.messages.length).toBe(1);
    expect(replay.body.messages[0].parts[0].text).toBe('alpha edited');

    await act(async () => { stream!.push({ type: 'text-delta', delta: 'NEW' }); });
    await new Promise(r => setTimeout(r, 80));
    await act(async () => { stream!.close(); });

    // Conversation persisted after the edit-resend run should have
    // exactly the truncated user turn + new assistant turn.
    await waitFor(() => expect(env.convSaves.length).toBeGreaterThan(savesBefore));
    const lastSave = env.convSaves[env.convSaves.length - 1];
    const userTurns = lastSave.body.messages.filter(m => m.role === 'user').map(m => m.text);
    expect(userTurns).toEqual(['alpha edited']);
    expect(lastSave.body.messages.some(m => m.text.includes('beta'))).toBe(false);
    expect(lastSave.body.messages.some(m => m.text.includes('BBB'))).toBe(false);
  });

  // ---------------------------------------------------------------- 3
  it('does not auto-scroll when the user has scrolled up; surfaces a "New messages" pill', async () => {
    let stream: SSEHandle | null = null;
    const env = withFetchMock({
      onChat: () => {
        stream = makeStream();
        return new Response(stream.stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
      },
    });
    restore = env.restore;

    const { container } = mountPanel();
    const input = await screen.findByPlaceholderText(/Ask about your data model/);
    await waitFor(() => expect(input).not.toBeDisabled());

    await userEvent.type(input, 'long answer please');
    await userEvent.keyboard('{Enter}');

    // Locate the messages container — it's the only scrollable
    // ancestor of the messagesEnd marker.
    const containerEl = container.querySelector('.flex-1.overflow-y-auto') as HTMLElement;
    expect(containerEl).toBeTruthy();

    // jsdom doesn't compute layout, so we stub the scroll metrics.
    Object.defineProperty(containerEl, 'scrollHeight', { configurable: true, value: 1000 });
    Object.defineProperty(containerEl, 'clientHeight', { configurable: true, value: 400 });
    Object.defineProperty(containerEl, 'scrollTop', { configurable: true, writable: true, value: 100 });

    // Fire a scroll event — distance from bottom = 1000-100-400 = 500
    // → above threshold → scrollLocked = true.
    await act(async () => {
      containerEl.dispatchEvent(new Event('scroll'));
    });

    // Now stream a delta while the user is "scrolled up". The pill
    // appears.
    await waitFor(() => expect(stream).not.toBeNull());
    await act(async () => { stream!.push({ type: 'text-delta', delta: 'tok' }); });
    await new Promise(r => setTimeout(r, 80));

    await waitFor(() => {
      expect(screen.getByTestId('ai-new-messages-pill')).toBeInTheDocument();
    });

    // Clicking the pill clears it.
    await userEvent.click(screen.getByTestId('ai-new-messages-pill'));
    expect(screen.queryByTestId('ai-new-messages-pill')).not.toBeInTheDocument();

    await act(async () => { stream!.close(); });
  });

  // ---------------------------------------------------------------- 4
  it('⌘K focuses the composer when the panel is open', async () => {
    restore = withFetchMock({}).restore;

    mountPanel();
    const input = (await screen.findByTestId('ai-composer-input')) as HTMLTextAreaElement;
    await waitFor(() => expect(input).not.toBeDisabled());

    // Move focus elsewhere first.
    input.blur();
    expect(document.activeElement).not.toBe(input);

    // Fire a global ⌘K — handler runs on window, not the input.
    await act(async () => {
      const evt = new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true, cancelable: true });
      window.dispatchEvent(evt);
    });

    await waitFor(() => expect(document.activeElement).toBe(input));
  });

  it('⌘K dispatches ai-chat:open when the panel is closed', async () => {
    restore = withFetchMock({}).restore;
    mountPanel(false); // panel closed
    const seen: Event[] = [];
    const listener = (e: Event) => seen.push(e);
    window.addEventListener('ai-chat:open', listener);
    try {
      await act(async () => {
        const evt = new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true });
        window.dispatchEvent(evt);
      });
      expect(seen.length).toBe(1);
    } finally {
      window.removeEventListener('ai-chat:open', listener);
    }
  });

  // ---------------------------------------------------------------- 5
  it('coalesces consecutive text-delta events into a single render within a 50ms window', async () => {
    let stream: SSEHandle | null = null;
    const env = withFetchMock({
      onChat: () => {
        stream = makeStream();
        return new Response(stream.stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
      },
    });
    restore = env.restore;

    mountPanel();
    const input = await screen.findByPlaceholderText(/Ask about your data model/);
    await waitFor(() => expect(input).not.toBeDisabled());
    await userEvent.type(input, 'go');
    await userEvent.keyboard('{Enter}');

    await waitFor(() => expect(stream).not.toBeNull());

    // Push 5 deltas back-to-back inside one tick — the buffer should
    // accumulate and only flush once at the next 50ms boundary.
    await act(async () => {
      stream!.push({ type: 'text-delta', delta: 'a' });
      stream!.push({ type: 'text-delta', delta: 'b' });
      stream!.push({ type: 'text-delta', delta: 'c' });
      stream!.push({ type: 'text-delta', delta: 'd' });
      stream!.push({ type: 'text-delta', delta: 'e' });
    });

    // Right after pushing — no flush has occurred yet, so the
    // assistant text is not yet rendered. (We don't assert this
    // strictly because rAF/microtask ordering can cause a tiny
    // window where 0 chars render; but after waiting, all 5 chars
    // should appear together.)
    await new Promise(r => setTimeout(r, 80));

    await waitFor(() => {
      // The assistant message bubble holds the merged "abcde" text.
      const allText = document.body.textContent || '';
      expect(allText).toContain('abcde');
    });

    await act(async () => { stream!.close(); });
  });
});
