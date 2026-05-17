/**
 * logicalFsRouter.test.ts — #167 slice 6d acceptance criteria (LR-T1..LR-T18)
 *
 * Supertest-based integration tests for the new `/fs/logical/*` Express
 * router. The test app does NOT import `server.ts`; supertest mounts the
 * router directly at `/` so route URLs are `/<workspace>/<verb>/...`
 * (mirroring how `server.ts` mounts it at `/fs/logical` in prod).
 *
 * Setup per spec §8.2:
 *   - Seed an InMemoryStorageBackend via `createSeededBackend()` (copy-paste
 *     from `UuidIndex.test.ts` — Option A per spec §8.3 and §11.7).
 *   - Register the backend in the storageRegistry via dynamic-import helper.
 *   - Construct ONE real `LogicalProjection` + register it via
 *     `registerProjection(dictWs, projection)`.
 *   - Construct ONE real `UuidIndex` against the SAME projection, `rebuild()`,
 *     `start()`, register via `registerUuidIndex(dictWs, uuidIndex)`.
 *   - Stand up a fresh `express()` app, mount `express.json()` BEFORE
 *     `createLogicalFsRouter()` (calibration hazard #4).
 *
 * `afterEach` resets ALL THREE registries (storage, projection, uuid index)
 * to keep tests independent.
 *
 * Fixture strategy: **Option A** (copy-paste) per spec §8.3. The slice-6c
 * `UuidIndex.test.ts` chose Option A; slice 6d follows that precedent. The
 * third copy of the fixture is the right moment to extract to `_fixtures.ts`
 * — but that refactor would touch both 6c's and 6b's test files, which
 * exceeds slice 6d's diff-guard posture (AC#7). Stated in dev-notes.
 */

import express, { type Express } from 'express';
import request from 'supertest';
import YAML from 'yaml';

import { AttributeType, type Entity } from '../../models/EntitySchema.js';
import { InMemoryStorageBackend } from '../../storage/memory/InMemoryStorageBackend.js';
import { wsId } from '../../storage/contract/types.js';
import { LogicalProjection } from '../../storage/projection/LogicalProjection.js';
import {
  registerProjection,
  resetProjectionRegistry,
} from '../../storage/projection/ProjectionRegistry.js';
import {
  UuidIndex,
  registerUuidIndex,
  resetUuidIndexRegistry,
} from '../../storage/projection/UuidIndex.js';
import { createLogicalFsRouter } from '../logicalFsRouter.js';

// Suppress logger noise from fileOperations.ts
jest.mock('../../utils/logger', () => ({
  logger: {
    warn: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  },
}));

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const DICT_WS = wsId('dictionaries');

// uuids from the seeded fixture (mirror UuidIndex.test.ts)
const ORDER_UUID      = '00000000-0000-4000-8000-000000000001';
const ORDER_ITEM_UUID = '00000000-0000-4000-8000-000000000002';
const INVOICE_UUID    = '00000000-0000-4000-8000-000000000003';

// ─────────────────────────────────────────────────────────────────────────────
// Dynamic-import helpers (match slice-5/6a/6c pattern; calibration hazard #2)
// ─────────────────────────────────────────────────────────────────────────────

async function setBackendDynamic(backend: InMemoryStorageBackend): Promise<void> {
  const { storageRegistry } = await import('../../storage/contract/StorageBackendToken.js');
  storageRegistry.setBackend(backend);
}

async function resetRegistryDynamic(): Promise<void> {
  const { storageRegistry } = await import('../../storage/contract/StorageBackendToken.js');
  storageRegistry.reset();
}

// ─────────────────────────────────────────────────────────────────────────────
// Fixture YAML content — Option A (copy-pasted from UuidIndex.test.ts)
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
// Seeded in-memory backend (copy-paste from UuidIndex.test.ts:136-172)
// ─────────────────────────────────────────────────────────────────────────────

