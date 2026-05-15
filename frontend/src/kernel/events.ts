// frontend/src/kernel/events.ts
//
// Typed event map for `ctx.hooks`. Slice 1 keeps the surface narrow — only
// events that the five DI'd services actually emit. New keys land alongside
// the slices that emit them (e.g. #166 adds `entity.created` etc.).

import type { Hooks } from '@hamak/microkernel-api';

export interface EventMap {
  /** Emitted after a stereotype create / update / delete succeeds. */
  'stereotype.changed': { id: string; op: 'create' | 'update' | 'delete' };

  /**
   * Emitted after a successful SQL-DDL or JSON-Schema import commit. Carries
   * the targetService so downstream listeners (e.g. quality re-fetch) can
   * scope their refresh.
   */
  'import-export.committed': {
    service: string;
    added: number;
    merged: number;
    unchanged: number;
    removedInSource: number;
    written: number;
  };

  /**
   * Emitted after the quality report is fetched. Slice 1 fires this from the
   * command handler so the HomePage overall-score widget can react without
   * cross-importing the service.
   */
  'quality.report.refreshed': { service?: string; overall: number };

  /**
   * Pre-existing (kept). Emitted by `shellPlugin` when DaisyUI theme syncs.
   */
  'shell:theme-changed': string;

  /**
   * Pre-existing (kept). Emitted once by `authPlugin` after session restore.
   * No listener yet — kept because removing it is out of #163's scope (the
   * auth plugin owns it).
   */
  'auth:session-restored': void;

  /**
   * Pre-existing (kept). Emitted once by `storeFsPlugin` after the Store FS
   * facade is fully wired. No current listener; kept because this is exactly
   * the kind of bootstrap-coordination signal future plugins may need.
   */
  'store-fs:ready': { workspace: string };
}

export type EventName = keyof EventMap;

/**
 * Typed emit. Wraps `ctx.hooks.emit(name, payload)`. Returns void.
 *
 * Note: hooks.emit signature is `(event, ...args)` per
 * `@hamak/microkernel-api/dist/types.d.ts` (verified — Hooks.emit takes
 * rest args). We pass a single payload object, which arrives at the handler
 * as `(payload) => …`. For events whose EventMap value is `void`, callers
 * omit the second argument and the wrapper passes nothing.
 */
export function emit<K extends EventName>(
  hooks: Pick<Hooks, 'emit'>,
  name: K,
  ...args: EventMap[K] extends void ? [] : [EventMap[K]]
): void {
  hooks.emit(name, ...args);
}

/**
 * Typed on. Wraps `ctx.hooks.on(name, handler)`. The framework's `Hooks` type
 * does NOT return a disposer (verified at
 * `@hamak/microkernel-impl/dist/runtime/registries.js` — `on(e, f) {
 * map.get(e).add(f); }` returns void). Callers that need teardown use
 * `hooks.off(name, fn)` directly. This wrapper returns void to match.
 */
export function on<K extends EventName>(
  hooks: Pick<Hooks, 'on'>,
  name: K,
  handler: EventMap[K] extends void ? () => void : (payload: EventMap[K]) => void,
): void {
  hooks.on(name, handler as (...a: any[]) => void);
}
