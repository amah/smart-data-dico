/**
 * #163 Slice 1 — data-dictionary plugin command registration tests.
 *
 * Covers spec acceptance criteria #18 and #19:
 *
 * #18 — Runtime registration verified.
 *   After `bootstrapAllAtRoot()`, for each of the 18 data-dictionary.*
 *   command names, `host.rootActivationCtx.commands.has(name)` is true.
 *
 * #19 — Event emission verified.
 *   - Invoking `data-dictionary.stereotype.create` (with MSW stubbing
 *     `POST /api/stereotypes`) fires `stereotype.changed` listener with
 *     `{ id, op: 'create' }`.
 *   - Invoking `data-dictionary.import-export.commitSqlDdl` (with MSW
 *     stubbing `POST /api/import/sql-ddl/commit` to return a non-null data)
 *     fires `import-export.committed` listener with the payload fields.
 *   - Invoking `data-dictionary.quality.getReport` (with MSW stubbing
 *     `GET /api/quality/report`) fires `quality.report.refreshed` listener
 *     with `{ service, overall }`.
 *
 * Note on Phase 4 deferral: the spec deferred the cross-plugin
 * `entity.deleted` → search/visualization/integrity flow. Slice 1 has only
 * these three in-plugin event emits. The assertion set here covers exactly
 * what is currently emitted — no aspirational events.
 *
 * Bootstrap strategy: same as `dataDictionaryPlugin.integrity.test.ts` —
 * the production `bootstrapApplication()` mutates the singleton `host`.
 * `bootstrapApplication()` is idempotent so running this file alongside
 * other bootstrap tests is safe.
 */

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { http, HttpResponse } from 'msw';

import { bootstrapApplication, host } from '../../../kernel/bootstrap';
import { server } from '../../../test/setup';

const ALL_DD_COMMAND_NAMES = [
  'data-dictionary.stereotype.loadAll',
  'data-dictionary.stereotype.create',
  'data-dictionary.stereotype.update',
  'data-dictionary.stereotype.delete',
  'data-dictionary.integrity.getReport',
  'data-dictionary.diff.getLogical',
  'data-dictionary.diff.getPhysicalConfig',
  'data-dictionary.diff.getPhysicalForService',
  'data-dictionary.diff.getPhysicalAll',
  'data-dictionary.import-export.importJsonSchema',
  'data-dictionary.import-export.importSqlDdl',
  'data-dictionary.import-export.previewSqlDdl',
  'data-dictionary.import-export.previewDbSchema',
  'data-dictionary.import-export.diffSqlDdl',
  'data-dictionary.import-export.commitSqlDdl',
  'data-dictionary.import-export.exportJsonSchema',
  'data-dictionary.import-export.exportMarkdown',
  'data-dictionary.quality.getReport',
] as const;

beforeAll(async () => {
  await bootstrapApplication();
});

// ── Acceptance #18 — all 18 data-dictionary commands registered ───────────

describe('dataDictionaryPlugin — #163 acceptance #18 — all 18 commands registered', () => {
  it('bootstrapApplication() populates host.rootActivationCtx', () => {
    expect(host.rootActivationCtx).toBeDefined();
  });

  for (const name of ALL_DD_COMMAND_NAMES) {
    it(`commands.has('${name}') is true after bootstrap`, () => {
      const ctx = host.rootActivationCtx!;
      expect(ctx.commands.has(name)).toBe(true);
    });
  }
});

// ── Acceptance #19 — event emission verified ─────────────────────────────

