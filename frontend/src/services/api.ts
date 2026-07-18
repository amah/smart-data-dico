import axios from 'axios';

import { Entity, Relationship, Stereotype, StereotypeTarget, ImpactAnalysis, ReviewComment, LineageResult, MetadataEntry, Action, StateMachine, Event } from '../types';
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

export interface SearchIndexHealth {
  ready: boolean;
  documentCount: number;
  countsByKind: Record<string, number>;
  indexedRootPackages: number;
  lastBuildAt: string | null;
  lastBuildError: string | null;
  nodeVersion: string;
}

export const searchApi = {
  getStatus: async (): Promise<SearchIndexHealth> => {
    // Health is live process state; bypass ETag/304 caching so every poll has a
    // complete payload (Axios treats a bare 304 as a rejected response).
    const response = await api.get('/search/status', { params: { _: Date.now() } });
    return response.data.data;
  },
};

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

  // Get all entities for a specific service. Hidden entities (RE waste etc.) are
  // excluded by default; pass includeHidden to surface them ("Show hidden").
  getServiceEntities: async (service: string, includeHidden = false) => {
    const response = await api.get(`/services/${service}/entities`, includeHidden ? { params: { includeHidden: true } } : undefined);
    return response.data;
  },

  // Hide or unhide an entity (non-destructive; sets reserved system.hidden metadata).
  // Encodes service + entity so nested package paths (e.g. order-service/archive) route.
  setEntityHidden: async (service: string, entity: string, hidden: boolean, reason?: string) => {
    const response = await api.put(`/services/${encodeURIComponent(service)}/entities/${encodeURIComponent(entity)}/hidden`, { hidden, reason });
    return response.data;
  },

  // Set or clear an entity's explicit Element Style (non-destructive; sets reserved
  // system.style metadata). Pass a style name to set, or null/'default' to clear
  // (falls back to rules/role detection). Used by the diagram format painter.
  setEntityStyle: async (service: string, entity: string, style: string | null) => {
    const response = await api.put(`/services/${encodeURIComponent(service)}/entities/${encodeURIComponent(entity)}/style`, { style });
    return response.data;
  },

  // Move an entity to another package (#move-entity). The UUID is preserved, so
  // relationships/cases/diagrams that reference it keep resolving. Fails if the
  // target doesn't exist or already has an entity with the same name.
  moveEntity: async (service: string, entity: string, targetPackage: string) => {
    const response = await api.put(`/services/${encodeURIComponent(service)}/entities/${encodeURIComponent(entity)}/move`, { targetPackage });
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
/** One ranked hit from the server-side full-text index (#search-index). */
export interface SearchSuggestHit {
  id: string;
  kind: 'entity' | 'attribute' | 'package' | 'relationship' | 'rule' | 'metadata' | 'case';
  name: string;
  description: string;
  package: string;
  entityName: string;
  route: string;
  score: number;
  snippet: string;
}

export const entityApi = {
  // Get all packages and their entities
  getAllPackages: async (): Promise<Package[]> => {
    const response = await api.get('/packages/all');
    return response.data.data; // Unwrap the data from the API response
  },

  /**
   * Top-bar typeahead suggestions from the server FTS5 index (#search-index).
   * `ready:false` means the index isn't built yet — the caller falls back to
   * its client-side index. Never throws for a normal miss; returns [].
   */
  suggest: async (q: string, limit = 8): Promise<{ ready: boolean; hits: SearchSuggestHit[] }> => {
    const response = await api.get('/search/suggest', { params: { q, limit } });
    return response.data;
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

// ── ORM mapping vocabulary (reserved orm.* keys) ─────────────────────────────
// Mirrors backend models/ormVocabulary.ts; served via GET /api/orm/vocabulary
// so the typed ORM editor and the validator share one source of truth.
export type OrmKind = 'string' | 'int' | 'flag' | 'enum' | 'enumList' | 'entityRef';
export interface OrmKeyDef {
  key: string;
  kind: OrmKind;
  values?: string[];
  label: string;
  mapsTo: string;
}
export interface OrmVocabulary {
  prefix: string;
  scopes: { entity: OrmKeyDef[]; attribute: OrmKeyDef[]; relationship: OrmKeyDef[] };
}

export const ormApi = {
  getVocabulary: async (): Promise<OrmVocabulary> => {
    const response = await api.get('/orm/vocabulary');
    return response.data.data;
  },
};

// Run-SQL feature (#run-sql) — connect to a package DB, run a read-only SELECT,
// fetch results in chunks, and ask the AI to repair a failed query.
export type SqlDialect = 'postgres' | 'mysql' | 'mssql' | 'oracle' | 'sqlite';
export interface SqlRunChunk { resultId: string | null; columns: string[]; rows: unknown[][]; done: boolean; dialect?: SqlDialect }
/** Either explicit fields, or `connectionId` referencing a saved library entry
 *  (the server resolves its params + saved password — never sent to the client).
 *  Explicit fields override the entry's values when both are present. */
export interface SqlConnectInput { packageName: string; connectionId?: string; dialect?: SqlDialect; connection?: Record<string, unknown>; user?: string; password?: string; remember?: boolean }
export interface SqlSecretCapabilities { canStore: boolean; provider: string | null; reason?: string }
// Named connection library (#connection-library) — global per-user saved
// connection parameters; passwords live server-side in the secret store.
export interface SavedSqlConnection { id: string; name: string; dialect: SqlDialect; connection: Record<string, unknown>; user: string; savedAt: string; hasSavedPassword: boolean }
export interface SavedSqlConnectionInput { name: string; dialect: SqlDialect; connection: Record<string, unknown>; user?: string; password?: string; rememberPassword?: boolean }

export const sqlRunApi = {
  /** Stored non-secret physical config for a package (dialect/host/db) to prefill the connect form. */
  getPhysicalConfig: async (pkg: string): Promise<{ dialect?: SqlDialect; connection?: Record<string, unknown> } | null> => {
    try { const r = await api.get(`/services/${encodeURIComponent(pkg)}/physical-config`); return r.data?.data ?? null; }
    catch { return null; }
  },
  getConnection: async (pkg: string): Promise<{ dialect: SqlDialect; connection: Record<string, unknown>; user: string } | null> => {
    const r = await api.get(`/sql/connection/${encodeURIComponent(pkg)}`);
    return r.data?.data ?? null;
  },
  connect: async (input: SqlConnectInput): Promise<{ remembered?: boolean; usedSaved?: boolean }> => {
    const r = await api.post('/sql/connect', input);
    return { remembered: r.data?.remembered, usedSaved: r.data?.usedSaved };
  },
  disconnect: async (pkg: string) => { await api.delete(`/sql/connection/${encodeURIComponent(pkg)}`); },
  /** Can this machine store passwords safely (OS keyring / safeStorage / DICO_SECRET_KEY)? */
  secretCapabilities: async (): Promise<SqlSecretCapabilities> => {
    try { const r = await api.get('/sql/secret-capabilities'); return r.data?.data ?? { canStore: false, provider: null }; }
    catch { return { canStore: false, provider: null }; }
  },
  /** Is a password already saved for this exact connection identity? */
  secretStatus: async (input: { packageName: string; dialect: SqlDialect; connection: Record<string, unknown>; user: string }): Promise<boolean> => {
    try { const r = await api.post('/sql/secret-status', input); return !!r.data?.data?.hasSecret; }
    catch { return false; }
  },
  forgetSecret: async (pkg: string) => { await api.delete(`/sql/secret/${encodeURIComponent(pkg)}`); },
  /** The caller's saved connection library + per-package last-used prefill hints. */
  listSavedConnections: async (): Promise<{ connections: SavedSqlConnection[]; lastUsedByPackage: Record<string, string> }> => {
    try { const r = await api.get('/sql/connections'); return r.data?.data ?? { connections: [], lastUsedByPackage: {} }; }
    catch { return { connections: [], lastUsedByPackage: {} }; }
  },
  /** Create (no id) or update (id) a saved connection; password → secret store only. */
  saveConnection: async (input: SavedSqlConnectionInput, id?: string): Promise<SavedSqlConnection> => {
    const r = id
      ? await api.put(`/sql/connections/${encodeURIComponent(id)}`, input)
      : await api.post('/sql/connections', input);
    return r.data?.data;
  },
  deleteSavedConnection: async (id: string) => { await api.delete(`/sql/connections/${encodeURIComponent(id)}`); },
  run: async (packageName: string, sql: string, chunk?: number): Promise<SqlRunChunk> => {
    const r = await api.post('/sql/run', { packageName, sql, ...(chunk ? { chunk } : {}) });
    return r.data?.data;
  },
  fetchMore: async (resultId: string, n?: number): Promise<{ columns: string[]; rows: unknown[][]; done: boolean }> => {
    const r = await api.post('/sql/fetch', { resultId, ...(n ? { n } : {}) });
    return r.data?.data;
  },
  close: async (resultId: string) => { await api.post('/sql/close', { resultId }); },
};

// Reverse-engineer plugin (#reverse-engineer) — mine a repo's Liquibase changelog
// + git history into data-dictionary CIR elements/events.
export interface RepoSpecInput { name?: string; repoRoot: string; changelog: string; srcDir?: string }
export interface ReverseEngineerInput { repoRoot?: string; changelog?: string; srcDir?: string; repos?: RepoSpecInput[]; out?: string; emitDico?: string; update?: boolean; synthesis?: 'review' | 'direct'; enrich?: boolean }
export interface CrossRepoReport {
  repos: string[];
  sharedEntities: Array<{ table: string; repos: string[] }>;
  conflicts: Array<{ element: string; repos: string[]; detail: string }>;
  crossRepoRelationships: Array<{ relationship: string; from: string; to: string; fromRepos: string[]; toRepos: string[] }>;
  danglingReferences: Array<{ relationship: string; target: string }>;
}
export interface DriftFinding { element: string; kind: string; detail: string }
export interface JiraConfigView { baseUrl: string; authType: 'token' | 'basic'; user: string; token: string; hasPassword: boolean; enabled: boolean; configPath?: string }
export interface JiraConfigInput { baseUrl: string; authType: 'token' | 'basic'; user?: string; token?: string; password?: string; enabled: boolean }
export interface ConfluenceConfigView { baseUrl: string; authType: 'token' | 'basic'; user: string; token: string; hasPassword: boolean; spaceKey: string; limit: number; enabled: boolean; configPath?: string }
export interface ConfluenceConfigInput { baseUrl: string; authType: 'token' | 'basic'; user?: string; token?: string; password?: string; spaceKey?: string; limit?: number; enabled: boolean }
export interface ReProgressEvent { stage: string; status: 'start' | 'progress' | 'done'; detail?: string; count?: number }
export interface MavenDetection {
  projectRoot: string;
  projects: number;
  modules: number;
  candidates: Array<{ module: string; changelog: string; detectedBy: string; confidence: number; isTest: boolean; sqlUnsupported?: boolean }>;
  warnings: string[];
  plan: RepoSpecInput[];
}
/** Live event streamed by detectMavenStream as the Maven tree is walked. */
export type ReDetectEvent =
  | { type: 'project'; project: string; path: string; index: number; total: number }
  | { type: 'module'; module: string; project: string }
  | { type: 'candidate'; candidate: MavenDetection['candidates'][number] }
  | { type: 'warning'; message: string };
export interface ReverseEngineerElement {
  id: string;
  kind: string;
  names: { physical?: { schema?: string; table?: string; column?: string }; logical?: { fqcn?: string; field?: string } };
  facts: Record<string, unknown>;
  provenance: Array<{ source: string; ref: string; commit?: string; ticket?: string; author?: string }>;
  lifecycle: { status: string; bornEvent?: string };
  confidence?: number;
  flags?: string[];
}
export interface ReverseEngineerResult {
  summary: { elements: number; events: number; changeSets: number; withCommit: number; jpaFiles: number; driftFindings: number; jiraIssues: number; confluencePages: number; tickets: string[]; storeDir?: string; dicoProject?: string; synthesisDir?: string; repos?: string[]; crossRepoRelationships?: number; sharedEntities?: number; conflicts?: number; danglingReferences?: number };
  elements: ReverseEngineerElement[];
  events: Array<Record<string, unknown>>;
  drift: DriftFinding[];
  crossRepo?: CrossRepoReport;
  warnings: string[];
}

export const reverseEngineerApi = {
  run: async (input: ReverseEngineerInput): Promise<ReverseEngineerResult> => {
    const r = await api.post('/reverse-engineer/run', input);
    return r.data?.data as ReverseEngineerResult;
  },
  /** Streaming run: invokes onProgress for each live stage event, resolves with the final result. */
  runStream: async (input: ReverseEngineerInput, onProgress: (e: ReProgressEvent) => void): Promise<ReverseEngineerResult> => {
    const token = localStorage.getItem('auth_token') || 'mock-token-for-testing';
    const res = await fetch('/api/reverse-engineer/run-stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(input),
    });
    if (!res.ok || !res.body) {
      const raw = await res.text().catch(() => '');
      let msg = raw;
      try { const j = JSON.parse(raw); msg = j.error ?? j.message ?? raw; } catch { /* not JSON */ }
      throw new Error(msg || `HTTP ${res.status} ${res.statusText}`);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    let result: ReverseEngineerResult | undefined;
    let streamError: string | undefined;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        const msg = JSON.parse(line) as { type: string; data?: ReverseEngineerResult; error?: string } & ReProgressEvent;
        if (msg.type === 'progress') onProgress(msg);
        else if (msg.type === 'result') result = msg.data;
        else if (msg.type === 'error') streamError = msg.error;
      }
    }
    if (streamError) throw new Error(streamError);
    if (!result) throw new Error('No result received');
    return result;
  },
  getJiraConfig: async (): Promise<JiraConfigView> => (await api.get('/reverse-engineer/jira-config')).data,
  saveJiraConfig: async (cfg: JiraConfigInput): Promise<{ message: string; configPath?: string }> =>
    (await api.post('/reverse-engineer/jira-config', cfg)).data,
  testJira: async (): Promise<{ ok: boolean; user?: string; error?: string }> =>
    (await api.post('/reverse-engineer/jira-test')).data,
  detectMaven: async (repoRoot: string, includeTest = false): Promise<MavenDetection> =>
    (await api.post('/reverse-engineer/detect', { repoRoot, includeTest })).data.data,
  /** Streaming detect: invokes onEvent for each live scan event, resolves with the final detection + plan. */
  detectMavenStream: async (repoRoot: string, onEvent: (e: ReDetectEvent) => void, includeTest = false): Promise<MavenDetection> => {
    const token = localStorage.getItem('auth_token') || 'mock-token-for-testing';
    const res = await fetch('/api/reverse-engineer/detect-stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ repoRoot, includeTest }),
    });
    if (!res.ok || !res.body) {
      const raw = await res.text().catch(() => '');
      let msg = raw;
      try { const j = JSON.parse(raw); msg = j.error ?? j.message ?? raw; } catch { /* not JSON */ }
      throw new Error(msg || `HTTP ${res.status} ${res.statusText}`);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    let result: MavenDetection | undefined;
    let streamError: string | undefined;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        const msg = JSON.parse(line) as ReDetectEvent | { type: 'result'; data: MavenDetection } | { type: 'error'; error: string };
        if (msg.type === 'result') result = msg.data;
        else if (msg.type === 'error') streamError = msg.error;
        else onEvent(msg);
      }
    }
    if (streamError) throw new Error(streamError);
    if (!result) throw new Error('No detection result received');
    return result;
  },
  getConfluenceConfig: async (): Promise<ConfluenceConfigView> => (await api.get('/reverse-engineer/confluence-config')).data,
  saveConfluenceConfig: async (cfg: ConfluenceConfigInput): Promise<{ message: string; configPath?: string }> =>
    (await api.post('/reverse-engineer/confluence-config', cfg)).data,
  testConfluence: async (): Promise<{ ok: boolean; space?: string; error?: string }> =>
    (await api.post('/reverse-engineer/confluence-test')).data,
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
/** Value-domain kinds (#TBD): enum (inline), codelist (static, sourced), reference (sourced). */
export type ValueDomainKind = 'enum' | 'codelist' | 'reference';
export interface ValueDomain {
  kind: ValueDomainKind;
  /** enum & codelist: the allowed/static values. */
  values?: string[];
  /** codelist & reference: the source name identifying where values come from. */
  source?: string;
}

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
  domain?: ValueDomain;
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
  getHideRules: async (): Promise<HideRule[]> => {
    const response = await api.get('/config/hide-rules');
    return response.data.data || [];
  },
  putHideRules: async (rules: HideRule[]): Promise<HideRule[]> => {
    const response = await api.put('/config/hide-rules', rules);
    return response.data.data || rules;
  },
  getElementStyles: async (): Promise<ElementStyle[]> => {
    const response = await api.get('/config/element-styles');
    return response.data.data || [];
  },
  putElementStyles: async (styles: ElementStyle[]): Promise<ElementStyle[]> => {
    const response = await api.put('/config/element-styles', styles);
    return response.data.data || styles;
  },
  getStyleRules: async (): Promise<StyleRule[]> => {
    const response = await api.get('/config/style-rules');
    return response.data.data || [];
  },
  putStyleRules: async (rules: StyleRule[]): Promise<StyleRule[]> => {
    const response = await api.put('/config/style-rules', rules);
    return response.data.data || rules;
  },
};

