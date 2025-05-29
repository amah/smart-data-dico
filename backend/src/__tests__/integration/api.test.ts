import { NextFunction, Request, Response } from 'express';
import request from 'supertest';

import { UserRole } from '../../middleware/auth';
import app from '../../server';

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

// Mock auth middleware
jest.mock('../../middleware/auth', () => ({
  UserRole: {
    ADMIN: 'admin',
    EDITOR: 'editor',
    VIEWER: 'viewer'
  },
  authenticate: jest.fn().mockImplementation((roles) => (req: Request, res: Response, next: NextFunction) => {
    // Mock authentication - always authenticate as admin for tests
    req.user = {
      id: 'test-user',
      role: UserRole.ADMIN
    };
    next();
  })
}));

// Mock services
jest.mock('../../services/dictionaryService');
jest.mock('../../services/entityService');
jest.mock('../../services/serviceService');
jest.mock('../../services/versionService');
jest.mock('../../utils/logger');

describe('API Integration Tests', () => {
  describe('Status Endpoint', () => {
    it('should return operational status', async () => {
      const response = await request(app).get('/api/status');
      
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('status', 'operational');
    });
  });

  describe('Dictionary Endpoints', () => {
    it('should get all dictionaries', async () => {
      const response = await request(app).get('/api/dictionaries');
      
      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
    });

    it('should get dictionary by ID', async () => {
      const response = await request(app).get('/api/dictionaries/user-service');
      
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('id', 'user-service');
    });

    it('should return 404 for non-existent dictionary', async () => {
      const response = await request(app).get('/api/dictionaries/non-existent');
      
      expect(response.status).toBe(404);
    });

    it('should get dictionary entries', async () => {
      const response = await request(app).get('/api/dictionaries/user-service/entries');
      
      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
it('should return hierarchical structure in dictionary response', async () => {
      // This test assumes the test environment is seeded with a hierarchical dictionary
      const response = await request(app).get('/api/dictionaries/analytics-service');
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('rootPackage');
      expect(response.body.rootPackage).toHaveProperty('subpackages');
      // Check for nested subpackages and entities
      expect(
        response.body.rootPackage.subpackages[0].subpackages[0].entities[0].name
      ).toBe('Event');
    });
    });
  });

  describe('Entity Endpoints', () => {
    it('should get entity attributes', async () => {
      const response = await request(app).get('/api/entities/user-service/User/attributes');
      
      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
    });

    it('should get related entities', async () => {
      const response = await request(app).get('/api/entities/user-service/User/related');
      
      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
    });

    it('should save entity', async () => {
      const entityData = {
        id: 'TestEntity',
        name: 'Test Entity',
        description: 'A test entity',
        microservice: 'test-service',
        version: '1.0.0',
        attributes: [
          {
            name: 'id',
            description: 'Entity ID',
            type: 'string',
            required: true
          }
        ]
      };

      const response = await request(app)
        .post('/api/entities')
        .send(entityData);
      
      expect(response.status).toBe(201);
    });
  });

  describe('Service Endpoints', () => {
    it('should get all services', async () => {
      const response = await request(app).get('/api/services');
      
      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
    });

    it('should get service entities', async () => {
      const response = await request(app).get('/api/services/user-service/entities');
      
      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
    });

    it('should get entity schema', async () => {
      const response = await request(app).get('/api/services/user-service/entities/User');
      
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('id', 'User');
    });

    it('should create entity', async () => {
      const entityData = {
        id: 'NewEntity',
        name: 'New Entity',
        description: 'A new test entity',
        microservice: 'user-service',
        version: '1.0.0',
        attributes: [
          {
            name: 'id',
            description: 'Entity ID',
            type: 'string',
            required: true
          }
        ]
      };

      const response = await request(app)
        .post('/api/services/user-service/entities')
        .send(entityData);
      
      expect(response.status).toBe(201);
    });

    it('should update entity', async () => {
      const entityData = {
        id: 'User',
        name: 'Updated User',
        description: 'Updated user entity',
        microservice: 'user-service',
        version: '1.0.1',
        attributes: [
          {
            name: 'id',
            description: 'User ID',
            type: 'string',
            required: true
          }
        ]
      };

      const response = await request(app)
        .put('/api/services/user-service/entities/User')
        .send(entityData);
      
      expect(response.status).toBe(200);
    });

    it('should delete entity', async () => {
      const response = await request(app).delete('/api/services/user-service/entities/User');
      
      expect(response.status).toBe(200);
    });
  });

  describe('Search Endpoint', () => {
    it('should search entities', async () => {
      const response = await request(app).get('/api/search?q=user');
      
      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
    });
  });

  describe('Graph Endpoint', () => {
    it('should get graph data', async () => {
      const response = await request(app).get('/api/graph/user-service');
      
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('nodes');
      expect(response.body).toHaveProperty('edges');
    });
  });

  describe('Version Control Endpoints', () => {
    it('should commit changes', async () => {
      const commitData = {
        message: 'Test commit',
        author: 'Test User'
      };

      const response = await request(app)
        .post('/api/commit')
        .send(commitData);
      
      expect(response.status).toBe(200);
    });

    it('should get commit history', async () => {
      const response = await request(app).get('/api/history');
      
      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
    });

    it('should revert to commit', async () => {
      const revertData = {
        commitId: 'test-commit-id'
      };

      const response = await request(app)
        .post('/api/revert')
        .send(revertData);
      
      expect(response.status).toBe(200);
    });
  });
});