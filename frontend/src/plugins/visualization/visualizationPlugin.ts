/**
 * Visualization Plugin
 *
 * Declares ownership of /visualization/**, /diagram/** routes
 * and the diagram Redux slice.
 */

import type { PluginModule } from '@hamak/microkernel-spi';

export function createVisualizationPlugin(): PluginModule {
  return {
    async initialize(ctx) {
      ctx.views.register('routes.visualization', () => ({
        routes: [
          '/visualization/**',
          '/diagram/**',
          '/organization-diagram',
        ],
      }));
    },

    async activate(ctx) {
      console.log('[visualization] Plugin activated');
    },
  };
}
