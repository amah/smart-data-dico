/**
 * #155-search — Search plugin bootstrap test.
 *
 * Covers spec acceptance criterion #11:
 *   - bootstrapApplication() (the production singleton) completes.
 *   - host.rootActivationCtx.resolve(SEARCH_SERVICE_TOKEN) returns a real
 *     SearchService instance with a `searchEntities` method.
 *   - Repeated resolves return the same singleton (useValue provider).
 *
 * Also covers acceptance criterion #10 structurally: the bootstrap here
 * succeeds if and only if the `ctx.provide({ provide: SEARCH_SERVICE_TOKEN,
 * useValue: ... })` call is present inside `initialize` (not `activate`) and
 * registered before `activate` runs. A registration in `activate` would cause
 * `resolve` to throw here because the production host resolves tokens via the
 * root activation context, not the activation context of a single plugin.
 *
 * Mirrors dataDictionaryPlugin.integrity.test.ts exactly: one `beforeAll`
 * call to `bootstrapApplication()`, then assertions on the resolved service.
 *
 * Isolation: `bootstrapApplication()` is idempotent (returns early if already
 * bootstrapped). Running this file alongside other bootstrap tests in the same
 * Vitest worker is safe.
 */

import { describe, it, expect, beforeAll } from 'vitest';

import { bootstrapApplication, host } from '../../../kernel/bootstrap';
import { SEARCH_SERVICE_TOKEN } from '../../../kernel/tokens';
import type { SearchService } from '../services/SearchService';

beforeAll(async () => {
  await bootstrapApplication();
});

describe('searchPlugin — SEARCH_SERVICE_TOKEN bootstrap (#155-search criterion #11)', () => {
  it('bootstrapApplication() populates host.rootActivationCtx', () => {
    expect(host.rootActivationCtx).toBeDefined();
  });

  it('host.rootActivationCtx.resolve(SEARCH_SERVICE_TOKEN) returns a service with searchEntities()', () => {
    const ctx = host.rootActivationCtx!;
    const service = ctx.resolve<SearchService>(SEARCH_SERVICE_TOKEN);

    expect(service).toBeTruthy();
    expect(typeof service.searchEntities).toBe('function');
  });

  it('resolves the same singleton instance on repeated lookups (useValue provider)', () => {
    const ctx = host.rootActivationCtx!;
    const a = ctx.resolve<SearchService>(SEARCH_SERVICE_TOKEN);
    const b = ctx.resolve<SearchService>(SEARCH_SERVICE_TOKEN);
    expect(a).toBe(b);
  });
});
