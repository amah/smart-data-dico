/**
 * Application Bootstrap
 *
 * Configures and initializes the microkernel host with all required plugins.
 * The host manages plugin lifecycle and dependency injection.
 */

import { Host } from '@hamak/microkernel-impl';
import { STORE_MANAGER_TOKEN, REDUCER_REGISTRY_TOKEN } from '@hamak/ui-store-api';
import { createAppStorePlugin, createAppStoreFsPlugin } from '../plugins/store';
import { createAppShellPlugin } from '../plugins/shell/shellPlugin';
import { createAuthPlugin } from '../plugins/auth/authPlugin';
import { createDataDictionaryPlugin } from '../plugins/data-dictionary/dataDictionaryPlugin';
import { createVisualizationPlugin } from '../plugins/visualization/visualizationPlugin';
import { createSearchPlugin } from '../plugins/search/searchPlugin';
import { createAppRemoteFsPlugin } from '../plugins/remote-fs/remoteFsPlugin';
import { createGitPlugin } from '../plugins/git/gitPlugin';
import { createNotificationPlugin } from '../plugins/notification/notificationPlugin';
import { createLoggingPlugin } from '../plugins/logging/loggingPlugin';
import { createAiAssistancePlugin } from '../plugins/ai-assistance/aiPlugin';
import type { IStoreManager } from '@hamak/ui-store-api';

// Domain Redux slices
import authReducer from '../store/slices/authSlice';
import servicesReducer from '../store/slices/servicesSlice';
import entityReducer from '../store/slices/entitySlice';
import dictionaryReducer from '../store/slices/dictionarySlice';
import diagramReducer from '../store/slices/diagramSlice';
import packagesReducer from '../store/slices/packagesSlice';
import stereotypesReducer from '../store/slices/stereotypesSlice';
import casesReducer from '../plugins/data-dictionary/slices/casesSlice';
import rulesReducer from '../plugins/data-dictionary/slices/rulesSlice';

/**
 * Create and configure the microkernel host
 */
export const host = new Host([], undefined, { debug: false });

/**
 * Track bootstrap state to prevent double initialization
 * (e.g., from React.StrictMode in development)
 */
let isBootstrapped = false;

/**
 * Plugin `dependsOn` convention.
 *
 * `dependsOn` lists every plugin whose DI token this plugin resolves at
 * `initialize` or `activate`. The microkernel uses these names solely for
 * topological ordering of `initialize` and `activate` (graph-utils.js:10).
 * They are NOT enforcement — a missing token surfaces only as a runtime
 * `No provider for token: …` throw from container.resolve (di.js:63).
 *
 * Out of scope of this declaration:
 *   - `ctx.commands.run(...)` callers — command bus is name-keyed, loose.
 *   - `ctx.hooks.on(...)` listeners — listeners survive without emitter.
 *   - Best-effort `ctx.resolve` calls wrapped in try/catch.
 *
 * Smoke test enforcing this convention: src/__tests__/plugin-dependency-graph.test.ts.
 */

/**
 * Register all application plugins
 */
