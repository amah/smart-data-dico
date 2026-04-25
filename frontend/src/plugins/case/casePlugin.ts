import type { PluginModule } from '@hamak/microkernel-spi';

export function createCasePlugin(): PluginModule {
  return {
    async initialize(ctx) {
      ctx.views.register('routes.case', () => ({
        routes: ['/cases/**'],
      }));

      ctx.commands.register('case.refresh', async () => {
        ctx.hooks.emit('case:refresh-requested');
      });
    },

    async activate() {
      console.log('[case] Plugin activated');
    },
  };
}
