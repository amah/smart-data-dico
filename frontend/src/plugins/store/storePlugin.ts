/**
 * Store Plugin
 *
 * Creates and configures the Redux store via @hamak/ui-store.
 * This is the first plugin registered — all others depend on it.
 */

import { createStorePlugin, type StorePluginConfig } from '@hamak/ui-store';

export function createAppStorePlugin() {
  const storeConfig: StorePluginConfig = {
    devTools: import.meta.env.DEV,
    logger: false,
  };

  return createStorePlugin(storeConfig);
}
