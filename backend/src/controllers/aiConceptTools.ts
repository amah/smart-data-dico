/**
 * AI-assistant mutation tools for the "advanced" data-dictionary concepts that
 * the chat previously could not author (gap-analysis exercise): stereotypes,
 * derived types, rules, cases, events, actions, and state machines.
 *
 * Same contract as aiMutationTools.ts (validate → persist via the concept's
 * own service → return a MutationResult). On failure these RETURN
 * `{ success: false, error }` (never throw) so the model can self-correct.
 *
 * The agent works in entity NAMES; these cores resolve names → UUIDs (every
 * concept cross-references entities by uuid) via serviceService, so the model
 * never has to know an internal id.
 *
 * Processes / sagas are intentionally absent: a saga is a DERIVED view
 * (frontend `actionsToSagaGraph`) computed from actions + events, not a
 * persisted object — authoring actions with emitEvent/wait/invokeAction flow
 * steps plus events is how a saga is "created".
 */

import { z } from 'zod';
import type { Attribute, Entity, Case, Stereotype, StereotypeTarget } from '../models/EntitySchema.js';
import type { Rule, RuleScope, RuleSeverityValue, RuleEnforcement, RuleTarget } from '../models/Rule.js';
import type { Event } from '../models/Event.js';
import type { Action, FlowStep, ActionKind } from '../models/Action.js';
import type { StateMachine, Transition } from '../models/StateMachine.js';
import type { DerivedType } from '../services/dicoConfigService.js';
import {
  attributeInputSchema,
  attributeJsonSchema,
  attributeValidationSchema,
  attributeValidationJsonSchema,
  type MutationResult,
  type MutationFailure,
} from './aiMutationTools.js';
import { generateUUID } from '../utils/uuid.js';

// --- Services the concept cores need (injected for testability) -------------

interface ServiceErr { errors: Array<{ field: string; message: string }> }

export interface ConceptServices {
  serviceService: {
    findEntityAcrossPackages(name: string, preferredPackage?: string): Promise<{ entity: Entity; packageName: string } | null>;
    getServiceEntities(pkg: string): Promise<Entity[]>;
  };
  stereotypeService: {
    createStereotype(data: Stereotype): Promise<{ success: boolean; stereotype?: Stereotype; errors?: string[] }>;
    getAllStereotypes(appliesTo?: StereotypeTarget): Promise<Array<{ id: string; name: string; appliesTo: string }>>;
  };
  ruleService: {
    createRule(input: Partial<Rule>): Promise<{ success: boolean; rule?: Rule; errors?: string[] }>;
  };
  caseService: {
    create(data: Partial<Case>): Promise<{ success: boolean; case?: Case; errors?: string[] }>;
  };
  eventService: {
    create(data: Partial<Event> & { packageName?: string }): Promise<Event | ServiceErr>;
  };
  actionService: {
    create(data: Partial<Action>): Promise<Action | ServiceErr>;
  };
  stateMachineService: {
    create(data: Partial<StateMachine>): Promise<StateMachine | ServiceErr>;
  };
  derivedTypes: {
    list(): Promise<DerivedType[]>;
    replace(next: DerivedType[]): Promise<{ success: boolean; errors?: string[] }>;
  };
}

// --- Helpers ----------------------------------------------------------------

function fail(error: string): MutationFailure {
  return { success: false, error };
}

/** ServiceErr type-guard for the event/action/stateMachine create() return. */
function isErr(v: unknown): v is ServiceErr {
  return typeof v === 'object' && v !== null && 'errors' in v;
}

function flattenErrors(e: ServiceErr): string {
  return e.errors.map(x => x.message).join('; ') || 'Validation failed.';
}

