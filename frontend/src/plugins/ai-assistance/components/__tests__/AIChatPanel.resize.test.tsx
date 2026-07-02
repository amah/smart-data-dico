/**
 * AIChatPanel — horizontal panel resize + composer height persistence.
 *
 * The panel width (drag the left edge) and the composer's user-resized height are
 * remembered in localStorage and re-applied on open. Dragging itself is a native
 * browser affordance (not exercisable in jsdom), so we assert the persisted values
 * are read back and applied, and that the resize handle is present.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AIChatPanel from '../AIChatPanel';

// Keep the panel's init effects happy without a backend.
vi.mock('../../commands', () => ({
  runAiCommand: vi.fn(async (name: string) => {
    if (name === 'ai.status.get') return { available: true, provider: 'test', model: 'test' };
    if (name === 'ai.conversation.list') return [];
    if (name === 'ai.conversation.get') return null;
    if (name === 'ai.tools.list') return [];
    if (name === 'ai.prompt.list') return [];
    if (name === 'ai.mentions.search') return { entities: [], packages: [] };
    return undefined;
  }),
}));

HTMLElement.prototype.scrollIntoView = vi.fn(); // jsdom lacks it; panel scrolls to newest message

const mount = () => render(<MemoryRouter><AIChatPanel open={true} onClose={() => {}} /></MemoryRouter>);

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

describe('AIChatPanel resize', () => {
  it('renders the left-edge resize handle', async () => {
    mount();
    expect(await screen.findByTestId('ai-panel-resize-handle')).toBeInTheDocument();
  });

  it('applies the persisted panel width on open', async () => {
    localStorage.setItem('ai-panel-width', '560');
    mount();
    const handle = await screen.findByTestId('ai-panel-resize-handle');
    expect((handle.parentElement as HTMLElement).style.width).toBe('560px');
  });

  it('falls back to the default width when the stored value is out of range', async () => {
    localStorage.setItem('ai-panel-width', '99999');
    mount();
    const handle = await screen.findByTestId('ai-panel-resize-handle');
    expect((handle.parentElement as HTMLElement).style.width).toBe('420px');
  });

  it('restores the persisted composer height on open', async () => {
    localStorage.setItem('ai-composer-height', '220');
    mount();
    const input = await screen.findByTestId('ai-composer-input');
    await waitFor(() => expect((input as HTMLTextAreaElement).style.height).toBe('220px'));
  });
});
