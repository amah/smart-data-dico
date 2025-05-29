import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { servicesApi } from '../../services/api';
import { AttributeType } from '../../types';
import EntityList from '../EntityList';

// Mock the API service
vi.mock('../../services/api', () => ({
  servicesApi: {
    getServiceEntities: vi.fn()
  }
}));

describe('EntityList Component', () => {
  const mockEntities = [
    {
      id: 'User',
      name: 'User',
      description: 'User entity',
      microservice: 'user-service',
      version: '1.0.0',
      attributes: [
        {
          name: 'id',
          description: 'User ID',
          type: AttributeType.STRING,
          required: true
        },
        {
          name: 'email',
          description: 'User email',
          type: AttributeType.STRING,
          format: 'email',
          required: true
        }
      ],
      relationships: [
        {
          name: 'profile',
          description: 'User profile',
          type: 'hasOne',
          target: 'Profile',
          required: false
        }
      ]
    },
    {
      id: 'Profile',
      name: 'Profile',
      description: 'User profile entity',
      microservice: 'user-service',
      version: '1.0.0',
      attributes: [
        {
          name: 'id',
          description: 'Profile ID',
          type: AttributeType.STRING,
          required: true
        }
      ],
      relationships: []
    }
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render loading state initially', () => {
    // Mock API to return a promise that doesn't resolve immediately
    vi.mocked(servicesApi.getServiceEntities).mockReturnValue(
      new Promise(() => {})
    );

    render(
      <MemoryRouter initialEntries={['/services/user-service/entities']}>
        <Routes>
          <Route path="/services/:service/entities" element={<EntityList />} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('should render entities when loaded successfully', async () => {
    // Mock API to return entities
    vi.mocked(servicesApi.getServiceEntities).mockResolvedValue({
      data: mockEntities
    });

    render(
      <MemoryRouter initialEntries={['/services/user-service/entities']}>
        <Routes>
          <Route path="/services/:service/entities" element={<EntityList />} />
        </Routes>
      </MemoryRouter>
    );

    // Wait for entities to load
    await waitFor(() => {
      expect(screen.getByText('user-service Entities')).toBeInTheDocument();
    });

    // Check if entities are rendered
    expect(screen.getByText('User')).toBeInTheDocument();
    expect(screen.getByText('Profile')).toBeInTheDocument();
    expect(screen.getByText('User entity')).toBeInTheDocument();
    expect(screen.getByText('User profile entity')).toBeInTheDocument();
  });

  it('should render error message when API call fails', async () => {
    // Mock API to throw an error
    vi.mocked(servicesApi.getServiceEntities).mockRejectedValue(
      new Error('Failed to fetch entities')
    );

    render(
      <MemoryRouter initialEntries={['/services/user-service/entities']}>
        <Routes>
          <Route path="/services/:service/entities" element={<EntityList />} />
        </Routes>
      </MemoryRouter>
    );

    // Wait for error message to appear
    await waitFor(() => {
      expect(screen.getByText('Failed to load entities. Please try again later.')).toBeInTheDocument();
    });
  });

  it('should render empty state when no entities are found', async () => {
    // Mock API to return empty array
    vi.mocked(servicesApi.getServiceEntities).mockResolvedValue({
      data: []
    });

    render(
      <MemoryRouter initialEntries={['/services/user-service/entities']}>
        <Routes>
          <Route path="/services/:service/entities" element={<EntityList />} />
        </Routes>
      </MemoryRouter>
    );

    // Wait for empty state message to appear
    await waitFor(() => {
      expect(screen.getByText('No entities found for this service. Create a new entity to get started.')).toBeInTheDocument();
    });
  });

  it('should render error when service param is missing', () => {
    render(
      <MemoryRouter initialEntries={['/services//entities']}>
        <Routes>
          <Route path="/services/:service/entities" element={<EntityList />} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByText('Service name is required')).toBeInTheDocument();
  });
it('should render hierarchical packages and entities', async () => {
    const hierarchicalEntities = [
      {
        id: 'core',
        name: 'Core',
        type: 'package',
        subpackages: [
          {
            id: 'metrics',
            name: 'Metrics',
            type: 'package',
            entities: [
              {
                id: 'event',
                name: 'Event',
                description: 'Event entity',
                type: 'entity'
              }
            ],
            subpackages: []
          }
        ],
        entities: []
      }
    ];
    // Mock API to return hierarchical structure
    vi.mocked(servicesApi.getServiceEntities).mockResolvedValue({
      data: hierarchicalEntities
    });

    render(
      <MemoryRouter initialEntries={['/services/analytics-service/entities']}>
        <Routes>
          <Route path="/services/:service/entities" element={<EntityList />} />
        </Routes>
      </MemoryRouter>
    );

    // Wait for hierarchical data to load and check for nested entity
    await waitFor(() => {
      expect(screen.getByText('Core')).toBeInTheDocument();
      expect(screen.getByText('Metrics')).toBeInTheDocument();
      expect(screen.getByText('Event')).toBeInTheDocument();
    });
  });
});