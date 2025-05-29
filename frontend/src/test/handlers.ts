import { http, HttpResponse } from 'msw';
import { AttributeType } from '../types';

// Mock data for entity hierarchy
export const mockEntityHierarchy = {
  entity: {
    uuid: '1',
    id: 'Order',
    name: 'Order',
    description: 'Order entity',
    microservice: 'order-service',
    version: '1.0.0',
    attributes: [
      {
        uuid: 'attr1',
        name: 'id',
        description: 'Order ID',
        type: AttributeType.STRING,
        required: true
      },
      {
        uuid: 'attr2',
        name: 'total',
        description: 'Order total',
        type: AttributeType.NUMBER,
        required: true
      }
    ]
  },
  children: [
    {
      entity: {
        uuid: '2',
        id: 'OrderItem',
        name: 'OrderItem',
        description: 'Order item entity',
        microservice: 'order-service',
        version: '1.0.0',
        attributes: [
          {
            uuid: 'attr3',
            name: 'id',
            description: 'Order item ID',
            type: AttributeType.STRING,
            required: true
          },
          {
            uuid: 'attr4',
            name: 'quantity',
            description: 'Item quantity',
            type: AttributeType.INTEGER,
            required: true
          }
        ]
      }
    }
  ]
};

// Define handlers for MSW
export const handlers = [
  // Entity hierarchy endpoint
  http.get('/api/entities/hierarchy/:microservice/:entityName', ({ params }) => {
    const { microservice, entityName } = params;
    
    // Return mock data for order-service/Order
    if (microservice === 'order-service' && entityName === 'Order') {
      return HttpResponse.json({
        message: 'Success',
        data: mockEntityHierarchy
      });
    }
    
    // Return 404 for other entities
    return new HttpResponse(null, { status: 404 });
  }),
  
  // Add more handlers as needed for other API endpoints
];