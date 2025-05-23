import '@testing-library/jest-dom';
import { afterEach, beforeAll, afterAll, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';

// Add type definitions
type Params = {
  [key: string]: string;
};

interface RequestInfo {
  request: Request;
  params: Params;
}

// Mock data for API responses
const mockDictionaries = [
  { id: 'user-service', name: 'User Service', entityCount: 2 },
  { id: 'product-service', name: 'Product Service', entityCount: 1 },
  { id: 'order-service', name: 'Order Service', entityCount: 2 }
];

const mockEntities = {
  'user-service': [
    { id: 'User', name: 'User', description: 'User entity' },
    { id: 'Profile', name: 'Profile', description: 'User profile entity' }
  ],
  'product-service': [
    { id: 'Product', name: 'Product', description: 'Product entity' }
  ]
};

// Setup MSW server for API mocking
export const server = setupServer(
  // Dictionary endpoints
  http.get('/api/dictionaries', () => {
    return HttpResponse.json(mockDictionaries);
  }),
  
  http.get('/api/dictionaries/:id', ({ params }: RequestInfo) => {
    const { id } = params;
    const dictionary = mockDictionaries.find(d => d.id === id);
    
    if (dictionary) {
      return HttpResponse.json(dictionary);
    }
    
    return new HttpResponse(null, { status: 404 });
  }),
  
  // Service endpoints
  http.get('/api/services', () => {
    return HttpResponse.json(mockDictionaries);
  }),
  
  http.get('/api/services/:service/entities', ({ params }: RequestInfo) => {
    const { service } = params;
    const entities = mockEntities[service as keyof typeof mockEntities] || [];
    
    return HttpResponse.json(entities);
  }),
  
  // Entity endpoints
  http.get('/api/services/:service/entities/:entity', ({ params }: RequestInfo) => {
    const { service, entity } = params;
    const entities = mockEntities[service as keyof typeof mockEntities] || [];
    const foundEntity = entities.find(e => e.id === entity);
    
    if (foundEntity) {
      return HttpResponse.json({
        ...foundEntity,
        microservice: service,
        version: '1.0.0',
        attributes: [
          {
            name: 'id',
            description: 'Entity ID',
            type: 'string',
            required: true
          }
        ]
      });
    }
    
    return new HttpResponse(null, { status: 404 });
  }),
  
  // Search endpoint
  http.get('/api/search', ({ request }: RequestInfo) => {
    const url = new URL(request.url);
    const query = url.searchParams.get('q') || '';
    
    const results = query ? [
      {
        entity: 'User',
        service: 'user-service',
        matches: ['name', 'description']
      }
    ] : [];
    
    return HttpResponse.json(results);
  })
);

// Start server before all tests
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));

// Clean up after each test
afterEach(() => {
  cleanup();
  server.resetHandlers();
});

// Close server after all tests
afterAll(() => server.close());

// Mock window.matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// Mock IntersectionObserver
class MockIntersectionObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}

Object.defineProperty(window, 'IntersectionObserver', {
  writable: true,
  value: MockIntersectionObserver,
});