describe('dataDictionaryPlugin — #163 acceptance #19 — event emission', () => {
  // Install MSW handlers needed for the three event-emitting command handlers.
  beforeEach(() => {
    server.use(
      // POST /api/stereotypes → stereotype create endpoint
      http.post('/api/stereotypes', () => {
        return HttpResponse.json({
          data: {
            id: 'test-stereotype-id',
            name: 'Test Stereotype',
            description: 'Created for event test',
            domain: 'Test',
            appliesTo: 'entity' as const,
            metadataDefinitions: [],
          },
        });
      }),

      // POST /api/stereotypes/:id → stereotype update endpoint
      http.put('/api/stereotypes/:id', () => {
        return HttpResponse.json({
          data: {
            id: 'existing-id',
            name: 'Updated Stereotype',
            description: 'Updated',
            domain: 'Test',
            appliesTo: 'entity' as const,
            metadataDefinitions: [],
          },
        });
      }),

      // DELETE /api/stereotypes/:id → stereotype delete endpoint
      http.delete('/api/stereotypes/:id', () => {
        return new HttpResponse(null, { status: 204 });
      }),

      // POST /api/import/sql-ddl/commit → commitSqlDdl endpoint
      http.post('/api/import/sql-ddl/commit', () => {
        return HttpResponse.json({
          data: {
            added: 2,
            merged: 1,
            unchanged: 3,
            removedInSource: 0,
            written: 3,
            errors: [],
          },
        });
      }),

      // GET /api/quality/report → quality report endpoint
      http.get('/api/quality/report', () => {
        return HttpResponse.json({
          data: {
            overall: 82,
            totalEntities: 10,
            totalAttributes: 40,
            packages: [],
          },
        });
      }),
    );
  });

  it('stereotype.create command emits "stereotype.changed" with { id, op: "create" }', async () => {
    const ctx = host.rootActivationCtx!;
    const received: Array<{ id: string; op: string }> = [];

    const listener = (payload: { id: string; op: string }) => {
      received.push(payload);
    };
    ctx.hooks.on('stereotype.changed', listener);

    await ctx.commands.run('data-dictionary.stereotype.create', {
      data: {
        id: '',
        name: 'New Stereotype',
        description: 'desc',
        domain: 'DDD',
        appliesTo: 'entity',
        metadataDefinitions: [],
      },
    });

    ctx.hooks.off('stereotype.changed', listener);

    expect(received.length).toBeGreaterThanOrEqual(1);
    const last = received[received.length - 1];
    expect(last.id).toBe('test-stereotype-id');
    expect(last.op).toBe('create');
  });

  it('stereotype.update command emits "stereotype.changed" with { id, op: "update" }', async () => {
    const ctx = host.rootActivationCtx!;
    const received: Array<{ id: string; op: string }> = [];

    const listener = (payload: { id: string; op: string }) => {
      received.push(payload);
    };
    ctx.hooks.on('stereotype.changed', listener);

    await ctx.commands.run('data-dictionary.stereotype.update', {
      id: 'existing-id',
      data: { name: 'Updated' },
    });

    ctx.hooks.off('stereotype.changed', listener);

    expect(received.length).toBeGreaterThanOrEqual(1);
    const last = received[received.length - 1];
    expect(last.id).toBe('existing-id');
    expect(last.op).toBe('update');
  });

  it('stereotype.delete command emits "stereotype.changed" with { id, op: "delete" }', async () => {
    const ctx = host.rootActivationCtx!;
    const received: Array<{ id: string; op: string }> = [];

    const listener = (payload: { id: string; op: string }) => {
      received.push(payload);
    };
    ctx.hooks.on('stereotype.changed', listener);

    await ctx.commands.run('data-dictionary.stereotype.delete', { id: 'to-delete' });

    ctx.hooks.off('stereotype.changed', listener);

    expect(received.length).toBeGreaterThanOrEqual(1);
    const last = received[received.length - 1];
    expect(last.id).toBe('to-delete');
    expect(last.op).toBe('delete');
  });

  it('import-export.commitSqlDdl emits "import-export.committed" with the payload fields', async () => {
    const ctx = host.rootActivationCtx!;
    const received: Array<unknown> = [];

    const listener = (payload: unknown) => {
      received.push(payload);
    };
    ctx.hooks.on('import-export.committed', listener);

    await ctx.commands.run('data-dictionary.import-export.commitSqlDdl', {
      parsed: [{ tableName: 'orders' }],
      targetService: 'order-service',
    });

    ctx.hooks.off('import-export.committed', listener);

    expect(received.length).toBeGreaterThanOrEqual(1);
    const last = received[received.length - 1] as Record<string, unknown>;
    expect(last.service).toBe('order-service');
    expect(last.added).toBe(2);
    expect(last.merged).toBe(1);
    expect(last.unchanged).toBe(3);
    expect(last.removedInSource).toBe(0);
    expect(last.written).toBe(3);
  });

  it('quality.getReport emits "quality.report.refreshed" with { service, overall }', async () => {
    const ctx = host.rootActivationCtx!;
    const received: Array<unknown> = [];

    const listener = (payload: unknown) => {
      received.push(payload);
    };
    ctx.hooks.on('quality.report.refreshed', listener);

    await ctx.commands.run('data-dictionary.quality.getReport', { service: undefined });

    ctx.hooks.off('quality.report.refreshed', listener);

    expect(received.length).toBeGreaterThanOrEqual(1);
    const last = received[received.length - 1] as Record<string, unknown>;
    expect(last.overall).toBe(82);
  });
});
