/**
 * Shared test helpers for AIChatPanel tests.
 *
 * runAiCommand stub that routes each command to a direct fetch call,
 * matching the MSW handlers that each test file registers. This avoids
 * needing a full kernel bootstrap in component-level tests.
 */

export type MockRunAiCommand = (name: string, input?: any) => Promise<any>;

/**
 * Create a stub implementation of runAiCommand that routes AI commands
 * to direct fetch calls. Each test file uses `vi.mock('../commands', ...)`
 * with this factory to avoid bootstrapping the full microkernel.
 */
export async function stubRunAiCommand(name: string, input?: any): Promise<any> {
  if (name === 'ai.status.get') {
    const r = await fetch('/api/ai/status');
    return r.json();
  }
  if (name === 'ai.conversation.list') {
    const q = input?.q ? `?q=${encodeURIComponent(input.q)}` : '';
    const r = await fetch(`/api/ai/conversations${q}`);
    const d = await r.json();
    return d.data ?? [];
  }
  if (name === 'ai.conversation.get') {
    const r = await fetch(`/api/ai/conversations/${input?.id}`);
    const d = await r.json();
    return d.data ?? null;
  }
  if (name === 'ai.conversation.save') {
    return fetch('/api/ai/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input?.conversation),
    });
  }
  if (name === 'ai.conversation.patch') {
    return fetch(`/api/ai/conversations/${input?.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input?.patch),
    });
  }
  if (name === 'ai.conversation.delete') {
    return fetch(`/api/ai/conversations/${input?.id}`, { method: 'DELETE' });
  }
  if (name === 'ai.chat.send') {
    return fetch('/api/ai/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input?.request),
      signal: input?.signal,
    });
  }
  if (name === 'ai.tools.list') {
    const r = await fetch('/api/ai/tools');
    const d = await r.json();
    return d.data ?? [];
  }
  if (name === 'ai.mentions.search') {
    const r = await fetch(`/api/ai/mentions/search?q=${encodeURIComponent(input?.q ?? '')}`);
    const d = await r.json();
    return d.data ?? { entities: [], packages: [] };
  }
  if (name === 'ai.prompt.list') {
    const r = await fetch('/api/ai/prompts');
    const d = await r.json();
    return d.data ?? [];
  }
  if (name === 'ai.prompt.create') {
    const r = await fetch('/api/ai/prompts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    const d = await r.json();
    return d.data;
  }
  if (name === 'ai.prompt.update') {
    const { id, ...rest } = input;
    const r = await fetch(`/api/ai/prompts/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(rest),
    });
    const d = await r.json();
    return d.data;
  }
  if (name === 'ai.prompt.delete') {
    return fetch(`/api/ai/prompts/${input?.id}`, { method: 'DELETE' });
  }
  throw new Error(`Unmocked AI command: ${name}`);
}
