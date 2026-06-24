import { Entity, AttributeType } from '../../models/EntitySchema.js';

const mockEntities: Record<string, Entity> = {
  'user-service.User': {
    uuid: 'a38d1597-cc4f-4934-bb08-c876c023f693',
    name: 'User',
    description: 'User entity',
    attributes: [
      { uuid: 'b49e2608-dd5f-4045-aa09-d464c234e694', name: 'id', description: 'User ID', type: AttributeType.STRING, required: true, primaryKey: true },
      { uuid: 'c5af3719-ee6f-4156-bb1a-e575d345f7a5', name: 'email', description: 'User email', type: AttributeType.STRING, required: true },
    ],
  } as Entity,
};

// Mock entity service matching actual EntityService API
class EntityServiceMock {
  validateEntity(_entity: Entity) {
    return { valid: true, errors: [] as string[] };
  }

  async validateRelationships(_packageName: string, _relationships: any[]) {
    return { valid: true, errors: [] as string[] };
  }

  async saveEntity(_entity: Entity, _packageName: string) {
    return { success: true, errors: [] as string[] };
  }

  async getEntity(packageName: string, entityName: string): Promise<Entity | null> {
    return mockEntities[`${packageName}.${entityName}`] || null;
  }

  async getRelatedEntities(_packageName: string, _entityName: string): Promise<Entity[]> {
    return [];
  }
}

export const entityService = new EntityServiceMock();
