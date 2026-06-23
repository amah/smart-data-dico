/**
 * Shared core for the AI assistant's data-model mutation tools (#191).
 *
 * Both provider paths in aiController.ts — the Vercel AI SDK path
 * (`tool({...})`) and the direct-client path (JSON-Schema tool defs +
 * `executeTool` switch) — call the SAME functions here so the two paths
 * cannot drift. Each tool's core is a single function:
 *
 *   validate (shape via the caller's schema, then semantics here) →
 *   persist via serviceService →
 *   build the structured result the frontend consumes.
 *
 * Validation reuses the existing model validators
 * (`validateEntity` / `validateRelationship`), the derived-type resolver
 * (`resolveAttributeType`), and the stereotype service — nothing is
 * re-derived here. On a semantic failure the functions RETURN
 * `{ success: false, error }` (never throw) so the model can self-correct
 * and we avoid the tool-output-error path that produced the dangling
 * tool-card bug (#190).
 */

import { z } from 'zod';
import {
  AttributeType,
  Cardinality,
  EntityStatus,
  validateEntity,
  validateRelationship,
  type Attribute,
  type Entity,
  type Relationship,
} from '../models/EntitySchema.js';
import { listDerivedTypes, resolveAttributeType } from '../services/dicoConfigService.js';
import { generateUUID } from '../utils/uuid.js';

// --- Shared types -----------------------------------------------------------

/**
 * The service surface the tool cores need. Mirrors the subset of
 * `serviceService` (+ `stereotypeService`) that aiController already
 * passes around as `services`. Typed loosely (the controller builds it
 * via dynamic import) but documented here so call sites stay honest.
 */
export interface MutationServices {
  serviceService: {
    createEntity(service: string, entity: Entity): Promise<{ success: boolean; errors: string[] }>;
    updateEntity(service: string, entity: Entity): Promise<{ success: boolean; errors: string[] }>;
    deleteEntity(service: string, entityName: string): Promise<{ success: boolean; errors: string[] }>;
    getEntitySchema(service: string, entityName: string): Promise<Entity | null>;
    findEntityAcrossPackages(
      entityName: string,
      preferredPackage?: string,
    ): Promise<{ entity: Entity; packageName: string } | null>;
    getPackageRelationships(packageName: string): Promise<Relationship[]>;
    createRelationship(
      packageName: string,
      relationship: Relationship,
    ): Promise<{ success: boolean; errors: string[]; relationship?: Relationship }>;
    updateRelationship(
      packageName: string,
      uuid: string,
      relationship: Relationship,
    ): Promise<{ success: boolean; errors: string[] }>;
    deleteRelationship(packageName: string, uuid: string): Promise<{ success: boolean; errors: string[] }>;
  };
  stereotypeService: {
    getAllStereotypes(appliesTo?: 'package' | 'entity' | 'attribute' | 'model' | 'relationship'): Promise<
      Array<{ id: string; name: string; appliesTo: string }>
    >;
  };
}

/**
 * The structured success contract every mutation tool returns (#191 §3).
 * The frontend renders a summary card from these fields and uses
 * `navigate` + `highlight` to scroll-to and flash the changed element.
 */
export interface MutationSuccess {
  success: true;
  changeKind: 'created' | 'updated' | 'deleted';
  elementType: 'entity' | 'relationship';
  /** Entity name, or "Source → Target" for a relationship. */
  name: string;
  packageName: string;
  /** Short human delta, e.g. "Created entity Product (+3 attributes, stereotype aggregate-root)". */
  summary: string;
  /** Clean path (no query string), validateNavigatePath-compatible. */
  navigate?: string;
  /** Element key to flash on arrival: entity name, or a changed attribute name. */
  highlight?: string;
  /** Retained because some existing UI reads `message`; `summary` is canonical. */
  message: string;
}

export interface MutationFailure {
  success: false;
  error: string;
}

export type MutationResult = MutationSuccess | MutationFailure;

type ValidationOk = { ok: true };
type ValidationErr = { ok: false; error: string };
type Validation = ValidationOk | ValidationErr;

// --- Structured input schemas (AI SDK path: zod) ----------------------------

