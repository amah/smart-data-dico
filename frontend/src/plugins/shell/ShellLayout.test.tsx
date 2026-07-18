/**
 * #229 — ShellLayout should reset the main scroll container to the top on
 * route change so a long scroll on the diagram page doesn't carry over to
 * entity/package pages and hide their headers.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route, Link } from 'react-router-dom';
import ShellLayout from './ShellLayout';

vi.mock('../../components/Navbar', () => ({
  default: () => <nav data-testid="navbar">Navbar</nav>,
}));
vi.mock('../../components/Sidebar', () => ({
  default: () => <aside data-testid="sidebar">Sidebar</aside>,
}));
vi.mock('../../components/Breadcrumbs', () => ({
  default: () => <div data-testid="breadcrumbs">Breadcrumbs</div>,
}));
vi.mock('../../components/Footer', () => ({
  default: () => <footer data-testid="footer">Footer</footer>,
}));
vi.mock('../../plugins/ai-assistance/components/AIChatPanel', () => ({
  default: ({ open }: { open: boolean }) => open ? <div data-testid="ai-panel">AI</div> : null,
}));
vi.mock('../../components/KeyboardShortcutsModal', () => ({
  default: () => <div data-testid="shortcuts">Shortcuts</div>,
}));

if (!('scrollIntoView' in HTMLElement.prototype)) {
  HTMLElement.prototype.scrollIntoView = vi.fn();
}

function LongPage({ label, nextTo }: { label: string; nextTo?: string }) {
  return (
    <div data-testid={`page-${label}`}>
      <div style={{ height: 200, background: 'red' }}>Top of {label}</div>
      {nextTo && <Link to={nextTo} data-testid={`nav-${label}`}>Go</Link>}
      <div style={{ height: 2000, background: 'blue' }}>Tall content</div>
    </div>
  );
}

describe('ShellLayout — scroll restoration (#229)', () => {
  beforeEach(() => {
    localStorage.removeItem('sdd-sidebar-width');
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  });

  it('resets main scroll to top after navigating to a new pathname', async () => {
    render(
      <MemoryRouter initialEntries={['/diagram']}>
        <Routes>
          <Route path="/" element={<ShellLayout />}>
            <Route path="diagram" element={<LongPage label="diagram" nextTo="/entity" />} />
            <Route path="entity" element={<LongPage label="entity" />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    const main = screen.getByTestId('page-diagram').closest('main');
    if (!main) throw new Error('main not found');

    // Scroll down the diagram page.
    main.scrollTop = 500;
    main.scrollLeft = 80;
    document.documentElement.scrollTop = 400;
    document.body.scrollTop = 300;
    expect(main.scrollTop).toBe(500);

    // Navigate to entity page.
    await userEvent.click(screen.getByTestId('nav-diagram'));

    await waitFor(() => {
      expect(screen.getByTestId('page-entity')).toBeInTheDocument();
    });

    // The scroll position should have been reset to top.
    expect(main.scrollTop).toBe(0);
    expect(main.scrollLeft).toBe(0);
    expect(document.documentElement.scrollTop).toBe(0);
    expect(document.body.scrollTop).toBe(0);
  });

  it('keeps scrolling inside the viewport-height shell', () => {
    render(
      <MemoryRouter initialEntries={['/diagram']}>
        <Routes>
          <Route path="/" element={<ShellLayout />}>
            <Route path="diagram" element={<LongPage label="diagram" />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    const shell = screen.getByTestId('navbar').parentElement;
    expect(shell).toHaveClass('h-screen', 'overflow-hidden');
  });
});
