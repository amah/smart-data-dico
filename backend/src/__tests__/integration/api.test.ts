import { NextFunction, Request, Response } from 'express';
import request from 'supertest';

import { UserRole } from '../../middleware/auth.js';
import app from '../../server.js';

// Extend Request type to include user property
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        role: string;
      };
    }
  }
}

// Mock auth middleware to bypass authentication
jest.mock('../../middleware/auth', () => ({
  UserRole: {
    ADMIN: 'admin',
    EDITOR: 'editor',
    VIEWER: 'viewer',
  },
  authenticate: jest.fn().mockImplementation((_roles: string[]) => (req: Request, _res: Response, next: NextFunction) => {
    req.user = { id: 'test-user', role: 'admin' };
    next();
  }),
}));

// Mock JWT auth to bypass token verification
jest.mock('../../middleware/jwtAuth', () => ({
  verifyToken: jest.fn().mockImplementation((req: Request, _res: Response, next: NextFunction) => {
    req.user = { id: 'test-user', role: 'admin' };
    next();
  }),
  authorizeJwt: jest.fn().mockImplementation((_roles: string[]) => (req: Request, _res: Response, next: NextFunction) => {
    req.user = { id: 'test-user', role: 'admin' };
    next();
  }),
}));

// Mock services (uses __mocks__ directory auto-mocks)
jest.mock('../../services/dictionaryService');
jest.mock('../../services/entityService');
jest.mock('../../services/serviceService');
jest.mock('../../services/versionService');
jest.mock('../../utils/logger');

describe('API Integration Tests', () => {
  describe('Health & Status', () => {
    it('should return health status', async () => {
      const response = await request(app).get('/health');
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('status', 'ok');
    });
  });

  describe('Service Endpoints', () => {
    it('GET /api/services should return service list', async () => {
      const response = await request(app).get('/api/services');
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('data');
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.data).toContain('user-service');
    });

    it('GET /api/services/:service/entities should return entities', async () => {
      const response = await request(app).get('/api/services/user-service/entities');
      expect(response.status).toBe(200);
    });

    it('GET /api/services/:service/entities/:entity should return entity schema', async () => {
      const response = await request(app).get('/api/services/user-service/entities/User');
      expect(response.status).toBe(200);
    });

    it('POST /api/services/:service/entities should create entity', async () => {
      const response = await request(app)
        .post('/api/services/user-service/entities')
        .send({
          name: 'NewEntity',
          description: 'A new entity',
          microservice: 'user-service',
          version: '1.0.0',
          attributes: [{ name: 'id', description: 'ID', type: 'string', required: true }],
        });
      expect(response.status).toBe(201);
    });

    it('PUT /api/services/:service/entities/:entity should update entity', async () => {
      const response = await request(app)
        .put('/api/services/user-service/entities/User')
        .send({
          name: 'User',
          description: 'Updated user',
          microservice: 'user-service',
          version: '1.0.1',
          attributes: [{ name: 'id', description: 'ID', type: 'string', required: true }],
        });
      expect(response.status).toBe(200);
    });

    it('DELETE /api/services/:service/entities/:entity should delete entity', async () => {
      const response = await request(app).delete('/api/services/user-service/entities/User');
      expect(response.status).toBe(200);
    });
  });

  describe('Search & Graph', () => {
    it('GET /api/search should return results', async () => {
      const response = await request(app).get('/api/search?q=user');
      expect(response.status).toBe(200);
    });

    it('GET /api/graph/:service should return graph data', async () => {
      const response = await request(app).get('/api/graph/user-service');
      expect(response.status).toBe(200);
    });
  });

  describe('Version Control', () => {
    it('POST /api/commit should commit changes', async () => {
      const response = await request(app)
        .post('/api/commit')
        .send({ message: 'Test commit' });
      expect(response.status).toBe(200);
    });

    it('GET /api/history should return commit history', async () => {
      const response = await request(app).get('/api/history');
      expect(response.status).toBe(200);
    });

    it('POST /api/revert should revert to commit', async () => {
      const response = await request(app)
        .post('/api/revert')
        .send({ commitHash: 'mock-commit-1' });
      expect(response.status).toBe(200);
    });
  });
});
