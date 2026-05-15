/**
 * #155-search — SearchComponent integration test.
 *
 * Covers spec acceptance criteria #16 and #17.
 *
 * #16 — Basic search render:
 *   - Production kernel bootstrapped via bootstrapApplication().
 *   - `/api/search` MSW handler returns a fixture result.
 *   - Typing a query and clicking Search surfaces the result row via findByText.
 *
 * #17 — Filter integration:
 *   - Selecting a filter and submitting captures the correct query params in the
 *     MSW handler, verifying both `q=Order` and `type=entity` appear in the URL.
 *
 * Harness design mirrors IntegrityPage.test.tsx:
 *   - `beforeAll` calls `bootstrapApplication()` once so
 *     `useService(SEARCH_SERVICE_TOKEN)` resolves to the real SearchService.
 *   - `beforeEach` registers per-test MSW handlers (the global setup.ts calls
 *     `server.resetHandlers()` in afterEach, so beforeAll registration would
 *     not survive).
 *   - Component is rendered inside `<Provider store={getStore()}>` and
 *     `<MemoryRouter>`.
 *
 * Note on the default setup.ts `/api/search` handler: the default handler
 * returns a plain array, not the `{ message, data }` envelope SearchService
 * returns. Per-test handlers installed in `beforeEach` with `server.use()`
 * take priority over the default handler for that test, so we always install
 * the correctly shaped response here.
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Provider } from 'react-redux';
import React from 'react';

import { bootstrapApplication, getStore } from '../../kernel/bootstrap';
import SearchComponent from '../SearchComponent';
import { server } from '../../test/setup';

// -----------------------------------------------------------------------
// Fixture
// -----------------------------------------------------------------------

const searchFixture = {
  message: 'Success',
  data: [
    {
      type: 'entity' as const,
      entityName: 'Order',
      service: 'order-service',
      name: 'Order',
      description: 'Order aggregate',
      path: 'order-service/Order.model.yaml',
    },
  ],
};

// MSW handler captures the last received URL for assertion in criterion #17.
let lastReceivedUrl: string | null = null;

// -----------------------------------------------------------------------
// Bootstrap + per-test MSW override
// -----------------------------------------------------------------------

beforeAll(async () => {
  await bootstrapApplication();
});

beforeEach(() => {
  lastReceivedUrl = null;
  server.use(
    // Override the default setup.ts `/api/search` handler with the
    // properly shaped envelope.
    http.get('/api/search', ({ request }) => {
      lastReceivedUrl = request.url;
      return HttpResponse.json(searchFixture);
    }),
    // Silence the getAllServices call SearchComponent fires on mount.
    // setup.ts already has `/api/services` but we ensure a clean response.
    http.get('/api/services', () => {
      return HttpResponse.json({ data: [] });
    }),
  );
});

// -----------------------------------------------------------------------
// Render helper
// -----------------------------------------------------------------------

function renderComponent(initialPath = '/search') {
  const store = getStore();
  return render(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    React.createElement(
      Provider as any,
      { store },
      React.createElement(
        MemoryRouter,
        { initialEntries: [initialPath] },
        React.createElement(SearchComponent),
      ),
    ),
  );
}

// -----------------------------------------------------------------------
// Criterion #16 — basic search renders results
// -----------------------------------------------------------------------

describe('SearchComponent — basic search (criterion #16)', () => {
  it('typing a query and clicking Search renders the result row', async () => {
    renderComponent();

    // The main search input has a distinctive placeholder. The metadata
    // filter input also has type=text, so we use placeholder to disambiguate.
    const input = screen.getByPlaceholderText(
      /Search entities, attributes/i,
    );
    const submitBtn = screen.getByRole('button', { name: /^Search$/i });

    fireEvent.change(input, { target: { value: 'Order' } });
    fireEvent.click(submitBtn);

    // findAllByText waits for async state updates. The component's
    // `highlightText` helper wraps matched substrings in <mark> elements, so
    // "Order" appears twice (name column and description column). At least one
    // occurrence proves the result row rendered.
    const resultElements = await screen.findAllByText('Order');
    expect(resultElements.length).toBeGreaterThanOrEqual(1);
    expect(resultElements[0]).toBeInTheDocument();
  });

  it('result row includes the service name from the fixture', async () => {
    renderComponent();

    const input = screen.getByPlaceholderText(/Search entities, attributes/i);
    const submitBtn = screen.getByRole('button', { name: /^Search$/i });

    fireEvent.change(input, { target: { value: 'Order' } });
    fireEvent.click(submitBtn);

    // order-service badge appears in the Service column
    const serviceBadge = await screen.findByText('order-service');
    expect(serviceBadge).toBeInTheDocument();
  });
});

// -----------------------------------------------------------------------
// Criterion #17 — filter integration: URL captures q + type params
// -----------------------------------------------------------------------

describe('SearchComponent — filter parameter forwarding (criterion #17)', () => {
  it('selecting the "Entities" type filter includes type=entity in the search URL', async () => {
    renderComponent();

    // The component renders three <select> elements: Type, Service, Stereotype.
    // The Type filter is the first one (it has an "Entities" option).
    const allSelects = screen.getAllByRole('combobox');
    const typeSelectEl = allSelects[0]; // Type filter — "All Types" is default
    fireEvent.change(typeSelectEl, { target: { value: 'entity' } });

    const input = screen.getByPlaceholderText(/Search entities, attributes/i);
    fireEvent.change(input, { target: { value: 'Order' } });

    const submitBtn = screen.getByRole('button', { name: /^Search$/i });
    fireEvent.click(submitBtn);

    // Wait for the fetch to complete (result row appears — may be multiple
    // <mark> elements due to text highlighting in name + description columns)
    await screen.findAllByText('Order');

    // The MSW handler captured the URL — verify both params are present
    expect(lastReceivedUrl).not.toBeNull();
    const url = new URL(lastReceivedUrl!);
    expect(url.searchParams.get('q')).toBe('Order');
    expect(url.searchParams.get('type')).toBe('entity');
  });
});

// -----------------------------------------------------------------------
// Additional: error state
// -----------------------------------------------------------------------

describe('SearchComponent — error state', () => {
  it('shows "Failed to perform search" when the API returns a 500', async () => {
    server.use(
      http.get('/api/search', () => {
        return new HttpResponse(null, { status: 500 });
      }),
    );

    renderComponent();

    const input = screen.getByPlaceholderText(/Search entities, attributes/i);
    fireEvent.change(input, { target: { value: 'boom' } });
    fireEvent.click(screen.getByRole('button', { name: /^Search$/i }));

    const errorMsg = await screen.findByText(/Failed to perform search/i);
    expect(errorMsg).toBeInTheDocument();
  });
});
