/**
 * validateNavigatePath.test.ts
 *
 * Verifies the route-pattern guard the AI chat panel uses to block
 * `navigateTo` calls that would land on the 404 page. The shape of
 * each assertion is "given the AI returns path X, validation should
 * pass/fail" — these are the cases that have actually bitten in the
 * field (singular vs plural drift) plus the happy paths.
 */

import { describe, it, expect } from 'vitest';
import { validateNavigatePath, ROUTE_PATTERNS } from '../validateNavigatePath';

describe('validateNavigatePath — happy paths', () => {
  it.each([
    ['/'],
    ['/packages'],
    ['/packages/order-service'],
    ['/packages/order-service/entities/Order'],
    ['/packages/order-service/entities/Order/attributes/total'],
    ['/cases'],
    ['/cases/abc-123'],
    ['/cases/abc-123/edit'],
    ['/visualization/order-service/Order'],
    ['/diff/logical'],
    ['/version/save'],
    ['/design-system'],
    ['/integrity'],
    ['/types'],
    ['/settings'],
  ])('accepts %s', (path) => {
    expect(validateNavigatePath(path).valid).toBe(true);
  });

  it('strips ?query and #hash before matching', () => {
    expect(validateNavigatePath('/packages/order-service?view=graph').valid).toBe(true);
    expect(validateNavigatePath('/integrity#section').valid).toBe(true);
  });
});

describe('validateNavigatePath — rejection cases the AI has hit', () => {
  it('rejects the singular-form drift the AI produced today', () => {
    const r = validateNavigatePath('/package/order-service/entity/Order');
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/Page not found/);
    expect(r.knownRoots).toContain('/packages');
  });

  it('rejects an obviously made-up route', () => {
    expect(validateNavigatePath('/this-route-does-not-exist').valid).toBe(false);
  });

  it('rejects empty / non-string / relative paths', () => {
    expect(validateNavigatePath('').valid).toBe(false);
    expect(validateNavigatePath('packages/order-service').valid).toBe(false);
    // @ts-expect-error — intentional invalid input
    expect(validateNavigatePath(undefined).valid).toBe(false);
    // @ts-expect-error — intentional invalid input
    expect(validateNavigatePath(null).valid).toBe(false);
  });

  it('includes known top-level roots so the AI can retry', () => {
    const r = validateNavigatePath('/wrong/path');
    expect(r.knownRoots).toEqual(expect.arrayContaining(['/packages', '/cases', '/diagram', '/quality', '/settings']));
  });
});

describe('validateNavigatePath — pattern hygiene', () => {
  it('ROUTE_PATTERNS contains no duplicates', () => {
    const seen = new Set<string>();
    for (const p of ROUTE_PATTERNS) {
      expect(seen.has(p), `duplicate pattern: ${p}`).toBe(false);
      seen.add(p);
    }
  });

  it('every pattern is absolute (starts with /)', () => {
    for (const p of ROUTE_PATTERNS) {
      expect(p.startsWith('/'), `non-absolute pattern: ${p}`).toBe(true);
    }
  });
});
