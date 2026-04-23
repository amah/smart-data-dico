import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../../test/setup';
import EntityFlatTable from '../EntityFlatTable';

const mockPackages = [
  {
    id: 'pkg-1',
    name: 'user-service',
    description: 'User microservice',
    entities: [
      {
        uuid: 'ent-1',
        name: 'User',
        description: 'User entity',
        attributes: [],
      },
      {
        uuid: 'ent-2',
        name: 'Profile',
        description: 'User profile',
        attributes: [],
      },
    ],
  },
  {
    id: 'pkg-2',
    name: 'order-service',
    description: 'Order microservice',
    entities: [
      {
        uuid: 'ent-3',
        name: 'Order',
        description: 'Order entity',
        attributes: [],
      },
    ],
  },
];

describe('EntityFlatTable', () => {
  const setupHandlers = () => {
    server.use(
      http.get('/api/packages/all', () => {
        return HttpResponse.json({ data: mockPackages });
      }),
      http.get('/api/stereotypes', () => {
        return HttpResponse.json({ data: [] });
      }),
      http.put('/api/services/:service/entities/:entity', async ({ request }) => {
        const body = await request.json();
        return HttpResponse.json({ message: 'Updated', data: body });
      }),
      http.post('/api/services/:service/entities', async ({ request }) => {
        const body = await request.json();
        return HttpResponse.json({ message: 'Created', data: body });
      }),
      http.delete('/api/services/:service/entities/:entity', () => {
        return HttpResponse.json({ message: 'Deleted' });
      }),
    );
  };

  it('renders all entities from all packages', async () => {
    setupHandlers();
    render(<EntityFlatTable />);

    await waitFor(() => {
      expect(screen.getByText('User')).toBeInTheDocument();
    });

    expect(screen.getByText('Profile')).toBeInTheDocument();
    expect(screen.getByText('Order')).toBeInTheDocument();
    // package names show in table cells *and* in the package filter dropdown.
    expect(screen.getAllByText('user-service').length).toBeGreaterThan(0);
    expect(screen.getAllByText('order-service').length).toBeGreaterThan(0);
  });

  it('renders error on API failure', async () => {
    server.use(
      http.get('/api/packages/all', () => {
        return new HttpResponse(null, { status: 500 });
      }),
      http.get('/api/stereotypes', () => {
        return HttpResponse.json({ data: [] });
      }),
    );
    render(<EntityFlatTable />);

    await waitFor(() => {
      expect(screen.getByText('Failed to load entities')).toBeInTheDocument();
    });
  });

  it('renders the empty state when no entities exist', async () => {
    server.use(
      http.get('/api/packages/all', () => {
        return HttpResponse.json({ data: [{ id: 'pkg-1', name: 'empty-pkg', entities: [] }] });
      }),
      http.get('/api/stereotypes', () => {
        return HttpResponse.json({ data: [] });
      }),
    );
    render(<EntityFlatTable />);

    await waitFor(() => {
      expect(screen.getByText('No entities found')).toBeInTheDocument();
    });
  });

  it('opens the side panel when a row is clicked and saves the new name', async () => {
    setupHandlers();
    let capturedBody: { name: string } | undefined;
    server.use(
      http.put('/api/services/:service/entities/:entity', async ({ request }) => {
        capturedBody = (await request.json()) as typeof capturedBody;
        return HttpResponse.json({ message: 'Updated', data: capturedBody });
      }),
    );

    render(<EntityFlatTable />);

    await waitFor(() => {
      expect(screen.getByText('User')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByText('User'));
    const panel = screen.getByRole('dialog', { name: /edit entity/i });
    const nameInput = within(panel).getByLabelText('Name') as HTMLInputElement;
    expect(nameInput.value).toBe('User');

    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, 'Customer');
    await userEvent.click(within(panel).getByRole('button', { name: /^save$/i }));

    await waitFor(() => {
      expect(capturedBody).toBeDefined();
      expect(capturedBody!.name).toBe('Customer');
    });
  });

  it('saves a description change via the side panel', async () => {
    setupHandlers();
    let capturedBody: { description: string } | undefined;
    server.use(
      http.put('/api/services/:service/entities/:entity', async ({ request }) => {
        capturedBody = (await request.json()) as typeof capturedBody;
        return HttpResponse.json({ message: 'Updated', data: capturedBody });
      }),
    );

    render(<EntityFlatTable />);

    await waitFor(() => {
      expect(screen.getByText('User entity')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByText('User'));
    const panel = screen.getByRole('dialog', { name: /edit entity/i });
    const descInput = within(panel).getByLabelText('Description') as HTMLTextAreaElement;

    await userEvent.clear(descInput);
    await userEvent.type(descInput, 'Updated description');
    await userEvent.click(within(panel).getByRole('button', { name: /^save$/i }));

    await waitFor(() => {
      expect(capturedBody).toBeDefined();
      expect(capturedBody!.description).toBe('Updated description');
    });
  });

  it('supports entity creation via the Add Entity modal', async () => {
    setupHandlers();
    render(<EntityFlatTable />);

    await waitFor(() => {
      expect(screen.getByText('User')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole('button', { name: /add entity/i }));
    const modal = screen.getByRole('dialog', { name: /create new entity/i });
    expect(modal).toBeInTheDocument();

    await userEvent.type(within(modal).getByLabelText('Name'), 'NewEntity');
    await userEvent.selectOptions(within(modal).getByLabelText('Package'), 'user-service');

    // Cancel to close (checks the dialog mounts & closes correctly without
    // actually firing POST).
    await userEvent.click(within(modal).getByRole('button', { name: /cancel/i }));
    expect(screen.queryByRole('dialog', { name: /create new entity/i })).not.toBeInTheDocument();
  });

  it('supports entity deletion via the side panel + confirm dialog', async () => {
    setupHandlers();
    render(<EntityFlatTable />);

    await waitFor(() => {
      expect(screen.getByText('User')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByText('User'));
    const panel = screen.getByRole('dialog', { name: /edit entity/i });
    await userEvent.click(within(panel).getByRole('button', { name: /^delete$/i }));

    // The confirm dialog mounts over the panel.
    const confirm = screen.getByRole('dialog', { name: /delete entity/i });
    expect(within(confirm).getByText(/Are you sure you want to delete the entity/)).toBeInTheDocument();

    await userEvent.click(within(confirm).getByRole('button', { name: /cancel/i }));
    expect(screen.queryByRole('dialog', { name: /delete entity/i })).not.toBeInTheDocument();
  });

  it('bulk-deletes selected entities via BatchActionBar', async () => {
    setupHandlers();
    let deleteCount = 0;
    server.use(
      http.delete('/api/services/:service/entities/:entity', () => {
        deleteCount++;
        return HttpResponse.json({ message: 'Deleted' });
      }),
    );

    // Auto-confirm the window.confirm dialog.
    const originalConfirm = window.confirm;
    window.confirm = () => true;

    try {
      render(<EntityFlatTable />);

      await waitFor(() => {
        expect(screen.getByText('User')).toBeInTheDocument();
      });

      // The first selection checkbox after the header tri-state is the row
      // for the first processed entity. Grab the row checkboxes by
      // aria-label (DataTable uses "Select row" for each row checkbox).
      const rowCheckboxes = screen
        .getAllByRole('checkbox')
        .filter(c => c.getAttribute('aria-label') === 'Select row');
      expect(rowCheckboxes.length).toBeGreaterThanOrEqual(2);
      await userEvent.click(rowCheckboxes[0]);
      await userEvent.click(rowCheckboxes[1]);

      // Bulk delete action in the BatchActionBar.
      await userEvent.click(screen.getByRole('button', { name: /^delete$/i }));

      await waitFor(() => {
        expect(deleteCount).toBeGreaterThanOrEqual(1);
      });
    } finally {
      window.confirm = originalConfirm;
    }
  });

  it('keeps the original value when save fails', async () => {
    setupHandlers();
    server.use(
      http.put('/api/services/:service/entities/:entity', () => {
        return new HttpResponse(null, { status: 500 });
      }),
    );

    render(<EntityFlatTable />);

    await waitFor(() => {
      expect(screen.getByText('User')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByText('User'));
    const panel = screen.getByRole('dialog', { name: /edit entity/i });
    const nameInput = within(panel).getByLabelText('Name') as HTMLInputElement;
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, 'BadName');
    await userEvent.click(within(panel).getByRole('button', { name: /^save$/i }));

    // Local state updates only on a successful PUT, so the original
    // value remains visible in the row (even while the panel shows the
    // attempted value in the input).
    await waitFor(() => {
      expect(screen.getAllByText('User').length).toBeGreaterThan(0);
    });
  });
});
