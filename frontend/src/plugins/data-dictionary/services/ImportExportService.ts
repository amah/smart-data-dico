import axios, { type AxiosInstance } from 'axios';
import type { Entity, EntityDiff } from '../../../types';

/** Backend response envelope shared by every endpoint — `{ data: T }`. */
type Envelope<T> = { data: T };

/** Strip-prefix / strip-suffix options for the schema-import wizard. */
export interface SchemaImportOptions {
  stripPrefixes?: string[];
  stripSuffixes?: string[];
  schema?: string;
}

/** Oracle dialect connection payload (#69 C4). */
export interface OracleConnection {
  user: string;
  password: string;
  connectString: string;
  owner?: string;
}

/** Unified DB-introspection dialect tag (#79/#80/#81). */
export type DbDialect = 'oracle' | 'postgres' | 'mysql' | 'mssql';

/** Backend payload for a parsed-from-source preview response. */
export interface PreviewResponse {
  data?: {
    entities?: Entity[];
    errors?: string[];
  };
}

/** Backend payload for a diff response (#69 C4). */
export interface DiffResponse {
  data?: {
    diffs?: EntityDiff[];
  };
}

/** Backend payload for a commit response (#69 C2). */
export interface CommitResponse {
  data: {
    added: number;
    merged: number;
    unchanged: number;
    removedInSource: number;
    written: number;
    errors: string[];
  };
}

/** Backend payload for a JSON-Schema / SQL-DDL import (legacy non-wizard path). */
export interface ImportResponse {
  data?: {
    entities?: Entity[];
    errors?: string[];
  };
}

/** Shape returned by `GET /api/quality/report` (after envelope unwrap). */
export interface QualityReport {
  overall: number;
  totalEntities: number;
  totalAttributes: number;
  packages: Array<{
    name: string;
    entityCount: number;
    descriptionCoverage: number;
    metadataCoverage: number;
    relationshipCoverage: number;
    overallScore: number;
    entities: Array<{
      name: string;
      uuid: string;
      descriptionFilled: boolean;
      attributeDescriptionRate: number;
      stereotypeCompliant: boolean;
      hasRelationships: boolean;
      score: number;
    }>;
  }>;
}

/**
 * Pattern B service — thin axios wrapper over the import / export / quality
 * REST surface.
 *
 * NOT a Store FS facade: every endpoint here is either (a) user-input-driven
 * writes that don't fit the Store FS cache invariant (#69 imports rewrite
 * multiple files at once, behind the scenes) or (b) a computed report
 * aggregating over the whole workspace. Per cookbook §3
 * (`frontend/docs/patterns.md:166-226`) Pattern B applies. The service owns
 * its own axios instance — it does NOT import from `@/services/api`
 * (cookbook §3 anti-pattern). Auth header replication matches `api.ts:23-32`
 * for parity with the legacy shim. See PR #173's `IntegrityService.ts` for
 * the exact precedent this class mirrors.
 *
 * Method preservation: every method from the legacy api surface in
 * `services/api.ts` (lines 319-373 in the pre-#155 codebase) is preserved
 * verbatim in name, argument shape, and return type — including
 * `previewOracleSchema` which has no non-test consumers but was previously
 * mocked in `SchemaImportWizard.test.tsx`. Trimming that surface is out of
 * scope; document but do not delete.
 */
export class ImportExportService {
  private readonly http: AxiosInstance;

  /**
   * @param http  Optional injected AxiosInstance. The override exists so
   *              unit tests can pass a stub client (see
   *              `__tests__/ImportExportService.test.ts`). Production code
   *              calls `new ImportExportService()` and receives the default
   *              instance built by `createDefaultHttp()`.
   */
  constructor(http?: AxiosInstance) {
    this.http = http ?? ImportExportService.createDefaultHttp();
  }

  // ─── Legacy import path (non-wizard) ────────────────────────────────────

  /** Wraps `POST /api/import/json-schema`. Body: `{ schema, service }`. */
  async importJsonSchema(schema: unknown, service: string): Promise<ImportResponse> {
    const response = await this.http.post<ImportResponse>(
      '/import/json-schema',
      { schema, service },
    );
    return response.data;
  }

  /** Wraps `POST /api/import/sql-ddl`. Body: `{ sql, service }`. */
  async importSqlDdl(sql: string, service: string): Promise<ImportResponse> {
    const response = await this.http.post<ImportResponse>(
      '/import/sql-ddl',
      { sql, service },
    );
    return response.data;
  }

  // ─── Schema Import Wizard (#69 C4) ──────────────────────────────────────

