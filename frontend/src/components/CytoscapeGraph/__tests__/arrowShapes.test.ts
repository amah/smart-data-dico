/**
 * arrowShapes.test.ts (#uml)
 *
 * UML edge decorations:
 *   - navigability: bidirectional → no arrowheads; one-way → a single open arrow;
 *   - composition (orphanRemoval / cascade ALL|REMOVE) → a filled diamond at the
 *     whole (the "one" side); everything else is a plain reference.
 */
import { describe, it, expect } from 'vitest';
import {
  referenceArrows,
  isComposition,
  compositionWholeEnd,
  associationArrows,
} from '../arrowShapes';

describe('referenceArrows (navigability)', () => {
  it('bidirectional → no arrowheads', () => {
    expect(referenceArrows({ arrowAtSource: true, arrowAtTarget: true })).toEqual({
      sourceArrow: 'none',
      targetArrow: 'none',
    });
  });

  it('one-way → a single open arrow at the navigable end', () => {
    expect(referenceArrows({ arrowAtSource: true, arrowAtTarget: false })).toEqual({
      sourceArrow: 'vee',
      targetArrow: 'none',
    });
    expect(referenceArrows({ arrowAtSource: false, arrowAtTarget: true })).toEqual({
      sourceArrow: 'none',
      targetArrow: 'vee',
    });
  });

  it('non-navigable → no arrowheads', () => {
    expect(referenceArrows({ arrowAtSource: false, arrowAtTarget: false })).toEqual({
      sourceArrow: 'none',
      targetArrow: 'none',
    });
  });
});

describe('isComposition', () => {
  it('is true for orphanRemoval or cascade ALL/REMOVE', () => {
    expect(isComposition([{ name: 'orm.orphanRemoval', value: true }])).toBe(true);
    expect(isComposition([{ name: 'orm.cascade', value: 'ALL' }])).toBe(true);
    expect(isComposition([{ name: 'orm.cascade', value: 'PERSIST, REMOVE' }])).toBe(true);
  });

  it('is false for a plain reference (no orphan, cascade without ALL/REMOVE)', () => {
    expect(isComposition([{ name: 'orm.cascade', value: 'PERSIST, MERGE' }])).toBe(false);
    expect(isComposition([{ name: 'orm.fetch', value: 'LAZY' }])).toBe(false);
    expect(isComposition(undefined)).toBe(false);
  });
});

describe('compositionWholeEnd', () => {
  it('is the "one" side (one whole owns many parts)', () => {
    expect(compositionWholeEnd({ sourceCardinality: 'one', targetCardinality: 'many' })).toBe('source');
    expect(compositionWholeEnd({ sourceCardinality: 'many', targetCardinality: 'one' })).toBe('target');
  });

  it('is unknown for many-to-many', () => {
    expect(compositionWholeEnd({ sourceCardinality: 'many', targetCardinality: 'many' })).toBe('');
  });
});

describe('associationArrows', () => {
  it('composition → filled diamond at the whole, no other arrowhead', () => {
    const r = associationArrows({
      arrowAtSource: true,
      arrowAtTarget: true,
      sourceCardinality: 'one',
      targetCardinality: 'many',
      metadata: [{ name: 'orm.orphanRemoval', value: true }],
    });
    expect(r).toEqual({ sourceArrow: 'diamond', targetArrow: 'none', edgeType: 'composition' });
  });

  it('reference → navigability arrows (bidirectional = plain line)', () => {
    const r = associationArrows({
      arrowAtSource: true,
      arrowAtTarget: true,
      sourceCardinality: 'one',
      targetCardinality: 'many',
      metadata: [{ name: 'orm.fetch', value: 'LAZY' }],
    });
    expect(r).toEqual({ sourceArrow: 'none', targetArrow: 'none', edgeType: 'reference' });
  });

  it('a many-to-many composition falls back to a reference (no whole end)', () => {
    const r = associationArrows({
      arrowAtSource: false,
      arrowAtTarget: true,
      sourceCardinality: 'many',
      targetCardinality: 'many',
      metadata: [{ name: 'orm.cascade', value: 'ALL' }],
    });
    expect(r.edgeType).toBe('reference');
    expect(r.targetArrow).toBe('vee');
  });
});
