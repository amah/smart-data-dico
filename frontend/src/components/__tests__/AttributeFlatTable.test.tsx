import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../../test/setup';
import { AttributeType } from '../../types';
import AttributeFlatTable from '../AttributeFlatTable';

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
        attributes: [
          {
            uuid: 'attr-1',
            name: 'email',
            description: 'User email',
            type: AttributeType.STRING,
            required: true,
            metadata: [
              { name: 'pii', value: true },
              { name: 'source', value: 'registration' },
            ],
          },
          {
            uuid: 'attr-2',
            name: 'age',
            description: 'User age',
            type: AttributeType.NUMBER,
            required: false,
            metadata: [],
          },
        ],
      },
    ],
  },
  {
    id: 'pkg-2',
    name: 'order-service',
    description: 'Order microservice',
    entities: [
      {
        uuid: 'ent-2',
        name: 'Order',
        description: 'Order entity',
        attributes: [
          {
            uuid: 'attr-3',
            name: 'total',
            description: 'Order total',
            type: AttributeType.NUMBER,
            required: true,
            metadata: [],
          },
        ],
      },
    ],
  },
];

const mockStereotypes = [
  {
    id: 'st-1',
    name: 'Data Classification',
    appliesTo: 'attribute',
    metadataDefinitions: [
      { name: 'pii', type: 'flag', description: 'Personally identifiable info' },
      { name: 'source', type: 'string', description: 'Data source' },
    ],
  },
];

