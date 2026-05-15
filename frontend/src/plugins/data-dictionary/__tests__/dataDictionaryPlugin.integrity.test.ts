/**
 * #155 integrity-slice pilot — Plugin bootstrap test.
 *
 * Covers spec acceptance criterion #9:
 *   - bootstrapApplication() (the production singleton) completes.
 *   - host.rootActivationCtx.resolve(INTEGRITY_SERVICE_TOKEN) returns a
 *     real IntegrityService with the expected method shape.
 *
 * Mirrors the StereotypesPage.bootstrap.test.tsx precedent (PR #172): the
 * test calls the production `bootstrapApplication()` which mutates the
 * singleton `host` in place. No manual `new Host(...)`, no manual
 * `dependsOn` list — the full production plugin chain runs.
 *
 * Pattern B note: the IntegrityService instance is constructed eagerly at
 * `initialize` time (useValue provider). Its method shape is asserted
 * here without any HTTP traffic; the page-level test covers an actual
 * `getReport()` call via MSW.
 *
 * Isolation: bootstrap is performed once in `beforeAll`. The singleton
 * host mutation is shared with any other `*.bootstrap.test.tsx` file in
 * the suite, but bootstrapApplication() is idempotent (returns early on
 * subsequent calls), so test-order does not affect the outcome.
 */

import { describe, it, expect, beforeAll } from 'vitest';

import { bootstrapApplication, host } from '../../../kernel/bootstrap';
import { INTEGRITY_SERVICE_TOKEN } from '../../../kernel/tokens';
import type { IntegrityService } from '../services/IntegrityService';

beforeAll(async () => {
  await bootstrapApplication();
});

describe('dataDictionaryPlugin — INTEGRITY_SERVICE_TOKEN bootstrap (#155 criterion #9)', () => {
  it('bootstrapApplication() populates host.rootActivationCtx', () => {
    expect(host.rootActivationCtx).toBeDefined();
  });

  it('host.rootActivationCtx.resolve(INTEGRITY_SERVICE_TOKEN) returns a service with getReport()', () => {
    const ctx = host.rootActivationCtx!;
    const service = ctx.resolve<IntegrityService>(INTEGRITY_SERVICE_TOKEN);

    expect(service).toBeTruthy();
    expect(typeof service.getReport).toBe('function');
  });

  it('resolves the same singleton instance on repeated lookups (useValue provider)', () => {
    const ctx = host.rootActivationCtx!;
    const a = ctx.resolve<IntegrityService>(INTEGRITY_SERVICE_TOKEN);
    const b = ctx.resolve<IntegrityService>(INTEGRITY_SERVICE_TOKEN);
    expect(a).toBe(b);
  });
});
