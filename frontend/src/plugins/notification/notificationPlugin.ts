// frontend/src/plugins/notification/notificationPlugin.ts
//
// Thin adapter onto @hamak/notification. This plugin owns no notification
// state of its own — it delegates the whole concern to the framework
// factory and only fixes app-level configuration here.

import { createNotificationPlugin as createFrameworkNotificationPlugin } from '@hamak/notification';
import type { PluginModule } from '@hamak/microkernel-spi';
import type { NotificationPluginConfig } from '@hamak/notification/spi';

/**
 * App-level configuration for the notification plugin.
 *
 * Tuned for smart-data-dico's UI: top-right placement, 5s default
 * auto-dismiss, no localStorage persistence (notifications are
 * session-scoped feedback for save/commit/import flows).
 *
 * `maxNotifications` is intentionally omitted: setting it to any value
 * triggers a welcome notification on activate (framework behavior at
 * `frontend/node_modules/@hamak/notification/dist/impl/plugin/
 * notification-plugin-factory.js` lines 103-109 —
 * `if (config.maxNotifications !== undefined) { service.info(
 *   'Notification system ready', 'System', { duration: 3000, … }); }`).
 * We don't want that surfaced when the toast renderer lands in a
 * follow-up ticket. Framework default for `maxNotifications` is 50
 * (`spi/plugin/plugin-config.d.ts:17`), which is what we want anyway.
 */
const APP_NOTIFICATION_CONFIG: NotificationPluginConfig = {
  defaultDuration: 5000,
  position: 'top-right',
  enablePersistence: false,
};

/**
 * Factory used by `frontend/src/kernel/bootstrap.ts`.
 *
 * The returned `PluginModule` will, on `initialize`:
 *   1. `ctx.resolve(LOG_MANAGER_TOKEN)` — REQUIRES the logging plugin to
 *      have initialized first (see `bootstrap.ts` registration order).
 *   2. Provide `NOTIFICATION_SERVICE_TOKEN` via DI.
 *   3. Best-effort register `notificationReducer` under `state.notifications`
 *      via `Symbol.for('@hamak/ui-store:StoreExtensionsRegistry')` (which
 *      ui-store does provide — the slice WILL appear in `RootState`).
 *   4. Register the framework's seven `notification.*` commands with
 *      `(args: object)` signatures (NOT the legacy `(message: string)` form).
 *
 * On `activate`: emits `notification:ready` hook; does NOT emit a welcome
 * notification (suppressed by omitting `maxNotifications` above).
 */
export function createNotificationPlugin(): PluginModule {
  return createFrameworkNotificationPlugin(APP_NOTIFICATION_CONFIG);
}
