import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import OrganizationDiagramEditor from '../OrganizationDiagramEditor';

describe('OrganizationDiagramEditor', () => {
  it('renders hierarchical packages and entities in the diagram', () => {
    const hierarchicalData = {
      id: 'root',
      name: 'Root',
      entities: [],
      subpackages: [
        {
          id: 'core',
          name: 'Core',
          entities: [],
          subpackages: [
            {
              id: 'metrics',
              name: 'Metrics',
              entities: [
                { id: 'event', name: 'Event', type: 'entity' }
              ],
              subpackages: []
            }
          ]
        }
      ]
    };

    render(
      <OrganizationDiagramEditor
        packages={[hierarchicalData]}
      />
    );

    // Assert that all levels are rendered
    expect(screen.getByText('Root')).toBeInTheDocument();
    expect(screen.getByText('Core')).toBeInTheDocument();
    expect(screen.getByText('Metrics')).toBeInTheDocument();
    expect(screen.getByText('Event')).toBeInTheDocument();
  });
});