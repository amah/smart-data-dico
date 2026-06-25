/**
 * eventService.test.ts — #201 Phase 2 (first-class Events)
 *
 * Tests for eventService CRUD + validateEvent. Mocks the fileOperations layer
 * so tests don't touch the real filesystem. Mirrors actionService.test.ts.
 */

import { eventService, validateEvent } from '../eventService.js';
import type { Event } from '../../models/Event.js';

jest.mock('../../utils/fileOperations', () => ({
  readEventsForEntity: jest.fn(),
  readEventsForPackage: jest.fn(),
  writeEvent: jest.fn(),
  deleteEvent: jest.fn(),
  findEventOwner: jest.fn(),
  loadPackage: jest.fn(),
  listPackages: jest.fn(),
}));
jest.mock('../../utils/logger', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));
jest.mock('../../utils/uuid', () => ({
  generateUUID: jest.fn().mockReturnValue('event-fixed-uuid-1234'),
  sanitizeFsName: jest.fn((n: string) => n),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const fileOps = require('../../utils/fileOperations');
const mocked = fileOps as {
  readEventsForEntity: jest.Mock;
  readEventsForPackage: jest.Mock;
  writeEvent: jest.Mock;
  deleteEvent: jest.Mock;
  findEventOwner: jest.Mock;
  loadPackage: jest.Mock;
  listPackages: jest.Mock;
};

const ENTITY_UUID = '96a3ac78-d30b-4bf5-bb61-bf3174212f6c';
const PACKAGE_NAME = 'order-service';

const makeEvent = (overrides: Partial<Event> = {}): Event => ({
  uuid: 'evt-001',
  name: 'order.cancelled',
  ownerRef: ENTITY_UUID,
  description: 'Emitted when an order is cancelled',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

function makePackageModel(
  entities: { uuid: string; name: string }[],
  events: Event[] = [],
) {
  return {
    packageName: PACKAGE_NAME,
    entities: entities.map(e => ({ ...e, attributes: [], status: 'draft' })),
    relationships: [],
    rules: [],
    cases: [],
    actions: [],
    stateMachines: [],
    events,
    ownership: {
      entityByName: new Map(entities.map(e => [e.name, ''])),
      entityByUuid: new Map(entities.map(e => [e.uuid, ''])),
      relationshipByUuid: new Map(),
      ruleByUuid: new Map(),
      caseByUuid: new Map(),
      actionByUuid: new Map(),
      stateMachineByUuid: new Map(),
      eventByUuid: new Map(events.map(e => [e.uuid, ''])),
      eventByName: new Map(events.map(e => [e.name, ''])),
      actionByOwnerAndName: new Map(),
      stateMachineByOwnerAndName: new Map(),
    },
  };
}

beforeEach(() => jest.clearAllMocks());

// ── validateEvent (pure unit tests) ─────────────────────────────────────────

describe('validateEvent', () => {
  it('requires uuid and name', () => {
    const errs = validateEvent({});
    expect(errs.map(e => e.field).sort()).toEqual(['name', 'uuid']);
  });

  it('passes for a minimal valid event', () => {
    expect(validateEvent({ uuid: 'e1', name: 'order.paid' })).toEqual([]);
  });

  it('rejects duplicate payload attribute names', () => {
    const errs = validateEvent({
      uuid: 'e1',
      name: 'order.paid',
      payload: [
        { uuid: 'a', name: 'amount', type: 'number' } as never,
        { uuid: 'b', name: 'amount', type: 'number' } as never,
      ],
    });
    expect(errs.some(e => e.field === 'payload')).toBe(true);
  });
});

// ── create ─────────────────────────────────────────────────────────────────

describe('eventService.create', () => {
  it('creates an event owned by an entity, deriving the package from ownerRef', async () => {
    mocked.listPackages.mockResolvedValue([PACKAGE_NAME]);
    mocked.loadPackage.mockResolvedValue(makePackageModel([{ uuid: ENTITY_UUID, name: 'Order' }]));
    mocked.writeEvent.mockResolvedValue({ ok: true });

    const result = await eventService.create({ name: 'order.cancelled', ownerRef: ENTITY_UUID });
    expect('errors' in result).toBe(false);
    expect((result as Event).uuid).toBe('event-fixed-uuid-1234');
    expect(mocked.writeEvent).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'order.cancelled', ownerRef: ENTITY_UUID }),
      PACKAGE_NAME,
    );
  });

  it('creates a package-level event from an explicit packageName (no owner)', async () => {
    mocked.listPackages.mockResolvedValue([PACKAGE_NAME]);
    mocked.loadPackage.mockResolvedValue(makePackageModel([]));
    mocked.writeEvent.mockResolvedValue({ ok: true });

    const result = await eventService.create({ name: 'order.archived', packageName: PACKAGE_NAME });
    expect('errors' in result).toBe(false);
    expect(mocked.writeEvent).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'order.archived', ownerRef: undefined }),
      PACKAGE_NAME,
    );
  });

  it('rejects when neither ownerRef nor packageName is provided', async () => {
    mocked.listPackages.mockResolvedValue([PACKAGE_NAME]);
    const result = await eventService.create({ name: 'orphan' });
    expect('errors' in result).toBe(true);
  });

  it('rejects when ownerRef does not resolve to a known entity', async () => {
    mocked.listPackages.mockResolvedValue([PACKAGE_NAME]);
    mocked.loadPackage.mockResolvedValue(makePackageModel([]));
    const result = await eventService.create({ name: 'x', ownerRef: 'nonexistent' });
    expect('errors' in result).toBe(true);
    expect((result as { errors: { field: string }[] }).errors[0].field).toBe('ownerRef');
  });

  it('rejects a duplicate event name within the package', async () => {
    mocked.listPackages.mockResolvedValue([PACKAGE_NAME]);
    mocked.loadPackage.mockResolvedValue(
      makePackageModel([{ uuid: ENTITY_UUID, name: 'Order' }], [makeEvent({ uuid: 'evt-existing', name: 'order.cancelled' })]),
    );
    const result = await eventService.create({ name: 'order.cancelled', ownerRef: ENTITY_UUID });
    expect('errors' in result).toBe(true);
    expect((result as { errors: { field: string }[] }).errors.some(e => e.field === 'name')).toBe(true);
  });
});

// ── list / get / delete ──────────────────────────────────────────────────────

describe('eventService list/get/delete', () => {
  it('lists events for an entity via readEventsForEntity', async () => {
    mocked.readEventsForEntity.mockResolvedValue([makeEvent()]);
    const events = await eventService.list({ ownerRef: ENTITY_UUID });
    expect(events).toHaveLength(1);
    expect(mocked.readEventsForEntity).toHaveBeenCalledWith(ENTITY_UUID);
  });

  it('gets an event by uuid', async () => {
    mocked.findEventOwner.mockResolvedValue({ packageName: PACKAGE_NAME, filePath: 'f' });
    mocked.loadPackage.mockResolvedValue(makePackageModel([], [makeEvent()]));
    const event = await eventService.getByUuid('evt-001');
    expect(event?.uuid).toBe('evt-001');
  });

  it('returns null when getting a missing event', async () => {
    mocked.findEventOwner.mockResolvedValue(null);
    expect(await eventService.getByUuid('nope')).toBeNull();
  });

  it('deletes an event', async () => {
    mocked.deleteEvent.mockResolvedValue({ ok: true });
    expect(await eventService.delete('evt-001')).toBe(true);
  });
});