  /** Wraps `POST /api/import/sql-ddl/preview`. Body: `{ sql, options }`. */
  async previewSqlDdl(
    sql: string,
    options?: SchemaImportOptions,
  ): Promise<PreviewResponse> {
    const response = await this.http.post<PreviewResponse>(
      '/import/sql-ddl/preview',
      { sql, options },
    );
    return response.data;
  }

  /**
   * Wraps `POST /api/import/oracle/preview`. LEGACY — superseded by
   * `previewDbSchema` (#79/#80/#81). Kept for parity with the legacy
   * api surface; no non-test consumer exists in `frontend/src/**`
   * at the time of this PR.
   */
  async previewOracleSchema(
    connection: OracleConnection,
    options?: SchemaImportOptions,
  ): Promise<PreviewResponse> {
    const response = await this.http.post<PreviewResponse>(
      '/import/oracle/preview',
      { connection, options },
    );
    return response.data;
  }

  /** Wraps `POST /api/import/db/preview` (unified DB introspection #79/#80/#81). */
  async previewDbSchema(
    dialect: DbDialect,
    connection: Record<string, unknown>,
    options?: SchemaImportOptions,
  ): Promise<PreviewResponse> {
    const response = await this.http.post<PreviewResponse>(
      '/import/db/preview',
      { dialect, connection, options },
    );
    return response.data;
  }

  /** Wraps `POST /api/import/sql-ddl/diff`. Body: `{ parsed, targetService }`. */
  async diffSqlDdl(parsed: unknown[], targetService: string): Promise<DiffResponse> {
    const response = await this.http.post<DiffResponse>(
      '/import/sql-ddl/diff',
      { parsed, targetService },
    );
    return response.data;
  }

  /** Wraps `POST /api/import/sql-ddl/commit`. Body: `{ parsed, targetService }`. */
  async commitSqlDdl(parsed: unknown[], targetService: string): Promise<CommitResponse> {
    const response = await this.http.post<CommitResponse>(
      '/import/sql-ddl/commit',
      { parsed, targetService },
    );
    return response.data;
  }

  // ─── Exports ────────────────────────────────────────────────────────────

  /**
   * Wraps `GET /api/export/json-schema/:service`. Returns the parsed
   * JSON-Schema object — the existing caller (`ImportExportPage.tsx`)
   * stringifies it back to JSON for download.
   */
  async exportJsonSchema(service: string): Promise<unknown> {
    const response = await this.http.get<unknown>(
      `/export/json-schema/${service}`,
    );
    return response.data;
  }

  /**
   * Wraps `GET /api/export/markdown/:service`. Returns the raw markdown
   * **string** — `responseType: 'text'` prevents axios from JSON-parsing
   * the response body. This is the only method in this service with a
   * non-default response shape. No cast is needed: the string literal
   * `'text'` is a member of axios's `ResponseType` union (verified at
   * `frontend/node_modules/axios/index.d.ts:296-303`). The legacy
   * `as any` cast at `api.ts:354` is dropped intentionally.
   */
  async exportMarkdown(service: string): Promise<string> {
    const response = await this.http.get<string>(
      `/export/markdown/${service}`,
      { responseType: 'text' },
    );
    return response.data;
  }

  // ─── Quality (computed report) ──────────────────────────────────────────

  /**
   * Wraps `GET /api/quality/report?service=<service>`. Returns the
   * inner-unwrapped `QualityReport` (one layer of envelope strip — backend
   * returns `{ data: QualityReport }`, mirroring the integrity endpoint).
   *
   * Lives on ImportExportService rather than a dedicated QualityService
   * because the legacy api shipped it alongside the import/export methods.
   * Future extraction into `QUALITY_SERVICE_TOKEN` is explicitly out of
   * scope (see spec "Out of scope").
   */
  async getQualityReport(service?: string): Promise<QualityReport> {
    const params = service ? `?service=${encodeURIComponent(service)}` : '';
    const response = await this.http.get<Envelope<QualityReport>>(
      `/quality/report${params}`,
    );
    return response.data.data;
  }

  // ─── Default http construction ──────────────────────────────────────────

  private static createDefaultHttp(): AxiosInstance {
    const instance = axios.create({
      baseURL: '/api',
      headers: { 'Content-Type': 'application/json' },
    });
    instance.interceptors.request.use((config) => {
      // Mirrors api.ts:23-32 and IntegrityService.createDefaultHttp.
      // The `|| 'mock-token-for-testing'` fallback is a dev-environment
      // hack inherited from api.ts:25 — flag for cleanup alongside that
      // file (out of scope; same deliberate drift as PR #173).
      const token = localStorage.getItem('auth_token') || 'mock-token-for-testing';
      if (token) config.headers.Authorization = `Bearer ${token}`;
      return config;
    });
    return instance;
  }
}
