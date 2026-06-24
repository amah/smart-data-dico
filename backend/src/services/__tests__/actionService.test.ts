/**
 * actionService.test.ts — #179 Actions
 *
 * Tests for actionService CRUD methods. Mocks the fileOperations layer
 * so tests don't touch the real filesystem. Mirrors the pattern established
 * in ruleService.test.ts.
 */

import { actionService, validateAction } from '../actionService.js';
import type { Action } from '../../models/Action.js';

jest.mock('../../utils/fileOperations', () => ({
  readActionsForEntity: jest.fn(),
  writeAction: jest.fn(),
  deleteAction: jest.fn(),
  findActionOwner: jest.fn(),
  loadPackage: jest.fn(),
  listPackages: jest.fn(),
}));
jest.mock('../../utils/logger', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));
jest.mock('../../utils/uuid', () => ({
  generateUUID: jest.fn().mockReturnValue('action-fixed-uuid-1234'),
  sanitizeFsName: jest.fn((n: string) => n),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const fileOps = require('../../utils/fileOperations');
const mocked = fileOps as {
  readActionsForEntity: jest.Mock;
  writeAction: jest.Mock;
  deleteAction: jest.Mock;
  findActionOwner: jest.Mock;
  loadPackage: jest.Mock;
  listPackages: jest.Mock;
};

// ── Fixture helpers ───────────────────────────────────────────────────────────

const ENTITY_UUID = '96a3ac78-d30b-4bf5-bb61-bf3174212f6c';
const PACKAGE_NAME = 'order-service';

const makeAction = (overrides: Partial<Action> = {}): Action => ({
  uuid: 'act-001',
  name: 'cancel',
  ownerRef: ENTITY_UUID,
  params: [{ name: 'reason', type: 'string', required: true }],
  returns: { type: 'void' },
  flow: [{ kind: 'emitEvent', name: 'order.cancelled' }],
  internal: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

function makePackageModel(entities: { uuid: string; name: string }[], actions: Action[] = []) {
  return {
    packageName: PACKAGE_NAME,
    entities: entities.map(e => ({ ...e, attributes: [], status: 'draft' })),
    relationships: [],
    rules: [],
    cases: [],
    actions,
    stateMachines: [],
    ownership: {
      entityByName: new Map(entities.map(e => [e.name, ''])),
      entityByUuid: new Map(entities.map(e => [e.uuid, ''])),
      relationshipByUuid: new Map(),
      ruleByUuid: new Map(),
      caseByUuid: new Map(),
      actionByUuid: new Map(actions.map(a => [a.uuid, ''])),
      stateMachineByUuid: new Map(),
      actionByOwnerAndName: new Map(actions.map(a => [`${a.ownerRef}::${a.name}`, ''])),
      stateMachineByOwnerAndName: new Map(),
    },
  };
}

// ── validateAction (pure unit tests) ─────────────────────────────────────────

describe('validateAction', () => {
  it('returns no errors for a valid action', () => {
    const errors = validateAction(makeAction());
    expect(errors).toHaveLength(0);
  });

  it('requires uuid, name, and ownerRef', () => {
    const errors = validateAction({});
    expect(errors.some(e => e.field === 'uuid')).toBe(true);
    expect(errors.some(e => e.field === 'name')).toBe(true);
    expect(errors.some(e => e.field === 'ownerRef')).toBe(true);
  });

  it('rejects duplicate param names', () => {
    const errors = validateAction(makeAction({
      params: [
        { name: 'reason', type: 'string' },
        { name: 'reason', type: 'string' },
      ],
    }));
    expect(errors.some(e => e.field === 'params' && e.message.includes('unique'))).toBe(true);
  });

  it('rejects params without a name', () => {
    const errors = validateAction(makeAction({
      params: [{ name: '', type: 'string' }],
    }));
    expect(errors.some(e => e.field === 'params')).toBe(true);
  });

  it('rejects params without a type', () => {
    const errors = validateAction(makeAction({
      params: [{ name: 'reason', type: '' }],
    }));
    expect(errors.some(e => e.field === 'params' && e.message.includes('type'))).toBe(true);
  });

  it('rejects flow steps with invalid kind', () => {
    const errors = validateAction(makeAction({
      flow: [{ kind: 'invalidKind' } as unknown as import('../../models/Action.js').FlowStep],
    }));
    expect(errors.some(e => e.field.startsWith('flow['))).toBe(true);
  });

  it('accepts all valid flow step kinds', () => {
    const validSteps: import('../../models/Action.js').FlowStep[] = [
      { kind: 'assign',       target: 'x', value: 'y' },
      { kind: 'emitEvent',    name: 'ev' },
      { kind: 'invokeAction', actionRef: 'some-uuid' },
      { kind: 'branch',       when: 'x > 0', then: [] },
      { kind: 'wait',         for: '5s' },
      { kind: 'callExternal', target: 'svc.op' },
    ];
    for (const step of validSteps) {
      const errors = validateAction(makeAction({ flow: [step] }));
      expect(errors.filter(e => e.field.startsWith('flow['))).toHaveLength(0);
    }
  });
});

// ── Load-time validation gaps (spec AC) ──────────────────────────────────────
//
// The spec requires `invokeAction.actionRef` to resolve to a known action UUID.
// The current implementation does NOT check this at load time.
// Marked .skip to document the gap; remove .skip when implementation adds this.

describe('validateAction — spec-required but unimplemented validations', () => {
  it('should reject invokeAction steps whose actionRef does not resolve to a known action UUID (spec AC)', () => {
    // Pass an empty set of known action UUIDs so the cross-reference check fires.
    const errors = validateAction(
      makeAction({
        flow: [{ kind: 'invokeAction', actionRef: 'nonexistent-uuid' }],
      }),
      new Set<string>(), // knownActionUuids — empty, so any actionRef is invalid
    );
    expect(errors.some(e => e.message.includes('nonexistent-uuid'))).toBe(true);
  });
});

// ── actionService.list ────────────────────────────────────────────────────────

describe('actionService.list', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mocked.listPackages.mockResolvedValue([]);
    mocked.loadPackage.mockResolvedValue(makePackageModel([]));
    mocked.readActionsForEntity.mockResolvedValue([]);
  });

  it('returns empty array when no actions exist', async () => {
    const result = await actionService.list();
    expect(result).toEqual([]);
  });

  it('filters by ownerRef when provided', async () => {
    const expected = [makeAction()];
    mocked.readActionsForEntity.mockResolvedValue(expected);

    const result = await actionService.list({ ownerRef: ENTITY_UUID });
    expect(result).toEqual(expected);
    expect(mocked.readActionsForEntity).toHaveBeenCalledWith(ENTITY_UUID);
  });

  it('aggregates actions from all packages without ownerRef filter', async () => {
    mocked.listPackages.mockResolvedValue([PACKAGE_NAME]);
    mocked.loadPackage.mockResolvedValue(makePackageModel([], [makeAction()]));

    const result = await actionService.list();
    expect(result).toHaveLength(1);
    expect(result[0].uuid).toBe('act-001');
  });
});

// ── actionService.getByUuid ───────────────────────────────────────────────────

describe('actionService.getByUuid', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns null when not found', async () => {
    mocked.findActionOwner.mockResolvedValue(null);
    const result = await actionService.getByUuid('nonexistent');
    expect(result).toBeNull();
  });

  it('returns the action when found', async () => {
    const action = makeAction();
    mocked.findActionOwner.mockResolvedValue({ packageName: PACKAGE_NAME, filePath: 'order-service/Order.model.yaml' });
    mocked.loadPackage.mockResolvedValue(makePackageModel([], [action]));

    const result = await actionService.getByUuid('act-001');
    expect(result).not.toBeNull();
    expect(result!.uuid).toBe('act-001');
    expect(result!.name).toBe('cancel');
  });
});

