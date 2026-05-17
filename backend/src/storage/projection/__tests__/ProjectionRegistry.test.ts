/**
 * ProjectionRegistry.test.ts — #167 slice 6d acceptance criteria (PR-T1..PR-T3)
 *
 * The registry just stores whatever object is passed; no projection
 * construction or backend wiring is needed. Mirrors the slice-6c
 * `UuidIndex.test.ts:505-522` T13 pattern.
 */

import { wsId } from '../../contract/types.js';
import type { LogicalProjection } from '../LogicalProjection.js';
import {
  registerProjection,
  getProjection,
  resetProjectionRegistry,
} from '../ProjectionRegistry.js';

// Stub — the registry only stores the reference; it never invokes methods.
const stubProjection = {} as unknown as LogicalProjection;

beforeEach(() => {
  resetProjectionRegistry();
});

afterEach(() => {
  resetProjectionRegistry();
});

// ─────────────────────────────────────────────────────────────────────────────
// PR-T1 — getProjection throws "not registered" before any register call
// ─────────────────────────────────────────────────────────────────────────────

describe('PR-T1: getProjection throws before any register call', () => {
  it('throws an Error whose message matches /not registered/', () => {
    expect(() => getProjection(wsId('foo'))).toThrow(/not registered/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PR-T2 — After registerProjection(ws, p), getProjection(ws) === p (identity)
// ─────────────────────────────────────────────────────────────────────────────

describe('PR-T2: getProjection returns the exact registered instance', () => {
  it('returns the SAME reference passed to registerProjection (identity check)', () => {
    const ws = wsId('foo');
    registerProjection(ws, stubProjection);
    expect(getProjection(ws)).toBe(stubProjection);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PR-T3 — After resetProjectionRegistry(), getProjection(ws) throws again
// ─────────────────────────────────────────────────────────────────────────────

describe('PR-T3: resetProjectionRegistry clears all registered projections', () => {
  it('after reset, a previously-registered workspace lookup throws /not registered/', () => {
    const ws = wsId('foo');
    registerProjection(ws, stubProjection);
    // Sanity: registered.
    expect(getProjection(ws)).toBe(stubProjection);

    resetProjectionRegistry();

    expect(() => getProjection(ws)).toThrow(/not registered/);
  });
});
