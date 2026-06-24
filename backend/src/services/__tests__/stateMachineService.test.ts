/**
 * stateMachineService.test.ts — #179 State Machines
 *
 * Tests for stateMachineService CRUD methods. Mocks the fileOperations layer
 * so tests don't touch the real filesystem. Mirrors actionService.test.ts.
 */

import { stateMachineService, validateStateMachine } from '../stateMachineService.js';
import type { StateMachine } from '../../models/StateMachine.js';

jest.mock('../../utils/fileOperations', () => ({
  readStateMachinesForEntity: jest.fn(),
  writeStateMachine: jest.fn(),
  deleteStateMachine: jest.fn(),
  findStateMachineOwner: jest.fn(),
  loadPackage: jest.fn(),
  listPackages: jest.fn(),
}));
jest.mock('../../utils/logger', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));
jest.mock('../../utils/uuid', () => ({
  generateUUID: jest.fn().mockReturnValue('sm-fixed-uuid-1234'),
  sanitizeFsName: jest.fn((n: string) => n),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const fileOps = require('../../utils/fileOperations');
const mocked = fileOps as {
  readStateMachinesForEntity: jest.Mock;
  writeStateMachine: jest.Mock;
  deleteStateMachine: jest.Mock;
  findStateMachineOwner: jest.Mock;
  loadPackage: jest.Mock;
  listPackages: jest.Mock;
};

// ── Fixture helpers ───────────────────────────────────────────────────────────

const ENTITY_UUID = '96a3ac78-d30b-4bf5-bb61-bf3174212f6c';
const PACKAGE_NAME = 'order-service';

const makeStateMachine = (overrides: Partial<StateMachine> = {}): StateMachine => ({
  uuid: 'sm-001',
  name: 'fulfillment',
  ownerRef: ENTITY_UUID,
  stateAttribute: 'status',
  initialState: 'PENDING',
  states: [
    { name: 'PENDING' },
    { name: 'PROCESSING' },
    { name: 'CANCELLED', terminal: true },
  ],
  transitions: [
    { uuid: 'tr-001', from: 'PENDING', to: 'PROCESSING', on: 'payment.authorized' },
    { uuid: 'tr-002', from: '*', to: 'CANCELLED', on: 'order.cancel' },
  ],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

function makePackageModel(
  entities: { uuid: string; name: string }[],
  stateMachines: StateMachine[] = [],
) {
  return {
    packageName: PACKAGE_NAME,
    entities: entities.map(e => ({
      ...e,
      // Include the 'status' attribute so stateAttribute: 'status' passes validation
      attributes: [{ uuid: 'attr-status', name: 'status', type: 'string', description: '', required: false }],
      status: 'draft',
    })),
    relationships: [],
    rules: [],
    cases: [],
    actions: [],
    stateMachines,
    ownership: {
      entityByName: new Map(entities.map(e => [e.name, ''])),
      entityByUuid: new Map(entities.map(e => [e.uuid, ''])),
      relationshipByUuid: new Map(),
      ruleByUuid: new Map(),
      caseByUuid: new Map(),
      actionByUuid: new Map(),
      stateMachineByUuid: new Map(stateMachines.map(m => [m.uuid, ''])),
      actionByOwnerAndName: new Map(),
      stateMachineByOwnerAndName: new Map(stateMachines.map(m => [`${m.ownerRef}::${m.name}`, ''])),
    },
  };
}

// ── validateStateMachine (pure unit tests) ────────────────────────────────────

describe('validateStateMachine', () => {
  it('returns no errors for a valid state machine', () => {
    const errors = validateStateMachine(makeStateMachine());
    expect(errors).toHaveLength(0);
  });

  it('requires uuid, name, ownerRef, and initialState', () => {
    const errors = validateStateMachine({});
    expect(errors.some(e => e.field === 'uuid')).toBe(true);
    expect(errors.some(e => e.field === 'name')).toBe(true);
    expect(errors.some(e => e.field === 'ownerRef')).toBe(true);
    expect(errors.some(e => e.field === 'initialState')).toBe(true);
  });

  it('requires at least one state', () => {
    const errors = validateStateMachine(makeStateMachine({ states: [] }));
    expect(errors.some(e => e.field === 'states')).toBe(true);
  });

  it('rejects duplicate state names within a machine', () => {
    const errors = validateStateMachine(makeStateMachine({
      states: [{ name: 'PENDING' }, { name: 'PENDING' }],
      initialState: 'PENDING',
      transitions: [],
    }));
    expect(errors.some(e => e.field === 'states' && e.message.includes('unique'))).toBe(true);
  });

  it('rejects initialState that is not a declared state', () => {
    const errors = validateStateMachine(makeStateMachine({ initialState: 'NONEXISTENT' }));
    expect(errors.some(e => e.field === 'initialState')).toBe(true);
  });

  it('rejects a transition.from pointing to an undeclared state', () => {
    const errors = validateStateMachine(makeStateMachine({
      transitions: [
        { uuid: 'tr-bad', from: 'UNDECLARED', to: 'PROCESSING', on: 'some.event' },
      ],
    }));
    expect(errors.some(e => e.field.includes('from'))).toBe(true);
  });

  it('rejects a transition.to pointing to an undeclared state', () => {
    const errors = validateStateMachine(makeStateMachine({
      transitions: [
        { uuid: 'tr-bad', from: 'PENDING', to: 'UNDECLARED', on: 'some.event' },
      ],
    }));
    expect(errors.some(e => e.field.includes('to'))).toBe(true);
  });

  it('accepts "*" as a valid transition.from (wildcard)', () => {
    const errors = validateStateMachine(makeStateMachine({
      transitions: [
        { uuid: 'tr-wild', from: '*', to: 'CANCELLED', on: 'order.cancel' },
      ],
    }));
    expect(errors.filter(e => e.field.includes('transitions[0].from'))).toHaveLength(0);
  });

  it('rejects duplicate transition UUIDs within the same machine', () => {
    const errors = validateStateMachine(makeStateMachine({
      transitions: [
        { uuid: 'tr-dup', from: 'PENDING', to: 'PROCESSING', on: 'ev1' },
        { uuid: 'tr-dup', from: 'PENDING', to: 'CANCELLED', on: 'ev2' },
      ],
    }));
    expect(errors.some(e => e.message.includes("Duplicate transition uuid 'tr-dup'"))).toBe(true);
  });

  it('rejects a transition missing the on event', () => {
    const errors = validateStateMachine(makeStateMachine({
      transitions: [{ uuid: 'tr-no-on', from: 'PENDING', to: 'PROCESSING', on: '' }],
    }));
    expect(errors.some(e => e.field.includes('on'))).toBe(true);
  });
});

// ── Load-time validation gaps (spec AC) ──────────────────────────────────────
//
// The spec requires these validations at "load-time + on PUT".
// The current implementation does NOT perform them.
// These tests are marked .skip to document the gap without blocking CI;
// once the implementation adds these checks, remove .skip.

describe('validateStateMachine — spec-required but unimplemented validations', () => {
  it('should reject transition.invoke[] entries that do not resolve to a known action UUID (spec AC)', () => {
    // Pass an empty set of known action UUIDs so the cross-reference check fires.
    const errors = validateStateMachine(
      makeStateMachine({
        transitions: [
          {
            uuid: 'tr-invoke-unknown',
            from: 'PENDING',
            to: 'PROCESSING',
            on: 'payment.authorized',
            invoke: ['nonexistent-action-uuid'],
          },
        ],
      }),
      new Set<string>(), // knownActionUuids — empty, so any invoke ref is invalid
    );
    expect(errors.some(e => e.message.includes('nonexistent-action-uuid'))).toBe(true);
  });

  it('should accept transition.invoke[] entries that resolve to known action UUIDs', () => {
    const knownUuids = new Set(['act-known-uuid']);
    const errors = validateStateMachine(
      makeStateMachine({
        transitions: [
          { uuid: 'tr-1', from: 'PENDING', to: 'PROCESSING', on: 'ev', invoke: ['act-known-uuid'] },
        ],
      }),
      knownUuids,
    );
    expect(errors.filter(e => e.field.includes('invoke'))).toHaveLength(0);
  });

  it('should reject stateAttribute that is not an attribute on the owner entity', () => {
    const errors = validateStateMachine(
      makeStateMachine({ stateAttribute: 'nonexistentAttr' }),
      undefined,
      ['status', 'createdAt'], // ownerAttributes
    );
    expect(errors.some(e => e.field === 'stateAttribute')).toBe(true);
  });

  it('should accept stateAttribute that exists on the owner entity', () => {
    const errors = validateStateMachine(
      makeStateMachine({ stateAttribute: 'status' }),
      undefined,
      ['status', 'createdAt'],
    );
    expect(errors.filter(e => e.field === 'stateAttribute')).toHaveLength(0);
  });

  it('should skip stateAttribute check when ownerAttributes is not provided', () => {
    // Without ownerAttributes, we cannot validate — no error should be raised
    const errors = validateStateMachine(makeStateMachine({ stateAttribute: 'anyAttr' }));
    expect(errors.filter(e => e.field === 'stateAttribute')).toHaveLength(0);
  });
});

// ── stateMachineService.list ──────────────────────────────────────────────────

describe('stateMachineService.list', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mocked.listPackages.mockResolvedValue([]);
    mocked.loadPackage.mockResolvedValue(makePackageModel([]));
    mocked.readStateMachinesForEntity.mockResolvedValue([]);
  });

  it('returns empty array when no machines exist', async () => {
    const result = await stateMachineService.list();
    expect(result).toEqual([]);
  });

  it('filters by ownerRef when provided', async () => {
    const expected = [makeStateMachine()];
    mocked.readStateMachinesForEntity.mockResolvedValue(expected);

    const result = await stateMachineService.list({ ownerRef: ENTITY_UUID });
    expect(result).toEqual(expected);
    expect(mocked.readStateMachinesForEntity).toHaveBeenCalledWith(ENTITY_UUID);
  });

  it('aggregates machines from all packages without ownerRef filter', async () => {
    const sm = makeStateMachine();
    mocked.listPackages.mockResolvedValue([PACKAGE_NAME]);
    mocked.loadPackage.mockResolvedValue(makePackageModel([], [sm]));

    const result = await stateMachineService.list();
    expect(result).toHaveLength(1);
    expect(result[0].uuid).toBe('sm-001');
  });
});

// ── stateMachineService.getByUuid ─────────────────────────────────────────────

describe('stateMachineService.getByUuid', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns null when not found', async () => {
    mocked.findStateMachineOwner.mockResolvedValue(null);
    const result = await stateMachineService.getByUuid('nonexistent');
    expect(result).toBeNull();
  });

  it('returns the machine when found', async () => {
    const sm = makeStateMachine();
    mocked.findStateMachineOwner.mockResolvedValue({ packageName: PACKAGE_NAME, filePath: 'order-service/Order.statemachine.yaml' });
    mocked.loadPackage.mockResolvedValue(makePackageModel([], [sm]));

    const result = await stateMachineService.getByUuid('sm-001');
    expect(result).not.toBeNull();
    expect(result!.uuid).toBe('sm-001');
    expect(result!.name).toBe('fulfillment');
  });
});

