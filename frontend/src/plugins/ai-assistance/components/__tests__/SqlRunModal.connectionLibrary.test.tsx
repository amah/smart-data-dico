/**
 * SqlRunModal × saved connection library (#connection-library).
 *
 * The connect form gets a picker over the caller's saved connections:
 *  - selecting an entry fills the form; an UNMODIFIED selection connects by
 *    `connectionId` only (the server resolves params + saved password — the
 *    password never round-trips the client);
 *  - editing any field switches back to the explicit ad-hoc payload;
 *  - a typed password rides along as an inline override;
 *  - save/update/delete drive the /api/sql/connections CRUD;
 *  - on open, the last-used-for-this-package hint wins over the package's
 *    physical config for prefill.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SqlRunModal from '../SqlRunModal';
import { server } from '../../../../test/setup';
import { http, HttpResponse } from 'msw';
import type { SavedSqlConnection } from '../../../../services/api';

const ENTRIES: SavedSqlConnection[] = [
  {
    id: 'c1', name: 'Staging PG', dialect: 'postgres',
    connection: { host: 'db.stage', port: 5432, database: 'orders' },
    user: 'app', savedAt: '2026-07-01T00:00:00.000Z', hasSavedPassword: true,
  },
  {
    id: 'c2', name: 'Local MySQL', dialect: 'mysql',
    connection: { host: 'localhost', port: 3306, database: 'shop' },
    user: 'root', savedAt: '2026-07-02T00:00:00.000Z', hasSavedPassword: false,
  },
];

interface InstallOpts {
  connections?: SavedSqlConnection[];
  lastUsedByPackage?: Record<string, string>;
  physical?: { dialect?: string; connection?: Record<string, unknown> } | null;
  caps?: { canStore: boolean; provider: string | null; reason?: string };
}

/** Register MSW handlers for everything the modal touches; returns recorders. */
function install(opts: InstallOpts = {}) {
  let connections = (opts.connections ?? ENTRIES).map(c => ({ ...c }));
  const rec = {
    connectBodies: [] as any[],
    createBodies: [] as any[],
    updateCalls: [] as Array<{ id: string; body: any }>,
    deletedIds: [] as string[],
  };
  server.use(
    http.get('/api/services/:pkg/physical-config', () =>
      HttpResponse.json({ data: opts.physical ?? null })),
    http.get('/api/sql/connection/:pkg', () => HttpResponse.json({ data: null })),
    http.get('/api/sql/secret-capabilities', () =>
      HttpResponse.json({ data: opts.caps ?? { canStore: true, provider: 'aesgcm' } })),
    http.get('/api/sql/connections', () =>
      HttpResponse.json({ data: { connections, lastUsedByPackage: opts.lastUsedByPackage ?? {} } })),
    http.post('/api/sql/secret-status', () => HttpResponse.json({ data: { hasSecret: false } })),
    http.post('/api/sql/connect', async ({ request }) => {
      rec.connectBodies.push(await request.json());
      return HttpResponse.json({ message: 'Connected', data: {}, remembered: false, usedSaved: true });
    }),
    http.post('/api/sql/run', () =>
      HttpResponse.json({ data: { resultId: 'r1', columns: ['n'], rows: [[1]], done: true } })),
    http.post('/api/sql/close', () => HttpResponse.json({ message: 'Closed' })),
    http.post('/api/sql/connections', async ({ request }) => {
      const body: any = await request.json();
      rec.createBodies.push(body);
      const entry: SavedSqlConnection = {
        id: 'new-id', name: body.name, dialect: body.dialect, connection: body.connection ?? {},
        user: body.user ?? '', savedAt: '2026-07-09T00:00:00.000Z',
        hasSavedPassword: body.rememberPassword === true,
      };
      connections = [...connections, entry];
      return HttpResponse.json({ data: entry }, { status: 201 });
    }),
    http.put('/api/sql/connections/:id', async ({ params, request }) => {
      const body: any = await request.json();
      rec.updateCalls.push({ id: String(params.id), body });
      connections = connections.map(c => (c.id === params.id
        ? { ...c, name: body.name, dialect: body.dialect, connection: body.connection ?? {}, user: body.user ?? '' }
        : c));
      const entry = connections.find(c => c.id === params.id)!;
      return HttpResponse.json({ data: entry });
    }),
    http.delete('/api/sql/connections/:id', ({ params }) => {
      rec.deletedIds.push(String(params.id));
      connections = connections.filter(c => c.id !== params.id);
      return HttpResponse.json({ message: 'Deleted' });
    }),
  );
  return rec;
}

async function openModal() {
  render(<SqlRunModal open sql="select 1" packageName="orders" onClose={vi.fn()} />);
  return await screen.findByTestId('sql-connect-form');
}

