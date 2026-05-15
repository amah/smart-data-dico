/**
 * #155-import-export — Plugin bootstrap test.
 *
 * Covers spec acceptance criterion #8:
 *   - bootstrapApplication() (the production singleton) completes.
 *   - host.rootActivationCtx.resolve(IMPORT_EXPORT_SERVICE_TOKEN) returns a
 *     real ImportExportService with all 10 expected methods.
 *   - Repeated resolve() calls return the same instance (useValue singleton).
 *
 * Mirrors dataDictionaryPlugin.integrity.test.ts and
 * dataDictionaryPlugin.diff.test.ts character-for-character: the test
 * calls the production `bootstrapApplication()` which mutates the singleton
 * `host` in place. No manual `new Host(...)`, no manual `dependsOn` list —
 * the full production plugin chain runs.
 *
 * Pattern B note: the ImportExportService instance is constructed eagerly at
 * `initialize` time (useValue provider). Its method shape is asserted here
 * without any HTTP traffic; the SchemaImportWizard.test.tsx covers actual
 * HTTP calls via MSW.
 *
 * Isolation: bootstrap is performed once in `beforeAll`. The singleton host
 * mutation is shared with any other bootstrap test in the suite, but
 * bootstrapApplication() is idempotent (returns early on subsequent calls),
 * so test-order does not affect the outcome.
 */

import { describe, it, expect, beforeAll } from 'vitest';

import { bootstrapApplication, host } from '../../../kernel/bootstrap';
import { IMPORT_EXPORT_SERVICE_TOKEN } from '../../../kernel/tokens';
import type { ImportExportService } from '../services/ImportExportService';

beforeAll(async () => {
  await bootstrapApplication();
});

describe('dataDictionaryPlugin — IMPORT_EXPORT_SERVICE_TOKEN bootstrap (#155-import-export criterion #8)', () => {
  it('bootstrapApplication() populates host.rootActivationCtx', () => {
    expect(host.rootActivationCtx).toBeDefined();
  });

  it('host.rootActivationCtx.resolve(IMPORT_EXPORT_SERVICE_TOKEN) returns a service with all 10 methods', () => {
    const ctx = host.rootActivationCtx!;
    const service = ctx.resolve<ImportExportService>(IMPORT_EXPORT_SERVICE_TOKEN);

    expect(service).toBeTruthy();
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

  it('resolves the same singleton instance on repeated lookups (useValue provider)', () => {
    const ctx = host.rootActivationCtx!;
    const a = ctx.resolve<ImportExportService>(IMPORT_EXPORT_SERVICE_TOKEN);
    const b = ctx.resolve<ImportExportService>(IMPORT_EXPORT_SERVICE_TOKEN);
    expect(a).toBe(b);
  });
});