// ── actionService.create ──────────────────────────────────────────────────────

describe('actionService.create', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mocked.listPackages.mockResolvedValue([PACKAGE_NAME]);
    mocked.loadPackage.mockResolvedValue(makePackageModel([{ uuid: ENTITY_UUID, name: 'Order' }]));
    mocked.writeAction.mockResolvedValue({ ok: true, physicalPath: 'order-service/Order.model.yaml' });
  });

  it('creates a valid action and returns it with a generated UUID', async () => {
    const result = await actionService.create({
      name: 'cancel',
      ownerRef: ENTITY_UUID,
      params: [{ name: 'reason', type: 'string', required: true }],
      returns: { type: 'void' },
      flow: [{ kind: 'emitEvent', name: 'order.cancelled' }],
    });

    expect('errors' in result).toBe(false);
    const action = result as Action;
    expect(action.uuid).toBe('action-fixed-uuid-1234');
    expect(action.name).toBe('cancel');
    expect(action.ownerRef).toBe(ENTITY_UUID);
    expect(mocked.writeAction).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'cancel', ownerRef: ENTITY_UUID }),
      PACKAGE_NAME,
    );
  });

  it('returns validation errors when name is missing', async () => {
    const result = await actionService.create({ ownerRef: ENTITY_UUID });
    expect('errors' in result).toBe(true);
    const { errors } = result as { errors: Array<{ field: string; message: string }> };
    expect(errors.some(e => e.field === 'name')).toBe(true);
    expect(mocked.writeAction).not.toHaveBeenCalled();
  });

  it('returns error when ownerRef is unknown', async () => {
    mocked.loadPackage.mockResolvedValue(makePackageModel([])); // no entities
    const result = await actionService.create({
      name: 'cancel',
      ownerRef: 'unknown-entity-uuid',
    });
    expect('errors' in result).toBe(true);
    const { errors } = result as { errors: Array<{ field: string; message: string }> };
    expect(errors.some(e => e.field === 'ownerRef')).toBe(true);
  });

  it('returns error when duplicate param names are provided', async () => {
    const result = await actionService.create({
      name: 'cancel',
      ownerRef: ENTITY_UUID,
      params: [
        { name: 'reason', type: 'string' },
        { name: 'reason', type: 'string' },
      ],
    });
    expect('errors' in result).toBe(true);
    const { errors } = result as { errors: Array<{ field: string; message: string }> };
    expect(errors.some(e => e.field === 'params')).toBe(true);
  });
});

