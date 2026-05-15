/**
 * #155-import-export — ImportExportService unit suite.
 *
 * Covers spec acceptance criterion #7:
 *   - Service is constructed with a stub `AxiosInstance` (constructor
 *     injection — NOT vi.mock('axios')).
 *   - Each of the 10 public methods calls the correct http verb + path.
 *   - Envelope asymmetry is preserved: `getQualityReport` returns
 *     `response.data.data` (double-unwrap); all other methods return
 *     `response.data` (single-unwrap).
 *   - `exportMarkdown` passes `{ responseType: 'text' }` as the second
 *     argument to `http.get` — the only non-default config in this service.
 *   - When the stub rejects, the promise rejects (no internal swallow).
 *   - `new ImportExportService()` (no arg) does not throw and produces an
 *     instance with all 10 public methods.
 *
 * No MSW here. MSW is reserved for the bootstrap/component-level tests
 * (criteria #8 and #9). The service's optional-AxiosInstance ctor parameter
 * exists precisely for this style of isolated unit test.
 *
 * No `vi.mock('axios')` anywhere in this file — confirmed by the presence
 * of zero `vi.mock(` invocations.
 */

import { describe, it, expect, vi } from 'vitest';
import type { AxiosInstance } from 'axios';

import {
  ImportExportService,
  type SchemaImportOptions,
  type OracleConnection,
  type QualityReport,
  type PreviewResponse,
  type DiffResponse,
  type CommitResponse,
  type ImportResponse,
} from '../ImportExportService';

// ──────────────── Stub factory ────────────────

/**
 * Build a stub AxiosInstance containing only the methods ImportExportService
 * actually uses (get + post). Cast through `unknown` to satisfy the
 * AxiosInstance structural type — we intentionally do NOT implement the full
 * surface.
 */
function makeStubHttp(opts: {
  get?: ReturnType<typeof vi.fn>;
  post?: ReturnType<typeof vi.fn>;
}): AxiosInstance {
  return {
    get: opts.get ?? vi.fn(),
    post: opts.post ?? vi.fn(),
  } as unknown as AxiosInstance;
}

// ──────────────── Fixtures ────────────────

const sampleEntity = {
  uuid: 'e-1',
  name: 'Order',
  attributes: [],
  metadata: [],
};

const sampleImportResponse: ImportResponse = {
  data: { entities: [sampleEntity as never], errors: [] },
};

const samplePreviewResponse: PreviewResponse = {
  data: { entities: [sampleEntity as never], errors: [] },
};

const sampleDiffResponse: DiffResponse = {
  data: { diffs: [] },
};

const sampleCommitResponse: CommitResponse = {
  data: {
    added: 1,
    merged: 2,
    unchanged: 3,
    removedInSource: 0,
    written: 3,
    errors: [],
  },
};

const sampleQualityReport: QualityReport = {
  overall: 85,
  totalEntities: 5,
  totalAttributes: 20,
  packages: [
    {
      name: 'order-service',
      entityCount: 5,
      descriptionCoverage: 0.9,
      metadataCoverage: 0.8,
      relationshipCoverage: 0.7,
      overallScore: 85,
      entities: [],
    },
  ],
};

const sampleOracleConnection: OracleConnection = {
  user: 'sales',
  password: 'pw',
  connectString: 'host:1521/svc',
};

const sampleOptions: SchemaImportOptions = {
  stripPrefixes: ['tbl_'],
  stripSuffixes: ['_v2'],
};

// ──────────────── Tests ────────────────

