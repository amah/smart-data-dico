/**
 * Tests for the Schema Import Wizard (#69 C5).
 *
 * The wizard drives a 3-step flow that calls four API endpoints:
 *   - previewSqlDdl / previewOracleSchema → parsed entities
 *   - diffSqlDdl                          → structured diff
 *   - commitSqlDdl                        → write + counts
 *
 * These tests mock the api module so the flow can be exercised without a
 * backend, then verify (a) step transitions are gated correctly, (b) the
 * diff stats render the backend response verbatim, (c) the Oracle source
 * branch reaches the right endpoint, and (d) errors short-circuit each
 * step without losing wizard state.
 */
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import SchemaImportWizard from '../SchemaImportWizard';

// ─── Mock the api module ───────────────────────────────────────────────
vi.mock('../../services/api', () => ({
  importExportApi: {
    previewSqlDdl: vi.fn(),
    previewOracleSchema: vi.fn(),
    previewDbSchema: vi.fn(),
    diffSqlDdl: vi.fn(),
    commitSqlDdl: vi.fn(),
  },
}));
// eslint-disable-next-line @typescript-eslint/no-require-imports
import { importExportApi } from '../../services/api';

const mockedApi = importExportApi as unknown as {
  previewSqlDdl: ReturnType<typeof vi.fn>;
  previewOracleSchema: ReturnType<typeof vi.fn>;
  previewDbSchema: ReturnType<typeof vi.fn>;
  diffSqlDdl: ReturnType<typeof vi.fn>;
  commitSqlDdl: ReturnType<typeof vi.fn>;
};

// ─── Fixtures ──────────────────────────────────────────────────────────
const ordersEntity = {
  uuid: 'e1',
  name: 'Orders',
  attributes: [],
  metadata: [{ name: 'physical.tableName', value: 'orders' }],
};

const sampleDiffs = [
  {
    status: 'added',
    name: 'Orders',
    physicalTableName: 'orders',
    attributes: [
      { status: 'added', name: 'id' },
      { status: 'added', name: 'customerEmail' },
    ],
    counts: { added: 2, changed: 0, unchanged: 0, removedInSource: 0, modelOnly: 0 },
  },
  {
    status: 'changed',
    name: 'Customers',
    physicalTableName: 'customers',
    attributes: [
      { status: 'changed', name: 'email', changedFields: ['physical.dbType'] },
      { status: 'unchanged', name: 'id' },
    ],
    counts: { added: 0, changed: 1, unchanged: 1, removedInSource: 0, modelOnly: 0 },
  },
  {
    status: 'unchanged',
    name: 'Wishlist',
    physicalTableName: 'wishlist',
    attributes: [],
    counts: { added: 0, changed: 0, unchanged: 3, removedInSource: 0, modelOnly: 0 },
  },
];

const services = ['order-service', 'user-service'];

const renderWizard = (props: Partial<React.ComponentProps<typeof SchemaImportWizard>> = {}) =>
  render(<SchemaImportWizard services={services} {...props} />);

beforeEach(() => {
  mockedApi.previewSqlDdl.mockReset();
  mockedApi.previewOracleSchema.mockReset();
  mockedApi.previewDbSchema.mockReset();
  mockedApi.diffSqlDdl.mockReset();
  mockedApi.commitSqlDdl.mockReset();
});

// ─── Step 1 → Step 2: SQL paste happy path ─────────────────────────────

