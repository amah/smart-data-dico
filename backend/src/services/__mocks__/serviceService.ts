import { AttributeType } from '../../models/EntitySchema.js';

// Mock service service matching actual ServiceService API
class ServiceServiceMock {
  async getAllServices(): Promise<string[]> {
    return ['user-service', 'product-service', 'order-service'];
  }

  async getServiceEntities(service: string) {
    const serviceEntities: Record<string, any[]> = {
      'user-service': [
        {
          id: 'User', uuid: 'a38d1597-cc4f-4934-bb08-c876c023f693',
          name: 'User', description: 'User entity',
          microservice: 'user-service', version: '1.0.0',
          attributes: [
            { uuid: 'b49e2608-dd5f-4045-aa09-d464c234e694', name: 'id', description: 'User ID', type: AttributeType.STRING, required: true },
            { uuid: 'c5af3719-ee6f-4156-bb1a-e575d345f7a5', name: 'email', description: 'User email', type: AttributeType.STRING, required: true },
          ],
        },
      ],
      'product-service': [],
      'order-service': [],
    };
    return serviceEntities[service] || [];
  }

  async getEntitySchema(service: string, entity: string) {
    if (service === 'user-service' && entity === 'User') {
      return {
        id: 'User', uuid: 'a38d1597-cc4f-4934-bb08-c876c023f693',
        name: 'User', description: 'User entity',
        microservice: 'user-service', version: '1.0.0',
        attributes: [
          { uuid: 'b49e2608-dd5f-4045-aa09-d464c234e694', name: 'id', description: 'User ID', type: AttributeType.STRING, required: true },
          { uuid: 'c5af3719-ee6f-4156-bb1a-e575d345f7a5', name: 'email', description: 'User email', type: AttributeType.STRING, required: true },
        ],
      };
    }
    return null;
  }

  async createEntity(entity: any) {
    return { success: true, errors: [] };
  }

  async updateEntity(entity: any) {
    return { success: true, errors: [] };
  }

  async deleteEntity(service: string, entityName: string) {
    return { success: true, errors: [] };
  }

  async searchEntities(query: string) {
    return [
      { entity: 'User', service: 'user-service', matches: ['name', 'description'] },
    ];
  }

  async getGraphData(service: string) {
    return {
      nodes: [
        { id: 'User', label: 'User', type: 'entity' },
        { id: 'Profile', label: 'Profile', type: 'entity' },
      ],
      edges: [
        { source: 'User', target: 'Profile', label: 'hasOne' },
      ],
    };
  }
}

export const serviceService = new ServiceServiceMock();
