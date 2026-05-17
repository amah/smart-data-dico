/**
 * UuidIndex.test.ts — #167 slice 6c acceptance criteria (T1–T13)
 *
 * Tests the in-process uuid → logical-path registry: rebuild, subscription
 * maintenance, rename robustness (§4.6), and the module-level registry helpers.
 *
 * Fixture strategy: **Option A** (copy-paste fixtures inline from
 * LogicalProjection.test.ts). Rationale: slice 6b just landed; a diff to its
 * test file is unexpected noise. ~80 LOC of duplicated fixture/helper is
 * acceptable for one duplication; if a third consumer (slice 6e) needs the
 * fixtures, that's the right moment to extract.
 *
 * Setup mirrors LogicalProjection.test.ts: seeds an InMemoryStorageBackend,
 * registers it via dynamic-import of storageRegistry, constructs a fresh
 * `LogicalProjection` and `UuidIndex` per test in `beforeEach`. No
 * `jest.resetModules()` (per calibration hazard #3 / spec §7.3).
 */

import { AttributeType, type Entity } from '../../../models/EntitySchema.js';
import { InMemoryStorageBackend } from '../../memory/InMemoryStorageBackend.js';
import { wsId } from '../../contract/types.js';
import {
  LogicalProjection,
  type InvalidationCallback,
  type LogicalPath,
  type ProjectionInvalidationEvent,
} from '../LogicalProjection.js';
import {
  UuidIndex,
  registerUuidIndex,
  getUuidIndex,
  resetUuidIndexRegistry,
} from '../UuidIndex.js';

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
// Dynamic-import helpers (match slice-5/6a pattern)
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
// Fixture YAML content (Option A — copy-pasted from LogicalProjection.test.ts)
// ─────────────────────────────────────────────────────────────────────────────

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

const ORDER_SERVICE_PACKAGE_YAML = `
name: order-service
`.trimStart();

const SUB_BILLING_PACKAGE_YAML = `
name: order-service/sub-billing
`.trimStart();

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

const BLANK_PACKAGE_YAML = `
name: blank-service
`.trimStart();

// ─────────────────────────────────────────────────────────────────────────────
// Helper: create a pre-seeded InMemoryStorageBackend with all fixtures
// ─────────────────────────────────────────────────────────────────────────────

function createSeededBackend(): InMemoryStorageBackend {
  const backend = new InMemoryStorageBackend();
  const ws = String(DICT_WS);

  if (!backend.files.has(ws)) {
    backend.files.set(ws, new Map());
  }
  const bucket = backend.files.get(ws)!;

  // Register the workspace root directory so `statOrNull(pathOf(''))` inside
  // `fileOperations.listPackages()` succeeds. The InMemoryStorageBackend's
  // `stat('')` only treats the root as existing if it is in `dirs` OR if some
  // key starts with `'/'` (canonical paths never do). Without this, the
  // listPackages() early-return at fileOperations.ts:192 yields `[]` and
  // `UuidIndex.rebuild()` indexes nothing. (`mkdir(pathOf(''))` is a no-op:
  // see InMemoryStorageBackend.ts:132-135 — `if (c)` skips empty paths.)
  let rootDirs = backend.dirs.get(ws);
  if (!rootDirs) {
    rootDirs = new Set<string>();
    backend.dirs.set(ws, rootDirs);
  }
  rootDirs.add('');

  // order-service package
  bucket.set('order-service/package.yaml', ORDER_SERVICE_PACKAGE_YAML);
  bucket.set('order-service/Order.model.yaml', ORDER_YAML);
  bucket.set('order-service/OrderAggregate.model.yaml', ORDER_AGGREGATE_YAML);

  // order-service/sub-billing subpackage
  bucket.set('order-service/sub-billing/package.yaml', SUB_BILLING_PACKAGE_YAML);
  bucket.set('order-service/sub-billing/Invoice.model.yaml', INVOICE_YAML);

  // blank-service package (write-then-delete; T5 et al.)
  bucket.set('blank-service/package.yaml', BLANK_PACKAGE_YAML);

  return backend;
}

// ─────────────────────────────────────────────────────────────────────────────
// Spy helper — plain array-based subscriber (matches LogicalProjection.test.ts)
// ─────────────────────────────────────────────────────────────────────────────

function createSpy(): { calls: ProjectionInvalidationEvent[]; cb: InvalidationCallback } {
  const calls: ProjectionInvalidationEvent[] = [];
  return { calls, cb: (e: ProjectionInvalidationEvent) => { calls.push(e); } };
}