const hostInput = () => screen.getByLabelText('Host') as HTMLInputElement;
const userInput = () => screen.getByLabelText('User') as HTMLInputElement;
const passwordInput = () => screen.getByLabelText('Password') as HTMLInputElement;
const dialectSelect = () => screen.getByLabelText('Dialect') as HTMLSelectElement;
const savedSelect = () => screen.getByTestId('sql-saved-select') as HTMLSelectElement;
const connectButton = () => screen.getByRole('button', { name: /Connect & run/ });

describe('SqlRunModal — saved connection picker', () => {
  it('renders the saved connections and selecting one fills the form fields', async () => {
    install();
    await openModal();

    expect(screen.getByRole('option', { name: 'Staging PG' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Local MySQL' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: '— new connection —' })).toBeInTheDocument();

    await userEvent.selectOptions(savedSelect(), 'c1');

    expect(dialectSelect().value).toBe('postgres');
    expect(hostInput().value).toBe('db.stage');
    expect((screen.getByLabelText('Port') as HTMLInputElement).value).toBe('5432');
    expect((screen.getByLabelText('Database') as HTMLInputElement).value).toBe('orders');
    expect(userInput().value).toBe('app');
    expect(passwordInput().value).toBe(''); // password never round-trips the client
  });

  it('an unmodified selection connects by connectionId only — no password, no explicit params', async () => {
    const rec = install();
    await openModal();

    await userEvent.selectOptions(savedSelect(), 'c1');
    await userEvent.click(connectButton());
    await screen.findByTestId('sql-results-grid'); // connect + run completed

    expect(rec.connectBodies).toHaveLength(1);
    const body = rec.connectBodies[0];
    expect(body.packageName).toBe('orders');
    expect(body.connectionId).toBe('c1');
    expect('password' in body).toBe(false);
    expect('dialect' in body).toBe(false);
    expect('connection' in body).toBe(false);
    expect('user' in body).toBe(false);
  });

  it('editing a field after selection switches to explicit fields (no connectionId)', async () => {
    const rec = install();
    await openModal();

    await userEvent.selectOptions(savedSelect(), 'c1');
    await userEvent.type(hostInput(), '-edited');
    // the picker drops back to "new connection" once the form diverges
    expect(savedSelect().value).toBe('');

    await userEvent.click(connectButton());
    await screen.findByTestId('sql-results-grid');

    const body = rec.connectBodies[0];
    expect('connectionId' in body).toBe(false);
    expect(body).toMatchObject({
      packageName: 'orders',
      dialect: 'postgres',
      connection: { host: 'db.stage-edited', port: '5432', database: 'orders' },
      user: 'app',
    });
  });

  it('hasSavedPassword shows the "using saved password" placeholder; typing sends an inline override', async () => {
    const rec = install();
    await openModal();

    await userEvent.selectOptions(savedSelect(), 'c1'); // hasSavedPassword: true
    expect(passwordInput().placeholder).toBe('using saved password — type to override');

    // typing a password does NOT count as "modified" — still connect by id,
    // with the typed password as a server-side override
    await userEvent.type(passwordInput(), 'override-pw');
    expect(savedSelect().value).toBe('c1');

    await userEvent.click(connectButton());
    await screen.findByTestId('sql-results-grid');

    expect(rec.connectBodies[0]).toMatchObject({ connectionId: 'c1', password: 'override-pw' });
  });

  it('an entry without a saved password gets no placeholder hint', async () => {
    install();
    await openModal();
    await userEvent.selectOptions(savedSelect(), 'c2'); // hasSavedPassword: false
    expect(passwordInput().placeholder).toBe('');
  });
});

describe('SqlRunModal — save / update / delete', () => {
  it('"Save connection…" with a name POSTs the form values (no password unless opted in)', async () => {
    const rec = install({ physical: { dialect: 'postgres', connection: { host: 'phys-host' } } });
    await openModal();

    await userEvent.type(userInput(), 'app');
    await userEvent.click(screen.getByTestId('sql-save-connection'));
    await userEvent.type(screen.getByTestId('sql-save-name'), 'My Conn');
    await userEvent.click(screen.getByTestId('sql-save-confirm'));

    await waitFor(() => expect(rec.createBodies).toHaveLength(1));
    const body = rec.createBodies[0];
    expect(body).toMatchObject({ name: 'My Conn', dialect: 'postgres', connection: { host: 'phys-host' }, user: 'app' });
    expect('password' in body).toBe(false);
    expect('rememberPassword' in body).toBe(false);

    // the fresh entry becomes the applied selection
    await waitFor(() => expect(savedSelect().value).toBe('new-id'));
  });

  it('"include password" opted in sends password + rememberPassword', async () => {
    const rec = install();
    await openModal();

    await userEvent.type(userInput(), 'app');
    await userEvent.type(passwordInput(), 'pw-1');
    await userEvent.click(screen.getByTestId('sql-save-connection'));
    await userEvent.type(screen.getByTestId('sql-save-name'), 'With pwd');
    await userEvent.click(screen.getByLabelText('include password'));
    await userEvent.click(screen.getByTestId('sql-save-confirm'));

    await waitFor(() => expect(rec.createBodies).toHaveLength(1));
    expect(rec.createBodies[0]).toMatchObject({ name: 'With pwd', password: 'pw-1', rememberPassword: true });
  });

  it('saving over a selected entry PUTs to its id (name prefilled)', async () => {
    const rec = install();
    await openModal();

    await userEvent.selectOptions(savedSelect(), 'c1');
    // The button names its target entry so an edited form can't silently
    // overwrite the wrong connection.
    await userEvent.click(screen.getByRole('button', { name: 'Update “Staging PG”…' }));
    expect((screen.getByTestId('sql-save-name') as HTMLInputElement).value).toBe('Staging PG');
    await userEvent.click(screen.getByRole('button', { name: 'Update' }));

    await waitFor(() => expect(rec.updateCalls).toHaveLength(1));
    expect(rec.updateCalls[0].id).toBe('c1');
    expect(rec.updateCalls[0].body).toMatchObject({ name: 'Staging PG', dialect: 'postgres', user: 'app' });
    expect(rec.createBodies).toHaveLength(0); // update, not create
  });

  it('"include password" is unusable when secret-capabilities says canStore:false', async () => {
    install({ caps: { canStore: false, provider: null, reason: 'no keyring' } });
    await openModal();

    await userEvent.type(passwordInput(), 'pw-1'); // even with a typed password
    await userEvent.click(screen.getByTestId('sql-save-connection'));

    // Disabled (not hidden) is intentional — it matches the existing session
    // "Remember password" pattern: show the option, make clear it's unavailable.
    const checkbox = screen.getByLabelText('include password') as HTMLInputElement;
    expect(checkbox).toBeDisabled();
    expect(checkbox.checked).toBe(false);
    // the session-level "Remember password" checkbox is disabled too
    expect(screen.getByLabelText(/Remember password on this machine/)).toBeDisabled();
  });

  it('deleting the selected entry is two-step and calls DELETE for its id', async () => {
    const rec = install();
    await openModal();

    await userEvent.selectOptions(savedSelect(), 'c1');
    await userEvent.click(screen.getByTestId('sql-delete-connection'));
    expect(rec.deletedIds).toHaveLength(0); // nothing yet — confirmation required

    await userEvent.click(screen.getByTestId('sql-delete-confirm'));
    await waitFor(() => expect(rec.deletedIds).toEqual(['c1']));
    await waitFor(() => expect(screen.queryByRole('option', { name: 'Staging PG' })).toBeNull());
    expect(screen.getByRole('option', { name: 'Local MySQL' })).toBeInTheDocument(); // others kept
  });

  it('the "Keep" escape hatch cancels the pending delete', async () => {
    const rec = install();
    await openModal();

    await userEvent.selectOptions(savedSelect(), 'c1');
    await userEvent.click(screen.getByTestId('sql-delete-connection'));
    await userEvent.click(screen.getByRole('button', { name: 'Keep' }));

    expect(rec.deletedIds).toHaveLength(0);
    expect(screen.getByRole('option', { name: 'Staging PG' })).toBeInTheDocument();
  });
});

describe('SqlRunModal — prefill precedence on open', () => {
  it('the lastUsedByPackage hint wins over the package physical config', async () => {
    install({
      lastUsedByPackage: { orders: 'c1' },
      physical: { dialect: 'mysql', connection: { host: 'phys-host' } },
    });
    await openModal();

    await waitFor(() => expect(savedSelect().value).toBe('c1'));
    expect(dialectSelect().value).toBe('postgres'); // from the entry, not the physical config
    expect(hostInput().value).toBe('db.stage');
    expect(userInput().value).toBe('app');
  });

  it('without a hint, the physical config prefills the form', async () => {
    install({
      lastUsedByPackage: {},
      physical: { dialect: 'mysql', connection: { host: 'phys-host', port: 3306, database: 'shop' } },
    });
    await openModal();

    expect(savedSelect().value).toBe(''); // nothing selected
    expect(dialectSelect().value).toBe('mysql');
    await waitFor(() => expect(hostInput().value).toBe('phys-host'));
  });

  it('a hint pointing at a deleted entry falls back to the physical config', async () => {
    install({
      lastUsedByPackage: { orders: 'gone-id' },
      physical: { dialect: 'mysql', connection: { host: 'phys-host' } },
    });
    await openModal();

    expect(savedSelect().value).toBe('');
    expect(dialectSelect().value).toBe('mysql');
    await waitFor(() => expect(hostInput().value).toBe('phys-host'));
  });
});
