/**
 * LogicalProjection.test.ts — #167 slice 6a acceptance criteria
 *
 * Tests the read-only projection layer: readEntity() and listEntitiesInPackage().
 *
 * Backend setup: seeds an InMemoryStorageBackend directly via backend.files,
 * then registers it via dynamic-import of storageRegistry so the loadPackage
 * path inside fileOperations.ts resolves it. Dynamic-import is required because
 * loadPackage calls storageRegistry.getBackend() lazily — any top-level import
 * of storageRegistry would become a stale singleton after jest.resetModules().
 *
 * [verified — see stereotypeService.165b.test.ts dynamic-import pattern]
 */

import type { Entity } from '../../../models/EntitySchema.js';
import { InMemoryStorageBackend } from '../../memory/InMemoryStorageBackend.js';
import { wsId } from '../../contract/types.js';
import {
  LogicalProjection,
  type InvalidationCallback,
  type ProjectionInvalidationEvent,
} from '../LogicalProjection.js';

// Suppress logger noise from fileOperations.ts
jest.mock('../../../utils/logger', () => ({
  logger: {
    warn: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  },
}));

// ─────────────────────────────────────────────────────────────────────────────
// Workspace constant (same as fileOperations.ts uses)
// ─────────────────────────────────────────────────────────────────────────────

const DICT_WS = wsId('dictionaries');

// ─────────────────────────────────────────────────────────────────────────────
// Dynamic-import helpers (match slice-5 pattern from stereotypeService.165b.test.ts)
// ─────────────────────────────────────────────────────────────────────────────

async function setBackendDynamic(backend: InMemoryStorageBackend): Promise<void> {
  const { storageRegistry } = await import('../../contract/StorageBackendToken.js');
  storageRegistry.setBackend(backend);
}

async function resetRegistryDynamic(): Promise<void> {
  const { storageRegistry } = await import('../../contract/StorageBackendToken.js');
  storageRegistry.reset();
}

// ─────────────────────────────────────────────────────────────────────────────
// Fixture YAML content (inlined — do NOT depend on disk eshop samples)
// ─────────────────────────────────────────────────────────────────────────────

/** Fixture 1: single-entity file — order-service/Order.model.yaml */
const ORDER_YAML = `
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

/**
 * Fixture 2: multi-kind file — order-service/OrderAggregate.model.yaml
 * Contains entities, relationships, AND rules to exercise multi-kind preservation.
 */
const ORDER_AGGREGATE_YAML = `
entities:
  - name: OrderItem
    uuid: "00000000-0000-4000-8000-000000000002"
    description: "A line item in an order"
    attributes:
      - name: quantity
        uuid: "00000000-0000-4000-8000-0000000000a2"
        description: "Quantity ordered"
        type: integer
        required: true
relationships:
  - uuid: "rel-00000000-0000-4000-8000-000000000001"
    source: "00000000-0000-4000-8000-000000000001"
    target: "00000000-0000-4000-8000-000000000002"
    cardinality:
      source: one
      target: many
rules:
  - uuid: "rule-00000000-0000-4000-8000-000000000001"
    name: "Order total must match"
    description: "Order total = sum of line item prices"
    expression: "order.total == sum(order.items[].price)"
`.trimStart();

/** Fixture 3: package marker for order-service */
const ORDER_SERVICE_PACKAGE_YAML = `
name: order-service
`.trimStart();

/** Fixture 4: subpackage marker for order-service/sub-billing */
const SUB_BILLING_PACKAGE_YAML = `
name: order-service/sub-billing
`.trimStart();

/** Fixture 5: Invoice entity in subpackage */
const INVOICE_YAML = `
entities:
  - name: Invoice
    uuid: "00000000-0000-4000-8000-000000000003"
    description: "A billing invoice"
    attributes:
      - name: invoiceNumber
        uuid: "00000000-0000-4000-8000-0000000000a3"
        description: "Invoice number"
        type: string
        required: true
