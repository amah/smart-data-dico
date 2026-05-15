import type { PluginModule } from '@hamak/microkernel-spi';

export function createCasePlugin(): PluginModule {
  return {
    async initialize(ctx) {
      ctx.views.register('routes.case', () => ({
        routes: ['/cases/**'],
      }));
    },

    async activate() {
      console.log('[case] Plugin activated');
    },
  };
}