// ─────────────────────────────────────────────────────────────────────────────
// Setup / teardown
// ─────────────────────────────────────────────────────────────────────────────

let backend: InMemoryStorageBackend;
let projection: LogicalProjection;
let uuidIndex: UuidIndex;

beforeEach(async () => {
  backend = createSeededBackend();
  await setBackendDynamic(backend);
  projection = new LogicalProjection(backend, DICT_WS);
  uuidIndex = new UuidIndex(projection, DICT_WS, backend);
});

afterEach(async () => {
  await resetRegistryDynamic();
  resetUuidIndexRegistry();
});

// ─────────────────────────────────────────────────────────────────────────────
// T1 — rebuild() populates the index from the seeded backend (incl. subpackage)
// ─────────────────────────────────────────────────────────────────────────────

describe('T1: rebuild populates index across top-level packages AND subpackages', () => {
  it('finds Order, OrderItem, and Invoice (subpackage recursion proven)', async () => {
    await uuidIndex.rebuild();

    expect(uuidIndex.findPathByUuid('00000000-0000-4000-8000-000000000001'))
      .toBe('packages/order-service/entities/Order');
    expect(uuidIndex.findPathByUuid('00000000-0000-4000-8000-000000000002'))
      .toBe('packages/order-service/entities/OrderItem');
    // AC#14 — subpackage recursion proven by this assertion specifically
    expect(uuidIndex.findPathByUuid('00000000-0000-4000-8000-000000000003'))
      .toBe('packages/order-service/sub-billing/entities/Invoice');

    expect(uuidIndex.size()).toBe(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T2 — findPathByUuid returns null for unknown uuid
// ─────────────────────────────────────────────────────────────────────────────

describe('T2: findPathByUuid returns null for unknown uuid', () => {
  it('returns null after rebuild for a uuid that does not exist', async () => {
    await uuidIndex.rebuild();
    expect(uuidIndex.findPathByUuid('00000000-0000-4000-8000-deadbeefcafe')).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T3 — findPathByUuid returns null on empty index (before rebuild)
// ─────────────────────────────────────────────────────────────────────────────

describe('T3: findPathByUuid returns null on empty index (no rebuild)', () => {
  it('fresh index has size 0 and returns null for any lookup', () => {
    expect(uuidIndex.size()).toBe(0);
    expect(uuidIndex.findPathByUuid('00000000-0000-4000-8000-000000000001')).toBeNull();
    expect(uuidIndex.findPathByUuid('anything-at-all')).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T4 — getUuidAtPath round-trips with findPathByUuid
// ─────────────────────────────────────────────────────────────────────────────

describe('T4: getUuidAtPath and findPathByUuid are inverses', () => {
  it('round-trips Order', async () => {
    await uuidIndex.rebuild();

    const orderPath: LogicalPath = 'packages/order-service/entities/Order';
    const orderUuid = '00000000-0000-4000-8000-000000000001';

    expect(uuidIndex.getUuidAtPath(orderPath)).toBe(orderUuid);
    expect(uuidIndex.findPathByUuid(orderUuid)).toBe(orderPath);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T5 — Subscription on entity-written: NEW entity in blank-service
// ─────────────────────────────────────────────────────────────────────────────

describe('T5: subscription updates index on entity-written (new entity)', () => {
  it('writing Foo into blank-service grows the index by 1', async () => {
    await uuidIndex.rebuild();
    uuidIndex.start();

    const fresh: Entity = {
      uuid: '00000000-0000-4000-8000-000000000050',
      name: 'Foo',
      attributes: [],
    };
    await projection.writeEntity('packages/blank-service/entities/Foo', fresh);

    expect(uuidIndex.findPathByUuid('00000000-0000-4000-8000-000000000050'))
      .toBe('packages/blank-service/entities/Foo');
    expect(uuidIndex.size()).toBe(4);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T6 — Subscription on entity-written: UPDATE existing entity, path unchanged
// ─────────────────────────────────────────────────────────────────────────────

describe('T6: subscription updates index on entity-written (update existing)', () => {
  it('updating Order leaves uuid→path mapping unchanged and size === 3', async () => {
    await uuidIndex.rebuild();
    uuidIndex.start();

    const original = await projection.readEntity('packages/order-service/entities/Order');
    expect(original).not.toBeNull();

    const updated: Entity = { ...(original as Entity), description: 'updated description' };
    await projection.writeEntity('packages/order-service/entities/Order', updated);

    expect(uuidIndex.findPathByUuid('00000000-0000-4000-8000-000000000001'))
      .toBe('packages/order-service/entities/Order');
    expect(uuidIndex.size()).toBe(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T7 — Subscription on entity-deleted drops BOTH entries
// ─────────────────────────────────────────────────────────────────────────────

describe('T7: subscription drops both uuid→path and path→uuid on entity-deleted', () => {
  it('deleting Order shrinks the index by 1 and clears both maps for it', async () => {
    await uuidIndex.rebuild();
    uuidIndex.start();

    const deleted = await projection.deleteEntity('packages/order-service/entities/Order');
    expect(deleted).toBe(true);

    expect(uuidIndex.findPathByUuid('00000000-0000-4000-8000-000000000001')).toBeNull();
    expect(uuidIndex.getUuidAtPath('packages/order-service/entities/Order')).toBeNull();
    expect(uuidIndex.size()).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T8 — Subscription on entity-deleted no-ops for unknown path
// ─────────────────────────────────────────────────────────────────────────────

describe('T8: deletion of unknown path leaves index untouched', () => {
  it('deleteEntity returns false; size unchanged; known uuid still resolves', async () => {
    await uuidIndex.rebuild();
    uuidIndex.start();

    const sizeBefore = uuidIndex.size();

    const deleted = await projection.deleteEntity(
      'packages/order-service/entities/NonexistentEntity',
    );
    expect(deleted).toBe(false);

    expect(uuidIndex.size()).toBe(sizeBefore);
    expect(uuidIndex.findPathByUuid('00000000-0000-4000-8000-000000000001'))
      .toBe('packages/order-service/entities/Order');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T9 — Rename via delete-then-write (correct ordering)
// ─────────────────────────────────────────────────────────────────────────────

describe('T9: rename via delete-then-write — index reflects new path', () => {
  it('delete Order at old path, then write under new name "RenamedOrder"', async () => {
    await uuidIndex.rebuild();
    uuidIndex.start();

    const oldPath: LogicalPath = 'packages/order-service/entities/Order';
    const newPath: LogicalPath = 'packages/order-service/entities/RenamedOrder';
    const orderUuid = '00000000-0000-4000-8000-000000000001';

    // Step 1: delete at old path. Both maps clear the uuid/path pair.
    const deleted = await projection.deleteEntity(oldPath);
    expect(deleted).toBe(true);

    // Step 2: write the new entity at the new path with the SAME uuid.
    const renamed: Entity = {
      uuid: orderUuid,
      name: 'RenamedOrder',
      attributes: [
        {
          name: 'orderId',
          uuid: '00000000-0000-4000-8000-0000000000a1',
          description: 'Order identifier',
          type: AttributeType.UUID,
          required: true,
        },
      ],
    };
    await projection.writeEntity(newPath, renamed);

    expect(uuidIndex.findPathByUuid(orderUuid)).toBe(newPath);
    expect(uuidIndex.getUuidAtPath(oldPath)).toBeNull();
    expect(uuidIndex.getUuidAtPath(newPath)).toBe(orderUuid);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T10 — Rename via write-then-delete (defends against the §4.6 bug)
// ─────────────────────────────────────────────────────────────────────────────

describe('T10: rename via write-then-delete — §4.6 guard preserves new mapping', () => {
  it('write at new path FIRST, then delete at old path; uuid still resolves to new path', async () => {
    await uuidIndex.rebuild();
    uuidIndex.start();

    // Use distinct packages for the rename. This is necessary because
    // `writeEntityFile` (called by `projection.writeEntity`) deduplicates by
    // uuid OR name *within the target package* — writing RenamedOrder under
    // Order's uuid into order-service would REPLACE Order in place, after
    // which the subsequent `deleteEntity('packages/order-service/entities/Order')`
    // finds nothing and returns false (no event fires). Cross-package, the
    // write lands in blank-service while order-service still contains Order,
    // so the delete genuinely fires the `entity-deleted` event we need to
    // exercise the §4.6 guard. (Conceptually this is a "rename across
    // packages"; the index logic under test is identical.)
    const oldPath: LogicalPath = 'packages/order-service/entities/Order';
    const newPath: LogicalPath = 'packages/blank-service/entities/RenamedOrder';
    const orderUuid = '00000000-0000-4000-8000-000000000001';

    // Step 1: write the new entity at the new path FIRST (under same uuid).
    // Event fires: entity-written, newPath, uuid=orderUuid.
    //   After handleEvent: uuidToPath[orderUuid] = newPath (overwriting oldPath);
    //   pathToUuid[newPath] = orderUuid; pathToUuid[oldPath] = orderUuid (STALE).
    const renamed: Entity = {
      uuid: orderUuid,
      name: 'RenamedOrder',
      attributes: [
        {
          name: 'orderId',
          uuid: '00000000-0000-4000-8000-0000000000a1',
          description: 'Order identifier',
          type: AttributeType.UUID,
          required: true,
        },
      ],
    };
    await projection.writeEntity(newPath, renamed);

    // Step 2: delete at the old path. The §4.6 guard (`if uuidToPath.get(uuid)
    // === event.logicalPath`) prevents the handler from wiping uuidToPath[uuid]
    // — which now points at newPath, not oldPath. Without the guard,
    // findPathByUuid(orderUuid) would return null after this step.
    const deleted = await projection.deleteEntity(oldPath);
    expect(deleted).toBe(true);

    // CRITICAL: must NOT be null. This is the §4.6 bug-defense assertion.
    expect(uuidIndex.findPathByUuid(orderUuid)).toBe(newPath);
    expect(uuidIndex.getUuidAtPath(oldPath)).toBeNull();
    expect(uuidIndex.getUuidAtPath(newPath)).toBe(orderUuid);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T11 — Multi-subscriber coexistence: index does not interfere with a spy
// ─────────────────────────────────────────────────────────────────────────────

describe('T11: index coexists with another subscriber on the same projection', () => {
  it('both the index AND a spy receive the entity-written event', async () => {
    await uuidIndex.rebuild();
    // Index registered first
    uuidIndex.start();

    // Spy registered second on the SAME projection
    const spy = createSpy();
    projection.onInvalidate(spy.cb);

    const fresh: Entity = {
      uuid: '00000000-0000-4000-8000-000000000051',
      name: 'Bar',
      attributes: [],
    };
    await projection.writeEntity('packages/blank-service/entities/Bar', fresh);

    // Spy fired exactly once with the expected payload
    expect(spy.calls).toHaveLength(1);
    expect(spy.calls[0]).toEqual({
      kind: 'entity-written',
      logicalPath: 'packages/blank-service/entities/Bar',
      uuid: '00000000-0000-4000-8000-000000000051',
    });

    // Index updated as well
    expect(uuidIndex.findPathByUuid('00000000-0000-4000-8000-000000000051'))
      .toBe('packages/blank-service/entities/Bar');
    expect(uuidIndex.size()).toBe(4);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T12 — start() returns Unsubscribe that stops index maintenance
// ─────────────────────────────────────────────────────────────────────────────

describe('T12: unsubscribe stops the index from maintaining itself', () => {
  it('after unsubscribe, a subsequent write does NOT update the index', async () => {
    await uuidIndex.rebuild();
    const unsub = uuidIndex.start();
    const sizeBefore = uuidIndex.size();

    unsub();

    const fresh: Entity = {
      uuid: '00000000-0000-4000-8000-000000000052',
      name: 'Baz',
      attributes: [],
    };
    await projection.writeEntity('packages/blank-service/entities/Baz', fresh);

    expect(uuidIndex.findPathByUuid('00000000-0000-4000-8000-000000000052')).toBeNull();
    expect(uuidIndex.size()).toBe(sizeBefore);
    expect(uuidIndex.size()).toBe(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T13 — Registry helpers: register / get / reset semantics
// ─────────────────────────────────────────────────────────────────────────────

describe('T13: registry helpers — registerUuidIndex / getUuidIndex / resetUuidIndexRegistry', () => {
  it('getUuidIndex throws before register, returns the same instance after, throws after reset', () => {
    // Ensure clean registry state (afterEach also clears, but be defensive
    // in case T13 runs before any other test that called registerUuidIndex).
    resetUuidIndexRegistry();

    // BEFORE register: throws
    expect(() => getUuidIndex(DICT_WS)).toThrow(/not registered/);

    // AFTER register: returns the exact instance
    registerUuidIndex(DICT_WS, uuidIndex);
    expect(getUuidIndex(DICT_WS)).toBe(uuidIndex);

    // AFTER reset: throws again
    resetUuidIndexRegistry();
    expect(() => getUuidIndex(DICT_WS)).toThrow(/not registered/);
  });
});
