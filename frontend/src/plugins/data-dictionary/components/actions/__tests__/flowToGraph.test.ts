/**
 * flowToGraph.test.ts — unit tests for the pure flow→graph mapper (#201, Phase 1).
 *
 * Covers: synthetic Start/End bracketing, sequential wiring, branch forks with
 * labelled then/else edges, branches without an else, nested branches, and the
 * per-kind metadata carried on invoke/emit/wait nodes.
 */

import { describe, it, expect } from 'vitest';
import type { FlowStep } from '../../../../../types';
import { flowToGraph } from '../flowToGraph';

/** Find the single node of a given kind (asserts uniqueness). */
function nodeOfKind(graph: ReturnType<typeof flowToGraph>, kind: string) {
  const matches = graph.nodes.filter((n) => n.kind === kind);
  expect(matches).toHaveLength(1);
  return matches[0];
}

/** True when a directed edge source→target exists with the given label. */
function hasEdge(
  graph: ReturnType<typeof flowToGraph>,
  sourceId: string,
  targetId: string,
  label?: string,
): boolean {
  return graph.edges.some(
    (e) => e.source === sourceId && e.target === targetId && (label === undefined || e.label === label),
  );
}

describe('flowToGraph', () => {
  it('brackets an empty flow with Start → End', () => {
    const g = flowToGraph({ flow: [] });
    expect(g.nodes).toHaveLength(2);
    const start = nodeOfKind(g, 'start');
    const end = nodeOfKind(g, 'end');
    expect(start.label).toBe('Start');
    expect(end.label).toBe('End');
    expect(g.edges).toHaveLength(1);
    expect(hasEdge(g, start.id, end.id)).toBe(true);
  });

  it('treats a missing flow as empty', () => {
    const g = flowToGraph({});
    expect(g.nodes.map((n) => n.kind).sort()).toEqual(['end', 'start']);
  });

  it('wires sequential steps Start → s1 → s2 → … → End', () => {
    const flow: FlowStep[] = [
      { kind: 'assign', target: 'status', value: 'CANCELLED' },
      { kind: 'assign', target: 'updatedAt', value: '@now' },
      { kind: 'emitEvent', name: 'order.cancelled' },
    ];
    const g = flowToGraph({ flow });

    // 3 steps + start + end
    expect(g.nodes).toHaveLength(5);
    const start = nodeOfKind(g, 'start');
    const end = nodeOfKind(g, 'end');
    const assigns = g.nodes.filter((n) => n.kind === 'assign');
    const emit = nodeOfKind(g, 'emitEvent');

    expect(assigns[0].label).toBe('status = CANCELLED');
    expect(assigns[1].label).toBe('updatedAt = @now');

    // Each node has exactly one in + one out along the spine.
    expect(hasEdge(g, start.id, assigns[0].id)).toBe(true);
    expect(hasEdge(g, assigns[0].id, assigns[1].id)).toBe(true);
    expect(hasEdge(g, assigns[1].id, emit.id)).toBe(true);
    expect(hasEdge(g, emit.id, end.id)).toBe(true);
    // No accidental fan-out for a straight line.
    expect(g.edges).toHaveLength(4);
  });

  it('carries opaque metadata on emit / invoke / wait nodes', () => {
    const flow: FlowStep[] = [
      { kind: 'emitEvent', name: 'order.paid' },
      { kind: 'invokeAction', actionRef: 'act-order-refund' },
      { kind: 'wait', for: 'payment.confirmed' },
    ];
    const g = flowToGraph({ flow });

    const emit = nodeOfKind(g, 'emitEvent');
    expect(emit.eventName).toBe('order.paid');
    expect(emit.label).toBe('order.paid');

    const invoke = nodeOfKind(g, 'invokeAction');
    expect(invoke.actionRef).toBe('act-order-refund');
    expect(invoke.label).toBe('act-order-refund');

    const wait = nodeOfKind(g, 'wait');
    expect(wait.label).toBe('wait: payment.confirmed');
  });

  it('carries eventRef on emit / wait nodes when present (#201 Phase 2)', () => {
    const flow: FlowStep[] = [
      { kind: 'emitEvent', name: 'order.paid', eventRef: 'evt-1' },
      { kind: 'wait', for: 'fulfilment', eventRef: 'evt-2' },
      { kind: 'emitEvent', name: 'opaque' }, // no eventRef
    ];
    const g = flowToGraph({ flow });
    const emits = g.nodes.filter((n) => n.kind === 'emitEvent');
    const wait = nodeOfKind(g, 'wait');
    expect(emits.find((n) => n.eventName === 'order.paid')?.eventRef).toBe('evt-1');
    expect(emits.find((n) => n.eventName === 'opaque')?.eventRef).toBeUndefined();
    expect(wait.eventRef).toBe('evt-2');
  });

  it('labels callExternal nodes with the target', () => {
    const g = flowToGraph({ flow: [{ kind: 'callExternal', target: 'payments.refund', args: { orderId: '@self.id' } }] });
    expect(nodeOfKind(g, 'callExternal').label).toBe('payments.refund');
  });

  it('forks a branch into labelled then / else paths that re-converge on End', () => {
    const flow: FlowStep[] = [
      {
        kind: 'branch',
        when: "paymentStatus == 'PAID'",
        then: [{ kind: 'invokeAction', actionRef: 'act-refund' }],
        else: [{ kind: 'emitEvent', name: 'order.kept' }],
      },
    ];
    const g = flowToGraph({ flow });

    const start = nodeOfKind(g, 'start');
    const end = nodeOfKind(g, 'end');
    const branch = nodeOfKind(g, 'branch');
    const invoke = nodeOfKind(g, 'invokeAction');
    const emit = nodeOfKind(g, 'emitEvent');

    expect(branch.label).toBe("paymentStatus == 'PAID'");
    expect(hasEdge(g, start.id, branch.id)).toBe(true);
    // Labelled fork edges.
    expect(hasEdge(g, branch.id, invoke.id, 'then')).toBe(true);
    expect(hasEdge(g, branch.id, emit.id, 'else')).toBe(true);
    // Both arms converge on End.
    expect(hasEdge(g, invoke.id, end.id)).toBe(true);
    expect(hasEdge(g, emit.id, end.id)).toBe(true);
  });

  it('routes a branch with no else straight to the continuation via an else edge', () => {
    const flow: FlowStep[] = [
      {
        kind: 'branch',
        when: 'needsRefund',
        then: [{ kind: 'invokeAction', actionRef: 'act-refund' }],
      },
    ];
    const g = flowToGraph({ flow });

    const branch = nodeOfKind(g, 'branch');
    const invoke = nodeOfKind(g, 'invokeAction');
    const end = nodeOfKind(g, 'end');

    // then arm flows through the invoke node to End.
    expect(hasEdge(g, branch.id, invoke.id, 'then')).toBe(true);
    expect(hasEdge(g, invoke.id, end.id)).toBe(true);
    // else arm: the fork itself connects to End, labelled else.
    expect(hasEdge(g, branch.id, end.id, 'else')).toBe(true);
  });

  it('continues the spine after a branch onto the next sibling step', () => {
    const flow: FlowStep[] = [
      {
        kind: 'branch',
        when: 'guard',
        then: [{ kind: 'assign', target: 'a', value: '1' }],
        else: [{ kind: 'assign', target: 'b', value: '2' }],
      },
      { kind: 'emitEvent', name: 'done' },
    ];
    const g = flowToGraph({ flow });

    const emit = nodeOfKind(g, 'emitEvent');
    const assigns = g.nodes.filter((n) => n.kind === 'assign');
    expect(assigns).toHaveLength(2);
    // Both branch arms feed the shared next step.
    expect(hasEdge(g, assigns[0].id, emit.id)).toBe(true);
    expect(hasEdge(g, assigns[1].id, emit.id)).toBe(true);
    expect(hasEdge(g, emit.id, nodeOfKind(g, 'end').id)).toBe(true);
  });

  it('recurses into nested branches', () => {
    const flow: FlowStep[] = [
      {
        kind: 'branch',
        when: 'outer',
        then: [
          {
            kind: 'branch',
            when: 'inner',
            then: [{ kind: 'emitEvent', name: 'inner.then' }],
            else: [{ kind: 'emitEvent', name: 'inner.else' }],
          },
        ],
      },
    ];
    const g = flowToGraph({ flow });

    const branches = g.nodes.filter((n) => n.kind === 'branch');
    expect(branches).toHaveLength(2);
    const emits = g.nodes.filter((n) => n.kind === 'emitEvent');
    expect(emits.map((n) => n.label).sort()).toEqual(['inner.else', 'inner.then']);

    const outer = branches.find((b) => b.label === 'outer')!;
    const inner = branches.find((b) => b.label === 'inner')!;
    // Outer 'then' leads into the inner fork.
    expect(hasEdge(g, outer.id, inner.id, 'then')).toBe(true);
    // Inner forks into both emits.
    const innerThen = emits.find((e) => e.label === 'inner.then')!;
    const innerElse = emits.find((e) => e.label === 'inner.else')!;
    expect(hasEdge(g, inner.id, innerThen.id, 'then')).toBe(true);
    expect(hasEdge(g, inner.id, innerElse.id, 'else')).toBe(true);

    // Every node reachable from start; both inner arms + outer's implicit else
    // converge on End.
    const end = nodeOfKind(g, 'end');
    expect(hasEdge(g, innerThen.id, end.id)).toBe(true);
    expect(hasEdge(g, innerElse.id, end.id)).toBe(true);
    expect(hasEdge(g, outer.id, end.id, 'else')).toBe(true);
  });

  it('produces unique node and edge ids', () => {
    const flow: FlowStep[] = [
      { kind: 'assign', target: 'a', value: '1' },
      {
        kind: 'branch',
        when: 'g',
        then: [{ kind: 'assign', target: 'b', value: '2' }],
        else: [{ kind: 'assign', target: 'c', value: '3' }],
      },
      { kind: 'emitEvent', name: 'e' },
    ];
    const g = flowToGraph({ flow });
    const nodeIds = g.nodes.map((n) => n.id);
    const edgeIds = g.edges.map((e) => e.id);
    expect(new Set(nodeIds).size).toBe(nodeIds.length);
    expect(new Set(edgeIds).size).toBe(edgeIds.length);
  });
});
