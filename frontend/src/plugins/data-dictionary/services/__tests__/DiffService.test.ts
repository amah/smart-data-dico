/**
 * #155-diff — DiffService unit suite.
 *
 * Covers spec acceptance criterion #9:
 *   - Service is constructed with a stub `AxiosInstance` (constructor
 *     injection — NOT vi.mock('axios')).
 *   - getLogical(left, right) calls `stubHttp.post` with '/diff/logical' and
 *     { left, right } and unwraps the { data: { ... } } envelope.
 *   - getPhysicalConfig('user-service') calls `stubHttp.get` with the
 *     literal '/services/user-service/physical-config'.
 *   - getPhysicalForService('user-service', source) calls `stubHttp.post`
 *     with '/diff/physical' and { service: 'user-service', source }.
 *   - getPhysicalAll(sources, services) calls `stubHttp.post` with
 *     '/diff/physical/all' and { sources, services }.
 *   - Every method rejects when the stub rejects (no internal swallow).
 *   - `new DiffService()` (no arg) does not throw and exposes all four
 *     methods.
 *   - Suite contains zero vi.mock( invocations.
 *
 * No MSW here. MSW is reserved for the bootstrap test. The service's
 * optional-AxiosInstance constructor parameter exists precisely for this
 * style of isolated unit test.
 */

import { describe, it, expect, vi } from 'vitest';
import type { AxiosInstance } from 'axios';

import {
  DiffService,
  type LogicalDiffOperand,
  type PhysicalDiffSource,
} from '../DiffService';

// ──────────────── Stub factory ────────────────

