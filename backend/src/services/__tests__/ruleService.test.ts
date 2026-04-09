/**
 * Tests for the rule service (#74) — covers the three storage scopes:
 * entity-sidecar, package, and perspective. Mocks the file operations layer
 * so tests don't touch the real filesystem.
 */
import { ruleService } from '../ruleService.js';
import { Rule } from '../../models/Rule.js';

// Provide an explicit factory mock so our new rule helpers exist (the
// __mocks__/fileOperations.ts manual mock predates them).
jest.mock('../../utils/fileOperations', () => ({
  readEntityRules: jest.fn(),
  writeEntityRules: jest.fn(),
  readPackageRules: jest.fn(),
  writePackageRules: jest.fn(),
  readPerspectiveRules: jest.fn(),
  writePerspectiveRules: jest.fn(),
  listAllEntityRuleFiles: jest.fn(),
  listPackagesWithRules: jest.fn(),
  listPerspectives: jest.fn(),
  listAllEntities: jest.fn(),
  readEntityFile: jest.fn(),
}));
jest.mock('../../utils/logger');
jest.mock('../../utils/uuid', () => ({
  generateUUID: jest.fn().mockReturnValue('rule-fixed-uuid-1234'),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const fileOps = require('../../utils/fileOperations');
const mocked = fileOps as {
  readEntityRules: jest.Mock;
  writeEntityRules: jest.Mock;
  readPackageRules: jest.Mock;
  writePackageRules: jest.Mock;
  readPerspectiveRules: jest.Mock;
  writePerspectiveRules: jest.Mock;
  listAllEntityRuleFiles: jest.Mock;
  listPackagesWithRules: jest.Mock;
  listPerspectives: jest.Mock;
  listAllEntities: jest.Mock;
  readEntityFile: jest.Mock;
};

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
    mocked.listPerspectives.mockResolvedValue([]);
    mocked.readEntityRules.mockResolvedValue([]);
    mocked.readPackageRules.mockResolvedValue([]);
    mocked.readPerspectiveRules.mockResolvedValue([]);
    mocked.writeEntityRules.mockResolvedValue(true);
    mocked.writePackageRules.mockResolvedValue(true);
    mocked.writePerspectiveRules.mockResolvedValue(true);
    // Default: no entities to synthesize from (#76)
    mocked.listAllEntities.mockResolvedValue([]);
    mocked.readEntityFile.mockResolvedValue(null);
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

      mocked.listPerspectives.mockResolvedValue([
        { uuid: 'p-1', name: 'Ordering', rootEntities: [], rules: [
          buildRule({ uuid: 'r-perspective', scope: 'perspective', perspectiveUuid: 'p-1' }),
        ] } as any,
      ]);

      const rules = await ruleService.listRules();
      const uuids = rules.map(r => r.uuid).sort();
      expect(uuids).toEqual(['r-entity', 'r-package', 'r-perspective']);
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

    it('creates a perspective-scoped rule and persists via writePerspectiveRules', async () => {
      const result = await ruleService.createRule({
        name: 'fraud-check',
        description: 'check',
        severity: 'error',
        scope: 'perspective',
        perspectiveUuid: 'p-fraud',
        targets: [{ kind: 'perspective-node', uuid: 'p-fraud', perspectivePath: 'Customer' }],
      });

      expect(result.success).toBe(true);
      expect(mocked.writePerspectiveRules).toHaveBeenCalledWith(
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

  // ─── Constraint synthesis (#76) ────────────────────────────────────────
  describe('constraint rule synthesis', () => {
    const buildEntityWithConstraints = () => ({
      uuid: 'ent-customer',
      name: 'Customer',
      attributes: [
        {
          uuid: 'attr-email',
          name: 'email',
          type: 'string',
          required: true,
          description: 'email',
          validation: {
            format: 'email',
            minLength: 5,
            maxLength: 100,
          },
        },
        {
          uuid: 'attr-age',
          name: 'age',
          type: 'integer',
          required: false,
          description: 'age',
          validation: {
            minimum: 0,
            maximum: 150,
          },
        },
        {
          uuid: 'attr-no-constraints',
          name: 'note',
          type: 'string',
          required: false,
          description: 'note',
        },
      ],
    });

    it('emits virtual rules for each constraint field on each attribute', async () => {
      mocked.listAllEntities.mockResolvedValue([
        { microservice: 'user-service', name: 'Customer' },
      ]);
      mocked.readEntityFile.mockResolvedValue(buildEntityWithConstraints());

      const rules = await ruleService.listRules();

      // Expect 5 synthetic rules: format/minLength/maxLength on email + minimum/maximum on age
      const synthetic = rules.filter(r => r.synthetic);
      expect(synthetic).toHaveLength(5);

      const fields = synthetic.map(r => r.constraintField).sort();
      expect(fields).toEqual(['format', 'maxLength', 'maximum', 'minLength', 'minimum']);
    });

    it('synthetic rules carry stable constraint: prefixed UUIDs', async () => {
      mocked.listAllEntities.mockResolvedValue([
        { microservice: 'user-service', name: 'Customer' },
      ]);
      mocked.readEntityFile.mockResolvedValue(buildEntityWithConstraints());

      const rules = await ruleService.listRules();
      const formatRule = rules.find(r => r.constraintField === 'format');
      expect(formatRule).toBeDefined();
      expect(formatRule!.uuid).toBe('constraint:attr-email:format');
      expect(formatRule!.synthetic).toBe(true);
      expect(formatRule!.severity).toBe('error');
      expect(formatRule!.enforcement).toBe('save');
      expect(formatRule!.tags).toContain('constraint');
    });

    it('synthetic rules merge with real rules from entity sidecars', async () => {
      mocked.listAllEntityRuleFiles.mockResolvedValue([
        { service: 'user-service', entityUuid: 'ent-customer' },
      ]);
      mocked.readEntityRules.mockResolvedValue([
        buildRule({ uuid: 'real-1', name: 'real-rule' }),
      ]);
      mocked.listAllEntities.mockResolvedValue([
        { microservice: 'user-service', name: 'Customer' },
      ]);
      mocked.readEntityFile.mockResolvedValue(buildEntityWithConstraints());

      const rules = await ruleService.listRules({ scope: 'entity' });
      const real = rules.filter(r => !r.synthetic);
      const synthetic = rules.filter(r => r.synthetic);
      expect(real).toHaveLength(1);
      expect(synthetic.length).toBeGreaterThanOrEqual(5);
    });

    it('listRulesForEntity includes synthetic rules whose target is the entity', async () => {
      mocked.listAllEntities.mockResolvedValue([
        { microservice: 'user-service', name: 'Customer' },
      ]);
      mocked.readEntityFile.mockResolvedValue(buildEntityWithConstraints());

      const rules = await ruleService.listRulesForEntity('ent-customer');
      // All 5 synthetic rules target attributes that have entityUuid = ent-customer
      expect(rules.length).toBeGreaterThanOrEqual(5);
      expect(rules.every(r => r.synthetic)).toBe(true);
    });

    it('returns empty when entity has no constraints', async () => {
      mocked.listAllEntities.mockResolvedValue([
        { microservice: 'user-service', name: 'Plain' },
      ]);
      mocked.readEntityFile.mockResolvedValue({
        uuid: 'ent-plain',
        name: 'Plain',
        attributes: [
          { uuid: 'a', name: 'x', type: 'string', required: false, description: '' },
        ],
      });

      const rules = await ruleService.listRules();
      expect(rules.filter(r => r.synthetic)).toHaveLength(0);
    });
  });

  // ─── Write rejection on synthetic UUIDs (#76) ──────────────────────────
  describe('write rejection on synthetic rules', () => {
    it('updateRule rejects constraint: prefixed UUID with a clear message', async () => {
      const result = await ruleService.updateRule('constraint:attr-1:format', {
        description: 'try to edit',
      });
      expect(result.success).toBe(false);
      expect(result.errors![0]).toContain('synthesized from an attribute constraint');
      expect(mocked.writeEntityRules).not.toHaveBeenCalled();
    });

    it('deleteRule rejects constraint: prefixed UUID with a clear message', async () => {
      const result = await ruleService.deleteRule('constraint:attr-1:format');
      expect(result.success).toBe(false);
      expect(result.errors![0]).toContain('synthesized from an attribute constraint');
      expect(mocked.writeEntityRules).not.toHaveBeenCalled();
    });
  });

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
