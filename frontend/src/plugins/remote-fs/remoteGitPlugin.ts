/**
 * Remote Git Plugin
 *
 * Registers @hamak/ui-remote-git-fs-impl, pointing to backend /api/git endpoint.
 * Provides git operations (status, commit, log, diff) through the store middleware.
 */

import type { PluginModule } from '@hamak/microkernel-spi';
import { createGitPlugin } from '@hamak/ui-remote-git-fs-impl';
import { Pathway } from '@hamak/shared-utils';

export function createAppRemoteGitPlugin(): PluginModule {
  return createGitPlugin({
    workspaceId: 'dictionaries',
    mountPoint: Pathway.ofRoot().resolve('dictionaries'),
    gitApiBaseUrl: '/api/git',
    debug: import.meta.env.DEV,
  });
}
