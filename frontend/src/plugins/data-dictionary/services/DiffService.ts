import axios, { type AxiosInstance } from 'axios';

/**
 * Left/right operand of a logical diff. Mirrors the existing call sites in
 * LogicalDiffPage (lines 258-264) — the union is reproduced here so the
 * service surface is self-typed; the page does not need to assert.
 */
export type LogicalDiffOperand =
  | { type: 'service'; name: string }
  | { type: 'all-services' }
  | { type: 'git-ref'; ref: string; service?: string };

/**
 * Per-service physical source — DDL paste or live introspection. Shape is
 * dictated by the backend (POST /api/diff/physical body) and is reused
 * verbatim from the local `sources[svc] = { ... }` builder in
 * PhysicalDiffPage (lines 130-136 + 167-170).
 */
export type PhysicalDiffSource =
  | { type: 'ddl'; sql: string }
  | { type: 'live'; credentials: { user: string; password: string } };

/**
 * Persisted physical-config row returned by GET /api/services/:svc/physical-config.
 *
 * Cycle 2 narrowing: the only field the page reads is `dialect`
 * (PhysicalDiffPage.tsx:327 — `cfg ? cfg.dialect : 'no physical.yaml'`).
 * Typing the row as `Record<string, unknown>` would force a cast at the
 * read site (under strict TS, `unknown.dialect` is not assignable to
 * `ReactNode`). Narrowing to `{ dialect?: string; [k: string]: unknown }`
 * lets the page render `cfg.dialect` directly (`string | undefined`,
 * which is a valid `ReactNode`) while keeping the rest of the shape
 * intentionally opaque. The backend route returns `null` when no config
 * is persisted; the page's `try/catch` handles the 404 path (the service
 * contract itself is success-only).
 */
export type PhysicalConfig = { dialect?: string; [k: string]: unknown } | null;

/** Whole-result payload of POST /api/diff/logical. Page treats as opaque. */
export type LogicalDiffResult = unknown;

/** Whole-result payload of POST /api/diff/physical (single service). */
export type PhysicalDiffResult = unknown;

/** Whole-result payload of POST /api/diff/physical/all. */
export type PhysicalDiffAllResult = unknown;

/**
 * Pattern B service — thin axios wrapper over the `/diff/*` endpoints and
 * `/services/:svc/physical-config`. NOT a Store FS facade: every result is
 * a computed aggregate the backend builds across many YAML files (see #86
 * for the logical diff algorithm). Per cookbook §3 (`frontend/docs/patterns.md`)
 * Pattern B applies. The service owns its own axios instance — it does NOT
 * import from `@/services/api` (cookbook anti-pattern). Auth header
 * replication matches `services/api.ts:23-32`.
 */
export class DiffService {
  private readonly http: AxiosInstance;

  /**
   * @param http  Optional injected AxiosInstance for unit tests (see
   *              `__tests__/DiffService.test.ts`). Production callsite is
   *              `new DiffService()` — receives the default instance from
   *              `createDefaultHttp()`.
   */
  constructor(http?: AxiosInstance) {
    this.http = http ?? DiffService.createDefaultHttp();
  }

  /** POST /api/diff/logical — full-model logical diff between two refs. */
  async getLogical(left: LogicalDiffOperand, right: LogicalDiffOperand): Promise<LogicalDiffResult> {
    const response = await this.http.post<{ data: LogicalDiffResult }>('/diff/logical', { left, right });
    return response.data.data;
  }

  /** GET /api/services/:service/physical-config — returns persisted config or null. */
  async getPhysicalConfig(service: string): Promise<PhysicalConfig> {
    const response = await this.http.get<{ data: PhysicalConfig }>(`/services/${service}/physical-config`);
    return response.data.data;
  }

  /** POST /api/diff/physical — single-service DDL/live diff. */
  async getPhysicalForService(service: string, source: PhysicalDiffSource): Promise<PhysicalDiffResult> {
    const response = await this.http.post<{ data: PhysicalDiffResult }>('/diff/physical', { service, source });
    return response.data.data;
  }

  /** POST /api/diff/physical/all — whole-model physical diff across services. */
  async getPhysicalAll(
    sources: Record<string, PhysicalDiffSource>,
    services?: string[],
  ): Promise<PhysicalDiffAllResult> {
    const response = await this.http.post<{ data: PhysicalDiffAllResult }>('/diff/physical/all', { sources, services });
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