const attributeInputSchema = z.object({
  name: z.string().describe('Attribute name (camelCase)'),
  type: z.string().describe('Standard AttributeType (string, integer, number, boolean, date, datetime, uuid, enum, …) or a derived type name'),
  description: z.string().optional().describe('Attribute description'),
  required: z.boolean().optional().describe('Whether the attribute is required'),
  primaryKey: z.boolean().optional().describe('Whether the attribute is (part of) the primary key'),
  enumValues: z.array(z.string()).optional().describe('Allowed values when type is enum'),
});

export const createEntityInputSchema = z.object({
  packageName: z.string().describe('Package/service the entity belongs to'),
  name: z.string().describe('Entity name (PascalCase)'),
  description: z.string().optional().describe('Entity description'),
  stereotype: z.string().optional().describe('Stereotype id (must applyTo entity), e.g. aggregate-root'),
  attributes: z.array(attributeInputSchema).describe('Entity attributes'),
});

export const updateEntityInputSchema = createEntityInputSchema;

export const deleteEntityInputSchema = z.object({
  packageName: z.string().describe('Package/service the entity belongs to'),
  name: z.string().describe('Entity name to delete'),
});

const cardinalityValues = ['one', 'many'] as const;

export const createRelationshipInputSchema = z.object({
  sourceEntityName: z.string().describe('Source entity name'),
  targetEntityName: z.string().describe('Target entity name'),
  sourcePackage: z.string().optional().describe('Package containing the source entity (omit to scan all)'),
  targetPackage: z.string().optional().describe('Package containing the target entity (omit to scan all)'),
  sourceCardinality: z.enum(cardinalityValues).describe('Source-end cardinality'),
  targetCardinality: z.enum(cardinalityValues).describe('Target-end cardinality'),
  description: z.string().optional().describe('Relationship description'),
});

export const updateRelationshipInputSchema = createRelationshipInputSchema;

export const deleteRelationshipInputSchema = z.object({
  packageName: z.string().describe('Package the relationship is stored under (the source entity\'s package)'),
  sourceEntityName: z.string().describe('Source entity name'),
  targetEntityName: z.string().describe('Target entity name'),
});

// Inferred input types — the tool cores accept these exactly.
export type CreateEntityInput = z.infer<typeof createEntityInputSchema>;
export type UpdateEntityInput = z.infer<typeof updateEntityInputSchema>;
export type DeleteEntityInput = z.infer<typeof deleteEntityInputSchema>;
export type CreateRelationshipInput = z.infer<typeof createRelationshipInputSchema>;
export type UpdateRelationshipInput = z.infer<typeof updateRelationshipInputSchema>;
export type DeleteRelationshipInput = z.infer<typeof deleteRelationshipInputSchema>;

// --- Structured input schemas (direct-client path: JSON Schema) --------------
//
// Hand-written to mirror the zod schemas above (the OpenAI-compatible API
// validates `parameters` JSON Schema before the model emits a tool call).
// Keep these in lock-step with the zod definitions.

const attributeJsonSchema = {
  type: 'object',
  required: ['name', 'type'],
  properties: {
    name: { type: 'string', description: 'Attribute name (camelCase)' },
    type: { type: 'string', description: 'Standard AttributeType or a derived type name' },
    description: { type: 'string' },
    required: { type: 'boolean' },
    primaryKey: { type: 'boolean' },
    enumValues: { type: 'array', items: { type: 'string' } },
  },
} as const;

export const createEntityParameters = {
  type: 'object',
  required: ['packageName', 'name', 'attributes'],
  properties: {
    packageName: { type: 'string', description: 'Package/service the entity belongs to' },
    name: { type: 'string', description: 'Entity name (PascalCase)' },
    description: { type: 'string' },
    stereotype: { type: 'string', description: 'Stereotype id (entity), e.g. aggregate-root' },
    attributes: { type: 'array', items: attributeJsonSchema },
  },
} as const;

export const updateEntityParameters = createEntityParameters;

export const deleteEntityParameters = {
  type: 'object',
  required: ['packageName', 'name'],
  properties: {
    packageName: { type: 'string' },
    name: { type: 'string', description: 'Entity name to delete' },
  },
} as const;

