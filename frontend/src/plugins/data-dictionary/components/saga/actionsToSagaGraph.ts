/**
 * actionsToSagaGraph — pure mapper from a package's actions + events to a
 * cross-action orchestration graph (#201 Phase 3, the saga / process view).
 *
 * It assembles the end-to-end CQRS picture that Phase 2's `eventRef` linkage
 * made possible:
 *
 *   command ──emit──▶ event ──react──▶ action ──invoke──▶ action ──▶ …
 *
 * Edge kinds:
 *   - `invoke` — action → action (an `invokeAction` step; orchestration).
 *   - `emit`   — action → event (an `emitEvent` step).
 *   - `react`  — event → action (a `wait` step; the action reacts to the event).
 *
 * Events are joined by `eventRef` when modeled (Phase 2); otherwise the opaque
 * `name` / `for` string is the join key, so an emit and a wait on the same
 * un-modelled name still connect. Only events actually referenced by a step
 * appear. Modeling-only — nothing is evaluated. Pure: deterministic node/edge ids.
 */

import type { Action, Event, FlowStep, ActionKind } from '../../../../types';

export type SagaNodeType = 'action' | 'event';

export interface SagaNode {
  id: string;
  type: SagaNodeType;
  label: string;
  /** action nodes only: CQRS classification, if set. */
  actionKind?: ActionKind;
  /** action nodes only: off the public surface. */
  internal?: boolean;
}

export interface SagaEdge {
  id: string;
  source: string;
  target: string;
  kind: 'invoke' | 'emit' | 'react';
}

export interface SagaGraph {
  nodes: SagaNode[];
  edges: SagaEdge[];
}

const actionId = (uuid: string) => `action:${uuid}`;

/** Join key for the event a step references — eventRef if modeled, else the opaque name. */
function eventKey(step: Extract<FlowStep, { kind: 'emitEvent' | 'wait' }>): string {
  if (step.eventRef) return `event:${step.eventRef}`;
  const name = step.kind === 'emitEvent' ? step.name : step.for;
  return `event:name:${name}`;
}

export function actionsToSagaGraph(actions: Action[], events: Event[] = []): SagaGraph {
  const eventByUuid = new Map(events.map((e) => [e.uuid, e]));
  const actionByUuid = new Map(actions.map((a) => [a.uuid, a]));

  const nodes = new Map<string, SagaNode>();
  const edges: SagaEdge[] = [];
  const edgeKeys = new Set<string>();

  const addEdge = (source: string, target: string, kind: SagaEdge['kind']) => {
    const key = `${source}|${target}|${kind}`;
    if (edgeKeys.has(key)) return; // dedupe repeated emits/invokes of the same target
    edgeKeys.add(key);
    edges.push({ id: `edge-${edges.length}`, source, target, kind });
  };

  const ensureEventNode = (step: Extract<FlowStep, { kind: 'emitEvent' | 'wait' }>): string => {
    const id = eventKey(step);
    if (!nodes.has(id)) {
      const modeled = step.eventRef ? eventByUuid.get(step.eventRef) : undefined;
      const label = modeled?.name ?? (step.kind === 'emitEvent' ? step.name : step.for) ?? '(unnamed event)';
      nodes.set(id, { id, type: 'event', label });
    }
    return id;
  };

  // Action nodes first (so invoke targets always resolve to an existing node).
  for (const a of actions) {
    nodes.set(actionId(a.uuid), {
      id: actionId(a.uuid),
      type: 'action',
      label: a.name,
      actionKind: a.actionKind,
      internal: a.internal,
    });
  }

  // Walk each flow (recursing branches) and wire edges.
  const walk = (steps: FlowStep[], ownerId: string) => {
    for (const step of steps) {
      switch (step.kind) {
        case 'invokeAction':
          if (actionByUuid.has(step.actionRef)) addEdge(ownerId, actionId(step.actionRef), 'invoke');
          break;
        case 'emitEvent':
          addEdge(ownerId, ensureEventNode(step), 'emit');
          break;
        case 'wait':
          addEdge(ensureEventNode(step), ownerId, 'react');
          break;
        case 'branch':
          walk(step.then ?? [], ownerId);
          walk(step.else ?? [], ownerId);
          break;
        default:
          break;
      }
    }
  };

  for (const a of actions) walk(a.flow ?? [], actionId(a.uuid));

  return { nodes: [...nodes.values()], edges };
}
