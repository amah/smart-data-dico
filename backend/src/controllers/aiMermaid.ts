/**
 * Convert the data model to Mermaid diagram source for the AI chat's
 * `generateMermaid` tool. Read-only: it reads the model via the same services
 * the other tools use and returns a Mermaid string the agent can show (and the
 * UI / GitHub / docs can render).
 *
 * Diagram options:
 *   er    — entity-relationship diagram of a package (or all): entities with
 *           attributes + relationships with crow's-foot cardinality.
 *   class — class diagram of a package (or all): classes + typed members +
 *           directed associations with multiplicity.
 *   state — state diagram of one entity's state machine (states + transitions).
 *   flow  — saga/process flowchart from a package's actions + events
 *           (action --emits--> event --triggers--> action, action --invokes--> action).
 */
import { z } from 'zod';
import type { Entity, Relationship } from '../models/EntitySchema.js';
import type { Action } from '../models/Action.js';
import type { Event } from '../models/Event.js';
import type { StateMachine } from '../models/StateMachine.js';

export interface MermaidServices {
  serviceService: {
    getServiceEntities(pkg: string): Promise<Entity[]>;
    getPackageRelationships(pkg: string): Promise<Relationship[]>;
  };
  stateMachineService: { list(filters: { ownerRef?: string }): Promise<StateMachine[]> };
  actionService: { list(filters: { packageName?: string }): Promise<Action[]> };
  eventService: { list(filters: { packageName?: string }): Promise<Event[]> };
}

export type MermaidResult = { mermaid: string; diagram: string; scope: string } | { error: string };

// --- input schemas ----------------------------------------------------------

export const generateMermaidInputSchema = z.object({
  diagram: z.enum(['er', 'class', 'state', 'flow'])
    .describe('er = entity-relationship, class = class diagram, state = an entity state machine, flow = actions+events saga'),
  packageName: z.string().optional().describe('Scope for er/class/flow (omit to include all packages)'),
  entityName: z.string().optional().describe('Required for state: the entity whose state machine to draw'),
});
export type GenerateMermaidInput = z.infer<typeof generateMermaidInputSchema>;

export const generateMermaidParameters = {
  type: 'object',
  required: ['diagram'],
  properties: {
    diagram: { type: 'string', enum: ['er', 'class', 'state', 'flow'], description: 'er, class, state, or flow' },
    packageName: { type: 'string', description: 'Scope for er/class/flow (omit for all packages)' },
    entityName: { type: 'string', description: 'Required for state: the entity owning the state machine' },
  },
} as const;

// --- helpers ----------------------------------------------------------------

/** Mermaid node ids must be identifier-safe. */
function sid(s: string): string {
  return String(s || '').replace(/[^A-Za-z0-9_]/g, '_') || '_';
}

/** A short edge label token (no quotes / line breaks). */
function label(s: string | undefined, fallback: string): string {
  const t = String(s || '').replace(/[^A-Za-z0-9 _-]/g, '').trim().slice(0, 40);
  return t || fallback;
}

/** Crow's-foot symbol for an ER relationship end. */
function erEnd(card: string, side: 'left' | 'right'): string {
  const many = card === 'many';
  if (side === 'left') return many ? '}o' : '||';
  return many ? 'o{' : '||';
}

// --- generators -------------------------------------------------------------

function erDiagram(entities: Entity[], rels: Relationship[], nameByUuid: Map<string, string>): string {
  const lines = ['erDiagram'];
  for (const e of entities) {
    lines.push(`  ${sid(e.name)} {`);
    for (const a of e.attributes ?? []) {
      const key = a.primaryKey ? ' PK' : '';
      lines.push(`    ${sid(String(a.type || 'string'))} ${sid(a.name)}${key}`);
    }
    lines.push('  }');
  }
  for (const r of rels) {
    const s = nameByUuid.get(r.source.entity);
    const t = nameByUuid.get(r.target.entity);
    if (!s || !t) continue;
    const left = erEnd(r.source.cardinality, 'left');
    const right = erEnd(r.target.cardinality, 'right');
    lines.push(`  ${sid(s)} ${left}--${right} ${sid(t)} : ${label(r.description, 'relates').replace(/ /g, '_')}`);
  }
  return lines.join('\n');
}

function classDiagram(entities: Entity[], rels: Relationship[], nameByUuid: Map<string, string>): string {
  const lines = ['classDiagram'];
  for (const e of entities) {
    lines.push(`  class ${sid(e.name)} {`);
    if (e.stereotype) lines.push(`    <<${sid(e.stereotype)}>>`);
    for (const a of e.attributes ?? []) {
      lines.push(`    +${sid(String(a.type || 'string'))} ${sid(a.name)}`);
    }
    lines.push('  }');
  }
  for (const r of rels) {
    const s = nameByUuid.get(r.source.entity);
    const t = nameByUuid.get(r.target.entity);
    if (!s || !t) continue;
    const sc = r.source.cardinality === 'many' ? '"*"' : '"1"';
    const tc = r.target.cardinality === 'many' ? '"*"' : '"1"';
    lines.push(`  ${sid(s)} ${sc} --> ${tc} ${sid(t)} : ${label(r.description, 'relates')}`);
  }
  return lines.join('\n');
}

