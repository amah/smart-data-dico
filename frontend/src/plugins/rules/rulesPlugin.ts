import type { PluginModule } from '@hamak/microkernel-spi';

/**
 * Rules plugin (#74) — registers route surface and refresh command for the
 * validation rule browser. Storage and persistence are handled directly via
 * `ruleApi` from the components for v1 (no Redux slice yet).
 */
export function createRulesPlugin(): PluginModule {
  return {
    async initialize(ctx) {
      ctx.views.register('routes.rules', () => ({
        routes: ['/rules', '/rules/**'],
      }));
    },

    async activate() {
      // eslint-disable-next-line no-console
      console.log('[rules] Plugin activated');
    },
  };
}