export function registerPlugins() {
  // Store plugin — must be registered first (others depend on it)
  const storePlugin = createAppStorePlugin();

  // Wrap the store plugin to register domain reducers after initialization
  const wrappedStorePlugin = {
    async initialize(ctx: any) {
      await storePlugin.initialize(ctx);

      // Register domain reducers
      const reducerRegistry = ctx.resolve(REDUCER_REGISTRY_TOKEN);
      if (reducerRegistry) {
        reducerRegistry.register('auth', authReducer);
        reducerRegistry.register('services', servicesReducer);
        reducerRegistry.register('entity', entityReducer);
        reducerRegistry.register('dictionary', dictionaryReducer);
        reducerRegistry.register('diagram', diagramReducer);
        reducerRegistry.register('packages', packagesReducer);
        reducerRegistry.register('stereotypes', stereotypesReducer);
        reducerRegistry.register('cases', casesReducer);
        reducerRegistry.register('rules', rulesReducer);
      }
    },
    async activate(ctx: any) {
      await storePlugin.activate(ctx);
    },
    async deactivate() {
      if (storePlugin.deactivate) {
        await storePlugin.deactivate();
      }
    },
  };

  host.registerPlugin(
    'store',
    { name: 'store', version: '1.0.0', entry: '' },
    wrappedStorePlugin
  );

  // Shell plugin — no DI token resolves (ShellPluginFactory has zero ctx.resolve calls)
  host.registerPlugin(
    'shell',
    { name: 'shell', version: '1.0.0', entry: '' },
    createAppShellPlugin()
  );

  // Auth plugin — no DI token resolves (only provides AUTH_SERVICE_TOKEN)
  host.registerPlugin(
    'auth',
    { name: 'auth', version: '1.0.0', entry: '' },
    createAuthPlugin()
  );

  // Feature plugins (depends on: store, store-fs, git) — 'auth' dropped: AUTH_SERVICE_TOKEN never resolved
  host.registerPlugin(
    'data-dictionary',
    { name: 'data-dictionary', version: '1.0.0', entry: '', dependsOn: ['store', 'store-fs', 'git'] },
    createDataDictionaryPlugin({ workingFolder: ['dictionaries'] })
  );

  // Visualization plugin — no DI token resolves (only registers routes)
  host.registerPlugin(
    'visualization',
    { name: 'visualization', version: '1.0.0', entry: '' },
    createVisualizationPlugin({ workingFolder: ['dictionaries'] })
  );

  host.registerPlugin(
    'search',
    { name: 'search', version: '1.0.0', entry: '', dependsOn: ['store', 'store-fs'] },
    createSearchPlugin({ workingFolder: ['dictionaries', '.dico', 'search'] })
  );

  // Remote FS plugin (depends on: store)
  host.registerPlugin(
    'remote-fs',
    { name: 'remote-fs', version: '1.0.0', entry: '', dependsOn: ['store'] },
    createAppRemoteFsPlugin()
  );

  // Store FS plugin — provides STORE_FS_TOKEN over the 'dictionaries' workspace.
  // Depends on: store (STORE_EXTENSIONS_TOKEN, STORE_MANAGER_TOKEN),
  //             remote-fs (PATH_TRANSLATOR_TOKEN).
  host.registerPlugin(
    'store-fs',
    { name: 'store-fs', version: '1.0.0', entry: '', dependsOn: ['store', 'remote-fs'] },
    createAppStoreFsPlugin()
  );

  // Git plugin — wraps @hamak/ui-remote-git-fs with our Pattern B GitService.
  // Provides GIT_SERVICE_TOKEN. Renamed from remote-git in #160.
  // 'remote-fs' dropped: git-plugin-factory constructs its own GitPathTranslator,
  // does NOT resolve PATH_TRANSLATOR_TOKEN from remote-fs.
  host.registerPlugin(
    'git',
    { name: 'git', version: '1.0.0', entry: '', dependsOn: ['store'] },
    createGitPlugin()
  );

  // Logging plugin (no dependencies; must be registered before notification)
  host.registerPlugin(
    'logging',
    { name: 'logging', version: '1.0.0', entry: '' },
    createLoggingPlugin()
  );

  // Notification plugin — resolves LOG_MANAGER_TOKEN (hard); 'store' dropped:
  // Symbol.for('@hamak/ui-store:StoreExtensionsRegistry') != Symbol('StoreExtensions')
  // so the store extension is silently skipped in a try/catch (pre-existing bug, Risk 2).
  host.registerPlugin(
    'notification',
    { name: 'notification', version: '1.0.0', entry: '', dependsOn: ['logging'] },
    createNotificationPlugin()
  );

  // AI Assistance plugin (#162) — no DI token resolves (only provides AI_SERVICE_TOKEN).
  // ShellLayout's flag-check is the runtime gate. See spec #162 Risk 3.
  // 'store', 'auth', 'data-dictionary' dropped: aiPlugin.ts has zero ctx.resolve calls.
  host.registerPlugin(
    'ai-assistance',
    { name: 'ai-assistance', version: '1.0.0', entry: '' },
    createAiAssistancePlugin({ enabled: true }),
  );
}

/**
 * Bootstrap the application
 * Initializes all plugins and returns true on success
 */
export async function bootstrapApplication(): Promise<boolean> {
  if (isBootstrapped) {
    console.log('[Bootstrap] Already bootstrapped, skipping...');
    return true;
  }

  try {
    console.log('[Bootstrap] Registering plugins...');
    registerPlugins();

    console.log('[Bootstrap] Bootstrapping microkernel...');
    await host.bootstrapAllAtRoot();

    isBootstrapped = true;
    console.log('[Bootstrap] Application ready');
    return true;
  } catch (error) {
    console.error('[Bootstrap] Failed to bootstrap application:', error);
    throw error;
  }
}

/**
 * Get the Redux store from the store manager.
 * Must be called after bootstrapApplication().
 */
export function getStore() {
  const ctx = host.rootActivationCtx;
  if (!ctx) {
    throw new Error('Application not bootstrapped');
  }

  const storeManager = ctx.resolve(STORE_MANAGER_TOKEN) as IStoreManager;
  if (!storeManager) {
    throw new Error('Store manager not available');
  }

  return storeManager.getStore();
}

// Type exports for Redux
export type RootState = ReturnType<ReturnType<typeof getStore>['getState']>;
export type AppDispatch = ReturnType<typeof getStore>['dispatch'];