function createSeededBackend(): InMemoryStorageBackend {
  const backend = new InMemoryStorageBackend();
  const ws = String(DICT_WS);

  if (!backend.files.has(ws)) {
    backend.files.set(ws, new Map());
  }
  const bucket = backend.files.get(ws)!;

  // Register the workspace root directory so `statOrNull(pathOf(''))` inside
  // `fileOperations.listPackages()` succeeds. (See `createSeededBackend` in
  // UuidIndex.test.ts for the full explanation — without this the
  // listPackages() early-return at fileOperations.ts:192 yields `[]` and the
  // tests that hit /files/* would all observe an empty listing.)
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

  // blank-service package (write target for T8/T9/T14)
  bucket.set('blank-service/package.yaml', BLANK_PACKAGE_YAML);

  return backend;
}

// ─────────────────────────────────────────────────────────────────────────────
// Express app builder — fresh app per beforeEach
// ─────────────────────────────────────────────────────────────────────────────

function buildApp(): Express {
  const app = express();
  // Calibration hazard #4: json body parser MUST be mounted BEFORE the router,
  // otherwise PUT/POST handlers see `req.body === undefined` and the
  // body-shape validation in writeHandler produces a misleading 400.
  app.use(express.json());
  app.use('/', createLogicalFsRouter());
  return app;
}

// ─────────────────────────────────────────────────────────────────────────────
// Setup / teardown
// ─────────────────────────────────────────────────────────────────────────────

let backend: InMemoryStorageBackend;
let projection: LogicalProjection;
let uuidIndex: UuidIndex;
let app: Express;

beforeEach(async () => {
  backend = createSeededBackend();
  await setBackendDynamic(backend);

  projection = new LogicalProjection(backend, DICT_WS);
  // Register the projection FIRST, then construct the index against the SAME
  // instance (closes slice-6c Risk §11.6 — the route handlers' projection IS
  // the index's projection). This is the same ordering as `server.ts:93-100`.
  registerProjection(DICT_WS, projection);

  uuidIndex = new UuidIndex(projection, DICT_WS, backend);
  await uuidIndex.rebuild();
  uuidIndex.start();
  registerUuidIndex(DICT_WS, uuidIndex);

  app = buildApp();
});

afterEach(async () => {
  await resetRegistryDynamic();
  resetProjectionRegistry();
  resetUuidIndexRegistry();
});

// ─────────────────────────────────────────────────────────────────────────────
// LR-T1 — GET read existing entity
// ─────────────────────────────────────────────────────────────────────────────

