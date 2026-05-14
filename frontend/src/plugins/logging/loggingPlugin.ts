// frontend/src/plugins/logging/loggingPlugin.ts
//
// Thin adapter onto @hamak/logging. Required as a precursor to the
// notification plugin (whose `initialize` resolves LOG_MANAGER_TOKEN
// unconditionally — see notification-plugin-factory.js:33). Owns no
// logging implementation of its own.

import { createLoggingPlugin as createFrameworkLoggingPlugin } from '@hamak/logging';
import type { PluginModule } from '@hamak/microkernel-spi';
import type { LoggingPluginConfig } from '@hamak/logging';

/**
 * App-level configuration for the logging plugin.
 *
 * Empty config object — the framework's defaults are appropriate for
 * smart-data-dico:
 *   - `globalLevel`: DEBUG in dev (NODE_ENV === 'development'), INFO in
 *     prod (logging-plugin-factory.js:31-36).
 *   - `devFormatter`: rich console output in dev, JSON in prod.
 *   - `interceptConsole: true` — `console.log/warn/error` calls are
 *     routed through the logging system (logging-plugin-factory.js:39).
 *     This is acceptable for smart-data-dico; existing code uses
 *     `console.log('[Bootstrap] …')` style strings that will continue to
 *     surface as log lines.
 *
 * If any of these defaults need overriding later (e.g. silencing logs
 * in test environments), set the field here.
 */
const APP_LOGGING_CONFIG: LoggingPluginConfig = {};

/**
 * Factory used by `frontend/src/kernel/bootstrap.ts`. Must be registered
 * before the notification plugin (and before any other plugin that
 * resolves `LOG_MANAGER_TOKEN`).
 */
export function createLoggingPlugin(): PluginModule {
  return createFrameworkLoggingPlugin(APP_LOGGING_CONFIG);
}
