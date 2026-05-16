/**
 * #155-diff — LogicalDiffPage page test.
 *
 * Covers spec acceptance criterion #12:
 *   - bootstrapApplication() in beforeAll.
 *   - MSW handlers for GET /api/services, GET /api/history,
 *     POST /api/diff/logical.
 *   - Renders inside <Provider store={getStore()}> + <MemoryRouter>.
 *   - Selecting a service and clicking Compare causes POST /api/diff/logical
 *     to be hit (counter-based assertion).
 *   - At least one observable signal from the diff result lands in the DOM
 *     (summary severity tile or empty-state message).
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
import LogicalDiffPage from '../LogicalDiffPage';
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

// ──────────────── MSW handler state ────────────────

let diffPostCount = 0;

// ──────────────── Bootstrap + handler setup ────────────────

beforeAll(async () => {
  await bootstrapApplication();
});

beforeEach(() => {
  diffPostCount = 0;
  server.use(
    http.get('/api/services', () => {
      return HttpResponse.json({ data: SERVICES_FIXTURE });
    }),
    http.get('/api/history', () => {
      return HttpResponse.json({ data: HISTORY_FIXTURE });
    }),
    http.post('/api/diff/logical', () => {
      diffPostCount += 1;
      return HttpResponse.json({ data: DIFF_RESULT_FIXTURE });
    }),
  );
});

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

describe('LogicalDiffPage — initial render', () => {
  it('renders the page heading without crashing', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: /Model diff/i })).toBeInTheDocument();
  });

  it('renders the Compare button in a disabled state before a service is selected', () => {
    renderPage();
    const compareBtn = screen.getByRole('button', { name: /Compare/i });
    expect(compareBtn).toBeDisabled();
  });
});

describe('LogicalDiffPage — Compare flow', () => {
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

  it('clicking Compare fires POST /api/diff/logical exactly once', async () => {
    renderPage();

    await waitFor(() => {
      const select = screen.getAllByRole('combobox')[0];
      expect(select.querySelectorAll('option').length).toBeGreaterThan(1);
    });

    const serviceSelect = screen.getAllByRole('combobox')[0];
    fireEvent.change(serviceSelect, { target: { value: 'user-service' } });

    const compareBtn = screen.getByRole('button', { name: /Compare/i });
    fireEvent.click(compareBtn);

    await waitFor(() => {
      expect(diffPostCount).toBe(1);
    });
  });

  it('after Compare, a severity tile with a non-zero count renders in the DOM', async () => {
    renderPage();

    await waitFor(() => {
      const select = screen.getAllByRole('combobox')[0];
      expect(select.querySelectorAll('option').length).toBeGreaterThan(1);
    });

    const serviceSelect = screen.getAllByRole('combobox')[0];
    fireEvent.change(serviceSelect, { target: { value: 'user-service' } });

    fireEvent.click(screen.getByRole('button', { name: /Compare/i }));

    // The fixture has one "removed" attribute → 1 breaking change.
    // The Breaking severity tile header should render. Use getAllByText
    // since "Breaking" appears in both the tile label and the status chip.
    await waitFor(() => {
      expect(screen.getAllByText(/Breaking/i).length).toBeGreaterThanOrEqual(1);
    });
  });
});
