/**
 * formatEndLabel.test.ts
 *
 * Covers the rendering rules for cytoscape edge-end labels: show the role
 * (endpoint name) plus a cardinality glyph (`*` for many, `1` for one).
 * Replaces the prior "one"/"many" word labels — these cases lock in the
 * new format so a regression to the verbose form is caught.
 */

import { describe, it, expect } from 'vitest';
import { formatEndLabel } from '../mapGraphDataToCytoscape';

describe('formatEndLabel', () => {
  it.each([
    ['items',     'many',      'items *'],
    ['order',     'one',       'order'],
    ['',          'many',      '*'],
    ['',          'one',       ''],
    [undefined,   'many',      '*'],
    [undefined,   'one',       ''],
    ['items',     undefined,   'items'],
    [undefined,   undefined,   ''],
    ['  trimmed ','many',      'trimmed *'],
  ])('name=%p, cardinality=%p → %p', (name, card, expected) => {
    expect(formatEndLabel(name as string | undefined, card as string | undefined)).toBe(expected);
  });

  it('treats any non-"many" cardinality as one (role-only / empty)', () => {
    expect(formatEndLabel('x', 'ONE')).toBe('x');
    expect(formatEndLabel('x', 'one')).toBe('x');
    expect(formatEndLabel(undefined, 'ONE')).toBe('');
  });
});
