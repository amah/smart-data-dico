import axios, { type AxiosInstance } from 'axios';
import type { SearchResult } from '../../../types';

/** Backend response envelope from `GET /api/search`. */
export interface SearchResponse {
  message: string;
  data: SearchResult[];
}

/** Optional filter object matched 1:1 with the legacy `servicesApi.searchEntities` signature. */
export interface SearchFilters {
  type?: string;
  service?: string;
  stereotype?: string;
  hasMetadata?: string;
}

/**
 * Pattern B service — thin axios wrapper over `GET /api/search`.
 *
 * NOT a Store FS facade: search results are computed server-side and have
 * no file shape (CLAUDE.md). Per cookbook §3 (`frontend/docs/patterns.md`)
 * Pattern B applies. The service owns its own axios instance and does NOT
 * import from `@/services/api` (cookbook anti-pattern). Auth header
 * replication matches `services/api.ts:23-32` for parity with the legacy shim.
 */
export class SearchService {
  private readonly http: AxiosInstance;

  /**
   * @param http  Optional injected AxiosInstance. The override exists so
   *              unit tests can pass a stub client (see
   *              `__tests__/SearchService.test.ts`). Production code
   *              calls `new SearchService()` and receives the default
   *              instance built by `createDefaultHttp()`.
   */
  constructor(http?: AxiosInstance) {
    this.http = http ?? SearchService.createDefaultHttp();
  }

  /**
   * Returns the response envelope as-is, NOT just `data: SearchResult[]`.
   * Rationale: the legacy `servicesApi.searchEntities` returns `response.data`
   * (axios body), which is `{ message, data: SearchResult[] }`. Both current
   * callers (`SearchComponent.tsx:58` and `searchSlice.ts:22-23`) consume
   * the full envelope. Preserving the same return shape keeps the migration
   * a pure call-site swap with no consumer-side adaptation.
   */
  async searchEntities(query: string, filters?: SearchFilters): Promise<SearchResponse> {
    const params = new URLSearchParams({ q: query });
    if (filters?.type) params.append('type', filters.type);
    if (filters?.service) params.append('service', filters.service);
    if (filters?.stereotype) params.append('stereotype', filters.stereotype);
    if (filters?.hasMetadata) params.append('hasMetadata', filters.hasMetadata);
    const response = await this.http.get<SearchResponse>(`/search?${params.toString()}`);
    return response.data;
  }

  private static createDefaultHttp(): AxiosInstance {
    const instance = axios.create({
      baseURL: '/api',
      headers: { 'Content-Type': 'application/json' },
    });
    instance.interceptors.request.use((config) => {
      // Mirrors api.ts:23-32. The `|| 'mock-token-for-testing'` fallback
      // is a dev-environment hack inherited from api.ts:25 — flag for
      // cleanup alongside that file (out of scope for this PR).
      const token = localStorage.getItem('auth_token') || 'mock-token-for-testing';
      if (token) config.headers.Authorization = `Bearer ${token}`;
      return config;
    });
    return instance;
  }
}
