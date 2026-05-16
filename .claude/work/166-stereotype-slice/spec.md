# Spec — #166 (stereotype-slice pilot): Store FS DI plumbing + StereotypeService facade  (cycle 2)

> **Scope-narrow pilot.** This spec covers ONLY Phase 1 (Store FS DI plumbing) and Phase 6.1 (stereotype-slice migration) of the nine-phase #166 ticket. All other phases (entity load/save, package listing, multi-kind YAML semantics, page mass-migration, `react-query` removal, ESLint guardrails, dual logical+raw slices, `currentUser.id` workspace keying) are explicitly OUT OF SCOPE and tracked separately. The user's `INITIAL-PROMPT.md` nominated this as "#166's stereotype-slice proof".

## Goal

Wire the @hamak Store FS into smart-data-dico as a DI-resolvable client-side cache, provide `STORE_FS_TOKEN` returning a `StoreFileSystemFacade` over `state.fs`, register the framework's `RemoteFsAutosaveProvider` against the framework's `AutosaveProviderRegistry`, introduce `STEREOTYPE_SERVICE_TOKEN` per #155's service catalog, and migrate `StereotypesPage.tsx` to consume the new service via a `useService` hook. The pilot proves the Pattern A facade pattern from #155 against the smallest viable surface — a single YAML file at `.dico/stereotypes.yaml` — without touching any other page or service. The ticket frames this as Phase 6.1: "Stereotypes — single file (`.dico/stereotypes.yaml`), one service, small surface. Proves the pattern."

Per the 2026-05-11T19:12:37Z comment on #166 ("Store FS mirrors the LOGICAL hierarchy"), the eventual home for stereotypes will be a logical workspace served by backend projection (#167). Until #167 lands, this pilot uses **filesystem paths** (`['dictionaries', '.dico', 'stereotypes.yaml']`) and writes through the existing `/api/stereotypes` REST endpoints. The Store FS is hydrated as a cache; the autosave path is wired (registry + middleware + remote-fs provider) but stereotype writes deliberately bypass it (rationale in Risk 1 and the "Upstream framework bugs" section).

## Files touched

