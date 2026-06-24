/**
 * Tests for the rule service (#74) — covers the three storage scopes:
 * entity-sidecar, package, and case. Mocks the file operations layer
 * so tests don't touch the real filesystem.
 *
 * Slice 6e.1 (#167): rule writes now route through `LogicalProjection`
 * rather than calling the `write*Rules` helpers directly. This file's
 * assertions are kept against the legacy mock API (asserting that
 * `writeEntityRules` / `writePackageRules` / `writeCaseRules` /
 * `writeGlobalRules` were called with the expected arguments) by
 * registering a projection whose `writePackageRules` / `writeGlobalRules`
 * / `writeEntity` / `writeCase` methods route THROUGH the same legacy
 * mocks (instead of through the real `fileOperations` writers). The
 * new contract — projection-routed writes + invalidation events — is
 * verified in `ruleService.6e.test.ts`.
 */
import { ruleService } from '../ruleService.js';
import { Rule } from '../../models/Rule.js';
import { wsId } from '../../storage/contract/types.js';
import { registerProjection, resetProjectionRegistry } from '../../storage/projection/ProjectionRegistry.js';

// Provide an explicit factory mock so our new rule helpers exist (the
// __mocks__/fileOperations.ts manual mock predates them).
jest.mock('../../utils/fileOperations', () => ({
  readEntityRules: jest.fn(),
  writeEntityRules: jest.fn(),
  readPackageRules: jest.fn(),
  writePackageRules: jest.fn(),
  readCaseRules: jest.fn(),
  writeCaseRules: jest.fn(),
  readGlobalRules: jest.fn(),
  writeGlobalRules: jest.fn(),
  readCaseFile: jest.fn(),
  writeCaseFile: jest.fn(),
  deleteCaseFile: jest.fn(),
  loadPackage: jest.fn(),
  listAllEntityRuleFiles: jest.fn(),
  listPackagesWithRules: jest.fn(),
  listCases: jest.fn(),
  listPackages: jest.fn(),
}));
jest.mock('../../utils/logger');
jest.mock('../../utils/uuid', () => ({
  generateUUID: jest.fn().mockReturnValue('rule-fixed-uuid-1234'),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const fileOps = require('../../utils/fileOperations');
const mocked = fileOps as {
  readEntityRules: jest.Mock;
  writeEntityRules: jest.Mock;
  readPackageRules: jest.Mock;
  writePackageRules: jest.Mock;
  readCaseRules: jest.Mock;
  writeCaseRules: jest.Mock;
  readGlobalRules: jest.Mock;
  writeGlobalRules: jest.Mock;
  readCaseFile: jest.Mock;
  writeCaseFile: jest.Mock;
  deleteCaseFile: jest.Mock;
  loadPackage: jest.Mock;
  listAllEntityRuleFiles: jest.Mock;
  listPackagesWithRules: jest.Mock;
  listCases: jest.Mock;
  listPackages: jest.Mock;
};

const DICT_WS = wsId('dictionaries');

/**
 * Stand-in projection that satisfies the slice-6e.1 contract by routing
 * each projection method back to the legacy `fileOperations` mocks the
 * tests below already configure. Keeps the existing mock-based assertions
 * intact while ruleService internally calls `projection.write*`.
 */
function buildFakeProjection() {
  return {
    writeEntity: jest.fn(async (logicalPath: string, entity: { name: string; rules?: Rule[] }) => {
      // Parse `packages/<svc>/entities/<Name>` to get the service.
      const segs = String(logicalPath).split('/').filter(Boolean);
      const entitiesIdx = segs.lastIndexOf('entities');
      const service = segs.slice(1, entitiesIdx).join('/');
      const entityUuid = (entity as unknown as { uuid: string }).uuid;
      await mocked.writeEntityRules(service, entityUuid, entity.rules || []);
    }),
    writePackageRules: jest.fn(async (packagePath: string, rules: Rule[]) => {
      const packageName = String(packagePath).replace(/^packages\//, '');
      await mocked.writePackageRules(packageName, rules);
    }),
    writeGlobalRules: jest.fn(async (rules: Rule[]) => {
      await mocked.writeGlobalRules(rules);
    }),
    writeCase: jest.fn(async (logicalPath: string, c: { uuid: string; rules?: unknown[] }) => {
      // Mirror writeCaseRules signature: (caseUuid, rules[])
      await mocked.writeCaseRules(c.uuid, (c.rules as Rule[]) || []);
    }),
    deleteCase: jest.fn(async () => true),
    readCase: jest.fn(async () => null),
    readEntity: jest.fn(async () => null),
    listEntitiesInPackage: jest.fn(async () => []),
    deleteEntity: jest.fn(async () => false),
    onInvalidate: jest.fn(() => () => undefined),
  };
}

const buildRule = (overrides: Partial<Rule> = {}): Rule => ({
  uuid: 'rule-1',
  name: 'email-format',
  description: 'Email must match RFC 5322',
  severity: 'error',
  enforcement: 'advisory',
  scope: 'entity',
  entityUuid: 'ent-1',
  packageName: 'user-service',
  targets: [{ kind: 'attribute', uuid: 'attr-1', entityUuid: 'ent-1' }],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

describe('ruleService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default: empty store
    mocked.listAllEntityRuleFiles.mockResolvedValue([]);
    mocked.listPackagesWithRules.mockResolvedValue([]);
    mocked.listCases.mockResolvedValue([]);
    mocked.listPackages.mockResolvedValue([]);
    mocked.readEntityRules.mockResolvedValue([]);
    mocked.readPackageRules.mockResolvedValue([]);
    mocked.readCaseRules.mockResolvedValue([]);
    mocked.readGlobalRules.mockResolvedValue([]);
    mocked.writeEntityRules.mockResolvedValue(true);
    mocked.writePackageRules.mockResolvedValue(true);
    mocked.writeCaseRules.mockResolvedValue(true);
    mocked.writeGlobalRules.mockResolvedValue(true);
    mocked.readCaseFile.mockResolvedValue(null);
    mocked.loadPackage.mockResolvedValue({
      entities: [],
      relationships: [],
      rules: [],
      cases: [],
      ownership: {
        entityByName: new Map(),
        entityByUuid: new Map(),
        relationshipByUuid: new Map(),
        ruleByUuid: new Map(),
        caseByUuid: new Map(),
      },
    });

    // Slice 6e.1: register a stand-in projection so projection-routed writes
    // succeed. The fake projection forwards each call to the legacy
    // fileOperations mocks, so the existing test assertions keep working.
    registerProjection(DICT_WS, buildFakeProjection() as unknown as Parameters<typeof registerProjection>[1]);
  });

  afterEach(() => {
    resetProjectionRegistry();
  });

  // ─── listRules ─────────────────────────────────────────────────────────
  describe('listRules', () => {
    it('returns empty array when no rules exist anywhere', async () => {
      const rules = await ruleService.listRules();
      expect(rules).toEqual([]);
    });

    it('aggregates rules from all three storage scopes', async () => {
      mocked.listAllEntityRuleFiles.mockResolvedValue([
        { service: 'user-service', entityUuid: 'ent-1' },
      ]);
      mocked.readEntityRules.mockResolvedValue([buildRule({ uuid: 'r-entity', scope: 'entity' })]);

      mocked.listPackagesWithRules.mockResolvedValue(['order-service']);
      mocked.readPackageRules.mockResolvedValue([
        buildRule({ uuid: 'r-package', scope: 'package', packageName: 'order-service' }),
      ]);

      mocked.listCases.mockResolvedValue([
        { uuid: 'p-1', name: 'Ordering', rootEntities: [], rules: [
          buildRule({ uuid: 'r-case', scope: 'case', caseUuid: 'p-1' }),
        ] } as any,
      ]);

      const rules = await ruleService.listRules();
      const uuids = rules.map(r => r.uuid).sort();
      expect(uuids).toEqual(['r-case', 'r-entity', 'r-package']);
    });

    it('filters by scope', async () => {
      mocked.listPackagesWithRules.mockResolvedValue(['order-service']);
      mocked.readPackageRules.mockResolvedValue([
        buildRule({ uuid: 'r-package', scope: 'package' }),
      ]);
      mocked.listAllEntityRuleFiles.mockResolvedValue([
        { service: 'user-service', entityUuid: 'ent-1' },
      ]);
      mocked.readEntityRules.mockResolvedValue([buildRule({ uuid: 'r-entity', scope: 'entity' })]);

      const onlyPackage = await ruleService.listRules({ scope: 'package' });
      expect(onlyPackage).toHaveLength(1);
      expect(onlyPackage[0].uuid).toBe('r-package');
    });

    it('filters by severity', async () => {
      mocked.listPackagesWithRules.mockResolvedValue(['svc']);
      mocked.readPackageRules.mockResolvedValue([
        buildRule({ uuid: 'r-error', severity: 'error' }),
        buildRule({ uuid: 'r-warning', severity: 'warning' }),
      ]);

      const errors = await ruleService.listRules({ severity: 'error' });
      expect(errors).toHaveLength(1);
      expect(errors[0].uuid).toBe('r-error');
    });

    it('filters by targetUuid (matches direct uuid)', async () => {
      mocked.listPackagesWithRules.mockResolvedValue(['svc']);
      mocked.readPackageRules.mockResolvedValue([
        buildRule({ uuid: 'r-1', targets: [{ kind: 'entity', uuid: 'ent-A' }] }),
        buildRule({ uuid: 'r-2', targets: [{ kind: 'entity', uuid: 'ent-B' }] }),
      ]);

      const rules = await ruleService.listRules({ targetUuid: 'ent-A' });
      expect(rules).toHaveLength(1);
      expect(rules[0].uuid).toBe('r-1');
    });

    it('filters by targetUuid (matches via entityUuid on attribute target)', async () => {
      mocked.listPackagesWithRules.mockResolvedValue(['svc']);
      mocked.readPackageRules.mockResolvedValue([
        buildRule({
          uuid: 'r-attr',
          targets: [{ kind: 'attribute', uuid: 'attr-1', entityUuid: 'ent-A' }],
        }),
      ]);

      const rules = await ruleService.listRules({ targetUuid: 'ent-A' });
      expect(rules).toHaveLength(1);
    });
  });

  // ─── listRulesForEntity ────────────────────────────────────────────────
  describe('listRulesForEntity', () => {
    it('returns rules whose targets reference this entity directly or via attribute', async () => {
      mocked.listPackagesWithRules.mockResolvedValue(['svc']);
      mocked.readPackageRules.mockResolvedValue([
        buildRule({ uuid: 'r-direct', targets: [{ kind: 'entity', uuid: 'ent-1' }] }),
        buildRule({
          uuid: 'r-via-attr',
          targets: [{ kind: 'attribute', uuid: 'attr-x', entityUuid: 'ent-1' }],
        }),
        buildRule({ uuid: 'r-other', targets: [{ kind: 'entity', uuid: 'ent-2' }] }),
      ]);

      const rules = await ruleService.listRulesForEntity('ent-1');
      expect(rules.map(r => r.uuid).sort()).toEqual(['r-direct', 'r-via-attr']);
    });
  });

  // ─── createRule ────────────────────────────────────────────────────────
  describe('createRule', () => {
    it('rejects invalid rule (missing required fields)', async () => {
      const result = await ruleService.createRule({ name: 'bad' });
      expect(result.success).toBe(false);
      expect(result.errors!.length).toBeGreaterThan(0);
      expect(mocked.writePackageRules).not.toHaveBeenCalled();
    });

    it('rejects rule with non-kebab-case name', async () => {
      const result = await ruleService.createRule({
        name: 'BadName',
        description: 'desc',
        severity: 'error',
        scope: 'package',
        packageName: 'svc',
        targets: [{ kind: 'entity', uuid: 'ent-1' }],
      });
      expect(result.success).toBe(false);
      expect(result.errors!.some(e => e.includes('kebab-case'))).toBe(true);
    });

    it('creates a package-scoped rule and writes to package rules.yaml', async () => {
      const result = await ruleService.createRule({
        name: 'order-total-positive',
        description: 'Total must be positive',
        severity: 'warning',
        scope: 'package',
        packageName: 'order-service',
        targets: [{ kind: 'attribute', uuid: 'attr-total', entityUuid: 'ent-order' }],
      });

      expect(result.success).toBe(true);
      expect(result.rule!.uuid).toBe('rule-fixed-uuid-1234');
      expect(result.rule!.createdAt).toBeDefined();
      expect(mocked.writePackageRules).toHaveBeenCalledWith(
        'order-service',
        expect.arrayContaining([expect.objectContaining({ name: 'order-total-positive' })])
      );
    });

    it('creates an entity-scoped rule when packageName is provided as the service hint', async () => {
      // Slice 6e.1 — ruleService now loads the parent entity from loadPackage
      // before round-tripping through projection.writeEntity. Provide a
      // package model that contains the entity so findEntityByUuid succeeds.
      mocked.loadPackage.mockResolvedValue({
        entities: [{ uuid: 'ent-1', name: 'Profile', attributes: [] }],
        relationships: [],
        rules: [],
        cases: [],
        ownership: {
          entityByName: new Map([['Profile', '']]),
          entityByUuid: new Map([['ent-1', '']]),
          relationshipByUuid: new Map(),
          ruleByUuid: new Map(),
          caseByUuid: new Map(),
        },
      });
      const result = await ruleService.createRule({
        name: 'profile-complete',
        description: 'desc',
        severity: 'info',
        scope: 'entity',
        entityUuid: 'ent-1',
        packageName: 'user-service',
        targets: [{ kind: 'entity', uuid: 'ent-1' }],
      });

      expect(result.success).toBe(true);
      expect(mocked.writeEntityRules).toHaveBeenCalledWith(
        'user-service',
        'ent-1',
        expect.arrayContaining([expect.objectContaining({ name: 'profile-complete' })])
      );
    });

    it('creates a case-scoped rule and persists via writeCaseRules', async () => {
      // Slice 6e.1 — ruleService now loads the case via readCaseFile and
      // round-trips through projection.writeCase. The fake projection in
      // beforeEach forwards writeCase → writeCaseRules so the legacy
      // assertion below still passes.
      mocked.readCaseFile.mockResolvedValue({
        uuid: 'p-fraud',
        name: 'FraudCheck',
        rootEntities: [],
        nodes: [],
        rules: [],
      });
      mocked.listPackages.mockResolvedValue(['fraud-service']);
      mocked.loadPackage.mockResolvedValue({
        entities: [],
        relationships: [],
        rules: [],
        cases: [{ uuid: 'p-fraud', name: 'FraudCheck' }],
        ownership: {
          entityByName: new Map(),
          entityByUuid: new Map(),
          relationshipByUuid: new Map(),
          ruleByUuid: new Map(),
          caseByUuid: new Map([['p-fraud', '']]),
        },
      });

      const result = await ruleService.createRule({
        name: 'fraud-check',
        description: 'check',
        severity: 'error',
        scope: 'case',
        caseUuid: 'p-fraud',
        targets: [{ kind: 'case-node', uuid: 'p-fraud', casePath: 'Customer' }],
      });

      expect(result.success).toBe(true);
      expect(mocked.writeCaseRules).toHaveBeenCalledWith(
        'p-fraud',
        expect.arrayContaining([expect.objectContaining({ name: 'fraud-check' })])
      );
    });
  });

  // ─── updateRule ────────────────────────────────────────────────────────
  describe('updateRule', () => {
    it('updates a rule in-place when scope does not change', async () => {
      mocked.listPackagesWithRules.mockResolvedValue(['svc']);
      mocked.readPackageRules.mockResolvedValue([
        buildRule({ uuid: 'r-1', scope: 'package', packageName: 'svc', description: 'old' }),
      ]);

      const result = await ruleService.updateRule('r-1', { description: 'new description' });

      expect(result.success).toBe(true);
      expect(result.rule!.description).toBe('new description');
      // updatedAt was refreshed
      expect(result.rule!.updatedAt).not.toBe('2026-01-01T00:00:00.000Z');
      expect(mocked.writePackageRules).toHaveBeenCalled();
    });

    it('returns failure when rule not found', async () => {
      const result = await ruleService.updateRule('missing', { description: 'x' });
      expect(result.success).toBe(false);
      expect(result.errors![0]).toContain('not found');
    });

    it('moves rule between scopes when scope changes (entity → package)', async () => {
      mocked.listAllEntityRuleFiles.mockResolvedValue([
        { service: 'user-service', entityUuid: 'ent-1' },
      ]);
      mocked.readEntityRules.mockResolvedValue([
        buildRule({ uuid: 'r-1', scope: 'entity', entityUuid: 'ent-1', packageName: 'user-service' }),
      ]);
      // Slice 6e.1 — removeRuleFromScope's entity arm now loads the entity
      // from loadPackage before round-tripping through projection.writeEntity.
      // The entity must carry the rule the test asserts gets removed.
      mocked.loadPackage.mockResolvedValue({
        entities: [{
          uuid: 'ent-1',
          name: 'Profile',
          attributes: [],
          rules: [buildRule({ uuid: 'r-1', scope: 'entity', entityUuid: 'ent-1', packageName: 'user-service' })],
        }],
        relationships: [],
        rules: [],
        cases: [],
        ownership: {
          entityByName: new Map([['Profile', '']]),
          entityByUuid: new Map([['ent-1', '']]),
          relationshipByUuid: new Map(),
          ruleByUuid: new Map(),
          caseByUuid: new Map(),
        },
      });

      const result = await ruleService.updateRule('r-1', {
        scope: 'package',
        entityUuid: undefined,
        packageName: 'user-service',
      });

      expect(result.success).toBe(true);
      // Removed from old location
      expect(mocked.writeEntityRules).toHaveBeenCalledWith(
        'user-service',
        'ent-1',
        expect.not.arrayContaining([expect.objectContaining({ uuid: 'r-1' })])
      );
      // Added to new location
      expect(mocked.writePackageRules).toHaveBeenCalledWith(
        'user-service',
        expect.arrayContaining([expect.objectContaining({ uuid: 'r-1', scope: 'package' })])
      );
    });
  });

  // ─── deleteRule ────────────────────────────────────────────────────────
  describe('deleteRule', () => {
    it('removes a rule from package storage', async () => {
      mocked.listPackagesWithRules.mockResolvedValue(['svc']);
      mocked.readPackageRules.mockResolvedValue([
        buildRule({ uuid: 'r-1', scope: 'package', packageName: 'svc' }),
        buildRule({ uuid: 'r-2', scope: 'package', packageName: 'svc' }),
      ]);

      const result = await ruleService.deleteRule('r-1');

      expect(result.success).toBe(true);
      expect(mocked.writePackageRules).toHaveBeenCalledWith(
        'svc',
        expect.arrayContaining([expect.objectContaining({ uuid: 'r-2' })])
      );
      const writtenRules = mocked.writePackageRules.mock.calls[0][1];
      expect(writtenRules.find((r: Rule) => r.uuid === 'r-1')).toBeUndefined();
    });

    it('returns failure when rule does not exist', async () => {
      const result = await ruleService.deleteRule('nonexistent');
      expect(result.success).toBe(false);
      expect(result.errors![0]).toContain('not found');
    });
  });

  // ─── getRule ──────────────────────────────────────────────────────────
  describe('getRule', () => {
    it('returns null when not found', async () => {
      const result = await ruleService.getRule('missing');
      expect(result).toBeNull();
    });

    it('finds a rule across scopes by uuid', async () => {
      mocked.listPackagesWithRules.mockResolvedValue(['svc']);
      mocked.readPackageRules.mockResolvedValue([
        buildRule({ uuid: 'target-uuid', name: 'found' }),
      ]);

      const result = await ruleService.getRule('target-uuid');
      expect(result).not.toBeNull();
      expect(result!.name).toBe('found');
    });
  });

  // (#85 R2) The constraint→rule synthesizer was deleted. Validation lives
  // on the attribute itself (`attribute.validation`) and is surfaced through
  // the Integrity page (#85 R5). The Rules page now shows only real,
  // human-authored functional rules.

  // ─── Enforcement field validation ──────────────────────────────────────
  describe('enforcement validation', () => {
    it('createRule defaults missing enforcement to advisory', async () => {
      const result = await ruleService.createRule({
        name: 'no-enforcement-given',
        description: 'desc',
        severity: 'warning',
        scope: 'package',
        packageName: 'svc',
        targets: [{ kind: 'entity', uuid: 'ent-1' }],
      });
      expect(result.success).toBe(true);
      expect(result.rule!.enforcement).toBe('advisory');
    });

    it('rejects rule with invalid enforcement value', async () => {
      const result = await ruleService.createRule({
        name: 'bad-enf',
        description: 'desc',
        severity: 'error',
        enforcement: 'nope' as any,
        scope: 'package',
        packageName: 'svc',
        targets: [{ kind: 'entity', uuid: 'ent-1' }],
      });
      expect(result.success).toBe(false);
      expect(result.errors!.some(e => e.includes('enforcement'))).toBe(true);
    });

    it('rejects process-enforcement rule without process-stage-field metadata', async () => {
      const result = await ruleService.createRule({
        name: 'process-rule',
        description: 'desc',
        severity: 'error',
        enforcement: 'process',
        scope: 'package',
        packageName: 'svc',
        targets: [{ kind: 'entity', uuid: 'ent-1' }],
      });
      expect(result.success).toBe(false);
      expect(result.errors!.some(e => e.includes('process-stage-field'))).toBe(true);
    });

    it('accepts process-enforcement rule with process-stage-field metadata', async () => {
      const result = await ruleService.createRule({
        name: 'process-rule',
        description: 'desc',
        severity: 'error',
        enforcement: 'process',
        scope: 'package',
        packageName: 'svc',
        targets: [{ kind: 'entity', uuid: 'ent-1' }],
        metadata: [
          { name: 'process-stage-field', value: 'lifecycle-stage' },
          { name: 'process-stage-value', value: 'approved' },
        ],
      });
      expect(result.success).toBe(true);
      expect(result.rule!.enforcement).toBe('process');
      expect(result.rule!.metadata).toHaveLength(2);
    });
  });

  // ─── Filter by enforcement ─────────────────────────────────────────────
  describe('listRules enforcement filter', () => {
    it('filters by enforcement', async () => {
      mocked.listPackagesWithRules.mockResolvedValue(['svc']);
      mocked.readPackageRules.mockResolvedValue([
        buildRule({ uuid: 'r-save', enforcement: 'save' }),
        buildRule({ uuid: 'r-advisory', enforcement: 'advisory' }),
      ]);

      const saveRules = await ruleService.listRules({ enforcement: 'save' });
      expect(saveRules).toHaveLength(1);
      expect(saveRules[0].uuid).toBe('r-save');
    });
  });
});
