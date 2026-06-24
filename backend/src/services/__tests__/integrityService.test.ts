/**
 * Tests for the Integrity service (#85 R5).
 *
 * The pure helpers (`validationItemsFromEntity`, `constraintItemsFromEntity`)
 * are exercised in isolation — they don't touch disk and let us verify
 * the row-shaping logic without mocking the file system.
 *
 * The full `integrityService.getReport()` walk is exercised with mocked
 * file-system + rule-service helpers to confirm it joins the three lists
 * correctly without double-counting or losing rows.
 */
import { Entity, AttributeType, EntityStatus, PhysicalConstraint } from '../../models/EntitySchema.js';

jest.mock('../../utils/logger');
jest.mock('../../utils/fileOperations', () => ({
  listAllEntities: jest.fn(),
  readEntityFile: jest.fn(),
}));
jest.mock('../ruleService', () => ({
  ruleService: { listRules: jest.fn() },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const fileOps = require('../../utils/fileOperations');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ruleSvc = require('../ruleService');

import {
  integrityService,
  validationItemsFromEntity,
  constraintItemsFromEntity,
} from '../integrityService.js';

const buildEntity = (overrides: Partial<Entity> = {}): Entity => ({
  uuid: 'ent-1',
  name: 'User',
  description: '',
  status: EntityStatus.DRAFT,
  attributes: [],
  ...overrides,
});

beforeEach(() => {
  fileOps.listAllEntities.mockReset();
  fileOps.readEntityFile.mockReset();
  ruleSvc.ruleService.listRules.mockReset();
  ruleSvc.ruleService.listRules.mockResolvedValue([]);
});

// ────────────────────────────────────────────────────────────────────────
// validationItemsFromEntity — pure
// ────────────────────────────────────────────────────────────────────────

describe('validationItemsFromEntity (#85 R5)', () => {
  it('emits one row per present validation field on each attribute', () => {
    const entity = buildEntity({
      uuid: 'e-user',
      name: 'User',
      attributes: [
        {
          uuid: 'a-username',
          name: 'username',
          type: AttributeType.STRING,
          required: true,
          description: '',
          validation: { minLength: 3, maxLength: 50, pattern: '^[a-z]+$' },
        },
        {
          uuid: 'a-email',
          name: 'email',
          type: AttributeType.STRING,
          required: true,
          description: '',
          validation: { format: 'email' },
        },
      ],
    });

    const rows = validationItemsFromEntity('user-service', entity);
    expect(rows).toHaveLength(4); // 3 on username + 1 on email
    const kinds = rows.map(r => `${r.attributeName}.${r.kind}`).sort();
    expect(kinds).toEqual([
      'email.format',
      'username.maxLength',
      'username.minLength',
      'username.pattern',
    ]);
    // Each row carries the entity + service context
    expect(rows[0].service).toBe('user-service');
    expect(rows[0].entityName).toBe('User');
    expect(rows[0].entityUuid).toBe('e-user');
  });

  it('skips attributes without a validation block', () => {
    const entity = buildEntity({
      attributes: [
        { uuid: 'a-id', name: 'id', type: AttributeType.STRING, required: true, description: '' },
      ],
    });
    expect(validationItemsFromEntity('svc', entity)).toEqual([]);
  });

  it('preserves enumValues as a string array, not flattened', () => {
    const entity = buildEntity({
      attributes: [
        {
          uuid: 'a-role',
          name: 'role',
          type: AttributeType.ENUM,
          required: true,
          description: '',
          validation: { enumValues: ['ADMIN', 'USER', 'GUEST'] },
        },
      ],
    });
    const rows = validationItemsFromEntity('svc', entity);
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe('enumValues');
    expect(rows[0].value).toEqual(['ADMIN', 'USER', 'GUEST']);
  });
});

// ────────────────────────────────────────────────────────────────────────
// constraintItemsFromEntity — pure
// ────────────────────────────────────────────────────────────────────────

describe('constraintItemsFromEntity (#85 R5)', () => {
  it('emits one row per physical constraint with entity context', () => {
    const cs: PhysicalConstraint[] = [
      { kind: 'unique', name: 'uq_users_email', columns: ['email'] },
      { kind: 'check', name: 'chk_age', expression: 'age >= 0' },
    ];
    const entity = buildEntity({
      uuid: 'e-user',
      name: 'User',
      constraints: cs,
    });
    const rows = constraintItemsFromEntity('user-service', entity);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      service: 'user-service',
      entityUuid: 'e-user',
      entityName: 'User',
      constraint: cs[0],
    });
    expect(rows[1].constraint).toBe(cs[1]);
  });

  it('returns an empty array when the entity has no constraints', () => {
    expect(constraintItemsFromEntity('svc', buildEntity())).toEqual([]);
  });
});

// ────────────────────────────────────────────────────────────────────────
// integrityService.getReport — full walk
// ────────────────────────────────────────────────────────────────────────

describe('integrityService.getReport (#85 R5)', () => {
  it('joins validation + constraints + rules from all entities into one payload', async () => {
    fileOps.listAllEntities.mockResolvedValue([
      { microservice: 'user-service', name: 'User', path: '/x' },
      { microservice: 'order-service', name: 'Order', path: '/y' },
    ]);
    fileOps.readEntityFile.mockImplementation(async (svc: string, name: string) => {
      if (svc === 'user-service' && name === 'User') {
        return buildEntity({
          uuid: 'e-user',
          name: 'User',
          attributes: [
            {
              uuid: 'a-email',
              name: 'email',
              type: AttributeType.STRING,
              required: true,
              description: '',
              validation: { format: 'email' },
            },
          ],
          constraints: [{ kind: 'unique', name: 'uq_users_email', columns: ['email'] }],
        });
      }
      if (svc === 'order-service' && name === 'Order') {
        return buildEntity({
          uuid: 'e-order',
          name: 'Order',
          attributes: [
            {
              uuid: 'a-total',
              name: 'total',
              type: AttributeType.NUMBER,
              required: true,
              description: '',
              validation: { minimum: 0 },
            },
          ],
          constraints: [{ kind: 'check', name: 'chk_total', expression: 'total >= 0' }],
        });
      }
      return null;
    });
    ruleSvc.ruleService.listRules.mockResolvedValue([
      { uuid: 'r-1', name: 'order-total-positive', description: '', severity: 'error', enforcement: 'save', scope: 'package', targets: [] },
    ]);

    const report = await integrityService.getReport();
    expect(report.validation).toHaveLength(2);
    expect(report.constraints).toHaveLength(2);
    expect(report.rules).toHaveLength(1);

    // Each validation row carries the right service context
    expect(report.validation.find(v => v.attributeName === 'email')!.service).toBe('user-service');
    expect(report.validation.find(v => v.attributeName === 'total')!.service).toBe('order-service');
    // Each constraint row carries the right service + name
    expect(report.constraints.find(c => c.constraint.name === 'uq_users_email')!.service).toBe('user-service');
    expect(report.constraints.find(c => c.constraint.name === 'chk_total')!.service).toBe('order-service');
  });

  it('returns an empty report when there are no entities and no rules', async () => {
    fileOps.listAllEntities.mockResolvedValue([]);
    ruleSvc.ruleService.listRules.mockResolvedValue([]);
    const report = await integrityService.getReport();
    expect(report).toEqual({ validation: [], constraints: [], rules: [] });
  });

  it('skips entities that fail to read instead of crashing the report', async () => {
    fileOps.listAllEntities.mockResolvedValue([
      { microservice: 'user-service', name: 'User', path: '/x' },
      { microservice: 'broken-service', name: 'Broken', path: '/y' },
    ]);
    fileOps.readEntityFile.mockImplementation(async (svc: string) => {
      if (svc === 'user-service') {
        return buildEntity({
          uuid: 'e-user',
          name: 'User',
          constraints: [{ kind: 'unique', name: 'uq', columns: ['x'] }],
        });
      }
      return null; // simulates a missing/corrupt file
    });

    const report = await integrityService.getReport();
    expect(report.constraints).toHaveLength(1);
    expect(report.constraints[0].service).toBe('user-service');
  });

  it('continues when ruleService.listRules throws', async () => {
    fileOps.listAllEntities.mockResolvedValue([]);
    ruleSvc.ruleService.listRules.mockRejectedValue(new Error('boom'));
    const report = await integrityService.getReport();
    expect(report.rules).toEqual([]);
    // validation/constraints empty too — but this proves the error didn't bubble up
    expect(report.validation).toEqual([]);
  });
});
