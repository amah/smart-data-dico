/**
 * focusSubtitle.test.ts (#focus)
 *
 * The compact key-facts subtitle shown under a direct neighbour in focus mode
 * ("PK · 7 attrs" / "3 attrs" / "0 attrs").
 */
import { describe, it, expect } from 'vitest';
import { focusSubtitle } from '../useCytoscapeInteractions';

describe('focusSubtitle', () => {
  it.each([
    [1, 7, 'PK · 7 attrs'],
    [0, 7, '7 attrs'],
    [2, 1, 'PK · 1 attr'],
    [0, 1, '1 attr'],
    [0, 0, '0 attrs'],
  ])('pkCount=%i attrCount=%i → %s', (pk, attr, expected) => {
    expect(focusSubtitle(pk, attr)).toBe(expected);
  });
});
