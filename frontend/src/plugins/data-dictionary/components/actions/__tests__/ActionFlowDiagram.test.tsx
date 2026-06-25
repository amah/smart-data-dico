/**
 * ActionFlowDiagram.test.tsx — #201 Phase 1.
 *
 * Two concerns:
 *  1. `flowGraphToElements` (pure) builds the Cytoscape element list, resolving
 *     `invokeAction` refs to names and tagging resolvable ones `navigable`.
 *  2. The component renders its canvas shell + legend (and an empty-state for
 *     a stepless action) without booting a real Cytoscape instance.
 *
 * The Cytoscape stack is mocked so the render path doesn't need a canvas /
 * ResizeObserver in jsdom — this test exercises the React shell, not WebGL.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { Action } from '../../../../../types';
import { flowToGraph } from '../flowToGraph';
import { ActionFlowDiagram, flowGraphToElements } from '../ActionFlowDiagram';

// Mock the Cytoscape hooks: no real instance, no layout side effects.
vi.mock('../../../../../components/CytoscapeGraph/useCytoscapeInstance', () => ({
  useCytoscapeInstance: () => ({ cyRef: { current: null }, cy: null }),
}));
vi.mock('../../../../../components/CytoscapeGraph/useCytoscapeLayout', () => ({
  useCytoscapeLayout: () => ({ runLayout: vi.fn() }),
}));

const ENTITY = '96a3ac78-d30b-4bf5-bb61-bf3174212f6c';

const cancel: Action = {
  uuid: 'act-cancel',
  name: 'cancel',
  ownerRef: ENTITY,
  flow: [
    { kind: 'assign', target: 'status', value: 'CANCELLED' },
    { kind: 'emitEvent', name: 'order.cancelled' },
    {
      kind: 'branch',
      when: "paymentStatus == 'PAID'",
      then: [{ kind: 'invokeAction', actionRef: 'act-refund' }],
    },
  ],
};

const refund: Action = {
  uuid: 'act-refund',
  name: 'refund',
  ownerRef: ENTITY,
  flow: [{ kind: 'callExternal', target: 'payments.refund' }],
};

describe('flowGraphToElements', () => {
  it('emits one element per node and edge', () => {
    const graph = flowToGraph(cancel);
    const elements = flowGraphToElements(graph);
    expect(elements).toHaveLength(graph.nodes.length + graph.edges.length);
  });

  it('resolves invokeAction nodes to the target name and marks them navigable', () => {
    const graph = flowToGraph(cancel);
    const elements = flowGraphToElements(graph, (ref) => (ref === 'act-refund' ? 'refund' : undefined));

    const invoke = elements.find((e) => e.data.kind === 'invokeAction')!;
    expect(invoke.data.label).toBe('refund');
    expect(invoke.data.navigable).toBe(1);
    expect(invoke.data.actionRef).toBe('act-refund');
  });

  it('leaves unresolved invoke refs as raw labels and not navigable', () => {
    const graph = flowToGraph(cancel);
    const elements = flowGraphToElements(graph); // no resolver
    const invoke = elements.find((e) => e.data.kind === 'invokeAction')!;
    expect(invoke.data.label).toBe('act-refund');
    expect(invoke.data.navigable).toBe(0);
  });
});

describe('<ActionFlowDiagram>', () => {
  it('renders the legend for an action with steps', () => {
    render(<ActionFlowDiagram action={cancel} actions={[cancel, refund]} />);
    // Legend lists the step-kind labels.
    expect(screen.getByText('Emit event')).toBeInTheDocument();
    expect(screen.getByText('Invoke action')).toBeInTheDocument();
    expect(screen.queryByText('No steps to diagram')).not.toBeInTheDocument();
  });

  it('shows an empty-state for an action with no steps', () => {
    render(<ActionFlowDiagram action={{ ...cancel, flow: [] }} />);
    expect(screen.getByText('No steps to diagram')).toBeInTheDocument();
  });
});
