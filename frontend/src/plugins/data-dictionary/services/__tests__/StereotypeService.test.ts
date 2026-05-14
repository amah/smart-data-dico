/**
 * #166 stereotype-slice pilot — StereotypeService unit suite.
 *
 * Covers spec acceptance criteria #4–#11:
 *   #4  STEREOTYPE_SERVICE_TOKEN resolves a service with the documented
 *       method shape.
 *   #5  useAll() returns Store FS-cached data after hydrate().
 *   #6  useFile() exposes contentLoaded / contentLoadError from the node.
 *   #7  loadAll() populates Store FS through MSW-mocked REST.
 *   #8  loadAll() failure marks node as not loaded AND fires notify('error', …).
 *   #9  create() POSTs through REST and updates the cache.
 *   #10 update() and delete() likewise refresh the cache.
 *   #11 No autosave PUT_REQUEST fires for stereotype writes (uses setFile,
 *       which is NOT in CONTENT_CHANGE_ACTION_TYPES).
 *
 * Bootstrap strategy: we boot a real `Host` with [store, remote-fs, store-fs,
 * data-dictionary] (own Host instance, NOT the singleton). This exercises
 * the same DI path the production singleton uses and lets us assert
 * STEREOTYPE_SERVICE_TOKEN resolves a real service. For Pattern A
 * facade behavior tests (#5–#11) we then drive the service imperatively
 * with MSW intercepting the REST endpoints.
 *
 * Hygiene mirrors the storeFsPlugin test:
 *   - own Host instance (no production singleton mutation).
 *   - setFile only — never setFileContent / updateFileContent (Bug A).
 *   - provider.supports() is NEVER invoked (Bug A).
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
} from 'vitest';
import { render, act } from '@testing-library/react';
import { Provider } from 'react-redux';
import { http, HttpResponse } from 'msw';
import React from 'react';

import { Host } from '@hamak/microkernel-impl';
import {
  STORE_MANAGER_TOKEN,
  type IStoreManager,
} from '@hamak/ui-store-api';
import { RemoteFsActionTypes } from '@hamak/ui-remote-fs/api';

import { createAppStorePlugin } from '../../../store/storePlugin';
import { createAppStoreFsPlugin } from '../../../store/storeFsPlugin';
import { createAppRemoteFsPlugin } from '../../../remote-fs/remoteFsPlugin';
import { createDataDictionaryPlugin } from '../../dataDictionaryPlugin';
import { STEREOTYPE_SERVICE_TOKEN } from '../../../../kernel/tokens';
import {
  StereotypeService,
  STEREOTYPES_PATH,
} from '../StereotypeService';
import { server } from '../../../../test/setup';
import type { Stereotype } from '../../../../types';

const manifest = (name: string, dependsOn?: string[]) => ({
  name,
  version: '1.0.0',
  entry: '',
  ...(dependsOn ? { dependsOn } : {}),
});

interface BootstrappedHost {
  host: Host;
  service: StereotypeService;
  storeManager: IStoreManager;
}

async function bootstrapServiceHost(): Promise<BootstrappedHost> {
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
  host.registerPlugin(
    'data-dictionary',
    manifest('data-dictionary', ['store', 'store-fs']),
    createDataDictionaryPlugin(),
  );

  await host.bootstrapAllAtRoot();

  const ctx = host.rootActivationCtx!;
  const service = ctx.resolve<StereotypeService>(STEREOTYPE_SERVICE_TOKEN);
  const storeManager = ctx.resolve<IStoreManager>(STORE_MANAGER_TOKEN);
  return { host, service, storeManager };
}

/**
 * Build a StereotypeService directly against a bootstrapped store, with a
 * custom notify callback. Used for #8 — we need to assert the notify spy
 * was called, and the plugin's `notify` swallows command errors silently.
 */
async function bootstrapServiceWithSpy(): Promise<{
  service: StereotypeService;
  storeManager: IStoreManager;
  notify: ReturnType<typeof vi.fn>;
  host: Host;
}> {
  // Bootstrap [store, remote-fs, store-fs] (omit data-dictionary so we can
  // build our own service with a spy notify callback). Resolution of
  // STORE_FS_TOKEN below returns the framework Proxy already wired through
  // store-fs.activate.
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
  const { STORE_FS_TOKEN } = await import('../../../../kernel/tokens');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const storeFs = ctx.resolve<any>(STORE_FS_TOKEN);
  const storeManager = ctx.resolve<IStoreManager>(STORE_MANAGER_TOKEN);

  const notify = vi.fn();
  const service = new StereotypeService(
    storeFs,
    (action) => storeManager.dispatch(action),
    () => storeManager.getState(),
    notify,
  );
  return { service, storeManager, notify, host };
}