describe('AttributeFlatTable', () => {
  const setupHandlers = () => {
    server.use(
      http.get('/api/packages/all', () => {
        return HttpResponse.json({ data: mockPackages });
      }),
      http.get('/api/stereotypes', () => {
        return HttpResponse.json({ data: mockStereotypes });
      }),
      http.put('/api/services/:service/entities/:entity', async ({ request }) => {
        const body = await request.json();
        return HttpResponse.json({ message: 'Updated', data: body });
      }),
    );
  };

  it('renders loading spinner initially', () => {
    setupHandlers();
    render(<AttributeFlatTable />);
    expect(document.querySelector('.loading-spinner')).toBeInTheDocument();
  });

  it('renders all attributes from all packages', async () => {
    setupHandlers();
    render(<AttributeFlatTable />);

    await waitFor(() => {
      expect(screen.getByText('email')).toBeInTheDocument();
    });

    expect(screen.getByText('age')).toBeInTheDocument();
    expect(screen.getByText('total')).toBeInTheDocument();
    // Check entity/package context columns
    expect(screen.getAllByText('User').length).toBeGreaterThan(0);
    expect(screen.getByText('Order')).toBeInTheDocument();
    expect(screen.getAllByText('user-service').length).toBeGreaterThan(0);
    expect(screen.getByText('order-service')).toBeInTheDocument();
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
    render(<AttributeFlatTable />);

    await waitFor(() => {
      expect(screen.getByText('Failed to load attributes. Please try again.')).toBeInTheDocument();
    });
  });

  it('renders empty state when no attributes exist', async () => {
    server.use(
      http.get('/api/packages/all', () => {
        return HttpResponse.json({ data: [{ id: 'pkg-1', name: 'empty-pkg', entities: [] }] });
      }),
      http.get('/api/stereotypes', () => {
        return HttpResponse.json({ data: [] });
      }),
    );
    render(<AttributeFlatTable />);

    await waitFor(() => {
      expect(screen.getByText('No attributes found.')).toBeInTheDocument();
    });
  });

  it('allows inline editing of attribute name', async () => {
    setupHandlers();
    let capturedBody: any;
    server.use(
      http.put('/api/services/:service/entities/:entity', async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json({ message: 'Updated', data: capturedBody });
      }),
    );

    render(<AttributeFlatTable />);

    await waitFor(() => {
      expect(screen.getByText('email')).toBeInTheDocument();
    });

    // Click on the "email" cell to enter edit mode
    const emailCell = screen.getByText('email').closest('td')!;
    await userEvent.click(emailCell);

    const input = within(emailCell).getByRole('textbox') as HTMLInputElement;
    expect(input.value).toBe('email');

    await userEvent.clear(input);
    await userEvent.type(input, 'email_address{enter}');

    await waitFor(() => {
      expect(capturedBody).toBeDefined();
      expect(capturedBody.attributes[0].name).toBe('email_address');
    });
  });

  it('allows inline editing of attribute type via dropdown', async () => {
    setupHandlers();
    let capturedBody: any;
    server.use(
      http.put('/api/services/:service/entities/:entity', async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json({ message: 'Updated', data: capturedBody });
      }),
    );

    render(<AttributeFlatTable />);

    await waitFor(() => {
      expect(screen.getByText('email')).toBeInTheDocument();
    });

    // Find the type cell for 'email' — it should show 'string'
    const row = screen.getByText('email').closest('tr')!;
    const stringCell = within(row).getByText('string').closest('td')!;
    await userEvent.click(stringCell);

    const select = within(stringCell).getByRole('combobox');
    await userEvent.selectOptions(select, 'boolean');

    await waitFor(() => {
      expect(capturedBody).toBeDefined();
      expect(capturedBody.attributes[0].type).toBe('boolean');
    });
  });

  it('allows toggling the required field', async () => {
    setupHandlers();
    let capturedBody: any;
    server.use(
      http.put('/api/services/:service/entities/:entity', async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json({ message: 'Updated', data: capturedBody });
      }),
    );

    render(<AttributeFlatTable />);

    await waitFor(() => {
      expect(screen.getByText('email')).toBeInTheDocument();
    });

    // Find the 'age' row — required is false. Click the required checkbox
    // (which is the first checkbox in the row, since metadata flags follow it).
    const ageRow = screen.getByText('age').closest('tr')!;
    const checkboxes = within(ageRow).getAllByRole('checkbox') as HTMLInputElement[];
    const requiredCheckbox = checkboxes[0];
    expect(requiredCheckbox.checked).toBe(false);
    await userEvent.click(requiredCheckbox);

    await waitFor(() => {
      expect(capturedBody).toBeDefined();
      // age is the second attribute (index 1)
      expect(capturedBody.attributes[1].required).toBe(true);
    });
  });

  it('entity name and package name columns are not editable', async () => {
    setupHandlers();
    render(<AttributeFlatTable />);

    await waitFor(() => {
      expect(screen.getByText('email')).toBeInTheDocument();
    });

    const row = screen.getByText('email').closest('tr')!;
    const entityCell = within(row).getByText('User').closest('td')!;
    const pkgCell = within(row).getByText('user-service').closest('td')!;

    // These cells should not have the cursor-pointer class (not editable)
    expect(entityCell.className).not.toContain('cursor-pointer');
    expect(pkgCell.className).not.toContain('cursor-pointer');
  });

  it('reverts value on save failure', async () => {
    server.use(
      http.get('/api/packages/all', () => {
        return HttpResponse.json({ data: mockPackages });
      }),
      http.get('/api/stereotypes', () => {
        return HttpResponse.json({ data: mockStereotypes });
      }),
      http.put('/api/services/:service/entities/:entity', () => {
        return new HttpResponse(null, { status: 500 });
      }),
    );

    render(<AttributeFlatTable />);

    await waitFor(() => {
      expect(screen.getByText('email')).toBeInTheDocument();
    });

    const emailCell = screen.getByText('email').closest('td')!;
    await userEvent.click(emailCell);
    const input = within(emailCell).getByRole('textbox');
    await userEvent.clear(input);
    await userEvent.type(input, 'bad_name{enter}');

    // Should revert to original value
    await waitFor(() => {
      expect(screen.getByText('email')).toBeInTheDocument();
    });
  });
});