describe('SchemaImportWizard — SQL paste source', () => {
  it('disables Preview Diff until target service + SQL are provided', () => {
    renderWizard();
    const previewBtn = screen.getByRole('button', { name: /preview diff/i });
    expect(previewBtn).toBeDisabled();

    // Fill SQL only — still disabled (no service)
    const textarea = screen.getByPlaceholderText(/CREATE TABLE/i);
    fireEvent.change(textarea, { target: { value: 'CREATE TABLE x (id INT);' } });
    expect(previewBtn).toBeDisabled();

    // Pick service — now enabled
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'order-service' } });
    expect(previewBtn).not.toBeDisabled();
  });

  it('parses + diffs and renders the diff summary on the Diff step', async () => {
    mockedApi.previewSqlDdl.mockResolvedValue({
      data: { entities: [ordersEntity], errors: [] },
    });
    mockedApi.diffSqlDdl.mockResolvedValue({
      data: { diffs: sampleDiffs },
    });

    renderWizard();
    fireEvent.change(screen.getByPlaceholderText(/CREATE TABLE/i), {
      target: { value: 'CREATE TABLE orders (id INT);' },
    });
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'order-service' } });

    await userEvent.click(screen.getByRole('button', { name: /preview diff/i }));

    await waitFor(() => {
      expect(mockedApi.previewSqlDdl).toHaveBeenCalledWith(
        'CREATE TABLE orders (id INT);',
        { stripPrefixes: [], stripSuffixes: [] },
      );
    });
    expect(mockedApi.diffSqlDdl).toHaveBeenCalledWith([ordersEntity], 'order-service');

    // Diff step rendered
    expect(await screen.findByText('Commit Import')).toBeInTheDocument();
    // Stats: 1 added, 1 changed, 1 unchanged — scope to the stats container so the
    // table column headers (which also say Added/Changed/etc.) don't match.
    const statsContainer = document.querySelector('.stats') as HTMLElement;
    expect(statsContainer).toBeTruthy();
    const stats = within(statsContainer);
    expect(stats.getByText('Added').nextSibling?.textContent).toBe('1');
    expect(stats.getByText('Changed').nextSibling?.textContent).toBe('1');
    expect(stats.getByText('Unchanged').nextSibling?.textContent).toBe('1');
    // Entity rows visible
    expect(screen.getByText('Orders')).toBeInTheDocument();
    expect(screen.getByText('Customers')).toBeInTheDocument();
    expect(screen.getByText('Wishlist')).toBeInTheDocument();
  });

  it('passes parsed strip prefixes/suffixes through to the preview call', async () => {
    mockedApi.previewSqlDdl.mockResolvedValue({ data: { entities: [ordersEntity], errors: [] } });
    mockedApi.diffSqlDdl.mockResolvedValue({ data: { diffs: [] } });

    renderWizard();
    fireEvent.change(screen.getByPlaceholderText(/CREATE TABLE/i), {
      target: { value: 'CREATE TABLE x (id INT);' },
    });
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'order-service' } });
    fireEvent.change(screen.getByPlaceholderText(/tbl_/i), { target: { value: 'tbl_, mv_' } });
    fireEvent.change(screen.getByPlaceholderText(/_v2/i), { target: { value: '_v2' } });

    await userEvent.click(screen.getByRole('button', { name: /preview diff/i }));

    await waitFor(() => {
      expect(mockedApi.previewSqlDdl).toHaveBeenCalledWith('CREATE TABLE x (id INT);', {
        stripPrefixes: ['tbl_', 'mv_'],
        stripSuffixes: ['_v2'],
      });
    });
  });

  it('shows the parser error and stays on the Source step when no entities are returned', async () => {
    mockedApi.previewSqlDdl.mockResolvedValue({
      data: { entities: [], errors: ['No CREATE TABLE statements found in the SQL'] },
    });

    renderWizard();
    fireEvent.change(screen.getByPlaceholderText(/CREATE TABLE/i), {
      target: { value: '-- just a comment' },
    });
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'order-service' } });

    await userEvent.click(screen.getByRole('button', { name: /preview diff/i }));

    expect(await screen.findByText(/No CREATE TABLE/i)).toBeInTheDocument();
    // Did NOT advance — Preview Diff button still present
    expect(screen.getByRole('button', { name: /preview diff/i })).toBeInTheDocument();
    expect(mockedApi.diffSqlDdl).not.toHaveBeenCalled();
  });
});