// ── stateMachineService.create ────────────────────────────────────────────────

describe('stateMachineService.create', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mocked.listPackages.mockResolvedValue([PACKAGE_NAME]);
    mocked.loadPackage.mockResolvedValue(makePackageModel([{ uuid: ENTITY_UUID, name: 'Order' }]));
    mocked.writeStateMachine.mockResolvedValue({ ok: true, physicalPath: 'order-service/Order.statemachine.yaml' });
  });

  it('creates a valid state machine and returns it', async () => {
    const result = await stateMachineService.create({
      name: 'fulfillment',
      ownerRef: ENTITY_UUID,
      initialState: 'PENDING',
      states: [{ name: 'PENDING' }, { name: 'DONE', terminal: true }],
      transitions: [{ uuid: 'tr-1', from: 'PENDING', to: 'DONE', on: 'finish' }],
    });

    expect('errors' in result).toBe(false);
    const sm = result as StateMachine;
    expect(sm.uuid).toBe('sm-fixed-uuid-1234');
    expect(sm.name).toBe('fulfillment');
    expect(sm.ownerRef).toBe(ENTITY_UUID);
    expect(mocked.writeStateMachine).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'fulfillment', ownerRef: ENTITY_UUID }),
      PACKAGE_NAME,
    );
  });

  it('returns validation errors when name is missing', async () => {
    const result = await stateMachineService.create({
      ownerRef: ENTITY_UUID,
      initialState: 'PENDING',
      states: [{ name: 'PENDING' }],
    });
    expect('errors' in result).toBe(true);
    const { errors } = result as { errors: Array<{ field: string; message: string }> };
    expect(errors.some(e => e.field === 'name')).toBe(true);
    expect(mocked.writeStateMachine).not.toHaveBeenCalled();
  });

  it('returns error when ownerRef is unknown', async () => {
    mocked.loadPackage.mockResolvedValue(makePackageModel([])); // no entities
    const result = await stateMachineService.create({
      name: 'fulfillment',
      ownerRef: 'unknown-entity-uuid',
      initialState: 'PENDING',
      states: [{ name: 'PENDING' }],
    });
    expect('errors' in result).toBe(true);
    const { errors } = result as { errors: Array<{ field: string; message: string }> };
    expect(errors.some(e => e.field === 'ownerRef')).toBe(true);
  });

  it('returns validation errors when transition.to is an undeclared state', async () => {
    const result = await stateMachineService.create({
      name: 'payment',
      ownerRef: ENTITY_UUID,
      initialState: 'PENDING',
      states: [{ name: 'PENDING' }],
      transitions: [{ uuid: 'tr-bad', from: 'PENDING', to: 'UNDECLARED', on: 'some.event' }],
    });
    expect('errors' in result).toBe(true);
    const { errors } = result as { errors: Array<{ field: string; message: string }> };
    expect(errors.some(e => e.field.includes('to'))).toBe(true);
  });
});

