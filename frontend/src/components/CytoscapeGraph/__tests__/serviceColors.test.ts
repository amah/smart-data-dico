/**
 * serviceColors.test.ts
 *
 * Package colours must scale beyond the curated palette — at 100+ packages the
 * colours should stay (mostly) distinct rather than cycling through ten.
 */
import { describe, it, expect } from 'vitest';
import { packageColor, buildServiceColorMap } from '../cytoscapeStylesheet';

describe('packageColor', () => {
  it('uses the curated palette for the first ten', () => {
    expect(packageColor(0)).toBe('#3498db');
    expect(packageColor(9)).toBe('#d35400');
  });

  it('generates hsl colours beyond the palette (no plain 10-cycle repeat)', () => {
    expect(packageColor(10)).toMatch(/^hsl\(/);
    // index 10 must NOT reuse index 0's colour (the old `i % 10` bug)
    expect(packageColor(10)).not.toBe(packageColor(0));
  });

  it('produces distinct colours for 100 packages', () => {
    const colors = Array.from({ length: 100 }, (_, i) => packageColor(i));
    const unique = new Set(colors);
    // golden-angle hue + 2 lightness levels → effectively all distinct
    expect(unique.size).toBeGreaterThanOrEqual(95);
  });
});

describe('buildServiceColorMap', () => {
  it('maps each package to its index colour', () => {
    const map = buildServiceColorMap(['a', 'b', 'c']);
    expect(map.a).toBe(packageColor(0));
    expect(map.b).toBe(packageColor(1));
    expect(map.c).toBe(packageColor(2));
  });

  it('assigns distinct colours to 120 packages', () => {
    const services = Array.from({ length: 120 }, (_, i) => `pkg-${i}`);
    const map = buildServiceColorMap(services);
    expect(new Set(Object.values(map)).size).toBeGreaterThanOrEqual(110);
  });
});
