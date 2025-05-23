import { AttributeType } from '../../models/EntitySchema';

// Mock service service
class ServiceServiceMock {
  async getAllServices() {
    return [
      { id: 'user-service', name: 'User Service', entityCount: 2 },
      { id: 'product-service', name: 'Product Service', entityCount: 1 },
      { id: 'order-service', name: 'Order Service', entityCount: 2 }
    ];
  }

  async getServiceEntities(service: string) {
    const serviceEntities: Record<string, Array<{ id: string; name: string; description: string }>> = {
      'user-service': [
        { id: 'User', name: 'User', description: 'User entity' },
        { id: 'Profile', name: 'Profile', description: 'User profile entity' }
      ],
      'product-service': [
        { id: 'Product', name: 'Product', description: 'Product entity' }
      ],
      'order-service': [
        { id: 'Order', name: 'Order', description: 'Order entity' },
        { id: 'OrderItem', name: 'OrderItem', description: 'Order item entity' }
      ]
    };

    return serviceEntities[service] || [];
  }

  async getEntitySchema(service: string, entity: string) {
    if (service === 'user-service' && entity === 'User') {
      return {
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
      };
    }
    return null;
  }

  async createEntity(service: string, entity: any) {
    return true;
  }

  async updateEntity(service: string, entityName: string, entity: any) {
    return true;
  }

  async deleteEntity(service: string, entity: string) {
    return true;
  }

  async searchEntities(query: string) {
    return [
      {
        entity: 'User',
        service: 'user-service',
        matches: ['name', 'description']
      }
    ];
  }

  async getGraphData(service: string) {
    return {
      nodes: [
        { id: 'User', label: 'User', type: 'entity' },
        { id: 'Profile', label: 'Profile', type: 'entity' }
      ],
      edges: [
        { source: 'User', target: 'Profile', label: 'hasOne' }
      ]
    };
  }
}

export const serviceService = new ServiceServiceMock();