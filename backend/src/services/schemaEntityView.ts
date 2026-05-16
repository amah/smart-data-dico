/**
 * schemaEntityView.ts — #165a
 *
 * Pure functions for converting between the Entity/Attribute model (the
 * canonical schema-entity representation) and the legacy Stereotype shape
 * (the read-compat view returned by all HTTP endpoints during the #165
 * migration window).
 *
 * All functions are stateless — no I/O. They can be called from
 * stereotypeService.ts, from the migration script (#165b), or from tests.
 *
 * NOTE: This branch (arch/155-batch-pattern-b) predates #164 and uses the
 * pre-#164 `MetadataDefinition` type (narrower: type is MetadataValueType
 * enum, no fields/items/enum fields). The extended shapes are accessed via
 * `as any` casts so the spec-defined public surface compiles here and on
 * main (#164+).
 */
import type { Entity, Attribute, MetadataEntry, Stereotype, StereotypeTarget } from '../models/EntitySchema.js';
import { generateUUID, isValidUUID } from '../utils/uuid.js';
import { logger } from '../utils/logger.js';

// Use `any` for MetadataDefinition here to bridge the pre-#164 / post-#164
// type gap. On main (#164+) MetadataDefinition has fields/items/enum;
// on this branch it does not. The runtime shape is identical — we just
// need to work around the narrower compile-time type.
type AnyMetadataDefinition = any;

// ────────────────────────────────────────────────────────────────────────
// Attribute ↔ MetadataDefinition
// ────────────────────────────────────────────────────────────────────────

/**
 * Convert one `Attribute` to one `MetadataDefinition`.
 *
 * Mapping:
 *   attr.name               → def.name
 *   attr.type               → def.type       (string coercion of AttributeType)
 *   attr.description        → def.description
 *   attr.required           → def.required
 *   attr.properties[]       → def.fields[]   (recursive; #164 richer shape)
 *   attr.items              → def.items      (recursive; #164 richer shape)
 *   attr.validation.enumValues → def.enum    (string-only enum; #164 richer shape)
 *
 * Physical constraints on the entity (not attributes) are handled upstream
 * in `toLegacyStereotypeView` — they never reach this function.
 */
export function definitionFromAttribute(attr: Attribute): AnyMetadataDefinition {
  const def: AnyMetadataDefinition = {
    name: attr.name,
    type: attr.type as string,
  };

  if (attr.description) def.description = attr.description;
  if (attr.required) def.required = attr.required;

  // Nested object properties → fields[] (present in #164+ shape)
  if (attr.properties && attr.properties.length > 0) {
    def.fields = attr.properties.map(definitionFromAttribute);
  }

  // Array item schema
  if (attr.items) {
    def.items = definitionFromAttribute(attr.items);
  }

  // enum values from validation
  if ((attr.validation as any)?.enumValues && (attr.validation as any).enumValues.length > 0) {
    def.enum = (attr.validation as any).enumValues;
  }

  return def;
}

/**
 * Inverse: convert one `MetadataDefinition` to one `Attribute`.
 * Used by `fromLegacyStereotypeView` and the #165b migration script.
 *
 * A new UUID is generated for each synthesised attribute since
 * `MetadataDefinition` has no uuid field.
 */
export function attributeFromDefinition(def: AnyMetadataDefinition): Attribute {
  const attr: Attribute = {
    uuid: generateUUID(),
    name: def.name,
    description: def.description || '',
    type: def.type as any,
    required: def.required || false,
  };

  // fields[] → properties[] (from #164+ MetadataDefinition shape)
  if (def.fields && def.fields.length > 0) {
    attr.properties = def.fields.map(attributeFromDefinition);
  }

  // items (from #164+ MetadataDefinition shape)
  if (def.items) {
    attr.items = attributeFromDefinition(def.items);
  }

  // enum → validation.enumValues (from #164+ MetadataDefinition shape)
  if (def.enum && def.enum.length > 0) {
    (attr as any).validation = {
      enumValues: (def.enum as any[]).map((v: any) =>
        typeof v === 'object' ? String(v.value) : String(v),
      ),
    };
  }

  return attr;
}

// ────────────────────────────────────────────────────────────────────────
// Metadata entry helpers
// ────────────────────────────────────────────────────────────────────────

function findMetadataValue(metadata: MetadataEntry[] | undefined, name: string): string | undefined {
  if (!metadata) return undefined;
  const entry = metadata.find(m => m.name === name);
  if (!entry) return undefined;
  return typeof entry.value === 'string' ? entry.value : undefined;
}

