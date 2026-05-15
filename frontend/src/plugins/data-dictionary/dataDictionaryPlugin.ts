/**
 * Data Dictionary Plugin
 *
 * Declares ownership of /services/**, /dictionaries/** routes and
 * the services/entity/dictionary Redux slices. Components stay in
 * their current file locations — no file moves.
 */

import type { PluginModule } from '@hamak/microkernel-spi';
import { STORE_MANAGER_TOKEN, type IStoreManager } from '@hamak/ui-store-api';
import type { StoreFileSystemFacade } from '@hamak/ui-store-impl';
import {
  STORE_FS_TOKEN,
  STEREOTYPE_SERVICE_TOKEN,
  INTEGRITY_SERVICE_TOKEN,
  DIFF_SERVICE_TOKEN,
  IMPORT_EXPORT_SERVICE_TOKEN,
} from '../../kernel/tokens';
import { StereotypeService, type NotifyFn } from './services/StereotypeService';
import { IntegrityService } from './services/IntegrityService';
import { DiffService } from './services/DiffService';
import { ImportExportService } from './services/ImportExportService';
import type { RootState } from '../../kernel/bootstrap';

// Module-scope mutable notify slot. `initialize` constructs the service with a
// stable forwarder lambda that resolves `notifyImpl` at call time; `activate`
// later swaps in the real implementation backed by `ctx.commands.run` (which
// is only available on `ActivateContext`, not on `InitializationContext`).
//
// TODO(post-#156-merge): when PR #171 lands and the in-house notificationPlugin
// is replaced by the framework factory, the `ctx.commands.run` call needs its
// signature changed from positional `(level, message)` to `(level, { message })`.
// Single-line edit in the `activate` handler below.
let notifyImpl: NotifyFn = () => {};

export function createDataDictionaryPlugin(): PluginModule {
  return {
    async initialize(ctx) {
      // Declare route ownership
      ctx.views.register('routes.data-dictionary', () => ({
        routes: [
          '/packages/**',
          '/services/**',
          '/dictionaries/**',
          '/create',
        ],
      }));

      // Register plugin commands
      ctx.commands.register('data-dictionary.refresh', async () => {
        ctx.hooks.emit('data-dictionary:refresh-requested');
      });

      // #166 pilot: register StereotypeService.
      // dependsOn in bootstrap.ts MUST include 'store-fs' so STORE_FS_TOKEN
      // is providable by the time we run. Resolution returns the Proxy
      // (storeFsPlugin.ts); the underlying facade is filled during
      // store-fs.activate, which runs BEFORE data-dictionary.activate AND
      // BEFORE any component mounts — so by the time StereotypeService
      // methods are called, the Proxy is fully wired.
      const storeFs = ctx.resolve<StoreFileSystemFacade<RootState>>(
        STORE_FS_TOKEN,
      );
      const storeManager = ctx.resolve<IStoreManager>(STORE_MANAGER_TOKEN);

      // Wire notification command best-effort via a stable forwarder that
      // resolves `notifyImpl` at call time. The real implementation is
      // installed during `activate` (see below) where `ctx.commands.run` is
      // available. If the notification plugin is not present (e.g. in test
      // bootstrap), the forwarder remains a no-op.
      const notify: NotifyFn = (level, message) => notifyImpl(level, message);

      const service = new StereotypeService(
        storeFs,
        (action) => storeManager.dispatch(action),
        () => storeManager.getState<RootState>(),
        notify,
      );
      ctx.provide({
        provide: STEREOTYPE_SERVICE_TOKEN,
        useValue: service,
      });

      // Pattern B (#155): no kernel deps — register a self-contained axios wrapper.
      ctx.provide({
        provide: INTEGRITY_SERVICE_TOKEN,
        useValue: new IntegrityService(),
      });

      // Pattern B (#155-diff): no kernel deps — register DiffService.
      ctx.provide({
        provide: DIFF_SERVICE_TOKEN,
        useValue: new DiffService(),
      });

      // Pattern B (#155): no kernel deps — register a self-contained axios wrapper.
      ctx.provide({
        provide: IMPORT_EXPORT_SERVICE_TOKEN,
        useValue: new ImportExportService(),
      });
    },

    async activate(ctx) {
      // Install the real notify implementation. `.run` is the framework's
      // command-execute method (NOT `.execute`). The args object shape
      // `{ message }` matches @hamak/notification's factory which registers
      // handlers as `(args) => { const { message, ... } = args; ... }`
      // (notification-plugin-factory.js, post-PR #171).
      notifyImpl = (level, message) => {
        try {
          ctx.commands.run(`notification.${level}`, { message });
        } catch {
          // Notification plugin not present in test bootstrap; swallow.
        }
      };
      console.log('[data-dictionary] Plugin activated');
    },
  };
}