/** A declarative rule that hides model elements whose name matches `pattern`
 *  (glob by default, or regex). Bulk-suppresses reverse-engineering waste. */
export interface HideRule {
  match: 'physicalTableName' | 'entityName' | 'packageName';
  pattern: string;
  regex?: boolean;
  reason?: string;
}

// Element Style types live with the resolver (#element-style); imported for the
// configApi signatures above and re-exported so callers can import them uniformly.
import type { ElementStyle, StyleRule } from '../utils/elementStyle';
export type { ElementStyle, StyleRule };

// Actions API (#179)
export const actionsApi = {
  getForEntity: async (entityUuid: string): Promise<Action[]> => {
    const response = await api.get(`/entities/${entityUuid}/actions`);
    return response.data.data || [];
  },
  getForPackage: async (packageName: string): Promise<Action[]> => {
    const response = await api.get(`/actions?package=${encodeURIComponent(packageName)}`);
    return response.data.data || [];
  },
  getOne: async (uuid: string): Promise<Action> => {
    const response = await api.get(`/actions/${uuid}`);
    return response.data.data;
  },
  create: async (data: Partial<Action>): Promise<Action> => {
    const response = await api.post('/actions', data);
    return response.data.data;
  },
  update: async (uuid: string, data: Partial<Action>): Promise<Action> => {
    const response = await api.put(`/actions/${uuid}`, data);
    return response.data.data;
  },
  delete: async (uuid: string): Promise<void> => {
    await api.delete(`/actions/${uuid}`);
  },
};