/** Fixture array — a single stereotype with full shape. */
const FIXTURE: Stereotype[] = [
  {
    id: 'aggregate-root',
    name: 'Aggregate Root',
    description: 'DDD aggregate-root marker',
    domain: 'DDD',
    appliesTo: 'entity',
    metadataDefinitions: [],
  },
];

describe('StereotypeService — DI resolution (#4)', () => {
  it('resolves a StereotypeService instance with the expected method shape', async () => {
    const { service } = await bootstrapServiceHost();
    expect(service).toBeInstanceOf(StereotypeService);

    // Public surface (signatures section of spec).
    const methods = [
      'useFile',
      'useAll',
      'useByTarget',
      'loadAll',
      'getAll',
      'create',
      'update',
      'delete',
    ] as const;
    for (const m of methods) {
      expect(
        typeof (service as unknown as Record<string, unknown>)[m],
      ).toBe('function');
    }
  });
});

describe('StereotypeService — Pattern A facade behavior (#5–#10)', () => {
  it('#5 — useAll() returns Store FS-cached data after hydrate', async () => {
    const { service, storeManager } = await bootstrapServiceHost();

    // Drive `hydrate` via loadAll() with a fixture intercept — simplest
    // and exercises the same internal path. The probe component reads
    // service.useAll() once it mounts.
    server.use(
      http.get('/api/stereotypes', () =>
        HttpResponse.json({ data: FIXTURE }),
      ),
    );

    await service.loadAll();

    const store = storeManager.getStore();
    let captured: Stereotype[] | undefined;
    function Probe() {
      captured = service.useAll();
      return null;
    }
    render(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      React.createElement(Provider as any, { store }, React.createElement(Probe)),
    );

    expect(captured).toEqual(FIXTURE);
  });

  it('#6a — useFile() returns a node with contentLoaded=true after successful load', async () => {
    const { service, storeManager } = await bootstrapServiceHost();

    server.use(
      http.get('/api/stereotypes', () =>
        HttpResponse.json({ data: FIXTURE }),
      ),
    );
    await service.loadAll();

    const store = storeManager.getStore();
    let node: ReturnType<StereotypeService['useFile']>;
    function Probe() {
      node = service.useFile();
      return null;
    }
    render(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      React.createElement(Provider as any, { store }, React.createElement(Probe)),
    );

    expect(node).toBeDefined();
    expect(node?.state.contentLoaded).toBe(true);
    expect(node?.state.contentLoadError).toBeUndefined();
  });

  it('#6b — useFile() returns a node with contentLoaded=false after a failed load', async () => {
    const { service, storeManager, notify } = await bootstrapServiceWithSpy();

    server.use(
      http.get('/api/stereotypes', () =>
        HttpResponse.json({ message: 'boom' }, { status: 500 }),
      ),
    );

    await expect(service.loadAll()).rejects.toBeDefined();
    expect(notify).toHaveBeenCalled(); // checked in detail in #8

    const store = storeManager.getStore();
    let node: ReturnType<StereotypeService['useFile']>;
    function Probe() {
      node = service.useFile();
      return null;
    }
    render(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      React.createElement(Provider as any, { store }, React.createElement(Probe)),
    );

    expect(node).toBeDefined();
    expect(node?.state.contentLoaded).toBe(false);
  });

  it('#7 — loadAll() populates Store FS through MSW-mocked REST', async () => {
    const { service } = await bootstrapServiceHost();
    server.use(
      http.get('/api/stereotypes', () =>
        HttpResponse.json({ data: FIXTURE }),
      ),
    );

    const result = await service.loadAll();
    expect(result).toEqual(FIXTURE);

    // After load, getAll() (cache read) returns the fixture.
    expect(service.getAll()).toEqual(FIXTURE);
  });

  it('#8 — loadAll() failure marks node as not loaded AND fires notify("error", …)', async () => {
    const { service, notify } = await bootstrapServiceWithSpy();

    server.use(
      http.get('/api/stereotypes', () =>
        HttpResponse.json({ message: 'kaboom' }, { status: 500 }),
      ),
    );

    await expect(service.loadAll()).rejects.toBeDefined();

    // notify called once with ('error', <some non-empty message>).
    expect(notify).toHaveBeenCalledTimes(1);
    const [level, message] = notify.mock.calls[0];
    expect(level).toBe('error');
    expect(typeof message).toBe('string');
    expect((message as string).length).toBeGreaterThan(0);
  });

  it('#9 — create() POSTs through REST and updates the cache', async () => {
    const { service } = await bootstrapServiceHost();

    // Pre-populate with empty list via a load.
    server.use(
      http.get('/api/stereotypes', () =>
        HttpResponse.json({ data: [] }),
      ),
    );
    await service.loadAll();
    expect(service.getAll()).toEqual([]);

    let postCount = 0;
    const NEW_STEREOTYPE: Stereotype = {
      id: 'value-object',
      name: 'Value Object',
      appliesTo: 'entity',
      metadataDefinitions: [],
    };
    server.use(
      http.post('/api/stereotypes', async ({ request }) => {
        postCount += 1;
        const body = (await request.json()) as Stereotype;
        return HttpResponse.json({ success: true, stereotype: body });
      }),
    );

    const created = await service.create(NEW_STEREOTYPE);
    expect(created).toMatchObject(NEW_STEREOTYPE);
    expect(postCount).toBe(1);

    const all = service.getAll();
    expect(all).toHaveLength(1);
    expect(all?.[0]).toMatchObject(NEW_STEREOTYPE);
  });

  it('#10a — update() PUTs through REST and refreshes the cache', async () => {
    const { service } = await bootstrapServiceHost();

    server.use(
      http.get('/api/stereotypes', () =>
        HttpResponse.json({ data: FIXTURE }),
      ),
    );
    await service.loadAll();

    let putCount = 0;
    server.use(
      http.put('/api/stereotypes/:id', async ({ request, params }) => {
        putCount += 1;
        const patch = (await request.json()) as Partial<Stereotype>;
        return HttpResponse.json({
          success: true,
          stereotype: {
            ...FIXTURE[0],
            ...patch,
            id: params.id,
          },
        });
      }),
    );

    const updated = await service.update('aggregate-root', {
      description: 'updated description',
    });
    expect(putCount).toBe(1);
    expect(updated.description).toBe('updated description');

    const all = service.getAll();
    expect(all).toHaveLength(1);
    expect(all?.[0].description).toBe('updated description');
  });

  it('#10b — delete() DELETEs through REST and refreshes the cache', async () => {
    const { service } = await bootstrapServiceHost();

    server.use(
      http.get('/api/stereotypes', () =>
        HttpResponse.json({ data: FIXTURE }),
      ),
    );
    await service.loadAll();
    expect(service.getAll()).toHaveLength(1);

    let deleteCount = 0;
    server.use(
      http.delete('/api/stereotypes/:id', () => {
        deleteCount += 1;
        return HttpResponse.json({ success: true });
      }),
    );

    await service.delete('aggregate-root');
    expect(deleteCount).toBe(1);
    expect(service.getAll()).toEqual([]);
  });
});

