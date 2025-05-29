import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';

import { server } from '../../test/setup';
import { mockEntityHierarchy } from '../../test/handlers';
import { AttributeType } from '../../types';
import EntityHierarchyView from '../EntityHierarchyView';

describe('EntityHierarchyView Component', () => {
  // Mock console.log to prevent test output pollution from button clicks
  const originalConsoleLog = console.log;
  beforeEach(() => {
    console.log = vi.fn();
  });

  afterEach(() => {
    console.log = originalConsoleLog;
  });

  const renderComponent = () => {
    return render(
      <MemoryRouter initialEntries={['/tree/hierarchy/order-service/Order']}>
        <Routes>
          <Route path="/tree/hierarchy/:microservice/:entityName" element={<EntityHierarchyView />} />
        </Routes>
      </MemoryRouter>
    );
  };

  it('should render loading state initially', async () => {
    // Override the handler to delay response
    server.use(
      http.get('/api/entities/hierarchy/:microservice/:entityName', async () => {
        // Delay the response to show loading state
        await new Promise(resolve => setTimeout(resolve, 100));
        return HttpResponse.json({
          message: 'Success',
          data: mockEntityHierarchy
        });
      })
    );

    renderComponent();

    // Loading state should be visible - check for the loading spinner element
    expect(screen.getByText('Entity Hierarchy: Order')).toBeInTheDocument();
    // Use a more specific query to find the loading spinner by its class
    expect(document.querySelector('.loading.loading-spinner')).toBeInTheDocument();
  });

  it('should render error message when API call fails', async () => {
    // Override the handler to return an error
    server.use(
      http.get('/api/entities/hierarchy/:microservice/:entityName', () => {
        return new HttpResponse(null, { status: 500 });
      })
    );

    renderComponent();

    // Wait for error message to appear
    await waitFor(() => {
      expect(screen.getByText('Failed to load entity hierarchy.')).toBeInTheDocument();
    });
  });

  it('should render empty state when no hierarchy data is found', async () => {
    // Override the handler to return null data
    server.use(
      http.get('/api/entities/hierarchy/:microservice/:entityName', () => {
        return HttpResponse.json({
          message: 'Success',
          data: null
        });
      })
    );

    renderComponent();

    // Wait for empty state message to appear
    await waitFor(() => {
      expect(screen.getByText('No hierarchy data found.')).toBeInTheDocument();
    });
  });

  it('should render hierarchy data correctly', async () => {
    // Use the default handler which returns mockEntityHierarchy

    renderComponent();

    // Wait for hierarchy data to load
    await waitFor(() => {
      expect(screen.getByText('Entity Hierarchy: Order')).toBeInTheDocument();
    });

    // Check if parent entity is rendered
    expect(screen.getByText('Order')).toBeInTheDocument();
    expect(screen.getByText('Order entity')).toBeInTheDocument();
    // Use getAllByText since 'order-service' appears multiple times
    expect(screen.getAllByText('order-service').length).toBeGreaterThan(0);

    // Check if attributes are rendered - use getAllByText for elements that appear multiple times
    expect(screen.getAllByText('id').length).toBeGreaterThan(0);
    expect(screen.getByText('total')).toBeInTheDocument();
    expect(screen.getByText('Order ID')).toBeInTheDocument();
    expect(screen.getByText('Order total')).toBeInTheDocument();

    // Check if child entity is rendered
    expect(screen.getByText('OrderItem')).toBeInTheDocument();
    expect(screen.getByText('Order item entity')).toBeInTheDocument();
    expect(screen.getByText('Child Entities (Composition):')).toBeInTheDocument();

    // Check if child attributes are rendered
    expect(screen.getByText('quantity')).toBeInTheDocument();
    expect(screen.getByText('Item quantity')).toBeInTheDocument();
  });

  it('should render entity with metadata correctly', async () => {
    // Create a modified hierarchy with metadata
    const hierarchyWithMetadata = {
      ...mockEntityHierarchy,
      entity: {
        ...mockEntityHierarchy.entity,
        attributes: [
          ...mockEntityHierarchy.entity.attributes,
          {
            uuid: 'attr5',
            name: 'status',
            description: 'Order status',
            type: AttributeType.STRING,
            required: true,
            metadata: {
              source: 'external',
              validation: 'enum',
              allowedValues: 'pending,completed,cancelled'
            }
          }
        ]
      }
    };

    // Override the handler to return hierarchy with metadata
    server.use(
      http.get('/api/entities/hierarchy/:microservice/:entityName', () => {
        return HttpResponse.json({
          message: 'Success',
          data: hierarchyWithMetadata
        });
      })
    );

    renderComponent();

    // Wait for hierarchy data to load
    await waitFor(() => {
      expect(screen.getByText('Entity Hierarchy: Order')).toBeInTheDocument();
    });

    // Check if metadata is rendered
    expect(screen.getByText('source:')).toBeInTheDocument();
    expect(screen.getByText('external')).toBeInTheDocument();
    expect(screen.getByText('validation:')).toBeInTheDocument();
    expect(screen.getByText('enum')).toBeInTheDocument();
    expect(screen.getByText('allowedValues:')).toBeInTheDocument();
    expect(screen.getByText('pending,completed,cancelled')).toBeInTheDocument();
  });

  it('should handle edit button click', async () => {
    renderComponent();

    // Wait for hierarchy data to load
    await waitFor(() => {
      expect(screen.getByText('Entity Hierarchy: Order')).toBeInTheDocument();
    });

    // Find and click the edit button
    const editButtons = screen.getAllByTitle('Edit');
    fireEvent.click(editButtons[0]);

    // Check if console.log was called with the correct entity
    expect(console.log).toHaveBeenCalledWith('Edit', expect.objectContaining({
      name: 'Order',
      description: 'Order entity'
    }));
  });

  it('should handle delete button click', async () => {
    renderComponent();

    // Wait for hierarchy data to load
    await waitFor(() => {
      expect(screen.getByText('Entity Hierarchy: Order')).toBeInTheDocument();
    });

    // Find and click the delete button
    const deleteButtons = screen.getAllByTitle('Delete');
    fireEvent.click(deleteButtons[0]);

    // Check if console.log was called with the correct entity
    expect(console.log).toHaveBeenCalledWith('Delete', expect.objectContaining({
      name: 'Order',
      description: 'Order entity'
    }));
  });

  it('should handle add child button click', async () => {
    renderComponent();

    // Wait for hierarchy data to load
    await waitFor(() => {
      expect(screen.getByText('Entity Hierarchy: Order')).toBeInTheDocument();
    });

    // Find and click the add child button
    const addChildButtons = screen.getAllByTitle('Add Child');
    fireEvent.click(addChildButtons[0]);

    // Check if console.log was called with the correct entity
    expect(console.log).toHaveBeenCalledWith('Add Child', expect.objectContaining({
      name: 'Order',
      description: 'Order entity'
    }));
  });

  it('should handle move up button click', async () => {
    renderComponent();

    // Wait for hierarchy data to load
    await waitFor(() => {
      expect(screen.getByText('Entity Hierarchy: Order')).toBeInTheDocument();
    });

    // Find and click the move up button
    const moveUpButtons = screen.getAllByTitle('Move Up');
    fireEvent.click(moveUpButtons[0]);

    // Check if console.log was called with the correct entity
    expect(console.log).toHaveBeenCalledWith('Move Up', expect.objectContaining({
      name: 'Order',
      description: 'Order entity'
    }));
  });

  it('should handle move down button click', async () => {
    renderComponent();

    // Wait for hierarchy data to load
    await waitFor(() => {
      expect(screen.getByText('Entity Hierarchy: Order')).toBeInTheDocument();
    });

    // Find and click the move down button
    const moveDownButtons = screen.getAllByTitle('Move Down');
    fireEvent.click(moveDownButtons[0]);

    // Check if console.log was called with the correct entity
    expect(console.log).toHaveBeenCalledWith('Move Down', expect.objectContaining({
      name: 'Order',
      description: 'Order entity'
    }));
  });

  it('should handle move left button click', async () => {
    renderComponent();

    // Wait for hierarchy data to load
    await waitFor(() => {
      expect(screen.getByText('Entity Hierarchy: Order')).toBeInTheDocument();
    });

    // Find and click the move left button
    const moveLeftButtons = screen.getAllByTitle('Move Left');
    fireEvent.click(moveLeftButtons[0]);

    // Check if console.log was called with the correct entity
    expect(console.log).toHaveBeenCalledWith('Move Left', expect.objectContaining({
      name: 'Order',
      description: 'Order entity'
    }));
  });

  it('should handle move right button click', async () => {
    renderComponent();

    // Wait for hierarchy data to load
    await waitFor(() => {
      expect(screen.getByText('Entity Hierarchy: Order')).toBeInTheDocument();
    });

    // Find and click the move right button
    const moveRightButtons = screen.getAllByTitle('Move Right');
    fireEvent.click(moveRightButtons[0]);

    // Check if console.log was called with the correct entity
    expect(console.log).toHaveBeenCalledWith('Move Right', expect.objectContaining({
      name: 'Order',
      description: 'Order entity'
    }));
  });

  it('should not fetch data if microservice or entityName is missing', async () => {
    // Spy on fetch to verify it's not called
    const fetchSpy = vi.spyOn(window, 'fetch');
    
    render(
      <MemoryRouter initialEntries={['/tree/hierarchy//']}>
        <Routes>
          <Route path="/tree/hierarchy/:microservice/:entityName" element={<EntityHierarchyView />} />
        </Routes>
      </MemoryRouter>
    );

    // Wait a bit to ensure no API calls are made
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Verify that fetch was not called with the entity hierarchy endpoint
    expect(fetchSpy).not.toHaveBeenCalledWith(
      expect.stringContaining('/api/entities/hierarchy/'),
      expect.anything()
    );
    
    fetchSpy.mockRestore();
  });
});