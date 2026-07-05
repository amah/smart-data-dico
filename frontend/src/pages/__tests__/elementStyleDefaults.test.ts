/**
 * Factory defaults invariants — guards the starter palette the "Reset to defaults"
 * button writes, so a malformed palette can't ship. Mirrors the backend
 * validateElementStyles/validateStyleRules rules (kebab names, single default,
 * rules reference known styles).
 */
import { describe, it, expect } from 'vitest';
import { FACTORY_STYLES, FACTORY_RULES, resetStyleToFactory } from '../ElementStylesPage';

describe('Element style factory defaults', () => {
  it('has kebab-case, unique style names', () => {
    const names = FACTORY_STYLES.map((s) => s.name);
    names.forEach((n) => expect(n).toMatch(/^[a-z][a-z0-9-]*$/));
    expect(new Set(names).size).toBe(names.length);
  });

  it('marks exactly one style as the default', () => {
    expect(FACTORY_STYLES.filter((s) => s.default).length).toBe(1);
  });

  it('every rule references a defined style and is non-empty', () => {
    const known = new Set(FACTORY_STYLES.map((s) => s.name));
    FACTORY_RULES.forEach((r) => {
      expect(known.has(r.style)).toBe(true);
      expect(r.pattern).not.toBe('');
      expect(['stereotype', 'role', 'entityName', 'physicalTableName']).toContain(r.match);
    });
  });
});

describe('resetStyleToFactory (per-style reset)', () => {
  it('restores a mutated factory style exactly, dropping added fields', () => {
    // aggregate-root has no `opacity` in the factory; a reset must drop the added one.
    const mutated = { name: 'aggregate-root', label: 'Changed', opacity: 0.3, borderWidth: 1 };
    const factory = FACTORY_STYLES.find((s) => s.name === 'aggregate-root');
    expect(resetStyleToFactory(mutated)).toEqual(factory);
    expect(resetStyleToFactory(mutated)).not.toHaveProperty('opacity');
  });

  it('returns a fresh copy, not the shared factory reference', () => {
    const factory = FACTORY_STYLES.find((s) => s.name === 'junction')!;
    const out = resetStyleToFactory({ name: 'junction' });
    expect(out).toEqual(factory);
    expect(out).not.toBe(factory); // mutating the row must not corrupt FACTORY_STYLES
  });

  it('leaves a non-factory (custom) style unchanged', () => {
    const custom = { name: 'my-custom', fill: '#123' };
    expect(resetStyleToFactory(custom)).toBe(custom);
  });
});
