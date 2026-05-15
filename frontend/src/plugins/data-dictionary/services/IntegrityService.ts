import axios, { type AxiosInstance } from 'axios';
import type { PhysicalConstraint, Rule } from '../../../types';

/** Row shape inside `IntegrityReport.validation`. */
export interface IntegrityValidationRow {
  service: string;
  entityUuid: string;
  entityName: string;
  attributeUuid: string;
  attributeName: string;
  kind: string;
  value: number | string | string[];
}

/** Row shape inside `IntegrityReport.constraints`. */
export interface IntegrityConstraintRow {
  service: string;
  entityUuid: string;
  entityName: string;
  constraint: PhysicalConstraint;
}

/** Computed report returned by `GET /api/integrity`. */
export interface IntegrityReport {
  validation: IntegrityValidationRow[];
  constraints: IntegrityConstraintRow[];
  rules: Rule[];
}

/**
 * Pattern B service — thin axios wrapper over `GET /api/integrity`.
 *
 * NOT a Store FS facade: the integrity report is a computed aggregate
 * server-side (CLAUDE.md "three concepts, three homes"). It has no file
 * shape, so per cookbook §3 (`frontend/docs/patterns.md`) Pattern B
 * applies. The service owns its own axios instance — it does NOT import
 * from `@/services/api` (cookbook anti-pattern). Auth header replication
 * matches `services/api.ts:23-32` for parity with the legacy shim.
 */
export class IntegrityService {
  private readonly http: AxiosInstance;

  /**
   * @param http  Optional injected AxiosInstance. The override exists so
   *              unit tests can pass a stub client (see
   *              `__tests__/IntegrityService.test.ts`). Production code
   *              calls `new IntegrityService()` and receives the default
   *              instance built by `createDefaultHttp()`.
   */
  constructor(http?: AxiosInstance) {
    this.http = http ?? IntegrityService.createDefaultHttp();
  }

  /** Fetch the unified validation + constraints + rules report. */
  async getReport(): Promise<IntegrityReport> {
    const response = await this.http.get<{ data: IntegrityReport }>('/integrity');
    return response.data.data;
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