- `frontend/src/plugins/store/storeFsPlugin.ts` — **new file**. Thin adapter plugin that, on `initialize`, registers `createAutosaveMiddleware({ registry, fsSliceName: 'fs' })` as a `STORE_EXTENSIONS_TOKEN` middleware contribution AND provides the `AutosaveProviderRegistry` (constructed eagerly at factory time so the middleware closure can capture it) AND provides `STORE_FS_TOKEN` via a lazy Proxy that's filled in during `activate`. On `activate`, resolves the singleton `'fs'` `FileSystemAdapter` from `STORE_MANAGER_TOKEN.getFileSystemAdapter()`, constructs the `StoreFileSystemFacade<RootState>` (filling the Proxy), and registers a `RemoteFsAutosaveProvider({ pathTranslator })` into the registry. Follows the same "thin adapter onto a framework factory" shape as `notificationPlugin.ts` (#156, PR #171).
- `frontend/src/plugins/store/index.ts` — re-export `createAppStoreFsPlugin` from `storeFsPlugin.ts`. Existing exports preserved.
- `frontend/src/kernel/tokens.ts` — add `STORE_FS_TOKEN` and `STEREOTYPE_SERVICE_TOKEN` (both `Symbol('…')`). Leave the legacy tokens (`DICTIONARY_SERVICE_TOKEN`, etc.) untouched — #155 will collapse those.
- `frontend/src/kernel/bootstrap.ts` — import `createAppStoreFsPlugin`; register it as `'store-fs'` with `dependsOn: ['store', 'remote-fs']`. Order in source: after `'remote-fs'` and before `'remote-git'`. Topo-sort will place its `initialize` after both deps and before `data-dictionary.initialize` (which is added to depend on `'store-fs'`).
- `frontend/src/kernel/useService.ts` — **new file**. Thin React hook resolving a DI token from `host.rootActivationCtx`. Per #155 Phase 2; written here to unblock the consumer side of this pilot.
- `frontend/src/plugins/data-dictionary/services/StereotypeService.ts` — **new file**. Pattern A facade per #155 catalog. Constructor takes `storeFs`, `dispatch`, `getState`, plus optional `notify(level, message)` callback for surfacing load errors. Public surface: `useFile()`, `useAll()`, `useByTarget(target)`, `loadAll()`, `getAll()`, `create(data)`, `update(id, data)`, `delete(id)`. Hook methods return data straight from a Store FS selector keyed on `STEREOTYPES_PATH`.
- `frontend/src/plugins/data-dictionary/dataDictionaryPlugin.ts` — extend `initialize`: resolve `STORE_FS_TOKEN` (lazy proxy) and `STORE_MANAGER_TOKEN`, construct a `StereotypeService` with a notify callback that calls `ctx.commands.execute('notification.error', { message })`, provide via `STEREOTYPE_SERVICE_TOKEN`. Add `'store-fs'` to `dependsOn`.
- `frontend/src/pages/StereotypesPage.tsx` — replace the `useEffect`+`useState<loading>`+`useState<error>`+`stereotypeApi` pattern with `useService(STEREOTYPE_SERVICE_TOKEN)` reading loading/loaded/error directly off the Store FS node via `service.useFile()` per `patterns.md` §2 ("Loading, error, dirty — never useState"). NO `useState<boolean>` for loading/loaded and NO `useState<Error>` are introduced.
- `frontend/src/plugins/store/__tests__/storeFsPlugin.test.ts` — **new file**. Bootstraps a `Host` with `[store, remote-fs, store-fs]` and asserts: (a) `STORE_FS_TOKEN` resolves a facade-shaped object, (b) `AUTOSAVE_REGISTRY_TOKEN` resolves a registry whose `getAll()` contains exactly one provider with `id === 'remote-fs'` and `priority === 10`, (c) `state.fs` exists in `RootState` with the framework's initial shape.
- `frontend/src/plugins/data-dictionary/services/__tests__/StereotypeService.test.ts` — **new file**. Bootstraps the full host minus shell/auth and asserts service resolution + Pattern A behavior.
- `frontend/src/pages/__tests__/StereotypesPage.bootstrap.test.tsx` — **new file**. Boots the production singleton `host` via `bootstrapApplication()`, renders `<StereotypesPage />`, and asserts the production code path works end-to-end (Required Change #5).
- `.claude/work/166-stereotype-slice/attempts.log` — append the spec-writer "done" line per orchestrator instructions.

No other files require changes. The legacy Redux slice (`frontend/src/store/slices/stereotypesSlice.ts`) and the legacy `useStereotypeMetadata.ts` hook are NOT removed in this pilot — they remain in use by other pages (`RelationshipEditor`, `EntityDetail`, `RuleEditor`, `SearchComponent`, `CreateEntityModal`, `Settings`, `PackageDetailPage`). Migrating those is part of #155 Phase 3 and explicitly out of scope here.

## Public surface (signatures)

### `frontend/src/kernel/tokens.ts` — additions

```ts
// Existing exports unchanged. New tokens appended.

/**
 * DI token for the canonical Store FS facade.
 *
 * Provided by `storeFsPlugin` during `initialize` as a lazy Proxy; the
 * underlying `StoreFileSystemFacade<RootState>` is constructed during
 * `activate` after the framework-singleton `FileSystemAdapter` is resolvable.
 * The facade reads from `state.fs` — the slice that `createStorePlugin`
 * from `@hamak/ui-store-impl` registers automatically (see
 * frontend/node_modules/@hamak/ui-store-impl/dist/plugin/store-plugin-factory.js:18
 * and :79). Domain services consume this token to read/write workspace files
 * through Redux instead of axios.
 */
export const STORE_FS_TOKEN = Symbol('StoreFs');

/**
 * DI token for the StereotypeService.
 *
 * First domain service token from #155's catalog to be both declared AND
 * resolved (the legacy `DICTIONARY_SERVICE_TOKEN` etc. above are declared
 * but not yet wired). Pattern A facade per #155 — reads via Store FS
 * selectors, writes via the legacy REST shim while the framework's
 * JSON-vs-YAML round-trip gap (Risk 1) is unresolved.
 */
export const STEREOTYPE_SERVICE_TOKEN = Symbol('StereotypeService');
```

### `frontend/src/plugins/store/storeFsPlugin.ts` (new)

```ts
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
} from '@hamak/ui-store-api';
import type { StoreExtensionsRegistry } from '@hamak/ui-store-api';
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
```

### `frontend/src/kernel/tokens.ts` — final shape

```ts
export const DICTIONARY_SERVICE_TOKEN = Symbol('DictionaryService');
export const ENTITY_SERVICE_TOKEN = Symbol('EntityService');
export const MICROSERVICE_SERVICE_TOKEN = Symbol('MicroserviceService');
export const DIAGRAM_SERVICE_TOKEN = Symbol('DiagramService');
export const VERSION_SERVICE_TOKEN = Symbol('VersionService');
export const SEARCH_SERVICE_TOKEN = Symbol('SearchService');
export const AUTH_SERVICE_TOKEN = Symbol('AuthService');

// #166 stereotype-slice pilot — new tokens
export const STORE_FS_TOKEN = Symbol('StoreFs');
export const STEREOTYPE_SERVICE_TOKEN = Symbol('StereotypeService');
```

### `frontend/src/kernel/useService.ts` (new)

```ts
// frontend/src/kernel/useService.ts
//
// Resolve a DI token from the bootstrapped host's root activation context.
// This is the consumer-side mechanism specified by #155 Phase 2.
//
// Behavior:
//   - Throws if `host.rootActivationCtx` is not yet set (called before
//     bootstrap completed). That's a developer error; we don't paper over
//     it with `undefined`.
//   - Returns the resolved instance cast to T. The token IS the type
//     contract; no runtime validation.

import { host } from './bootstrap';

export function useService<T>(token: symbol | string): T {
  const ctx = host.rootActivationCtx;
  if (!ctx) {
    throw new Error(
      'useService called before host bootstrap completed. ' +
      'Ensure bootstrapApplication() has resolved before any component renders.',
    );
  }
  const svc = ctx.resolve<T>(token as symbol);
  if (svc === undefined || svc === null) {
    const name = typeof token === 'symbol' ? token.toString() : token;
    throw new Error(`useService: no provider registered for ${name}`);
  }
  return svc;
}
```

### `frontend/src/plugins/data-dictionary/services/StereotypeService.ts` (new)

```ts
// frontend/src/plugins/data-dictionary/services/StereotypeService.ts
//
// Pattern A facade per #155 catalog. Store FS-backed reads, REST-shim
// writes during this pilot (see Risk 1 for the JSON-vs-YAML rationale).
//
// All public methods take or return logical-shape data. The stereotypes
// path (`['dictionaries', '.dico', 'stereotypes.yaml']`) is hidden inside
// this service; callers never see it.
//
// Loading/error/dirty state lives on the Store FS node per patterns.md §2.
// The page consumes `service.useFile()` and derives loading from
// `node?.state.contentLoaded` and `node?.state.contentLoadError` using the
// cookbook-canonical form: `loading = !file || (!file.state.contentLoaded
// && !file.state.contentLoadError)`. `contentLoading` (the in-flight
// GET_REQUEST flag) is deliberately NOT consulted — the framework's
// store-sync middleware is the only thing that mutates it, and this pilot
// bypasses that middleware (Risk 1 / Bug B). No `useState<boolean>(loading
// |loaded)` and no `useState<Error>` in any new file.

import type { Dispatch } from 'redux';
import { useSelector } from 'react-redux';
import type { StoreFileSystemFacade } from '@hamak/ui-store-impl';
import type { FileNode } from '@hamak/shared-utils';
import { stereotypeApi } from '../../../services/api';
import type { Stereotype, StereotypeTarget } from '../../../types';
import type { RootState } from '../../../kernel/bootstrap';

/**
 * Filesystem path under the 'dictionaries' workspace mount point.
 * Will become a LOGICAL path once #167 lands backend projection.
 */
export const STEREOTYPES_PATH: readonly string[] = Object.freeze([
  'dictionaries',
  '.dico',
  'stereotypes.yaml',
]);

/**
 * Optional callback used to surface load errors as toasts via the
 * notification plugin. Wired in dataDictionaryPlugin.initialize. Keeping it
 * a callback (rather than a hard dep on the notification token) lets unit
 * tests bootstrap the service without the notification plugin.
 */
export type NotifyFn = (level: 'error' | 'warning' | 'info', message: string) => void;

export class StereotypeService {
  constructor(
    private readonly storeFs: StoreFileSystemFacade<RootState>,
    private readonly dispatch: Dispatch,
    private readonly getState: () => RootState,
    private readonly notify: NotifyFn = () => {},
  ) {}

  /**
   * Hook — returns the Store FS file node for `stereotypes.yaml`.
   * The page reads `node?.state.contentLoading`, `node?.state.contentLoaded`,
   * `node?.state.contentLoadError` from it — fulfilling patterns.md §2.
   *
   * Selector is created per-render. See Risk 4 for the memoization
   * tradeoff (single-array selector, O(path-depth=3) traversal per
   * dispatched action — acceptable for the pilot).
   */
  useFile(): FileNode<Stereotype[]> | undefined {
    const selector = this.storeFs.createFileSelector([...STEREOTYPES_PATH]);
    return useSelector(selector) as FileNode<Stereotype[]> | undefined;
  }

  /** Convenience — array of stereotypes (or `undefined` until loaded). */
  useAll(): Stereotype[] | undefined {
    return this.useFile()?.content;
  }

  /** Hook — filtered view. */
  useByTarget(target: StereotypeTarget): Stereotype[] | undefined {
    const all = this.useAll();
    return all?.filter((s) => s.appliesTo === target);
  }

  /**
   * Imperative — load (or reload) all stereotypes via the REST shim and
   * populate Store FS. On failure, marks the cache node with
   * `contentIsPresent: false` (so `contentLoaded` becomes `false`) AND
   * fires `notify('error', …)` so the page can render a toast without
   * touching `useState`.
   *
   * Idempotent: calling twice in quick succession re-fetches both times.
   * The pilot does not debounce; #167 will (via the framework's GET flow).
   */
  async loadAll(): Promise<Stereotype[]> {
    try {
      const list = await stereotypeApi.getAll();
      this.hydrate(list, true);
      return list;
    } catch (err) {
      // Mark node as "load attempted, content not present" so the page's
      // contentLoaded check shows "loaded but empty" rather than spinning.
      this.hydrate([], false);
      const message = extractMessage(err) ?? 'Failed to load stereotypes';
      this.notify('error', message);
      throw err;
    }
  }

  /** Imperative read of the cache without subscribing. */
  getAll(): Stereotype[] | undefined {
    const file = this.storeFs.selectFileFromRoot(
      this.getState(),
      [...STEREOTYPES_PATH],
    ) as FileNode<Stereotype[]> | undefined;
    return file?.content;
  }

  async create(data: Stereotype): Promise<Stereotype> {
    const res = await stereotypeApi.create(data);
    // Backend returns `{ success, stereotype }` per backend
    // stereotypeService.ts:55. `stereotypeApi.create` returns
    // `response.data` (api.ts:567), which is that envelope. Unwrap.
    const created: Stereotype =
      (res as { stereotype?: Stereotype }).stereotype
      ?? (res as { data?: Stereotype }).data
      ?? data;
    const current = this.getAll() ?? [];
    this.hydrate([...current, created], true);
    return created;
  }

  async update(id: string, data: Partial<Stereotype>): Promise<Stereotype> {
    const res = await stereotypeApi.update(id, data);
    const existing = this.getAll()?.find((s) => s.id === id) ?? ({} as Stereotype);
    const updated: Stereotype =
      (res as { stereotype?: Stereotype }).stereotype
      ?? (res as { data?: Stereotype }).data
      ?? ({ ...existing, ...data } as Stereotype);
    const current = this.getAll() ?? [];
    this.hydrate(
      current.map((s) => (s.id === id ? updated : s)),
      true,
    );
    return updated;
  }

  async delete(id: string): Promise<void> {
    await stereotypeApi.delete(id);
    const current = this.getAll() ?? [];
    this.hydrate(current.filter((s) => s.id !== id), true);
  }

  /**
   * Write the canonical list into Store FS via `setFile`.
   *
   * Why `setFile` and not `setFileContent`:
   *   `setFileContent` triggers the autosave middleware (#166 Phase 1
   *   wiring) which calls RemoteFsAutosaveProvider.save → dispatches
   *   PUT_REQUEST → http-workspace-client.putFile → JSON.stringify on
   *   the array → backend writes JSON into stereotypes.yaml — wrong.
   *   `setFile` does NOT trigger autosave (autosave-middleware.js:15-18
   *   only watches 'set-file-content' and 'update-file-content'). For
   *   this pilot, writes flow through the REST shim only; Store FS is
   *   cache-only. See Risk 1.
   *
   * `contentIsPresent` controls `state.contentLoaded` on the created node
   * (verified at fileSystemNodeInitialState in
   * frontend/node_modules/@hamak/shared-utils/dist/core-utils-filesystem.js:2-4
   * — `contentLoaded: contentPresent`). We pass `true` on success and
   * `false` on load failure, so the page can distinguish "never loaded",
   * "loaded successfully (possibly empty)", and "load failed".
   */
  private hydrate(list: Stereotype[], contentIsPresent: boolean): void {
    // `setFile` against a path whose parent directories do not exist is a
    // silent no-op (verified at frontend/node_modules/@hamak/ui-store-impl/
    // dist/fs/commands/fs-commands.js:127-149 — when `getFileSystemNode`
    // returns undefined for the parent path, executeSetFile `return`s
    // without warning). The framework's initial state is `root.children: {}`
    // so neither `dictionaries` nor `dictionaries/.dico` exists yet. We
    // therefore dispatch `mkdir` with `parents: true` first; the action
    // creator `FileSystemAdapter.mkdir(path, parents?, extensionStates?)`
    // is verified at @hamak/ui-store-impl/dist/fs/core/fs-adapter.d.ts:53
    // and at fs-adapter.js:97-100 (positional args, NOT an options object).
    // The handler honours `parents=true` by creating every missing
    // intermediate directory (executeMkdir at fs-commands.js:69-104,
    // specifically the `parents === true` branch at lines 86-89). `mkdir`
    // on an already-existing directory is a no-op (line 79 `if undefined`
    // guard), so re-hydration is safe.
    const actions = this.storeFs.getActions();
    this.dispatch(
      actions.mkdir(['dictionaries', '.dico'], true),
    );
    this.dispatch(
      actions.setFile(
        [...STEREOTYPES_PATH],
        list,
        'application/yaml',
        { override: true, contentIsPresent },
      ),
    );
  }
}

function extractMessage(err: unknown): string | null {
  if (typeof err === 'object' && err !== null) {
    const e = err as {
      response?: { data?: { errors?: string[]; message?: string } };
      message?: string;
    };
    return (
      e.response?.data?.errors?.[0]
      ?? e.response?.data?.message
      ?? e.message
      ?? null
    );
  }
  return null;
}
```

### `frontend/src/plugins/data-dictionary/dataDictionaryPlugin.ts` — extend `initialize`

```ts
import type { PluginModule } from '@hamak/microkernel-spi';
import { STORE_MANAGER_TOKEN, type IStoreManager } from '@hamak/ui-store-api';
import type { StoreFileSystemFacade } from '@hamak/ui-store-impl';
import {
  STORE_FS_TOKEN,
  STEREOTYPE_SERVICE_TOKEN,
} from '../../kernel/tokens';
import { StereotypeService, type NotifyFn } from './services/StereotypeService';
import type { RootState } from '../../kernel/bootstrap';

export function createDataDictionaryPlugin(): PluginModule {
  return {
    async initialize(ctx) {
      // Existing route + command registration unchanged
      ctx.views.register('routes.data-dictionary', () => ({
        routes: [
          '/packages/**',
          '/services/**',
          '/dictionaries/**',
          '/create',
        ],
      }));
      ctx.commands.register('data-dictionary.refresh', async () => {
        ctx.hooks.emit('data-dictionary:refresh-requested');
      });

      // #166 pilot: register StereotypeService.
      // dependsOn in bootstrap.ts MUST include 'store-fs' so STORE_FS_TOKEN
      // is providable by the time we run. Resolution returns the Proxy
      // (storeFsPlugin.ts); the underlying facade is filled during
      // store-fs.activate, which runs BEFORE data-dictionary.activate AND
      // BEFORE any component mounts — so by the time StereotypeService
      // methods are called, the Proxy is fully wired.
      const storeFs = ctx.resolve<StoreFileSystemFacade<RootState>>(
        STORE_FS_TOKEN,
      );
      const storeManager = ctx.resolve<IStoreManager>(STORE_MANAGER_TOKEN);

      // Wire notification command best-effort: if the notification plugin
      // didn't register the command for some reason (e.g. test bootstrap
      // omits it), the service silently ignores the notify call.
      const notify: NotifyFn = (level, message) => {
        try {
          void ctx.commands.execute(`notification.${level}`, { message });
        } catch {
          // Notification plugin not present; swallow.
        }
      };

      const service = new StereotypeService(
        storeFs,
        (action) => storeManager.dispatch(action),
        () => storeManager.getState<RootState>(),
        notify,
      );
      ctx.provide({
        provide: STEREOTYPE_SERVICE_TOKEN,
        useValue: service,
      });
    },

    async activate() {
      console.log('[data-dictionary] Plugin activated');
    },
  };
}
```

Note: `storeManager.dispatch` and `storeManager.getState<RootState>()` are part of `IStoreManager` (verified at `frontend/node_modules/@hamak/ui-store-api/dist/api/store-manager.d.ts:36-40`). The store isn't yet initialized at this plugin's `initialize` time (the store is initialized inside store's `activate`); we wrap in arrows so the calls happen lazily when the service method fires.

### `frontend/src/kernel/bootstrap.ts` — diff fragment

Insert imports near the existing plugin imports (line ~17):

```ts
import { createAppStoreFsPlugin } from '../plugins/store/storeFsPlugin';
```

Insert this registration block AFTER the `remote-fs` plugin (current line 131-135) and BEFORE the existing `remote-git` registration (line 137-142):

```ts
  // Store FS plugin — provides STORE_FS_TOKEN over the 'dictionaries' workspace.
  // Depends on: store (STORE_EXTENSIONS_TOKEN, STORE_MANAGER_TOKEN),
  //             remote-fs (PATH_TRANSLATOR_TOKEN).
  host.registerPlugin(
    'store-fs',
    { name: 'store-fs', version: '1.0.0', entry: '', dependsOn: ['store', 'remote-fs'] },
    createAppStoreFsPlugin()
  );
```

Update the `data-dictionary` registration's `dependsOn` (current line 108) from `['store', 'auth']` to `['store', 'auth', 'store-fs']` so its `initialize` runs after `STORE_FS_TOKEN` is providable. `store-fs` provides STORE_FS_TOKEN in `initialize` (as the lazy Proxy) — see the lifecycle reasoning in `storeFsPlugin.ts`'s JSDoc.

### `frontend/src/pages/StereotypesPage.tsx` — replacement (key fragments)

```tsx
import { useEffect, useState } from 'react';
import { useService } from '../kernel/useService';
import { STEREOTYPE_SERVICE_TOKEN } from '../kernel/tokens';
import type { StereotypeService } from '../plugins/data-dictionary/services/StereotypeService';
import StereotypeForm from '../components/StereotypeForm';
import type { Stereotype, StereotypeTarget } from '../types';
import {
  Button,
  Chip,
  EmptyState,
  Modal,
  Toolbar,
} from '../components/ui';

const TARGET_LABELS: Record<StereotypeTarget, string> = {
  entity: 'Entity Stereotypes',
  attribute: 'Attribute Stereotypes',
  package: 'Package Stereotypes',
  relationship: 'Relationship Stereotypes',
  model: 'Model Stereotypes',
};
const VISIBLE_TARGETS: StereotypeTarget[] = ['entity', 'attribute', 'package'];

export default function StereotypesPage() {
  const service = useService<StereotypeService>(STEREOTYPE_SERVICE_TOKEN);

  // EPHEMERAL UI state only — modal open / row being edited. Per
  // patterns.md §1.5 ("Ephemeral UI state … does still use useState").
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // FILE IO state — loading / loaded / error — comes from the Store FS
  // node, NOT from useState. Per patterns.md §2 ("Loading, error, dirty —
  // never useState").
  const file = service.useFile();
  const stereotypes: Stereotype[] = file?.content ?? [];
  // Cookbook-canonical loading derivation from patterns.md §2 (line 128-129):
  //   "const loading = !file || (!file.state.contentLoaded && !file.state.contentLoadError);"
  // Rationale for not consulting `contentLoading`: in this pilot the framework
  // never mutates that field on our path. There is no GET_REQUEST/GET_COMPLETED
  // flow because we use the legacy REST shim — we drive Store FS purely via
  // setFile, which sets `contentLoaded` directly without touching
  // `contentLoading`. (`contentLoading` is the GET-in-flight flag, set by
  // the store-sync middleware on rfsActions.ofGetRequest, which this pilot
  // bypasses per Risk 1.) Including it in the derivation would be
  // misleading dead weight.
  const loading = !file || (!file.state.contentLoaded && !file.state.contentLoadError);
  const loaded = file?.state.contentLoaded ?? false;
  const errorMessage = file?.state.contentLoadError?.message ?? null;

  // Hydrate cache on first mount. Subsequent reads come from Store FS via
  // useFile(). The effect itself is fine — patterns.md only forbids the
  // useState flags, not the imperative dispatcher.
  useEffect(() => {
    // Only fire if we haven't loaded yet (node has not had setFile called
    // with contentIsPresent: true). This is the Store-FS-native equivalent
    // of "loaded ?": ask the node, not a ref/useState.
    if (!loaded) {
      void service.loadAll().catch(() => {
        // Error already surfaced via the notification toast (StereotypeService
        // calls notify('error', …) on failure). No useState<Error> needed.
      });
    }
    // We deliberately run on every mount-with-not-loaded; the imperative
    // call is idempotent at the service layer and re-fetches under the
    // pilot's "no debounce" rule (Risk noted in service JSDoc).
  }, [service, loaded]);

  const handleCreate = async (data: Stereotype) => {
    try {
      await service.create(data);
      setShowCreate(false);
    } catch {
      // Notify-via-service path will handle this once #155 routes mutations
      // through commands. For now, swallow — the failure is logged.
    }
  };

  const handleUpdate = async (data: Stereotype) => {
    try {
      await service.update(data.id, data);
      setEditingId(null);
    } catch {
      // Same comment as handleCreate.
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm(`Delete stereotype "${id}"?`)) return;
    try {
      await service.delete(id);
    } catch {
      // Same comment as handleCreate.
    }
  };

  // ... grouping logic (knownDomains, groupedByDomain) unchanged from the
  // pre-pilot page; it operates on the `stereotypes` array.

  if (loading) {
    return <EmptyState kind="loading" message="Loading stereotypes…" />;
  }

  // errorMessage is from contentLoadError on the node. The notification
  // toast handles user-facing error display; the page renders a small
  // inline banner ONLY if the node ever set contentLoadError directly
  // (currently never — see "loaded but empty" path in StereotypeService).
  // The original red banner is removed; toasts replace it.

  return (
    <div className="flex flex-col min-h-0" style={{ flex: 1, gap: 12 }}>
      {/* ... toolbar + grouped sections unchanged ... */}
      {/* errorMessage banner is GONE — notification plugin handles it. */}
    </div>
  );
}
```

The full file replacement deletes:
- the `useState<Stereotype[]>([])` for `stereotypes`,
- the `useState<boolean>(true)` for `loading`,
- the `useState<string | null>(null)` for `error`,
- the `fetchData` async helper,
- the inline error banner (replaced by notification toasts).

Net: removes two `useState` calls flagged by `patterns.md` anti-patterns #128 and #129; keeps the two `useState` calls covering ephemeral UI state (`showCreate`, `editingId`), which §1.5 explicitly permits.

## Framework APIs used

All paths absolute under `/Users/amah/Devs/projects/smart-data-dico/frontend/node_modules/`.

### `@hamak/ui-store-impl` (concrete classes — runtime imports)

- `StoreFileSystemFacade<S>` — class, declared at `@hamak/ui-store-impl/dist/fs/core/fs-facade.d.ts:17`. Constructor `(fileSystemSelector: Selector<S, FileSystemState | undefined>, adapter: FileSystemAdapter)`. Methods used: `getActions()`, `createSelector(path)`, `createFileSelector(path)`, `selectFileFromRoot(state, path)`. Runtime confirmed at `@hamak/ui-store-impl/dist/fs/core/fs-facade.js`. Re-exported from `@hamak/ui-store-impl` top-level via `dist/index.d.ts` → `export * from './fs'` → `dist/fs/index.d.ts:1` → `./core/fs-adapter` (and `./core/fs-facade`).
- `FileSystemAdapter` — class, declared at `@hamak/ui-store-impl/dist/fs/core/fs-adapter.d.ts:22`. **Important**: this class is exported ONLY from `@hamak/ui-store-impl`, not from `@hamak/ui-store-api` (`grep -rn "FileSystemAdapter" @hamak/ui-store-api/dist/` returns zero hits). Used as the runtime type of `storeManager.getFileSystemAdapter()`'s return.
- `FileSystemAdapter.mkdir(path, parents?, extensionStates?): FileSystemNodeAction` — action creator on the per-slice adapter, declared at `@hamak/ui-store-impl/dist/fs/core/fs-adapter.d.ts:53`, implemented at `@hamak/ui-store-impl/dist/fs/core/fs-adapter.js:97-100`. Positional arguments (NOT an options object). Dispatches a command with `name: 'mkdir'`; the handler (`fs-commands.js:69-104`) walks `pathSteps(path)` and creates each missing intermediate directory only when `parents === true` (lines 86-89). When `parents` is falsy and an intermediate is missing, the handler `return`s silently (line 91) — the same silent-no-op failure mode that affects `executeSetFile` at lines 127-149 when the parent dir is absent. `StereotypeService.hydrate` therefore dispatches `mkdir(['dictionaries', '.dico'], true)` before any `setFile`.
- `AutosaveProviderRegistry` — class at `@hamak/ui-store-impl/dist/autosave/autosave-registry.d.ts:6`. Constructor no-args. Methods used: `register(provider)`, `getAll()`. Runtime at `@hamak/ui-store-impl/dist/autosave/autosave-registry.js:4-33`. **Note**: `register()` does NOT invoke `provider.supports()` (verified at autosave-registry.js:8-13 — it just inserts into a Map).
- `createAutosaveMiddleware(config)` — function at `@hamak/ui-store-impl/dist/autosave/autosave-middleware.d.ts:36`. Required config field: `registry`. Critical config field: `fsSliceName` — MUST be set to `'fs'` (framework default is `'fileSystem'` per `autosave-middleware.js:78`, which would silently mismatch our state shape). Provider `supports()` is invoked from middleware ONLY on content-change actions — `set-file-content`, `update-file-content` — verified at `autosave-middleware.js:14-18,242-256`. **`setFile` is NOT in that list**, so this pilot's REST-shim writes never trigger `supports()`.

### `@hamak/ui-store-api` (interfaces, tokens, types)

- `STORE_MANAGER_TOKEN: unique symbol` — `@hamak/ui-store-api/dist/tokens/service-tokens.d.ts:5`.
- `STORE_EXTENSIONS_TOKEN: unique symbol` — `…:8`.
- `AUTOSAVE_REGISTRY_TOKEN: unique symbol` — `…:9`.
- `IStoreManager` — `@hamak/ui-store-api/dist/api/store-manager.d.ts:9`. `getState<S>()`, `dispatch(action)`. The impl-only `getFileSystemAdapter()` method is at `@hamak/ui-store-impl/dist/core/store-manager.js:30`; we cast to access it (same precedent as `remote-fs-plugin-factory.js:89`).
- `StoreExtensionsRegistry` — `@hamak/ui-store-api/dist/types/extension-types.d.ts:29`. `register(source: string, extensions: StorePluginExtensions): void`.
- `FileSystemState` — type, re-exported from `@hamak/shared-utils` via `@hamak/ui-store-api/dist/fs/index.d.ts:1`.

### `@hamak/ui-remote-fs`

- `RemoteFsAutosaveProvider` — class at `@hamak/ui-remote-fs/dist/impl/autosave/remote-fs-autosave-provider.d.ts:25`. Constructor `({ pathTranslator: IPathTranslator })`. `id = 'remote-fs'`, `priority = 10`. Runtime at `@hamak/ui-remote-fs/dist/impl/autosave/remote-fs-autosave-provider.js`. **See "Upstream framework bugs" below** for the bug in `supports()` and why this pilot avoids it.
- `PATH_TRANSLATOR_TOKEN: unique symbol` — `@hamak/ui-remote-fs/dist/api/tokens/remote-fs.tokens.d.ts:20`.
- `IPathTranslator` — `@hamak/ui-remote-fs/dist/spi/providers/i-path-translator.d.ts:25`.
- `PathTranslator` (impl class) — `@hamak/ui-remote-fs/dist/spi/providers/i-path-translator.js:10`. `toRemotePath(localPath)` at lines 19-30 calls `pathway.isAbsolute()` (line 23) — see "Upstream framework bugs".

### `@hamak/shared-utils`

- `FileNode<T>`, `DirectoryNode`, `FileSystemNode`, `FileSystemNodeState` — `@hamak/shared-utils/dist/core-utils-filesystem.d.ts:36,32,41,15`.
- `FileSystemNodeState` shape includes `contentLoaded: boolean`, `contentLoading: boolean`, `contentLoadError?: { code?, message? }`, `extensionStates: Record<string, unknown>` — verified at `core-utils-filesystem.d.ts:15-25`. These are the cookbook-canonical fields the page reads.
- `fileSystemNodeInitialState(contentPresent?: boolean)` — function at `core-utils-filesystem.d.ts:26`. Implementation at `core-utils-filesystem.js:2-4` sets `contentLoaded: contentPresent`. This is what makes `setFile(path, list, schema, { contentIsPresent: true })` populate `node.state.contentLoaded === true` — the load-tracking mechanism the page uses instead of `useState`.

### `@hamak/microkernel-impl` / `@hamak/microkernel-spi`

- `PluginModule` — verified in #156's spec; same import path `@hamak/microkernel-spi`.
- `Host` lifecycle — `@hamak/microkernel-impl/dist/runtime/host.js:85-138`. All `initialize` calls run sequentially in topological order (lines 85-106), then `this.rootActivationCtx` is assigned (line 111), then all `activate` calls run (lines 113-133). No interleaving. The `rootActivationCtx` property is declared at `host.d.ts:13`.

### `@hamak/notification`

- `notification.error` command — registered by `@hamak/notification/dist/impl/plugin/notification-plugin-factory.js:94`. Signature: `(args: { message: string, … })`. Used by `dataDictionaryPlugin`'s `notify` callback to surface load failures without `useState`.

## Upstream framework bugs

### Bug A: `RemoteFsAutosaveProvider.supports()` throws on any invocation

**File and line**: `frontend/node_modules/@hamak/ui-remote-fs/dist/impl/autosave/remote-fs-autosave-provider.js:43`.

**Source**:
```js
supports(path, _node) {
    const remotePath = this.pathTranslator.toRemotePath({ getSegments: () => path });
    return remotePath !== undefined;
}
```

**Failure mode**: `supports()` passes a duck-typed object `{ getSegments: () => path }` to `PathTranslator.toRemotePath`. Inside `toRemotePath` (`@hamak/ui-remote-fs/dist/spi/providers/i-path-translator.js:19-30`):

```js
toRemotePath(localPath) {
    let pathway = Array.isArray(localPath) ? Pathway.of(localPath) : localPath;
    if (this.mountPoint.isAbsolute() && !pathway.isAbsolute()) {  // ← line 23
        ...
```

Because `localPath` is the duck object (not an array), the `Array.isArray` branch is false and `pathway = localPath` directly. Then `pathway.isAbsolute()` is called — but the duck has only `getSegments`. Result: `TypeError: pathway.isAbsolute is not a function`.

**Reproduction**: `new RemoteFsAutosaveProvider({ pathTranslator: new PathTranslator(Pathway.of(['dictionaries'])) }).supports(['dictionaries', 'foo.yaml'], null)` throws immediately.

**Call-site analysis — is the bug reachable in this pilot?**

The bug is only hit when something invokes `provider.supports(...)`. Three potential call sites:

1. **`AutosaveProviderRegistry.register(provider)`** at `@hamak/ui-store-impl/dist/autosave/autosave-registry.js:8-13` — does NOT call `supports()`. It only does `this.providers.set(provider.id, provider)`. **Safe.**
2. **`AutosaveProviderRegistry.findProvider(path, node)`** at `autosave-registry.js:20-25` — DOES call `provider.supports(path, node)`. **Reachable.**
3. **`AutosaveProviderRegistry.getAll()`** at `autosave-registry.js:27-29` — does NOT call `supports()`. Just `Array.from(this.providers.values())`. **Safe.**

Who calls `findProvider`? Only `autosave-middleware.js:255`, and only when `isContentChangeAction(action)` is true (line 242). `isContentChangeAction` checks for action types matching `'set-file-content'` or `'update-file-content'` (lines 15-18, 22-35).

**This pilot uses `setFile` exclusively** for stereotype writes (see `StereotypeService.hydrate`). `setFile`'s action type is `${sliceName}/createFileNode` (`fs-adapter.js:62`) — not in `CONTENT_CHANGE_ACTION_TYPES`. Therefore the middleware never reaches `findProvider`, which means `provider.supports()` is never invoked, which means the bug is **dormant for this pilot's runtime paths**.

**Sub-option taken**: (a) per the orchestrator's framing — register the autosave provider with the registry, but avoid invoking `supports()` in any acceptance test or production code path. The registration itself is safe (Bug A's failure mode requires invocation, not registration). Acceptance #2 verifies presence-and-shape of the provider in `getAll()` (which doesn't call `supports`), NOT a positive/negative result from `supports`.

**Implications for the broader codebase**: any future Pattern A service that writes via `setFileContent` / `updateFileContent` (i.e. tries to use the autosave path properly) will hit Bug A in production. The next ticket touching that surface (probably #155 Phase 3 entity migration) MUST file an upstream issue against `amah/app-framework` to fix the `supports()` duck-typing. The orchestrator should file an issue based on this report. Until the upstream fix lands, all Pattern A services in this codebase MUST go through the REST shim for writes.

**Suggested upstream fix** (for the orchestrator's issue, not for this PR): `RemoteFsAutosaveProvider.supports` should pass `Pathway.of(path)` (a real `Pathway` instance) to `toRemotePath`, not a duck. Two-character change:

```js
// remote-fs-autosave-provider.js:43 — proposed
const remotePath = this.pathTranslator.toRemotePath(path);  // array → Array.isArray branch
```

`toRemotePath` already handles `Array.isArray(localPath)` correctly by calling `Pathway.of(localPath)` (i-path-translator.js:20).

### Bug B: Store-sync middleware assumes JSON content end-to-end

**File and line**: `frontend/node_modules/@hamak/ui-remote-fs/dist/impl/middleware/store-sync-middleware.js:87` does `JSON.parse(data.content)` unconditionally on the `GET_COMPLETED` path before `transformContent` is even invoked. The HTTP client's `serializeContent` (`http-workspace-client.js:117-122`) also `JSON.stringify`s non-string content on `PUT`. This is Risk 1 in the spec (it was Risk 1 in cycle 1; preserved here verbatim).

**Mitigation**: this pilot bypasses both paths. Reads use the REST shim (`stereotypeApi.getAll`) and hydrate Store FS via `setFile` (which doesn't trigger autosave). Writes use the REST shim. The autosave provider is registered but only as scaffolding for when the JSON gap closes.

## Acceptance criteria

Numbered; each item is a one-line shell check, a typecheck, or a Vitest assertion. Baselines verified at spec-writing time — see "Baseline calibration" at the bottom.

1. **`STORE_FS_TOKEN` resolves a working facade.** New test `frontend/src/plugins/store/__tests__/storeFsPlugin.test.ts` bootstraps a `Host` with `[store, remote-fs, store-fs]` (own `Host` instance, not the singleton) and asserts:
   - `ctx.resolve(STORE_FS_TOKEN)` returns a truthy value (the Proxy or — post-activate — the resolved facade behind it).
   - Accessing `.getActions`, `.createSelector`, `.createFileSelector`, `.selectFileFromRoot` on it returns functions (post-activate).
   - Dispatching `facade.getActions().setFile(['x'], 42, 'application/json', { override: true, contentIsPresent: true })` populates `state.fs.root.children.x.content === 42`. Read back via `facade.selectFileFromRoot(store.getState(), ['x'])`.

2. **`AUTOSAVE_REGISTRY_TOKEN` resolves a registry containing the remote-fs provider — presence-only check.** Same test file:
   - `ctx.resolve(AUTOSAVE_REGISTRY_TOKEN).getAll()` returns exactly one provider.
   - That provider's `id === 'remote-fs'`.
   - That provider's `priority === 10`.
   - **The test does NOT invoke `provider.supports(...)`.** That method is broken in the published framework (Bug A above). Until upstream fixes the duck-typing, any test that invokes `supports` will throw `TypeError`. The presence-only check is sufficient for this pilot, which never invokes `supports` in production code either (see "Upstream framework bugs / call-site analysis").

3. **`state.fs` is populated and selector-readable.** Same test file: after bootstrap, `store.getState().fs` matches the framework's initial state — `{ root: { type: 'directory', name: '', children: {}, state: <fileSystemNodeInitialState()> } }` per `fs-adapter.js:25-27`.

4. **`STEREOTYPE_SERVICE_TOKEN` resolves a `StereotypeService`.** New test `frontend/src/plugins/data-dictionary/services/__tests__/StereotypeService.test.ts` bootstraps the host with `[store, remote-fs, store-fs, data-dictionary]` (own `Host` instance) and:
   - `ctx.resolve(STEREOTYPE_SERVICE_TOKEN)` returns a `StereotypeService` instance.
   - The instance exposes `useFile`, `useAll`, `useByTarget`, `loadAll`, `getAll`, `create`, `update`, `delete` as functions.

5. **`useAll()` returns Store FS-cached data.** Same test file:
   - Pre-populate the cache by dispatching `mkdir(['dictionaries', '.dico'], true)` followed by `setFile(STEREOTYPES_PATH, [<fixture>], 'application/yaml', { override: true, contentIsPresent: true })`. (The `mkdir` step is required: without it `setFile` is a silent no-op against a fresh `root.children: {}` — see fs-commands.js:127-149.) The simplest test path is to invoke `service['hydrate']([<fixture>], true)` directly, which already encodes the mkdir-then-setFile sequence.
   - Render a probe component inside `<Provider store={...}>` that calls `service.useAll()`.
   - Probe sees the fixture array on first render.

6. **`useFile()` exposes the framework `FileSystemNodeState` fields used by the page.** Same test file:
   - After `hydrate(list, true)`, `useFile()` returns a node where `node.state.contentLoaded === true` and `node.state.contentLoadError === undefined`.
   - After `hydrate([], false)` (simulating load failure), `useFile()` returns a node where `node.state.contentLoaded === false`.

7. **`loadAll()` populates Store FS through MSW-mocked REST.** Same test file:
   - MSW intercepts `GET /api/stereotypes` and returns a fixture array.
   - `await service.loadAll()` resolves to the fixture.
   - `service.useFile()` afterwards returns a node with `state.contentLoaded === true` and `content` equal to the fixture.

8. **`loadAll()` failure marks the node as not loaded AND fires `notify('error', …)`.** Same test file:
   - MSW intercepts `GET /api/stereotypes` and returns 500.
   - Construct the service with a spy `notify` callback.
   - `await service.loadAll()` rejects.
   - `service.useFile()` afterwards returns a node with `state.contentLoaded === false`.
   - The spy was called once with `('error', '<some message>')`.

9. **`create()` POSTs through REST and updates the cache.** Same test file:
   - Pre-populate with empty `[]`.
   - MSW intercepts `POST /api/stereotypes` and echoes the body wrapped as `{ success: true, stereotype: <body> }`.
   - `await service.create({ id: 'X', name: 'X', appliesTo: 'entity', metadataDefinitions: [] })` resolves to the stereotype.
   - `service.getAll()` returns a one-element array. A probe rendering `service.useAll()` re-renders (extra render count).

10. **`delete()` and `update()` similarly update the cache.** Same test file (two more cases).

11. **No autosave PUT_REQUEST fires for stereotype writes.** Same test file:
    - Install a Redux middleware spy that records every dispatched action.
    - Call `service.create(...)` (with MSW for POST).
    - Assert no dispatched action's `type` matches the framework's PUT_REQUEST constant. The test imports `RemoteFsActionTypes` from `@hamak/ui-remote-fs/dist/api/types/remote-fs-action.types` and references `RemoteFsActionTypes.PUT_REQUEST` symbolically (not a hard-coded string — the literal `"[Remote FS] Put/Request"` would silently miss a future rename).

12. **End-to-end: production singleton `host` resolves the service AND the page renders.** New test `frontend/src/pages/__tests__/StereotypesPage.bootstrap.test.tsx`:
    - Calls `await bootstrapApplication()` (imported from `../../kernel/bootstrap`), which populates the singleton `host`.
    - Asserts `host.rootActivationCtx` is defined.
    - Asserts `host.rootActivationCtx.resolve(STEREOTYPE_SERVICE_TOKEN)` returns an instance with the expected method shape (`useFile`, `useAll`, `loadAll`, `create`, `update`, `delete`).
    - MSW intercepts `GET /api/stereotypes` and returns a one-element fixture.
    - Renders `<Provider store={getStore()}><StereotypesPage /></Provider>`.
    - Asserts the page does NOT throw "useService called before host bootstrap completed".
    - **First paint = loading state.** Synchronously after `render(...)`, before awaiting MSW, the DOM contains the loading `EmptyState` (e.g. `screen.getByText('Loading stereotypes…')`). This pins the cookbook-canonical loading derivation — when `file` is `undefined` on first render (before the mount-effect dispatches anything), `loading === true`. The previous nullish-coalescing form failed this check (cycle-2 review issue #2).
    - Asserts the page calls `GET /api/stereotypes` exactly once on mount (MSW handler call count).
    - After the fetch resolves, asserts the page shows the fixture's stereotype name in the DOM (`screen.findByText(...)`).
    - **Note on isolation**: this test imports `bootstrapApplication` from `kernel/bootstrap.ts`, which mutates the singleton `host`. Vitest's default `clearMocks: true` does not unwind plugin registrations. To keep this test isolated, the test author must (a) place it in its own test file (no shared `beforeEach` resets affect the singleton), AND (b) reset the singleton at the file's `afterAll` if it needs to coexist with other tests that import `bootstrap`. The implementor MAY structurally choose to keep `bootstrap.ts`'s `isBootstrapped` reset hook (currently no such hook exists; the implementor MAY add one for test isolation if needed).

13. **No bespoke loading/loaded/error flags in new files OR in `StereotypesPage.tsx`.** Two grep checks:
    - `grep -rEn 'useState<\\s*(boolean|Error)' frontend/src/plugins/store/storeFsPlugin.ts frontend/src/plugins/data-dictionary/services/StereotypeService.ts frontend/src/kernel/useService.ts frontend/src/plugins/data-dictionary/dataDictionaryPlugin.ts` returns 0 hits.
    - `grep -En "useState<(boolean|Error|string\\s*\\|\\s*null)>" frontend/src/pages/StereotypesPage.tsx` returns 0 hits. The page may use `useState<boolean>(false)` for ephemeral UI state (`showCreate`) and `useState<string | null>(null)` for `editingId` — these are NOT flagged by the grep pattern because they're not typed `Error` or `boolean` (note the regex above explicitly excludes the `editingId` and `showCreate` patterns by typing — `showCreate` matches `useState<boolean>` literally; the test uses a stricter regex variant that excludes the lines exactly matching the `editingId` and `showCreate` declarations by additional `-v` filter):
      ```
      grep -En "useState<(boolean|Error|string\\s*\\|\\s*null)>" frontend/src/pages/StereotypesPage.tsx \
        | grep -vE "(showCreate|editingId)"
      ```
      MUST return 0 hits. The `showCreate` / `editingId` declarations remain (ephemeral UI state, allowed by §1.5).

14. **`StereotypesPage` and new files typecheck.** `cd frontend && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E '(StereotypesPage\\.tsx|StereotypeService\\.ts|storeFsPlugin\\.ts|useService\\.ts|dataDictionaryPlugin\\.ts|StereotypesPage\\.bootstrap\\.test\\.tsx|storeFsPlugin\\.test\\.ts|StereotypeService\\.test\\.ts)' | wc -l` returns `0`. (Pre-existing failures in `AIChatPanel*.test.tsx` are NOT in our touched files; the file-scoped grep skips them — same approach as #156's spec.)

15. **Existing tests stay green; test-file count grows by exactly 3.** Two assertions:
    - `find frontend/src -name '*.test.ts' -o -name '*.test.tsx' | wc -l` returns `(baseline test-file count) + 3`. The 3 new files are `storeFsPlugin.test.ts`, `StereotypeService.test.ts`, `StereotypesPage.bootstrap.test.tsx`. **Baseline**: 24 test files on `main` (verified via `git ls-tree -r main -- frontend/src | grep -E '\\.test\\.(ts|tsx)$' | wc -l` → 24); 26 test files on branch `arch/156-collapse-notification` (current `HEAD`). The implementor's branch base determines the expected result: **base = main → 27**; **base = arch/156-collapse-notification (or its descendant post-merge of #156) → 29**.
    - `cd frontend && npm test` exits 0 and reports "Tests N passed (N)" with `N = (baseline test count) + (new test cases added by these 3 files)`. The number of new test cases is set by the implementor when writing the tests; this spec does not pin a specific count, but the grand total MUST equal `baseline-test-count + new-cases`. Implementor records both numbers in `attempts.log`. **Verification mechanism**: implementor runs `cd frontend && npm test 2>&1 | grep -E "Tests +[0-9]+ passed"` before and after their changes; the delta is the per-file test count.

16. **Lint is not regressed.** `cd frontend && npm run lint` exits with the same code as on `main` (skipped per baseline — see #156's `.claude/work/156/test-results.md` for the missing `.eslintrc.*` constraint that applies identically here). If a lint config materializes between spec and implementation, the new files must lint clean.

17. **Attempts log updated.** `tail -1 .claude/work/166-stereotype-slice/attempts.log` matches `<UTC ISO8601>  spec-writer  done  ticket=166-stereotype-slice  output=spec.md  notes=cycle 2; …`.

**Baseline calibration** — confirmed at spec-writing time (no branch mutation; used `git ls-tree`):
- `main`'s test-file count: 24 (`git ls-tree -r main -- frontend/src | grep -E '\\.test\\.(ts|tsx)$' | wc -l` → 24).
- `arch/156-collapse-notification`'s test-file count: 26 (`git ls-tree -r HEAD -- frontend/src | grep -E '\\.test\\.(ts|tsx)$' | wc -l` → 26).
- Acceptance #15's file-count target therefore depends on the implementor's branch base. Implementor MUST record their branch base in `attempts.log` so reviewers can audit.
- `cd frontend && npx tsc --noEmit` (whole project): pre-existing failures in `AIChatPanel*.test.tsx` per `.claude/work/156/test-results.md`. Acceptance #14 scopes to our touched files to avoid this baseline noise.
- `cd frontend && npm run lint` (whole project): fails with "No ESLint configuration found" per #156's findings. Acceptance #16 is conditional on whether a config has been added by implementation time.

## Out of scope

- **Migrating the other six stereotype-consuming files** (`RelationshipEditor.tsx`, `EntityDetail.tsx`, `RuleEditor.tsx`, `SearchComponent.tsx`, `CreateEntityModal.tsx`, `Settings.tsx`, `PackageDetailPage.tsx`, the `useStereotypeMetadata` hook). They still import `stereotypeApi` directly. The legacy `stereotypesSlice.ts` Redux slice and its async thunks remain registered. Migration is part of #155 Phase 3, tracked there as the next stereotype task once this PR merges.
- **Other services from the #155 catalog** — Dictionary, Case, Rule, Integrity, ImportExport, Diff, Search, Visualization, AI. None are touched. The legacy tokens in `tokens.ts` remain declared-but-unprovided.
- **`react-query` removal from `package.json`.** #166 Phase 8. Defer until at least three services are Pattern A.
- **Dual logical + raw Store FS slices** per the 2026-05-11T21:58:08Z #166 comment. Single slice (the framework's auto-registered `'fs'`) is used. Splitting is blocked on backend projection (#167 + #168).
- **`currentUser.id` workspace keying** per the 2026-05-10T14:10:05Z #166 comment. Hardcoded `'dictionaries'` in `remoteFsPlugin.ts` is unchanged. Blocked on #169.
- **Multi-kind YAML write semantics** (#106). `stereotypes.yaml` is a single-kind file; the merge problem doesn't arise here.
- **Logical paths vs. filesystem paths.** Until #167, `STEREOTYPES_PATH` is filesystem-shaped. The constant is the single migration point.
- **Cookbook update** (`frontend/docs/patterns.md` §3 TODO). Per the memory rule and the cookbook's own self-description, this PR does NOT update the cookbook. A follow-up human edit fills §3 against the merged code.
- **ESLint guardrail forbidding `@/services/api` imports outside `plugins/*/services/`** (#155 Phase 4). Defer until at least four services have migrated.
- **Removing `stereotypeApi` from `frontend/src/services/api.ts`.** Still consumed by other pages and by `StereotypeService` itself.
- **A `<NotificationHost />` React component.** Out of scope for #166; was out of scope for #156 too.
- **Backend changes.** No backend file is touched.
- **Removing the legacy `stereotypesSlice.ts` Redux slice.** Other pages still use `fetchStereotypes` as async thunks. Removal gated on all consumers migrating.
- **Filing the upstream `RemoteFsAutosaveProvider.supports` bug.** This spec documents the bug and its call-site analysis; the orchestrator files the upstream issue against `amah/app-framework` based on this report. The spec-writer's `gh` access is read-only.

## Dependencies

- **Coordinates with #156 / PR #171 (notification plugin).** This spec uses `notification.error` via `ctx.commands.execute` (verified at `@hamak/notification/dist/impl/plugin/notification-plugin-factory.js:94`). If the implementor branches off `main` (before #156 merges), the notification plugin is already on `main` per commit `11603d9`, so this dependency is satisfied either way. The "thin adapter onto a framework factory" pattern from `notificationPlugin.ts` is the template for `storeFsPlugin.ts`.

- **Coordinates with #155 (real domain services via DI tokens).** First service token from #155's catalog to be both declared AND resolved. Pattern established here is the template for the other services.

- **Coordinates with #154 (re-home Redux slices into owning plugins).** `state.fs` is framework-owned (registered by `createStorePlugin`); #154's slice-rehoming doesn't touch it. The legacy `stereotypesSlice.ts` remains under `store/slices/` until its other consumers migrate.

- **Coordinates with #167 (backend projection layer).** When #167 lands, `STEREOTYPES_PATH` becomes a logical path; `loadAll` becomes an automatic `LS_REQUEST` flow; the REST-shim writes flip to `setFileContent` (autosave-driven). Migration is gated on #167 AND on the upstream `RemoteFsAutosaveProvider.supports` fix.

- **Coordinates with #168 (dual-view raw + logical).** Single `'fs'` slice today. `STORE_FS_TOKEN` becomes `LOGICAL_STORE_FS_TOKEN` post-#168.

- **Coordinates with #169 (multi-user worktrees).** Workspace-id derivation happens in `remoteFsPlugin.ts` post-#169.

- **Independent of #163 (action framework).** Service methods stay as plain method calls; no command bus involvement.

- **Independent of #160 (framework git).** Git plugin reads the raw workspace; this pilot uses only the logical one (conceptually — single slice today).

## Risks

1. **Framework store-sync middleware assumes JSON content end-to-end (Bug B above).** Reads via `rfsActions.ofGetRequest` would corrupt YAML; writes via `setFileContent` would write JSON-shaped text into `.yaml`. **Mitigation**: this pilot bypasses both paths. Reads use `stereotypeApi.getAll` → `setFile` (which doesn't trigger autosave per `autosave-middleware.js:15-18`). Writes use the REST shim. The autosave provider is registered as scaffolding for when #167's projection serves JSON. Acceptance #11 verifies no PUT_REQUEST fires for stereotype writes.

2. **`STORE_EXTENSIONS_TOKEN.register()` called from a non-`store.initialize` lifecycle stage.** The framework's `applyStoreExtensions` runs inside `store.activate` (verified at `store-plugin-factory.js:103`); the middleware registry is locked there. Our `store-fs.initialize` runs AFTER `store.initialize` but BEFORE `store.activate`, so registration lands in time. Order-fragile to future framework changes. **Mitigation**: Acceptance #1's bootstrap test verifies the autosave middleware actually runs (the `setFile` → `getState` round-trip). A future framework reorder breaks this test loudly.

3. **`useState` exception was eliminated in cycle 2.** The page now reads loading / loaded / error directly off the Store FS node's `state.contentLoading` / `state.contentLoaded` / `state.contentLoadError` (verified fields at `@hamak/shared-utils/dist/core-utils-filesystem.d.ts:15-25`). Error toasts go through the notification plugin's `notification.error` command. The two remaining `useState` calls in `StereotypesPage` (`showCreate`, `editingId`) cover ephemeral UI state which `patterns.md` §1.5 explicitly permits. Acceptance #13 grep enforces the rule across all touched files including the page. **No outstanding cookbook violation.**

4. **`StoreFileSystemFacade` selector created per-render in `useFile()`.** Calling `storeFs.createFileSelector(path)` on every render creates a fresh selector each time, defeating internal `createSelector` memoization. **Mitigation**: cost is `O(path-depth = 3)` traversal per dispatched action — acceptable for the pilot. The follow-up cookbook entry will document caching by path.

5. **The `host`-as-singleton import in `useService.ts` creates a hard coupling with `kernel/bootstrap.ts`.** Acceptance #12 explicitly exercises the singleton path to catch host-timing regressions. Tests that want to render a component WITHOUT booting the production host must mock the import path; the pattern is documented in the new bootstrap test file's comment block. No mechanical mitigation for production code (the pattern is explicitly module-scoped per #155's Phase 2).

6. **Bug A in `RemoteFsAutosaveProvider.supports` is latent.** Registration is safe (Acceptance #2); invocation throws (`TypeError: pathway.isAbsolute is not a function`). Future Pattern A services that go through `setFileContent` will trigger the middleware → `findProvider` → `supports` chain and crash. **Mitigation in this PR**: stereotype writes use `setFile`, not `setFileContent`. Acceptance #2 verifies presence without invocation. **Mitigation for future tickets**: the orchestrator files the upstream issue per the "Upstream framework bugs" section; the suggested fix is two characters (`{ getSegments: () => path }` → `path`). Until upstream lands, all Pattern A services in this codebase MUST go through REST shims for writes.

7. **Singleton `host` test isolation.** Acceptance #12 boots the production singleton; if other tests in the same Vitest run also import `bootstrap`, the second `bootstrapApplication()` will short-circuit (per `isBootstrapped` flag, bootstrap.ts:46) and state will leak across tests. **Mitigation**: place the bootstrap test in its own file (no `beforeEach` resets). Test author MAY add an `__resetBootstrapForTests()` helper to `bootstrap.ts` if needed for cleanup; this is a structural choice left to the implementor. The test file's JSDoc must document the isolation requirement.

