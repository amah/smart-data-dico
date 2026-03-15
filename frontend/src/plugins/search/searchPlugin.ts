/**
 * Search Plugin
 *
 * Declares ownership of /search, /entities/flat routes
 * and the search Redux slice.
 */

import type { PluginModule } from '@hamak/microkernel-spi';

export function createSearchPlugin(): PluginModule {
  return {
    async initialize(ctx) {
      ctx.views.register('routes.search', () => ({
        routes: [
          '/search',
          '/entities/flat',
          '/flat/**',
          '/tree/**',
        ],
      }));
    },

    async activate(ctx) {
      console.log('[search] Plugin activated');
    },
  };
}
