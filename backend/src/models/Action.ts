/**
 * Action model (#179) — N per entity/Case owner.
 *
 * An action is a named, typed sequence of flow steps (modeling only — no
 * execution in v1). Actions are referenced by state machine transitions by
 * UUID. The flow is an author-time record of intent, not a runtime program.
 *
 * Storage: inlined in the owning package YAML as a top-level `actions:`
 * section alongside `entities:`, `relationships:`, `rules:`, `cases:`.
 */

/**
 * Flow step kinds for action bodies.
 *
 * - assign       — set an attribute/variable to a value (opaque string)
 * - emitEvent    — publish a domain event by name
 * - invokeAction — call another action (by `actionRef` UUID)
 * - branch       — conditional fork; `when` is an opaque guard string;
 *                  `then`/`else` are nested step lists
 * - wait         — suspend until an event; `for` is an opaque event name or duration
 * - callExternal — invoke an external system; `target` + `args` are opaque
 */
export type FlowStepKind =
  | 'assign'
  | 'emitEvent'
  | 'invokeAction'
  | 'branch'
  | 'wait'
  | 'callExternal';

export const FLOW_STEP_KINDS: ReadonlySet<FlowStepKind> = new Set([
  'assign',
  'emitEvent',
  'invokeAction',
  'branch',
  'wait',
  'callExternal',
] as const);

/** assign — set an attribute/variable to a value */
export interface AssignStep   { kind: 'assign';       target: string; value: string; }
/**
 * emitEvent — publish a domain event. `name` is the opaque event name;
 * `eventRef` (#201 Phase 2) optionally references a modeled Event by UUID.
 */
export interface EmitStep     { kind: 'emitEvent';    name: string; eventRef?: string; }
/** invokeAction — call another action by UUID */
export interface InvokeStep   { kind: 'invokeAction'; actionRef: string; }
/** branch — conditional fork */
export interface BranchStep   { kind: 'branch';       when: string; then: FlowStep[]; else?: FlowStep[]; }
/**
 * wait — suspend until an event name or duration. `for` is the opaque
 * name/duration; `eventRef` (#201 Phase 2) optionally references a modeled
 * Event by UUID.
 */
export interface WaitStep     { kind: 'wait';         for: string; eventRef?: string; }
/** callExternal — invoke an external system */
export interface CallExtStep  { kind: 'callExternal'; target: string; args?: Record<string, string>; }

/**
 * A single step in an action's flow body.
 *
 * Discriminated by `kind` so each variant carries only its own fields.
 * All string fields are opaque in v1 — stored as-is, not evaluated.
 */
export type FlowStep = AssignStep | EmitStep | InvokeStep | BranchStep | WaitStep | CallExtStep;

/** A single named parameter for an action */
export interface ActionParam {
  name: string;
  type: string;
  required?: boolean;
  description?: string;
}

/** The return type declaration for an action (opaque in v1) */
export interface ActionReturn {
  type: string;
  description?: string;
}

/**
 * An action owned by an entity or Case.
 *
 * `ownerRef` must resolve to an existing entity UUID at load time.
 * `params[*].name` must be unique within the action.
 * `flow[*].kind` must be in FLOW_STEP_KINDS.
 * If a step has `kind: invokeAction`, its `actionRef` must resolve to
 * a known action UUID (validated post-merge, within the same package).
 *
 * `internal: true` marks the action as implementation-detail — not
 * exposed on any public surface (e.g. API buttons). Defaults to false.
 */
/**
 * CQRS classification (#201 Phase 3). A `command` mutates state / has side
 * effects; a `query` reads and returns data without mutation. Orthogonal to the
 * `internal` flag, which marks an action as off the public surface.
 */
export type ActionKind = 'command' | 'query';

export const ACTION_KINDS: ReadonlySet<ActionKind> = new Set(['command', 'query'] as const);

export interface Action {
  uuid: string;
  name: string;
  description?: string;
  ownerRef: string;    // entity UUID
  internal?: boolean;
  /** CQRS classification (#201 Phase 3); undefined = unclassified. */
  actionKind?: ActionKind;
  params?: ActionParam[];
  returns?: ActionReturn;
  flow?: FlowStep[];
  createdAt?: string;
  updatedAt?: string;
}
