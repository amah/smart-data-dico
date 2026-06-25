/**
 * actionsToSagaGraph.test.ts — #201 Phase 3 (CQRS saga / process map)
 *
 * Covers: action nodes carry CQRS class + internal; invoke/emit/react edges;
 * events joined by eventRef and by opaque name fallback; the emit→event→react
 * reaction chain; branch recursion; edge dedupe; only-referenced events appear.
 */

import { describe, it, expect } from 'vitest';
import type { Action, Event } from '../../../../types';
import { actionsToSagaGraph } from '../actionsToSagaGraph';

const A = (over: Partial<Action> = {}): Action => ({
  uuid: 'a', name: 'a', ownerRef: 'e', ...over,
});

const nodeById = (g: ReturnType<typeof actionsToSagaGraph>, id: string) => g.nodes.find((n) => n.id === id);
const hasEdge = (g: ReturnType<typeof actionsToSagaGraph>, s: string, t: string, kind: string) =>
  g.edges.some((e) => e.source === s && e.target === t && e.kind === kind);

describe('actionsToSagaGraph', () => {
  it('emits one action node per action, carrying CQRS class + internal', () => {
    const g = actionsToSagaGraph([
      A({ uuid: 'cmd', name: 'cancel', actionKind: 'command' }),
      A({ uuid: 'qry', name: 'getStatus', actionKind: 'query' }),
      A({ uuid: 'int', name: 'reserve', internal: true }),
    ]);
    expect(nodeById(g, 'action:cmd')).toMatchObject({ type: 'action', label: 'cancel', actionKind: 'command' });
    expect(nodeById(g, 'action:qry')?.actionKind).toBe('query');
    expect(nodeById(g, 'action:int')?.internal).toBe(true);
  });

  it('wires invokeAction → invoke edge between actions', () => {
    const g = actionsToSagaGraph([
      A({ uuid: 'cancel', name: 'cancel', flow: [{ kind: 'invokeAction', actionRef: 'refund' }] }),
      A({ uuid: 'refund', name: 'refund' }),
    ]);
    expect(hasEdge(g, 'action:cancel', 'action:refund', 'invoke')).toBe(true);
  });

  it('skips invoke edges to actions outside the set', () => {
    const g = actionsToSagaGraph([A({ uuid: 'cancel', flow: [{ kind: 'invokeAction', actionRef: 'ghost' }] })]);
    expect(g.edges.filter((e) => e.kind === 'invoke')).toHaveLength(0);
  });

  it('joins emit and react on the same modeled event (eventRef) into a reaction chain', () => {
    const events: Event[] = [{ uuid: 'evt-paid', name: 'order.paid' }];
    const g = actionsToSagaGraph(
      [
        A({ uuid: 'pay', name: 'pay', flow: [{ kind: 'emitEvent', name: 'order.paid', eventRef: 'evt-paid' }] }),
        A({ uuid: 'ship', name: 'ship', flow: [{ kind: 'wait', for: 'order.paid', eventRef: 'evt-paid' }] }),
      ],
      events,
    );
    const evId = 'event:evt-paid';
    expect(nodeById(g, evId)).toMatchObject({ type: 'event', label: 'order.paid' });
    expect(hasEdge(g, 'action:pay', evId, 'emit')).toBe(true);   // command → event
    expect(hasEdge(g, evId, 'action:ship', 'react')).toBe(true); // event → reaction
  });

  it('joins emit and react by opaque name when not modeled', () => {
    const g = actionsToSagaGraph([
      A({ uuid: 'pay', flow: [{ kind: 'emitEvent', name: 'paid' }] }),
      A({ uuid: 'ship', flow: [{ kind: 'wait', for: 'paid' }] }),
    ]);
    const evId = 'event:name:paid';
    expect(nodeById(g, evId)?.label).toBe('paid');
    expect(hasEdge(g, 'action:pay', evId, 'emit')).toBe(true);
    expect(hasEdge(g, evId, 'action:ship', 'react')).toBe(true);
  });

  it('recurses into branch then/else', () => {
    const g = actionsToSagaGraph([
      A({
        uuid: 'cancel',
        flow: [
          {
            kind: 'branch',
            when: 'x',
            then: [{ kind: 'emitEvent', name: 'cancelled' }],
            else: [{ kind: 'invokeAction', actionRef: 'refund' }],
          },
        ],
      }),
      A({ uuid: 'refund', name: 'refund' }),
    ]);
    expect(hasEdge(g, 'action:cancel', 'event:name:cancelled', 'emit')).toBe(true);
    expect(hasEdge(g, 'action:cancel', 'action:refund', 'invoke')).toBe(true);
  });

  it('dedupes repeated edges to the same target', () => {
    const g = actionsToSagaGraph([
      A({ uuid: 'a', flow: [{ kind: 'emitEvent', name: 'e' }, { kind: 'emitEvent', name: 'e' }] }),
    ]);
    expect(g.edges.filter((e) => e.kind === 'emit')).toHaveLength(1);
  });

  it('only includes events that are actually referenced', () => {
    const events: Event[] = [
      { uuid: 'used', name: 'used.event' },
      { uuid: 'unused', name: 'unused.event' },
    ];
    const g = actionsToSagaGraph(
      [A({ uuid: 'a', flow: [{ kind: 'emitEvent', name: 'used.event', eventRef: 'used' }] })],
      events,
    );
    expect(g.nodes.filter((n) => n.type === 'event').map((n) => n.label)).toEqual(['used.event']);
  });
});
