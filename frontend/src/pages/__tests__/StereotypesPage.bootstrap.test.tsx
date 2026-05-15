/**
 * #166 stereotype-slice pilot — End-to-end bootstrap + page render.
 *
 * Covers spec acceptance criterion #12:
 *   - bootstrapApplication() (the production singleton) completes.
 *   - host.rootActivationCtx.resolve(STEREOTYPE_SERVICE_TOKEN) returns a
 *     StereotypeService with the expected method shape.
 *   - <StereotypesPage /> renders without throwing
 *     "useService called before host bootstrap completed".
 *   - FIRST PAINT = loading state: synchronously after `render(...)` (before
 *     awaiting MSW), the DOM contains the "Loading stereotypes…" message.
 *     This pins the cookbook-canonical loading derivation per patterns.md §2.
 *   - GET /api/stereotypes is intercepted exactly once on mount.
 *   - After the fetch resolves, the fixture's stereotype name appears in the
 *     DOM.
 *
 * Isolation: this test calls the real `bootstrapApplication()` which
 * mutates the singleton `host`. Per spec note on criterion #12, the test
 * lives in its own file with no shared beforeEach affecting the singleton.
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { render, screen, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import React from 'react';

import { bootstrapApplication, host, getStore } from '../../kernel/bootstrap';
import { STEREOTYPE_SERVICE_TOKEN } from '../../kernel/tokens';
import StereotypesPage from '../StereotypesPage';
import type { StereotypeService } from '../../plugins/data-dictionary/services/StereotypeService';
import { server } from '../../test/setup';
import type { Stereotype } from '../../types';

const FIXTURE: Stereotype[] = [
  {
    id: 'aggregate-root',
    name: 'Aggregate Root',
    description: 'DDD aggregate-root marker',
    domain: 'DDD',
    appliesTo: 'entity',
    metadataDefinitions: [],
  },
];

let getCallCount = 0;

beforeAll(async () => {
  // The production singleton bootstrap mutates `host` in place. After it
  // resolves, host.rootActivationCtx is defined. We do this once and rely
  // on the singleton across all tests in this file (per spec criterion
  // #12 note on isolation).
  await bootstrapApplication();
});

beforeEach(() => {
  // Re-install the MSW handler after src/test/setup.ts's afterEach calls
  // server.resetHandlers(). The third test below is the only one that
  // exercises the GET path; the first two assert DI shape only.
  server.use(
    http.get('/api/stereotypes', () => {
      getCallCount += 1;
      return HttpResponse.json({ data: FIXTURE });
    }),
  );
});

describe('StereotypesPage — production-singleton bootstrap (#12)', () => {
  it('bootstrapApplication() populates host.rootActivationCtx', () => {
    expect(host.rootActivationCtx).toBeDefined();
  });

  it('host.rootActivationCtx.resolve(STEREOTYPE_SERVICE_TOKEN) returns a service with the expected method shape', () => {
    const ctx = host.rootActivationCtx!;
    const service = ctx.resolve<StereotypeService>(STEREOTYPE_SERVICE_TOKEN);
    expect(service).toBeTruthy();

    const methods = [
      'useFile',
      'useAll',
      'loadAll',
      'create',
      'update',
      'delete',
    ] as const;
    for (const m of methods) {
      expect(
        typeof (service as unknown as Record<string, unknown>)[m],
      ).toBe('function');
    }
  });

  it('renders the page without throwing "useService called before host bootstrap completed"; first paint is loading; after fetch resolves, the fixture name appears; GET /api/stereotypes is called exactly once on mount', async () => {
    const beforeCount = getCallCount;
    const store = getStore();

    const view = render(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      React.createElement(Provider as any, { store }, React.createElement(StereotypesPage)),
    );

    // FIRST PAINT — synchronous, before any awaits. The cookbook-canonical
    // loading derivation `loading = !file || (!file.state.contentLoaded
    // && !file.state.contentLoadError)` evaluates true when `file` is
    // undefined on first render. The page MUST show the loading EmptyState.
    expect(view.container.textContent ?? '').toContain('Loading stereotypes');

    // After the mount-effect's loadAll() resolves, the fixture name lands
    // in the DOM via service.useAll() re-render.
    await waitFor(() => {
      expect(screen.getByText(FIXTURE[0].name)).toBeInTheDocument();
    });

    // Exactly one GET on mount (the effect's dependency `[service, loaded]`
    // re-runs only when `loaded` flips; after the first successful load,
    // `loaded === true` so the effect's `if (!loaded)` guard skips re-runs).
    expect(getCallCount - beforeCount).toBe(1);
  });
});