// ─── Step 1 → Step 2: Live DB source (#79/#80/#81) ─────────────────────

describe('SchemaImportWizard — Live DB source', () => {
  it('routes Oracle to previewDbSchema with dialect=oracle', async () => {
    mockedApi.previewDbSchema.mockResolvedValue({
      data: { entities: [ordersEntity], errors: [] },
    });
    mockedApi.diffSqlDdl.mockResolvedValue({ data: { diffs: sampleDiffs } });

    renderWizard();
    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'order-service' } });
    await userEvent.click(screen.getByRole('button', { name: /Live Database/i }));

    // Default dialect is oracle → oracle fields are visible
    expect(screen.queryByPlaceholderText(/CREATE TABLE/i)).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/^User$/), { target: { value: 'sales' } });
    fireEvent.change(screen.getByLabelText(/^Password$/), { target: { value: 'pw' } });
    fireEvent.change(screen.getByLabelText(/Connect String/), { target: { value: 'host:1521/svc' } });

    await userEvent.click(screen.getByRole('button', { name: /preview diff/i }));

    await waitFor(() => {
      expect(mockedApi.previewDbSchema).toHaveBeenCalledWith(
        'oracle',
        { user: 'sales', password: 'pw', connectString: 'host:1521/svc' },
        { stripPrefixes: [], stripSuffixes: [] },
      );
    });
    expect(mockedApi.previewSqlDdl).not.toHaveBeenCalled();
    expect(await screen.findByText('Commit Import')).toBeInTheDocument();
  });

  it('routes Postgres to previewDbSchema with dialect=postgres and host/database/port', async () => {
    mockedApi.previewDbSchema.mockResolvedValue({
      data: { entities: [ordersEntity], errors: [] },
    });
    mockedApi.diffSqlDdl.mockResolvedValue({ data: { diffs: sampleDiffs } });

    renderWizard();
    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'order-service' } });
    await userEvent.click(screen.getByRole('button', { name: /Live Database/i }));

    // Switch dialect to postgres
    const dialectSelect = screen.getByLabelText(/Dialect/i);
    fireEvent.change(dialectSelect, { target: { value: 'postgres' } });

    fireEvent.change(screen.getByLabelText(/^Host$/), { target: { value: 'db.example.com' } });
    fireEvent.change(screen.getByLabelText(/^Database$/), { target: { value: 'sales' } });
    fireEvent.change(screen.getByLabelText(/^User$/), { target: { value: 'app' } });
    fireEvent.change(screen.getByLabelText(/^Password$/), { target: { value: 'pw' } });
    fireEvent.change(screen.getByLabelText(/^Port/), { target: { value: '5433' } });

    await userEvent.click(screen.getByRole('button', { name: /preview diff/i }));

    await waitFor(() => {
      expect(mockedApi.previewDbSchema).toHaveBeenCalledWith(
        'postgres',
        {
          user: 'app',
          password: 'pw',
          host: 'db.example.com',
          database: 'sales',
          port: 5433,
        },
        { stripPrefixes: [], stripSuffixes: [] },
      );
    });
  });

  it('keeps Preview disabled until all dialect-required fields are filled (Oracle)', async () => {
    renderWizard();
    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'order-service' } });
    await userEvent.click(screen.getByRole('button', { name: /Live Database/i }));

    const previewBtn = screen.getByRole('button', { name: /preview diff/i });
    expect(previewBtn).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/^User$/), { target: { value: 'sales' } });
    expect(previewBtn).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/^Password$/), { target: { value: 'pw' } });
    expect(previewBtn).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Connect String/), { target: { value: 'host:1521/svc' } });
    expect(previewBtn).not.toBeDisabled();
  });
});

// ─── Step 2 → Step 3: commit ───────────────────────────────────────────