describe('LR-T1: GET /:ws/read/<entity-path> returns 200 + serialized entity', () => {
  it('reads Order from the seeded backend and round-trips YAML content', async () => {
    const res = await request(app)
      .get('/dictionaries/read/packages/order-service/entities/Order');

    expect(res.status).toBe(200);
    expect(res.body.path).toBe('packages/order-service/entities/Order');
    expect(res.body.isDirectory).toBe(false);
    expect(typeof res.body.content).toBe('string');

    const parsed = YAML.parse(res.body.content) as Entity;
    expect(parsed.name).toBe('Order');
    expect(parsed.uuid).toBe(ORDER_UUID);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// LR-T2 — GET read missing entity returns 404 with documented error message
// ─────────────────────────────────────────────────────────────────────────────

describe('LR-T2: GET /:ws/read/<missing-entity> returns 404 with documented error', () => {
  it('returns 404 and the literal "Entity not found at logical path" prefix', async () => {
    const res = await request(app)
      .get('/dictionaries/read/packages/order-service/entities/Nonexistent');

    expect(res.status).toBe(404);
    expect(res.body.error).toContain('Entity not found at logical path');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// LR-T3 — GET read against missing package returns 404
// ─────────────────────────────────────────────────────────────────────────────

describe('LR-T3: GET /:ws/read/<entity-in-missing-pkg> returns 404', () => {
  it('LogicalProjection.readEntity returns null → 404 + documented error', async () => {
    const res = await request(app)
      .get('/dictionaries/read/packages/no-such-package/entities/Foo');

    expect(res.status).toBe(404);
    expect(res.body.error).toContain('Entity not found at logical path');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// LR-T4 — GET read with malformed logical path returns 404 (parser → null)
// ─────────────────────────────────────────────────────────────────────────────

describe('LR-T4: GET /:ws/read/<malformed-path> returns 404', () => {
  it('parseEntityPath returns null → readEntity returns null → 404', async () => {
    const res = await request(app)
      .get('/dictionaries/read/malformed/path/here');

    expect(res.status).toBe(404);
    expect(res.body.error).toContain('Entity not found at logical path');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// LR-T5 — GET files (list) on a top-level package
// ─────────────────────────────────────────────────────────────────────────────

describe('LR-T5: GET /:ws/files/<package> lists entities directly in the package', () => {
  it('returns Order and OrderItem; does NOT include Invoice (subpackage, non-recursive)', async () => {
    const res = await request(app)
      .get('/dictionaries/files/order-service');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);

    const names = (res.body as Array<{ name: string }>).map(e => e.name).sort();
    expect(names).toEqual(['Order', 'OrderItem']);

    // Each entry has the documented shape.
    for (const entry of res.body as Array<{ name: string; path: string; uuid: string; isDirectory: boolean }>) {
      expect(typeof entry.name).toBe('string');
      expect(typeof entry.path).toBe('string');
      expect(typeof entry.uuid).toBe('string');
      expect(entry.isDirectory).toBe(false);
    }

    // Invoice (in sub-billing) MUST NOT appear in the non-recursive listing.
    const uuids = (res.body as Array<{ uuid: string }>).map(e => e.uuid);
    expect(uuids).not.toContain(INVOICE_UUID);
    expect(uuids).toContain(ORDER_UUID);
    expect(uuids).toContain(ORDER_ITEM_UUID);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// LR-T6 — GET files on a subpackage path
// ─────────────────────────────────────────────────────────────────────────────

describe('LR-T6: GET /:ws/files/<pkg>/<subpkg> lists entities in the subpackage', () => {
  it('order-service/sub-billing returns Invoice with its uuid', async () => {
    const res = await request(app)
      .get('/dictionaries/files/order-service/sub-billing');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);

    const entries = res.body as Array<{ name: string; path: string; uuid: string; isDirectory: false }>;
    const invoice = entries.find(e => e.name === 'Invoice');
    expect(invoice).toBeDefined();
    expect(invoice!.uuid).toBe(INVOICE_UUID);
    expect(invoice!.path).toBe('packages/order-service/sub-billing/entities/Invoice');
    expect(invoice!.isDirectory).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// LR-T7 — GET files on missing package returns empty array (not 404)
// ─────────────────────────────────────────────────────────────────────────────

describe('LR-T7: GET /:ws/files/<missing-pkg> returns 200 with empty array', () => {
  it('LogicalProjection.listEntitiesInPackage returns [] for missing package', async () => {
    const res = await request(app)
      .get('/dictionaries/files/no-such-package');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// LR-T8 — PUT a valid new entity into blank-service
// ─────────────────────────────────────────────────────────────────────────────

// Foo uuid used by T8/T9. Owning the uuid in the test (Option A from spec
// guidance) lets us query the by-uuid route in T9 without having to call
// `uuidIndex.getUuidAtPath` ourselves.
const FOO_UUID = '00000000-0000-4000-8000-000000000040';

function buildFooEntity(): Entity {
  return {
    uuid: FOO_UUID,
    name: 'Foo',
    attributes: [
      {
        name: 'fooId',
        uuid: '00000000-0000-4000-8000-0000000000f1',
        description: 'Foo identifier',
        type: AttributeType.UUID,
        required: true,
      },
    ],
  };
}

describe('LR-T8: PUT /:ws/put/<entity-path> writes a new entity (200 + read-back works)', () => {
  it('writes Foo, returns 200 + envelope; subsequent GET read returns same uuid', async () => {
    const foo = buildFooEntity();
    const yamlBody = YAML.stringify(foo);

    const putRes = await request(app)
      .put('/dictionaries/put/packages/blank-service/entities/Foo')
      .send({ content: yamlBody });

    expect(putRes.status).toBe(200);
    expect(putRes.body.path).toBe('packages/blank-service/entities/Foo');
    expect(putRes.body.isDirectory).toBe(false);
    expect(typeof putRes.body.content).toBe('string');

    // Read it back through the route.
    const readRes = await request(app)
      .get('/dictionaries/read/packages/blank-service/entities/Foo');

    expect(readRes.status).toBe(200);
    const parsed = YAML.parse(readRes.body.content) as Entity;
    expect(parsed.name).toBe('Foo');
    expect(parsed.uuid).toBe(FOO_UUID);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// LR-T9 — PUT fires invalidation → the index registered at boot updates
//          (proves the route handler's projection IS the same instance the
//          index subscribed to; closes slice-6c Risk §11.6 for projection
//          writes — AC#16)
// ─────────────────────────────────────────────────────────────────────────────

describe('LR-T9: same-instance proof — PUT updates the boot-registered UuidIndex', () => {
  it('after PUT, GET /:ws/by-uuid/<Foo-uuid> returns the new logical path', async () => {
    const foo = buildFooEntity();
    const yamlBody = YAML.stringify(foo);

    const putRes = await request(app)
      .put('/dictionaries/put/packages/blank-service/entities/Foo')
      .send({ content: yamlBody });
    expect(putRes.status).toBe(200);

    const byUuidRes = await request(app)
      .get(`/dictionaries/by-uuid/${FOO_UUID}`);

    expect(byUuidRes.status).toBe(200);
    expect(byUuidRes.body.logicalPath).toBe('packages/blank-service/entities/Foo');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// LR-T10 — PUT with body that is not valid YAML → 400 + "YAML parse failed"
// ─────────────────────────────────────────────────────────────────────────────

describe('LR-T10: PUT with malformed YAML body returns 400', () => {
  it('returns 400 with error message starting with "YAML parse failed:"', async () => {
    const res = await request(app)
      .put('/dictionaries/put/packages/blank-service/entities/Foo')
      .send({ content: 'not yaml: : : ::' });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('YAML parse failed');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// LR-T11 — PUT with entity whose name disagrees with the path → 400
//          ("path/content mismatch" — LogicalProjection.writeEntity throws this)
// ─────────────────────────────────────────────────────────────────────────────

describe('LR-T11: PUT with entity name that disagrees with the path returns 400', () => {
  it('returns 400 with documented "path/content mismatch" message', async () => {
    const other: Entity = {
      uuid: '00000000-0000-4000-8000-0000000000c0',
      name: 'Other',
      attributes: [],
    };
    const res = await request(app)
      .put('/dictionaries/put/packages/blank-service/entities/Mismatch')
      .send({ content: YAML.stringify(other) });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('path/content mismatch');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// LR-T12 — PUT against a malformed logical path → 400 ("malformed path")
// ─────────────────────────────────────────────────────────────────────────────

describe('LR-T12: PUT against a malformed logical path returns 400', () => {
  it('LogicalProjection.writeEntity throws "malformed path" → mapped to 400', async () => {
    // Body is well-formed YAML so we exercise the path-validation branch in
    // writeEntity, not the body-validation branch in the route handler.
    const dummy: Entity = {
      uuid: '00000000-0000-4000-8000-0000000000d0',
      name: 'Whatever',
      attributes: [],
    };
    const res = await request(app)
      .put('/dictionaries/put/malformed/path')
      .send({ content: YAML.stringify(dummy) });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('malformed path');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// LR-T13 — PUT with body missing `content` field → 400 + documented message
// ─────────────────────────────────────────────────────────────────────────────

describe('LR-T13: PUT with body missing `content` returns 400', () => {
  it('returns 400 with the literal "Body must be { content" prefix', async () => {
    const res = await request(app)
      .put('/dictionaries/put/packages/blank-service/entities/Foo')
      .send({ wrongField: 'whatever' });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Body must be { content');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// LR-T14 — POST behaves as an alias of PUT (same writeHandler)
// ─────────────────────────────────────────────────────────────────────────────

describe('LR-T14: POST /:ws/post/<entity-path> is an alias of PUT', () => {
  it('POST Bar into blank-service writes and is readable via the read route', async () => {
    const bar: Entity = {
      uuid: '00000000-0000-4000-8000-000000000041',
      name: 'Bar',
      attributes: [
        {
          name: 'barId',
          uuid: '00000000-0000-4000-8000-0000000000f2',
          description: 'Bar identifier',
          type: AttributeType.UUID,
          required: true,
        },
      ],
    };
    const yamlBody = YAML.stringify(bar);

    const postRes = await request(app)
      .post('/dictionaries/post/packages/blank-service/entities/Bar')
      .send({ content: yamlBody });

    expect(postRes.status).toBe(200);
    expect(postRes.body.path).toBe('packages/blank-service/entities/Bar');
    expect(postRes.body.isDirectory).toBe(false);

    const readRes = await request(app)
      .get('/dictionaries/read/packages/blank-service/entities/Bar');

    expect(readRes.status).toBe(200);
    const parsed = YAML.parse(readRes.body.content) as Entity;
    expect(parsed.name).toBe('Bar');
    expect(parsed.uuid).toBe('00000000-0000-4000-8000-000000000041');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// LR-T15 — DELETE an existing entity returns 200 + { deleted: true }
// ─────────────────────────────────────────────────────────────────────────────

describe('LR-T15: DELETE /:ws/delete/<existing-entity> returns 200 deleted:true', () => {
  it('returns the canonical { path, deleted: true } envelope', async () => {
    const res = await request(app)
      .delete('/dictionaries/delete/packages/order-service/entities/Order');

    expect(res.status).toBe(200);
    expect(res.body.path).toBe('packages/order-service/entities/Order');
    expect(res.body.deleted).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// LR-T16 — DELETE fires invalidation → boot-registered UuidIndex drops the
//          entry (AC#17 — same-instance assertion via delete path)
// ─────────────────────────────────────────────────────────────────────────────

describe('LR-T16: same-instance proof — DELETE removes the entry from the boot UuidIndex', () => {
  it('after DELETE, GET /:ws/by-uuid/<Order-uuid> returns 404', async () => {
    const delRes = await request(app)
      .delete('/dictionaries/delete/packages/order-service/entities/Order');
    expect(delRes.status).toBe(200);
    expect(delRes.body.deleted).toBe(true);

    const byUuidRes = await request(app)
      .get(`/dictionaries/by-uuid/${ORDER_UUID}`);

    expect(byUuidRes.status).toBe(404);
    expect(byUuidRes.body.error).toContain(ORDER_UUID);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// LR-T17 — DELETE of non-existent entity returns 200 + { deleted: false }
//          (LogicalProjection.deleteEntity returns false; no event fires)
// ─────────────────────────────────────────────────────────────────────────────

describe('LR-T17: DELETE of non-existent entity returns 200 deleted:false', () => {
  it('returns { path, deleted: false } — no event fires, index unchanged', async () => {
    const res = await request(app)
      .delete('/dictionaries/delete/packages/order-service/entities/Nonexistent');

    expect(res.status).toBe(200);
    expect(res.body.path).toBe('packages/order-service/entities/Nonexistent');
    expect(res.body.deleted).toBe(false);

    // Other entities still resolve via the by-uuid route — sanity check.
    const orderRes = await request(app)
      .get(`/dictionaries/by-uuid/${ORDER_UUID}`);
    expect(orderRes.status).toBe(200);
    expect(orderRes.body.logicalPath).toBe('packages/order-service/entities/Order');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// LR-T18 — GET by-uuid against the boot-rebuilt index resolves a known uuid
//          (AC#18 — independent of any write/delete activity)
// ─────────────────────────────────────────────────────────────────────────────

describe('LR-T18: GET /:ws/by-uuid/<known-uuid> resolves against the boot-rebuilt index', () => {
  it('Order uuid → packages/order-service/entities/Order', async () => {
    const res = await request(app)
      .get(`/dictionaries/by-uuid/${ORDER_UUID}`);

    expect(res.status).toBe(200);
    expect(res.body.logicalPath).toBe('packages/order-service/entities/Order');
  });
});
