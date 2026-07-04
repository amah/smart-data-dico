/**
 * ColorInput — the color field + preset popover. Reproduces the reported
 * "style block on second click": open → pick → close → open AGAIN → pick again.
 * Runs in jsdom (fireEvent), so it exercises the state machine without the browser.
 */
import { describe, it, expect } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ColorInput } from '../ElementStylesPage';

// Controlled harness mirroring the page: onChange updates the value, re-rendering.
function Harness() {
  const [v, setV] = useState<string | undefined>(undefined);
  return <div data-testid="host" data-value={v ?? ''}><ColorInput value={v} onChange={setV} placeholder="#eef" /></div>;
}

const value = () => (screen.getByTestId('host') as HTMLElement).dataset.value;

describe('ColorInput', () => {
  it('opens, selects, closes, then RE-opens and RE-selects (no block on 2nd click)', async () => {
    render(<Harness />);
    const swatch = screen.getByLabelText('Presets & color picker');

    // ── First interaction ──
    fireEvent.click(swatch);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Use #dc2626'));
    expect(value()).toBe('#dc2626');
    // The swatch shows the picked color and clears the "unset" gradient.
    expect(getComputedStyle(swatch).backgroundColor).toBe('rgb(220, 38, 38)');
    expect(getComputedStyle(swatch).backgroundImage).toBe('none');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument()); // deferred close

    // ── Second interaction (the reported failure) ──
    fireEvent.click(swatch);                                   // 2nd open
    expect(screen.getByRole('dialog')).toBeInTheDocument();    // must re-open, not block
    fireEvent.click(screen.getByLabelText('Use #059669'));     // 2nd select
    expect(value()).toBe('#059669');
    // The swatch color must UPDATE on the second pick, not stay stuck (the bug).
    expect(getComputedStyle(swatch).backgroundColor).toBe('rgb(5, 150, 105)');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('toggles closed when the swatch is clicked again without selecting', () => {
    render(<Harness />);
    const swatch = screen.getByLabelText('Presets & color picker');
    fireEvent.click(swatch);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.click(swatch); // toggle
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(swatch); // 3rd click re-opens
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
