/**
 * Version Control Plugin
 *
 * Declares ownership of /version/** routes
 * and the version Redux slice.
 */

import type { PluginModule } from '@hamak/microkernel-spi';

export function createVersionControlPlugin(): PluginModule {
  return {
    async initialize(ctx) {
      ctx.views.register('routes.version-control', () => ({
        routes: [
          '/version/**',
        ],
      }));

      ctx.commands.register('version.commit', async (message: string) => {
        ctx.hooks.emit('version:commit-requested', { message });
      });
    },

    async activate(ctx) {
      console.log('[version-control] Plugin activated');
    },
  };
}
