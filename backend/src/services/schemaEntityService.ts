import type { Entity } from '../models/EntitySchema.js';
import { loadSchemaPackage } from '../utils/fileOperations.js';
import { logger } from '../utils/logger.js';

// ────────────────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────────────────

/**
 * The reserved name of the bootstrap marker entity. Any entity whose
 * `stereotype` field equals this string is interpreted as a schema-entity
 * (i.e. a stereotype definition expressed in the Entity/Attribute model).
 *
 * Built-in: `samples/eshop/.dico/schemas/_meta/metadata-schema.entity.yaml`
 * defines the marker itself. The marker has no attributes — it bootstraps
 * the regress by defining the type of all schema-entities without itself
 * needing to be labelled with a stereotype (the `stereotype` field is
 * intentionally absent on the marker YAML).
 */
export const METADATA_SCHEMA_MARKER = 'metadata-schema' as const;

/**
 * Reserved UUID for the metadata-schema marker entity. Stable across
 * projects; referenced by deployments that want to ship custom schema-
 * entities pre-populated.
 */
export const METADATA_SCHEMA_MARKER_UUID = '00000000-0000-1000-8000-000000000001' as const;

// ────────────────────────────────────────────────────────────────────────
// Service
// ────────────────────────────────────────────────────────────────────────

/**
 * Service that loads schema-entities from `.dico/schemas/`. Read-only in
 * #165a — writes still go through `stereotypeService.ts` to
 * `.dico/stereotypes.yaml`.
 *
 * Schema-entities are `Entity` objects whose `stereotype` field equals
 * `METADATA_SCHEMA_MARKER` ('metadata-schema'). The bootstrap marker
 * entity itself (uuid `00000000-0000-1000-8000-000000000001`) has no
 * `stereotype` field — it defines the concept without using it.
 */
export class SchemaEntityService {
  /**
   * Return all entities tagged with `stereotype: 'metadata-schema'`
   * loaded from the `.dico/schemas/` package. Does NOT consult
   * `.dico/stereotypes.yaml` — that's `stereotypeService`'s job.
   *
   * The bootstrap marker entity itself is filtered OUT — it has no
   * stereotype field set and contributes nothing as a stereotype
   * definition. Only user-authored schema-entities are returned.
   *
   * Returns an empty array if `.dico/schemas/` does not exist.
   * Logs a warning if `.dico/schemas/package.yaml` is missing.
   *
   * Schema-entities with a non-empty `constraints[]` array log a warning
   * and the constraints are preserved on the entity (they are dropped
   * later by `toLegacyStereotypeView` during view conversion, per #85 —
   * physical constraints are meaningless on stereotype schemas).
   */
  async list(): Promise<Entity[]> {
    try {
      const pkg = await loadSchemaPackage();
      const results: Entity[] = [];

      for (const entity of pkg.entities) {
        // Filter out the bootstrap marker itself
        if (entity.uuid === METADATA_SCHEMA_MARKER_UUID || entity.name === METADATA_SCHEMA_MARKER) {
          continue;
        }

        // Only include entities explicitly tagged as schema-entities
        if (entity.stereotype !== METADATA_SCHEMA_MARKER) {
          continue;
        }

        // Warn about physical constraints — meaningful for business entities,
        // not for schema definitions (#85 governance boundary)
        if (entity.constraints && entity.constraints.length > 0) {
          const filePath = pkg.ownership.entityByName.get(entity.name) || '<unknown>';
          logger.warn(
            `[#165a] Schema-entity '${entity.name}' at ${filePath} has constraints[]; ` +
            `physical constraints are meaningless on stereotype schemas and will be ` +
            `dropped during view conversion. Remove them to suppress this warning.`,
          );
        }

        results.push(entity);
      }

      return results;
    } catch (error) {
      logger.error(`[#165a] SchemaEntityService.list() failed: ${error}`);
      return [];
    }
  }

  /**
   * Return the bootstrap marker entity if present, otherwise `null`.
   * Used by loader code that needs to confirm the bootstrap is wired
   * before treating any entity as a schema-entity.
   *
   * The marker is the entity with uuid
   * `00000000-0000-1000-8000-000000000001` and name `metadata-schema`.
   */
  async getMarker(): Promise<Entity | null> {
    try {
      const pkg = await loadSchemaPackage();
      return (
        pkg.entities.find(
          e => e.uuid === METADATA_SCHEMA_MARKER_UUID || e.name === METADATA_SCHEMA_MARKER,
        ) || null
      );
    } catch (error) {
      logger.error(`[#165a] SchemaEntityService.getMarker() failed: ${error}`);
      return null;
    }
  }

  /**
   * Lookup by name (the `Entity.name` field — equivalent to the legacy
   * `Stereotype.id` for migration purposes). Searches schema-entities
   * only (the marker is excluded).
   */
  async findByName(name: string): Promise<Entity | null> {
    const all = await this.list();
    return all.find(e => e.name === name) || null;
  }

  /**
   * Lookup by uuid. Searches schema-entities only (the marker is
   * excluded by `list()`).
   */
  async findByUuid(uuid: string): Promise<Entity | null> {
    const all = await this.list();
    return all.find(e => e.uuid === uuid) || null;
  }
}

/**
 * Module singleton — used by `stereotypeService` and tests.
 */
export const schemaEntityService = new SchemaEntityService();
