/**
 * actionsRoutes.test.ts — #179 HTTP integration tests
 *
 * Tests for the /api/actions, /api/state-machines, and entity-scoped
 * listing endpoints using Supertest against the Express app.
 *
 * Auth middleware is mocked so we can control the effective role.
 * Services are mocked to isolate route + controller behavior.
 */

import { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import app from '../../server.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: { id: string; role: string };
    }
  }
}

// ── Auth mocks — default to ADMIN role ───────────────────────────────────────

jest.mock('../../middleware/auth', () => ({
  UserRole: { ADMIN: 'admin', EDITOR: 'editor', VIEWER: 'viewer' },
  authenticate: jest.fn().mockImplementation(
    () => (req: Request, _res: Response, next: NextFunction) => {
      req.user = { id: 'test-user', role: 'admin' };
      next();
    },
  ),
}));

// Default: ADMIN passes all routes
let mockUserRole = 'admin';
jest.mock('../../middleware/jwtAuth', () => ({
  verifyToken: jest.fn().mockImplementation((req: Request, _res: Response, next: NextFunction) => {
    req.user = { id: 'test-user', role: mockUserRole };
    next();
  }),
  authorizeJwt: jest.fn().mockImplementation((roles: string[]) => (req: Request, res: Response, next: NextFunction) => {
    if (!roles.includes(mockUserRole)) {
      return res.status(403).json({ message: 'Forbidden' });
    }
    req.user = { id: 'test-user', role: mockUserRole };
    next();
  }),
}));

// ── Service mocks ─────────────────────────────────────────────────────────────

