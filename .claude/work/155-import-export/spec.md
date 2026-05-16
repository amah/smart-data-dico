# Spec — #155 (slice): ImportExportService — Pattern B proof

## Goal

Apply the #155 DI-token-per-service pattern to the second and substantially larger Pattern B surface from the catalog: `IMPORT_EXPORT_SERVICE_TOKEN`, owned by the `data-dictionary` plugin. Per the #155 ticket body the entry is described as *"Wraps user input + writes — REST is correct"* (#155 table row for `IMPORT_EXPORT_SERVICE_TOKEN`). This proof mirrors the just-merged PR #173 precedent verbatim — same constructor-injected `AxiosInstance`, same `createDefaultHttp()` factory, same eager `useValue` registration in `dataDictionaryPlugin.initialize`, same `useService(TOKEN)` consumer pattern — but covers **ten methods** instead of one and migrates four source consumer files plus one test mock. The pilot creates `INTEGRITY_SERVICE_TOKEN`'s sibling token, the service class wrapping every method currently on `importExportApi` (including `getQualityReport` — kept here per orchestrator note 2, with future quality extraction explicitly out of scope), the DI registration, migrates all five places that reference `importExportApi` (the four source files flagged by the orchestrator plus the `SchemaImportWizard.test.tsx` mock which must be retargeted), deletes `importExportApi` from `frontend/src/services/api.ts`, and stops there.

## Branch base

