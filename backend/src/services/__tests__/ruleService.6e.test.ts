/**
 * ruleService.6e.test.ts — #167 slice 6e.1
 *
 * Proves that ruleService.createRule routes each rule scope through the
 * correct projection method (AC4, AC5, AC6 + case-scope counterpart).
 *
 *   - entity → projection.writeEntity (fires `entity-written`)
 *   - package → projection.writePackageRules (fires one `rule-written` per rule)
 *   - case → projection.writeCase (fires `case-written`)
 *   - global → projection.writeGlobalRules (fires `rule-written` scope=global)
 *
 * Tests spy on the projection rather than fileOperations so the migration is
 * verified at the layer the spec mandates.
 */

import { AttributeType, type Case, type Entity } from '../../models/EntitySchema.js';
import type { Rule } from '../../models/Rule.js';
import { InMemoryStorageBackend } from '../../storage/memory/InMemoryStorageBackend.js';
import { wsId } from '../../storage/contract/types.js';
import {
  LogicalProjection,
  type InvalidationCallback,
  type ProjectionInvalidationEvent,
} from '../../storage/projection/LogicalProjection.js';
import { registerProjection, resetProjectionRegistry } from '../../storage/projection/ProjectionRegistry.js';
import { ruleService } from '../ruleService.js';

jest.mock('../../utils/logger', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

const DICT_WS = wsId('dictionaries');

async function setBackendDynamic(backend: InMemoryStorageBackend): Promise<void> {
  const { storageRegistry } = await import('../../storage/contract/StorageBackendToken.js');
  storageRegistry.setBackend(backend);
}

async function resetRegistryDynamic(): Promise<void> {
  const { storageRegistry } = await import('../../storage/contract/StorageBackendToken.js');
  storageRegistry.reset();
}

const ORDER_PACKAGE_YAML = `name: order-service\n`;

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
  backend.files.get(ws)!.set('order-service/package.yaml', ORDER_PACKAGE_YAML);
  return backend;
}

const ROOT_ENTITY: Entity = {
  uuid: '00000000-0000-4000-8000-00000000d001',
  name: 'Order',
  description: 'A root entity for rule tests',
  attributes: [
    {
      uuid: '00000000-0000-4000-8000-00000000d0a1',
      name: 'orderId',
      description: 'identifier',
      type: AttributeType.UUID,
      required: true,
    },
  ],
};

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
  registerProjection(DICT_WS, projection);
  // Seed an entity that entity- and case-scope rules can hang off.
  await projection.writeEntity('packages/order-service/entities/Order', ROOT_ENTITY);
});

afterEach(async () => {
  await resetRegistryDynamic();
  resetProjectionRegistry();
});

