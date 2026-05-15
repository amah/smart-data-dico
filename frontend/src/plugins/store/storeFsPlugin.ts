// frontend/src/plugins/store/storeFsPlugin.ts
//
// Thin Store FS adapter plugin. Two responsibilities only:
//   1. Provide a StoreFileSystemFacade<RootState> via STORE_FS_TOKEN.
//   2. Stand up the autosave wiring (registry + middleware + remote-fs
//      provider) the framework ships but doesn't auto-wire.
//
// What this plugin does NOT do (deferred):
//   - Register additional FileSystemAdapter slices (framework already
//     registers one named 'fs' inside createStorePlugin; the dual
//     logical+raw slices from the 2026-05-11T21:58:08Z comment on #166
//     are out of scope until #167/#168 ship backend projection).
//   - Configure transformContent (the JSON-only assumption in the
//     framework's store-sync middleware is documented in Risk 1).

import type { PluginModule } from '@hamak/microkernel-spi';
import {
  STORE_MANAGER_TOKEN,
  STORE_EXTENSIONS_TOKEN,
  AUTOSAVE_REGISTRY_TOKEN,
  type IStoreManager,
  type FileSystemState,
  type StoreExtensionsRegistry,
} from '@hamak/ui-store-api';
import {
  StoreFileSystemFacade,
  AutosaveProviderRegistry,
  createAutosaveMiddleware,
  type FileSystemAdapter, // class — exported from @hamak/ui-store-impl, NOT api
} from '@hamak/ui-store-impl';
import {
  RemoteFsAutosaveProvider,
  PATH_TRANSLATOR_TOKEN,
  type IPathTranslator,
} from '@hamak/ui-remote-fs';
import { STORE_FS_TOKEN } from '../../kernel/tokens';
import type { RootState } from '../../kernel/bootstrap';

/**
 * Factory consumed by bootstrap.ts. Registered as plugin 'store-fs' with
 * `dependsOn: ['store', 'remote-fs']`.
 *
 * Lifecycle (verified at frontend/node_modules/@hamak/microkernel-impl/
 * dist/runtime/host.js:85-133): the host runs ALL plugins' `initialize` in
 * topological order, sets `this.rootActivationCtx`, then runs ALL plugins'
 * `activate` in the same order. There is no interleaving.
 *
 * Concrete ordering for this pilot:
 *
 *   store.initialize       (createStorePlugin registers 'fs' slice via
 *                          REDUCER_REGISTRY_TOKEN; verified at
 *                          store-plugin-factory.js:79)
 *   remote-fs.initialize   (provides PATH_TRANSLATOR_TOKEN at
 *                          remote-fs-plugin-factory.js:74)
 *   store-fs.initialize    (registers autosave middleware via
 *                          STORE_EXTENSIONS_TOKEN; provides
 *                          AUTOSAVE_REGISTRY_TOKEN; provides STORE_FS_TOKEN
 *                          as a lazy Proxy)
 *   data-dictionary.initialize (resolves STORE_FS_TOKEN — gets the Proxy —
 *                          stashes the reference for later use; does NOT
 *                          touch facade methods yet)
 *   store.activate         (applies STORE_EXTENSIONS — including our
 *                          autosave middleware — into the Redux store
 *                          before locking the middleware registry; verified
 *                          at store-plugin-factory.js:103 and
 *                          middleware-registry.js:44)
 *   remote-fs.activate
 *   store-fs.activate      (resolves the framework's 'fs'
 *                          FileSystemAdapter, constructs the facade,
 *                          assigns it into the Proxy's slot; resolves
 *                          PATH_TRANSLATOR_TOKEN and adds the
 *                          RemoteFsAutosaveProvider to the registry)
 *   data-dictionary.activate
 *
 * The autosave middleware MUST be registered in `initialize` because
 * `applyStoreExtensions` runs inside `store.activate` and locks the
 * middleware registry after consuming contributions. Registering from a
 * later activate would throw at middleware-registry.js:10-13. The lazy
 * Proxy pattern (below) is what lets us still provide STORE_FS_TOKEN at
 * initialize time so plugins that depend on us can resolve it before
 * activate fires.
 */