// ── actionService.update ──────────────────────────────────────────────────────

describe('actionService.update', () => {
  const existing = makeAction();

  beforeEach(() => {
    jest.clearAllMocks();
    mocked.findActionOwner.mockResolvedValue({ packageName: PACKAGE_NAME, filePath: 'order-service/Order.model.yaml' });
    mocked.loadPackage.mockResolvedValue(makePackageModel([{ uuid: ENTITY_UUID, name: 'Order' }], [existing]));
    mocked.writeAction.mockResolvedValue({ ok: true });
  });

  it('updates an existing action in-place', async () => {
    const result = await actionService.update('act-001', { description: 'Updated description' });
    expect(result).not.toBeNull();
    expect('errors' in result!).toBe(false);
    const updated = result as Action;
    expect(updated.description).toBe('Updated description');
    expect(updated.uuid).toBe('act-001');
    expect(mocked.writeAction).toHaveBeenCalled();
  });

  it('returns null when the action does not exist', async () => {
    mocked.findActionOwner.mockResolvedValue(null);
    const result = await actionService.update('nonexistent', { description: 'x' });
    expect(result).toBeNull();
  });
});

// ── actionService.delete ──────────────────────────────────────────────────────

describe('actionService.delete', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns true when action is successfully deleted', async () => {
    mocked.deleteAction.mockResolvedValue({ ok: true });
    const result = await actionService.delete('act-001');
    expect(result).toBe(true);
  });

  it('returns false when action is not found', async () => {
    mocked.deleteAction.mockResolvedValue({ ok: false });
    const result = await actionService.delete('nonexistent');
    expect(result).toBe(false);
  });
});
