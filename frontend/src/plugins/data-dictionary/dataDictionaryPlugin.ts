/**
 * Data Dictionary Plugin
 *
 * Declares ownership of /services/**, /dictionaries/** routes and
 * the services/entity/dictionary Redux slices. Components stay in
 * their current file locations — no file moves.
 */

import type { PluginModule } from '@hamak/microkernel-spi';

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
    },

    async activate(ctx) {
      console.log('[data-dictionary] Plugin activated');
    },
  };
}
