/**
 * #156 — Acceptance #6 and #7 — framework-backed notification plugin
 *
 * Bootstraps a real microkernel Host with our notification plugin alongside
 * the framework logging plugin (a precursor required by the framework
 * notification factory which resolves LOG_MANAGER_TOKEN unconditionally —
 * see frontend/node_modules/@hamak/notification/dist/impl/plugin/
 * notification-plugin-factory.js:33).
 *
 * Test surface is the public DI-resolved INotificationService — we do not
 * touch the framework's NotificationService class internals.
 *
 * Hygiene mitigations (forwarded from dev-notes.md "Notes for test-author"
 * and spec-review-cycle-2.md non-blocking suggestions):
 *
 *  1. `LogManager.flushTimer` open handle: the framework's LogManager
 *     constructor starts a `setInterval` only when `flushInterval > 0`
 *     (frontend/node_modules/@hamak/logging/dist/impl/core/log-manager.js:60).
 *     We register the framework logging plugin directly with
 *     `flushInterval: 0` to suppress the interval entirely, so Vitest does
 *     not warn about open handles after `bootstrapAllAtRoot()`.
 *
 *  2. `interceptConsole` × `ConsoleTransport` recursion on ERROR: same
 *     test-local logging override sets `interceptConsole: false`, which
 *     keeps `console.error` un-wrapped (logging-plugin-factory.js:90-94 is
 *     guarded by this flag).
 *
 * This means the test exercises the real production notification plugin
 * (`createNotificationPlugin` from `../notificationPlugin`) AGAINST the
 * framework's real logging plugin, with the logging plugin's transport-
 * timing and console-interception turned off. The framework owns the
 * logging plugin; the production wrapper at
 * `frontend/src/plugins/logging/loggingPlugin.ts` is a near-empty
 * delegator, so swapping it out for the underlying framework factory in
 * this test does not weaken coverage of #156's subject.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Host } from '@hamak/microkernel-impl';
import { createLoggingPlugin as createFrameworkLoggingPlugin } from '@hamak/logging';
import { LOG_MANAGER_TOKEN } from '@hamak/logging/api';
import { NOTIFICATION_SERVICE_TOKEN } from '@hamak/notification/api';
import type { INotificationService, INotification } from '@hamak/notification/api';
import { createNotificationPlugin } from '../notificationPlugin';

/** Plugin manifest helper — keeps the test bodies focused on assertions. */
const manifest = (name: string, dependsOn?: string[]) => ({
  name,
  version: '1.0.0',
  entry: '',
  ...(dependsOn ? { dependsOn } : {}),
});

/**
 * Build a Host with [logging, notification] registered in order.
 *
 * Returns the bootstrapped host. Caller must dispose via the returned
 * `dispose()` to satisfy the open-handle hygiene contract above.
 */
async function bootstrapNotificationHost(): Promise<{
  host: Host;
  service: INotificationService;
  dispose: () => Promise<void>;
}> {
  const host = new Host([], undefined, { debug: false });

  // Framework logging plugin with hygiene overrides — see file-level comment.
  host.registerPlugin(
    'logging',
    manifest('logging'),
    createFrameworkLoggingPlugin({ interceptConsole: false, flushInterval: 0 })
  );

  // Production notification plugin — the subject of #156. dependsOn mirrors
  // the production bootstrap.ts manifest at lines 152-156.
  host.registerPlugin(
    'notification',
    manifest('notification', ['logging']),
    createNotificationPlugin()
  );

  await host.bootstrapAllAtRoot();

  const ctx = host.rootActivationCtx!;
  const service = ctx.resolve<INotificationService>(NOTIFICATION_SERVICE_TOKEN);

  return {
    host,
    service,
    dispose: async () => {
      // Best-effort teardown — Host has no public `deactivate()`, so we
      // resolve the LogManager directly and call its `destroy()`. This is
      // belt-and-braces given `flushInterval: 0` already suppresses the
      // interval; the call still drains buffered transports.
      try {
        const lm = ctx.resolve<{ destroy: () => Promise<void> }>(LOG_MANAGER_TOKEN);
        if (lm && typeof lm.destroy === 'function') {
          await lm.destroy();
        }
      } catch {
        // If LOG_MANAGER_TOKEN didn't get provided (bootstrap failure),
        // there's nothing to clean up — let the original failure surface.
      }
    },
  };
}

describe('notificationPlugin (framework-backed, #156)', () => {
  let disposeFn: (() => Promise<void>) | undefined;

  beforeEach(() => {
    disposeFn = undefined;
  });

  afterEach(async () => {
    if (disposeFn) {
      await disposeFn();
      disposeFn = undefined;
    }
  });

  it('resolves an INotificationService via DI with all 9 methods', async () => {
    const { service, dispose } = await bootstrapNotificationHost();
    disposeFn = dispose;

    expect(service).toBeTruthy();

    // The framework's INotificationService surface
    // (frontend/node_modules/@hamak/notification/dist/api/interfaces/
    //  notification-service.d.ts). All nine methods must exist.
    const methods = [
      'notify',
      'info',
      'success',
      'warning',
      'error',
      'dismiss',
      'dismissAll',
      'getAll',
      'subscribe',
    ] as const;

    for (const m of methods) {
      expect(typeof (service as unknown as Record<string, unknown>)[m]).toBe('function');
    }
  });

  it('omits maxNotifications, suppressing the welcome notification (#7)', async () => {
    // Production APP_NOTIFICATION_CONFIG deliberately omits `maxNotifications`.
    // The framework's welcome notification fires only when that field is
    // defined (notification-plugin-factory.js:103-109). So immediately after
    // bootstrap — before any explicit caller — getAll() must be empty.
    const { service, dispose } = await bootstrapNotificationHost();
    disposeFn = dispose;

    expect(service.getAll()).toHaveLength(0);
  });

  it('records a notification, notifies subscribers, applies defaultDuration=5000', async () => {
    const { service, dispose } = await bootstrapNotificationHost();
    disposeFn = dispose;

    const listener = vi.fn();
    service.subscribe(listener);

    service.success('hello');

    // subscribe() fires once per state change (notification-service.js:182-190
    // / notifyListeners() at 223-233). One success() → exactly one call.
    expect(listener).toHaveBeenCalled();
    const lastCall = listener.mock.calls[listener.mock.calls.length - 1][0] as
      | INotification[]
      | undefined;
    expect(Array.isArray(lastCall)).toBe(true);
    expect(lastCall).toHaveLength(1);
    expect(lastCall![0]).toMatchObject({ type: 'success', message: 'hello' });

    const all = service.getAll();
    expect(all).toHaveLength(1);

    // APP_NOTIFICATION_CONFIG.defaultDuration === 5000 — assert it surfaces
    // on the recorded notification (notification-service.js:64-72 spreads
    // `duration: defaultDuration` before the caller-supplied notification,
    // and success('hello') passes no duration, so 5000 is preserved).
    expect(all[0].duration).toBe(5000);
    expect(all[0].type).toBe('success');
    expect(all[0].message).toBe('hello');
  });
});