/**
 * Build a stub AxiosInstance containing only the methods DiffService
 * actually uses (get + post). Cast through `unknown` to satisfy the
 * AxiosInstance structural type — we intentionally do NOT implement the
 * full surface.
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

const leftOperand: LogicalDiffOperand = { type: 'service', name: 'user-service' };
const rightOperand: LogicalDiffOperand = { type: 'service', name: 'user-service' };

const ddlSource: PhysicalDiffSource = { type: 'ddl', sql: 'CREATE TABLE users (id INT);' };

const sampleLogicalResult = {
  packages: [],
  summary: { packages: {}, entities: {}, attributes: {}, relationships: {}, rules: {} },
};

const samplePhysicalConfig = { dialect: 'postgres', host: 'localhost' };

const samplePhysicalResult = {
  entities: [],
  summary: { matched: 0, modelOnly: 0, orphaned: 0, dbOnly: 0, drifted: 0, entities: {} },
};

const samplePhysicalAllResult = {
  byService: {},
  summary: { services: 0, ok: 0, failed: 0, matched: 0, drifted: 0, modelOnly: 0, orphaned: 0, dbOnly: 0 },
};

// ──────────────── Tests ────────────────

describe('DiffService — unit (constructor-injected http)', () => {
  describe('getLogical()', () => {
    it('calls http.post with the literal "/diff/logical" path and { left, right } body', async () => {
      const postMock = vi.fn().mockResolvedValue({ data: { data: sampleLogicalResult } });
      const service = new DiffService(makeStubHttp({ post: postMock }));

      await service.getLogical(leftOperand, rightOperand);

      expect(postMock).toHaveBeenCalledTimes(1);
      expect(postMock).toHaveBeenCalledWith('/diff/logical', { left: leftOperand, right: rightOperand });
    });

    it('unwraps the { data: { ... } } envelope and returns the inner result', async () => {
      const postMock = vi.fn().mockResolvedValue({ data: { data: sampleLogicalResult } });
      const service = new DiffService(makeStubHttp({ post: postMock }));

      const result = await service.getLogical(leftOperand, rightOperand);

      expect(result).toEqual(sampleLogicalResult);
    });

    it('supports git-ref operand type', async () => {
      const gitLeft: LogicalDiffOperand = { type: 'git-ref', ref: 'abc123', service: 'user-service' };
      const gitRight: LogicalDiffOperand = { type: 'git-ref', ref: 'HEAD' };
      const postMock = vi.fn().mockResolvedValue({ data: { data: {} } });
      const service = new DiffService(makeStubHttp({ post: postMock }));

      await service.getLogical(gitLeft, gitRight);

      expect(postMock).toHaveBeenCalledWith('/diff/logical', { left: gitLeft, right: gitRight });
    });

    it('rejects when http.post rejects (no internal swallow)', async () => {
      const postMock = vi.fn().mockRejectedValue(new Error('network error'));
      const service = new DiffService(makeStubHttp({ post: postMock }));

      await expect(service.getLogical(leftOperand, rightOperand)).rejects.toThrow('network error');
    });
  });

  describe('getPhysicalConfig()', () => {
    it('calls http.get with the literal "/services/user-service/physical-config" path', async () => {
      const getMock = vi.fn().mockResolvedValue({ data: { data: samplePhysicalConfig } });
      const service = new DiffService(makeStubHttp({ get: getMock }));

      await service.getPhysicalConfig('user-service');

      expect(getMock).toHaveBeenCalledTimes(1);
      expect(getMock).toHaveBeenCalledWith('/services/user-service/physical-config');
    });

    it('unwraps the envelope and returns the config row (including dialect field)', async () => {
      const getMock = vi.fn().mockResolvedValue({ data: { data: samplePhysicalConfig } });
      const service = new DiffService(makeStubHttp({ get: getMock }));

      const result = await service.getPhysicalConfig('user-service');

      expect(result).toEqual(samplePhysicalConfig);
      expect((result as { dialect?: string })?.dialect).toBe('postgres');
    });

    it('returns null when the backend returns null (no physical.yaml)', async () => {
      const getMock = vi.fn().mockResolvedValue({ data: { data: null } });
      const service = new DiffService(makeStubHttp({ get: getMock }));

      const result = await service.getPhysicalConfig('user-service');

      expect(result).toBeNull();
    });

    it('rejects when http.get rejects (no internal swallow)', async () => {
      const getMock = vi.fn().mockRejectedValue(new Error('not found'));
      const service = new DiffService(makeStubHttp({ get: getMock }));

      await expect(service.getPhysicalConfig('user-service')).rejects.toThrow('not found');
    });
  });

  describe('getPhysicalForService()', () => {
    it('calls http.post with "/diff/physical" and { service, source } body', async () => {
      const postMock = vi.fn().mockResolvedValue({ data: { data: samplePhysicalResult } });
      const service = new DiffService(makeStubHttp({ post: postMock }));

      await service.getPhysicalForService('user-service', ddlSource);

      expect(postMock).toHaveBeenCalledTimes(1);
      expect(postMock).toHaveBeenCalledWith('/diff/physical', {
        service: 'user-service',
        source: ddlSource,
      });
    });

    it('unwraps the envelope and returns the inner physical diff result', async () => {
      const postMock = vi.fn().mockResolvedValue({ data: { data: samplePhysicalResult } });
      const service = new DiffService(makeStubHttp({ post: postMock }));

      const result = await service.getPhysicalForService('user-service', ddlSource);

      expect(result).toEqual(samplePhysicalResult);
    });

    it('rejects when http.post rejects (no internal swallow)', async () => {
      const postMock = vi.fn().mockRejectedValue(new Error('server error'));
      const service = new DiffService(makeStubHttp({ post: postMock }));

      await expect(service.getPhysicalForService('user-service', ddlSource)).rejects.toThrow(
        'server error',
      );
    });
  });

  describe('getPhysicalAll()', () => {
    it('calls http.post with "/diff/physical/all" and { sources, services } body', async () => {
      const postMock = vi.fn().mockResolvedValue({ data: { data: samplePhysicalAllResult } });
      const service = new DiffService(makeStubHttp({ post: postMock }));

      const sources = { 'user-service': ddlSource };
      const serviceList = ['user-service'];

      await service.getPhysicalAll(sources, serviceList);

      expect(postMock).toHaveBeenCalledTimes(1);
      expect(postMock).toHaveBeenCalledWith('/diff/physical/all', {
        sources,
        services: serviceList,
      });
    });

    it('unwraps the envelope and returns the inner all-diff result', async () => {
      const postMock = vi.fn().mockResolvedValue({ data: { data: samplePhysicalAllResult } });
      const service = new DiffService(makeStubHttp({ post: postMock }));

      const result = await service.getPhysicalAll({ 'user-service': ddlSource });

      expect(result).toEqual(samplePhysicalAllResult);
    });

    it('omits the services argument when not provided (undefined passes through)', async () => {
      const postMock = vi.fn().mockResolvedValue({ data: { data: samplePhysicalAllResult } });
      const service = new DiffService(makeStubHttp({ post: postMock }));

      await service.getPhysicalAll({ 'user-service': ddlSource });

      const callArgs = postMock.mock.calls[0];
      // The body must still include { sources, services } — services is undefined
      expect(callArgs[1]).toHaveProperty('sources');
      expect(callArgs[1]).toHaveProperty('services');
    });

    it('rejects when http.post rejects (no internal swallow)', async () => {
      const postMock = vi.fn().mockRejectedValue(new Error('timeout'));
      const service = new DiffService(makeStubHttp({ post: postMock }));

      await expect(service.getPhysicalAll({ 'user-service': ddlSource })).rejects.toThrow('timeout');
    });
  });

  describe('impact and migration methods', () => {
    it('requests a single-service impact preview', async () => {
      const impact = { operations: [], summary: { safe: 0, caution: 0, destructive: 0 } };
      const postMock = vi.fn().mockResolvedValue({ data: { data: impact } });
      const service = new DiffService(makeStubHttp({ post: postMock }));

      expect(await service.getImpactForService('user-service', ddlSource, 'postgres')).toEqual(impact);
      expect(postMock).toHaveBeenCalledWith('/diff/impact', {
        service: 'user-service', source: ddlSource, dialect: 'postgres',
      });
    });

    it('downloads a migration with its response filename', async () => {
      const blob = new Blob(['SELECT 1;'], { type: 'text/sql' });
      const postMock = vi.fn().mockResolvedValue({
        data: blob,
        headers: { 'content-disposition': 'attachment; filename="model-migration.sql"' },
      });
      const service = new DiffService(makeStubHttp({ post: postMock }));

      const result = await service.exportMigration([], 'sql', { skipDestructive: true }, 'postgres');
      expect(result).toEqual({ blob, filename: 'model-migration.sql' });
      expect(postMock).toHaveBeenCalledWith(
        '/export/migration',
        { operations: [], format: 'sql', options: { skipDestructive: true }, dialect: 'postgres' },
        { responseType: 'blob' },
      );
    });
  });

  describe('default construction (no http arg)', () => {
    it('does not throw and produces an instance with the complete public surface', () => {
      // Production callsite: `new DiffService()` builds the default axios
      // instance via createDefaultHttp(). We only assert the constructor
      // does not throw and the public surface is present — an actual HTTP
      // call would require MSW (see bootstrap test).
      const service = new DiffService();
      expect(service).toBeInstanceOf(DiffService);
      expect(typeof service.getLogical).toBe('function');
      expect(typeof service.getPhysicalConfig).toBe('function');
      expect(typeof service.getPhysicalForService).toBe('function');
      expect(typeof service.getPhysicalAll).toBe('function');
      expect(typeof service.getImpactForService).toBe('function');
      expect(typeof service.getImpactAll).toBe('function');
      expect(typeof service.exportMigration).toBe('function');
      expect(typeof service.exportMigrationAll).toBe('function');
    });
  });
});
