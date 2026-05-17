/**
 * LogicalProjection.relationships.test.ts — #167 slice 6e.1
 *
 * Covers AC1 (projection writes relationships) and AC15 (multi-kind
 * preservation across all new writers, relationship arm).
 */

import type { Relationship } from '../../../models/EntitySchema.js';
import { Cardinality } from '../../../models/EntitySchema.js';
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

// Multi-kind file: entities + relationships in the same .model.yaml. Exercises
// the AC1 / AC15 reflex — write through relationships must NOT lose the
// entities section.
const ORDER_AGGREGATE_YAML = `
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
  - name: OrderItem
    uuid: "00000000-0000-4000-8000-000000000002"
    description: "A line item"
    attributes:
      - name: quantity
        uuid: "00000000-0000-4000-8000-0000000000a2"
        description: "Quantity"
        type: integer
        required: true
relationships:
  - uuid: "rel-00000000-0000-4000-8000-000000000010"
    description: "Order contains items"
    source:
      entity: "00000000-0000-4000-8000-000000000001"
      cardinality: one
    target:
      entity: "00000000-0000-4000-8000-000000000002"
      cardinality: many
`.trimStart();

const ORDER_SERVICE_PACKAGE_YAML = `name: order-service\n`;

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
  bucket.set('order-service/Order.model.yaml', ORDER_AGGREGATE_YAML);
  return backend;
}

function createSpy(): { calls: ProjectionInvalidationEvent[]; cb: InvalidationCallback } {
  const calls: ProjectionInvalidationEvent[] = [];
  return { calls, cb: (e: ProjectionInvalidationEvent) => { calls.push(e); } };
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

describe('LogicalProjection.writeRelationships — slice 6e.1', () => {
  it('R1 (AC1+AC15): writes new relationships and fires relationships-written event with uuids', async () => {
    const spy = createSpy();
    projection.onInvalidate(spy.cb);

    const newRel: Relationship = {
      uuid: 'rel-00000000-0000-4000-8000-000000000099',
      description: 'replacement',
      source: {
        entity: '00000000-0000-4000-8000-000000000001',
        cardinality: Cardinality.ONE,
      },
      target: {
        entity: '00000000-0000-4000-8000-000000000002',
        cardinality: Cardinality.MANY,
      },
    };

    await projection.writeRelationships('packages/order-service', [newRel]);

    // (a) Existing entities section preserved (multi-kind reflex)
    const { loadPackage } = await import('../../../utils/fileOperations.js');
    const pkg = await loadPackage('order-service');
    expect(pkg.entities.find(e => e.name === 'Order')).toBeDefined();
    expect(pkg.entities.find(e => e.name === 'OrderItem')).toBeDefined();

    // (b) Relationship uuid present in the package
    expect(pkg.relationships.map(r => r.uuid)).toEqual([newRel.uuid]);

    // (c) Exactly one relationships-written event, with the uuids list
    expect(spy.calls).toHaveLength(1);
    const evt = spy.calls[0];
    expect(evt.kind).toBe('relationships-written');
    if (evt.kind !== 'relationships-written') throw new Error('unreachable');
    expect(evt.packagePath).toBe('packages/order-service');
    expect(evt.uuids).toEqual([newRel.uuid]);
  });

  it('R2: malformed path (entity path passed) throws and fires no event', async () => {
    const spy = createSpy();
    projection.onInvalidate(spy.cb);

    await expect(
      projection.writeRelationships('packages/order-service/entities/Order', []),
    ).rejects.toThrow(/malformed path/);

    expect(spy.calls).toHaveLength(0);
  });

  it('R3: malformed path (missing packages/ prefix) throws and fires no event', async () => {
    const spy = createSpy();
    projection.onInvalidate(spy.cb);

    await expect(
      projection.writeRelationships('not-a-valid-path', []),
    ).rejects.toThrow(/malformed path/);

    expect(spy.calls).toHaveLength(0);
  });

  it('R4: empty list write removes existing relationships, still preserves entities', async () => {
    await projection.writeRelationships('packages/order-service', []);

    const { loadPackage } = await import('../../../utils/fileOperations.js');
    const pkg = await loadPackage('order-service');
    expect(pkg.relationships).toHaveLength(0);
    // Entities still present.
    expect(pkg.entities.find(e => e.name === 'Order')).toBeDefined();
    expect(pkg.entities.find(e => e.name === 'OrderItem')).toBeDefined();
  });
});