/** kebab-case a free-form name (rule/stereotype ids must be kebab). */
function slugify(s: string): string {
  return s
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

/** Resolve an entity by name → { uuid, packageName }, or a friendly error. */
async function resolveEntity(
  services: ConceptServices,
  name: string,
  preferredPackage?: string,
): Promise<{ uuid: string; packageName: string; entity: Entity } | { error: string }> {
  const found = await services.serviceService.findEntityAcrossPackages(name, preferredPackage);
  if (!found) {
    return { error: `Entity "${name}" not found${preferredPackage ? ` in package "${preferredPackage}"` : ' in any package'}. Create the entity first.` };
  }
  return { uuid: found.entity.uuid, packageName: found.packageName, entity: found.entity };
}

// ===========================================================================
// 1. STEREOTYPE
// ===========================================================================

export const createStereotypeInputSchema = z.object({
  id: z.string().describe('kebab-case id, e.g. aggregate-root, value-object, pii, domain-event'),
  name: z.string().optional().describe('Human-readable display name (defaults to a title-cased id)'),
  appliesTo: z.enum(['entity', 'attribute', 'package', 'model', 'relationship']).optional()
    .describe('What element the stereotype classifies (default: entity)'),
  description: z.string().optional(),
  domain: z.string().optional().describe('Free-form grouping, e.g. DDD, CQRS, Privacy'),
});
export type CreateStereotypeInput = z.infer<typeof createStereotypeInputSchema>;

export const createStereotypeParameters = {
  type: 'object',
  required: ['id'],
  properties: {
    id: { type: 'string', description: 'kebab-case id, e.g. aggregate-root, value-object, pii, domain-event' },
    name: { type: 'string', description: 'Display name (defaults to title-cased id)' },
    appliesTo: { type: 'string', enum: ['entity', 'attribute', 'package', 'model', 'relationship'], description: 'Default: entity' },
    description: { type: 'string' },
    domain: { type: 'string', description: 'Free-form grouping, e.g. DDD, CQRS, Privacy' },
  },
} as const;

function titleCase(slug: string): string {
  return slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

export async function executeCreateStereotype(
  input: CreateStereotypeInput,
  services: ConceptServices,
): Promise<MutationResult> {
  try {
    const id = slugify(input.id);
    if (!id) return fail('Stereotype id must contain at least one alphanumeric character.');
    const appliesTo = (input.appliesTo ?? 'entity') as StereotypeTarget;
    const stereotype: Stereotype = {
      id,
      name: input.name ?? titleCase(id),
      appliesTo,
      ...(input.description ? { description: input.description } : {}),
      ...(input.domain ? { domain: input.domain } : {}),
      metadataDefinitions: [],
    };
    const result = await services.stereotypeService.createStereotype(stereotype);
    if (!result.success) return fail(result.errors?.join('; ') || 'Failed to create stereotype.');
    const summary = `Created stereotype ${stereotype.name} (${id}, applies to ${appliesTo})`;
    return {
      success: true, changeKind: 'created', elementType: 'stereotype',
      name: stereotype.name, packageName: '', summary, navigate: '/stereotypes', highlight: id, message: summary,
    };
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
}

// ===========================================================================
// 2. DERIVED TYPE
// ===========================================================================

const valueDomainSchema = z.object({
  kind: z.enum(['enum', 'codelist', 'reference']),
  values: z.array(z.string()).optional(),
  source: z.string().optional(),
});

export const createDerivedTypeInputSchema = z.object({
  name: z.string().describe('Type name used as an attribute type, e.g. email, money, currency-code'),
  basedOn: z.string().describe('A standard AttributeType (string, number, …) or another derived type name'),
  description: z.string().optional(),
  validation: attributeValidationSchema.optional().describe('Validation inherited by every attribute of this type'),
  domain: valueDomainSchema.optional().describe('Closed value set: enum/codelist/reference'),
});
export type CreateDerivedTypeInput = z.infer<typeof createDerivedTypeInputSchema>;

export const createDerivedTypeParameters = {
  type: 'object',
  required: ['name', 'basedOn'],
  properties: {
    name: { type: 'string', description: 'Type name used as an attribute type, e.g. email, money' },
    basedOn: { type: 'string', description: 'Standard AttributeType or another derived type name' },
    description: { type: 'string' },
    validation: attributeValidationJsonSchema,
    domain: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['enum', 'codelist', 'reference'] },
        values: { type: 'array', items: { type: 'string' } },
        source: { type: 'string' },
      },
    },
  },
} as const;