function stateDiagram(sm: StateMachine): string {
  const lines = ['stateDiagram-v2'];
  const stateNames = (sm.states ?? []).map(s => s.name);
  lines.push(`  [*] --> ${sid(sm.initialState)}`);
  for (const tr of sm.transitions ?? []) {
    const on = tr.on ? ` : ${label(tr.on, 'event')}` : '';
    // "*" (any state) expands to a transition from every other declared state.
    const froms = tr.from === '*' ? stateNames.filter(n => n !== tr.to) : [tr.from];
    for (const from of froms) lines.push(`  ${sid(from)} --> ${sid(tr.to)}${on}`);
  }
  for (const s of sm.states ?? []) {
    if (s.terminal) lines.push(`  ${sid(s.name)} --> [*]`);
  }
  return lines.join('\n');
}

function flowDiagram(actions: Action[], events: Event[], actionNameByUuid: Map<string, string>): string {
  const lines = ['flowchart LR'];
  const declared = new Set<string>();
  const declare = (id: string, text: string, kind: 'action' | 'event') => {
    if (declared.has(id)) return;
    declared.add(id);
    lines.push(kind === 'action' ? `  ${id}["${text}"]` : `  ${id}(["${text}"])`);
  };
  for (const a of actions) {
    const aid = 'A_' + sid(a.name);
    declare(aid, a.name + (a.actionKind ? ` (${a.actionKind})` : ''), 'action');
    for (const step of a.flow ?? []) {
      if (step.kind === 'emitEvent') {
        const eid = 'E_' + sid(step.name);
        declare(eid, step.name || 'event', 'event');
        lines.push(`  ${aid} -->|emits| ${eid}`);
      } else if (step.kind === 'wait') {
        const eid = 'E_' + sid(step.for);
        declare(eid, step.for || 'event', 'event');
        lines.push(`  ${eid} -->|triggers| ${aid}`);
      } else if (step.kind === 'invokeAction') {
        const target = actionNameByUuid.get(step.actionRef) || step.actionRef;
        const tid = 'A_' + sid(target);
        declare(tid, target, 'action');
        lines.push(`  ${aid} -->|invokes| ${tid}`);
      }
    }
  }
  for (const e of events) declare('E_' + sid(e.name), e.name, 'event');
  return lines.join('\n');
}

// --- tool core --------------------------------------------------------------

async function listPackages(packageName: string | undefined): Promise<string[]> {
  if (packageName) return [packageName];
  const { listMicroservices } = await import('../utils/fileOperations.js');
  return listMicroservices();
}

/** All entities across packages — used to resolve relationship endpoint UUIDs → names. */
async function allEntities(services: MermaidServices): Promise<Entity[]> {
  const pkgs = await listPackages(undefined);
  const out: Entity[] = [];
  for (const p of pkgs) out.push(...await services.serviceService.getServiceEntities(p).catch(() => []));
  return out;
}

export async function generateMermaidDiagram(input: GenerateMermaidInput, services: MermaidServices): Promise<MermaidResult> {
  try {
    const everything = await allEntities(services);
    const nameByUuid = new Map(everything.map(e => [e.uuid, e.name]));

    if (input.diagram === 'state') {
      if (!input.entityName) return { error: 'entityName is required for a state diagram.' };
      const owner = everything.find(e => e.name === input.entityName);
      if (!owner) return { error: `Entity "${input.entityName}" not found.` };
      const machines = await services.stateMachineService.list({ ownerRef: owner.uuid });
      if (!machines.length) return { error: `No state machine is defined on "${input.entityName}".` };
      return { mermaid: stateDiagram(machines[0]), diagram: 'state', scope: input.entityName };
    }

    const pkgs = await listPackages(input.packageName);
    const scope = input.packageName || 'all packages';

    if (input.diagram === 'flow') {
      const actions: Action[] = [];
      const events: Event[] = [];
      for (const p of pkgs) {
        actions.push(...await services.actionService.list({ packageName: p }).catch(() => []));
        events.push(...await services.eventService.list({ packageName: p }).catch(() => []));
      }
      if (!actions.length && !events.length) return { error: `No actions or events to diagram in ${scope}.` };
      const actionNameByUuid = new Map(actions.map(a => [a.uuid, a.name]));
      return { mermaid: flowDiagram(actions, events, actionNameByUuid), diagram: 'flow', scope };
    }

    // er or class
    const entities: Entity[] = [];
    const rels: Relationship[] = [];
    for (const p of pkgs) {
      entities.push(...await services.serviceService.getServiceEntities(p).catch(() => []));
      rels.push(...await services.serviceService.getPackageRelationships(p).catch(() => []));
    }
    if (!entities.length) return { error: `No entities to diagram in ${scope}.` };
    const mermaid = input.diagram === 'class'
      ? classDiagram(entities, rels, nameByUuid)
      : erDiagram(entities, rels, nameByUuid);
    return { mermaid, diagram: input.diagram, scope };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}