describe('ImportExportService — unit (constructor-injected http)', () => {
  // ── importJsonSchema ──────────────────────────────────────────────────

  describe('importJsonSchema()', () => {
    it('calls http.post with "/import/json-schema" and { schema, service } body', async () => {
      const postMock = vi.fn().mockResolvedValue({ data: sampleImportResponse });
      const service = new ImportExportService(makeStubHttp({ post: postMock }));

      const schema = { type: 'object' };
      await service.importJsonSchema(schema, 'order-service');

      expect(postMock).toHaveBeenCalledTimes(1);
      expect(postMock).toHaveBeenCalledWith('/import/json-schema', {
        schema,
        service: 'order-service',
      });
    });

    it('returns response.data (single unwrap — no envelope stripping)', async () => {
      const postMock = vi.fn().mockResolvedValue({ data: sampleImportResponse });
      const service = new ImportExportService(makeStubHttp({ post: postMock }));

      const result = await service.importJsonSchema({}, 'order-service');

      // Single-unwrap: the returned value IS sampleImportResponse (not .data of it)
      expect(result).toEqual(sampleImportResponse);
    });

    it('rejects when http.post rejects (no internal swallow)', async () => {
      const postMock = vi.fn().mockRejectedValue(new Error('network error'));
      const service = new ImportExportService(makeStubHttp({ post: postMock }));

      await expect(service.importJsonSchema({}, 'order-service')).rejects.toThrow('network error');
    });
  });

  // ── importSqlDdl ──────────────────────────────────────────────────────

  describe('importSqlDdl()', () => {
    it('calls http.post with "/import/sql-ddl" and { sql, service } body', async () => {
      const postMock = vi.fn().mockResolvedValue({ data: sampleImportResponse });
      const service = new ImportExportService(makeStubHttp({ post: postMock }));

      await service.importSqlDdl('CREATE TABLE x (id INT);', 'order-service');

      expect(postMock).toHaveBeenCalledTimes(1);
      expect(postMock).toHaveBeenCalledWith('/import/sql-ddl', {
        sql: 'CREATE TABLE x (id INT);',
        service: 'order-service',
      });
    });

    it('returns response.data (single unwrap)', async () => {
      const postMock = vi.fn().mockResolvedValue({ data: sampleImportResponse });
      const service = new ImportExportService(makeStubHttp({ post: postMock }));

      const result = await service.importSqlDdl('CREATE TABLE x (id INT);', 'order-service');

      expect(result).toEqual(sampleImportResponse);
    });

    it('rejects when http.post rejects (no internal swallow)', async () => {
      const postMock = vi.fn().mockRejectedValue(new Error('server error'));
      const service = new ImportExportService(makeStubHttp({ post: postMock }));

      await expect(
        service.importSqlDdl('CREATE TABLE x (id INT);', 'order-service'),
      ).rejects.toThrow('server error');
    });
  });

  // ── previewSqlDdl ─────────────────────────────────────────────────────

  describe('previewSqlDdl()', () => {
    it('calls http.post with "/import/sql-ddl/preview" and { sql, options } body', async () => {
      const postMock = vi.fn().mockResolvedValue({ data: samplePreviewResponse });
      const service = new ImportExportService(makeStubHttp({ post: postMock }));

      await service.previewSqlDdl('CREATE TABLE x (id INT);', sampleOptions);

      expect(postMock).toHaveBeenCalledTimes(1);
      expect(postMock).toHaveBeenCalledWith('/import/sql-ddl/preview', {
        sql: 'CREATE TABLE x (id INT);',
        options: sampleOptions,
      });
    });

    it('returns response.data (single unwrap)', async () => {
      const postMock = vi.fn().mockResolvedValue({ data: samplePreviewResponse });
      const service = new ImportExportService(makeStubHttp({ post: postMock }));

      const result = await service.previewSqlDdl('CREATE TABLE x (id INT);');

      expect(result).toEqual(samplePreviewResponse);
    });

    it('rejects when http.post rejects (no internal swallow)', async () => {
      const postMock = vi.fn().mockRejectedValue(new Error('parse error'));
      const service = new ImportExportService(makeStubHttp({ post: postMock }));

      await expect(service.previewSqlDdl('bad sql')).rejects.toThrow('parse error');
    });
  });

  // ── previewOracleSchema ───────────────────────────────────────────────

  describe('previewOracleSchema()', () => {
    it('exists and calls http.post with "/import/oracle/preview" and { connection, options } body', async () => {
      const postMock = vi.fn().mockResolvedValue({ data: samplePreviewResponse });
      const service = new ImportExportService(makeStubHttp({ post: postMock }));

      await service.previewOracleSchema(sampleOracleConnection, sampleOptions);

      expect(postMock).toHaveBeenCalledTimes(1);
      expect(postMock).toHaveBeenCalledWith('/import/oracle/preview', {
        connection: sampleOracleConnection,
        options: sampleOptions,
      });
    });

    it('is exposed and callable on a default-constructed instance (legacy surface preserved)', () => {
      // previewOracleSchema has zero non-test consumers at the time of this PR
      // but is preserved for parity. Verify it is present on the public surface.
      const service = new ImportExportService();
      expect(typeof service.previewOracleSchema).toBe('function');
    });

    it('returns response.data (single unwrap)', async () => {
      const postMock = vi.fn().mockResolvedValue({ data: samplePreviewResponse });
      const service = new ImportExportService(makeStubHttp({ post: postMock }));

      const result = await service.previewOracleSchema(sampleOracleConnection);

      expect(result).toEqual(samplePreviewResponse);
    });
  });

  // ── previewDbSchema ───────────────────────────────────────────────────

  describe('previewDbSchema()', () => {
    it('calls http.post with "/import/db/preview" and { dialect, connection, options } body', async () => {
      const postMock = vi.fn().mockResolvedValue({ data: samplePreviewResponse });
      const service = new ImportExportService(makeStubHttp({ post: postMock }));

      const connection = { host: 'db.example.com', database: 'sales', user: 'app', password: 'pw', port: 5432 };
      await service.previewDbSchema('postgres', connection, sampleOptions);

      expect(postMock).toHaveBeenCalledTimes(1);
      expect(postMock).toHaveBeenCalledWith('/import/db/preview', {
        dialect: 'postgres',
        connection,
        options: sampleOptions,
      });
    });

    it('works with dialect=oracle', async () => {
      const postMock = vi.fn().mockResolvedValue({ data: samplePreviewResponse });
      const service = new ImportExportService(makeStubHttp({ post: postMock }));

      await service.previewDbSchema('oracle', { user: 'sales', password: 'pw', connectString: 'host:1521/svc' });

      expect(postMock).toHaveBeenCalledWith(
        '/import/db/preview',
        expect.objectContaining({ dialect: 'oracle' }),
      );
    });

    it('returns response.data (single unwrap)', async () => {
      const postMock = vi.fn().mockResolvedValue({ data: samplePreviewResponse });
      const service = new ImportExportService(makeStubHttp({ post: postMock }));

      const result = await service.previewDbSchema('postgres', {});

      expect(result).toEqual(samplePreviewResponse);
    });

    it('rejects when http.post rejects (no internal swallow)', async () => {
      const postMock = vi.fn().mockRejectedValue(new Error('db connection refused'));
      const service = new ImportExportService(makeStubHttp({ post: postMock }));

      await expect(service.previewDbSchema('postgres', {})).rejects.toThrow('db connection refused');
    });
  });

  // ── diffSqlDdl ────────────────────────────────────────────────────────

  describe('diffSqlDdl()', () => {
    it('calls http.post with "/import/sql-ddl/diff" and { parsed, targetService } body', async () => {
      const postMock = vi.fn().mockResolvedValue({ data: sampleDiffResponse });
      const service = new ImportExportService(makeStubHttp({ post: postMock }));

      const parsed = [sampleEntity];
      await service.diffSqlDdl(parsed, 'order-service');

      expect(postMock).toHaveBeenCalledTimes(1);
      expect(postMock).toHaveBeenCalledWith('/import/sql-ddl/diff', {
        parsed,
        targetService: 'order-service',
      });
    });

    it('returns response.data (single unwrap)', async () => {
      const postMock = vi.fn().mockResolvedValue({ data: sampleDiffResponse });
      const service = new ImportExportService(makeStubHttp({ post: postMock }));

      const result = await service.diffSqlDdl([], 'order-service');

      expect(result).toEqual(sampleDiffResponse);
    });

    it('rejects when http.post rejects (no internal swallow)', async () => {
      const postMock = vi.fn().mockRejectedValue(new Error('diff failed'));
      const service = new ImportExportService(makeStubHttp({ post: postMock }));

      await expect(service.diffSqlDdl([], 'order-service')).rejects.toThrow('diff failed');
    });
  });

  // ── commitSqlDdl ──────────────────────────────────────────────────────

  describe('commitSqlDdl()', () => {
    it('calls http.post with "/import/sql-ddl/commit" and { parsed, targetService } body', async () => {
      const postMock = vi.fn().mockResolvedValue({ data: sampleCommitResponse });
      const service = new ImportExportService(makeStubHttp({ post: postMock }));

      const parsed = [sampleEntity];
      await service.commitSqlDdl(parsed, 'order-service');

      expect(postMock).toHaveBeenCalledTimes(1);
      expect(postMock).toHaveBeenCalledWith('/import/sql-ddl/commit', {
        parsed,
        targetService: 'order-service',
      });
    });

    it('returns response.data (single unwrap)', async () => {
      const postMock = vi.fn().mockResolvedValue({ data: sampleCommitResponse });
      const service = new ImportExportService(makeStubHttp({ post: postMock }));

      const result = await service.commitSqlDdl([], 'order-service');

      expect(result).toEqual(sampleCommitResponse);
    });

    it('rejects when http.post rejects (no internal swallow)', async () => {
      const postMock = vi.fn().mockRejectedValue(new Error('commit error'));
      const service = new ImportExportService(makeStubHttp({ post: postMock }));

      await expect(service.commitSqlDdl([], 'order-service')).rejects.toThrow('commit error');
    });
  });

  // ── exportJsonSchema ──────────────────────────────────────────────────

  describe('exportJsonSchema()', () => {
    it('calls http.get with the literal "/export/json-schema/order-service" path', async () => {
      const getMock = vi.fn().mockResolvedValue({ data: { type: 'object', properties: {} } });
      const service = new ImportExportService(makeStubHttp({ get: getMock }));

      await service.exportJsonSchema('order-service');

      expect(getMock).toHaveBeenCalledTimes(1);
      expect(getMock).toHaveBeenCalledWith('/export/json-schema/order-service');
    });

    it('returns response.data (single unwrap — raw JSON schema object)', async () => {
      const schema = { type: 'object', properties: { id: { type: 'string' } } };
      const getMock = vi.fn().mockResolvedValue({ data: schema });
      const service = new ImportExportService(makeStubHttp({ get: getMock }));

      const result = await service.exportJsonSchema('order-service');

      expect(result).toEqual(schema);
    });

    it('rejects when http.get rejects (no internal swallow)', async () => {
      const getMock = vi.fn().mockRejectedValue(new Error('service not found'));
      const service = new ImportExportService(makeStubHttp({ get: getMock }));

      await expect(service.exportJsonSchema('missing-service')).rejects.toThrow('service not found');
    });
  });

  // ── exportMarkdown ────────────────────────────────────────────────────

  describe('exportMarkdown()', () => {
    it('calls http.get with the literal "/export/markdown/order-service" path', async () => {
      const getMock = vi.fn().mockResolvedValue({ data: '# Order Service\n' });
      const service = new ImportExportService(makeStubHttp({ get: getMock }));

      await service.exportMarkdown('order-service');

      expect(getMock).toHaveBeenCalledTimes(1);
      expect(getMock).toHaveBeenCalledWith(
        '/export/markdown/order-service',
        expect.objectContaining({ responseType: 'text' }),
      );
    });

    it('passes { responseType: "text" } as the config argument — the only non-default axios config', async () => {
      const getMock = vi.fn().mockResolvedValue({ data: '# Order Service\n' });
      const service = new ImportExportService(makeStubHttp({ get: getMock }));

      await service.exportMarkdown('order-service');

      // Assert the exact second argument shape
      const [, configArg] = getMock.mock.calls[0];
      expect(configArg).toEqual({ responseType: 'text' });
    });

    it('returns response.data (the raw markdown string — single unwrap)', async () => {
      const markdown = '# Order Service\n\nDocumentation here.\n';
      const getMock = vi.fn().mockResolvedValue({ data: markdown });
      const service = new ImportExportService(makeStubHttp({ get: getMock }));

      const result = await service.exportMarkdown('order-service');

      expect(result).toBe(markdown);
    });

    it('rejects when http.get rejects (no internal swallow)', async () => {
      const getMock = vi.fn().mockRejectedValue(new Error('export failed'));
      const service = new ImportExportService(makeStubHttp({ get: getMock }));

      await expect(service.exportMarkdown('order-service')).rejects.toThrow('export failed');
    });
  });

  // ── getQualityReport ──────────────────────────────────────────────────

  describe('getQualityReport()', () => {
    it('calls http.get with "/quality/report" when no service arg is given', async () => {
      const getMock = vi.fn().mockResolvedValue({ data: { data: sampleQualityReport } });
      const service = new ImportExportService(makeStubHttp({ get: getMock }));

      await service.getQualityReport();

      expect(getMock).toHaveBeenCalledTimes(1);
      expect(getMock).toHaveBeenCalledWith('/quality/report');
    });

    it('calls http.get with "/quality/report?service=user-service" when service arg is provided', async () => {
      const getMock = vi.fn().mockResolvedValue({ data: { data: sampleQualityReport } });
      const service = new ImportExportService(makeStubHttp({ get: getMock }));

      await service.getQualityReport('user-service');

      expect(getMock).toHaveBeenCalledTimes(1);
      expect(getMock).toHaveBeenCalledWith('/quality/report?service=user-service');
    });

    it('URL-encodes the service name when constructing the query string', async () => {
      const getMock = vi.fn().mockResolvedValue({ data: { data: sampleQualityReport } });
      const service = new ImportExportService(makeStubHttp({ get: getMock }));

      await service.getQualityReport('my service');

      expect(getMock).toHaveBeenCalledWith('/quality/report?service=my%20service');
    });

    it('returns response.data.data (double-unwrap — envelope-stripped inner report)', async () => {
      const getMock = vi.fn().mockResolvedValue({ data: { data: sampleQualityReport } });
      const service = new ImportExportService(makeStubHttp({ get: getMock }));

      const result = await service.getQualityReport();

      // Double-unwrap: the returned value is the inner QualityReport, NOT
      // the full axios response body ({ data: QualityReport }) and NOT the
      // raw axios response ({ data: { data: QualityReport } }).
      expect(result).toEqual(sampleQualityReport);
      expect(result.overall).toBe(85);
      expect(result.totalEntities).toBe(5);
      expect(result.packages).toHaveLength(1);
      expect(result.packages[0].name).toBe('order-service');
    });

    it('rejects when http.get rejects (no internal swallow)', async () => {
      const getMock = vi.fn().mockRejectedValue(new Error('quality report unavailable'));
      const service = new ImportExportService(makeStubHttp({ get: getMock }));

      await expect(service.getQualityReport()).rejects.toThrow('quality report unavailable');
    });
  });

  // ── Default construction ──────────────────────────────────────────────

  describe('default construction (no http arg)', () => {
    it('does not throw and produces an instance with all 10 public methods', () => {
      // Production callsite: `new ImportExportService()` builds the default
      // axios instance via createDefaultHttp(). We only assert the constructor
      // does not throw and the public surface is present — an actual HTTP call
      // would require MSW (see bootstrap test).
      const service = new ImportExportService();
      expect(service).toBeInstanceOf(ImportExportService);
      expect(typeof service.importJsonSchema).toBe('function');
      expect(typeof service.importSqlDdl).toBe('function');
      expect(typeof service.previewSqlDdl).toBe('function');
      expect(typeof service.previewOracleSchema).toBe('function');
      expect(typeof service.previewDbSchema).toBe('function');
      expect(typeof service.diffSqlDdl).toBe('function');
      expect(typeof service.commitSqlDdl).toBe('function');
      expect(typeof service.exportJsonSchema).toBe('function');
      expect(typeof service.exportMarkdown).toBe('function');
      expect(typeof service.getQualityReport).toBe('function');
    });
  });

  // ── Envelope asymmetry contract ───────────────────────────────────────

  describe('envelope asymmetry contract', () => {
    it('getQualityReport() unwraps TWO levels; all other methods unwrap ONE level', async () => {
      const innerReport = sampleQualityReport;
      const getMock = vi.fn();

      // getQualityReport: backend returns { data: QualityReport }
      // importExportService.getQualityReport() returns the inner QualityReport
      getMock.mockResolvedValueOnce({ data: { data: innerReport } });

      const service = new ImportExportService(makeStubHttp({ get: getMock }));

      const qualityResult = await service.getQualityReport();
      // The returned value must be the inner report — NOT { data: QualityReport }
      expect(qualityResult).toBe(innerReport);
      expect((qualityResult as unknown as { data: unknown }).data).toBeUndefined();
    });

    it('importJsonSchema() unwraps exactly ONE level — data.data would be undefined', async () => {
      const postMock = vi.fn().mockResolvedValue({ data: sampleImportResponse });
      const service = new ImportExportService(makeStubHttp({ post: postMock }));

      const result = await service.importJsonSchema({}, 'order-service');

      // Single-unwrap: result IS sampleImportResponse — has .data property
      expect(result).toEqual(sampleImportResponse);
      // If it were double-unwrapped we'd get sampleImportResponse.data — assert
      // the outer shape is preserved.
      expect((result as ImportResponse).data).toBeDefined();
    });
  });
});
