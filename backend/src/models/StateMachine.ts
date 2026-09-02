/**
 * State machine model (#179) — N per entity owner.
 *
 * A state machine models the lifecycle of an entity: states it can be in
 * and transitions between those states. Transitions may invoke actions by
 * UUID. Multiple independent machines can exist on the same entity (bound
 * to different attributes).
 *
 * Modeling only in v1 — no execution / simulation.
 *
 * Storage: inlined in the owning package YAML as a top-level `stateMachines:`
 * section alongside `entities:`, `relationships:`, `rules:`, `cases:`,
 * `actions:`.
 */

/**
 * A single state in the machine.
 *
 * `terminal: true` is a modeling/presentation marker. The state-machine UI
 * excludes terminal states when expanding wildcard edges, but validation does
 * not reject explicit outgoing transitions from a terminal state.
 */
export interface State {
  name: string;
  description?: string;
  terminal?: boolean;
}

/**
 * A transition between two states.
 *
 * `from: "*"` is the wildcard marker. The state-machine UI displays it from
 * every non-terminal state; v1 has no transition execution semantics.
 * `to` must be a declared state name.
 * `invoke[]` is an ordered list of action UUIDs to call when the
 * transition is taken. Resolved post-merge within the package.
 * `guard` is an opaque string in v1 (not evaluated).
 */
export interface Transition {
  uuid: string;
  from: string;    // state name or "*"
  to: string;      // state name
  on: string;      // event name (opaque string)
  guard?: string;  // opaque guard expression
  invoke?: string[];  // action UUIDs
}

/**
 * A state machine owned by an entity.
 *
 * Invariants enforced by the CRUD service on create/update:
 *   - `ownerRef` resolves to an existing entity UUID
 *   - `states[*].name` are unique within the machine
 *   - `initialState` is a declared state name
 *   - `stateAttribute` (if set) matches an attribute on the owner
 *   - `transitions[*].uuid` are unique
 *   - `transitions[*].from` is a declared state or `"*"`
 *   - `transitions[*].to` is a declared state
 *   - `transitions[*].invoke[]` UUIDs resolve to known actions
 *
 * Collision rules enforced by the package loader:
 *   - `uuid` is globally unique
 *   - `(ownerRef, name)` pair is unique (no two machines on the same
 *     entity can share a name)
 */
export interface StateMachine {
  uuid: string;
  name: string;
  description?: string;
  ownerRef: string;    // entity UUID
  stateAttribute?: string;  // attribute name on owner that tracks current state
  initialState: string;
  states: State[];
  transitions: Transition[];
  createdAt?: string;
  updatedAt?: string;
}