// Events API (#201 Phase 2)
export const eventsApi = {
  getAll: async (packageName?: string): Promise<Event[]> => {
    const params = packageName ? `?package=${encodeURIComponent(packageName)}` : '';
    const response = await api.get(`/events${params}`);
    return response.data.data || [];
  },
  getForEntity: async (entityUuid: string): Promise<Event[]> => {
    const response = await api.get(`/entities/${entityUuid}/events`);
    return response.data.data || [];
  },
  getOne: async (uuid: string): Promise<Event> => {
    const response = await api.get(`/events/${uuid}`);
    return response.data.data;
  },
  create: async (data: Partial<Event> & { packageName?: string }): Promise<Event> => {
    const response = await api.post('/events', data);
    return response.data.data;
  },
  update: async (uuid: string, data: Partial<Event>): Promise<Event> => {
    const response = await api.put(`/events/${uuid}`, data);
    return response.data.data;
  },
  delete: async (uuid: string): Promise<void> => {
    await api.delete(`/events/${uuid}`);
  },
};

// State Machines API (#179)
export const stateMachinesApi = {
  getForEntity: async (entityUuid: string): Promise<StateMachine[]> => {
    const response = await api.get(`/entities/${entityUuid}/state-machines`);
    return response.data.data || [];
  },
  getOne: async (uuid: string): Promise<StateMachine> => {
    const response = await api.get(`/state-machines/${uuid}`);
    return response.data.data;
  },
  create: async (data: Partial<StateMachine>): Promise<StateMachine> => {
    const response = await api.post('/state-machines', data);
    return response.data.data;
  },
  update: async (uuid: string, data: Partial<StateMachine>): Promise<StateMachine> => {
    const response = await api.put(`/state-machines/${uuid}`, data);
    return response.data.data;
  },
  delete: async (uuid: string): Promise<void> => {
    await api.delete(`/state-machines/${uuid}`);
  },
};

export default api;
