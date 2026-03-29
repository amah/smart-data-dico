import type { PluginModule } from '@hamak/microkernel-spi';

export function createPerspectivePlugin(): PluginModule {
  return {
    async initialize(ctx) {
      ctx.views.register('routes.perspective', () => ({
        routes: ['/perspectives/**'],
      }));

      ctx.commands.register('perspective.refresh', async () => {
        ctx.hooks.emit('perspective:refresh-requested');
      });
    },

    async activate(ctx) {
      console.log('[perspective] Plugin activated');
    },
  };
}
