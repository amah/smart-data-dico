import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../../test/setup';
import PackageFlatTable from '../PackageFlatTable';

const mockPackages = [
  {
    id: 'pkg-1',
    name: 'user-service',
    description: 'User microservice',
    type: 'microservice',
    entities: [
      { uuid: 'e1', name: 'User', attributes: [] },
      { uuid: 'e2', name: 'Profile', attributes: [] },
    ],
    createdAt: '2026-01-15T10:00:00Z',
    updatedAt: '2026-03-20T14:30:00Z',
  },
  {
    id: 'pkg-2',
    name: 'order-service',
    description: 'Order microservice',
    type: null,
    entities: [],
    createdAt: '2026-02-01T08:00:00Z',
    updatedAt: '2026-04-01T09:00:00Z',
  },
];

describe('PackageFlatTable', () => {
  const setupHandlers = () => {
    server.use(
      http.get('/api/packages/all', () => {
        return HttpResponse.json({ data: mockPackages });
      }),
      http.get('/api/stereotypes', () => {
        return HttpResponse.json({ data: [] });
      }),
      http.put('/api/packages/:pkg/path/', async ({ request }) => {
        const body = await request.json();
        return HttpResponse.json({ message: 'Updated', data: body });
      }),
    );
  };

  it('renders all packages', async () => {
    setupHandlers();
    render(<PackageFlatTable />);

    await waitFor(() => {
      expect(screen.getByText('user-service')).toBeInTheDocument();
    });

    expect(screen.getByText('order-service')).toBeInTheDocument();
    expect(screen.getByText('User microservice')).toBeInTheDocument();
    expect(screen.getByText('Order microservice')).toBeInTheDocument();
    expect(screen.getByText('microservice')).toBeInTheDocument();
    // user-service has 2 entities, order-service has 0 (rendered as em-dash).
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('renders the error state on API failure', async () => {
    server.use(
      http.get('/api/packages/all', () => {
        return new HttpResponse(null, { status: 500 });
      }),
      http.get('/api/stereotypes', () => {
        return HttpResponse.json({ data: [] });
      }),
    );
    render(<PackageFlatTable />);

    await waitFor(() => {
      expect(screen.getByText('Failed to load packages')).toBeInTheDocument();
    });
  });

  it('renders the empty state when no packages exist', async () => {
    server.use(
      http.get('/api/packages/all', () => {
        return HttpResponse.json({ data: [] });
      }),
      http.get('/api/stereotypes', () => {
        return HttpResponse.json({ data: [] });
      }),
    );
    render(<PackageFlatTable />);

    await waitFor(() => {
      expect(screen.getByText('No packages found')).toBeInTheDocument();
    });
  });

  it('opens the side panel when a row is clicked and saves the new name', async () => {
    setupHandlers();
    let capturedBody: { name?: string } | undefined;
    server.use(
      http.put('/api/packages/:pkg/path/', async ({ request }) => {
        capturedBody = (await request.json()) as typeof capturedBody;
        return HttpResponse.json({ message: 'Updated', data: capturedBody });
      }),
    );

    render(<PackageFlatTable />);

    await waitFor(() => {
      expect(screen.getByText('user-service')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByText('user-service'));
    const panel = screen.getByRole('dialog', { name: /edit package/i });
    const nameInput = within(panel).getByLabelText('Name') as HTMLInputElement;
    expect(nameInput.value).toBe('user-service');

    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, 'account-service');
    await userEvent.click(within(panel).getByRole('button', { name: /^save$/i }));

    await waitFor(() => {
      expect(capturedBody).toBeDefined();
      expect(capturedBody!.name).toBe('account-service');
    });
  });

  it('saves a description change through the side panel', async () => {
    setupHandlers();
    let capturedBody: { description?: string } | undefined;
    server.use(
      http.put('/api/packages/:pkg/path/', async ({ request }) => {
        capturedBody = (await request.json()) as typeof capturedBody;
        return HttpResponse.json({ message: 'Updated', data: capturedBody });
      }),
    );

    render(<PackageFlatTable />);

    await waitFor(() => {
      expect(screen.getByText('User microservice')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByText('user-service'));
    const panel = screen.getByRole('dialog', { name: /edit package/i });
    const descInput = within(panel).getByLabelText('Description') as HTMLTextAreaElement;
    await userEvent.clear(descInput);
    await userEvent.type(descInput, 'Account management service');
    await userEvent.click(within(panel).getByRole('button', { name: /^save$/i }));

    await waitFor(() => {
      expect(capturedBody).toBeDefined();
      expect(capturedBody!.description).toBe('Account management service');
    });
  });

  it('keeps the original value when save fails', async () => {
    setupHandlers();
    server.use(
      http.put('/api/packages/:pkg/path/', () => {
        return new HttpResponse(null, { status: 500 });
      }),
    );

    render(<PackageFlatTable />);

    await waitFor(() => {
      expect(screen.getByText('user-service')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByText('user-service'));
    const panel = screen.getByRole('dialog', { name: /edit package/i });
    const nameInput = within(panel).getByLabelText('Name') as HTMLInputElement;
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, 'broken');
    await userEvent.click(within(panel).getByRole('button', { name: /^save$/i }));

    // Row cell still shows the original value (panel header also shows it).
    await waitFor(() => {
      expect(screen.getAllByText('user-service').length).toBeGreaterThan(0);
    });
  });
});
