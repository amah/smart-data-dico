/**
 * schemaEntityView.ts — #165a / #165b
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
 *
 * #165b changes to toLegacyStereotypeView / fromLegacyStereotypeView:
 *   - Stereotype.id is now Entity.name (the slug) NOT Entity.uuid.
 *     Legacy eshop stereotypes use slug ids like 'pii', 'aggregate-root'.
 *     aiController.ts and serviceService embed these slugs verbatim.
 *   - Stereotype.name is now metadata['displayName'].value if present,
 *     else Entity.name (falls back so slugs that equal their display names
 *     work without an explicit displayName entry).
 *   - Entity.uuid is NOT surfaced through the Stereotype view — it is
 *     internal to the schema-entity model.
 */
import type { Entity, Attribute, MetadataEntry, Stereotype, StereotypeTarget } from '../models/EntitySchema.js';
import { generateUUID } from '../utils/uuid.js';
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
 * Convert a schema-entity to the legacy `Stereotype` view shape (#165b update).
 *
 * Mapping (changed in #165b — was uuid→id, name→name in #165a):
 *   Entity.name                       → Stereotype.id          (slug — preserves pre-#165a HTTP shape)
 *   metadata['displayName'].value     → Stereotype.name        (display name, falls back to Entity.name)
 *   Entity.description                → Stereotype.description
 *   metadata['domain'].value          → Stereotype.domain
 *   metadata['appliesTo'].value       → Stereotype.appliesTo   (default 'entity')
 *   Entity.attributes[]               → Stereotype.metadataDefinitions[]
 *
 * Entity.uuid is NOT surfaced through the Stereotype view — it is internal
 * to the schema-entity model. Consumers that want the uuid use
 * `schemaEntityService.findByName(slug)` directly.
 *
 * Constraints[] still dropped silently with a logged warning (#85, unchanged).
 */
export function toLegacyStereotypeView(schemaEntity: Entity): Stereotype {
  // #165b: use entity.name (the slug) as the stereotype id, not uuid
  const id = schemaEntity.name;
  // #165b: display name from metadata['displayName'], falls back to slug
  const displayName = findMetadataValue(schemaEntity.metadata, 'displayName');
  const name = displayName || schemaEntity.name;
  const description = schemaEntity.description;
  const domain = findMetadataValue(schemaEntity.metadata, 'domain');
  const appliesToRaw = findMetadataValue(schemaEntity.metadata, 'appliesTo');
  const appliesTo = parseAppliesTo(appliesToRaw);

  const metadataDefinitions = (schemaEntity.attributes || []).map(
    definitionFromAttribute,
  );

  if (schemaEntity.constraints && schemaEntity.constraints.length > 0) {
    logger.warn(
      `[#165b] toLegacyStereotypeView: schema-entity '${id}' has constraints[]; ` +
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
 * Inverse mapping (#165b update) — converts a legacy `Stereotype` to a
 * schema-entity `Entity`. Used by the #165b write path and tests.
 *
 * Mapping:
 *   stereotype.id                     → Entity.name            (slug becomes the entity name)
 *   stereotype.name (if !== id)       → metadata['displayName']
 *   stereotype.description            → Entity.description
 *   stereotype.domain                 → metadata['domain']
 *   stereotype.appliesTo              → metadata['appliesTo']
 *   stereotype.metadataDefinitions[]  → Entity.attributes[]
 *
 * UUID handling:
 *   - Always generates a fresh UUID via generateUUID(). Legacy ids are slugs,
 *     not UUIDs (verified at samples/eshop/.dico/stereotypes.yaml — all 7
 *     ids are kebab-case slugs). When `stereotype.id` is a valid UUID the
 *     existing code that reused it was removed in #165b — the view no longer
 *     surfaces the uuid at all, so there is nothing to preserve.
 *
 * The synthesised entity gets `stereotype: 'metadata-schema'` set so it is
 * recognised on the next load.
 */
export function fromLegacyStereotypeView(stereotype: Stereotype): Entity {
  // #165b: always generate a fresh UUID — legacy ids are slugs, not UUIDs
  const uuid = generateUUID();

  const metadata: MetadataEntry[] = [];
  if (stereotype.appliesTo) {
    metadata.push({ name: 'appliesTo', value: stereotype.appliesTo });
  }
  if ((stereotype as any).domain) {
    metadata.push({ name: 'domain', value: (stereotype as any).domain });
  }
  // #165b: if the display name differs from the slug, store it as a metadata entry
  if (stereotype.name && stereotype.name !== stereotype.id) {
    metadata.push({ name: 'displayName', value: stereotype.name });
  }

  const attributes: Attribute[] = (stereotype.metadataDefinitions || []).map(
    attributeFromDefinition,
  );

  const entity: Entity = {
    uuid,
    // #165b: entity.name = stereotype.id (the slug — load-bearing identity)
    name: stereotype.id,
    stereotype: 'metadata-schema',
    attributes,
  };

  if ((stereotype as any).description) entity.description = (stereotype as any).description;
  if (metadata.length > 0) entity.metadata = metadata;

  return entity;
}