export const createRelationshipParameters = {
  type: 'object',
  required: ['sourceEntityName', 'targetEntityName', 'sourceCardinality', 'targetCardinality'],
  properties: {
    sourceEntityName: { type: 'string' },
    targetEntityName: { type: 'string' },
    sourcePackage: { type: 'string', description: 'Package of source entity (omit to scan all)' },
    targetPackage: { type: 'string', description: 'Package of target entity (omit to scan all)' },
    sourceCardinality: { type: 'string', enum: ['one', 'many'] },
    targetCardinality: { type: 'string', enum: ['one', 'many'] },
    description: { type: 'string' },
  },
} as const;

export const updateRelationshipParameters = createRelationshipParameters;

export const deleteRelationshipParameters = {
  type: 'object',
  required: ['packageName', 'sourceEntityName', 'targetEntityName'],
  properties: {
    packageName: { type: 'string', description: "Package the relationship is stored under (source entity's package)" },
    sourceEntityName: { type: 'string' },
    targetEntityName: { type: 'string' },
  },
} as const;

// --- Helpers ----------------------------------------------------------------

function fail(error: string): MutationFailure {
  return { success: false, error };
}

function cardinalityLabel(c: Cardinality | string): string {
  return c === Cardinality.MANY || c === 'many' ? '0..*' : '1';
}

async function ensurePackage(packageName: string): Promise<void> {
  const { listPackages, ensurePackageDirectoryStructure } = await import('../utils/fileOperations.js');
  const existing = await listPackages();
  if (!existing.includes(packageName)) {
    await ensurePackageDirectoryStructure(packageName);
  }
}

async function packageExists(packageName: string): Promise<boolean> {
  const { listPackages } = await import('../utils/fileOperations.js');
  const existing = await listPackages();
  return existing.includes(packageName);
}

/**
 * Build an `Entity` from the structured tool input. When `existing` is
 * provided (update path) its `uuid`/`createdAt` are preserved and the
 * provided fields become the new desired state. Attribute uuids are
 * carried over by name when the attribute already existed, so an update
 * that only adds/edits an attribute doesn't churn the unchanged uuids.
 */
