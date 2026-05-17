/**
 * LogicalProjection.multiKind.6e.test.ts — #167 slice 6e.1
 *
 * AC15: a single `.model.yaml` file carrying all four sections (entities,
 * relationships, rules, cases) survives independent writes to each kind.
 * Iterates over each new writer in turn and asserts the other three sections
 * are still readable afterwards.
 *
 * The eshop sample stores cases in `*.case.yaml` files, but multi-kind YAML
 * (#106) permits a single file to carry any subset. The fixture co-locates
 * everything in one file to make the preservation reflex strict.
 */

import type { Relationship, Case } from '../../../models/EntitySchema.js';
import { Cardinality } from '../../../models/EntitySchema.js';
import type { Rule } from '../../../models/Rule.js';
import { InMemoryStorageBackend } from '../../memory/InMemoryStorageBackend.js';
import { wsId } from '../../contract/types.js';
import { LogicalProjection } from '../LogicalProjection.js';

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

// All four sections in one file. The `cases:` key is the canonical form
// post-#121 (legacy `perspectives:` is read-only).
const ALL_KINDS_YAML = `
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
    description: "Order has items"
    source:
      entity: "00000000-0000-4000-8000-000000000001"
      cardinality: one
    target:
      entity: "00000000-0000-4000-8000-000000000002"
      cardinality: many
rules:
  - uuid: "rule-00000000-0000-4000-8000-000000000020"
    name: "TotalsMatch"
    description: "Order total = sum of line item prices"
    severity: warning
    enforcement: advisory
    scope: package
    targets: []
cases:
  - uuid: "case-00000000-0000-4000-8000-000000000030"
    name: "Ordering"
    description: "Ordering case"
    rootEntities:
      - "00000000-0000-4000-8000-000000000001"
    nodes: []
    maxDepth: 5
    metadata: []
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
  bucket.set('order-service/OrderAggregate.model.yaml', ALL_KINDS_YAML);
  return backend;
}

let backend: InMemoryStorageBackend;
let projection: LogicalProjection;

async function assertOtherSectionsIntact(skip: 'entities' | 'relationships' | 'rules' | 'cases') {
  const { loadPackage } = await import('../../../utils/fileOperations.js');
  const pkg = await loadPackage('order-service');
  if (skip !== 'entities') {
    expect(pkg.entities.find(e => e.name === 'Order')).toBeDefined();
    expect(pkg.entities.find(e => e.name === 'OrderItem')).toBeDefined();
  }
  if (skip !== 'relationships') {
    expect(pkg.relationships.find(r => r.uuid === 'rel-00000000-0000-4000-8000-000000000010')).toBeDefined();
  }
  if (skip !== 'rules') {
    expect(pkg.rules.find(r => r.uuid === 'rule-00000000-0000-4000-8000-000000000020')).toBeDefined();
  }
  if (skip !== 'cases') {
    expect(pkg.cases.find(c => c.uuid === 'case-00000000-0000-4000-8000-000000000030')).toBeDefined();
  }
}

beforeEach(async () => {
  backend = createSeededBackend();
  await setBackendDynamic(backend);
  projection = new LogicalProjection(backend, DICT_WS);
});

afterEach(async () => {
  await resetRegistryDynamic();
});

describe('LogicalProjection multi-kind preservation (AC15) — slice 6e.1', () => {
  it('MK1: writeRelationships preserves entities + rules + cases', async () => {
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
    await assertOtherSectionsIntact('relationships');
    // The new relationship landed.
    const { loadPackage } = await import('../../../utils/fileOperations.js');
    const pkg = await loadPackage('order-service');
    expect(pkg.relationships.map(r => r.uuid)).toEqual([newRel.uuid]);
  });

  it('MK2: writePackageRules preserves entities + relationships + cases', async () => {
    const newRule: Rule = {
      uuid: 'rule-00000000-0000-4000-8000-000000000099',
      name: 'NewRule',
      description: 'replaces existing',
      severity: 'info',
      enforcement: 'advisory',
      scope: 'package',
      targets: [],
    };
    await projection.writePackageRules('packages/order-service', [newRule]);
    await assertOtherSectionsIntact('rules');
    const { loadPackage } = await import('../../../utils/fileOperations.js');
    const pkg = await loadPackage('order-service');
    expect(pkg.rules.map(r => r.uuid)).toEqual([newRule.uuid]);
  });

  it('MK3: writeCase preserves entities + relationships + rules', async () => {
    const newCase: Case = {
      uuid: 'case-00000000-0000-4000-8000-000000000099',
      name: 'NewCase',
      description: 'a brand new case',
      rootEntities: ['00000000-0000-4000-8000-000000000001'],
      nodes: [],
      maxDepth: 5,
      metadata: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await projection.writeCase('packages/order-service/cases/NewCase', newCase);
    await assertOtherSectionsIntact('cases');
    // Both cases survive: pre-existing + new
    const { loadPackage } = await import('../../../utils/fileOperations.js');
    const pkg = await loadPackage('order-service');
    const uuids = pkg.cases.map(c => c.uuid).sort();
    expect(uuids).toContain('case-00000000-0000-4000-8000-000000000030');
    expect(uuids).toContain(newCase.uuid);
  });

  it('MK4: deleteCase preserves entities + relationships + rules', async () => {
    const ok = await projection.deleteCase('packages/order-service/cases/Ordering');
    expect(ok).toBe(true);
    await assertOtherSectionsIntact('cases');
    const { loadPackage } = await import('../../../utils/fileOperations.js');
    const pkg = await loadPackage('order-service');
    expect(pkg.cases.find(c => c.uuid === 'case-00000000-0000-4000-8000-000000000030')).toBeUndefined();
  });
});
