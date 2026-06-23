/**
 * useHighlightOnArrival hook tests (#191 §B).
 *
 * Contract:
 *  1. When ?highlight=<key> is present in the URL and the ref container holds
 *     an element with `data-ttrowkey="<key>"`, the hook:
 *     (a) calls scrollIntoView on that element,
 *     (b) adds the `.sdd-flash` class,
 *     (c) strips the `highlight` param from the URL (history.replace).
 *  2. When the key does NOT match any element, the hook is a no-op (no throw,
 *     no scroll) and — after a bounded poll window — strips the param.
 *  3. When there is no `highlight` param at all, the hook is a no-op.
 *
 * Implementation notes:
 *  - The row a real page highlights often mounts a few commits after the hook
 *    first runs, so the hook polls via requestAnimationFrame until the row
 *    appears (or a deadline). Tests fake rAF + Date and advance the clock to
 *    drive the poll deterministically.
 *  - scrollIntoView is stubbed because jsdom doesn't implement it.
 *  - A `SearchParamsDisplay` sibling reads the current search params so we can
 *    assert URL changes.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { useRef } from 'react';
import { MemoryRouter, Route, Routes, useSearchParams } from 'react-router-dom';
import { useHighlightOnArrival } from '../useHighlightOnArrival';

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

function Harness({ rowKey }: { rowKey: string }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  useHighlightOnArrival(containerRef, 1);

  return (
    <div ref={containerRef}>
      <div data-ttrowkey={rowKey} data-testid={`row-${rowKey}`}>
        Row {rowKey}
      </div>
    </div>
  );
}

function SearchParamsDisplay() {
  const [params] = useSearchParams();
  return <span data-testid="search-params">{params.toString()}</span>;
}

function renderHarness(rowKey: string, path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="/"
          element={
            <>
              <SearchParamsDisplay />
              <Harness rowKey={rowKey} />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

/** Advance fake timers (incl. rAF) inside act so React flushes state updates. */
function flush(ms: number) {
  act(() => { vi.advanceTimersByTime(ms); });
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

let originalScrollIntoView: typeof Element.prototype.scrollIntoView;

beforeEach(() => {
  // Fake rAF + Date so the poll loop is driven by advanceTimersByTime.
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'setTimeout', 'clearTimeout', 'Date'] });
  originalScrollIntoView = Element.prototype.scrollIntoView;
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  vi.useRealTimers();
  Element.prototype.scrollIntoView = originalScrollIntoView;
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useHighlightOnArrival — happy path (matching row)', () => {
  it('adds .sdd-flash to the matching row', () => {
    renderHarness('Foo', '/?highlight=Foo');
    flush(20); // run the first animation-frame poll
    const row = screen.getByTestId('row-Foo');
    expect(row.classList.contains('sdd-flash')).toBe(true);
  });

  it('calls scrollIntoView on the matching row', () => {
    renderHarness('Foo', '/?highlight=Foo');
    flush(20);
    const row = screen.getByTestId('row-Foo');
    expect(row.scrollIntoView).toHaveBeenCalledWith({ block: 'center', behavior: 'smooth' });
  });

  it('strips the highlight param from the URL once the row is found', () => {
    renderHarness('Foo', '/?highlight=Foo');
    flush(20);
    const display = screen.getByTestId('search-params');
    expect(display.textContent).not.toContain('highlight');
  });

  it('cleans up the poll on unmount without throwing', () => {
    const { unmount } = render(
      <MemoryRouter initialEntries={['/?highlight=Foo']}>
        <Routes>
          <Route
            path="/"
            element={
              <>
                <SearchParamsDisplay />
                <Harness rowKey="Foo" />
              </>
            }
          />
        </Routes>
      </MemoryRouter>,
    );
    flush(20);
    const row = screen.getByTestId('row-Foo');
    expect(row.scrollIntoView).toHaveBeenCalled();
    expect(() => unmount()).not.toThrow();
  });
});

describe('useHighlightOnArrival — no-match key', () => {
  it('does not throw and never scrolls when the key has no matching row', () => {
    expect(() => renderHarness('Foo', '/?highlight=NonExistentKey')).not.toThrow();
    flush(50);
    for (const el of document.querySelectorAll('[data-ttrowkey]')) {
      expect((el as HTMLElement).scrollIntoView).not.toHaveBeenCalled();
    }
  });

  it('strips the highlight param after the poll window elapses', () => {
    renderHarness('Foo', '/?highlight=NonExistentKey');
    // Param persists while polling, then is dropped once the deadline passes.
    flush(3000); // > MAX_WAIT_MS (2500)
    const display = screen.getByTestId('search-params');
    expect(display.textContent).not.toContain('highlight');
  });
});

describe('useHighlightOnArrival — no highlight param in URL', () => {
  it('is a no-op when there is no highlight param', () => {
    expect(() => renderHarness('Foo', '/')).not.toThrow();
    flush(20);
    const row = screen.getByTestId('row-Foo');
    expect(row.classList.contains('sdd-flash')).toBe(false);
    expect(row.scrollIntoView).not.toHaveBeenCalled();
  });

  it('preserves other search params when highlight is absent', () => {
    renderHarness('Foo', '/?view=graph');
    flush(20);
    const display = screen.getByTestId('search-params');
    expect(display.textContent).toContain('view=graph');
  });
});