jest.mock('../../services/actionService', () => ({
  actionService: {
    list: jest.fn(),
    getByUuid: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
}));

jest.mock('../../services/stateMachineService', () => ({
  stateMachineService: {
    list: jest.fn(),
    getByUuid: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
}));

jest.mock('../../utils/logger', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { actionService } = require('../../services/actionService');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { stateMachineService } = require('../../services/stateMachineService');

// ── Fixtures ──────────────────────────────────────────────────────────────────

const ENTITY_UUID = '96a3ac78-d30b-4bf5-bb61-bf3174212f6c';

const ACTION_FIXTURE = {
  uuid: 'act-api-001',
  name: 'cancel',
  ownerRef: ENTITY_UUID,
  params: [{ name: 'reason', type: 'string', required: true }],
  returns: { type: 'void' },
  flow: [{ kind: 'emitEvent', name: 'order.cancelled' }],
  internal: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const SM_FIXTURE = {
  uuid: 'sm-api-001',
  name: 'fulfillment',
  ownerRef: ENTITY_UUID,
  stateAttribute: 'status',
  initialState: 'PENDING',
  states: [{ name: 'PENDING' }, { name: 'DONE', terminal: true }],
  transitions: [{ uuid: 'tr-1', from: 'PENDING', to: 'DONE', on: 'finish' }],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

// ── Action endpoints ──────────────────────────────────────────────────────────

describe('GET /api/entities/:uuid/actions', () => {
  afterEach(() => {
    jest.clearAllMocks();
    mockUserRole = 'admin';
  });

  it('returns 200 with the actions array for the entity', async () => {
    actionService.list.mockResolvedValue([ACTION_FIXTURE]);

    const res = await request(app).get(`/api/entities/${ENTITY_UUID}/actions`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].uuid).toBe('act-api-001');
  });

  it('returns 200 with empty array when entity has no actions', async () => {
    actionService.list.mockResolvedValue([]);

    const res = await request(app).get(`/api/entities/${ENTITY_UUID}/actions`);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });
});

describe('POST /api/actions', () => {
  afterEach(() => {
    jest.clearAllMocks();
    mockUserRole = 'admin';
  });

  it('returns 201 and the created action when input is valid', async () => {
    actionService.create.mockResolvedValue(ACTION_FIXTURE);

    const res = await request(app)
      .post('/api/actions')
      .send({
        name: 'cancel',
        ownerRef: ENTITY_UUID,
        params: [{ name: 'reason', type: 'string', required: true }],
      });

    expect(res.status).toBe(201);
    expect(res.body.data.uuid).toBe('act-api-001');
    expect(res.body.data.name).toBe('cancel');
  });

  it('returns 400 when ownerRef is unknown (service returns errors)', async () => {
    actionService.create.mockResolvedValue({
      errors: [{ field: 'ownerRef', message: "Entity 'unknown-uuid' not found in any package" }],
    });

    const res = await request(app)
      .post('/api/actions')
      .send({ name: 'cancel', ownerRef: 'unknown-uuid' });

    expect(res.status).toBe(400);
    expect(res.body.errors).toBeDefined();
    expect(res.body.errors.some((e: { field: string }) => e.field === 'ownerRef')).toBe(true);
  });

  it('returns 400 when validation errors are returned (e.g. missing name)', async () => {
    actionService.create.mockResolvedValue({
      errors: [{ field: 'name', message: 'name is required' }],
    });

    const res = await request(app)
      .post('/api/actions')
      .send({ ownerRef: ENTITY_UUID });

    expect(res.status).toBe(400);
    expect(res.body.errors.some((e: { field: string }) => e.field === 'name')).toBe(true);
  });

  it('returns 403 when VIEWER tries to create an action', async () => {
    mockUserRole = 'viewer';

    const res = await request(app)
      .post('/api/actions')
      .send({ name: 'cancel', ownerRef: ENTITY_UUID });

    expect(res.status).toBe(403);
    expect(actionService.create).not.toHaveBeenCalled();
  });
});

describe('GET /api/actions/:uuid', () => {
  afterEach(() => {
    jest.clearAllMocks();
    mockUserRole = 'admin';
  });

  it('returns 200 with the action when found', async () => {
    actionService.getByUuid.mockResolvedValue(ACTION_FIXTURE);

    const res = await request(app).get('/api/actions/act-api-001');
    expect(res.status).toBe(200);
    expect(res.body.data.uuid).toBe('act-api-001');
  });

  it('returns 404 when action is not found', async () => {
    actionService.getByUuid.mockResolvedValue(null);

    const res = await request(app).get('/api/actions/nonexistent');
    expect(res.status).toBe(404);
  });
});

describe('PUT /api/actions/:uuid', () => {
  afterEach(() => {
    jest.clearAllMocks();
    mockUserRole = 'admin';
  });

  it('returns 200 with the updated action when valid', async () => {
    actionService.update.mockResolvedValue({ ...ACTION_FIXTURE, description: 'Updated' });

    const res = await request(app)
      .put('/api/actions/act-api-001')
      .send({ description: 'Updated' });

    expect(res.status).toBe(200);
    expect(res.body.data.description).toBe('Updated');
  });

  it('returns 404 when action is not found', async () => {
    actionService.update.mockResolvedValue(null);

    const res = await request(app)
      .put('/api/actions/nonexistent')
      .send({ description: 'x' });

    expect(res.status).toBe(404);
  });

  it('returns 403 when VIEWER tries to update an action', async () => {
    mockUserRole = 'viewer';

    const res = await request(app)
      .put('/api/actions/act-api-001')
      .send({ description: 'Updated' });

    expect(res.status).toBe(403);
    expect(actionService.update).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/actions/:uuid', () => {
  afterEach(() => {
    jest.clearAllMocks();
    mockUserRole = 'admin';
  });

  it('returns 200 when action is successfully deleted', async () => {
    actionService.delete.mockResolvedValue(true);

    const res = await request(app).delete('/api/actions/act-api-001');
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/deleted/i);
  });

  it('returns 404 when action is not found', async () => {
    actionService.delete.mockResolvedValue(false);

    const res = await request(app).delete('/api/actions/nonexistent');
    expect(res.status).toBe(404);
  });

  it('returns 403 when VIEWER tries to delete an action', async () => {
    mockUserRole = 'viewer';

    const res = await request(app).delete('/api/actions/act-api-001');
    expect(res.status).toBe(403);
    expect(actionService.delete).not.toHaveBeenCalled();
  });
});

// ── State machine endpoints ────────────────────────────────────────────────────

describe('GET /api/entities/:uuid/state-machines', () => {
  afterEach(() => {
    jest.clearAllMocks();
    mockUserRole = 'admin';
  });

  it('returns 200 with the machines array for the entity', async () => {
    stateMachineService.list.mockResolvedValue([SM_FIXTURE]);

    const res = await request(app).get(`/api/entities/${ENTITY_UUID}/state-machines`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].uuid).toBe('sm-api-001');
  });

  it('returns only the machines belonging to the requested entity', async () => {
    stateMachineService.list.mockResolvedValue([SM_FIXTURE]);

    const res = await request(app).get(`/api/entities/${ENTITY_UUID}/state-machines`);
    expect(res.status).toBe(200);
    // The controller passes the entity uuid to service.list
    expect(stateMachineService.list).toHaveBeenCalledWith(
      expect.objectContaining({ ownerRef: ENTITY_UUID }),
    );
  });
});

describe('POST /api/state-machines', () => {
  afterEach(() => {
    jest.clearAllMocks();
    mockUserRole = 'admin';
  });

  it('returns 201 and the created machine when input is valid', async () => {
    stateMachineService.create.mockResolvedValue(SM_FIXTURE);

    const res = await request(app)
      .post('/api/state-machines')
      .send({
        name: 'fulfillment',
        ownerRef: ENTITY_UUID,
        initialState: 'PENDING',
        states: [{ name: 'PENDING' }, { name: 'DONE', terminal: true }],
        transitions: [{ uuid: 'tr-1', from: 'PENDING', to: 'DONE', on: 'finish' }],
      });

    expect(res.status).toBe(201);
    expect(res.body.data.uuid).toBe('sm-api-001');
  });

  it('returns 400 when ownerRef is unknown', async () => {
    stateMachineService.create.mockResolvedValue({
      errors: [{ field: 'ownerRef', message: "Entity 'unknown-uuid' not found in any package" }],
    });

    const res = await request(app)
      .post('/api/state-machines')
      .send({ name: 'fulfillment', ownerRef: 'unknown-uuid', initialState: 'PENDING', states: [{ name: 'PENDING' }] });

    expect(res.status).toBe(400);
    expect(res.body.errors.some((e: { field: string }) => e.field === 'ownerRef')).toBe(true);
  });

  it('returns 403 when VIEWER tries to create a state machine', async () => {
    mockUserRole = 'viewer';

    const res = await request(app)
      .post('/api/state-machines')
      .send({ name: 'fulfillment', ownerRef: ENTITY_UUID });

    expect(res.status).toBe(403);
    expect(stateMachineService.create).not.toHaveBeenCalled();
  });
});

describe('GET /api/state-machines/:uuid', () => {
  afterEach(() => {
    jest.clearAllMocks();
    mockUserRole = 'admin';
  });

  it('returns 200 with the machine when found', async () => {
    stateMachineService.getByUuid.mockResolvedValue(SM_FIXTURE);

    const res = await request(app).get('/api/state-machines/sm-api-001');
    expect(res.status).toBe(200);
    expect(res.body.data.uuid).toBe('sm-api-001');
  });

  it('returns 404 when machine is not found', async () => {
    stateMachineService.getByUuid.mockResolvedValue(null);

    const res = await request(app).get('/api/state-machines/nonexistent');
    expect(res.status).toBe(404);
  });
});

describe('PUT /api/state-machines/:uuid', () => {
  afterEach(() => {
    jest.clearAllMocks();
    mockUserRole = 'admin';
  });

  it('returns 200 with the updated machine when valid', async () => {
    stateMachineService.update.mockResolvedValue({ ...SM_FIXTURE, description: 'Updated' });

    const res = await request(app)
      .put('/api/state-machines/sm-api-001')
      .send({ description: 'Updated' });

    expect(res.status).toBe(200);
    expect(res.body.data.description).toBe('Updated');
  });

  it('returns 404 when machine is not found', async () => {
    stateMachineService.update.mockResolvedValue(null);

    const res = await request(app)
      .put('/api/state-machines/nonexistent')
      .send({ description: 'x' });

    expect(res.status).toBe(404);
  });

  it('returns 403 when VIEWER tries to update a machine', async () => {
    mockUserRole = 'viewer';

    const res = await request(app)
      .put('/api/state-machines/sm-api-001')
      .send({ description: 'Updated' });

    expect(res.status).toBe(403);
    expect(stateMachineService.update).not.toHaveBeenCalled();
  });

  it('returns 400 when service returns validation errors (e.g. undeclared transition.from/to)', async () => {
    stateMachineService.update.mockResolvedValue({
      errors: [{ field: 'transitions[0].to', message: "Transition to 'UNDECLARED' is not a declared state" }],
    });

    const res = await request(app)
      .put('/api/state-machines/sm-api-001')
      .send({ transitions: [{ uuid: 'tr-bad', from: 'PENDING', to: 'UNDECLARED', on: 'ev' }] });

    expect(res.status).toBe(400);
    expect(res.body.errors.some((e: { field: string }) => e.field.includes('to'))).toBe(true);
  });
});

describe('DELETE /api/state-machines/:uuid', () => {
  afterEach(() => {
    jest.clearAllMocks();
    mockUserRole = 'admin';
  });

  it('returns 200 when machine is successfully deleted', async () => {
    stateMachineService.delete.mockResolvedValue(true);

    const res = await request(app).delete('/api/state-machines/sm-api-001');
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/deleted/i);
  });

  it('returns 404 when machine is not found', async () => {
    stateMachineService.delete.mockResolvedValue(false);

    const res = await request(app).delete('/api/state-machines/nonexistent');
    expect(res.status).toBe(404);
  });

  it('returns 403 when VIEWER tries to delete a state machine', async () => {
    mockUserRole = 'viewer';

    const res = await request(app).delete('/api/state-machines/sm-api-001');
    expect(res.status).toBe(403);
    expect(stateMachineService.delete).not.toHaveBeenCalled();
  });
});
