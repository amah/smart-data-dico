/**
 * Remote FS Plugin
 *
 * Registers @hamak/ui-remote-fs against the backend raw-fs mount (/fs/raw).
 * Per slice 6d, the backend exposes two semantic-explicit mounts over the
 * same workspace: /fs/raw (file-level, what the git plugin and file browser
 * see) and /fs/logical (projection-routed, entity-level). This plugin
 * addresses the raw view; a second plugin can be added when a consumer
 * needs the logical view.
 */

import type { PluginModule } from '@hamak/microkernel-spi';
import { createRemoteFsPlugin } from '@hamak/ui-remote-fs';
import { Pathway } from '@hamak/shared-utils';

export function createAppRemoteFsPlugin(): PluginModule {
  return createRemoteFsPlugin({
    workspaceId: 'dictionaries',
    mountPoint: Pathway.ofRoot().resolve('dictionaries'),
    baseUrl: '/fs/raw',
    autoReload: true,
    debug: import.meta.env.DEV,
  });
}
