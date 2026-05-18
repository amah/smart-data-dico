/**
 * UuidIndex.rawChanged.test.ts — #167 slice 6e.2
 *
 * Tests the UuidIndex's response to `raw-changed` projection invalidation
 * events. We drive `projection.fireExternalInvalidation(...)` directly
 * (the public hook the RawFsWatcher would call) so this test stays
 * synchronous and disk-free.
 *
 * Acceptance criteria covered:
 *   - AC12: physicalPath = `<pkg>/Foo.model.yaml` triggers `rebuildPackage('<pkg>')`,
 *     full rebuild for `rules.yaml` (workspace-root) and `.dico/...` paths.
 */

import { type Entity } from '../../../models/EntitySchema.js';
import { InMemoryStorageBackend } from '../../memory/InMemoryStorageBackend.js';
import { wsId } from '../../contract/types.js';
import { LogicalProjection, type LogicalPath } from '../LogicalProjection.js';
import { UuidIndex, resetUuidIndexRegistry } from '../UuidIndex.js';

// Suppress logger noise from fileOperations.ts
jest.mock('../../../utils/logger', () => ({
  logger: {
    warn: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  },
}));

const DICT_WS = wsId('dictionaries');

async function setBackendDynamic(backend: InMemoryStorageBackend): Promise<void> {
  const { storageRegistry } = await import('../../contract/StorageBackendToken.js');
  storageRegistry.setBackend(backend);
}

async function resetRegistryDynamic(): Promise<void> {
  const { storageRegistry } = await import('../../contract/StorageBackendToken.js');
  storageRegistry.reset();
}

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures (mirrors UuidIndex.test.ts)
// ─────────────────────────────────────────────────────────────────────────────

const ORDER_YAML = `
entities:
  - name: Order
    uuid: "00000000-0000-4000-8000-000000000001"
    description: "The Order entity"
    attributes:
      - name: orderId
        uuid: "00000000-0000-4000-8000-0000000000a1"
        type: uuid
        required: true
`.trimStart();

const USER_YAML = `
entities:
  - name: User
    uuid: "00000000-0000-4000-8000-000000000010"
    description: "User entity"
    attributes:
      - name: userId
        uuid: "00000000-0000-4000-8000-0000000000b1"
        type: uuid
        required: true
`.trimStart();

const ORDER_SERVICE_PACKAGE_YAML = `name: order-service\n`;
const USER_SERVICE_PACKAGE_YAML = `name: user-service\n`;

function createSeededBackend(): InMemoryStorageBackend {
  const backend = new InMemoryStorageBackend();
  const ws = String(DICT_WS);
  if (!backend.files.has(ws)) backend.files.set(ws, new Map());
  const bucket = backend.files.get(ws)!;
  let rootDirs = backend.dirs.get(ws);
  if (!rootDirs) {
    rootDirs = new Set<string>();
    backend.dirs.set(ws, rootDirs);
  }
  rootDirs.add('');
  bucket.set('order-service/package.yaml', ORDER_SERVICE_PACKAGE_YAML);
  bucket.set('order-service/Order.model.yaml', ORDER_YAML);
  bucket.set('user-service/package.yaml', USER_SERVICE_PACKAGE_YAML);
  bucket.set('user-service/User.model.yaml', USER_YAML);
  return backend;
}

// ─────────────────────────────────────────────────────────────────────────────
// Setup
// ─────────────────────────────────────────────────────────────────────────────

let backend: InMemoryStorageBackend;
let projection: LogicalProjection;
let uuidIndex: UuidIndex;

beforeEach(async () => {
  backend = createSeededBackend();
  await setBackendDynamic(backend);
  projection = new LogicalProjection(backend, DICT_WS);
  uuidIndex = new UuidIndex(projection, DICT_WS, backend);
  await uuidIndex.rebuild();
  uuidIndex.start();
});

afterEach(async () => {
  await resetRegistryDynamic();
  resetUuidIndexRegistry();
});

// ─────────────────────────────────────────────────────────────────────────────
// T1 — raw-changed under `<pkg>/...` triggers rebuildPackage for that package
// ─────────────────────────────────────────────────────────────────────────────

