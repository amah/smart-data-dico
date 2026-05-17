/**
 * LogicalProjection.rules.test.ts — #167 slice 6e.1
 *
 * Covers the projection-side helpers for package- and global-scope rule
 * writes. Entity-scope and case-scope rule round-trips are covered by
 * `ruleService.6e.test.ts` (which exercises the full saveRuleToScope path).
 *
 * AC5 (package-scope), AC6 (global-scope), AC15 (multi-kind preservation).
 */

import type { Rule } from '../../../models/Rule.js';
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

// Multi-kind file: entities present so we can verify they survive a rules write.
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
  bucket.set('order-service/Order.model.yaml', ORDER_AGGREGATE_YAML);
  return backend;
}

function createSpy(): { calls: ProjectionInvalidationEvent[]; cb: InvalidationCallback } {
  const calls: ProjectionInvalidationEvent[] = [];
  return { calls, cb: (e: ProjectionInvalidationEvent) => { calls.push(e); } };
}

function makeRule(uuid: string, name: string): Rule {
  return {
    uuid,
    name,
    description: 'A test rule',
    severity: 'warning',
    enforcement: 'advisory',
    scope: 'package',
    targets: [],
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

describe('LogicalProjection.writePackageRules — slice 6e.1', () => {
  it('PR1 (AC5+AC15): writes rules, preserves entities, fires one rule-written event per rule', async () => {
    const spy = createSpy();
    projection.onInvalidate(spy.cb);

    const ruleA = makeRule('rule-00000000-0000-4000-8000-000000000001', 'A');
    const ruleB = makeRule('rule-00000000-0000-4000-8000-000000000002', 'B');

    await projection.writePackageRules('packages/order-service', [ruleA, ruleB]);

    // Multi-kind preservation
    const { loadPackage } = await import('../../../utils/fileOperations.js');
    const pkg = await loadPackage('order-service');
    expect(pkg.entities.find(e => e.name === 'Order')).toBeDefined();

    // Rules written
    expect(pkg.rules.map(r => r.uuid).sort()).toEqual([ruleA.uuid, ruleB.uuid].sort());

    // One event per rule, scope = package, anchor path set
    expect(spy.calls).toHaveLength(2);
    for (const evt of spy.calls) {
      expect(evt.kind).toBe('rule-written');
      if (evt.kind !== 'rule-written') throw new Error('unreachable');
      expect(evt.scope).toBe('package');
      expect(evt.anchorLogicalPath).toBe('packages/order-service');
    }
    const emittedUuids = spy.calls
      .map(e => (e.kind === 'rule-written' ? e.ruleUuid : ''))
      .sort();
    expect(emittedUuids).toEqual([ruleA.uuid, ruleB.uuid].sort());
  });

  it('PR2: malformed path throws and fires no event', async () => {
    const spy = createSpy();
    projection.onInvalidate(spy.cb);

    await expect(
      projection.writePackageRules('not-a-valid-path', []),
    ).rejects.toThrow(/malformed path/);

    expect(spy.calls).toHaveLength(0);
  });

  it('PR3: empty list write removes existing rules but preserves entities', async () => {
    // First populate
    const rule = makeRule('rule-00000000-0000-4000-8000-000000000005', 'X');
    await projection.writePackageRules('packages/order-service', [rule]);

    // Now clear
    await projection.writePackageRules('packages/order-service', []);

    const { loadPackage } = await import('../../../utils/fileOperations.js');
    const pkg = await loadPackage('order-service');
    expect(pkg.rules).toHaveLength(0);
    expect(pkg.entities.find(e => e.name === 'Order')).toBeDefined();
  });
});

describe('LogicalProjection.writeGlobalRules — slice 6e.1', () => {
  it('GR1 (AC6): writes global rules and fires one rule-written event per rule with scope=global', async () => {
    const spy = createSpy();
    projection.onInvalidate(spy.cb);

    const rule: Rule = {
      uuid: 'rule-global-00000000-0000-4000-8000-000000000001',
      name: 'cross-package',
      description: 'spans multiple packages',
      severity: 'info',
      enforcement: 'advisory',
      scope: 'global',
      targets: [],
    };

    await projection.writeGlobalRules([rule]);

    // Round-trip read via the underlying helper.
    const { readGlobalRules } = await import('../../../utils/fileOperations.js');
    const stored = await readGlobalRules();
    expect(stored.map(r => r.uuid)).toEqual([rule.uuid]);

    // Event payload check
    expect(spy.calls).toHaveLength(1);
    const evt = spy.calls[0];
    expect(evt.kind).toBe('rule-written');
    if (evt.kind !== 'rule-written') throw new Error('unreachable');
    expect(evt.scope).toBe('global');
    expect(evt.ruleUuid).toBe(rule.uuid);
    expect(evt.anchorLogicalPath).toBeUndefined();
  });

  it('GR2: empty list write deletes the rules.yaml without firing any event', async () => {
    const spy = createSpy();
    projection.onInvalidate(spy.cb);

    await projection.writeGlobalRules([]);
    expect(spy.calls).toHaveLength(0);

    const { readGlobalRules } = await import('../../../utils/fileOperations.js');
    expect(await readGlobalRules()).toEqual([]);
  });
});
