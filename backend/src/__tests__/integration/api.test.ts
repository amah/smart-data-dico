import { NextFunction, Request, Response } from 'express';
import request from 'supertest';

import app from '../../server.js';

// Extend Request type to include user property
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
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
          uuid: 'a38d1597-cc4f-4934-bb08-c876c023f693',
          name: 'NewEntity',
          description: 'A new entity',
          attributes: [{ uuid: 'b49e2608-dd5f-4045-aa09-d464c234e694', name: 'id', description: 'ID', type: 'string', required: true }],
        });
      expect(response.status).toBe(201);
    });

    it('PUT /api/services/:service/entities/:entity should update entity', async () => {
      const response = await request(app)
        .put('/api/services/user-service/entities/User')
        .send({
          uuid: 'a38d1597-cc4f-4934-bb08-c876c023f693',
          name: 'User',
          description: 'Updated user',
          attributes: [{ uuid: 'b49e2608-dd5f-4045-aa09-d464c234e694', name: 'id', description: 'ID', type: 'string', required: true }],
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

  describe('Publish (revert)', () => {
    it('POST /api/revert should revert to commit', async () => {
      const response = await request(app)
        .post('/api/revert')
        .send({ commitHash: 'mock-commit-1' });
      expect(response.status).toBe(200);
    });
  });

  describe('Relationship Endpoints', () => {
    it('GET /api/packages/:packageName/relationships should return relationships', async () => {
      const response = await request(app).get('/api/packages/user-service/relationships');
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('data');
    });
  });
});

describe('Route ordering after split', () => {
  it('GET /api/entities/flat resolves to getFlatEntitiesAndAttributes (search.routes.ts), not any :param shape', async () => {
    const response = await request(app).get('/api/entities/flat');
    expect(response.status).not.toBe(404);
  });

  it('GET /api/packages/all resolves to listAllPackagesAndEntities (package.routes.ts), not /:rootPackage/path/*', async () => {
    const response = await request(app).get('/api/packages/all');
    expect(response.status).not.toBe(404);
  });

  it('GET /api/packages/hierarchy/X resolves to getPackageHierarchy, not shadowed by /:rootPackage/path/*', async () => {
    const response = await request(app).get('/api/packages/hierarchy/X');
    expect(response.status).not.toBe(404);
  });

  it('GET /api/config/types resolves to getDerivedTypes (dico-config.routes.ts)', async () => {
    const response = await request(app).get('/api/config/types');
    expect(response.status).not.toBe(404);
  });

  it('GET /api/perspectives/foo responds with 308 redirect to /api/cases/foo', async () => {
    const response = await request(app).get('/api/perspectives/foo').redirects(0);
    expect(response.status).toBe(308);
    expect(response.headers.location).toBe('/api/cases/foo');
  });
});
