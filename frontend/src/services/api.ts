import axios from 'axios';

import { Entity, Relationship, Stereotype, StereotypeTarget, Case, ResolvedCase, CaseNode, GraphData, ImpactAnalysis, ReviewComment, LineageResult, Rule, RuleScope, RuleSeverityValue, RuleEnforcement, MetadataEntry } from '../types';
import { Package } from '../types';

/**
 * Fetch all package hierarchies dynamically.
 */
export const getAllPackageHierarchies = async (): Promise<Package[]> => {
  const response = await api.get('/packages/all');
  return response.data.data;
};

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

  // Lineage
  getLineage: async (uuid: string): Promise<LineageResult> => {
    const response = await api.get(`/entities/${uuid}/lineage`);
    return response.data.data;
  },

  // Impact analysis
  getImpactAnalysis: async (uuid: string): Promise<ImpactAnalysis> => {
    const response = await api.get(`/entities/${uuid}/impact`);
    return response.data.data;
  },

  // Review workflow
  submitEntity: async (service: string, entity: string) => {
    const response = await api.post(`/services/${service}/entities/${entity}/submit`);
    return response.data;
  },
  approveEntity: async (service: string, entity: string) => {
    const response = await api.post(`/services/${service}/entities/${entity}/approve`);
    return response.data;
  },
  returnEntity: async (service: string, entity: string, comment?: string, author?: string) => {
    const response = await api.post(`/services/${service}/entities/${entity}/return`, { comment, author });
    return response.data;
  },
  getComments: async (service: string, entity: string): Promise<ReviewComment[]> => {
    const response = await api.get(`/services/${service}/entities/${entity}/comments`);
    return response.data.data;
  },
  addComment: async (service: string, entity: string, data: { author: string; message: string; targetField?: string }) => {
    const response = await api.post(`/services/${service}/entities/${entity}/comments`, data);
    return response.data;
  },
  resolveComment: async (service: string, entity: string, commentId: string) => {
    const response = await api.put(`/services/${service}/entities/${entity}/comments/${commentId}`);
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

// Relationship API endpoints
export const relationshipApi = {
  getPackageRelationships: async (packageName: string): Promise<Relationship[]> => {
    const response = await api.get(`/packages/${encodeURIComponent(packageName)}/relationships`);
    return response.data.data;
  },

  createRelationship: async (packageName: string, relationship: Relationship) => {
    const response = await api.post(`/packages/${encodeURIComponent(packageName)}/relationships`, relationship);
    return response.data;
  },

  updateRelationship: async (packageName: string, uuid: string, relationship: Relationship) => {
    const response = await api.put(`/packages/${encodeURIComponent(packageName)}/relationships/${uuid}`, relationship);
    return response.data;
  },

  deleteRelationship: async (packageName: string, uuid: string) => {
    const response = await api.delete(`/packages/${encodeURIComponent(packageName)}/relationships/${uuid}`);
    return response.data;
  },
};

/**
 * Entity/Package API endpoints for navigation, flat, and hierarchical views
 */
export const entityApi = {
  // Get all packages and their entities
  getAllPackages: async (): Promise<Package[]> => {
    const response = await api.get('/packages/all');
    return response.data.data; // Unwrap the data from the API response
  },

  // Get flat list of entities/attributes with optional filters
  getFlatEntities: async (params?: { name?: string; type?: string; package?: string }): Promise<Entity[]> => {
    const query = new URLSearchParams();
    if (params?.name) query.append('name', params.name);
    if (params?.type) query.append('type', params.type);
    if (params?.package) query.append('package', params.package);
    const response = await api.get(`/entities/flat${query.toString() ? '?' + query.toString() : ''}`);
    return response.data.data; // Unwrap the data from the API response
  },

  // Get hierarchical view for a given aggregate root/entity
  getEntityHierarchy: async (microservice: string, entityName: string): Promise<any> => {
    const response = await api.get(`/entities/hierarchy/${encodeURIComponent(microservice)}/${encodeURIComponent(entityName)}`);
    return response.data.data; // Unwrap the data from the API response
  },
};

// Diff API (#86)
// Project management (#95)
export const filesystemApi = {
  browse: async (dirPath?: string) => {
    const params = dirPath ? `?path=${encodeURIComponent(dirPath)}` : '';
    const response = await api.get(`/filesystem/browse${params}`);
    return response.data.data as {
      path: string;
      parent: string;
      directories: string[];
      hasDataDictionaries: boolean;
    };
  },
};

export const projectApi = {
  get: async () => {
    const response = await api.get('/project');
    return response.data.data;
  },
  status: async (): Promise<{ clean: boolean; files: string[] }> => {
    const response = await api.get('/project/status');
    return response.data.data;
  },
  open: async (dirPath: string) => {
    const response = await api.post('/project/open', { path: dirPath });
    return response.data;
  },
  close: async () => {
    const response = await api.post('/project/close');
    return response.data;
  },
  init: async (dirPath: string) => {
    const response = await api.post('/project/init', { path: dirPath });
    return response.data;
  },
};

// Model-level metadata (#94)
export const modelApi = {
  getMetadata: async () => {
    const response = await api.get('/model/metadata');
    return response.data.data;
  },
  putMetadata: async (metadata: any[]) => {
    const response = await api.put('/model/metadata', { metadata });
    return response.data.data;
  },
};

// Git API (uses @hamak/app-framework routes at /api/git/dictionaries)
export const gitApi = {
  getStatus: async () => {
    const response = await api.get('/git/dictionaries/status/.');
    return response.data;
  },
  getBranches: async () => {
    const response = await api.get('/git/dictionaries/branches/.');
    return response.data;
  },
  checkout: async (branch: string, create?: boolean) => {
    const response = await api.post('/git/dictionaries/checkout/.', { branch, create });
    return response.data;
  },
  createBranch: async (branch: string) => {
    const response = await api.post('/git/dictionaries/branch/.', { branch });
    return response.data;
  },
  commit: async (message: string) => {
    const response = await api.post('/git/dictionaries/commit/.', { message });
    return response.data;
  },
  pull: async (remote?: string) => {
    const response = await api.post('/git/dictionaries/pull/.', { remote });
    return response.data;
  },
  push: async (remote?: string) => {
    const response = await api.post('/git/dictionaries/push/.', { remote });
    return response.data;
  },
  fetch: async (remote?: string) => {
    const response = await api.post('/git/dictionaries/fetch/.', { remote });
    return response.data;
  },
  getDiff: async (file?: string) => {
    const response = await api.get('/git/dictionaries/diff/.', { params: file ? { file } : {} });
    return response.data;
  },
};

// Case API endpoints (#121)
export const caseApi = {
  getAll: async (): Promise<Case[]> => {
    const response = await api.get('/cases');
    return response.data.data;
  },
  getById: async (id: string): Promise<Case> => {
    const response = await api.get(`/cases/${id}`);
    return response.data.data;
  },
  create: async (data: Partial<Case>) => {
    const response = await api.post('/cases', data);
    return response.data;
  },
  update: async (id: string, data: Partial<Case>) => {
    const response = await api.put(`/cases/${id}`, data);
    return response.data;
  },
  delete: async (id: string) => {
    const response = await api.delete(`/cases/${id}`);
    return response.data;
  },
  resolve: async (id: string): Promise<ResolvedCase> => {
    const response = await api.get(`/cases/${id}/resolve`);
    return response.data.data;
  },
  getGraphData: async (id: string): Promise<GraphData> => {
    const response = await api.get(`/cases/${id}/graph`);
    return response.data.data;
  },
  upsertNode: async (id: string, node: CaseNode) => {
    const response = await api.put(`/cases/${id}/nodes`, node);
    return response.data;
  },
};

// Model-level metadata API (#94)
export interface ModelMetadataDoc {
  stereotype?: string;
  metadata: MetadataEntry[];
}

export const modelMetadataApi = {
  get: async (): Promise<ModelMetadataDoc> => {
    const response = await api.get('/model/metadata');
    return response.data.data;
  },

  put: async (doc: ModelMetadataDoc): Promise<ModelMetadataDoc> => {
    const response = await api.put('/model/metadata', doc);
    return response.data.data;
  },
};

// Stereotype API endpoints
export const stereotypeApi = {
  getAll: async (appliesTo?: StereotypeTarget): Promise<Stereotype[]> => {
    const params = appliesTo ? `?appliesTo=${appliesTo}` : '';
    const response = await api.get(`/stereotypes${params}`);
    return response.data.data;
  },

  getById: async (id: string): Promise<Stereotype> => {
    const response = await api.get(`/stereotypes/${id}`);
    return response.data.data;
  },

  create: async (data: Stereotype) => {
    const response = await api.post('/stereotypes', data);
    return response.data;
  },

  update: async (id: string, data: Partial<Stereotype>) => {
    const response = await api.put(`/stereotypes/${id}`, data);
    return response.data;
  },

  delete: async (id: string) => {
    const response = await api.delete(`/stereotypes/${id}`);
    return response.data;
  },
};

// Rule API endpoints (#74)
export const ruleApi = {
  list: async (filters: {
    scope?: RuleScope;
    severity?: RuleSeverityValue;
    enforcement?: RuleEnforcement;
    targetUuid?: string;
    case?: string;
    package?: string;
  } = {}): Promise<Rule[]> => {
    const params = new URLSearchParams();
    if (filters.scope) params.set('scope', filters.scope);
    if (filters.severity) params.set('severity', filters.severity);
    if (filters.enforcement) params.set('enforcement', filters.enforcement);
    if (filters.targetUuid) params.set('targetUuid', filters.targetUuid);
    if (filters.case) params.set('case', filters.case);
    if (filters.package) params.set('package', filters.package);
    const qs = params.toString();
    const response = await api.get(`/rules${qs ? '?' + qs : ''}`);
    return response.data.data;
  },

  get: async (uuid: string): Promise<Rule> => {
    const response = await api.get(`/rules/${uuid}`);
    return response.data.data;
  },

  getRulesForEntity: async (entityUuid: string): Promise<Rule[]> => {
    const response = await api.get(`/entities/${entityUuid}/rules`);
    return response.data.data;
  },

  create: async (rule: Partial<Rule>): Promise<Rule> => {
    const response = await api.post('/rules', rule);
    return response.data.data;
  },

  update: async (uuid: string, rule: Partial<Rule>): Promise<Rule> => {
    const response = await api.put(`/rules/${uuid}`, rule);
    return response.data.data;
  },

  delete: async (uuid: string): Promise<void> => {
    await api.delete(`/rules/${uuid}`);
  },
};

// Package CRUD API endpoints
export const packageApi = {
  createPackage: async (data: { name: string; description?: string; type?: string; metadata?: any[] }) => {
    const response = await api.post('/packages', data);
    return response.data;
  },

  createSubPackage: async (rootPackage: string, path: string[], data: Partial<Package>) => {
    const pathStr = path.join('/');
    const url = pathStr ? `/packages/${encodeURIComponent(rootPackage)}/subpackages/${pathStr}` : `/packages/${encodeURIComponent(rootPackage)}/subpackages/`;
    const response = await api.post(url, data);
    return response.data;
  },

  updatePackage: async (rootPackage: string, path: string[], data: Partial<Package>) => {
    const pathStr = path.join('/');
    const url = pathStr ? `/packages/${encodeURIComponent(rootPackage)}/path/${pathStr}` : `/packages/${encodeURIComponent(rootPackage)}/path/`;
    const response = await api.put(url, data);
    return response.data;
  },

  deletePackage: async (rootPackage: string, path: string[], force = false) => {
    const pathStr = path.join('/');
    const forceParam = force ? '?force=true' : '';
    const url = pathStr
      ? `/packages/${encodeURIComponent(rootPackage)}/path/${pathStr}${forceParam}`
      : `/packages/${encodeURIComponent(rootPackage)}/path/${forceParam}`;
    const response = await api.delete(url);
    return response.data;
  },

  getPackageByPath: async (rootPackage: string, path: string[]): Promise<Package> => {
    const pathStr = path.join('/');
    const url = pathStr
      ? `/packages/${encodeURIComponent(rootPackage)}/path/${pathStr}`
      : `/packages/hierarchy/${encodeURIComponent(rootPackage)}`;
    const response = await api.get(url);
    return response.data.data;
  },
};

// Project-level config (#107) — currently just the derived-types array
// under `dico.config.json.types[]`.
export interface DerivedType {
  name: string;
  basedOn: string;
  description?: string;
  validation?: {
    minLength?: number;
    maxLength?: number;
    pattern?: string;
    format?: string;
    minimum?: number;
    maximum?: number;
    precision?: number;
    scale?: number;
    enumValues?: string[];
  };
}

export const configApi = {
  getDerivedTypes: async (): Promise<DerivedType[]> => {
    const response = await api.get('/config/types');
    return response.data.data || [];
  },
  putDerivedTypes: async (types: DerivedType[]): Promise<DerivedType[]> => {
    const response = await api.put('/config/types', types);
    return response.data.data || types;
  },
};

export default api;