describe('T1: raw-changed under packages/<pkg>/... rebuilds that package', () => {
  it('calls rebuildPackage("order-service") for order-service/Order.model.yaml', async () => {
    const spy = jest.spyOn(uuidIndex, 'rebuildPackage');
    projection.fireExternalInvalidation({
      kind: 'raw-changed',
      physicalPath: 'order-service/Order.model.yaml',
      changeKind: 'change',
    });
    // Subscriber dispatch is async (handleEvent awaits in-flight rebuild). Wait
    // a microtask tick for the spy to register.
    await new Promise(r => setImmediate(r));
    await new Promise(r => setImmediate(r));
    expect(spy).toHaveBeenCalledWith('order-service');
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('does NOT call rebuildPackage for user-service when order-service is mutated', async () => {
    const spy = jest.spyOn(uuidIndex, 'rebuildPackage');
    projection.fireExternalInvalidation({
      kind: 'raw-changed',
      physicalPath: 'order-service/NewEntity.model.yaml',
      changeKind: 'add',
    });
    await new Promise(r => setImmediate(r));
    await new Promise(r => setImmediate(r));
    expect(spy).not.toHaveBeenCalledWith('user-service');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T2 — Non-package path (workspace-root rules.yaml) triggers full rebuild
// ─────────────────────────────────────────────────────────────────────────────

describe('T2: raw-changed for non-package path triggers full rebuild', () => {
  it('falls back to rebuild() for `rules.yaml` (workspace-root)', async () => {
    const fullRebuildSpy = jest.spyOn(uuidIndex, 'rebuild');
    const pkgRebuildSpy = jest.spyOn(uuidIndex, 'rebuildPackage');
    projection.fireExternalInvalidation({
      kind: 'raw-changed',
      physicalPath: 'rules.yaml',
      changeKind: 'change',
    });
    await new Promise(r => setImmediate(r));
    await new Promise(r => setImmediate(r));
    expect(fullRebuildSpy).toHaveBeenCalledTimes(1);
    expect(pkgRebuildSpy).not.toHaveBeenCalled();
  });

  it('falls back to rebuild() for `.dico/schemas/*.entity.yaml`', async () => {
    const fullRebuildSpy = jest.spyOn(uuidIndex, 'rebuild');
    projection.fireExternalInvalidation({
      kind: 'raw-changed',
      physicalPath: '.dico/schemas/some.entity.yaml',
      changeKind: 'change',
    });
    await new Promise(r => setImmediate(r));
    await new Promise(r => setImmediate(r));
    expect(fullRebuildSpy).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T3 — rebuildPackage reconciles add / remove entries for that package only
// ─────────────────────────────────────────────────────────────────────────────

describe('T3: rebuildPackage updates the index based on disk state', () => {
  it('adds a new entity that appeared on disk for the affected package', async () => {
    // Drop a new entity straight into the backend (simulating an external write).
    const bucket = backend.files.get(String(DICT_WS))!;
    bucket.set('order-service/Foo.model.yaml', `
entities:
  - name: Foo
    uuid: "00000000-0000-4000-8000-0000000000ff"
    description: "Foo"
    attributes: []
`.trimStart());

    // Before the rebuild, the index does not know about Foo.
    expect(uuidIndex.findPathByUuid('00000000-0000-4000-8000-0000000000ff')).toBeNull();

    await uuidIndex.rebuildPackage('order-service');

    expect(uuidIndex.findPathByUuid('00000000-0000-4000-8000-0000000000ff'))
      .toBe('packages/order-service/entities/Foo');
    // And Order is still indexed.
    expect(uuidIndex.findPathByUuid('00000000-0000-4000-8000-000000000001'))
      .toBe('packages/order-service/entities/Order');
    // And User (a different package) was NOT touched by the spy / rescan.
    expect(uuidIndex.findPathByUuid('00000000-0000-4000-8000-000000000010'))
      .toBe('packages/user-service/entities/User');
  });

  it('prunes an entity that disappeared from disk for the affected package', async () => {
    const orderUuid = '00000000-0000-4000-8000-000000000001';
    expect(uuidIndex.findPathByUuid(orderUuid)).not.toBeNull();

    // Simulate external delete of the only entity file in order-service.
    const bucket = backend.files.get(String(DICT_WS))!;
    bucket.delete('order-service/Order.model.yaml');

    await uuidIndex.rebuildPackage('order-service');

    expect(uuidIndex.findPathByUuid(orderUuid)).toBeNull();
    const userUuid = '00000000-0000-4000-8000-000000000010';
    // User (other package) untouched.
    expect(uuidIndex.findPathByUuid(userUuid))
      .toBe('packages/user-service/entities/User');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T4 — Smoke: raw-changed path actually exercises the handler end-to-end
// ─────────────────────────────────────────────────────────────────────────────

describe('T4: end-to-end fireExternalInvalidation → handleRawChanged → rebuildPackage', () => {
  it('after firing raw-changed, the index reflects the new state', async () => {
    const bucket = backend.files.get(String(DICT_WS))!;
    bucket.set('order-service/Bar.model.yaml', `
entities:
  - name: Bar
    uuid: "00000000-0000-4000-8000-0000000000bb"
    description: "Bar"
    attributes: []
`.trimStart());

    projection.fireExternalInvalidation({
      kind: 'raw-changed',
      physicalPath: 'order-service/Bar.model.yaml',
      changeKind: 'add',
    });
    // Allow the floating-promise handler to run.
    await new Promise(r => setImmediate(r));
    await new Promise(r => setImmediate(r));
    // Also wait for the inner await on listEntitiesInPackage to settle.
    await new Promise(r => setTimeout(r, 50));

    const newUuid = '00000000-0000-4000-8000-0000000000bb';
    expect(uuidIndex.findPathByUuid(newUuid))
      .toBe('packages/order-service/entities/Bar');
  });
});

// Silence unused-import warnings (Entity / LogicalPath used as type imports).
void ([] as Entity[]);
void ('' as LogicalPath);