export function createAppStoreFsPlugin(): PluginModule {
  // Constructed once at factory time so the middleware closure (registered
  // in initialize) and the RemoteFsAutosaveProvider (added in activate)
  // see the SAME registry instance.
  const autosaveRegistry: AutosaveProviderRegistry =
    new AutosaveProviderRegistry();

  // Lazy slot for the facade. Assigned in `activate`; until then any access
  // through the Proxy below throws a clear error.
  let lazyStoreFs: StoreFileSystemFacade<RootState> | undefined;

  // Proxy provided via STORE_FS_TOKEN at initialize time. Forwards every
  // property access to `lazyStoreFs` once activate has run. Consumers that
  // store the Proxy reference (e.g. StereotypeService's constructor) never
  // touch facade methods until React mounts, by which point activate is
  // long since done.
  const storeFsProxy = new Proxy({} as StoreFileSystemFacade<RootState>, {
    get(_target, prop) {
      if (!lazyStoreFs) {
        throw new Error(
          `[store-fs] STORE_FS_TOKEN accessed (.${String(prop)}) before ` +
          `store-fs.activate completed. This indicates a plugin resolved ` +
          `STORE_FS_TOKEN and immediately called a method on it inside ` +
          `its own initialize. Move the call to activate, or defer it ` +
          `until React mount (services should stash the reference, not ` +
          `invoke methods, during plugin initialize).`,
        );
      }
      return (lazyStoreFs as unknown as Record<string | symbol, unknown>)[
        prop as string
      ];
    },
  });

  return {
    async initialize(ctx) {
      // 1. Register autosave middleware via STORE_EXTENSIONS_TOKEN.
      //    MUST happen in initialize so it lands before store.activate's
      //    applyStoreExtensions call (verified at store-plugin-factory.js:103;
      //    once the store's MiddlewareRegistry is locked, registration
      //    throws — middleware-registry.js:10-13).
      const extensions = ctx.resolve<StoreExtensionsRegistry>(
        STORE_EXTENSIONS_TOKEN,
      );
      extensions.register('store-fs', {
        middleware: [
          {
            id: 'autosave',
            // fsSliceName MUST be 'fs' (the slice name createStorePlugin
            // uses at store-plugin-factory.js:18). Framework default is
            // 'fileSystem' (autosave-middleware.js:78), which would
            // silently no-op against our state shape.
            middleware: createAutosaveMiddleware({
              registry: autosaveRegistry,
              fsSliceName: 'fs',
            }),
            priority: 20,
            plugin: 'store-fs',
            description: 'Routes Store FS edits to registered save providers',
          },
        ],
      });

      // 2. Provide the autosave registry now — domain plugins can
      //    register their own providers in their own initialize/activate.
      ctx.provide({
        provide: AUTOSAVE_REGISTRY_TOKEN,
        useValue: autosaveRegistry,
      });

      // 3. Provide STORE_FS_TOKEN as a Proxy. The real facade is constructed
      //    in activate (we need the FileSystemAdapter, which is reliably
      //    resolvable only post-initialize — remote-fs itself resolves the
      //    store manager in its activate, remote-fs-plugin-factory.js:83).
      ctx.provide({ provide: STORE_FS_TOKEN, useValue: storeFsProxy });
    },

    async activate(ctx) {
      // 4. Resolve the framework-created 'fs' adapter via the store manager.
      //    `getFileSystemAdapter()` is NOT in IStoreManager's public surface
      //    (verified at @hamak/ui-store-api/dist/api/store-manager.d.ts);
      //    it's on the impl class only (@hamak/ui-store-impl/dist/core/
      //    store-manager.js:30). The cast follows the precedent from
      //    remote-fs-plugin-factory.js:89.
      const storeManager = ctx.resolve<IStoreManager & {
        getFileSystemAdapter(): FileSystemAdapter | undefined;
      }>(STORE_MANAGER_TOKEN);
      const adapter = storeManager.getFileSystemAdapter();
      if (!adapter) {
        throw new Error(
          '[store-fs] FileSystemAdapter not found on store manager. ' +
          'Verify @hamak/ui-store-impl version provides it (>=0.5.5).',
        );
      }

      // 5. Build the facade reading from state.fs. The selector type must
      //    match `Selector<S, FileSystemState | undefined>` per
      //    fs-facade.d.ts:17. `state.fs` exists because
      //    store-plugin-factory.js:79 registers the adapter reducer under
      //    the 'fs' slice name.
      lazyStoreFs = new StoreFileSystemFacade<RootState>(
        (state: RootState) =>
          (state as RootState & { fs?: FileSystemState }).fs,
        adapter,
      );

      // 6. Resolve PATH_TRANSLATOR_TOKEN (provided by remote-fs at its
      //    initialize, remote-fs-plugin-factory.js:74). Add the
      //    RemoteFsAutosaveProvider — it claims any path whose
      //    pathTranslator.toRemotePath returns non-undefined, i.e. paths
      //    under the remote-fs mount point ('dictionaries').
      //
      //    See "Upstream framework bugs" below: the provider's `supports()`
      //    method is broken in the published framework build, but it is
      //    only invoked by autosave-middleware.js:255 inside the
      //    `set-file-content` / `update-file-content` action path
      //    (autosave-middleware.js:15-18). This pilot uses `setFile`
      //    exclusively for stereotype writes, so the broken `supports()`
      //    is never reached. Registration itself does not invoke
      //    `supports()` (autosave-registry.js:8-13).
      const pathTranslator = ctx.resolve<IPathTranslator>(
        PATH_TRANSLATOR_TOKEN,
      );
      autosaveRegistry.register(
        new RemoteFsAutosaveProvider({ pathTranslator }),
      );

      ctx.hooks.emit('store-fs:ready', {
        storeFs: lazyStoreFs,
        autosaveRegistry,
      });
    },
  };
}
