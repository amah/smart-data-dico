/**
 * #166 stereotype-slice pilot — Host bootstrap for `storeFsPlugin`.
 *
 * Covers spec acceptance criteria #1, #2, #3 — Store FS DI plumbing:
 *   #1  STORE_FS_TOKEN resolves a working facade (Proxy in initialize,
 *       filled in activate; post-activate the facade methods are usable
 *       and a setFile dispatch populates state.fs.root.children).
 *   #2  AUTOSAVE_REGISTRY_TOKEN resolves a registry containing the
 *       remote-fs provider — PRESENCE-ONLY (per Bug A in spec, never
 *       invokes `provider.supports(...)`).
 *   #3  state.fs is populated with the framework's initial shape and
 *       selector-readable.
 *
 * Hygiene (same pattern as #156's notificationPlugin.test.ts):
 *   - we bootstrap our OWN Host instance, NOT the production singleton —
 *     test isolation per spec criterion #12 note.
 *   - we do NOT invoke provider.supports() because the published
 *     framework build's RemoteFsAutosaveProvider.supports() throws
 *     TypeError due to duck-typed Pathway argument (Bug A in spec).
 *   - we do NOT dispatch setFileContent / updateFileContent. setFile is
 *     used exclusively (the same path the production code uses), so
 *     the broken supports() path is never reached.
 */

import { describe, it, expect } from 'vitest';
import { Host } from '@hamak/microkernel-impl';
import {
  STORE_MANAGER_TOKEN,
  AUTOSAVE_REGISTRY_TOKEN,
  type IStoreManager,
} from '@hamak/ui-store-api';
import type {
  AutosaveProviderRegistry,
  StoreFileSystemFacade,
} from '@hamak/ui-store-impl';

import { createAppStorePlugin } from '../storePlugin';
import { createAppStoreFsPlugin } from '../storeFsPlugin';
import { createAppRemoteFsPlugin } from '../../remote-fs/remoteFsPlugin';
import { STORE_FS_TOKEN } from '../../../kernel/tokens';

/** Plugin manifest helper — keeps the test bodies focused on assertions. */
const manifest = (name: string, dependsOn?: string[]) => ({
  name,
  version: '1.0.0',
  entry: '',
  ...(dependsOn ? { dependsOn } : {}),
});

/**
 * Build a Host with [store, remote-fs, store-fs] registered in source
 * order. The host's topo-sort handles ordering during initialize/activate.
 */
async function bootstrapStoreFsHost(): Promise<{
  host: Host;
  storeFs: StoreFileSystemFacade<unknown>;
  registry: AutosaveProviderRegistry;
  storeManager: IStoreManager;
}> {
  const host = new Host([], undefined, { debug: false });

  host.registerPlugin('store', manifest('store'), createAppStorePlugin());
  host.registerPlugin(
    'remote-fs',
    manifest('remote-fs', ['store']),
    createAppRemoteFsPlugin(),
  );
  host.registerPlugin(
    'store-fs',
    manifest('store-fs', ['store', 'remote-fs']),
    createAppStoreFsPlugin(),
  );

  await host.bootstrapAllAtRoot();

  const ctx = host.rootActivationCtx!;
  const storeFs = ctx.resolve<StoreFileSystemFacade<unknown>>(STORE_FS_TOKEN);
  const registry = ctx.resolve<AutosaveProviderRegistry>(
    AUTOSAVE_REGISTRY_TOKEN,
  );
  const storeManager = ctx.resolve<IStoreManager>(STORE_MANAGER_TOKEN);

  return { host, storeFs, registry, storeManager };
}

describe('storeFsPlugin (#166 acceptance #1, #2, #3)', () => {
  it('#1a — STORE_FS_TOKEN resolves a truthy facade after activate', async () => {
    const { storeFs } = await bootstrapStoreFsHost();
    expect(storeFs).toBeTruthy();
  });

  it('#1b — facade exposes getActions / createSelector / createFileSelector / selectFileFromRoot as functions', async () => {
    const { storeFs } = await bootstrapStoreFsHost();
    // Per fs-facade.d.ts — these four are the documented Pattern A surface.
    expect(typeof storeFs.getActions).toBe('function');
    expect(typeof storeFs.createSelector).toBe('function');
    expect(typeof storeFs.createFileSelector).toBe('function');
    expect(typeof storeFs.selectFileFromRoot).toBe('function');
  });

  it('#1c — dispatching getActions().setFile populates state.fs and is selector-readable', async () => {
    const { storeFs, storeManager } = await bootstrapStoreFsHost();

    const store = storeManager.getStore();
    const actions = storeFs.getActions();

    // NOTE: spec acceptance #1 uses `setFile(['x'], 42, ...)` — a single-
    // segment top-level path. setFile against a fresh root.children: {}
    // works for top-level keys (no intermediate dir to create). For deeper
    // paths the production code dispatches mkdir first; we mirror the
    // spec's simplest happy-path here.
    store.dispatch(
      actions.setFile(['x'], 42, 'application/json', {
        override: true,
        contentIsPresent: true,
      }),
    );

    // Read back via the facade — explicitly the spec-mandated method.
    const file = storeFs.selectFileFromRoot(store.getState(), ['x']);
    expect(file).toBeDefined();
    expect(file?.content).toBe(42);
  });

  it('#2 — AUTOSAVE_REGISTRY_TOKEN resolves a registry with exactly one provider (remote-fs / priority 10)', async () => {
    const { registry } = await bootstrapStoreFsHost();

    const providers = registry.getAll();
    // PRESENCE-ONLY per Bug A — we do not call provider.supports() here.
    expect(providers).toHaveLength(1);

    const provider = providers[0];
    expect(provider.id).toBe('remote-fs');
    expect(provider.priority).toBe(10);
  });

  it('#3 — state.fs exists in RootState with the framework initial shape', async () => {
    const { storeManager } = await bootstrapStoreFsHost();

    const state = storeManager.getStore().getState() as {
      fs?: {
        root?: {
          type?: string;
          name?: string;
          children?: Record<string, unknown>;
          state?: { contentLoaded?: boolean };
        };
      };
    };

    expect(state.fs).toBeDefined();
    expect(state.fs?.root).toBeDefined();
    // fs-adapter.js:25-27 — initial root is a directory with empty children.
    expect(state.fs?.root?.type).toBe('directory');
    // The empty root name is the framework's documented contract.
    expect(state.fs?.root?.name).toBe('');
    expect(state.fs?.root?.children).toEqual({});
  });
});