describe('RuleService — slice 6e.1 projection routing', () => {
  it('R-T1 (AC4): entity-scope rule creates fire entity-written (not rule-written)', async () => {
    const spy = createSpy();
    projection.onInvalidate(spy.cb);
    const writeEntitySpy = jest.spyOn(projection, 'writeEntity');
    const writePackageRulesSpy = jest.spyOn(projection, 'writePackageRules');
    const writeGlobalRulesSpy = jest.spyOn(projection, 'writeGlobalRules');
    const writeCaseSpy = jest.spyOn(projection, 'writeCase');

    const input: Partial<Rule> = {
      name: 'entity-rule',
      description: 'Entity-scope rule',
      severity: 'warning',
      enforcement: 'advisory',
      scope: 'entity',
      entityUuid: ROOT_ENTITY.uuid,
      packageName: 'order-service',
      targets: [
        { kind: 'entity', uuid: ROOT_ENTITY.uuid, packageName: 'order-service' },
      ],
    };

    const result = await ruleService.createRule(input);
    expect(result.success).toBe(true);

    // Routed via writeEntity.
    expect(writeEntitySpy).toHaveBeenCalledTimes(1);
    expect(writeEntitySpy.mock.calls[0][0]).toBe('packages/order-service/entities/Order');
    expect(writeEntitySpy.mock.calls[0][1].rules?.find(r => r.name === 'entity-rule')).toBeDefined();

    // Not routed via the other projection writers.
    expect(writePackageRulesSpy).not.toHaveBeenCalled();
    expect(writeGlobalRulesSpy).not.toHaveBeenCalled();
    expect(writeCaseSpy).not.toHaveBeenCalled();

    // Subscribers see entity-written, not rule-written.
    const kinds = spy.calls.map(e => e.kind);
    expect(kinds).toContain('entity-written');
    expect(kinds).not.toContain('rule-written');

    // Round-trip: rule visible on the entity.
    const reread = await projection.readEntity('packages/order-service/entities/Order');
    expect(reread?.rules?.find(r => r.name === 'entity-rule')).toBeDefined();
  });

  it('R-T2 (AC5): package-scope rule creates fire rule-written scope=package', async () => {
    const spy = createSpy();
    projection.onInvalidate(spy.cb);
    const writePackageRulesSpy = jest.spyOn(projection, 'writePackageRules');

    const input: Partial<Rule> = {
      name: 'package-rule',
      description: 'Package-scope rule',
      severity: 'warning',
      enforcement: 'advisory',
      scope: 'package',
      packageName: 'order-service',
      targets: [
        { kind: 'entity', uuid: ROOT_ENTITY.uuid, packageName: 'order-service' },
      ],
    };

    const result = await ruleService.createRule(input);
    expect(result.success).toBe(true);

    expect(writePackageRulesSpy).toHaveBeenCalledTimes(1);
    expect(writePackageRulesSpy.mock.calls[0][0]).toBe('packages/order-service');

    // Exactly one rule-written event with the right scope + anchorPath.
    const ruleEvents = spy.calls.filter(e => e.kind === 'rule-written');
    expect(ruleEvents).toHaveLength(1);
    const evt = ruleEvents[0];
    if (evt.kind !== 'rule-written') throw new Error('unreachable');
    expect(evt.scope).toBe('package');
    expect(evt.anchorLogicalPath).toBe('packages/order-service');
    expect(evt.ruleUuid).toBe(result.rule!.uuid);

    // Round-trip via the read helper.
    const { readPackageRules } = await import('../../utils/fileOperations.js');
    const rules = await readPackageRules('order-service');
    expect(rules.find(r => r.name === 'package-rule')).toBeDefined();
  });

  it('R-T3 (AC6): global-scope rule creates fire rule-written scope=global', async () => {
    const spy = createSpy();
    projection.onInvalidate(spy.cb);
    const writeGlobalRulesSpy = jest.spyOn(projection, 'writeGlobalRules');

    const input: Partial<Rule> = {
      name: 'global-rule',
      description: 'Global-scope rule',
      severity: 'info',
      enforcement: 'advisory',
      scope: 'global',
      // Spans 2 packages → resolveScope keeps it at global (auto-demote would
      // collapse to one package otherwise).
      targets: [
        { kind: 'entity', uuid: ROOT_ENTITY.uuid, packageName: 'order-service' },
        { kind: 'entity', uuid: '00000000-0000-4000-8000-00000000e002', packageName: 'other-service' },
      ],
    };

    const result = await ruleService.createRule(input);
    expect(result.success).toBe(true);

    expect(writeGlobalRulesSpy).toHaveBeenCalledTimes(1);

    const ruleEvents = spy.calls.filter(e => e.kind === 'rule-written');
    expect(ruleEvents).toHaveLength(1);
    const evt = ruleEvents[0];
    if (evt.kind !== 'rule-written') throw new Error('unreachable');
    expect(evt.scope).toBe('global');
    expect(evt.anchorLogicalPath).toBeUndefined();
    expect(evt.ruleUuid).toBe(result.rule!.uuid);

    const { readGlobalRules } = await import('../../utils/fileOperations.js');
    const rules = await readGlobalRules();
    expect(rules.find(r => r.name === 'global-rule')).toBeDefined();
  });

  it('R-T4 (case scope): case-scope rule creates route through projection.writeCase', async () => {
    // Seed a case so the case-scope rule can attach to it.
    const c: Case = {
      uuid: 'case-00000000-0000-4000-8000-000000000001',
      name: 'OrderFulfillment',
      description: 'Case-scope rule host',
      rootEntities: [ROOT_ENTITY.uuid],
      nodes: [],
      maxDepth: 5,
      metadata: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await projection.writeCase('packages/order-service/cases/OrderFulfillment', c);

    const writeCaseSpy = jest.spyOn(projection, 'writeCase');

    const input: Partial<Rule> = {
      name: 'case-rule',
      description: 'Case-scope rule',
      severity: 'warning',
      enforcement: 'advisory',
      scope: 'case',
      caseUuid: c.uuid,
      targets: [
        { kind: 'entity', uuid: ROOT_ENTITY.uuid, packageName: 'order-service' },
      ],
    };

    const result = await ruleService.createRule(input);
    expect(result.success).toBe(true);

    expect(writeCaseSpy).toHaveBeenCalledTimes(1);
    expect(writeCaseSpy.mock.calls[0][0]).toBe('packages/order-service/cases/OrderFulfillment');

    // The case now carries the rule.
    const updatedCase = await projection.readCase('packages/order-service/cases/OrderFulfillment');
    expect(updatedCase!.rules?.find(r => r.name === 'case-rule')).toBeDefined();
  });
});
