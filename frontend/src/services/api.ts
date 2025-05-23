import axios from 'axios';
import { Entity, CommitInfo } from '../types';

// Create an axios instance with default config
const api = axios.create({
  baseURL: '/api',
  headers: {
    'Content-Type': 'application/json',
  },
});

// Add auth token to requests if available
api.interceptors.request.use((config) => {
  // For development/testing: use a mock token if no token is in localStorage
  const token = localStorage.getItem('auth_token') || 'mock-token-for-testing';
  
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  
  return config;
});

// Services API endpoints
export const servicesApi = {
  // Get all services (microservices)
  getAllServices: async () => {
    const response = await api.get('/services');
    return response.data;
  },

  // Get all entities for a specific service
  getServiceEntities: async (service: string) => {
    const response = await api.get(`/services/${service}/entities`);
    return response.data;
  },

  // Get entity schema by service and entity name
  getEntitySchema: async (service: string, entity: string) => {
    const response = await api.get(`/services/${service}/entities/${entity}`);
    return response.data;
  },

  // Create a new entity
  createEntity: async (service: string, entityData: Entity) => {
    const response = await api.post(`/services/${service}/entities`, entityData);
    return response.data;
  },

  // Update an existing entity
  updateEntity: async (service: string, entity: string, entityData: Entity) => {
    const response = await api.put(`/services/${service}/entities/${entity}`, entityData);
    return response.data;
  },

  // Delete an entity
  deleteEntity: async (service: string, entity: string) => {
    const response = await api.delete(`/services/${service}/entities/${entity}`);
    return response.data;
  },

  // Search for entities and attributes
  searchEntities: async (query: string) => {
    const response = await api.get(`/search?q=${encodeURIComponent(query)}`);
    return response.data;
  },

  // Get graph data for visualization
  getGraphData: async (service: string) => {
    const response = await api.get(`/graph/${service}`);
    return response.data;
  },
};

// Diagram layout API endpoints
export const diagramApi = {
  // Save diagram layout
  saveDiagramLayout: async (layout: any) => {
    const response = await api.post('/diagrams', layout);
    return response.data;
  },

  // Load diagram layout
  loadDiagramLayout: async (id: string) => {
    const response = await api.get(`/diagrams/${id}`);
    return response.data;
  },

  // Update diagram layout
  updateDiagramLayout: async (id: string, layout: any) => {
    const response = await api.put(`/diagrams/${id}`, layout);
    return response.data;
  },

  // Delete diagram layout
  deleteDiagramLayout: async (id: string) => {
    const response = await api.delete(`/diagrams/${id}`);
    return response.data;
  },

  // List diagram layouts
  listDiagramLayouts: async (service?: string) => {
    const params = service ? `?service=${encodeURIComponent(service)}` : '';
    const response = await api.get(`/diagrams${params}`);
    return response.data;
  },
};

// Dictionary API endpoints
export const dictionaryApi = {
  // Get all dictionaries
  getAllDictionaries: async () => {
    const response = await api.get('/dictionaries');
    return response.data;
  },

  // Get dictionary by ID
  getDictionaryById: async (id: string) => {
    const response = await api.get(`/dictionaries/${id}`);
    return response.data;
  },

  // Create new dictionary
  createDictionary: async (dictionaryData: any) => {
    const response = await api.post('/dictionaries', dictionaryData);
    return response.data;
  },

  // Update dictionary
  updateDictionary: async (id: string, dictionaryData: any) => {
    const response = await api.put(`/dictionaries/${id}`, dictionaryData);
    return response.data;
  },

  // Delete dictionary
  deleteDictionary: async (id: string) => {
    const response = await api.delete(`/dictionaries/${id}`);
    return response.data;
  },

  // Get dictionary entries
  getDictionaryEntries: async (id: string) => {
    const response = await api.get(`/dictionaries/${id}/entries`);
    return response.data;
  },

  // Get entity attributes
  getEntityAttributes: async (microservice: string, entityName: string) => {
    const response = await api.get(`/dictionaries/${microservice}/${entityName}/attributes`);
    return response.data;
  },

  // Save entity
  saveEntity: async (entity: Entity) => {
    const response = await api.post('/dictionaries/entity', entity);
    return response.data;
  },

  // Get related entities
  getRelatedEntities: async (microservice: string, entityName: string) => {
    const response = await api.get(`/dictionaries/${microservice}/${entityName}/related`);
    return response.data;
  },
};

// Version control API endpoints
export const versionApi = {
  // Commit changes
  commitChanges: async (message: string) => {
    const response = await api.post('/commit', { message });
    return response.data;
  },

  // Get commit history
  getCommitHistory: async (limit: number = 10) => {
    const response = await api.get(`/history?limit=${limit}`);
    return response.data;
  },

  // Revert to commit
  revertToCommit: async (commitHash: string) => {
    const response = await api.post('/revert', { commitHash });
    return response.data;
  },
};

// Auth API endpoints
export const authApi = {
  // Login
  login: async (username: string, password: string) => {
    const response = await api.post('/auth/login', { username, password });
    if (response.data.token) {
      localStorage.setItem('auth_token', response.data.token);
    }
    return response.data;
  },

  // Logout
  logout: () => {
    localStorage.removeItem('auth_token');
  },

  // Get current user
  getCurrentUser: async () => {
    const response = await api.get('/auth/me');
    return response.data;
  },

  // Check if user is authenticated
  isAuthenticated: () => {
    return !!localStorage.getItem('auth_token');
  },
};

export default api;