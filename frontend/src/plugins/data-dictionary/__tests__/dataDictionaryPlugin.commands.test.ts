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
  'data-dictionary.diff.getImpactForService',
  'data-dictionary.diff.getImpactAll',
  'data-dictionary.diff.exportMigration',
  'data-dictionary.diff.exportMigrationAll',
  'data-dictionary.import-export.importJsonSchema',
  'data-dictionary.import-export.importSqlDdl',
  'data-dictionary.import-export.previewSqlDdl',
  'data-dictionary.import-export.previewDbSchema',
  'data-dictionary.import-export.diffSqlDdl',
  'data-dictionary.import-export.commitSqlDdl',
  'data-dictionary.import-export.exportJsonSchema',
  'data-dictionary.import-export.exportMarkdown',
  'data-dictionary.quality.getReport',
  // #161 — Case commands (7)
  'data-dictionary.case.list',
  'data-dictionary.case.getById',
  'data-dictionary.case.resolve',
  'data-dictionary.case.getGraphData',
  'data-dictionary.case.create',
  'data-dictionary.case.update',
  'data-dictionary.case.delete',
  // #161 — Rule commands (6)
  'data-dictionary.rule.list',
  'data-dictionary.rule.get',
  'data-dictionary.rule.getRulesForEntity',
  'data-dictionary.rule.create',
  'data-dictionary.rule.update',
  'data-dictionary.rule.delete',
] as const;

beforeAll(async () => {
  await bootstrapApplication();
});

// ── Acceptance #18 — all data-dictionary commands registered (18 pre-#161 + 13 #161) ──

describe('dataDictionaryPlugin — all data-dictionary commands registered', () => {
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
  // Install MSW handlers needed for the event-emitting command handlers.
  beforeEach(() => {
    server.use(
      // POST /api/cases → case create endpoint
      http.post('/api/cases', () => {
        return HttpResponse.json({
          data: {
            uuid: 'c-1',
            name: 'Test Case',
            rootEntities: [],
          },
        });
      }),

      // PUT /api/cases/:id → case update endpoint
      http.put('/api/cases/:id', () => {
        return HttpResponse.json({
          data: {
            uuid: 'c-1',
            name: 'Updated Case',
            rootEntities: [],
          },
        });
      }),

      // DELETE /api/cases/:id → case delete endpoint
      http.delete('/api/cases/:id', () => {
        return new HttpResponse(null, { status: 204 });
      }),

      // POST /api/rules → rule create endpoint
      http.post('/api/rules', () => {
        return HttpResponse.json({
          data: {
            uuid: 'r-1',
            name: 'test-rule',
            description: 'A test rule',
            severity: 'warning',
            enforcement: 'advisory',
            scope: 'package',
            targets: [],
          },
        });
      }),

      // PUT /api/rules/:uuid → rule update endpoint
      http.put('/api/rules/:uuid', () => {
        return HttpResponse.json({
          data: {
            uuid: 'r-1',
            name: 'updated-rule',
            description: 'Updated rule',
            severity: 'warning',
            enforcement: 'advisory',
            scope: 'package',
            targets: [],
          },
        });
      }),

      // DELETE /api/rules/:uuid → rule delete endpoint
      http.delete('/api/rules/:uuid', () => {
        return new HttpResponse(null, { status: 204 });
      }),

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

  it('case.create command emits "case.changed" with { uuid, op: "create" }', async () => {
    const ctx = host.rootActivationCtx!;
    const received: Array<{ uuid: string; op: string }> = [];

    const listener = (payload: { uuid: string; op: string }) => {
      received.push(payload);
    };
    ctx.hooks.on('case.changed', listener);

    await ctx.commands.run('data-dictionary.case.create', {
      data: { name: 'Test Case', rootEntities: [] },
    });

    ctx.hooks.off('case.changed', listener);

    expect(received.length).toBeGreaterThanOrEqual(1);
    const last = received[received.length - 1];
    expect(last.uuid).toBe('c-1');
    expect(last.op).toBe('create');
  });

  it('case.delete command emits "case.changed" with { uuid, op: "delete" }', async () => {
    const ctx = host.rootActivationCtx!;
    const received: Array<{ uuid: string; op: string }> = [];

    const listener = (payload: { uuid: string; op: string }) => {
      received.push(payload);
    };
    ctx.hooks.on('case.changed', listener);

    await ctx.commands.run('data-dictionary.case.delete', { id: 'c-to-delete' });

    ctx.hooks.off('case.changed', listener);

    expect(received.length).toBeGreaterThanOrEqual(1);
    const last = received[received.length - 1];
    expect(last.uuid).toBe('c-to-delete');
    expect(last.op).toBe('delete');
  });

  it('rule.update command emits "rule.changed" with { uuid, op: "update" }', async () => {
    const ctx = host.rootActivationCtx!;
    const received: Array<{ uuid: string; op: string }> = [];

    const listener = (payload: { uuid: string; op: string }) => {
      received.push(payload);
    };
    ctx.hooks.on('rule.changed', listener);

    await ctx.commands.run('data-dictionary.rule.update', {
      uuid: 'r-1',
      data: { name: 'updated-rule' },
    });

    ctx.hooks.off('rule.changed', listener);

    expect(received.length).toBeGreaterThanOrEqual(1);
    const last = received[received.length - 1];
    expect(last.uuid).toBe('r-1');
    expect(last.op).toBe('update');
  });

  it('rule.delete command emits "rule.changed" with { uuid, op: "delete" }', async () => {
    const ctx = host.rootActivationCtx!;
    const received: Array<{ uuid: string; op: string }> = [];

    const listener = (payload: { uuid: string; op: string }) => {
      received.push(payload);
    };
    ctx.hooks.on('rule.changed', listener);

    await ctx.commands.run('data-dictionary.rule.delete', { uuid: 'r-to-delete' });

    ctx.hooks.off('rule.changed', listener);

    expect(received.length).toBeGreaterThanOrEqual(1);
    const last = received[received.length - 1];
    expect(last.uuid).toBe('r-to-delete');
    expect(last.op).toBe('delete');
  });
});
