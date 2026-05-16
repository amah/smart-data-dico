/**
 * #56 — slash command palette integration with AIChatPanel.
 *
 * The composer detects a leading `/` and surfaces the command palette
 * (data-testid="ai-slash-picker"). Selecting a prompt-kind command
 * replaces the input with the expanded template; selecting `/help`
 * injects an inline assistant message without contacting the AI.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
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
  HTMLElement.prototype.scrollIntoView = vi.fn();
}

describe('AIChatPanel — slash command palette (#56)', () => {
  let realFetch: typeof window.fetch;

  beforeEach(() => {
    server.use(
      http.get('/api/ai/status', () => HttpResponse.json({ available: true })),
      http.get('/api/ai/conversations', () => HttpResponse.json({ data: [] })),
      http.post('/api/ai/conversations', () => HttpResponse.json({ message: 'ok' })),
    );
    realFetch = window.fetch;
  });

  afterEach(() => {
    window.fetch = realFetch;
  });

  it('opens the palette when the user types a leading slash', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <AIChatPanel open={true} onClose={() => {}} />
      </MemoryRouter>,
    );

    const input = await screen.findByPlaceholderText(/Ask about your data model/);
    await waitFor(() => expect(input).not.toBeDisabled());
    await user.type(input, '/');

    expect(screen.getByTestId('ai-slash-picker')).toBeInTheDocument();
    // Every built-in command should be visible for the empty token.
    expect(screen.getByTestId('ai-slash-option-help')).toBeInTheDocument();
    expect(screen.getByTestId('ai-slash-option-quality')).toBeInTheDocument();
  });

  it('filters the palette as the user types', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <AIChatPanel open={true} onClose={() => {}} />
      </MemoryRouter>,
    );

    const input = await screen.findByPlaceholderText(/Ask about your data model/);
    await waitFor(() => expect(input).not.toBeDisabled());
    await user.type(input, '/qua');

    expect(screen.getByTestId('ai-slash-option-quality')).toBeInTheDocument();
    expect(screen.queryByTestId('ai-slash-option-list')).not.toBeInTheDocument();
  });

  it('replaces the input with the expanded template when a prompt command is selected', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <AIChatPanel open={true} onClose={() => {}} />
      </MemoryRouter>,
    );

    const input = await screen.findByPlaceholderText(/Ask about your data model/) as HTMLTextAreaElement;
    await waitFor(() => expect(input).not.toBeDisabled());
    await user.type(input, '/quality');
    await user.click(screen.getByTestId('ai-slash-option-quality'));

    // Picker disappears, input now holds the expansion text.
    expect(screen.queryByTestId('ai-slash-picker')).not.toBeInTheDocument();
    expect(input.value).toMatch(/quality review/i);
    expect(input.value).not.toMatch(/^\//); // no longer a slash command
  });

  it('renders an inline help message when /help is selected without contacting AI', async () => {
    const fetchMock = vi.fn(realFetch);
    window.fetch = fetchMock as unknown as typeof window.fetch;

    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <AIChatPanel open={true} onClose={() => {}} />
      </MemoryRouter>,
    );

    const input = await screen.findByPlaceholderText(/Ask about your data model/);
    await waitFor(() => expect(input).not.toBeDisabled());
    await user.type(input, '/help');
    await user.click(screen.getByTestId('ai-slash-option-help'));

    // Help message lists every command — pick a representative one.
    // It renders inside Markdown <code> elements, so query the assistant
    // bubble's text content rather than relying on getByText (which
    // doesn't traverse into nested <code> nodes).
    await waitFor(() => {
      const bubbles = document.querySelectorAll('[data-testid="user-msg-text"], .prose');
      const text = Array.from(bubbles).map(b => b.textContent).join('\n');
      expect(text).toContain('/help');
      expect(text).toContain('/quality');
    });
    // No /api/ai/chat request was issued for /help.
    const chatCalls = fetchMock.mock.calls.filter(c => {
      const u = typeof c[0] === 'string' ? c[0] : (c[0] as Request).url;
      return u.includes('/api/ai/chat');
    });
    expect(chatCalls).toHaveLength(0);
  });
});
