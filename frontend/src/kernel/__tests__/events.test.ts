/**
 * Unit tests for kernel/events.ts — typed emit/on wrappers.
 *
 * Covers spec acceptance criterion (code-review item #4):
 *   - emit<K>(hooks, name, payload) calls ctx.hooks.emit(name, payload) so
 *     a registered on<K>(hooks, name, handler) receives the correct payload
 *     shape as a single positional argument.
 *   - For void-payload events: emit(hooks, name) calls hooks.emit(name)
 *     with no extra args; on handler receives no positional args.
 *
 * Risk 4 from the spec: "hooks.emit(event, ...a) accepts variadic args;
 * the typed wrapper passes a single payload object as the second arg."
 * These tests exercise that contract directly against a real
 * createHooks() instance from @hamak/microkernel-impl (not a hand-rolled
 * mock) so the round-trip is genuine.
 *
 * No host bootstrap needed — the emit/on wrappers operate on any object
 * satisfying the `Pick<Hooks, 'emit'|'on'>` shape.
 */

import { describe, it, expect, vi } from 'vitest';
import { createHooks } from '@hamak/microkernel-impl';
import { emit, on } from '../events';

describe('events — typed emit/on round-trip', () => {
  it('emit + on round-trip for object-payload event (stereotype.changed)', () => {
    const hooks = createHooks();
    const received: Array<{ id: string; op: string }> = [];

    on(hooks, 'stereotype.changed', (payload) => {
      received.push(payload);
    });

    emit(hooks, 'stereotype.changed', { id: 'x', op: 'create' });

    expect(received).toHaveLength(1);
    expect(received[0]).toEqual({ id: 'x', op: 'create' });
  });

  it('emit + on round-trip: handler receives exactly one arg (not spread)', () => {
    const hooks = createHooks();
    const handler = vi.fn();

    on(hooks, 'stereotype.changed', handler);
    emit(hooks, 'stereotype.changed', { id: 'y', op: 'update' });

    // Should be called with a single argument (the payload object), not spread
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ id: 'y', op: 'update' });
  });

  it('emit + on round-trip for import-export.committed payload', () => {
    const hooks = createHooks();
    let captured: unknown;

    on(hooks, 'import-export.committed', (payload) => {
      captured = payload;
    });

    emit(hooks, 'import-export.committed', {
      service: 'order-service',
      added: 3,
      merged: 1,
      unchanged: 5,
      removedInSource: 0,
      written: 4,
    });

    expect(captured).toEqual({
      service: 'order-service',
      added: 3,
      merged: 1,
      unchanged: 5,
      removedInSource: 0,
      written: 4,
    });
  });

  it('emit + on round-trip for quality.report.refreshed payload', () => {
    const hooks = createHooks();
    let captured: unknown;

    on(hooks, 'quality.report.refreshed', (payload) => {
      captured = payload;
    });

    emit(hooks, 'quality.report.refreshed', { service: 'user-service', overall: 87 });

    expect(captured).toEqual({ service: 'user-service', overall: 87 });
  });

  it('emit + on round-trip for void-payload event (auth:session-restored)', () => {
    const hooks = createHooks();
    const handler = vi.fn();

    on(hooks, 'auth:session-restored', handler);
    // No payload arg for void events
    emit(hooks, 'auth:session-restored');

    expect(handler).toHaveBeenCalledTimes(1);
    // handler receives no positional args (void payload)
    expect(handler).toHaveBeenCalledWith();
  });

  it('multiple on handlers for the same event all receive the payload', () => {
    const hooks = createHooks();
    const handlerA = vi.fn();
    const handlerB = vi.fn();

    on(hooks, 'stereotype.changed', handlerA);
    on(hooks, 'stereotype.changed', handlerB);

    emit(hooks, 'stereotype.changed', { id: 'z', op: 'delete' });

    expect(handlerA).toHaveBeenCalledWith({ id: 'z', op: 'delete' });
    expect(handlerB).toHaveBeenCalledWith({ id: 'z', op: 'delete' });
  });

  it('on handler registered AFTER emit does NOT receive the payload (no replay)', () => {
    const hooks = createHooks();
    const handler = vi.fn();

    emit(hooks, 'stereotype.changed', { id: 'early', op: 'create' });
    on(hooks, 'stereotype.changed', handler);

    expect(handler).not.toHaveBeenCalled();
  });
});
