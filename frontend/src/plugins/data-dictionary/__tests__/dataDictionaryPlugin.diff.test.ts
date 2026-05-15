/**
 * #155-diff — Plugin bootstrap test.
 *
 * Covers spec acceptance criterion #10:
 *   - bootstrapApplication() (the production singleton) completes.
 *   - host.rootActivationCtx.resolve(DIFF_SERVICE_TOKEN) returns a real
 *     DiffService with the four expected method names.
 *   - Repeated resolve() calls return the same instance (useValue singleton).
 *
 * Mirrors dataDictionaryPlugin.integrity.test.ts character-for-character:
 * the test calls the production `bootstrapApplication()` which mutates the
 * singleton `host` in place. No manual `new Host(...)`, no manual
 * `dependsOn` list — the full production plugin chain runs.
 *
 * Pattern B note: the DiffService instance is constructed eagerly at
 * `initialize` time (useValue provider). Its method shape is asserted
 * here without any HTTP traffic; the page-level tests cover actual HTTP
 * calls via MSW.
 *
 * Isolation: bootstrap is performed once in `beforeAll`. The singleton
 * host mutation is shared with any other `*.bootstrap.test.tsx` file in
 * the suite, but bootstrapApplication() is idempotent (returns early on
 * subsequent calls), so test-order does not affect the outcome.
 */

import { describe, it, expect, beforeAll } from 'vitest';

import { bootstrapApplication, host } from '../../../kernel/bootstrap';
import { DIFF_SERVICE_TOKEN } from '../../../kernel/tokens';
import type { DiffService } from '../services/DiffService';

beforeAll(async () => {
  await bootstrapApplication();
});

describe('dataDictionaryPlugin — DIFF_SERVICE_TOKEN bootstrap (#155-diff criterion #10)', () => {
  it('bootstrapApplication() populates host.rootActivationCtx', () => {
    expect(host.rootActivationCtx).toBeDefined();
  });

  it('host.rootActivationCtx.resolve(DIFF_SERVICE_TOKEN) returns a service with all four methods', () => {
    const ctx = host.rootActivationCtx!;
    const service = ctx.resolve<DiffService>(DIFF_SERVICE_TOKEN);

    expect(service).toBeTruthy();
    expect(typeof service.getLogical).toBe('function');
    expect(typeof service.getPhysicalConfig).toBe('function');
    expect(typeof service.getPhysicalForService).toBe('function');
    expect(typeof service.getPhysicalAll).toBe('function');
  });

  it('resolves the same singleton instance on repeated lookups (useValue provider)', () => {
    const ctx = host.rootActivationCtx!;
    const a = ctx.resolve<DiffService>(DIFF_SERVICE_TOKEN);
    const b = ctx.resolve<DiffService>(DIFF_SERVICE_TOKEN);
    expect(a).toBe(b);
  });
});