describe('StereotypeService — autosave never claims stereotype writes (#11)', () => {
  /**
   * The autosave middleware only watches `set-file-content` and
   * `update-file-content` action types. `hydrate` (the only write path
   * stereotypes take into Store FS) uses `setFile`, whose action type is
   * `${sliceName}/createFileNode`. We assert that across a full create
   * cycle, no action matching RemoteFsActionTypes.PUT_REQUEST is
   * dispatched. Symbolic — uses the enum, not a hardcoded string.
   */
  it('#11 — service.create(...) does NOT dispatch any RemoteFsActionTypes.PUT_REQUEST', async () => {
    const { service, storeManager } = await bootstrapServiceHost();

    // Subscribe to every dispatched action via a tap on dispatch.
    const dispatched: string[] = [];
    const originalDispatch = storeManager.dispatch.bind(storeManager);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (storeManager as any).dispatch = (action: { type: string }) => {
      if (action && typeof action.type === 'string') {
        dispatched.push(action.type);
      }
      return originalDispatch(action);
    };

    server.use(
      http.get('/api/stereotypes', () =>
        HttpResponse.json({ data: [] }),
      ),
      http.post('/api/stereotypes', async ({ request }) => {
        const body = await request.json();
        return HttpResponse.json({ success: true, stereotype: body });
      }),
    );

    await service.loadAll();
    await service.create({
      id: 'X',
      name: 'X',
      appliesTo: 'entity',
      metadataDefinitions: [],
    });

    // Restore dispatch (defensive — bootstrap creates a fresh host per test).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (storeManager as any).dispatch = originalDispatch;

    expect(dispatched.length).toBeGreaterThan(0);
    expect(dispatched).not.toContain(RemoteFsActionTypes.PUT_REQUEST);
  });
});

describe('StereotypeService — module shape', () => {
  it('STEREOTYPES_PATH points at ["dictionaries", ".dico", "stereotypes.yaml"]', () => {
    expect([...STEREOTYPES_PATH]).toEqual([
      'dictionaries',
      '.dico',
      'stereotypes.yaml',
    ]);
  });
});

// Suppress unused-var lint noise from React.createElement use in probes.
beforeEach(() => {
  // no-op
});
afterEach(() => {
  // server.resetHandlers() runs from src/test/setup.ts afterEach.
});

// Workaround: `act` import is needed by the React 18 testing-library
// to silence "wrap in act" warnings if probes ever fire async state
// updates. Reference it once so lint doesn't complain.
void act;
