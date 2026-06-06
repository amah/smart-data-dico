/**
 * viewMode.test.ts (#182)
 *
 * Locks the `?view=` URL-param ⇄ active-tab mapping: known modes round-trip,
 * everything else (missing / unknown / wrong case) falls back to the default
 * `structural` so a bad deep-link can never break the diagram page.
 */
import { describe, it, expect } from 'vitest';
import {
  parseViewMode,
  DEFAULT_VIEW_MODE,
  VIEW_MODES,
  VIEW_MODE_LABELS,
} from '../viewMode';

describe('parseViewMode', () => {
  it('round-trips every known view mode', () => {
    for (const m of VIEW_MODES) {
      expect(parseViewMode(m)).toBe(m);
    }
  });

  it.each([
    [null, 'structural'],
    [undefined, 'structural'],
    ['', 'structural'],
    ['bogus', 'structural'],
    ['Structural', 'structural'], // case-sensitive — capitalised is unknown
    ['LOGICAL', 'structural'],
  ] as const)('param=%p → %p', (param, expected) => {
    expect(parseViewMode(param)).toBe(expected);
  });

  it('default mode is structural', () => {
    expect(DEFAULT_VIEW_MODE).toBe('structural');
    expect(parseViewMode(null)).toBe(DEFAULT_VIEW_MODE);
  });

  it('exposes a label for every mode', () => {
    for (const m of VIEW_MODES) {
      expect(VIEW_MODE_LABELS[m]).toBeTruthy();
    }
  });
});
