/**
 * Tests for the Integrity page (#85 R5 / rollout 4.3).
 *
 * Mocks the integrityApi so the page renders against fixed three-list
 * payloads. Verifies:
 *   - Tab switching shows the right per-category counts in the header
 *   - The "All" tab renders all three categories with a Category column
 *   - The Validation/Constraints/Rules tabs render only their own rows
 *   - The search box filters across the union
 *   - The "Needs attention" preset filters passing rows out
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

    fireEvent.click(screen.getByRole('tab', { name: /Validation/i }));

    expect(screen.getByText('username')).toBeInTheDocument();
    expect(screen.getByText('website')).toBeInTheDocument();
    expect(screen.queryByText('uq_users_email')).not.toBeInTheDocument();
    expect(screen.queryByText('order-total-positive')).not.toBeInTheDocument();
  });

  it('Constraints tab hides validation and rule rows', async () => {
    mockedApi.getReport.mockResolvedValue(sampleReport);
    renderPage();
    await screen.findByText('username');

    fireEvent.click(screen.getByRole('tab', { name: /Constraints/i }));

    expect(screen.getByText('uq_users_email')).toBeInTheDocument();
    expect(screen.getByText('chk_total')).toBeInTheDocument();
    expect(screen.queryByText('username')).not.toBeInTheDocument();
    expect(screen.queryByText('order-total-positive')).not.toBeInTheDocument();
  });

  it('Rules tab hides validation and constraint rows', async () => {
    mockedApi.getReport.mockResolvedValue(sampleReport);
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
    mockedApi.getReport.mockResolvedValue(sampleReport);
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
    mockedApi.getReport.mockResolvedValue(sampleReport);
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
    mockedApi.getReport.mockResolvedValue(sampleReport);
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
    mockedApi.getReport.mockRejectedValue(new Error('boom'));
    renderPage();
    await waitFor(() =>
      expect(screen.getByText(/Failed to load the Integrity report/i)).toBeInTheDocument(),
    );
  });
});
