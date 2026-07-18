/**
 * #155-diff — LogicalDiffPage page test.
 *
 * Covers spec acceptance criterion #12:
 *   - bootstrapApplication() in beforeAll.
 *   - MSW handlers for GET /api/services and GET /api/history.
 *   - Renders inside <Provider store={getStore()}> + <MemoryRouter>.
 *   - Selecting a service enables comparison.
 *   - HEAD/working-copy operand construction and rendered change-row coverage.
 *
 * Criterion #14: does NOT use vi.mock('../../services/api', ...).
 * The legacy diff API export is gone; the page uses useService(DIFF_SERVICE_TOKEN).
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Provider } from 'react-redux';
import React from 'react';

import { bootstrapApplication, getStore } from '../../kernel/bootstrap';
import LogicalDiffPage, { buildChangeRows, buildLogicalOperand, buildRefOptions } from '../LogicalDiffPage';
import { server } from '../../test/setup';

// ──────────────── Fixtures ────────────────

const SERVICES_FIXTURE = ['user-service', 'order-service'];

const HISTORY_FIXTURE = [
  { hash: 'abc1234', message: 'feat: add user entity', author: 'Alice', date: '2026-01-01' },
  { hash: 'def5678', message: 'fix: update order total', author: 'Bob', date: '2026-01-02' },
];

// A minimal LogicalDiff result that produces at least one change row so a
// severity tile renders with a non-zero count.
const DIFF_RESULT_FIXTURE = {
  packages: [
    {
      status: 'changed',
      packageName: 'user-service',
      entities: [
        {
          status: 'changed',
          entityUuid: 'e-user',
          entityName: 'User',
          attributes: [
            {
              status: 'removed',
              attributeUuid: 'a-old',
              attributeName: 'legacyField',
              changedFields: [],
            },
          ],
          constraints: [],
          changedFields: [],
        },
      ],
      relationships: [],
      rules: [],
      counts: {},
    },
  ],
  summary: {
    packages: { changed: 1 },
    entities: { changed: 1 },
    attributes: { removed: 1 },
    relationships: {},
    rules: {},
  },
};

// ──────────────── Bootstrap + handler setup ────────────────

// ──────────────── Helpers ────────────────

const renderPage = () => {
  const store = getStore();
  return render(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    React.createElement(
      Provider as any,
      { store },
      React.createElement(
        MemoryRouter,
        null,
        React.createElement(LogicalDiffPage),
      ),
    ),
  );
};

// ──────────────── Tests ────────────────

describe('LogicalDiffPage — rendered behavior', () => {
  beforeAll(async () => {
    await bootstrapApplication();
  });

  beforeEach(() => {
    server.use(
      http.get('/api/services', () => {
        return HttpResponse.json({ data: SERVICES_FIXTURE });
      }),
      http.get('/api/history', () => {
        return HttpResponse.json({ data: HISTORY_FIXTURE });
      }),
    );
  });

  it('renders the page heading without crashing', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: /Model diff/i })).toBeInTheDocument();
  });

  it('renders the Compare button in a disabled state before a service is selected', () => {
    renderPage();
    const compareBtn = screen.getByRole('button', { name: /Compare/i });
    expect(compareBtn).toBeDisabled();
  });
  it('selecting a service enables the Compare button', async () => {
    renderPage();

    // Wait for the services dropdown to be populated from the MSW handler.
    await waitFor(() => {
      const select = screen.getAllByRole('combobox')[0];
      expect(select.querySelectorAll('option').length).toBeGreaterThan(1);
    });

    const serviceSelect = screen.getAllByRole('combobox')[0];
    fireEvent.change(serviceSelect, { target: { value: 'user-service' } });

    const compareBtn = screen.getByRole('button', { name: /Compare/i });
    expect(compareBtn).not.toBeDisabled();
  });

});

describe('LogicalDiffPage — diff projection', () => {
  it('groups local and remote branches before individual commits', () => {
    const options = buildRefOptions(
      {
        current: 'main',
        local: ['main', 'feature/orders'],
        remote: ['remotes/origin/main'],
      },
      [{ hash: 'abc123456', message: 'feat: add orders' }],
    );

    expect(options).toEqual(expect.arrayContaining([
      { value: 'main', label: 'main (current)', group: 'Local branches' },
      { value: 'feature/orders', label: 'feature/orders', group: 'Local branches' },
      { value: 'remotes/origin/main', label: 'origin/main', group: 'Remote branches' },
      { value: 'abc123456', label: 'abc1234 — feat: add orders', group: 'Commits' },
    ]));
  });

  it('maps the default comparison to a real HEAD snapshot before the working copy', () => {
    expect(buildLogicalOperand('user-service', 'HEAD')).toEqual({ type: 'git-ref', ref: 'HEAD', service: 'user-service' });
    expect(buildLogicalOperand('user-service', '')).toEqual({ type: 'service', name: 'user-service' });
  });

  it('builds visible rows for empty package removal and constraint changes', () => {
    const rows = buildChangeRows({
      packages: [
        { status: 'removed', packageName: 'legacy-service', entities: [], relationships: [], rules: [], counts: {} },
        {
          status: 'changed', packageName: 'user-service', relationships: [], counts: {},
          rules: [{
            status: 'changed', ruleUuid: 'r-positive', ruleName: 'order-total-positive',
            left: { name: 'order-total-positive' },
            right: { name: 'order-total-positive', enforcement: 'advisory' },
            changedFields: ['enforcement'],
          }],
          entities: [{
            status: 'changed', entityUuid: 'e-user', entityName: 'User', attributes: [], changedFields: [],
            constraints: [{
              status: 'added', key: 'name:uq_user_email',
              right: { kind: 'unique', name: 'uq_user_email', columns: ['email'] },
            }],
          }],
        },
      ],
      summary: DIFF_RESULT_FIXTURE.summary,
    } as any);

    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ scope: 'package', subject: 'legacy-service', before: 'legacy-service', after: undefined }),
      expect.objectContaining({ scope: 'constraint', subject: 'uq_user_email', before: '', after: 'uq_user_email (email)' }),
      expect.objectContaining({
        scope: 'rule', subject: 'order-total-positive',
        before: 'enforcement: Not set', after: 'enforcement: advisory',
      }),
    ]));
  });
});
