/**
 * schemaEntityWriter.ts — #165b
 *
 * Pure file-write helper for schema-entities under `.dico/schemas/`.
 * Isolated from stereotypeService for testability — no side-effects
 * beyond writing/deleting files in the schema package directory.
 *
 * The multi-kind YAML format (#106) is used:
 *   entities:
 *     - <serialized entity>
 *
 * Slug derivation: `entity.name` is already a slug by convention.
 * File names are `<slug>.entity.yaml` — consistent with the existing
 * bootstrap marker convention.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as YAML from 'yaml';
import type { Entity } from '../models/EntitySchema.js';
import { getSchemaPackagePath } from '../utils/fileOperations.js';
import { logger } from '../utils/logger.js';

/**
 * Write a schema-entity to `.dico/schemas/<slug>.entity.yaml`.
 *
 * Slug derivation: `entity.name` (already a slug by convention).
 *
 * Multi-kind YAML format (#106):
 *   entities:
 *     - <serialized entity>
 *
 * Throws on collision: if a file with that slug already exists AND its
 * entity has a different uuid, the call fails with a clear error. Callers
 * (stereotypeService.createStereotype) check existence first and call
 * delete+write for updates.
 */
export async function writeSchemaEntity(entity: Entity): Promise<void> {
  const schemaDir = getSchemaPackagePath();

  // Ensure the schemas directory exists
  if (!fs.existsSync(schemaDir)) {
    fs.mkdirSync(schemaDir, { recursive: true });
    logger.info(`[#165b] Created schema package directory at ${schemaDir}`);
  }

  const slug = entity.name;
  const filePath = path.join(schemaDir, `${slug}.entity.yaml`);

  // Collision check: if the file already exists but has a different uuid, fail
  if (fs.existsSync(filePath)) {
    try {
      const existing = YAML.parse(fs.readFileSync(filePath, 'utf8'));
      const existingEntities: Entity[] = Array.isArray(existing?.entities) ? existing.entities : [];
      const existingEntity = existingEntities.find((e: Entity) => e.name === slug);
      if (existingEntity && existingEntity.uuid !== entity.uuid) {
        throw new Error(
          `[#165b] writeSchemaEntity: collision — file '${filePath}' contains entity uuid '${existingEntity.uuid}' ` +
          `but write request uses uuid '${entity.uuid}'. Delete the file first or use the same uuid.`,
        );
      }
    } catch (e) {
      if (e instanceof Error && e.message.includes('[#165b] writeSchemaEntity: collision')) throw e;
      // If we can't read the existing file, log and overwrite
      logger.warn(`[#165b] writeSchemaEntity: could not read existing file ${filePath}: ${e}. Overwriting.`);
    }
  }

  // Serialize the entity in multi-kind YAML format
  const content = { entities: [entity] };
  fs.writeFileSync(filePath, YAML.stringify(content), 'utf8');
  logger.info(`[#165b] writeSchemaEntity: wrote schema-entity '${slug}' to ${filePath}`);
}

/**
 * Delete the schema-entity file for a given slug.
 * Returns `false` if the file does not exist.
 * Used by `stereotypeService.deleteStereotype` when the id matches a
 * schema-entity.
 */
export async function deleteSchemaEntity(slug: string): Promise<boolean> {
  const schemaDir = getSchemaPackagePath();
  const filePath = path.join(schemaDir, `${slug}.entity.yaml`);

  if (!fs.existsSync(filePath)) {
    return false;
  }

  fs.unlinkSync(filePath);
  logger.info(`[#165b] deleteSchemaEntity: deleted schema-entity file '${filePath}'`);
  return true;
}
