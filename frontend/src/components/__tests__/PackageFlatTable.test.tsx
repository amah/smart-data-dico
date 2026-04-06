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
    expect(screen.getByText('-')).toBeInTheDocument(); // null type
    expect(screen.getByText('2')).toBeInTheDocument(); // user-service entity count
    expect(screen.getByText('0')).toBeInTheDocument(); // order-service entity count
  });

  it('renders error on API failure', async () => {
    server.use(
      http.get('/api/packages/all', () => {
        return new HttpResponse(null, { status: 500 });
      }),
    );
    render(<PackageFlatTable />);

    await waitFor(() => {
      expect(screen.getByText('Failed to load packages. Please try again.')).toBeInTheDocument();
    });
  });

  it('renders empty state', async () => {
    server.use(
      http.get('/api/packages/all', () => {
        return HttpResponse.json({ data: [] });
      }),
    );
    render(<PackageFlatTable />);

    await waitFor(() => {
      expect(screen.getByText('No packages found.')).toBeInTheDocument();
    });
  });

  it('allows inline editing of package name', async () => {
    setupHandlers();
    let capturedBody: any;
    server.use(
      http.put('/api/packages/:pkg/path/', async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json({ message: 'Updated', data: capturedBody });
      }),
    );

    render(<PackageFlatTable />);

    await waitFor(() => {
      expect(screen.getByText('user-service')).toBeInTheDocument();
    });

    const nameCell = screen.getByText('user-service').closest('td')!;
    await userEvent.click(nameCell);

    const input = within(nameCell).getByRole('textbox');
    await userEvent.clear(input);
    await userEvent.type(input, 'account-service{enter}');

    await waitFor(() => {
      expect(capturedBody).toBeDefined();
      expect(capturedBody.name).toBe('account-service');
    });
  });

  it('allows inline editing of package description', async () => {
    setupHandlers();
    let capturedBody: any;
    server.use(
      http.put('/api/packages/:pkg/path/', async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json({ message: 'Updated', data: capturedBody });
      }),
    );

    render(<PackageFlatTable />);

    await waitFor(() => {
      expect(screen.getByText('User microservice')).toBeInTheDocument();
    });

    const descCell = screen.getByText('User microservice').closest('td')!;
    await userEvent.click(descCell);

    const textarea = within(descCell).getByRole('textbox');
    await userEvent.clear(textarea);
    await userEvent.type(textarea, 'Account management service');
    // Blur to save
    textarea.blur();

    await waitFor(() => {
      expect(capturedBody).toBeDefined();
      expect(capturedBody.description).toBe('Account management service');
    });
  });

  it('non-editable columns do not enter edit mode', async () => {
    setupHandlers();
    render(<PackageFlatTable />);

    await waitFor(() => {
      expect(screen.getByText('user-service')).toBeInTheDocument();
    });

    const row = screen.getByText('user-service').closest('tr')!;

    // Microservice type, entity count, dates should be plain tds
    const microserviceCell = within(row).getByText('microservice').closest('td')!;
    expect(microserviceCell.className).not.toContain('cursor-pointer');

    const countCell = within(row).getByText('2').closest('td')!;
    expect(countCell.className).not.toContain('cursor-pointer');
  });

  it('reverts on save error', async () => {
    server.use(
      http.get('/api/packages/all', () => {
        return HttpResponse.json({ data: mockPackages });
      }),
      http.put('/api/packages/:pkg/path/', () => {
        return new HttpResponse(null, { status: 500 });
      }),
    );

    render(<PackageFlatTable />);

    await waitFor(() => {
      expect(screen.getByText('user-service')).toBeInTheDocument();
    });

    const nameCell = screen.getByText('user-service').closest('td')!;
    await userEvent.click(nameCell);
    const input = within(nameCell).getByRole('textbox');
    await userEvent.clear(input);
    await userEvent.type(input, 'broken{enter}');

    await waitFor(() => {
      expect(screen.getByText('user-service')).toBeInTheDocument();
    });
  });
});