const VALID_APPLIES_TO: StereotypeTarget[] = ['package', 'entity', 'attribute', 'model', 'relationship'];

function parseAppliesTo(raw: string | undefined): StereotypeTarget {
  if (raw && VALID_APPLIES_TO.includes(raw as StereotypeTarget)) {
    return raw as StereotypeTarget;
  }
  return 'entity';
}

// ────────────────────────────────────────────────────────────────────────
// Entity → Stereotype (read-compat view)
// ────────────────────────────────────────────────────────────────────────

/**
 * Convert a schema-entity to the legacy `Stereotype` view shape. The
 * conversion is total — every schema-entity that passes the marker test
 * produces a valid `Stereotype`.
 *
 * Mapping:
 *   Entity.uuid               → Stereotype.id
 *   Entity.name               → Stereotype.name
 *   Entity.description        → Stereotype.description
 *   metadata['domain'].value  → Stereotype.domain      (string)
 *   metadata['appliesTo'].v   → Stereotype.appliesTo   (StereotypeTarget)
 *   Entity.attributes[]       → Stereotype.metadataDefinitions[]
 *
 * `appliesTo` defaults to `'entity'` if the metadata entry is absent.
 *
 * Schema-entities with `constraints[]` have those constraints silently
 * dropped here — physical constraints are meaningless on stereotype
 * schemas (#85 governance boundary). A warning is logged upstream in
 * `SchemaEntityService.list()` so the steward can fix the YAML.
 */
export function toLegacyStereotypeView(schemaEntity: Entity): Stereotype {
  const id = schemaEntity.uuid;
  const name = schemaEntity.name;
  const description = schemaEntity.description;
  const domain = findMetadataValue(schemaEntity.metadata, 'domain');
  const appliesToRaw = findMetadataValue(schemaEntity.metadata, 'appliesTo');
  const appliesTo = parseAppliesTo(appliesToRaw);

  const metadataDefinitions = (schemaEntity.attributes || []).map(
    definitionFromAttribute,
  );

  if (schemaEntity.constraints && schemaEntity.constraints.length > 0) {
    logger.warn(
      `[#165a] toLegacyStereotypeView: schema-entity '${name}' has constraints[]; ` +
      `they are dropped in the Stereotype view (physical constraints have no meaning on schemas, #85).`,
    );
  }

  const stereotype: Stereotype = {
    id,
    name,
    appliesTo,
    metadataDefinitions,
  };

  if (description) (stereotype as any).description = description;
  if (domain) (stereotype as any).domain = domain;

  return stereotype;
}

// ────────────────────────────────────────────────────────────────────────
// Stereotype → Entity (inverse — for #165b migration script)
// ────────────────────────────────────────────────────────────────────────

/**
 * Inverse mapping — converts a legacy `Stereotype` to a schema-entity
 * `Entity`. Used by the #165b migration script and kept here so the
 * converter is tested as a pair.
 *
 * The inverse loses no information when the input is a legacy
 * `Stereotype` (which is structurally a strict subset of `Entity`).
 *
 * UUID handling:
 *   - If `stereotype.id` is a valid UUID (v1–v5), it is reused as the
 *     entity uuid.
 *   - Otherwise a new UUID is generated. This covers the common case
 *     where legacy stereotypes used short string ids like 'pii' or
 *     'aggregate-root'.
 *
 * The synthesised entity gets `stereotype: 'metadata-schema'` set so
 * it is recognised as a schema-entity on the next load.
 *
 * `appliesTo` and `domain` are stored as entity-level metadata entries
 * so the round-trip via `toLegacyStereotypeView` is lossless.
 */
export function fromLegacyStereotypeView(stereotype: Stereotype): Entity {
  const uuid = isValidUUID(stereotype.id) ? stereotype.id : generateUUID();

  const metadata: MetadataEntry[] = [];
  if (stereotype.appliesTo) {
    metadata.push({ name: 'appliesTo', value: stereotype.appliesTo });
  }
  if ((stereotype as any).domain) {
    metadata.push({ name: 'domain', value: (stereotype as any).domain });
  }

  const attributes: Attribute[] = (stereotype.metadataDefinitions || []).map(
    attributeFromDefinition,
  );

  const entity: Entity = {
    uuid,
    name: stereotype.name,
    stereotype: 'metadata-schema',
    attributes,
  };

  if ((stereotype as any).description) entity.description = (stereotype as any).description;
  if (metadata.length > 0) entity.metadata = metadata;

  return entity;
}