// ── stateMachineService.update ────────────────────────────────────────────────

describe('stateMachineService.update', () => {
  const existing = makeStateMachine();

  beforeEach(() => {
    jest.clearAllMocks();
    mocked.findStateMachineOwner.mockResolvedValue({ packageName: PACKAGE_NAME, filePath: 'order-service/Order.statemachine.yaml' });
    mocked.loadPackage.mockResolvedValue(makePackageModel([{ uuid: ENTITY_UUID, name: 'Order' }], [existing]));
    mocked.writeStateMachine.mockResolvedValue({ ok: true });
  });

  it('updates an existing state machine in-place', async () => {
    const result = await stateMachineService.update('sm-001', { description: 'Updated description' });
    expect(result).not.toBeNull();
    expect('errors' in result!).toBe(false);
    const updated = result as StateMachine;
    expect(updated.description).toBe('Updated description');
    expect(updated.uuid).toBe('sm-001');
    expect(mocked.writeStateMachine).toHaveBeenCalled();
  });

  it('returns null when the machine does not exist', async () => {
    mocked.findStateMachineOwner.mockResolvedValue(null);
    const result = await stateMachineService.update('nonexistent', { description: 'x' });
    expect(result).toBeNull();
  });
});

// ── stateMachineService.delete ────────────────────────────────────────────────

describe('stateMachineService.delete', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns true when machine is successfully deleted', async () => {
    mocked.deleteStateMachine.mockResolvedValue({ ok: true });
    const result = await stateMachineService.delete('sm-001');
    expect(result).toBe(true);
  });

  it('returns false when machine is not found', async () => {
    mocked.deleteStateMachine.mockResolvedValue({ ok: false });
    const result = await stateMachineService.delete('nonexistent');
    expect(result).toBe(false);
  });
});
