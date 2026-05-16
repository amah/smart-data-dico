/**
 * stereotypeService.ts — rewritten for #165a / extended in #165b
 *
 * Returns the merged list of stereotypes — schema-entities loaded from
 * `.dico/schemas/` (via `schemaEntityService`) converted to the legacy
 * `Stereotype` shape (via `toLegacyStereotypeView`), PLUS legacy entries
 * read directly from `.dico/stereotypes.yaml`.
 *
 * Collision policy (#165a): if the same stereotype id (Entity.name vs
 * Stereotype.id) appears in both sources, the schema-entity wins and the
 * legacy entry is shadowed with a warning.
 *
 * Write-path routing (#165b):
 *   - When `preferSchemaEntityWrite()` returns true (legacy YAML is empty
 *     AND schema entities exist), new and updated stereotypes are written
 *     to `.dico/schemas/<slug>.entity.yaml`.
 *   - Otherwise, writes go to `.dico/stereotypes.yaml` (legacy code path).
 *
 * In the eshop sample post-#165b migration, `preferSchemaEntityWrite()`
 * returns true because stereotypes.yaml is emptied to `[]`.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as YAML from 'yaml';
import { Stereotype, StereotypeTarget, MetadataEntry } from '../models/EntitySchema.js';
import { logger } from '../utils/logger.js';
import { config } from '../kernel/config.js';
import type { MetadataValidationError } from './metadata/MetadataTypeRegistry.js';
import { metadataTypeRegistry } from './metadata/index.js';
import { schemaEntityService } from './schemaEntityService.js';
import { toLegacyStereotypeView, fromLegacyStereotypeView } from './schemaEntityView.js';
import { getSchemaPackagePath } from '../utils/fileOperations.js';
import { writeSchemaEntity, deleteSchemaEntity } from './schemaEntityWriter.js';

// Re-export the inverse for external use (migration script, tests)
export { fromLegacyStereotypeView };

const getStereotypesFile = () => path.join(config.dataDir, '.dico', 'stereotypes.yaml');

class StereotypeService {
  // ── Legacy loader (read-compat) ─────────────────────────────────────

  private readLegacyStereotypes(): Stereotype[] {
    if (!fs.existsSync(getStereotypesFile())) return [];
    const content = fs.readFileSync(getStereotypesFile(), 'utf8');
    return YAML.parse(content) || [];
  }

  private writeStereotypes(stereotypes: Stereotype[]): void {
    fs.writeFileSync(getStereotypesFile(), YAML.stringify(stereotypes), 'utf8');
  }

  // ── Merged-source read ──────────────────────────────────────────────

  /**
   * Returns the merged list of stereotypes — schema-entities from
   * `.dico/schemas/` (converted via `toLegacyStereotypeView`) PLUS
   * legacy entries from `.dico/stereotypes.yaml`.
   *
   * Schema-entities win on collision (same `Stereotype.id`, where the
   * schema-entity's `Entity.uuid` or `Entity.name` matches a legacy
   * stereotype id). The legacy entry is shadowed and a warning is
   * logged with both file paths so stewards can resolve the duplication.
   *
   * In #165a, `.dico/schemas/` is empty except for the bootstrap marker
   * (which is filtered out), so this method's return value is
   * observationally identical to current main.
   */
  async getAllStereotypes(appliesTo?: StereotypeTarget): Promise<Stereotype[]> {
    // Load schema-entities from .dico/schemas/ (new canonical source)
    const schemaEntities = await schemaEntityService.list();
    const fromSchemas = schemaEntities.map(toLegacyStereotypeView);

    // Build collision indexes. A collision occurs when a legacy stereotype's
    // id matches either:
    //   - a schema-entity's uuid (Stereotype.id = Entity.uuid after view)
    //   - a schema-entity's name (common case: legacy id 'pii' = schema name 'pii')
    //   - a schema-entity's display name (legacy.name matches schema.name)
    const schemaIds = new Set<string>(fromSchemas.map(s => s.id));
    const schemaNames = new Set<string>(fromSchemas.map(s => s.name));

    // Load legacy stereotypes from .dico/stereotypes.yaml
    const legacy = this.readLegacyStereotypes();

    const schemaPackagePath = getSchemaPackagePath();

    // Merge: schema-entities first, then non-colliding legacy entries
    const merged: Stereotype[] = [...fromSchemas];

    for (const leg of legacy) {
      // Collision when legacy.id matches a schema id/name, OR legacy.name matches a schema name.
      // The common case is legacy.id === schema.name (e.g. both are 'pii').
      const collision =
        schemaIds.has(leg.id) ||
        schemaNames.has(leg.id) ||
        schemaNames.has(leg.name);

      if (collision) {
        // Collision — schema-entity wins, legacy entry is shadowed
        logger.warn(
          `[#165a] Stereotype '${leg.id}' (name: '${leg.name}') exists in both ` +
          `${getStereotypesFile()} (legacy, shadowed) and ${schemaPackagePath} (schema-entity, wins). ` +
          `To suppress this warning, remove the legacy entry from ${getStereotypesFile()}.`,
        );
      } else {
        merged.push(leg);
      }
    }

    if (appliesTo) return merged.filter(s => s.appliesTo === appliesTo);
    return merged;
  }

  async getStereotype(id: string): Promise<Stereotype | null> {
    const all = await this.getAllStereotypes();
    return all.find(s => s.id === id) || null;
  }

  // ── Write-path routing (#165b) ──────────────────────────────────────

  /**
   * Route write operations: prefer schema-entity writes when the legacy
   * YAML is empty AND the schema package has user-authored entities.
   * Inverts the #165a write-conflict guard for projects that have migrated.
   *
   * Returns true → writes go to .dico/schemas/<slug>.entity.yaml
   * Returns false → writes go to .dico/stereotypes.yaml (legacy code path)
   *
   * In the eshop sample post-#165b migration: returns true.
   * In downstream projects without schemas/: returns false.
   */
  private async preferSchemaEntityWrite(): Promise<boolean> {
    const legacy = this.readLegacyStereotypes();
    if (legacy.length > 0) {
      return false;
    }
    const schemaEntities = await schemaEntityService.list();
    return schemaEntities.length > 0;
  }

  // ── Write operations ─────────────────────────────────────────────────

  /**
   * Create a stereotype.
   *
   * #165b routing:
   *   - When preferSchemaEntityWrite() is true: converts the stereotype
   *     to a schema-entity and writes to .dico/schemas/<slug>.entity.yaml.
   *   - Otherwise: writes to .dico/stereotypes.yaml (legacy path).
   *
   * If `id` matches an existing schema-entity (in schema-entity write mode)
   * or an existing legacy entry, the operation fails with a duplicate error.
   */
  async createStereotype(data: Stereotype): Promise<{ success: boolean; stereotype?: Stereotype; errors?: string[] }> {
    if (!data.id || !data.name || !data.appliesTo) {
      return { success: false, errors: ['id, name, and appliesTo are required'] };
    }
    if (!['package', 'entity', 'attribute', 'model', 'relationship'].includes(data.appliesTo)) {
      return { success: false, errors: ['appliesTo must be one of: package, entity, attribute, model, relationship'] };
    }

    const useSchemaPath = await this.preferSchemaEntityWrite();

    if (useSchemaPath) {
      // Schema-entity write path (#165b)
      logger.info(`[#165b] createStereotype: routing to schema-entity write path for '${data.id}'`);
      const existingByName = await schemaEntityService.findByName(data.id);
      if (existingByName) {
        return { success: false, errors: [`Stereotype with id '${data.id}' already exists as a schema-entity`] };
      }

      const stereotype: Stereotype = {
        id: data.id,
        name: data.name,
        description: data.description,
        domain: data.domain,
        appliesTo: data.appliesTo,
        metadataDefinitions: data.metadataDefinitions || [],
      };

      const entity = fromLegacyStereotypeView(stereotype);
      await writeSchemaEntity(entity);
      return { success: true, stereotype };
    }

    // Legacy write path (#165a / original)
    // Write-conflict guard: refuse if id matches an existing schema-entity
    const existingByName = await schemaEntityService.findByName(data.id);
    const existingByUuid = await schemaEntityService.findByUuid(data.id);
    if (existingByName || existingByUuid) {
      const schemaPackagePath = getSchemaPackagePath();
      return {
        success: false,
        errors: [
          `Stereotype id "${data.id}" is defined as a schema-entity at ${schemaPackagePath}; ` +
          `edit that file or use the #165b write path to create schema-entities.`,
        ],
      };
    }

    const all = this.readLegacyStereotypes();
    if (all.find(s => s.id === data.id)) {
      return { success: false, errors: [`Stereotype with id '${data.id}' already exists`] };
    }

    const stereotype: Stereotype = {
      id: data.id,
      name: data.name,
      description: data.description,
      domain: data.domain,
      appliesTo: data.appliesTo,
      metadataDefinitions: data.metadataDefinitions || [],
    };

    all.push(stereotype);
    this.writeStereotypes(all);
    return { success: true, stereotype };
  }

  async updateStereotype(id: string, data: Partial<Stereotype>): Promise<{ success: boolean; stereotype?: Stereotype; errors?: string[] }> {
    const existingSchemaEntity = await schemaEntityService.findByName(id);

    if (existingSchemaEntity) {
      // Schema-entity update path (#165b)
      logger.info(`[#165b] updateStereotype: routing to schema-entity write path for '${id}'`);
      const currentStereotype = toLegacyStereotypeView(existingSchemaEntity);
      const updated: Stereotype = {
        id: currentStereotype.id,
        name: data.name ?? currentStereotype.name,
        description: data.description ?? currentStereotype.description,
        domain: data.domain ?? currentStereotype.domain,
        appliesTo: data.appliesTo ?? currentStereotype.appliesTo,
        metadataDefinitions: data.metadataDefinitions ?? currentStereotype.metadataDefinitions,
      };
      const entity = fromLegacyStereotypeView(updated);
      // Preserve the original uuid (not regenerated) for stable file references
      entity.uuid = existingSchemaEntity.uuid;
      await writeSchemaEntity(entity);
      return { success: true, stereotype: updated };
    }

    // Legacy write path
    const all = this.readLegacyStereotypes();
    const index = all.findIndex(s => s.id === id);
    if (index === -1) return { success: false, errors: ['Stereotype not found'] };

    all[index] = {
      ...all[index],
      name: data.name ?? all[index].name,
      description: data.description ?? all[index].description,
      domain: data.domain ?? all[index].domain,
      appliesTo: data.appliesTo ?? all[index].appliesTo,
      metadataDefinitions: data.metadataDefinitions ?? all[index].metadataDefinitions,
    };

    this.writeStereotypes(all);
    return { success: true, stereotype: all[index] };
  }

  async deleteStereotype(id: string): Promise<{ success: boolean; errors?: string[] }> {
    const existingSchemaEntity = await schemaEntityService.findByName(id);

    if (existingSchemaEntity) {
      // Schema-entity delete path (#165b)
      logger.info(`[#165b] deleteStereotype: routing to schema-entity delete path for '${id}'`);
      const deleted = await deleteSchemaEntity(id);
      if (!deleted) {
        return { success: false, errors: [`Schema-entity file for '${id}' not found`] };
      }
      return { success: true };
    }

    // Legacy delete path
    const all = this.readLegacyStereotypes();
    const filtered = all.filter(s => s.id !== id);
    if (filtered.length === all.length) return { success: false, errors: ['Stereotype not found'] };
    this.writeStereotypes(filtered);
    return { success: true };
  }

  /**
   * Validate metadata against a stereotype using the registry.
   * Returns path-aware errors with full nesting support.
   */
  validateMetadata(stereotype: Stereotype, metadata: MetadataEntry[] = []): MetadataValidationError[] {
    return metadataTypeRegistry.validateBlock(metadata, stereotype.metadataDefinitions, stereotype.name);
  }

  /**
   * @deprecated Use `validateMetadata` which now returns `MetadataValidationError[]`.
   * Shim preserved for callers that expect `string[]` during the migration window.
   */
  validateMetadataLegacy(stereotype: Stereotype, metadata: MetadataEntry[] = []): string[] {
    return this.validateMetadata(stereotype, metadata).map(
      (e) => `Required metadata '${e.path}' is missing (stereotype: ${stereotype.name})`,
    );
  }
}

export const stereotypeService = new StereotypeService();