This branch is cut from `main` (post-#173, post-#172, post-#171 — all merged). Verified via the commit log: `4a4d80b arch: scaffolding for the #154–#169 architectural refactor (#170)` is on main; the orchestrator note 6 states `5a48c44` (PR #173 squash commit) is also on main. No nested branch dependencies; this PR's diff sits cleanly atop the IntegrityService precedent already present at `frontend/src/plugins/data-dictionary/services/IntegrityService.ts`.

## Scope discovery (corrections / verifications of orchestrator pre-checks)

- **Orchestrator pre-check 1 — consumers list.** Verified `grep -rnE 'importExportApi\.' frontend/src --include='*.ts*' | grep -v __tests__ | grep -v services/api.ts` returns exactly the three orchestrator-supplied call sites PLUS one missed consumer: **`HomePage.tsx:113`** also calls `importExportApi.getQualityReport()` (the workspace KPI strip — overall quality %). HomePage.tsx already migrated `integrityApi` to `useService` in PR #173, so the `importExportApi` import on `HomePage.tsx:27` is the surviving fourth source consumer. Migrating HomePage is mandatory or the build breaks when `importExportApi` is deleted. **Source consumers: 4** (the 3 the orchestrator flagged + HomePage). **Test mock to retarget: 1** (`SchemaImportWizard.test.tsx`). **Total file count touching `importExportApi`: 5.**
- **Orchestrator pre-check 2 — `SchemaImportWizard.test.tsx` mocks `importExportApi`.** Verified at `frontend/src/components/__tests__/SchemaImportWizard.test.tsx:21-39`. The test uses `vi.mock('../../services/api', () => ({ importExportApi: { ... } }))` to stub four methods (`previewSqlDdl`, `previewOracleSchema`, `previewDbSchema`, `diffSqlDdl`, `commitSqlDdl`). Once `importExportApi` is deleted from `api.ts`, this mock target ceases to exist and the test file must be rewritten to use the same MSW-based approach the post-#173 `IntegrityPage.test.tsx` adopted (`beforeAll(bootstrapApplication)` + per-test `server.use(http.post(...))` handlers). This is the **largest single piece of test work** in the migration.
- **Orchestrator pre-check 3 — catalog naming.** Verified by reading `gh issue view 155` body: the `IMPORT_EXPORT_SERVICE_TOKEN` row in the catalog table is exactly: *"`data-dictionary` | B | Wraps user input + writes — REST is correct"*. The `getQualityReport` method is currently nested under `importExportApi` even though it semantically belongs to "quality." Per orchestrator note 2 it stays in ImportExportService for this pilot; future extraction is out of scope.
- **Orchestrator pre-check 5 — wider surface.** Verified by reading `frontend/src/services/api.ts:319-373`: `importExportApi` has **ten methods**: `importJsonSchema`, `importSqlDdl`, `previewSqlDdl`, `previewOracleSchema` (legacy, kept for parity — see note below), `previewDbSchema`, `diffSqlDdl`, `commitSqlDdl`, `exportJsonSchema`, `exportMarkdown`, `getQualityReport`. **The service preserves all ten methods verbatim** — deleting `previewOracleSchema` would silently drop a surface the test mock relies on; the cleanup of that legacy method is a separate decision.
- **Orchestrator pre-check 7 — calibrated rules.** This spec uses targeted greps and per-file `npx vitest run`, NOT whole-project `tsc --noEmit` / `npm run lint` (baseline-broken per #156-calibration).
- **Cookbook §3 explicitly covers Pattern B.** Worked example #3b is the `IntegrityService` PR #173 just landed (`frontend/docs/patterns.md:166-215`). This pilot follows that worked example verbatim — no novel pattern, no risk of inventing one. Cookbook §3 line 226 anti-pattern explicitly permits `useState<loading|error>` on Pattern B consumer pages via the §1.5 ephemeral-UI carve-out; this spec preserves `useState<loading>` / `useState<error>` in every migrated page where they exist (per hard-scope rule).
- **`exportMarkdown` has a non-JSON response.** `frontend/src/services/api.ts:365` calls `axios.get(..., { responseType: 'text' as any })` and returns the raw markdown string from `response.data`. This is the only method in the API that uses a non-JSON axios config. The service signature for `exportMarkdown` must preserve `responseType: 'text'` so the markdown blob arrives as a string, not a parsed-JSON object. The literal `'text'` is a member of axios's `ResponseType` union (verified at `frontend/node_modules/axios/index.d.ts:296-303`), so **no cast is required** — the legacy `as any` was unnecessary and is NOT replicated in the new service. Pinned in acceptance criterion #10.

## Files touched

- `frontend/src/kernel/tokens.ts` — append `IMPORT_EXPORT_SERVICE_TOKEN` symbol export with a docblock describing Pattern B / data-dictionary owner. Mirrors the existing `INTEGRITY_SERVICE_TOKEN` doc shape (lines 43-52).
- `frontend/src/plugins/data-dictionary/services/ImportExportService.ts` — **new**. Pattern B class with 10 methods over the `/api/import/**`, `/api/export/**`, `/api/quality/report` endpoints. Mirrors `IntegrityService.ts` structure verbatim (optional `AxiosInstance` ctor, static `createDefaultHttp()` factory, no `@/services/api` import).
- `frontend/src/plugins/data-dictionary/dataDictionaryPlugin.ts` — extend `initialize` body to register `IMPORT_EXPORT_SERVICE_TOKEN` via `ctx.provide({ provide: IMPORT_EXPORT_SERVICE_TOKEN, useValue: new ImportExportService() })`. The block sits immediately after the existing `INTEGRITY_SERVICE_TOKEN` registration (lines 80-84) — same Pattern B shape, no kernel deps, no Proxy plumbing.
- `frontend/src/pages/ImportExportPage.tsx` — replace `import { servicesApi, importExportApi } from '../services/api'` with `import { servicesApi } from '../services/api'` + the `useService` / token / type imports. Four call sites (lines 29, 31, 52, 56) become `service.importJsonSchema(...)`, `service.importSqlDdl(...)`, `service.exportJsonSchema(...)`, `service.exportMarkdown(...)`. Existing `useState<loading>` / `useState<result>` retained per cookbook §1.5.
- `frontend/src/pages/QualityDashboardPage.tsx` — replace `import { importExportApi } from '../services/api'` (line 20) with the `useService` triad. Single call at line 79 becomes `service.getQualityReport()`. Existing `useState<loading>` / `useState<error>` retained per cookbook §1.5.
- `frontend/src/pages/HomePage.tsx` — drop `importExportApi,` from the multi-named import (line 27) and rewrite the call at line 113 from `importExportApi.getQualityReport()` to `importExport.getQualityReport()` where `importExport` is the new `useService<ImportExportService>(IMPORT_EXPORT_SERVICE_TOKEN)` resolution. Sits alongside the existing `integrity = useService<IntegrityService>(...)` line (HomePage.tsx:81 post-#173). The prose comment at line 14 (`importExportApi.getQualityReport()`) is rewritten to `importExport.getQualityReport()` so the repo-wide `importExportApi` grep guard in acceptance criterion #6 does not catch a stale doc string.
- `frontend/src/components/SchemaImportWizard.tsx` — replace `import { importExportApi } from '../services/api'` (line 29) with the `useService` triad. Four call sites (lines 190, 191, 202, 221) become `service.previewSqlDdl(...)`, `service.previewDbSchema(...)`, `service.diffSqlDdl(...)`, `service.commitSqlDdl(...)`. Existing `useState<loading>` / `useState<error>` retained per cookbook §1.5.
- `frontend/src/services/api.ts` — delete the `importExportApi` export block (lines 318-373, inclusive of the `// Import/Export API` comment header). No other edits to this file.
- `frontend/src/components/__tests__/SchemaImportWizard.test.tsx` — **rewrite the test harness.** Delete the `vi.mock('../../services/api', () => ({ importExportApi: { ... } }))` block (lines 21-29) and the corresponding `mockedApi` extraction (lines 31-39) and the `beforeEach` mockReset block (lines 84-90). Replace with: (a) `beforeAll(async () => { await bootstrapApplication() })`, (b) per-test MSW handlers via `server.use(http.post('/api/import/sql-ddl/preview', ...), http.post('/api/import/sql-ddl/diff', ...), http.post('/api/import/sql-ddl/commit', ...), http.post('/api/import/db/preview', ...))`, (c) render the wizard inside `<Provider store={getStore()}>` (the wizard component itself does not consume Redux state, but `useService` requires `host.rootActivationCtx`, so bootstrap is mandatory — Provider matches the IntegrityPage.test.tsx precedent). The 12 existing test cases (paste-source happy path, strip-prefix passthrough, parser error short-circuit, Oracle dialect routing, Postgres dialect routing, dialect-required field gating, commit happy path, commit error display, Back button, onComplete callback) are preserved verbatim — only the assertion mechanism changes from `mockedApi.x.mock.calls` introspection to MSW request capture via a closed-over `lastBody` variable per handler.
- `frontend/src/plugins/data-dictionary/services/__tests__/ImportExportService.test.ts` — **new**. Unit test the service in isolation via **constructor injection of a stub `AxiosInstance`** (the `ImportExportService(http?)` parameter is exposed precisely for this). One `describe` block per public method; no MSW; no `vi.mock('axios')`. Mirrors `IntegrityService.test.ts` precedent (`frontend/src/plugins/data-dictionary/services/__tests__/IntegrityService.test.ts`).
- `frontend/src/plugins/data-dictionary/__tests__/dataDictionaryPlugin.importExport.test.ts` — **new**. Plugin-bootstrap test mirroring `dataDictionaryPlugin.integrity.test.ts` verbatim. Calls `bootstrapApplication()` once in `beforeAll`, then asserts `host.rootActivationCtx.resolve<ImportExportService>(IMPORT_EXPORT_SERVICE_TOKEN)` returns a truthy service with all 10 methods being `typeof === 'function'`, and that repeated lookups return the same singleton (useValue contract).
- `frontend/src/plugins/data-dictionary/services/__tests__/spec-grep-guards.importExport.test.ts` — **new**. Repo-content grep guards mirroring `spec-grep-guards.integrity.test.ts` verbatim (fs.readFileSync walker, NOT shell grep). Covers acceptance criteria #1, #2, #3, #4 (per-consumer), #6, #7.

## Public surface (signatures)

```ts
// frontend/src/kernel/tokens.ts (append after line 52, AFTER INTEGRITY_SERVICE_TOKEN)

/**
 * DI token for the ImportExportService.
 *
 * Pattern B per #155 catalog: a REST wrapper around the import / export /
 * quality computed endpoints (`/api/import/**`, `/api/export/**`,
 * `/api/quality/report`). The #155 row reads: *"Wraps user input + writes —
 * REST is correct"*. Owned by the `data-dictionary` plugin; constructed
 * and provided in `dataDictionaryPlugin.initialize` as an eager `useValue`
 * (same shape as `INTEGRITY_SERVICE_TOKEN`).
 *
 * Note: `getQualityReport` lives on this service even though it
 * semantically belongs to "quality." Future extraction into a dedicated
 * `QUALITY_SERVICE_TOKEN` is OUT OF SCOPE for this slice — see
 * `.claude/work/155-import-export/spec.md` "Out of scope."
 */
export const IMPORT_EXPORT_SERVICE_TOKEN = Symbol('ImportExportService');
```

```ts
// frontend/src/plugins/data-dictionary/services/ImportExportService.ts (new)

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
 * Method preservation: every method present on `importExportApi` in
 * `services/api.ts` lines 319-373 is preserved verbatim in name, argument
 * shape, and return type — including `previewOracleSchema` which has no
 * non-test consumers but is mocked in `SchemaImportWizard.test.tsx`.
 * Trimming that surface is out of scope; document but do not delete.
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
   * `previewDbSchema` (#79/#80/#81). Kept for parity with the existing
   * `importExportApi` surface; no non-test consumer exists in
   * `frontend/src/**` at the time of this PR.
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
   * `as any` cast at `api.ts:365` is dropped intentionally.
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
   * because the legacy `importExportApi` shipped it here. Future extraction
   * into `QUALITY_SERVICE_TOKEN` is explicitly out of scope (see spec
   * "Out of scope").
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
```

```ts
// frontend/src/plugins/data-dictionary/dataDictionaryPlugin.ts
// (additive change inside `async initialize(ctx)` body, AFTER the existing
// INTEGRITY_SERVICE_TOKEN registration at lines 80-84)

import {
  STORE_FS_TOKEN,
  STEREOTYPE_SERVICE_TOKEN,
  INTEGRITY_SERVICE_TOKEN,
  IMPORT_EXPORT_SERVICE_TOKEN, // <-- new
} from '../../kernel/tokens';
import { IntegrityService } from './services/IntegrityService';
import { ImportExportService } from './services/ImportExportService'; // <-- new

// ... existing initialize body ...

// Pattern B (#155): no kernel deps — register a self-contained axios wrapper.
ctx.provide({
  provide: INTEGRITY_SERVICE_TOKEN,
  useValue: new IntegrityService(),
});

// Pattern B (#155): no kernel deps — register a self-contained axios wrapper.
ctx.provide({
  provide: IMPORT_EXPORT_SERVICE_TOKEN,
  useValue: new ImportExportService(),
});
```

```tsx
// frontend/src/pages/ImportExportPage.tsx (diff)
-import { servicesApi, importExportApi } from '../services/api';
+import { servicesApi } from '../services/api';
+import { useService } from '../kernel/useService';
+import { IMPORT_EXPORT_SERVICE_TOKEN } from '../kernel/tokens';
+import type { ImportExportService } from '../plugins/data-dictionary/services/ImportExportService';

 export default function ImportExportPage() {
+  const importExport = useService<ImportExportService>(IMPORT_EXPORT_SERVICE_TOKEN);
   // ... existing useState (loading, result, etc.) retained — see Risk 1 ...

   const handleImport = async () => {
     ...
-      if (importFormat === 'json-schema') {
-        const schema = JSON.parse(importText);
-        res = await importExportApi.importJsonSchema(schema, selectedService);
-      } else {
-        res = await importExportApi.importSqlDdl(importText, selectedService);
-      }
+      if (importFormat === 'json-schema') {
+        const schema = JSON.parse(importText);
+        res = await importExport.importJsonSchema(schema, selectedService);
+      } else {
+        res = await importExport.importSqlDdl(importText, selectedService);
+      }
     ...
   };

   const handleExport = async () => {
     ...
-        const schema = await importExportApi.exportJsonSchema(selectedService);
+        const schema = await importExport.exportJsonSchema(selectedService);
     ...
-        const md = await importExportApi.exportMarkdown(selectedService);
+        const md = await importExport.exportMarkdown(selectedService);
     ...
   };
```

```tsx
// frontend/src/pages/QualityDashboardPage.tsx (diff)
-import { importExportApi } from '../services/api';
+import { useService } from '../kernel/useService';
+import { IMPORT_EXPORT_SERVICE_TOKEN } from '../kernel/tokens';
+import type { ImportExportService } from '../plugins/data-dictionary/services/ImportExportService';

 export default function QualityDashboardPage() {
   ...
+  const importExport = useService<ImportExportService>(IMPORT_EXPORT_SERVICE_TOKEN);

   useEffect(() => {
-    importExportApi.getQualityReport()
+    importExport.getQualityReport()
       .then((r) => setReport(r))
       .catch(() => setError('Failed to load quality report.'))
       .finally(() => setLoading(false));
-  }, []);
+  }, [importExport]);
```

```tsx
// frontend/src/pages/HomePage.tsx (diff)
-// Quality → importExportApi.getQualityReport()
+// Quality → importExport.getQualityReport()
-import {
-  servicesApi,
-  packageApi,
-  gitApi,
-  importExportApi,
-} from '../services/api';
+import {
+  servicesApi,
+  packageApi,
+  gitApi,
+} from '../services/api';
 import { useService } from '../kernel/useService';
-import { INTEGRITY_SERVICE_TOKEN } from '../kernel/tokens';
+import { INTEGRITY_SERVICE_TOKEN, IMPORT_EXPORT_SERVICE_TOKEN } from '../kernel/tokens';
 import type { IntegrityService } from '../plugins/data-dictionary/services/IntegrityService';
+import type { ImportExportService } from '../plugins/data-dictionary/services/ImportExportService';

 const HomePage = () => {
   ...
   const integrity = useService<IntegrityService>(INTEGRITY_SERVICE_TOKEN);
+  const importExport = useService<ImportExportService>(IMPORT_EXPORT_SERVICE_TOKEN);

   useEffect(() => {
     ...
         const [pkgResults, qualityReport] = await Promise.all([
           Promise.all(services.map(async (name) => {
             ...
           })),
-          importExportApi.getQualityReport().catch(() => null),
+          importExport.getQualityReport().catch(() => null),
         ]);
     ...
-  }, []);
+  }, [importExport]);
```

```tsx
// frontend/src/components/SchemaImportWizard.tsx (diff)
-import { importExportApi } from '../services/api';
+import { useService } from '../kernel/useService';
+import { IMPORT_EXPORT_SERVICE_TOKEN } from '../kernel/tokens';
+import type { ImportExportService } from '../plugins/data-dictionary/services/ImportExportService';

 export default function SchemaImportWizard({ services, onComplete }: Props) {
+  const importExport = useService<ImportExportService>(IMPORT_EXPORT_SERVICE_TOKEN);
   // ... existing useState retained — see Risk 1 ...

   const handlePreviewAndDiff = async () => {
     ...
-      const previewRes =
-        sourceKind === 'sql'
-          ? await importExportApi.previewSqlDdl(sqlText, buildOptions())
-          : await importExportApi.previewDbSchema(dialect, buildConnectionPayload(), buildOptions());
+      const previewRes =
+        sourceKind === 'sql'
+          ? await importExport.previewSqlDdl(sqlText, buildOptions())
+          : await importExport.previewDbSchema(dialect, buildConnectionPayload(), buildOptions());
     ...
-      const diffRes = await importExportApi.diffSqlDdl(parsedEntities, targetService);
+      const diffRes = await importExport.diffSqlDdl(parsedEntities, targetService);
     ...
   };

   const handleCommit = async () => {
     ...
-      const res = await importExportApi.commitSqlDdl(parsed, targetService);
+      const res = await importExport.commitSqlDdl(parsed, targetService);
     ...
   };
```

```ts
// frontend/src/services/api.ts (deletion)
// Delete lines 318-373 entirely (the `// Import/Export API` comment block
// plus the `export const importExportApi = { ... }` declaration). No
// other edits to this file.
//
// Verify post-deletion: `grep -nE '^export const importExportApi' api.ts`
// returns zero hits; `grep -n importExportApi api.ts` returns zero hits.
```

## Framework APIs used

- `@hamak/microkernel-spi` — `PluginModule`, `InitializationContext.provide<T>(prov: Provider<T>): void`. Confirmed at `frontend/node_modules/@hamak/microkernel-spi/dist/plugin.d.ts:1,3` (`import type { ActivateContext, Provider, Token } from '@hamak/microkernel-api'; ... provide<T>(prov: Provider<T>): void;`).
- `@hamak/microkernel-api` — `Token<T> = string | symbol | Constructor<T>`, `ValueProvider<T> = { provide: Token<T>; useValue: T }`, `Provider<T> = ClassProvider<T> | ValueProvider<T> | FactoryProvider<T>`, `ProvidedServices.resolve<T>(token: Token<T>): T`. Confirmed at `frontend/node_modules/@hamak/microkernel-api/dist/types.d.ts:1,36-37,42-43,46-51,53`.
- **Local consumer hook** `useService<T>(token: symbol | string): T` from `frontend/src/kernel/useService.ts`. Verified by reading the file: signature exactly `export function useService<T>(token: symbol | string): T`. Throws if `host.rootActivationCtx` is unset or the provider is missing.
- **Local bootstrap helpers** `bootstrapApplication(): Promise<boolean>` and `getStore()` from `frontend/src/kernel/bootstrap.ts:186,212`. The `bootstrapApplication` return type is `Promise<boolean>` (not `Promise<void>` — verified by reading source), but callers in test code consistently `await` it without using the return value, matching the PR #173 precedent (`IntegrityPage.test.tsx:87` reads `await bootstrapApplication();`).
- **Local singleton** `host` from `frontend/src/kernel/bootstrap.ts:40` — `export const host = new Host([], undefined, { debug: false })`. Tests resolve services via `host.rootActivationCtx!.resolve(TOKEN)`.
- `axios` — imported directly into `ImportExportService.ts`. Allowed by cookbook §3 line 225 anti-pattern carve-out (axios is forbidden *outside* `plugins/*/services/*.ts`; inside one such file it is the canonical Pattern B transport). Verified `node_modules/axios/index.d.ts` re-exports `AxiosInstance`, `AxiosRequestConfig`, etc. The `ResponseType` union at `frontend/node_modules/axios/index.d.ts:296-303` includes the string literal `'text'`, so `exportMarkdown`'s `{ responseType: 'text' }` config does not need a cast.
- `msw` / `http` / `HttpResponse` — used by both the page-level test rewrite and the bootstrap test for HTTP fixtures, matching `frontend/src/test/setup.ts:5,116` and `IntegrityPage.test.tsx:23` precedent. No `vi.mock('axios')` anywhere in this PR.
- **No** `@hamak/ui-store-impl` `StoreFileSystemFacade` / `createFileSelector` / `FileSystemNodeAction` usage — Pattern B is REST-shaped and bypasses Store FS entirely. This is a deliberate property of Pattern B per #155 catalog row and cookbook §3.
- **No** `notification-api` / `commands.run('notification.error', ...)` integration — every consumer page's existing error display is preserved unchanged. Notification factory wiring (PR #171) is out of scope.

## Acceptance criteria

The post-#173 CI-baseline rule applies: do NOT pin acceptance to whole-project `tsc --noEmit` or `npm run lint`. Use targeted greps and `npx vitest run` on specific test files.

1. **Token exists and is unique.** `grep -nE "^export const IMPORT_EXPORT_SERVICE_TOKEN" frontend/src/kernel/tokens.ts` returns exactly one line. `typeof IMPORT_EXPORT_SERVICE_TOKEN === 'symbol'` at runtime. Value distinct from every other token in `tokens.ts` (distinct `Symbol(...)` call).

2. **Service file is self-contained.** `grep -nE "from ['\"](.*)?services/api['\"]" frontend/src/plugins/data-dictionary/services/ImportExportService.ts` returns no matches (cookbook §3 line 225 compliance). The service imports only from `axios` and from `../../../types` (for `Entity`, `EntityDiff`).

3. **DI registration happens during initialize, not activate.** Reading `frontend/src/plugins/data-dictionary/dataDictionaryPlugin.ts`: a `ctx.provide({ provide: IMPORT_EXPORT_SERVICE_TOKEN, useValue: new ImportExportService() })` call appears inside the `async initialize(ctx)` body (NOT `activate`). Provider shape is `useValue` (not `useClass` / `useFactory`) — instance constructed eagerly at initialize time.

4. **Every consumer migrated.** For each of the four migrated source files:
   - `frontend/src/pages/ImportExportPage.tsx`: `grep -n "useService<ImportExportService>(IMPORT_EXPORT_SERVICE_TOKEN)" returns at least one hit; `grep -n "\bimportExportApi\b" returns zero hits.
   - `frontend/src/pages/QualityDashboardPage.tsx`: same shape — useService hit + zero importExportApi hits.
   - `frontend/src/pages/HomePage.tsx`: same shape. (HomePage also retains its existing `INTEGRITY_SERVICE_TOKEN` usage from PR #173 — unchanged.) The prose comment at line 14 must also be rewritten so the repo-wide guard in criterion #6 does not catch a stale `importExportApi` string.
   - `frontend/src/components/SchemaImportWizard.tsx`: same shape.

5. **`importExportApi` is gone from `api.ts`.** `grep -nE "^export const importExportApi" frontend/src/services/api.ts` returns zero hits. `grep -nE "\bimportExportApi\b" frontend/src/services/api.ts` returns zero hits.

6. **No surviving consumer in production source.** Repo-wide `grep -rn "importExportApi" frontend/src` returns hits ONLY inside `spec-grep-guards.importExport.test.ts` (the new test guard file, allowlisted by suffix). All other files — including `HomePage.tsx`'s prose comment at line 14 — have been migrated.

7. **ImportExportService unit tests green.** `npx vitest run frontend/src/plugins/data-dictionary/services/__tests__/ImportExportService.test.ts` passes. The suite has at least **one `it(...)` per public method** (10 methods → ≥10 tests). Each test:
   - Constructs `new ImportExportService(stubHttp)` where `stubHttp` is a hand-rolled object satisfying the subset of `AxiosInstance` the service uses: `{ get: vi.fn(), post: vi.fn() }` cast through `unknown` as `AxiosInstance`. No `vi.mock('axios')`.
   - Asserts the corresponding `stubHttp.get` / `stubHttp.post` is called with the literal relative path (e.g., `'/import/sql-ddl/preview'`, `'/quality/report'`, `'/quality/report?service=user-service'`). The `baseURL: '/api'` lives on the default instance only — the stub receives relative paths. Acceptance for unit-test path assertions uses the relative form, e.g. `'/import/sql-ddl/preview'`, **NOT** `'/api/import/sql-ddl/preview'` (matches the `IntegrityService.test.ts:77` precedent).
   - Asserts the returned promise resolves to the correct unwrap layer:
     - `getQualityReport` returns `response.data.data` (envelope-unwrapped) — same shape as `IntegrityService.getReport`.
     - Every other method returns `response.data` (raw response body — the legacy `importExportApi` does NOT envelope-unwrap, per `api.ts:319-373`).
   - At least one test (`exportMarkdown`) asserts the request config has `responseType: 'text'` — the only non-default config in this service.
   - At least one negative test verifies that a rejection on the stub propagates out (no internal swallow).

8. **Plugin bootstrap test green.** `npx vitest run frontend/src/plugins/data-dictionary/__tests__/dataDictionaryPlugin.importExport.test.ts` passes. The test mirrors `dataDictionaryPlugin.integrity.test.ts` verbatim:
   - `beforeAll` calls `await bootstrapApplication()`.
   - Asserts `host.rootActivationCtx` is defined.
   - Resolves `const svc = host.rootActivationCtx!.resolve<ImportExportService>(IMPORT_EXPORT_SERVICE_TOKEN)`.
   - Asserts `svc` is truthy and each of the 10 methods (`importJsonSchema`, `importSqlDdl`, `previewSqlDdl`, `previewOracleSchema`, `previewDbSchema`, `diffSqlDdl`, `commitSqlDdl`, `exportJsonSchema`, `exportMarkdown`, `getQualityReport`) is `typeof === 'function'`.
   - Asserts repeated lookups return the same instance (singleton — useValue contract).

9. **SchemaImportWizard test green after rewrite.** `npx vitest run frontend/src/components/__tests__/SchemaImportWizard.test.tsx` passes. The rewritten harness:
   - `beforeAll` calls `await bootstrapApplication()` (no manual host construction).
   - `beforeEach` registers **four** MSW handlers via `server.use(...)`: `POST /api/import/sql-ddl/preview`, `POST /api/import/sql-ddl/diff`, `POST /api/import/sql-ddl/commit`, `POST /api/import/db/preview`. **No `POST /api/import/oracle/preview` handler is needed**: no test case in the file exercises `previewOracleSchema`. The "Oracle" test case at SchemaImportWizard.test.tsx:195 routes through `previewDbSchema('oracle', ...)`, which is captured by the `/api/import/db/preview` handler. Each handler captures `await request.json()` into a closed-over `lastBody.preview` / `lastBody.diff` / etc. variable so assertions can verify the request payload (replacing the old `mockedApi.x.toHaveBeenCalledWith(...)` assertions).
   - Renders the wizard inside `<Provider store={getStore()}><SchemaImportWizard services={services} /></Provider>`.
   - The 12 existing `it(...)` cases survive verbatim: assertion targets shift from `mockedApi.x.mock.calls` to `lastBody.x` (for argument shape) and to `await screen.findByText(...)` (for DOM-rendered fixture data — unchanged). The four "happy path → stats render" assertions remain DOM-based and need no change.
   - The `vi.mock('../../services/api', ...)` block and `mockedApi` extraction are **fully deleted**; no surviving reference to `importExportApi` or `mockedApi` in the file.

10. **`exportMarkdown` preserves `responseType: 'text'`.** `grep -n "responseType:\s*'text'" frontend/src/plugins/data-dictionary/services/ImportExportService.ts` returns at least one hit (inside `exportMarkdown`). At runtime, the markdown download blob produced by `ImportExportPage.tsx`'s `handleExport` matches the existing observable behavior — the test does not need to exercise the blob download itself, but the unit test from criterion #7 asserts the config shape on `stubHttp.get`'s second argument.

11. **HomePage / QualityDashboard / ImportExport page tests.** No existing tests for these pages (`find frontend/src -name "HomePage.test*" -o -name "QualityDashboardPage.test*" -o -name "ImportExportPage.test*"` returns zero files at baseline). No new page-level tests are added for them in this slice — the `useService` migration is mechanical, the methods are exercised by the unit + bootstrap tests, and adding fresh page-level MSW coverage is OUT OF SCOPE (would expand the proof to a green-field test authoring exercise, mirroring the same scope discipline as PR #173 which did not add tests for HomePage either). Documented here so the test-author does not invent them.

12. **Spec-grep guards file green.** `npx vitest run frontend/src/plugins/data-dictionary/services/__tests__/spec-grep-guards.importExport.test.ts` passes. The file mirrors `spec-grep-guards.integrity.test.ts`'s structure: fs.readFileSync walker (NOT shell grep), one `describe` block per acceptance criterion #1, #2, #3, #4 (one `it` per migrated consumer), #5, #6. The repo-wide walker excludes files ending in `spec-grep-guards.importExport.test.ts` so the literal `importExportApi` strings in this file do not trip the guard against itself.

13. **Full Vitest suite green.** `cd frontend && npm test -- --run` reports zero failing tests. The new test count is `baseline-on-main` (post-#173) PLUS:
    - +N tests in `ImportExportService.test.ts` (N ≥ 11: at least one per method + at least one negative).
    - +K tests in `dataDictionaryPlugin.importExport.test.ts` (K ≥ 3: host populated, all 10 method types, singleton).
    - +M tests in `spec-grep-guards.importExport.test.ts` (M ≥ 7: per acceptance criterion).
    - Net-zero change in `SchemaImportWizard.test.tsx` test count (12 existing cases rewritten in place).
    No previously-passing test in the suite goes red. The HomePage / QualityDashboard / ImportExport pages have zero existing tests; that count remains zero (per criterion #11).

14. **Does NOT pin tsc/lint.** The above criteria do not include `tsc --noEmit` or `npm run lint`, per post-#156 calibration.

## Out of scope

- **Quality extraction into a dedicated service** (`QUALITY_SERVICE_TOKEN`) — `getQualityReport` stays on `ImportExportService` for this slice per orchestrator note 2. Surface as a follow-up ticket; the docblock on `IMPORT_EXPORT_SERVICE_TOKEN` and on `getQualityReport` flags this. When extraction happens, only the consumer at `QualityDashboardPage.tsx` and the prose/comment at `HomePage.tsx:14` shift to the new token; the rest of `ImportExportService` is unaffected.
- **`previewOracleSchema` deletion.** The method has zero non-test consumers in `frontend/src/**` at the time of this PR (only the `SchemaImportWizard.test.tsx` mock references it). Removing it from the service surface would (a) match real usage and (b) trim 8 lines of dead code, BUT it would silently lose a backend route wrapper that #157's route reorganization may want to keep available. Decision: preserve, document as legacy. A follow-up under #157 can drop both the route and the method together.
- **Other #155 catalog services** — `DICTIONARY_SERVICE_TOKEN`, `CASE_SERVICE_TOKEN`, `RULE_SERVICE_TOKEN`, `DIFF_SERVICE_TOKEN`, `SEARCH_SERVICE_TOKEN`, `VISUALIZATION_SERVICE_TOKEN`, `AI_SERVICE_TOKEN`. Each gets its own slice under #155.
- **IntegrityService changes** — landed in PR #173. This slice does not touch `IntegrityService.ts`, `IntegrityPage.tsx`'s integrity wiring, or any of `IntegrityService.test.ts` / `dataDictionaryPlugin.integrity.test.ts` / `spec-grep-guards.integrity.test.ts`. HomePage's `integrity = useService<IntegrityService>(...)` line is preserved verbatim.
- **Cookbook updates** — `frontend/docs/patterns.md` already has the Pattern B worked example (§3b) from PR #173. Adding a "second Pattern B example showing a 10-method service" is a post-merge documentation follow-up; this PR's diff does not edit `patterns.md`.
- **`useState<loading | error>` removal** in the four migrated consumer files — preserved per cookbook §1.5 (Pattern B has no Store FS node to attach state to; §1.5 ephemeral-UI carve-out applies). Same deferral as PR #173 for IntegrityPage/HomePage.
- **ESLint `no-restricted-imports` guardrail forbidding `@/services/api`** — out of scope per #155's umbrella ticket until `api.ts` shrinks further. 16 sub-APIs still live in `api.ts`; adding the guardrail now would falsely flag 60+ legitimate consumers.
- **`AuthService` cleanup** — `frontend/src/plugins/auth/AuthService.ts` still imports from `../../services/api`. NOT touched in this PR. The new ImportExportService diverges from that precedent without breaking it.
- **Auth-interceptor extraction into a shared helper** — Risk 4 below. Same deliberate drift as PR #173. A follow-up may extract `createAuthedHttp()`.
- **Backend route reorganization** (#157) — the import / export / quality URLs stay at `/api/import/**`, `/api/export/**`, `/api/quality/report`. When #157 lands, only the relative-path string literals in `ImportExportService.ts` change (10 strings total).
- **Notification integration** — none of the migrated pages currently dispatch `notification.error` on failure; their existing error displays stay verbatim. Wiring notification into PR #173-style is a separate concern.
- **HomePage / QualityDashboard / ImportExport page-level MSW tests** — none exist at baseline; none are added. Per criterion #11.

## Dependencies

- **Branches off `main`.** All three predecessor PRs (#171 notification factory, #172 stereotype-slice, #173 integrity-service) are merged. Inherits `frontend/src/kernel/useService.ts`, `INTEGRITY_SERVICE_TOKEN`, the `bootstrapApplication()` precedent, the `dataDictionaryPlugin.initialize` block with the existing IntegrityService registration, and the cookbook §3b worked example.
- **Coordinates with #155-integrity (merged as PR #173).** Second-and-larger Pattern B service from the catalog — same precedent. No file overlap except for additive changes to `tokens.ts` (one new symbol after the existing IntegrityService one) and `dataDictionaryPlugin.ts:initialize` (one new `ctx.provide` block after the existing IntegrityService one).
- **Coordinates with #157 (REST route reorganization).** Ten `/api/...` path strings in `ImportExportService.ts`. When #157 lands, those ten strings rebase; no functional change.
- **Coordinates with the (deferred) quality-extraction follow-up.** `getQualityReport` migrates to `QualityService` whenever that ticket lands; this slice should not block it.
- **NOT blocked by any open framework bug.** Pattern B is pure axios over computed/write endpoints — no Store FS, no autosave, no YAML round-trip.

## Risks

1. **Cookbook §2 deferral for Pattern B loading state.** Three of the four migrated consumer files retain `useState<boolean>(loading)` / `useState<string | null>(error)`. *Mitigation:* cookbook §1.5 explicitly carves this out for Pattern B (cookbook line 84, line 226); same deferral as PR #173. Acceptable known debt.

2. **`useService` resolution before bootstrap in tests.** If a test mounts a migrated component without first calling `bootstrapApplication()`, the `useService` hook throws with the helpful `'useService called before host bootstrap completed'` message (verified at `frontend/src/kernel/useService.ts:17-22`). *Mitigation:* the rewritten `SchemaImportWizard.test.tsx` calls `bootstrapApplication()` in `beforeAll`. The bootstrap test does the same. No other test in this PR mounts a migrated component.

3. **Test rewrite risk — SchemaImportWizard.test.tsx (largest piece of work in this slice).** The 12 existing cases use `mockedApi.x.toHaveBeenCalledWith(...)` to assert request payload shape; the rewrite must replicate every such assertion via MSW request-body capture. If a single case's payload-shape assertion is dropped silently, the migration regresses test coverage. *Mitigation:* the rewrite preserves every `mockedApi.*.toHaveBeenCalledWith(...)` semantic — each handler captures `await request.json()` into a per-test `lastBody.<endpoint>` closure, asserted post-action. The 12 case names are preserved verbatim; the diff is mechanical body-of-test changes, not test-name churn. Acceptance criterion #9 pins all 12 cases passing.

4. **Auth header parity with `api.ts`.** `ImportExportService.createDefaultHttp` duplicates `api.ts:23-32` and `IntegrityService.createDefaultHttp`. If the legacy `api.ts` interceptor changes (e.g., a 401-retry handler is added), both PR-#173 and this PR drift. *Mitigation:* none in this PR — duplication is the deliberate cost of cookbook §3 line 225. A future follow-up may extract `createAuthedHttp()`. Same drift as PR #173; document and accept.

5. **Backend response-envelope inconsistency.** Some `importExportApi` methods envelope-unwrap (`getQualityReport` reads `response.data.data`); others do not (`importJsonSchema` reads `response.data`). The new service must preserve this asymmetry verbatim or every caller's `res.data?.entities?.length` access breaks. *Mitigation:* the spec's signatures (and acceptance criterion #7) pin the exact unwrap level per method. Reviewer should compare each method side-by-side against `api.ts:319-373`. Unit tests (one per method) assert the unwrap layer.