describe('SchemaImportWizard — commit step', () => {
  const advanceToDiff = async () => {
    mockedApi.previewSqlDdl.mockResolvedValue({ data: { entities: [ordersEntity], errors: [] } });
    mockedApi.diffSqlDdl.mockResolvedValue({ data: { diffs: sampleDiffs } });

    renderWizard();
    fireEvent.change(screen.getByPlaceholderText(/CREATE TABLE/i), {
      target: { value: 'CREATE TABLE orders (id INT);' },
    });
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'order-service' } });
    await userEvent.click(screen.getByRole('button', { name: /preview diff/i }));
    await screen.findByText('Commit Import');
  };

  it('calls commitSqlDdl with the parsed entities and renders the result counts', async () => {
    await advanceToDiff();

    mockedApi.commitSqlDdl.mockResolvedValue({
      data: {
        added: 1,
        merged: 2,
        unchanged: 3,
        removedInSource: 1,
        written: 3,
        errors: [],
      },
    });

    await userEvent.click(screen.getByRole('button', { name: /commit import/i }));

    await waitFor(() => {
      expect(mockedApi.commitSqlDdl).toHaveBeenCalledWith([ordersEntity], 'order-service');
    });

    expect(await screen.findByText(/Imported/i)).toBeInTheDocument();
    // Scope to the result-step stats container so headers from the diff
    // table (no longer rendered, but be defensive) cannot match.
    const resultStats = document.querySelector('.stats') as HTMLElement;
    const stats = within(resultStats);
    expect(stats.getByText('Created').nextSibling?.textContent).toBe('1');
    expect(stats.getByText('Merged').nextSibling?.textContent).toBe('2');
    expect(stats.getByText('Unchanged').nextSibling?.textContent).toBe('3');
    expect(stats.getByText(/Preserved/i).nextSibling?.textContent).toBe('1');
  });

  it('surfaces commit errors in an alert and keeps the result step content visible', async () => {
    await advanceToDiff();

    mockedApi.commitSqlDdl.mockResolvedValue({
      data: {
        added: 1,
        merged: 0,
        unchanged: 0,
        removedInSource: 0,
        written: 1,
        errors: ['Failed to write entity: Customers'],
      },
    });

    await userEvent.click(screen.getByRole('button', { name: /commit import/i }));

    expect(await screen.findByText(/Failed to write entity/i)).toBeInTheDocument();
  });

  it('Back button on the diff step returns to source without re-fetching', async () => {
    await advanceToDiff();
    const previewCount = mockedApi.previewSqlDdl.mock.calls.length;

    await userEvent.click(screen.getByRole('button', { name: /← Back/i }));

    // Source step controls re-rendered
    expect(screen.getByPlaceholderText(/CREATE TABLE/i)).toBeInTheDocument();
    expect(mockedApi.previewSqlDdl.mock.calls.length).toBe(previewCount);
  });
});

// ─── onComplete callback ───────────────────────────────────────────────

describe('SchemaImportWizard — onComplete', () => {
  it('invokes onComplete with the commit result after a successful import', async () => {
    mockedApi.previewSqlDdl.mockResolvedValue({ data: { entities: [ordersEntity], errors: [] } });
    mockedApi.diffSqlDdl.mockResolvedValue({ data: { diffs: sampleDiffs } });
    mockedApi.commitSqlDdl.mockResolvedValue({
      data: { added: 1, merged: 0, unchanged: 0, removedInSource: 0, written: 1, errors: [] },
    });

    const onComplete = vi.fn();
    render(<SchemaImportWizard services={services} onComplete={onComplete} />);

    fireEvent.change(screen.getByPlaceholderText(/CREATE TABLE/i), {
      target: { value: 'CREATE TABLE orders (id INT);' },
    });
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'order-service' } });
    await userEvent.click(screen.getByRole('button', { name: /preview diff/i }));
    await screen.findByText('Commit Import');
    await userEvent.click(screen.getByRole('button', { name: /commit import/i }));

    await waitFor(() => {
      expect(onComplete).toHaveBeenCalledWith(
        expect.objectContaining({ added: 1, written: 1, errors: [] }),
      );
    });
  });
});
