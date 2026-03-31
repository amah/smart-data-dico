/**
 * Remote FS Plugin
 *
 * Registers @hamak/ui-remote-fs, pointing to backend /fs endpoint.
 * Provides remote filesystem operations through the store middleware.
 */

import type { PluginModule } from '@hamak/microkernel-spi';
import { createRemoteFsPlugin } from '@hamak/ui-remote-fs';
import { Pathway } from '@hamak/shared-utils';

export function createAppRemoteFsPlugin(): PluginModule {
  return createRemoteFsPlugin({
    workspaceId: 'dictionaries',
    mountPoint: Pathway.ofRoot().resolve('dictionaries'),
    baseUrl: '/fs',
    autoReload: true,
    debug: import.meta.env.DEV,
  });
}
