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

import { InMemoryStorageBackend } from '../../memory/InMemoryStorageBackend.js';
import { wsId } from '../../contract/types.js';
import { LogicalProjection } from '../LogicalProjection.js';

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
        type: string
        required: true
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