`.trimStart();

/** Fixture 6: empty package marker for write-then-delete tests (T20) */
const BLANK_PACKAGE_YAML = `
name: blank-service
`.trimStart();

// ─────────────────────────────────────────────────────────────────────────────
// Helper: create a pre-seeded InMemoryStorageBackend with all fixtures
// ─────────────────────────────────────────────────────────────────────────────

function createSeededBackend(): InMemoryStorageBackend {
  const backend = new InMemoryStorageBackend();
  const ws = String(DICT_WS);

  // Ensure workspace bucket exists
  if (!backend.files.has(ws)) {
    backend.files.set(ws, new Map());
  }
  const bucket = backend.files.get(ws)!;

  // order-service package
  bucket.set('order-service/package.yaml', ORDER_SERVICE_PACKAGE_YAML);
  bucket.set('order-service/Order.model.yaml', ORDER_YAML);
  bucket.set('order-service/OrderAggregate.model.yaml', ORDER_AGGREGATE_YAML);

  // order-service/sub-billing subpackage
  bucket.set('order-service/sub-billing/package.yaml', SUB_BILLING_PACKAGE_YAML);
  bucket.set('order-service/sub-billing/Invoice.model.yaml', INVOICE_YAML);

  // blank-service package (write-then-delete; T20)
  bucket.set('blank-service/package.yaml', BLANK_PACKAGE_YAML);

  return backend;
}

// ─────────────────────────────────────────────────────────────────────────────
// Setup / teardown
// ─────────────────────────────────────────────────────────────────────────────

let backend: InMemoryStorageBackend;
let projection: LogicalProjection;

beforeEach(async () => {
  backend = createSeededBackend();
  await setBackendDynamic(backend);
  // Constructor takes (backend, ws) — stored for slice 6b/6c forward-compat
  projection = new LogicalProjection(backend, DICT_WS);
});

afterEach(async () => {
  await resetRegistryDynamic();
});

// ─────────────────────────────────────────────────────────────────────────────
// T1 — readEntity: single-entity file, found by name
// ─────────────────────────────────────────────────────────────────────────────

describe('T1: readEntity finds entity in single-entity file', () => {
  it('resolves Order from order-service', async () => {
    const entity = await projection.readEntity('packages/order-service/entities/Order');
    expect(entity).not.toBeNull();
    expect(entity!.name).toBe('Order');
    expect(entity!.uuid).toBe('00000000-0000-4000-8000-000000000001');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T2 — readEntity: entity in multi-kind file, filename-independent lookup
// ─────────────────────────────────────────────────────────────────────────────

describe('T2: readEntity finds entity in multi-kind file (filename-independent)', () => {
  it('resolves OrderItem from OrderAggregate.model.yaml', async () => {
    const entity = await projection.readEntity('packages/order-service/entities/OrderItem');
    expect(entity).not.toBeNull();
    expect(entity!.name).toBe('OrderItem');
    expect(entity!.uuid).toBe('00000000-0000-4000-8000-000000000002');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T3 — readEntity: entity does not exist in package
// ─────────────────────────────────────────────────────────────────────────────

describe('T3: readEntity returns null for missing entity name', () => {
  it('returns null for DoesNotExist', async () => {
    const entity = await projection.readEntity('packages/order-service/entities/DoesNotExist');
    expect(entity).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T4 — readEntity: package directory does not exist — null, no throw
// ─────────────────────────────────────────────────────────────────────────────

describe('T4: readEntity returns null when package directory is missing', () => {
  it('returns null for missing package, does not throw', async () => {
    const entity = await projection.readEntity('packages/nope/entities/Anything');
    expect(entity).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T5 — readEntity: subpackage entity lookup
// ─────────────────────────────────────────────────────────────────────────────

describe('T5: readEntity resolves entity in subpackage', () => {
  it('resolves Invoice from order-service/sub-billing', async () => {
    const entity = await projection.readEntity('packages/order-service/sub-billing/entities/Invoice');
    expect(entity).not.toBeNull();
    expect(entity!.name).toBe('Invoice');
    expect(entity!.uuid).toBe('00000000-0000-4000-8000-000000000003');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T6 — readEntity: malformed path — missing `packages/` prefix
// ─────────────────────────────────────────────────────────────────────────────

describe('T6: readEntity returns null for path missing packages/ prefix', () => {
  it('returns null for "entities/Order"', async () => {
    const entity = await projection.readEntity('entities/Order');
    expect(entity).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T7 — readEntity: malformed path — no entity name (path ends at `entities`)
// ─────────────────────────────────────────────────────────────────────────────

describe('T7: readEntity returns null for path with no entity name segment', () => {
  it('returns null for "packages/order-service/entities"', async () => {
    const entity = await projection.readEntity('packages/order-service/entities');
    expect(entity).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T8 — readEntity: malformed path — space in entity name
// ─────────────────────────────────────────────────────────────────────────────

describe('T8: readEntity returns null for entity name with space', () => {
  it('returns null for "packages/order-service/entities/Bad Name"', async () => {
    const entity = await projection.readEntity('packages/order-service/entities/Bad Name');
    expect(entity).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T9 — listEntitiesInPackage: top-level package, non-recursive
// ─────────────────────────────────────────────────────────────────────────────

describe('T9: listEntitiesInPackage returns top-level entities only (non-recursive)', () => {
  it('returns Order and OrderItem but NOT Invoice', async () => {
    const refs = await projection.listEntitiesInPackage('packages/order-service');
    const names = refs.map(r => r.name);

    expect(names).toContain('Order');
    expect(names).toContain('OrderItem');
    expect(names).not.toContain('Invoice');
  });

  it('each ref has the correct logicalPath shape', async () => {
    const refs = await projection.listEntitiesInPackage('packages/order-service');
    for (const ref of refs) {
      expect(ref.logicalPath).toMatch(/^packages\/order-service\/entities\//);
      expect(ref.logicalPath).toBe(`packages/order-service/entities/${ref.name}`);
      expect(ref.uuid).toBeTruthy();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T10 — listEntitiesInPackage: subpackage
// ─────────────────────────────────────────────────────────────────────────────

describe('T10: listEntitiesInPackage returns exactly Invoice for sub-billing', () => {
  it('returns exactly one ref for Invoice', async () => {
    const refs = await projection.listEntitiesInPackage('packages/order-service/sub-billing');
    expect(refs).toHaveLength(1);
    expect(refs[0].name).toBe('Invoice');
    expect(refs[0].uuid).toBe('00000000-0000-4000-8000-000000000003');
    expect(refs[0].logicalPath).toBe('packages/order-service/sub-billing/entities/Invoice');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T11 — listEntitiesInPackage: package directory does not exist
// ─────────────────────────────────────────────────────────────────────────────

describe('T11: listEntitiesInPackage returns [] for missing package', () => {
  it('returns empty array for packages/missing', async () => {
    const refs = await projection.listEntitiesInPackage('packages/missing');
    expect(refs).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T12 — listEntitiesInPackage: entity path passed (has `entities` segment)
// ─────────────────────────────────────────────────────────────────────────────

describe('T12: listEntitiesInPackage returns [] for entity path (not a package path)', () => {
  it('returns empty array when path contains entities segment', async () => {
    const refs = await projection.listEntitiesInPackage('packages/order-service/entities/Order');
    expect(refs).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T13 — multi-kind preservation: readEntity does not mutate underlying data
// ─────────────────────────────────────────────────────────────────────────────

describe('T13: multi-kind preservation — readEntity is read-only, does not mutate', () => {
  it('after readEntity(OrderItem), loadPackage still has relationships and rules', async () => {
    // Read the entity via projection
    const entity = await projection.readEntity('packages/order-service/entities/OrderItem');
    expect(entity).not.toBeNull();
    expect(entity!.name).toBe('OrderItem');

    // Re-load the package directly and verify multi-kind sections are intact
    const { loadPackage } = await import('../../../utils/fileOperations.js');
    const pkg = await loadPackage('order-service');

    // Relationships must still be present (#106 multi-kind preservation)
    expect(pkg.relationships.length).toBeGreaterThan(0);
    // Rules must still be present (#106 multi-kind preservation, #85 trinity)
    expect(pkg.rules.length).toBeGreaterThan(0);

    // Verify the specific relationship from the fixture
    const rel = pkg.relationships.find(r => r.uuid === 'rel-00000000-0000-4000-8000-000000000001');
    expect(rel).toBeDefined();

    // Verify the specific rule from the fixture
    const rule = pkg.rules.find(r => r.uuid === 'rule-00000000-0000-4000-8000-000000000001');
    expect(rule).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Slice 6b tests (T14–T25) — writeEntity / deleteEntity / onInvalidate
//
// Spy helper: a plain array-based spy matches the existing test file's style
// (no jest.fn(); the projection only needs to verify call counts and payloads).
// ─────────────────────────────────────────────────────────────────────────────

function createSpy(): { calls: ProjectionInvalidationEvent[]; cb: InvalidationCallback } {
  const calls: ProjectionInvalidationEvent[] = [];
  return { calls, cb: (e: ProjectionInvalidationEvent) => { calls.push(e); } };
}

// ─────────────────────────────────────────────────────────────────────────────
// T14 — writeEntity happy path: update existing entity, read back the change
// ─────────────────────────────────────────────────────────────────────────────

describe('T14: writeEntity updates an existing entity in a single-entity file', () => {
  it('round-trips Order with new description; uuid preserved; return is void', async () => {
    const original = await projection.readEntity('packages/order-service/entities/Order');
    expect(original).not.toBeNull();

    const updated: Entity = { ...(original as Entity), description: 'updated' };
    const result = await projection.writeEntity(
      'packages/order-service/entities/Order',
      updated,
    );
    expect(result).toBeUndefined();

    const reread = await projection.readEntity('packages/order-service/entities/Order');
    expect(reread).not.toBeNull();
    expect(reread!.description).toBe('updated');
    expect(reread!.uuid).toBe('00000000-0000-4000-8000-000000000001');
    expect(reread!.name).toBe('Order');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T15 — writeEntity into existing multi-kind file preserves relationships+rules
// (cornerstone reflex from slice 5 carried through the projection layer)
// ─────────────────────────────────────────────────────────────────────────────

describe('T15: writeEntity preserves co-located relationships and rules (multi-kind)', () => {
  it('updating OrderItem keeps relationships and rules sections intact', async () => {
    // Fixture sanity: OrderAggregate.model.yaml co-locates entities + relationships + rules
    const orderItem = await projection.readEntity('packages/order-service/entities/OrderItem');
    expect(orderItem).not.toBeNull();

    const updated: Entity = { ...(orderItem as Entity), description: 'updated line item' };
    await projection.writeEntity(
      'packages/order-service/entities/OrderItem',
      updated,
    );

    // Re-load the package directly and verify multi-kind sections are intact
    const { loadPackage } = await import('../../../utils/fileOperations.js');
    const pkg = await loadPackage('order-service');

    // Entity update landed
    const reread = pkg.entities.find(e => e.name === 'OrderItem');
    expect(reread).toBeDefined();
    expect(reread!.description).toBe('updated line item');

    // Relationships preserved — specific uuid still present
    expect(pkg.relationships.length).toBeGreaterThan(0);
    const rel = pkg.relationships.find(r => r.uuid === 'rel-00000000-0000-4000-8000-000000000001');
    expect(rel).toBeDefined();

    // Rules preserved — specific uuid still present
    expect(pkg.rules.length).toBeGreaterThan(0);
    const rule = pkg.rules.find(r => r.uuid === 'rule-00000000-0000-4000-8000-000000000001');
    expect(rule).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T16 — writeEntity content↔path mismatch throws; no event fires
// ─────────────────────────────────────────────────────────────────────────────

describe('T16: writeEntity throws on path/content mismatch and does not fire event', () => {
  it('mismatched entity.name vs parsed path throws with diagnostic message', async () => {
    const spy = createSpy();
    projection.onInvalidate(spy.cb);

    const mismatched: Entity = {
      uuid: '00000000-0000-4000-8000-000000000099',
      name: 'Foo',
      attributes: [],
    };

    await expect(
      projection.writeEntity('packages/order-service/entities/Bar', mismatched),
    ).rejects.toThrow(/path\/content mismatch/);

    // Re-throw to capture the full message and assert each documented piece
    let caught: Error | null = null;
    try {
      await projection.writeEntity('packages/order-service/entities/Bar', mismatched);
    } catch (e) {
      caught = e as Error;
    }
    expect(caught).not.toBeNull();
    expect(caught!.message).toContain('path/content mismatch');
    expect(caught!.message).toContain('Bar');
    expect(caught!.message).toContain('Foo');

    expect(spy.calls).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T17 — writeEntity malformed path throws; no event fires
// ─────────────────────────────────────────────────────────────────────────────

describe('T17: writeEntity throws on malformed path and does not fire event', () => {
  it('throws with the documented prefix for "not-a-valid-path"', async () => {
    const spy = createSpy();
    projection.onInvalidate(spy.cb);

    const entity: Entity = {
      uuid: '00000000-0000-4000-8000-000000000099',
      name: 'Whatever',
      attributes: [],
    };

    await expect(
      projection.writeEntity('not-a-valid-path', entity),
    ).rejects.toThrow(/LogicalProjection\.writeEntity: malformed path/);

    expect(spy.calls).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T18 — writeEntity fires invalidation event with uuid
// ─────────────────────────────────────────────────────────────────────────────

describe('T18: writeEntity fires entity-written event with uuid', () => {
  it('spy receives one event with kind, logicalPath, and uuid === entity.uuid', async () => {
    const spy = createSpy();
    projection.onInvalidate(spy.cb);

    const original = await projection.readEntity('packages/order-service/entities/Order');
    expect(original).not.toBeNull();

    const updated: Entity = { ...(original as Entity), description: 'event-fire test' };
    await projection.writeEntity('packages/order-service/entities/Order', updated);

    expect(spy.calls).toHaveLength(1);
    expect(spy.calls[0]).toEqual({
      kind: 'entity-written',
      logicalPath: 'packages/order-service/entities/Order',
      uuid: original!.uuid,
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T19 — writeEntity failure (invalid entity) throws; no event fires
// ─────────────────────────────────────────────────────────────────────────────

describe('T19: writeEntity throws when writeEntityFile returns false; no event fires', () => {
  it('invalid entity (bad uuid format) triggers outer throw with documented message', async () => {
    const spy = createSpy();
    projection.onInvalidate(spy.cb);

    // Path/content guard passes (name 'BadOne' matches), but validateEntity
    // inside writeEntityFile rejects the entity (uuid 'broken' fails isValidUUID),
    // so writeEntityFile returns false → projection throws.
    const invalidEntity = { name: 'BadOne', uuid: 'broken' } as unknown as Entity;

    await expect(
      projection.writeEntity('packages/order-service/entities/BadOne', invalidEntity),
    ).rejects.toThrow(/writeEntityFile failed/);

    expect(spy.calls).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T20 — write-then-delete in a blank package, then read returns null
// ─────────────────────────────────────────────────────────────────────────────

describe('T20: deleteEntity happy path — write then delete then read returns null', () => {
  it('round-trips a fresh entity in blank-service', async () => {
    const fresh: Entity = {
      uuid: '00000000-0000-4000-8000-000000000050',
      name: 'Foo',
      attributes: [],
    };

    await projection.writeEntity('packages/blank-service/entities/Foo', fresh);
    const written = await projection.readEntity('packages/blank-service/entities/Foo');
    expect(written).not.toBeNull();
    expect(written!.name).toBe('Foo');

    const deleted = await projection.deleteEntity('packages/blank-service/entities/Foo');
    expect(deleted).toBe(true);

    const afterDelete = await projection.readEntity('packages/blank-service/entities/Foo');
    expect(afterDelete).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T21 — deleteEntity returns false for missing entity; no event fires
// ─────────────────────────────────────────────────────────────────────────────

describe('T21: deleteEntity returns false for missing entity and does not fire event', () => {
  it('returns false and spy has zero calls', async () => {
    const spy = createSpy();
    projection.onInvalidate(spy.cb);

    const deleted = await projection.deleteEntity(
      'packages/order-service/entities/NonexistentEntity',
    );
    expect(deleted).toBe(false);
    expect(spy.calls).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T22 — deleteEntity malformed path throws
// ─────────────────────────────────────────────────────────────────────────────

describe('T22: deleteEntity throws on malformed path', () => {
  it('throws with the documented prefix for "malformed"', async () => {
    await expect(
      projection.deleteEntity('malformed'),
    ).rejects.toThrow(/LogicalProjection\.deleteEntity: malformed path/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T23 — deleteEntity fires invalidation event with uuid === undefined
// ─────────────────────────────────────────────────────────────────────────────

describe('T23: deleteEntity fires entity-deleted event without uuid', () => {
  it('spy receives one event; uuid is undefined (Design Decision 4.4)', async () => {
    const spy = createSpy();
    projection.onInvalidate(spy.cb);

    const deleted = await projection.deleteEntity('packages/order-service/entities/Order');
    expect(deleted).toBe(true);

    expect(spy.calls).toHaveLength(1);
    const evt = spy.calls[0];
    expect(evt.kind).toBe('entity-deleted');
    if (evt.kind !== 'entity-deleted') throw new Error('unreachable');
    expect(evt.logicalPath).toBe('packages/order-service/entities/Order');
    expect(evt.uuid).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T24 — onInvalidate unsubscribe stops further events
// ─────────────────────────────────────────────────────────────────────────────

describe('T24: onInvalidate unsubscribe removes the subscriber', () => {
  it('after unsubscribe, a subsequent write does not call the spy', async () => {
    const spy = createSpy();
    const unsubscribe = projection.onInvalidate(spy.cb);
    unsubscribe();

    const original = await projection.readEntity('packages/order-service/entities/Order');
    expect(original).not.toBeNull();
    const updated: Entity = { ...(original as Entity), description: 'unsubscribed' };
    await projection.writeEntity('packages/order-service/entities/Order', updated);

    expect(spy.calls).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T25 — multiple subscribers both receive the same event, in registration order
// ─────────────────────────────────────────────────────────────────────────────

describe('T25: multiple subscribers each receive the event payload', () => {
  it('A and B both called exactly once with identical event payload', async () => {
    const spyA = createSpy();
    const spyB = createSpy();
    projection.onInvalidate(spyA.cb);
    projection.onInvalidate(spyB.cb);

    const original = await projection.readEntity('packages/order-service/entities/Order');
    expect(original).not.toBeNull();
    const updated: Entity = { ...(original as Entity), description: 'fan-out test' };
    await projection.writeEntity('packages/order-service/entities/Order', updated);

    expect(spyA.calls).toHaveLength(1);
    expect(spyB.calls).toHaveLength(1);

    const expected: ProjectionInvalidationEvent = {
      kind: 'entity-written',
      logicalPath: 'packages/order-service/entities/Order',
      uuid: original!.uuid,
    };
    expect(spyA.calls[0]).toEqual(expected);
    expect(spyB.calls[0]).toEqual(expected);
  });
});
