// Mock implementation of file operations for testing
import { Entity, AttributeType } from '../../models/EntitySchema.js';

// Mock data
const mockMicroservices = ['user-service', 'product-service', 'order-service'];

const mockEntities: Record<string, string[]> = {
  'user-service': ['User', 'Profile'],
  'product-service': ['Product'],
  'order-service': ['Order', 'OrderItem']
};

const mockEntityData: Record<string, Entity> = {
  'user-service.User': {
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
  'product-service.Product': {
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
};

// Mock functions
export const listMicroservices = jest.fn().mockImplementation(async () => {
  return Promise.resolve(mockMicroservices);
});

export const listMicroserviceEntities = jest.fn().mockImplementation(async (microservice: string) => {
  return Promise.resolve(mockEntities[microservice] || []);
});

export const listAllEntities = jest.fn().mockImplementation(async () => {
  const allEntities: { microservice: string; entity: string }[] = [];
  
  for (const microservice of mockMicroservices) {
    for (const entity of mockEntities[microservice] || []) {
      allEntities.push({ microservice, entity });
    }
  }
  
  return Promise.resolve(allEntities);
});

export const readEntityFile = jest.fn().mockImplementation(async (microservice: string, entity: string) => {
  const key = `${microservice}.${entity}`;
  return Promise.resolve(mockEntityData[key] || null);
});

export const writeEntityFile = jest.fn().mockImplementation(async (entity: Entity) => {
  const key = `${entity.microservice}.${entity.id}`;
  mockEntityData[key] = entity;
  return Promise.resolve(true);
});

export const deleteEntityFile = jest.fn().mockImplementation(async (microservice: string, entity: string) => {
  const key = `${microservice}.${entity}`;
  if (mockEntityData[key]) {
    delete mockEntityData[key];
    return Promise.resolve(true);
  }
  return Promise.resolve(false);
});

export const createDirectory = jest.fn().mockImplementation(async (path: string) => {
  return Promise.resolve(true);
});

export const ensureDirectoryStructure = jest.fn().mockResolvedValue(undefined);

export const listAllDictionaries = jest.fn().mockResolvedValue([]);

export const writeDictionaryMetadata = jest.fn().mockResolvedValue(undefined);

export const commitChanges = jest.fn().mockResolvedValue({ success: true });