/**
 * Tests for the Integrity page (#85 R5).
 *
 * Mocks the integrityApi so the page renders against fixed three-list
 * payloads. Verifies:
 *   - Tab switching shows the right per-category counts in the header
 *   - The "All" tab renders all three categories with a Category column
 *   - The Validation/Constraints/Rules tabs render only their own rows
 *   - The search box filters across the union
 *   - The "Group by entity" toggle switches layouts and groups rows
 */
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import IntegrityPage from '../IntegrityPage';

vi.mock('../../services/api', () => ({
  integrityApi: {
    getReport: vi.fn(),
  },
}));
// eslint-disable-next-line @typescript-eslint/no-require-imports
import { integrityApi } from '../../services/api';

const mockedApi = integrityApi as unknown as {
  getReport: ReturnType<typeof vi.fn>;
};

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

const renderPage = () =>
  render(
    <MemoryRouter>
      <IntegrityPage />
    </MemoryRouter>,
  );

beforeEach(() => {
  mockedApi.getReport.mockReset();
});

describe('IntegrityPage — initial render', () => {
  it('renders the page header and fetches the report on mount', async () => {
    mockedApi.getReport.mockResolvedValue(sampleReport);
    renderPage();
    expect(screen.getByRole('heading', { name: /Integrity/i })).toBeInTheDocument();
    await waitFor(() => expect(mockedApi.getReport).toHaveBeenCalledTimes(1));
  });

  it('shows tab counts derived from the loaded payload', async () => {
    mockedApi.getReport.mockResolvedValue(sampleReport);
    renderPage();
    // Wait for the data to land
    await screen.findByText('username');
    // Tab counts: All=5, Validation=2, Constraints=2, Rules=1
    const allTab = screen.getByRole('button', { name: /All\b/i });
    expect(within(allTab).getByText('5')).toBeInTheDocument();
    const validationTab = screen.getByRole('button', { name: /Validation/i });
    expect(within(validationTab).getByText('2')).toBeInTheDocument();
    const constraintsTab = screen.getByRole('button', { name: /Constraints/i });
    expect(within(constraintsTab).getByText('2')).toBeInTheDocument();
    const rulesTab = screen.getByRole('button', { name: /Rules/i });
    expect(within(rulesTab).getByText('1')).toBeInTheDocument();
  });

  it('renders all three categories on the All tab', async () => {
    mockedApi.getReport.mockResolvedValue(sampleReport);
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
    mockedApi.getReport.mockResolvedValue(sampleReport);
    renderPage();
    await screen.findByText('username');

    fireEvent.click(screen.getByRole('button', { name: /Validation/i }));

    // Validation rows still visible
    expect(screen.getByText('username')).toBeInTheDocument();
    expect(screen.getByText('website')).toBeInTheDocument();
    // Constraint and rule rows gone
    expect(screen.queryByText('uq_users_email')).not.toBeInTheDocument();
    expect(screen.queryByText('order-total-positive')).not.toBeInTheDocument();
  });

  it('Constraints tab hides validation and rule rows', async () => {
    mockedApi.getReport.mockResolvedValue(sampleReport);
    renderPage();
    await screen.findByText('username');

    fireEvent.click(screen.getByRole('button', { name: /Constraints/i }));

    expect(screen.getByText('uq_users_email')).toBeInTheDocument();
    expect(screen.getByText('chk_total')).toBeInTheDocument();
    expect(screen.queryByText('username')).not.toBeInTheDocument();
    expect(screen.queryByText('order-total-positive')).not.toBeInTheDocument();
  });

  it('Rules tab hides validation and constraint rows', async () => {
    mockedApi.getReport.mockResolvedValue(sampleReport);
    renderPage();
    await screen.findByText('username');

    fireEvent.click(screen.getByRole('button', { name: /Rules/i }));

    expect(screen.getByText('order-total-positive')).toBeInTheDocument();
    expect(screen.queryByText('username')).not.toBeInTheDocument();
    expect(screen.queryByText('uq_users_email')).not.toBeInTheDocument();
  });
});

describe('IntegrityPage — search', () => {
  it('filters across all three categories simultaneously', async () => {
    mockedApi.getReport.mockResolvedValue(sampleReport);
    renderPage();
    await screen.findByText('username');

    const searchBox = screen.getByPlaceholderText(/Search by entity/i);
    fireEvent.change(searchBox, { target: { value: 'order' } });

    // Order-related rows survive: chk_total + order-total-positive
    expect(screen.getByText('chk_total')).toBeInTheDocument();
    expect(screen.getByText('order-total-positive')).toBeInTheDocument();
    // User-related rows gone
    expect(screen.queryByText('username')).not.toBeInTheDocument();
    expect(screen.queryByText('uq_users_email')).not.toBeInTheDocument();
  });

  it('search updates the per-category counts in the tab labels', async () => {
    mockedApi.getReport.mockResolvedValue(sampleReport);
    renderPage();
    await screen.findByText('username');

    fireEvent.change(screen.getByPlaceholderText(/Search by entity/i), {
      target: { value: 'order' },
    });

    // After filtering: 0 validation + 1 constraint + 1 rule = 2 in All
    const allTab = screen.getByRole('button', { name: /All\b/i });
    expect(within(allTab).getByText('2')).toBeInTheDocument();
    const validationTab = screen.getByRole('button', { name: /Validation/i });
    expect(within(validationTab).getByText('0')).toBeInTheDocument();
  });
});

describe('IntegrityPage — group-by entity', () => {
  it('switches to entity-grouped layout and shows mixed-category cards', async () => {
    mockedApi.getReport.mockResolvedValue(sampleReport);
    renderPage();
    await screen.findByText('username');

    const groupBySelect = screen.getByRole('combobox');
    fireEvent.change(groupBySelect, { target: { value: 'entity' } });

    // The User card should now show both validation rows and the unique constraint
    const userHeading = screen.getByText('User');
    expect(userHeading).toBeInTheDocument();
    // Order entity + check constraint + functional rule
    expect(screen.getByText('Order')).toBeInTheDocument();
  });
});

describe('IntegrityPage — error state', () => {
  it('shows an error message when the report fetch fails', async () => {
    mockedApi.getReport.mockRejectedValue(new Error('boom'));
    renderPage();
    await waitFor(() =>
      expect(screen.getByText(/Failed to load the Integrity report/i)).toBeInTheDocument(),
    );
  });
});
