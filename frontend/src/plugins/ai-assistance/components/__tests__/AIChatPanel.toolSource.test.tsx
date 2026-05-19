/**
 * AIChatPanel × MCP tool-call source attribution (#178 slice 3).
 *
 * The chat panel must:
 *  - show a `from <connectionLabel>` pill on a tool-call card whose name
 *    is an MCP-namespaced `<connectionId>.<rawName>` (resolved via the
 *    `/api/ai/tools` metadata `source: 'mcp'` + `connectionLabel`
 *    fields slice 1 already wired);
 *  - NOT show that pill for a built-in tool;
 *  - show the same pill in the "Available Tools" catalog view.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import AIChatPanel from '../AIChatPanel';
import { server } from '../../../../test/setup';
import { http, HttpResponse } from 'msw';

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
    if (name === 'ai.chat.send') return input.signal
      ? fetch('/api/ai/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input.request), signal: input.signal })
      : fetch('/api/ai/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input.request) });
    if (name === 'ai.tools.list') { const r = await fetch('/api/ai/tools'); const d = await r.json(); return d.data ?? []; }
    if (name === 'ai.mentions.search') { const r = await fetch(`/api/ai/mentions/search?q=${encodeURIComponent(input?.q ?? '')}`); const d = await r.json(); return d.data ?? { entities: [], packages: [] }; }
    if (name === 'ai.prompt.list') { const r = await fetch('/api/ai/prompts'); const d = await r.json(); return d.data ?? []; }
    throw new Error(`Unmocked command: ${name}`);
  }),
}));

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

const TOOLS_RESPONSE = {
  data: [
    {
      name: 'listEntities',
      description: 'List entities in a package',
      source: 'builtin',
      parameters: [{ name: 'packageName', type: 'string', required: false, description: '' }],
    },
    {
      name: 'slack.sendMessage',
      description: 'Send a message to a Slack channel',
      source: 'mcp',
      connectionId: 'slack',
      connectionLabel: 'Slack (team)',
      trustLevel: 'auto',
      parameters: [],
    },
  ],
};

describe('AIChatPanel — MCP tool-call source attribution (#178 slice 3)', () => {
  let restoreFetch: () => void = () => {};

  beforeEach(() => {
    localStorage.clear();
    server.use(
      http.get('/api/ai/status', () => HttpResponse.json({ available: true })),
      http.get('/api/ai/conversations', () => HttpResponse.json({ data: [] })),
      http.post('/api/ai/conversations', () => HttpResponse.json({ message: 'ok' })),
      http.get('/api/ai/tools', () => HttpResponse.json(TOOLS_RESPONSE)),
    );
  });

  afterEach(() => {
    restoreFetch();
    localStorage.clear();
  });

  it('renders a "from <label>" badge on an MCP tool-call card and none on a built-in', async () => {
    const { stream, push, close } = makeStream();
    restoreFetch = withMockChatStream(() => new Response(stream, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    }));

    mountPanel();

    const input = await screen.findByPlaceholderText(/Ask about your data model/);
    await waitFor(() => expect(input).not.toBeDisabled());
    await userEvent.type(input, 'mix builtin and mcp{Enter}');

    // Built-in tool call first.
    await act(async () => {
      push({ type: 'tool-input-start', toolCallId: 'listEntities:0', toolName: 'listEntities', category: 'read' });
    });
    await act(async () => {
      push({ type: 'tool-output-available', toolCallId: 'listEntities:0', output: { entities: [] } });
    });

    // MCP tool call.
    await act(async () => {
      push({ type: 'tool-input-start', toolCallId: 'slack.sendMessage:0', toolName: 'slack.sendMessage', category: 'modify' });
    });
    await act(async () => {
      push({ type: 'tool-output-available', toolCallId: 'slack.sendMessage:0', output: { success: true, message: 'sent' } });
    });
    await act(async () => { close(); });

    await waitFor(() => {
      // Exactly one source badge — the MCP tool's card.
      const badges = screen.getAllByTestId('tool-source-badge');
      expect(badges).toHaveLength(1);
      expect(badges[0]).toHaveAttribute('data-source', 'mcp');
      expect(badges[0]).toHaveAttribute('data-connection-label', 'Slack (team)');
      expect(badges[0].textContent).toMatch(/from\s+Slack \(team\)/);
    });
  });

  it('renders the same source badge in the "Available Tools" catalog view', async () => {
    mountPanel();

    // Open the Tools view via the panel's view toggle. The tools list is
    // already pre-fetched by the panel on mount; switching view should
    // render every def with its source badge.
    const toolsBtn = await screen.findByRole('button', { name: /Tools/i });
    await userEvent.click(toolsBtn);

    await waitFor(() => {
      const badges = screen.getAllByTestId('tools-view-source-badge');
      expect(badges).toHaveLength(1);
      expect(badges[0]).toHaveAttribute('data-connection-label', 'Slack (team)');
      expect(badges[0].textContent).toMatch(/from\s+Slack \(team\)/);
    });
  });
});
