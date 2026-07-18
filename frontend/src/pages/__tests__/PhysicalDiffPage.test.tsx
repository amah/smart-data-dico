/**
 * #155-diff — PhysicalDiffPage page test.
 *
 * Covers spec acceptance criterion #13:
 *   - bootstrapApplication() in beforeAll.
 *   - Single-service DDL: select a service, paste SQL, click Compare →
 *     POST /api/diff/physical handler hit, summary tiles render.
 *   - All-services: select "All services" → GET /api/services/:svc/physical-config
 *     is hit per service (counter-based), POST /api/diff/physical/all fires
 *     on Compare.
 *   - All-services config: when MSW returns { dialect: 'postgres' }, the
 *     rendered label reads "Live (postgres)" (PhysicalDiffPage.tsx:322,
 *     the cycle-2 narrowed PhysicalConfig type read site).
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
import PhysicalDiffPage, { formatPhysicalAttributeSide } from '../PhysicalDiffPage';
import { server } from '../../test/setup';

// ──────────────── Fixtures ────────────────

const SERVICES_FIXTURE = ['user-service', 'order-service'];

// Physical diff result for a single service (DDL mode).
const PHYSICAL_DIFF_FIXTURE = {
  entities: [
    {
      status: 'matched',
      entityName: 'User',
      entityUuid: 'e-user',
      physicalTableName: 'users',
      attributes: [
        {
          status: 'matched' as const,
          attributeName: 'id',
          physicalColumnName: 'id',
          model: { type: 'integer', required: true },
          source: { type: 'integer', required: true },
        },
        {
          status: 'drifted' as const,
          attributeName: 'email',
          physicalColumnName: 'email',
          driftFields: ['type'],
          model: { type: 'string', required: true, metadata: [{ name: 'physical.dbType', value: 'VARCHAR(255)' }] },
          source: { type: 'text', required: false, metadata: [{ name: 'physical.dbType', value: 'TEXT' }] },
        },
      ],
      constraints: [
        {
          status: 'drifted',
          key: 'name:uq_user_email',
          model: { kind: 'unique', name: 'uq_user_email', columns: ['email'] },
          source: { kind: 'unique', name: 'uq_user_email', columns: ['id'] },
        },
      ],
    },
  ],
  summary: {
    matched: 1,
    modelOnly: 0,
    orphaned: 0,
    dbOnly: 0,
    drifted: 1,
    entities: { users: 1 },
    constraints: { matched: 0, added: 0, removed: 0, drifted: 1 },
  },
};

// All-services physical diff result.
const ALL_PHYSICAL_DIFF_FIXTURE = {
  byService: {
    'user-service': {
      status: 'ok',
      diff: PHYSICAL_DIFF_FIXTURE,
    },
  },
  summary: {
    services: 1,
    ok: 1,
    failed: 0,
    matched: 1,
    drifted: 1,
    modelOnly: 0,
    orphaned: 0,
    dbOnly: 0,
    constraints: { matched: 0, added: 0, removed: 0, drifted: 1 },
  },
};

// Physical config returned when "All services" mode fetches per-service config.
const PHYSICAL_CONFIG_FIXTURE = { dialect: 'postgres', host: 'localhost', port: 5432 };

// ──────────────── MSW handler state ────────────────

let physicalPostCount = 0;
let physicalAllPostCount = 0;
let impactPostCount = 0;
let lastPhysicalBody: any = null;
const physicalConfigGetCounts: Record<string, number> = {};

// ──────────────── Bootstrap + handler setup ────────────────

beforeAll(async () => {
  await bootstrapApplication();
});

beforeEach(() => {
  physicalPostCount = 0;
  physicalAllPostCount = 0;
  impactPostCount = 0;
  lastPhysicalBody = null;
  for (const svc of SERVICES_FIXTURE) {
    physicalConfigGetCounts[svc] = 0;
  }

  server.use(
    http.get('/api/services', () => {
      return HttpResponse.json({ data: SERVICES_FIXTURE });
    }),
    http.get('/api/services/:svc/physical-config', ({ params }) => {
      const svc = params.svc as string;
      physicalConfigGetCounts[svc] = (physicalConfigGetCounts[svc] ?? 0) + 1;
      return HttpResponse.json({ data: PHYSICAL_CONFIG_FIXTURE });
    }),
    http.post('/api/diff/physical', async ({ request }) => {
      physicalPostCount += 1;
      lastPhysicalBody = await request.json();
      return HttpResponse.json({ data: PHYSICAL_DIFF_FIXTURE });
    }),
    http.post('/api/diff/physical/all', () => {
      physicalAllPostCount += 1;
      return HttpResponse.json({ data: ALL_PHYSICAL_DIFF_FIXTURE });
    }),
    http.post('/api/diff/impact', () => {
      impactPostCount += 1;
      return HttpResponse.json({
        data: {
          operations: [{ order: 1, type: 'ALTER_COLUMN', table: 'users', column: 'email', risk: 'caution' }],
          summary: { safe: 0, caution: 1, destructive: 0 },
        },
      });
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
        React.createElement(PhysicalDiffPage),
      ),
    ),
  );
};

// ──────────────── Tests ────────────────

describe('PhysicalDiffPage — initial render', () => {
  it('formats the complete expected/actual value for human comparison', () => {
    expect(formatPhysicalAttributeSide({
      type: 'string', required: true, unique: true,
      metadata: [
        { name: 'physical.dbType', value: 'VARCHAR(255)' },
        { name: 'physical.nullable', value: false },
      ],
    })).toBe('string · DB VARCHAR(255) · unique · required · NOT NULL');
  });

  it('renders the page heading without crashing', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: /Physical sync/i })).toBeInTheDocument();
  });
});

describe('PhysicalDiffPage — single-service DDL flow (criterion #13a)', () => {
  it('selecting a service and pasting DDL SQL enables the Compare button', async () => {
    renderPage();

    // Wait for services to populate.
    await waitFor(() => {
      const select = screen.getByRole('combobox');
      expect(select.querySelectorAll('option').length).toBeGreaterThan(1);
    });

    fireEvent.change(screen.getByRole('combobox'), {
      target: { value: 'user-service' },
    });

    // The SQL textarea should now be visible.
    const textarea = screen.getByPlaceholderText(/Paste SQL DDL/i);
    fireEvent.change(textarea, {
      target: { value: 'CREATE TABLE users (id INT PRIMARY KEY);' },
    });

    expect(screen.getByRole('button', { name: /Compare/i })).not.toBeDisabled();
  });

  it('clicking Compare fires POST /api/diff/physical exactly once', async () => {
    renderPage();

    await waitFor(() => {
      const select = screen.getByRole('combobox');
      expect(select.querySelectorAll('option').length).toBeGreaterThan(1);
    });

    fireEvent.change(screen.getByRole('combobox'), {
      target: { value: 'user-service' },
    });

    const textarea = screen.getByPlaceholderText(/Paste SQL DDL/i);
    fireEvent.change(textarea, {
      target: { value: 'CREATE TABLE users (id INT PRIMARY KEY);' },
    });

    fireEvent.click(screen.getByRole('button', { name: /Compare/i }));

    await waitFor(() => {
      expect(physicalPostCount).toBe(1);
    });
  });

  it('after Compare, summary tiles with counts render in the DOM', async () => {
    renderPage();

    await waitFor(() => {
      const select = screen.getByRole('combobox');
      expect(select.querySelectorAll('option').length).toBeGreaterThan(1);
    });

    fireEvent.change(screen.getByRole('combobox'), {
      target: { value: 'user-service' },
    });

    const textarea = screen.getByPlaceholderText(/Paste SQL DDL/i);
    fireEvent.change(textarea, {
      target: { value: 'CREATE TABLE users (id INT PRIMARY KEY);' },
    });

    fireEvent.click(screen.getByRole('button', { name: /Compare/i }));

    // The fixture has 1 matched + 1 drifted → Matched tile renders.
    // Use getAllByText since "Matched" may appear in both a tile label and
    // a chip inside the entity diff table.
    await waitFor(() => {
      expect(screen.getAllByText(/Matched/i).length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('Constraint gaps')).toBeInTheDocument();
      expect(screen.getByText('uq_user_email')).toBeInTheDocument();
    });
  });

  it('supports live introspection for a single service', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByRole('combobox').querySelectorAll('option').length).toBeGreaterThan(1));
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'user-service' } });
    await waitFor(() => expect(screen.getByText('Live (postgres)')).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText(/Live \(postgres\)/i));
    fireEvent.change(screen.getByLabelText('Database user'), { target: { value: 'reader' } });
    fireEvent.change(screen.getByLabelText('Database password'), { target: { value: 'secret' } });
    fireEvent.click(screen.getByRole('button', { name: /Compare/i }));

    await waitFor(() => expect(physicalPostCount).toBe(1));
    expect(lastPhysicalBody).toEqual({
      service: 'user-service',
      source: { type: 'live', credentials: { user: 'reader', password: 'secret' } },
    });
  });

  it('builds and displays a migration impact preview', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByRole('combobox').querySelectorAll('option').length).toBeGreaterThan(1));
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'user-service' } });
    fireEvent.change(screen.getByPlaceholderText(/Paste SQL DDL/i), { target: { value: 'CREATE TABLE users (id INT);' } });
    fireEvent.click(screen.getByRole('button', { name: /^Compare$/i }));
    await waitFor(() => expect(screen.getByRole('button', { name: /Preview migration impact/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Preview migration impact/i }));

    await waitFor(() => {
      expect(impactPostCount).toBe(1);
      expect(screen.getByTestId('migration-impact')).toHaveTextContent('ALTER_COLUMN');
      expect(screen.getByRole('button', { name: 'Download' })).toBeInTheDocument();
    });
  });
});

describe('PhysicalDiffPage — all-services flow (criterion #13b)', () => {
  it('selecting "All services" triggers GET /api/services/:svc/physical-config per service', async () => {
    renderPage();

    await waitFor(() => {
      const select = screen.getByRole('combobox');
      expect(select.querySelectorAll('option').length).toBeGreaterThan(1);
    });

    fireEvent.change(screen.getByRole('combobox'), {
      target: { value: '__all__' },
    });

    // After switching to all-services, the useEffect fires getPhysicalConfig
    // for each service in the list. We wait for the config calls to fire.
    await waitFor(() => {
      const totalConfigCalls = Object.values(physicalConfigGetCounts).reduce(
        (sum, n) => sum + n,
        0,
      );
      expect(totalConfigCalls).toBeGreaterThanOrEqual(SERVICES_FIXTURE.length);
    });
  });

  it('when backend returns { dialect: "postgres" }, "Live (postgres)" label renders', async () => {
    renderPage();

    await waitFor(() => {
      const select = screen.getByRole('combobox');
      expect(select.querySelectorAll('option').length).toBeGreaterThan(1);
    });

    fireEvent.change(screen.getByRole('combobox'), {
      target: { value: '__all__' },
    });

    // The per-service config cards should render Live (postgres) labels
    // once the physical config fetches resolve.
    await waitFor(() => {
      // The fixture returns { dialect: 'postgres' } for all services,
      // so "Live (postgres)" should appear at least once.
      expect(screen.getAllByText(/Live \(postgres\)/i).length).toBeGreaterThanOrEqual(1);
    });
  });

  it('filling DDL for a service and clicking Compare fires POST /api/diff/physical/all', async () => {
    // Override the config handler so user-service returns null — the page
    // then seeds that service as type:'ddl' (see the useEffect in
    // PhysicalDiffPage: `seed[svc] = { type: cfg ? 'live' : 'ddl' }`).
    // This ensures the DDL textarea is rendered so we can paste into it.
    server.use(
      http.get('/api/services/:svc/physical-config', ({ params }) => {
        const svc = params.svc as string;
        physicalConfigGetCounts[svc] = (physicalConfigGetCounts[svc] ?? 0) + 1;
        if (svc === 'user-service') {
          return HttpResponse.json({ data: null });
        }
        return HttpResponse.json({ data: PHYSICAL_CONFIG_FIXTURE });
      }),
    );

    renderPage();

    await waitFor(() => {
      const select = screen.getByRole('combobox');
      expect(select.querySelectorAll('option').length).toBeGreaterThan(1);
    });

    fireEvent.change(screen.getByRole('combobox'), {
      target: { value: '__all__' },
    });

    // Wait for the per-service config form to appear — at least one service
    // card should be visible. user-service returns null config → DDL textarea.
    await waitFor(() => {
      // Placeholder contains the service name via template literal
      expect(
        screen.getByPlaceholderText(/CREATE TABLE.*user-service/i),
      ).toBeInTheDocument();
    });

    const ddlTextarea = screen.getByPlaceholderText(/CREATE TABLE.*user-service/i);
    fireEvent.change(ddlTextarea, {
      target: { value: 'CREATE TABLE users (id INT PRIMARY KEY);' },
    });

    fireEvent.click(screen.getByRole('button', { name: /Compare/i }));

    await waitFor(() => {
      expect(physicalAllPostCount).toBe(1);
    });
  });
});
