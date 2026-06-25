/**
 * SagaDiagram.test.tsx — #201 Phase 3.
 *
 * 1. sagaGraphToElements (pure): builds elements + applies the command/query
 *    visibility filter (drops hidden actions, their edges, and orphaned events).
 * 2. The component fetches a package's actions+events and renders the legend
 *    (Cytoscape mocked so jsdom needs no canvas).
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { Action, Event } from '../../../../types';
import { actionsToSagaGraph } from '../actionsToSagaGraph';
import { SagaDiagram, sagaGraphToElements } from '../SagaDiagram';

vi.mock('../../../../../components/CytoscapeGraph/useCytoscapeInstance', () => ({
  useCytoscapeInstance: () => ({ cyRef: { current: null }, cy: null }),
}));
vi.mock('../../../../../components/CytoscapeGraph/useCytoscapeLayout', () => ({
  useCytoscapeLayout: () => ({ runLayout: vi.fn() }),
}));

const actionsFixture: Action[] = [
  { uuid: 'pay', name: 'pay', ownerRef: 'e', actionKind: 'command', flow: [{ kind: 'emitEvent', name: 'order.paid', eventRef: 'evt-paid' }] },
  { uuid: 'status', name: 'status', ownerRef: 'e', actionKind: 'query' },
  { uuid: 'ship', name: 'ship', ownerRef: 'e', actionKind: 'command', flow: [{ kind: 'wait', for: 'order.paid', eventRef: 'evt-paid' }] },
];
const eventsFixture: Event[] = [{ uuid: 'evt-paid', name: 'order.paid' }];

vi.mock('../../../../../services/api', () => ({
  actionsApi: { getForPackage: vi.fn(async () => actionsFixture) },
  eventsApi: { getAll: vi.fn(async () => eventsFixture) },
}));

describe('sagaGraphToElements', () => {
  const graph = actionsToSagaGraph(actionsFixture, eventsFixture);

  it('emits an element per node + edge with no filter', () => {
    const els = sagaGraphToElements(graph);
    expect(els.filter((e) => e.data.nodeType === 'action')).toHaveLength(3);
    expect(els.some((e) => e.data.nodeType === 'event')).toBe(true);
    expect(els.some((e) => e.data.kind === 'emit')).toBe(true);
    expect(els.some((e) => e.data.kind === 'react')).toBe(true);
  });

  it('hides queries when filtered, keeping commands', () => {
    const els = sagaGraphToElements(graph, { query: true });
    const actionLabels = els.filter((e) => e.data.nodeType === 'action').map((e) => e.data.label);
    expect(actionLabels).toContain('pay');
    expect(actionLabels).not.toContain('status');
  });

  it('drops an event that loses all its edges under a filter', () => {
    // Hiding both commands removes pay (emit) and ship (react) → the event orphans.
    const els = sagaGraphToElements(graph, { command: true });
    expect(els.some((e) => e.data.nodeType === 'event')).toBe(false);
  });

  it('tags internal actions for dashed styling', () => {
    const g = actionsToSagaGraph([{ uuid: 'x', name: 'x', ownerRef: 'e', internal: true }]);
    const el = sagaGraphToElements(g).find((e) => e.data.nodeType === 'action')!;
    expect(el.data.internal).toBe(1);
  });
});

describe('<SagaDiagram>', () => {
  it('fetches the package and renders the CQRS legend', async () => {
    render(<SagaDiagram service="order-service" />);
    await waitFor(() => expect(screen.getByText('Command')).toBeInTheDocument());
    expect(screen.getByText('Query')).toBeInTheDocument();
    expect(screen.getByText('Event')).toBeInTheDocument();
  });

  it('shows a hint when no package is selected', () => {
    render(<SagaDiagram />);
    expect(screen.getByText(/Open a package to see its process/i)).toBeInTheDocument();
  });
});
