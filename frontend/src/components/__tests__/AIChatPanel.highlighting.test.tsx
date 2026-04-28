/**
 * AIChatPanel tests for #129: syntax highlighting on fenced code blocks.
 *
 * We don't exercise the full streaming pipeline here (covered separately);
 * instead we seed an assistant message containing fenced code via a stubbed
 * conversation and verify the Markdown `code` component renders correctly.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach, beforeAll } from 'vitest';
import { http, HttpResponse } from 'msw';
import { MemoryRouter } from 'react-router-dom';
import { server } from '../../test/setup';
import AIChatPanel from '../AIChatPanel';

// JSDOM doesn't implement Element.scrollIntoView; the panel calls it
// after every messages update.
beforeAll(() => {
  if (!('scrollIntoView' in HTMLElement.prototype)) {
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: () => {},
    });
  }
});

const renderPanel = () => {
  return render(
    <MemoryRouter>
      <AIChatPanel open={true} onClose={() => {}} />
    </MemoryRouter>
  );
};

describe('AIChatPanel — syntax highlighting (#129)', () => {
  beforeEach(() => {
    // Calm the panel's mount-time fetches.
    server.use(
      http.get('/api/ai/status', () => HttpResponse.json({ available: true })),
      http.get('/api/ai/conversations', () =>
        HttpResponse.json({
          data: [
            {
              id: 'conv-with-code',
              title: 'Stub conv',
              messageCount: 1,
              updatedAt: new Date().toISOString(),
            },
          ],
        }),
      ),
      http.get('/api/ai/conversations/conv-with-code', () =>
        HttpResponse.json({
          data: {
            id: 'conv-with-code',
            title: 'Stub conv',
            messages: [
              {
                id: 'm1',
                role: 'user',
                text: 'show me typescript',
              },
              {
                id: 'm2',
                role: 'assistant',
                text:
                  'Here is some code:\n\n```ts\nconst x: number = 1;\n```\n\nAnd inline `code` too.',
              },
            ],
          },
        }),
      ),
    );
  });

  it('renders fenced ```ts blocks via SyntaxHighlighter (PrismLight)', async () => {
    renderPanel();

    // Wait for the assistant message containing the code block to render.
    await waitFor(() =>
      expect(screen.getByText(/Here is some code/i)).toBeInTheDocument(),
    );

    // Prism wraps tokens in many <span>s, so the text isn't in a single
    // node. Verify by container.textContent.
    const btn = await screen.findByTestId('copy-code-button');
    const blockRoot = btn.parentElement!;
    expect(blockRoot.textContent).toContain('const x: number = 1;');

    // SyntaxHighlighter emits a <code class="language-ts"> wrapper —
    // confirm tokenization actually happened (not a plain <code>).
    expect(blockRoot.querySelector('code.language-ts')).not.toBeNull();
  });

  it('inline code (no language) falls through to plain <code>, no Copy button', async () => {
    // Override the conversation to contain only inline code.
    server.use(
      http.get('/api/ai/conversations/conv-with-code', () =>
        HttpResponse.json({
          data: {
            id: 'conv-with-code',
            title: 'inline only',
            messages: [
              { id: 'm1', role: 'user', text: 'hi' },
              { id: 'm2', role: 'assistant', text: 'See `inline` here.' },
            ],
          },
        }),
      ),
    );

    renderPanel();

    await waitFor(() =>
      expect(screen.getByText(/See/)).toBeInTheDocument(),
    );

    // No Copy button because there's no fenced code block.
    expect(screen.queryByTestId('copy-code-button')).not.toBeInTheDocument();
  });

  it('unknown language (e.g. mermaid) does not crash render', async () => {
    server.use(
      http.get('/api/ai/conversations/conv-with-code', () =>
        HttpResponse.json({
          data: {
            id: 'conv-with-code',
            title: 'mermaid',
            messages: [
              { id: 'm1', role: 'user', text: 'mermaid' },
              {
                id: 'm2',
                role: 'assistant',
                text: '```mermaid\ngraph TD; A-->B;\n```',
              },
            ],
          },
        }),
      ),
    );

    renderPanel();

    // Render must complete (no thrown error) and the raw code text
    // must still be visible even though `mermaid` is not a registered
    // Prism grammar — react-syntax-highlighter swallows the unknown-
    // language error in its internal try/catch.
    const btn = await screen.findByTestId('copy-code-button');
    const blockRoot = btn.parentElement!;
    expect(blockRoot.textContent).toContain('graph TD');
  });

  it('switches highlighter theme between light/dark based on usePrefs', async () => {
    // Force dark theme before render via the same localStorage key used
    // by usePrefs.ts, so the panel picks oneDark.
    window.localStorage.setItem('theme', 'dark');
    document.documentElement.setAttribute('data-theme', 'dark');

    try {
      renderPanel();
      const btn = await screen.findByTestId('copy-code-button');
      const blockRoot = btn.parentElement!;
      // PreTag="div" means the wrapper is a <div>, not <pre>. The
      // first child div carries the Prism inline-style background.
      const codeEl = blockRoot.querySelector('code.language-ts') as HTMLElement | null;
      expect(codeEl).not.toBeNull();
      // The styled wrapper is the parent of <code>; SyntaxHighlighter
      // emits inline styles for background/colour from oneDark/oneLight.
      const wrapper = codeEl!.parentElement as HTMLElement;
      const bg = wrapper.style.background || wrapper.style.backgroundColor;
      expect(bg).toBeTruthy();
      // oneDark uses #282c34 (rgb 40,44,52). The colour must be a dark
      // shade — verify the red channel is below 128 (well within "dark").
      const m = bg.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
      if (m) {
        const r = parseInt(m[1], 10);
        const g = parseInt(m[2], 10);
        const b = parseInt(m[3], 10);
        expect(r + g + b).toBeLessThan(128 * 3); // overall dark
      }
    } finally {
      window.localStorage.removeItem('theme');
      document.documentElement.setAttribute('data-theme', 'light');
    }
  });

  it('Copy button: writes to clipboard and shows "Copied!" on success', async () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });

    try {
      renderPanel();
      const btn = await screen.findByTestId('copy-code-button');
      fireEvent.click(btn);

      await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
      expect(writeText).toHaveBeenCalledWith('const x: number = 1;');
      // Re-query the button — React may have replaced the node when
      // state changed.
      await waitFor(() => {
        const updated = screen.getByTestId('copy-code-button');
        expect(updated.textContent).toMatch(/Copied!/);
      });
    } finally {
      if (originalDescriptor) {
        Object.defineProperty(navigator, 'clipboard', originalDescriptor);
      } else {
        // jsdom didn't have a clipboard descriptor before — leave the
        // shim in place; subsequent tests rely on it being present.
      }
    }
  });
});
