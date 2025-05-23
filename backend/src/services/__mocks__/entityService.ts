import { Entity, AttributeType } from '../../models/EntitySchema';
import { readEntityFile } from '../../utils/fileOperations';

// Mock entity service
class EntityServiceMock {
  async getEntity(microservice: string, entityName: string): Promise<Entity | null> {
    return readEntityFile(microservice, entityName);
  }

  async createEntity(entity: Entity): Promise<boolean> {
    return true;
  }

  async updateEntity(entity: Entity): Promise<boolean> {
    return true;
  }

  async deleteEntity(microservice: string, entityName: string): Promise<boolean> {
    return true;
  }

  async getAllEntities(): Promise<Entity[]> {
    return [
      {
        id: 'User',
        name: 'User',
        description: 'User entity',
        microservice: 'user-service',
        version: '1.0.0',
        attributes: [
          {
            name: 'id',
            description: 'User ID',
            type: AttributeType.STRING,
            required: true
          },
          {
            name: 'email',
            description: 'User email',
            type: AttributeType.STRING,
            format: 'email',
            required: true
          }
        ]
      },
      {
        id: 'Product',
        name: 'Product',
        description: 'Product entity',
        microservice: 'product-service',
        version: '1.0.0',
        attributes: [
          {
            name: 'id',
            description: 'Product ID',
            type: AttributeType.STRING,
            required: true
          },
          {
            name: 'name',
            description: 'Product name',
            type: AttributeType.STRING,
            required: true
          },
          {
            name: 'price',
            description: 'Product price',
            type: AttributeType.NUMBER,
            required: true
          }
        ]
      }
    ];
  }
}

export const entityService = new EntityServiceMock();