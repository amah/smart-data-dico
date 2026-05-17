/**
 * LogicalProjection.cases.test.ts — #167 slice 6e.1
 *
 * Covers AC2 (writeCase preserves multi-kind), AC3 (path/name mismatch
 * throws), and case-deletion semantics. AC15 case arm verified here too.
 */

import type { Case } from '../../../models/EntitySchema.js';
import { InMemoryStorageBackend } from '../../memory/InMemoryStorageBackend.js';
import { wsId } from '../../contract/types.js';
import {
  LogicalProjection,
  type InvalidationCallback,
  type ProjectionInvalidationEvent,
} from '../LogicalProjection.js';

jest.mock('../../../utils/logger', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
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

const ORDER_SERVICE_PACKAGE_YAML = `name: order-service\n`;

const ORDER_ENTITY_YAML = `
entities:
  - name: Order
    uuid: "00000000-0000-4000-8000-000000000001"
    description: "The Order entity"
    attributes:
      - name: orderId
        uuid: "00000000-0000-4000-8000-0000000000a1"
        description: "Order identifier"
        type: uuid
        required: true
`.trimStart();

function createSeededBackend(): InMemoryStorageBackend {
  const backend = new InMemoryStorageBackend();
  const ws = String(DICT_WS);
  if (!backend.files.has(ws)) backend.files.set(ws, new Map());
  let rootDirs = backend.dirs.get(ws);
  if (!rootDirs) {
    rootDirs = new Set<string>();
    backend.dirs.set(ws, rootDirs);
  }
  rootDirs.add('');
  const bucket = backend.files.get(ws)!;
  bucket.set('order-service/package.yaml', ORDER_SERVICE_PACKAGE_YAML);
  bucket.set('order-service/Order.model.yaml', ORDER_ENTITY_YAML);
  return backend;
}

function createSpy(): { calls: ProjectionInvalidationEvent[]; cb: InvalidationCallback } {
  const calls: ProjectionInvalidationEvent[] = [];
  return { calls, cb: (e: ProjectionInvalidationEvent) => { calls.push(e); } };
}

function makeCase(uuid: string, name: string): Case {
  return {
    uuid,
    name,
    description: 'a case',
    rootEntities: ['00000000-0000-4000-8000-000000000001'],
    nodes: [],
    maxDepth: 10,
    metadata: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

let backend: InMemoryStorageBackend;
let projection: LogicalProjection;

beforeEach(async () => {
  backend = createSeededBackend();
  await setBackendDynamic(backend);
  projection = new LogicalProjection(backend, DICT_WS);
});

afterEach(async () => {
  await resetRegistryDynamic();
});

describe('LogicalProjection.writeCase / readCase / deleteCase — slice 6e.1', () => {
  it('C1 (AC2+AC15): writeCase preserves entities and fires case-written event', async () => {
    const spy = createSpy();
    projection.onInvalidate(spy.cb);

    const c = makeCase('case-00000000-0000-4000-8000-000000000001', 'OrderFulfillment');

    await projection.writeCase('packages/order-service/cases/OrderFulfillment', c);

    // Entity preservation
    const { loadPackage } = await import('../../../utils/fileOperations.js');
    const pkg = await loadPackage('order-service');
    expect(pkg.entities.find(e => e.name === 'Order')).toBeDefined();

    // Case present
    expect(pkg.cases.find(p => p.uuid === c.uuid)).toBeDefined();

    // Event payload
    expect(spy.calls).toHaveLength(1);
    const evt = spy.calls[0];
    expect(evt.kind).toBe('case-written');
    if (evt.kind !== 'case-written') throw new Error('unreachable');
    expect(evt.logicalPath).toBe('packages/order-service/cases/OrderFulfillment');
    expect(evt.uuid).toBe(c.uuid);
  });

  it('C2 (AC3): writeCase throws on path/name mismatch and fires no event', async () => {
    const spy = createSpy();
    projection.onInvalidate(spy.cb);

    const c = makeCase('case-00000000-0000-4000-8000-000000000002', 'ActualName');

    await expect(
      projection.writeCase('packages/order-service/cases/DifferentName', c),
    ).rejects.toThrow(/path\/content mismatch/);

    expect(spy.calls).toHaveLength(0);
  });

  it('C3: writeCase throws on malformed path', async () => {
    const c = makeCase('case-00000000-0000-4000-8000-000000000003', 'Foo');
    await expect(
      projection.writeCase('not-a-valid-path', c),
    ).rejects.toThrow(/malformed path/);
  });

  it('C4: readCase round-trips a written case', async () => {
    const c = makeCase('case-00000000-0000-4000-8000-000000000004', 'Readback');
    await projection.writeCase('packages/order-service/cases/Readback', c);

    const got = await projection.readCase('packages/order-service/cases/Readback');
    expect(got).not.toBeNull();
    expect(got!.uuid).toBe(c.uuid);
    expect(got!.name).toBe('Readback');
  });

  it('C5: readCase returns null on missing case', async () => {
    const got = await projection.readCase('packages/order-service/cases/Nonexistent');
    expect(got).toBeNull();
  });

  it('C6: deleteCase removes a case and fires case-deleted event', async () => {
    const c = makeCase('case-00000000-0000-4000-8000-000000000005', 'Disposable');
    await projection.writeCase('packages/order-service/cases/Disposable', c);

    const spy = createSpy();
    projection.onInvalidate(spy.cb);

    const ok = await projection.deleteCase('packages/order-service/cases/Disposable');
    expect(ok).toBe(true);

    // Read again returns null
    const after = await projection.readCase('packages/order-service/cases/Disposable');
    expect(after).toBeNull();

    // One case-deleted event
    expect(spy.calls).toHaveLength(1);
    const evt = spy.calls[0];
    expect(evt.kind).toBe('case-deleted');
    if (evt.kind !== 'case-deleted') throw new Error('unreachable');
    expect(evt.logicalPath).toBe('packages/order-service/cases/Disposable');
    expect(evt.uuid).toBe(c.uuid);
  });

  it('C7: deleteCase on missing case returns false and fires no event', async () => {
    const spy = createSpy();
    projection.onInvalidate(spy.cb);

    const ok = await projection.deleteCase('packages/order-service/cases/Nonexistent');
    expect(ok).toBe(false);
    expect(spy.calls).toHaveLength(0);
  });
});
