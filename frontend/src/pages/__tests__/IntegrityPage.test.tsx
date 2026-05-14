/**
 * Tests for the Integrity page (#85 R5 / rollout 4.3) — #155 pilot rewrite.
 *
 * Post-#155 the page resolves its data source via
 * `useService(INTEGRITY_SERVICE_TOKEN)` from the bootstrapped kernel host,
 * so the legacy `vi.mock('../../services/api', ...)` harness no longer
 * applies (the legacy axios sub-API was deleted by the pilot).
 *
 * New harness — covers spec acceptance criterion #10:
 *   - `beforeAll` calls the production `bootstrapApplication()` once so
 *     `useService(INTEGRITY_SERVICE_TOKEN)` resolves the real service.
 *   - `beforeEach` re-installs the `/api/integrity` MSW handler (the
 *     suite-wide `src/test/setup.ts` runs `server.resetHandlers()` in
 *     afterEach, so beforeAll registration would not survive).
 *   - The page is rendered inside the production `<Provider store={getStore()}>`.
 *   - Existing assertion intent is preserved: tab counts, all-tab unified
 *     view, Validation/Constraints/Rules tab filtering, search filtering
 *     across categories, search-driven count updates, Needs-attention
 *     preset behavior, and the error-state surface.
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Provider } from 'react-redux';
import React from 'react';

import { bootstrapApplication, getStore } from '../../kernel/bootstrap';
import IntegrityPage from '../IntegrityPage';
import { server } from '../../test/setup';

const sampleReport = {
  validation: [
    {
      service: 'user-service',
      entityUuid: 'e-user',
      entityName: 'User',
      attributeUuid: 'a-username',
      attributeName: 'username',
      kind: 'maxLength',
      value: 50,
    },
    {
      service: 'user-service',
      entityUuid: 'e-user',
      entityName: 'User',
      attributeUuid: 'a-website',
      attributeName: 'website',
      kind: 'format',
      value: 'uri',
    },
  ],
  constraints: [
    {
      service: 'user-service',
      entityUuid: 'e-user',
      entityName: 'User',
      constraint: { kind: 'unique', name: 'uq_users_email', columns: ['email'] },
    },
    {
      service: 'order-service',
      entityUuid: 'e-order',
      entityName: 'Order',
      constraint: { kind: 'check', name: 'chk_total', expression: 'total >= 0' },
    },
  ],
  rules: [
    {
      uuid: 'r-1',
      name: 'order-total-positive',
      description: 'Order total must be positive.',
      severity: 'error' as const,
      enforcement: 'save' as const,
      scope: 'package' as const,
      packageName: 'order-service',
      targets: [],
    },
  ],
};

// Flag toggled by the per-test beforeEach so individual cases can opt into
// an error response without redefining the whole MSW handler.
let failFetch = false;

beforeAll(async () => {
  await bootstrapApplication();
});

beforeEach(() => {
  failFetch = false;
  server.use(
    http.get('/api/integrity', () => {
      if (failFetch) {
        return new HttpResponse(null, { status: 500 });
      }
      return HttpResponse.json({ data: sampleReport });
    }),
  );
});

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
        React.createElement(IntegrityPage),
      ),
    ),
  );
};

describe('IntegrityPage — initial render', () => {
  it('renders the page header and surfaces the fetched report on mount', async () => {
    renderPage();
    expect(screen.getByRole('heading', { name: /Integrity/i })).toBeInTheDocument();
    // The fixture's `username` validation row landing in the DOM is the
    // observable signal that the mount-effect fetch completed.
    await screen.findByText('username');
  });

  it('shows tab counts derived from the loaded payload', async () => {
    renderPage();
    await screen.findByText('username');
    // Tab counts: All=5, Validation=2, Constraints=2, Rules=1
    const allTab = screen.getByRole('tab', { name: /All\b/i });
    expect(within(allTab).getByText('5')).toBeInTheDocument();
    const validationTab = screen.getByRole('tab', { name: /Validation/i });
    expect(within(validationTab).getByText('2')).toBeInTheDocument();
    const constraintsTab = screen.getByRole('tab', { name: /Constraints/i });
    expect(within(constraintsTab).getByText('2')).toBeInTheDocument();
    const rulesTab = screen.getByRole('tab', { name: /Rules/i });
    expect(within(rulesTab).getByText('1')).toBeInTheDocument();
  });

  it('renders all three categories on the All tab', async () => {
    renderPage();
    await screen.findByText('username');
    expect(screen.getByText('website')).toBeInTheDocument();
    expect(screen.getByText('uq_users_email')).toBeInTheDocument();
    expect(screen.getByText('chk_total')).toBeInTheDocument();
    expect(screen.getByText('order-total-positive')).toBeInTheDocument();
  });
});

describe('IntegrityPage — tab switching', () => {
  it('Validation tab hides constraint and rule rows', async () => {
    renderPage();
    await screen.findByText('username');

    fireEvent.click(screen.getByRole('tab', { name: /Validation/i }));

    expect(screen.getByText('username')).toBeInTheDocument();
    expect(screen.getByText('website')).toBeInTheDocument();
    expect(screen.queryByText('uq_users_email')).not.toBeInTheDocument();
    expect(screen.queryByText('order-total-positive')).not.toBeInTheDocument();
  });

  it('Constraints tab hides validation and rule rows', async () => {
    renderPage();
    await screen.findByText('username');

    fireEvent.click(screen.getByRole('tab', { name: /Constraints/i }));

    expect(screen.getByText('uq_users_email')).toBeInTheDocument();
    expect(screen.getByText('chk_total')).toBeInTheDocument();
    expect(screen.queryByText('username')).not.toBeInTheDocument();
    expect(screen.queryByText('order-total-positive')).not.toBeInTheDocument();
  });

  it('Rules tab hides validation and constraint rows', async () => {
    renderPage();
    await screen.findByText('username');

    fireEvent.click(screen.getByRole('tab', { name: /Rules/i }));

    expect(screen.getByText('order-total-positive')).toBeInTheDocument();
    expect(screen.queryByText('username')).not.toBeInTheDocument();
    expect(screen.queryByText('uq_users_email')).not.toBeInTheDocument();
  });
});

describe('IntegrityPage — search', () => {
  it('filters across all three categories simultaneously', async () => {
    renderPage();
    await screen.findByText('username');

    const searchBox = screen.getByPlaceholderText(/Search by entity/i);
    fireEvent.change(searchBox, { target: { value: 'order' } });

    expect(screen.getByText('chk_total')).toBeInTheDocument();
    expect(screen.getByText('order-total-positive')).toBeInTheDocument();
    expect(screen.queryByText('username')).not.toBeInTheDocument();
    expect(screen.queryByText('uq_users_email')).not.toBeInTheDocument();
  });

  it('search updates the per-category counts in the tab labels', async () => {
    renderPage();
    await screen.findByText('username');

    fireEvent.change(screen.getByPlaceholderText(/Search by entity/i), {
      target: { value: 'order' },
    });

    // After filtering: 0 validation + 1 constraint + 1 rule = 2 in All
    const allTab = screen.getByRole('tab', { name: /All\b/i });
    expect(within(allTab).getByText('2')).toBeInTheDocument();
    const validationTab = screen.getByRole('tab', { name: /Validation/i });
    expect(within(validationTab).getByText('0')).toBeInTheDocument();
  });
});

describe('IntegrityPage — Needs attention preset', () => {
  it('toggling the preset keeps error-severity rows and hides passing ones', async () => {
    renderPage();
    await screen.findByText('username');

    // All 5 rows visible by default
    expect(screen.getByText('username')).toBeInTheDocument();
    expect(screen.getByText('order-total-positive')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Needs attention/i }));

    // Only the error-severity rule survives; validation + constraint rows
    // (all default to `pass` until the backend publishes run status) drop out.
    expect(screen.getByText('order-total-positive')).toBeInTheDocument();
    expect(screen.queryByText('username')).not.toBeInTheDocument();
    expect(screen.queryByText('uq_users_email')).not.toBeInTheDocument();
    expect(screen.getByText(/passing item/i)).toBeInTheDocument();
  });
});

describe('IntegrityPage — error state', () => {
  it('shows an error message when the report fetch fails', async () => {
    failFetch = true;
    renderPage();
    await waitFor(() =>
      expect(
        screen.getByText(/Failed to load the Integrity report/i),
      ).toBeInTheDocument(),
    );
  });
});