function buildEntity(
  input: CreateEntityInput | UpdateEntityInput,
  existing?: Entity | null,
): Entity {
  const existingByName = new Map((existing?.attributes ?? []).map(a => [a.name, a] as const));
  const attributes: Attribute[] = input.attributes.map((a) => {
    const prior = existingByName.get(a.name);
    return {
      uuid: prior?.uuid ?? generateUUID(),
      name: a.name,
      type: (a.type as AttributeType),
      description: a.description ?? '',
      required: a.required ?? false,
      ...(a.primaryKey !== undefined ? { primaryKey: a.primaryKey } : {}),
      ...(a.enumValues ? { validation: { enumValues: a.enumValues } } : {}),
    };
  });

  return {
    uuid: existing?.uuid ?? generateUUID(),
    name: input.name,
    description: input.description ?? existing?.description ?? '',
    ...(input.stereotype !== undefined ? { stereotype: input.stereotype } : existing?.stereotype ? { stereotype: existing.stereotype } : {}),
    status: existing?.status ?? EntityStatus.DRAFT,
    attributes,
    createdAt: existing?.createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Shared semantic validation for create/update entity (#191 §2):
 * package presence, attribute types resolve, stereotype exists, no
 * duplicate attribute names, create-only duplicate-entity check, and a
 * final schema-level `validateEntity`.
 */
export async function validateEntityMutation(
  input: CreateEntityInput | UpdateEntityInput,
  entity: Entity,
  services: MutationServices,
  kind: 'create' | 'update',
): Promise<Validation> {
  // package presence — for create we auto-create (matches prior behavior),
  // so only block update against a missing package.
  if (kind === 'update' && !(await packageExists(input.packageName))) {
    return { ok: false, error: `Package "${input.packageName}" does not exist.` };
  }

  // duplicate attribute names within the entity
  const seen = new Set<string>();
  for (const a of input.attributes) {
    if (seen.has(a.name)) {
      return { ok: false, error: `Duplicate attribute name "${a.name}" in entity ${input.name}.` };
    }
    seen.add(a.name);
  }

  // every attribute type resolves to a standard or derived type
  const derivedTypes = await listDerivedTypes();
  for (const a of input.attributes) {
    if (resolveAttributeType(a.type, derivedTypes) == null) {
      return {
        ok: false,
        error: `Attribute "${a.name}" has unknown type "${a.type}". Use a standard AttributeType (${Object.values(AttributeType).join(', ')}) or a defined derived type.`,
      };
    }
  }

  // stereotype (if given) must exist and apply to entities
  if (input.stereotype) {
    const stereotypes = await services.stereotypeService.getAllStereotypes('entity');
    const known = stereotypes.some(s => s.id === input.stereotype || s.name === input.stereotype);
    if (!known) {
      const ids = stereotypes.map(s => s.id).join(', ') || '(none defined)';
      return { ok: false, error: `Unknown entity stereotype "${input.stereotype}". Known: ${ids}.` };
    }
  }

  // create-only: no existing entity of that name in the package
  if (kind === 'create') {
    const existing = await services.serviceService.getEntitySchema(input.packageName, input.name);
    if (existing) {
      return { ok: false, error: `Entity "${input.name}" already exists in package "${input.packageName}".` };
    }
  }

  // schema validity
  const schemaResult = validateEntity(entity);
  if (!schemaResult.valid) {
    return { ok: false, error: `Entity failed schema validation: ${schemaResult.errors.join('; ')}` };
  }

  return { ok: true };
}

// --- Entity tool cores ------------------------------------------------------

export async function executeCreateEntity(
  input: CreateEntityInput,
  services: MutationServices,
): Promise<MutationResult> {
  try {
    await ensurePackage(input.packageName);
    const entity = buildEntity(input);

    const validation = await validateEntityMutation(input, entity, services, 'create');
    if (!validation.ok) return fail(validation.error);

    const result = await services.serviceService.createEntity(input.packageName, entity);
    if (!result.success) return fail(result.errors.join('; ') || 'Failed to create entity.');

    const attrCount = entity.attributes.length;
    const stereoNote = entity.stereotype ? `, stereotype ${entity.stereotype}` : '';
    const summary = `Created entity ${entity.name} (+${attrCount} attribute${attrCount === 1 ? '' : 's'}${stereoNote})`;
    return {
      success: true,
      changeKind: 'created',
      elementType: 'entity',
      name: entity.name,
      packageName: input.packageName,
      summary,
      navigate: `/packages/${input.packageName}/entities/${entity.name}`,
      highlight: entity.name,
      message: summary,
    };
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
}

export async function executeUpdateEntity(
  input: UpdateEntityInput,
  services: MutationServices,
): Promise<MutationResult> {
  try {
    const existing = await services.serviceService.getEntitySchema(input.packageName, input.name);
    if (!existing) {
      return fail(`Entity "${input.name}" not found in package "${input.packageName}".`);
    }

    const entity = buildEntity(input, existing);

    const validation = await validateEntityMutation(input, entity, services, 'update');
    if (!validation.ok) return fail(validation.error);

    const result = await services.serviceService.updateEntity(input.packageName, entity);
    if (!result.success) return fail(result.errors.join('; ') || 'Failed to update entity.');

    const before = existing.attributes.length;
    const after = entity.attributes.length;
    const delta = after - before;
    const deltaNote = delta === 0
      ? 'attributes unchanged'
      : delta > 0
        ? `+${delta} attribute${delta === 1 ? '' : 's'}`
        : `-${Math.abs(delta)} attribute${Math.abs(delta) === 1 ? '' : 's'}`;
    const summary = `Updated ${entity.name} (${deltaNote})`;

    // #193 — when this update ADDS an attribute, highlight that new row on
    // arrival (keyed by uuid to match the attribute table's row key,
    // getRowKey={(a) => a.uuid}). Otherwise fall back to the entity name so the
    // header flashes (covers field-level edits and whole-entity changes).
    const existingNames = new Set(existing.attributes.map((a) => a.name));
    const addedAttr = entity.attributes.find((a) => !existingNames.has(a.name));

    return {
      success: true,
      changeKind: 'updated',
      elementType: 'entity',
      name: entity.name,
      packageName: input.packageName,
      summary,
      navigate: `/packages/${input.packageName}/entities/${entity.name}`,
      highlight: addedAttr ? addedAttr.uuid : entity.name,
      message: summary,
    };
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
}

export async function executeDeleteEntity(
  input: DeleteEntityInput,
  services: MutationServices,
): Promise<MutationResult> {
  try {
    const result = await services.serviceService.deleteEntity(input.packageName, input.name);
    // deleteEntity surfaces "not found" and the cascade-safety
    // ("referenced in N relationship(s)") errors — pass them through so the
    // model self-corrects rather than auto-cascading.
    if (!result.success) return fail(result.errors.join('; ') || 'Failed to delete entity.');

    const summary = `Deleted entity ${input.name}`;
    return {
      success: true,
      changeKind: 'deleted',
      elementType: 'entity',
      name: input.name,
      packageName: input.packageName,
      summary,
      // Deletes navigate to the package page (the entity page no longer exists).
      navigate: `/packages/${input.packageName}`,
      message: summary,
    };
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
}

// --- Relationship helpers ---------------------------------------------------

interface ResolvedEnds {
  src: { entity: Entity; packageName: string };
  tgt: { entity: Entity; packageName: string };
  homePackage: string;
}

/**
 * Resolve both relationship endpoints across packages, returning a
 * MutationFailure on any unresolved/ambiguous endpoint. The relationship
 * is stored under the source entity's package (the "home" package).
 */
async function resolveRelationshipEnds(
  sourceEntityName: string,
  targetEntityName: string,
  sourcePackage: string | undefined,
  targetPackage: string | undefined,
  services: MutationServices,
): Promise<ResolvedEnds | MutationFailure> {
  let src: { entity: Entity; packageName: string } | null;
  try {
    src = await services.serviceService.findEntityAcrossPackages(sourceEntityName, sourcePackage);
  } catch (e) {
    return fail(`Source: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!src) return fail(`Source entity "${sourceEntityName}" not found in any package.`);

  let tgt: { entity: Entity; packageName: string } | null;
  try {
    tgt = await services.serviceService.findEntityAcrossPackages(targetEntityName, targetPackage);
  } catch (e) {
    return fail(`Target: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!tgt) return fail(`Target entity "${targetEntityName}" not found in any package.`);

  return { src, tgt, homePackage: src.packageName };
}

/**
 * Shared semantic validation for create/update relationship — runs the
 * schema-level `validateRelationship` (endpoint existence is already
 * enforced by resolveRelationshipEnds before this is called).
 */
export function validateRelationshipMutation(relationship: Relationship): Validation {
  const result = validateRelationship(relationship);
  if (!result.valid) {
    return { ok: false, error: `Relationship failed schema validation: ${result.errors.join('; ')}` };
  }
  return { ok: true };
}

function relationshipName(sourceName: string, targetName: string): string {
  return `${sourceName} → ${targetName}`;
}

// --- Relationship tool cores ------------------------------------------------

export async function executeCreateRelationship(
  input: CreateRelationshipInput,
  services: MutationServices,
): Promise<MutationResult> {
  try {
    const ends = await resolveRelationshipEnds(
      input.sourceEntityName,
      input.targetEntityName,
      input.sourcePackage,
      input.targetPackage,
      services,
    );
    if ('success' in ends) return ends; // MutationFailure

    const relationship: Relationship = {
      uuid: generateUUID(),
      description: input.description ?? '',
      source: { entity: ends.src.entity.uuid, cardinality: input.sourceCardinality as Cardinality },
      target: { entity: ends.tgt.entity.uuid, cardinality: input.targetCardinality as Cardinality },
    };

    const validation = validateRelationshipMutation(relationship);
    if (!validation.ok) return fail(validation.error);

    const result = await services.serviceService.createRelationship(ends.homePackage, relationship);
    if (!result.success) return fail(result.errors.join('; ') || 'Failed to create relationship.');

    const name = relationshipName(input.sourceEntityName, input.targetEntityName);
    const crossNote = ends.src.packageName !== ends.tgt.packageName
      ? `, cross-package ${ends.src.packageName} → ${ends.tgt.packageName}`
      : '';
    const summary = `Created relationship ${name} (${cardinalityLabel(input.sourceCardinality)} → ${cardinalityLabel(input.targetCardinality)}${crossNote})`;
    return {
      success: true,
      changeKind: 'created',
      elementType: 'relationship',
      name,
      packageName: ends.homePackage,
      summary,
      message: summary,
    };
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
}

/**
 * Resolve a stored relationship's uuid by matching source/target entity
 * uuids within the home package. Returns the uuid or a MutationFailure.
 */
async function findRelationshipUuid(
  homePackage: string,
  srcUuid: string,
  tgtUuid: string,
  sourceName: string,
  targetName: string,
  services: MutationServices,
): Promise<string | MutationFailure> {
  const rels = await services.serviceService.getPackageRelationships(homePackage);
  const match = rels.find(r => r.source?.entity === srcUuid && r.target?.entity === tgtUuid);
  if (!match) {
    return fail(`No relationship ${relationshipName(sourceName, targetName)} found in package "${homePackage}".`);
  }
  return match.uuid;
}

export async function executeUpdateRelationship(
  input: UpdateRelationshipInput,
  services: MutationServices,
): Promise<MutationResult> {
  try {
    const ends = await resolveRelationshipEnds(
      input.sourceEntityName,
      input.targetEntityName,
      input.sourcePackage,
      input.targetPackage,
      services,
    );
    if ('success' in ends) return ends;

    const uuidOrFail = await findRelationshipUuid(
      ends.homePackage,
      ends.src.entity.uuid,
      ends.tgt.entity.uuid,
      input.sourceEntityName,
      input.targetEntityName,
      services,
    );
    if (typeof uuidOrFail !== 'string') return uuidOrFail;

    const relationship: Relationship = {
      uuid: uuidOrFail,
      description: input.description ?? '',
      source: { entity: ends.src.entity.uuid, cardinality: input.sourceCardinality as Cardinality },
      target: { entity: ends.tgt.entity.uuid, cardinality: input.targetCardinality as Cardinality },
    };

    const validation = validateRelationshipMutation(relationship);
    if (!validation.ok) return fail(validation.error);

    const result = await services.serviceService.updateRelationship(ends.homePackage, uuidOrFail, relationship);
    if (!result.success) return fail(result.errors.join('; ') || 'Failed to update relationship.');

    const name = relationshipName(input.sourceEntityName, input.targetEntityName);
    const summary = `Updated relationship ${name} (${cardinalityLabel(input.sourceCardinality)} → ${cardinalityLabel(input.targetCardinality)})`;
    return {
      success: true,
      changeKind: 'updated',
      elementType: 'relationship',
      name,
      packageName: ends.homePackage,
      summary,
      message: summary,
    };
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
}

export async function executeDeleteRelationship(
  input: DeleteRelationshipInput,
  services: MutationServices,
): Promise<MutationResult> {
  try {
    // Resolve endpoints against the stated home package first so the uuid
    // match is unambiguous. The relationship lives under input.packageName.
    let src: { entity: Entity; packageName: string } | null;
    let tgt: { entity: Entity; packageName: string } | null;
    try {
      src = await services.serviceService.findEntityAcrossPackages(input.sourceEntityName, input.packageName);
    } catch (e) {
      return fail(`Source: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (!src) return fail(`Source entity "${input.sourceEntityName}" not found in any package.`);
    try {
      tgt = await services.serviceService.findEntityAcrossPackages(input.targetEntityName, input.packageName);
    } catch (e) {
      return fail(`Target: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (!tgt) return fail(`Target entity "${input.targetEntityName}" not found in any package.`);

    const uuidOrFail = await findRelationshipUuid(
      input.packageName,
      src.entity.uuid,
      tgt.entity.uuid,
      input.sourceEntityName,
      input.targetEntityName,
      services,
    );
    if (typeof uuidOrFail !== 'string') return uuidOrFail;

    const result = await services.serviceService.deleteRelationship(input.packageName, uuidOrFail);
    if (!result.success) return fail(result.errors.join('; ') || 'Failed to delete relationship.');

    const name = relationshipName(input.sourceEntityName, input.targetEntityName);
    const summary = `Deleted relationship ${name}`;
    return {
      success: true,
      changeKind: 'deleted',
      elementType: 'relationship',
      name,
      packageName: input.packageName,
      summary,
      navigate: `/packages/${input.packageName}`,
      message: summary,
    };
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
}
