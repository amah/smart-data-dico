/**
 * Shell Plugin
 *
 * Provides the application shell (layout, theming, feature flags).
 * Maps theme config to DaisyUI's data-theme attribute.
 */

import { createShellPlugin } from '@hamak/ui-shell-impl';
import type { PluginModule } from '@hamak/microkernel-spi';

export function createAppShellPlugin(): PluginModule {
  const shellPlugin = createShellPlugin({
    theme: {
      mode: 'system',
    },
    features: {
      visualization: true,
      diagrams: true,
      versionControl: true,
      search: true,
      flatViews: true,
    },
  });

  // Wrap to sync DaisyUI theme
  return {
    async initialize(ctx) {
      await shellPlugin.initialize(ctx);
    },
    async activate(ctx) {
      await shellPlugin.activate(ctx);

      // Sync DaisyUI theme via data-theme attribute
      ctx.hooks.on('shell:theme-changed', (theme: string) => {
        const resolved = theme === 'system'
          ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
          : theme;
        document.documentElement.setAttribute('data-theme', resolved);
      });
    },
    async deactivate() {
      if (shellPlugin.deactivate) {
        await shellPlugin.deactivate();
      }
    },
  };
}
