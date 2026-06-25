/**
 * flowToGraph — pure mapper from an action's `FlowStep[]` tree to a flat
 * node/edge graph suitable for a top-down flowchart (#201, Phase 1).
 *
 * Modeling-only: every string field is treated as opaque. Nothing here
 * evaluates guards, resolves references, or validates — it only re-shapes the
 * already-typed flow into nodes + sequential/branch edges.
 *
 * Shape:
 *  - one synthetic `start` node and one `end` node bracket the whole flow;
 *  - one node per `assign` / `emitEvent` / `invokeAction` / `wait` /
 *    `callExternal` step, wired sequentially between siblings;
 *  - a `branch` step becomes a fork node whose `then` / `else` edges are
 *    labelled and recurse into the nested sub-flows; both sub-flows (or the
 *    fork itself, when a branch has no body) re-converge onto whatever step
 *    follows the branch (or `end`).
 *
 * The mapper is deliberately free of React/Cytoscape concerns so it can be
 * unit-tested in isolation. `invokeAction` nodes carry their raw `actionRef`
 * so a renderer can resolve it to a name / navigation target later.
 */

import type { FlowStep } from '../../../../types';

/** Node kinds: the six step kinds plus the two synthetic terminals. */
export type FlowNodeKind = FlowStep['kind'] | 'start' | 'end';

export interface FlowGraphNode {
  id: string;
  kind: FlowNodeKind;
  /** Human-readable label (opaque step contents, or "Start" / "End"). */
  label: string;
  /** For `invokeAction` nodes: the referenced action UUID (unresolved). */
  actionRef?: string;
  /** For `emitEvent` nodes: the opaque event name. */
  eventName?: string;
  /** For `emitEvent` / `wait` nodes: the referenced event UUID, if modeled (#201 Phase 2). */
  eventRef?: string;
}

export interface FlowGraphEdge {
  id: string;
  source: string;
  target: string;
  /** Only branch edges are labelled — `then` / `else`. */
  label?: string;
}

export interface FlowGraph {
  nodes: FlowGraphNode[];
  edges: FlowGraphEdge[];
}

/** An open output of a sub-flow, to be wired to the next step's entry. */
interface Entry {
  id: string;
  label?: string;
}

/** Label text for a single non-branch step node. */
function stepLabel(step: FlowStep): string {
  switch (step.kind) {
    case 'assign':
      return `${step.target} = ${step.value}`;
    case 'emitEvent':
      return step.name;
    case 'invokeAction':
      return step.actionRef;
    case 'wait':
      return `wait: ${step.for}`;
    case 'callExternal':
      return step.target;
    default:
      return step.kind;
  }
}

/**
 * Map an action's flow to a flowchart graph. Pure — same input, same output;
 * node ids are assigned by a deterministic counter so results are stable.
 */
export function flowToGraph(action: { flow?: FlowStep[] }): FlowGraph {
  const nodes: FlowGraphNode[] = [];
  const edges: FlowGraphEdge[] = [];
  let nodeSeq = 0;

  const addNode = (n: Omit<FlowGraphNode, 'id'>): string => {
    const id = `${n.kind}-${nodeSeq++}`;
    nodes.push({ id, ...n });
    return id;
  };

  const connect = (entries: Entry[], targetId: string) => {
    for (const e of entries) {
      edges.push({
        id: `edge-${edges.length}`,
        source: e.id,
        target: targetId,
        label: e.label,
      });
    }
  };

  /**
   * Wire `steps` after `entries` and return the open outputs of the sequence.
   * Recurses for branch sub-flows.
   */
  const buildSequence = (steps: FlowStep[], entries: Entry[]): Entry[] => {
    let current = entries;

    for (const step of steps) {
      if (step.kind === 'branch') {
        const branchId = addNode({ kind: 'branch', label: step.when || 'branch' });
        connect(current, branchId);

        // then-path (always present, may be empty)
        const thenExits = buildSequence(step.then ?? [], [{ id: branchId, label: 'then' }]);

        // else-path: recurse when bodied, otherwise the fork's else edge is an
        // open output that flows straight to the continuation.
        const elseExits =
          step.else && step.else.length > 0
            ? buildSequence(step.else, [{ id: branchId, label: 'else' }])
            : [{ id: branchId, label: 'else' }];

        current = [...thenExits, ...elseExits];
      } else {
        const id = addNode({
          kind: step.kind,
          label: stepLabel(step),
          ...(step.kind === 'invokeAction' ? { actionRef: step.actionRef } : {}),
          ...(step.kind === 'emitEvent' ? { eventName: step.name } : {}),
          ...((step.kind === 'emitEvent' || step.kind === 'wait') && step.eventRef
            ? { eventRef: step.eventRef }
            : {}),
        });
        connect(current, id);
        current = [{ id }];
      }
    }

    return current;
  };

  const startId = addNode({ kind: 'start', label: 'Start' });
  const exits = buildSequence(action.flow ?? [], [{ id: startId }]);
  const endId = addNode({ kind: 'end', label: 'End' });
  connect(exits, endId);

  return { nodes, edges };
}