export async function executeCreateDerivedType(
  input: CreateDerivedTypeInput,
  services: ConceptServices,
): Promise<MutationResult> {
  try {
    const current = await services.derivedTypes.list();
    const next: DerivedType = {
      name: input.name,
      basedOn: input.basedOn,
      ...(input.description ? { description: input.description } : {}),
      ...(input.validation ? { validation: input.validation } : {}),
      ...(input.domain ? { domain: input.domain } : {}),
    };
    // Upsert by name (replace endpoint takes the full list).
    const merged = [...current.filter(t => t.name !== input.name), next];
    const result = await services.derivedTypes.replace(merged);
    if (!result.success) return fail(result.errors?.join('; ') || 'Failed to save derived type.');
    const existed = current.some(t => t.name === input.name);
    const summary = `${existed ? 'Updated' : 'Created'} derived type ${input.name} (based on ${input.basedOn})`;
    return {
      success: true, changeKind: existed ? 'updated' : 'created', elementType: 'derivedType',
      name: input.name, packageName: '', summary, navigate: '/types', highlight: input.name, message: summary,
    };
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
}

// ===========================================================================
// 3. RULE
// ===========================================================================

export const createRuleInputSchema = z.object({
  name: z.string().describe('Short rule name (kebab-cased automatically)'),
  description: z.string().describe('What the rule asserts, in plain language (markdown ok)'),
  entityName: z.string().optional().describe('Entity the rule is scoped to (omit for a package-level rule)'),
  packageName: z.string().optional().describe('Package (used for package scope, or to disambiguate the entity)'),
  severity: z.enum(['info', 'warning', 'error']).optional().describe('Default: error'),
  enforcement: z.enum(['save', 'process', 'advisory']).optional().describe('Default: advisory'),
});
export type CreateRuleInput = z.infer<typeof createRuleInputSchema>;

export const createRuleParameters = {
  type: 'object',
  required: ['name', 'description'],
  properties: {
    name: { type: 'string', description: 'Short rule name (kebab-cased automatically)' },
    description: { type: 'string', description: 'What the rule asserts, in plain language' },
    entityName: { type: 'string', description: 'Entity the rule is scoped to (omit for package-level)' },
    packageName: { type: 'string', description: 'Package for package scope / entity disambiguation' },
    severity: { type: 'string', enum: ['info', 'warning', 'error'], description: 'Default: error' },
    enforcement: { type: 'string', enum: ['save', 'process', 'advisory'], description: 'Default: advisory' },
  },
} as const;

export async function executeCreateRule(
  input: CreateRuleInput,
  services: ConceptServices,
): Promise<MutationResult> {
  try {
    const severity = (input.severity ?? 'error') as RuleSeverityValue;
    const enforcement = (input.enforcement ?? 'advisory') as RuleEnforcement;
    let scope: RuleScope;
    let entityUuid: string | undefined;
    let packageName: string | undefined = input.packageName;
    const targets: RuleTarget[] = [];

    if (input.entityName) {
      const resolved = await resolveEntity(services, input.entityName, input.packageName);
      if ('error' in resolved) return fail(resolved.error);
      scope = 'entity';
      entityUuid = resolved.uuid;
      packageName = resolved.packageName;
      targets.push({ kind: 'entity', uuid: resolved.uuid, packageName: resolved.packageName });
    } else if (input.packageName) {
      scope = 'package';
      // Package-scope rules still need ≥1 target; use the package itself as a coarse target.
      targets.push({ kind: 'entity', uuid: input.packageName, packageName: input.packageName });
    } else {
      return fail('Provide an entityName (entity-scoped rule) or packageName (package-scoped rule).');
    }

    const rule: Partial<Rule> = {
      uuid: generateUUID(),
      name: slugify(input.name),
      description: input.description,
      severity,
      enforcement,
      scope,
      targets,
      ...(entityUuid ? { entityUuid } : {}),
      ...(packageName ? { packageName } : {}),
    };
    const result = await services.ruleService.createRule(rule);
    if (!result.success) return fail(result.errors?.join('; ') || 'Failed to create rule.');
    const where = scope === 'entity' ? `on ${input.entityName}` : `in package ${packageName}`;
    const summary = `Created ${severity} rule "${rule.name}" ${where}`;
    const navigate = scope === 'entity' && packageName
      ? `/packages/${packageName}/entities/${input.entityName}`
      : '/integrity';
    return {
      success: true, changeKind: 'created', elementType: 'rule',
      name: rule.name!, packageName: packageName ?? '', summary, navigate, highlight: rule.name, message: summary,
    };
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
}

// ===========================================================================
// 4. CASE
// ===========================================================================

export const createCaseInputSchema = z.object({
  name: z.string().describe('Case name (a business use-case / view)'),
  rootEntityNames: z.array(z.string()).min(1).describe('Names of the entities the case is rooted on'),
  description: z.string().optional(),
  packageName: z.string().optional().describe('Preferred package to disambiguate entity names'),
  maxDepth: z.number().optional().describe('BFS traversal depth (default 10)'),
});
export type CreateCaseInput = z.infer<typeof createCaseInputSchema>;

export const createCaseParameters = {
  type: 'object',
  required: ['name', 'rootEntityNames'],
  properties: {
    name: { type: 'string', description: 'Case name (a business use-case / view)' },
    rootEntityNames: { type: 'array', items: { type: 'string' }, description: 'Entity names the case is rooted on (≥1)' },
    description: { type: 'string' },
    packageName: { type: 'string', description: 'Preferred package to disambiguate entity names' },
    maxDepth: { type: 'integer', description: 'BFS traversal depth (default 10)' },
  },
} as const;

export async function executeCreateCase(
  input: CreateCaseInput,
  services: ConceptServices,
): Promise<MutationResult> {
  try {
    const rootEntities: string[] = [];
    for (const name of input.rootEntityNames) {
      const resolved = await resolveEntity(services, name, input.packageName);
      if ('error' in resolved) return fail(resolved.error);
      rootEntities.push(resolved.uuid);
    }
    const data: Partial<Case> = {
      uuid: generateUUID(),
      name: input.name,
      rootEntities,
      ...(input.description ? { description: input.description } : {}),
      ...(input.maxDepth ? { maxDepth: input.maxDepth } : {}),
    };
    const result = await services.caseService.create(data);
    if (!result.success || !result.case) return fail(result.errors?.join('; ') || 'Failed to create case.');
    const summary = `Created case ${input.name} (${rootEntities.length} root ${rootEntities.length === 1 ? 'entity' : 'entities'})`;
    return {
      success: true, changeKind: 'created', elementType: 'case',
      name: input.name, packageName: '', summary, navigate: `/cases/${result.case.uuid}`, highlight: input.name, message: summary,
    };
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
}

// ===========================================================================
// 5. EVENT
// ===========================================================================

export const createEventInputSchema = z.object({
  name: z.string().describe('Domain event name, PascalCase past-tense, e.g. OrderPlaced'),
  ownerEntityName: z.string().optional().describe('Aggregate entity that emits the event'),
  packageName: z.string().optional().describe('Package (required if no ownerEntityName)'),
  description: z.string().optional(),
  payload: z.array(attributeInputSchema).optional().describe('Event payload fields (modeling only)'),
});
export type CreateEventInput = z.infer<typeof createEventInputSchema>;

export const createEventParameters = {
  type: 'object',
  required: ['name'],
  properties: {
    name: { type: 'string', description: 'Domain event name, PascalCase past-tense, e.g. OrderPlaced' },
    ownerEntityName: { type: 'string', description: 'Aggregate entity that emits the event' },
    packageName: { type: 'string', description: 'Package (required if no ownerEntityName)' },
    description: { type: 'string' },
    payload: { type: 'array', items: attributeJsonSchema },
  },
} as const;

function buildAttributes(attrs?: Array<z.infer<typeof attributeInputSchema>>): Attribute[] | undefined {
  if (!attrs?.length) return undefined;
  return attrs.map(a => ({
    uuid: generateUUID(),
    name: a.name,
    type: a.type as Attribute['type'],
    description: a.description ?? '',
    required: a.required ?? false,
    ...(a.primaryKey !== undefined ? { primaryKey: a.primaryKey } : {}),
    ...(a.validation || a.enumValues
      ? { validation: { ...(a.validation ?? {}), ...(a.enumValues ? { enumValues: a.enumValues } : {}) } }
      : {}),
  }));
}

export async function executeCreateEvent(
  input: CreateEventInput,
  services: ConceptServices,
): Promise<MutationResult> {
  try {
    let ownerRef: string | undefined;
    let packageName = input.packageName;
    let ownerName = input.ownerEntityName;
    if (input.ownerEntityName) {
      const resolved = await resolveEntity(services, input.ownerEntityName, input.packageName);
      if ('error' in resolved) return fail(resolved.error);
      ownerRef = resolved.uuid;
      packageName = resolved.packageName;
      ownerName = input.ownerEntityName;
    } else if (!input.packageName) {
      return fail('Provide ownerEntityName (the emitting aggregate) or packageName.');
    }
    const result = await services.eventService.create({
      name: input.name,
      ...(ownerRef ? { ownerRef } : {}),
      ...(packageName ? { packageName } : {}),
      ...(input.description ? { description: input.description } : {}),
      ...(buildAttributes(input.payload) ? { payload: buildAttributes(input.payload) } : {}),
    });
    if (isErr(result)) return fail(flattenErrors(result));
    const summary = `Created event ${input.name}${ownerName ? ` (emitted by ${ownerName})` : ''}`;
    const navigate = packageName && ownerName ? `/packages/${packageName}/entities/${ownerName}` : '/diagram';
    return {
      success: true, changeKind: 'created', elementType: 'event',
      name: input.name, packageName: packageName ?? '', summary, navigate, highlight: input.name, message: summary,
    };
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
}

// ===========================================================================
// 6. ACTION
// ===========================================================================

const flowStepSchema = z.object({
  kind: z.enum(['assign', 'emitEvent', 'invokeAction', 'branch', 'wait', 'callExternal']),
  // emitEvent / wait
  name: z.string().optional().describe('Event name for emitEvent'),
  for: z.string().optional().describe('Event name to wait for'),
  // invokeAction
  actionRef: z.string().optional().describe('UUID of the action to invoke'),
  // assign
  target: z.string().optional(),
  value: z.string().optional(),
  // branch
  when: z.string().optional(),
});

export const createActionInputSchema = z.object({
  name: z.string().describe('Action / command name, e.g. PlaceOrder'),
  ownerEntityName: z.string().describe('Aggregate entity the action operates on'),
  packageName: z.string().optional(),
  description: z.string().optional(),
  actionKind: z.enum(['command', 'query']).optional().describe('CQRS classification'),
  flow: z.array(flowStepSchema).optional().describe('Ordered steps; use emitEvent {name} and wait {for} to wire a saga'),
});
export type CreateActionInput = z.infer<typeof createActionInputSchema>;

export const createActionParameters = {
  type: 'object',
  required: ['name', 'ownerEntityName'],
  properties: {
    name: { type: 'string', description: 'Action / command name, e.g. PlaceOrder' },
    ownerEntityName: { type: 'string', description: 'Aggregate entity the action operates on' },
    packageName: { type: 'string' },
    description: { type: 'string' },
    actionKind: { type: 'string', enum: ['command', 'query'], description: 'CQRS classification' },
    flow: {
      type: 'array',
      items: {
        type: 'object',
        required: ['kind'],
        properties: {
          kind: { type: 'string', enum: ['assign', 'emitEvent', 'invokeAction', 'branch', 'wait', 'callExternal'] },
          name: { type: 'string', description: 'Event name for emitEvent' },
          for: { type: 'string', description: 'Event name to wait for' },
          actionRef: { type: 'string', description: 'UUID of the action to invoke' },
          target: { type: 'string' },
          value: { type: 'string' },
          when: { type: 'string' },
        },
      },
    },
  },
} as const;

function buildFlow(steps?: z.infer<typeof flowStepSchema>[]): FlowStep[] | undefined {
  if (!steps?.length) return undefined;
  const out: FlowStep[] = [];
  for (const s of steps) {
    switch (s.kind) {
      case 'emitEvent': out.push({ kind: 'emitEvent', name: s.name ?? '' }); break;
      case 'wait': out.push({ kind: 'wait', for: s.for ?? '' }); break;
      case 'invokeAction': out.push({ kind: 'invokeAction', actionRef: s.actionRef ?? '' }); break;
      case 'assign': out.push({ kind: 'assign', target: s.target ?? '', value: s.value ?? '' }); break;
      case 'branch': out.push({ kind: 'branch', when: s.when ?? '', then: [] }); break;
      case 'callExternal': out.push({ kind: 'callExternal', target: s.target ?? '' }); break;
    }
  }
  return out;
}

export async function executeCreateAction(
  input: CreateActionInput,
  services: ConceptServices,
): Promise<MutationResult> {
  try {
    const resolved = await resolveEntity(services, input.ownerEntityName, input.packageName);
    if ('error' in resolved) return fail(resolved.error);
    const result = await services.actionService.create({
      uuid: generateUUID(),
      name: input.name,
      ownerRef: resolved.uuid,
      ...(input.description ? { description: input.description } : {}),
      ...(input.actionKind ? { actionKind: input.actionKind as ActionKind } : {}),
      ...(buildFlow(input.flow) ? { flow: buildFlow(input.flow) } : {}),
    });
    if (isErr(result)) return fail(flattenErrors(result));
    const kindNote = input.actionKind ? ` (${input.actionKind})` : '';
    const summary = `Created action ${input.name}${kindNote} on ${input.ownerEntityName}`;
    return {
      success: true, changeKind: 'created', elementType: 'action',
      name: input.name, packageName: resolved.packageName, summary,
      navigate: `/packages/${resolved.packageName}/entities/${input.ownerEntityName}`, highlight: input.name, message: summary,
    };
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
}

// ===========================================================================
// 7. STATE MACHINE
// ===========================================================================

const stateSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  terminal: z.boolean().optional(),
});
const transitionSchema = z.object({
  from: z.string().describe('Source state name, or "*" for any state'),
  to: z.string().describe('Target state name'),
  on: z.string().describe('Triggering event/command name'),
  guard: z.string().optional(),
});

export const createStateMachineInputSchema = z.object({
  name: z.string().describe('State machine name, e.g. OrderLifecycle'),
  ownerEntityName: z.string().describe('Entity whose lifecycle this models'),
  packageName: z.string().optional(),
  stateAttribute: z.string().optional().describe('Attribute on the owner that stores the current state'),
  initialState: z.string().describe('Name of the starting state (must be one of states)'),
  states: z.array(stateSchema).min(1).describe('All states'),
  transitions: z.array(transitionSchema).optional().describe('State-to-state transitions'),
});
export type CreateStateMachineInput = z.infer<typeof createStateMachineInputSchema>;

export const createStateMachineParameters = {
  type: 'object',
  required: ['name', 'ownerEntityName', 'initialState', 'states'],
  properties: {
    name: { type: 'string', description: 'State machine name, e.g. OrderLifecycle' },
    ownerEntityName: { type: 'string', description: 'Entity whose lifecycle this models' },
    packageName: { type: 'string' },
    stateAttribute: { type: 'string', description: 'Attribute on the owner that stores the current state' },
    initialState: { type: 'string', description: 'Name of the starting state (must be one of states)' },
    states: {
      type: 'array',
      items: {
        type: 'object', required: ['name'],
        properties: { name: { type: 'string' }, description: { type: 'string' }, terminal: { type: 'boolean' } },
      },
    },
    transitions: {
      type: 'array',
      items: {
        type: 'object', required: ['from', 'to', 'on'],
        properties: {
          from: { type: 'string', description: 'Source state, or "*" for any' },
          to: { type: 'string', description: 'Target state' },
          on: { type: 'string', description: 'Triggering event/command name' },
          guard: { type: 'string' },
        },
      },
    },
  },
} as const;

export async function executeCreateStateMachine(
  input: CreateStateMachineInput,
  services: ConceptServices,
): Promise<MutationResult> {
  try {
    const resolved = await resolveEntity(services, input.ownerEntityName, input.packageName);
    if ('error' in resolved) return fail(resolved.error);
    const stateNames = new Set(input.states.map(s => s.name));
    if (!stateNames.has(input.initialState)) {
      return fail(`initialState "${input.initialState}" is not one of the declared states (${[...stateNames].join(', ')}).`);
    }
    const transitions: Transition[] = (input.transitions ?? []).map(t => ({
      uuid: generateUUID(),
      from: t.from,
      to: t.to,
      on: t.on,
      ...(t.guard ? { guard: t.guard } : {}),
    }));
    const result = await services.stateMachineService.create({
      uuid: generateUUID(),
      name: input.name,
      ownerRef: resolved.uuid,
      ...(input.stateAttribute ? { stateAttribute: input.stateAttribute } : {}),
      initialState: input.initialState,
      states: input.states.map(s => ({ name: s.name, ...(s.description ? { description: s.description } : {}), ...(s.terminal ? { terminal: s.terminal } : {}) })),
      transitions,
    });
    if (isErr(result)) return fail(flattenErrors(result));
    const summary = `Created state machine ${input.name} on ${input.ownerEntityName} (${input.states.length} states, ${transitions.length} transitions)`;
    return {
      success: true, changeKind: 'created', elementType: 'stateMachine',
      name: input.name, packageName: resolved.packageName, summary,
      navigate: `/packages/${resolved.packageName}/entities/${input.ownerEntityName}`, highlight: input.name, message: summary,
    };
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
}
