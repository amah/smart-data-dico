import { Entity, AttributeType } from '../../models/EntitySchema.js';

const mockEntities: Record<string, Entity> = {
  'user-service.User': {
    id: 'User',
    uuid: 'a38d1597-cc4f-4934-bb08-c876c023f693',
    name: 'User',
    description: 'User entity',
    microservice: 'user-service',
    version: '1.0.0',
    attributes: [
      { uuid: 'b49e2608-dd5f-4045-aa09-d464c234e694', name: 'id', description: 'User ID', type: AttributeType.STRING, required: true },
      { uuid: 'c5af3719-ee6f-4156-bb1a-e575d345f7a5', name: 'email', description: 'User email', type: AttributeType.STRING, required: true },
    ],
  } as Entity,
};

// Mock entity service matching actual EntityService API
class EntityServiceMock {
  validateEntity(entity: Entity) {
    return { valid: true, errors: [] as string[] };
  }

  async validateRelationships(entity: Entity) {
    return { valid: true, errors: [] as string[] };
  }

  async saveEntity(entity: Entity) {
    return { success: true, errors: [] as string[] };
  }

  async getEntity(microservice: string, entityName: string): Promise<Entity | null> {
    return mockEntities[`${microservice}.${entityName}`] || null;
  }

  async getRelatedEntities(microservice: string, entityName: string): Promise<Entity[]> {
    return [];
  }
}

export const entityService = new EntityServiceMock();
