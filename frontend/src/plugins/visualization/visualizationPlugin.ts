/**
 * Visualization Plugin
 *
 * Declares ownership of /diagram/** routes and the diagram Redux slice.
 */

import type { PluginModule } from '@hamak/microkernel-spi';

/**
 * Plugin factory options for the visualization plugin.
 * `workingFolder` is informational only; visualization has no Store FS state today.
 * Default: `['dictionaries']`.
 */
export interface VisualizationPluginOptions {
  workingFolder?: string[]; // default ['dictionaries']; informational
}

export function createVisualizationPlugin(options: VisualizationPluginOptions = {}): PluginModule {
  void options.workingFolder;
  return {
    async initialize(ctx) {
      ctx.views.register('routes.visualization', () => ({
        routes: [
          '/diagram/**',
        ],
      }));
    },

    async activate(_ctx) {
      console.log('[visualization] Plugin activated');
    },
  };
}
