/**
 * Git Plugin
 *
 * Composes the framework git plugin (transport: middleware + GIT_CLIENT_TOKEN
 * registration) with our Pattern B GitService facade (Promise-returning
 * methods that the UI consumes via useCommand). The framework plugin is
 * invoked first; we then run our own initialize + activate on top.
 *
 * Framework reference:
 *   - dist/impl/plugin/git-plugin-factory.js  (returns PluginModule with
 *     initialize/activate/deactivate; registers GIT_CLIENT_TOKEN +
 *     GIT_PATH_TRANSLATOR_TOKEN via ctx.provide, emits 'ui-remote-git-fs:ready'
 *     on activate).
 *   - dist/api/tokens.js  (GIT_SERVICE_TOKEN is *exported* but NOT
 *     registered by the framework — we own it via our local token).
 */

import type { PluginModule } from '@hamak/microkernel-spi';
import { createGitPlugin as createFrameworkGitPlugin } from '@hamak/ui-remote-git-fs';
import { Pathway } from '@hamak/shared-utils';
import { GIT_SERVICE_TOKEN } from '../../kernel/tokens';
import { GitService } from './services/GitService';

export function createGitPlugin(): PluginModule {
  const framework = createFrameworkGitPlugin({
    workspaceId: 'dictionaries',
    mountPoint: Pathway.ofRoot().resolve('dictionaries'),
    gitApiBaseUrl: '/api/git',
    debug: import.meta.env.DEV,
  });

  return {
    async initialize(ctx) {
      await framework.initialize!(ctx);
      ctx.provide({ provide: GIT_SERVICE_TOKEN, useValue: new GitService() });
    },
    async activate(ctx) {
      if (framework.activate) await framework.activate(ctx);
    },
    async deactivate() {
      if (framework.deactivate) await framework.deactivate();
    },
  };
}
