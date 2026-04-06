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
    // user-service appears in both table rows and filter dropdown
    expect(screen.getAllByText('user-service').length).toBeGreaterThan(0);
    expect(screen.getAllByText('order-service').length).toBeGreaterThan(0);
  });

  it('renders error on API failure', async () => {
    server.use(
      http.get('/api/packages/all', () => {
        return new HttpResponse(null, { status: 500 });
      }),
    );
    render(<EntityFlatTable />);

    await waitFor(() => {
      expect(screen.getByText('Failed to load entities. Please try again.')).toBeInTheDocument();
    });
  });

  it('allows inline editing of entity name', async () => {
    setupHandlers();
    let capturedBody: any;
    server.use(
      http.put('/api/services/:service/entities/:entity', async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json({ message: 'Updated', data: capturedBody });
      }),
    );

    render(<EntityFlatTable />);

    await waitFor(() => {
      expect(screen.getByText('User')).toBeInTheDocument();
    });

    // Click on "User" to edit
    const userCell = screen.getByText('User').closest('td')!;
    await userEvent.click(userCell);

    const input = within(userCell).getByRole('textbox');
    await userEvent.clear(input);
    await userEvent.type(input, 'Customer{enter}');

    await waitFor(() => {
      expect(capturedBody).toBeDefined();
      expect(capturedBody.name).toBe('Customer');
    });
  });

  it('allows inline editing of entity description', async () => {
    setupHandlers();
    let capturedBody: any;
    server.use(
      http.put('/api/services/:service/entities/:entity', async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json({ message: 'Updated', data: capturedBody });
      }),
    );

    render(<EntityFlatTable />);

    await waitFor(() => {
      expect(screen.getByText('User entity')).toBeInTheDocument();
    });

    // Click on description to edit
    const descCell = screen.getByText('User entity').closest('td')!;
    await userEvent.click(descCell);

    const textarea = within(descCell).getByRole('textbox');
    await userEvent.clear(textarea);
    await userEvent.type(textarea, 'Updated description');
    // Enter saves in textarea (without shift)
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });

    await waitFor(() => {
      expect(capturedBody).toBeDefined();
      expect(capturedBody.description).toBe('Updated description');
    });
  });

  it('package column is not editable (plain td)', async () => {
    setupHandlers();
    render(<EntityFlatTable />);

    await waitFor(() => {
      expect(screen.getByText('User')).toBeInTheDocument();
    });

    const row = screen.getByText('User').closest('tr')!;
    const pkgCell = within(row).getByText('user-service').closest('td')!;

    // Should not have cursor-pointer (not wrapped in EditableCell)
    expect(pkgCell.className).not.toContain('cursor-pointer');
  });

  it('does not have edit modal (replaced by inline editing)', async () => {
    setupHandlers();
    render(<EntityFlatTable />);

    await waitFor(() => {
      expect(screen.getByText('User')).toBeInTheDocument();
    });

    // There should be no edit button (pencil icon), only delete
    const row = screen.getByText('User').closest('tr')!;
    const deleteBtn = within(row).getByTitle('Delete');
    expect(deleteBtn).toBeInTheDocument();
    expect(within(row).queryByTitle('Edit')).not.toBeInTheDocument();
  });

  it('still supports entity creation via modal', async () => {
    setupHandlers();
    render(<EntityFlatTable />);

    await waitFor(() => {
      expect(screen.getByText('User')).toBeInTheDocument();
    });

    // Click "Add Entity"
    await userEvent.click(screen.getByText('Add Entity'));
    expect(screen.getByText('Create New Entity')).toBeInTheDocument();

    // Fill in the form — DaisyUI labels don't use htmlFor, so query by DOM attributes
    const modal = screen.getByText('Create New Entity').closest('div')!;
    const nameInput = modal.querySelector('input[name="name"]') as HTMLInputElement;
    await userEvent.type(nameInput, 'NewEntity');
    const pkgSelect = modal.querySelector('select[name="packageName"]') as HTMLSelectElement;
    await userEvent.selectOptions(pkgSelect, 'user-service');

    // Cancel to close
    await userEvent.click(screen.getByText('Cancel'));
    expect(screen.queryByText('Create New Entity')).not.toBeInTheDocument();
  });

  it('still supports entity deletion via modal', async () => {
    setupHandlers();
    render(<EntityFlatTable />);

    await waitFor(() => {
      expect(screen.getByText('User')).toBeInTheDocument();
    });

    const row = screen.getByText('User').closest('tr')!;
    await userEvent.click(within(row).getByTitle('Delete'));

    expect(screen.getByText('Delete Entity')).toBeInTheDocument();
    expect(screen.getByText(/Are you sure you want to delete the entity/)).toBeInTheDocument();

    // Cancel
    await userEvent.click(screen.getByText('Cancel'));
    expect(screen.queryByText('Delete Entity')).not.toBeInTheDocument();
  });

  it('reverts on save error', async () => {
    server.use(
      http.get('/api/packages/all', () => {
        return HttpResponse.json({ data: mockPackages });
      }),
      http.put('/api/services/:service/entities/:entity', () => {
        return new HttpResponse(null, { status: 500 });
      }),
    );

    render(<EntityFlatTable />);

    await waitFor(() => {
      expect(screen.getByText('User')).toBeInTheDocument();
    });

    const userCell = screen.getByText('User').closest('td')!;
    await userEvent.click(userCell);
    const input = within(userCell).getByRole('textbox');
    await userEvent.clear(input);
    await userEvent.type(input, 'BadName{enter}');

    // Should revert
    await waitFor(() => {
      expect(screen.getByText('User')).toBeInTheDocument();
    });
  });
});

// Need fireEvent for keyDown
import { fireEvent } from '@testing-library/react';
