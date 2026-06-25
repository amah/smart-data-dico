/**
 * Event model (#201 Phase 2) — a first-class domain event.
 *
 * Promotes events from opaque names (an action's `emitEvent.name` / `wait.for`)
 * to a modeled element. An `emitEvent` / `wait` step may carry an optional
 * `eventRef` (this event's UUID); the opaque `name` / `for` string remains a
 * non-breaking fallback for un-modelled events.
 *
 * Storage: inlined in a package YAML as a top-level `events:` section alongside
 * `entities:`, `actions:`, etc. Conventionally `<Name>.events.yaml`. Modeling
 * only — not executed; all string fields opaque in v1.
 */

import type { Attribute } from './EntitySchema.js';

/**
 * A domain event owned (optionally) by an entity.
 *
 * `uuid` is unique within a package; `name` is also unique within a package so
 * the opaque-name fallback resolves unambiguously. `ownerRef`, when present,
 * must resolve to an existing entity UUID (the aggregate that emits it).
 * `payload` models the event body as attributes (documentation only).
 */
export interface Event {
  uuid: string;
  name: string;
  /** Optional owning entity UUID (the aggregate that emits the event). */
  ownerRef?: string;
  description?: string;
  /** The event payload shape, modeled as attributes (modeling only). */
  payload?: Attribute[];
  createdAt?: string;
  updatedAt?: string;
}
