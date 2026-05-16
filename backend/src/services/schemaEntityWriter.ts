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
 *
 * Storage: migrated to `IStorageBackend` (#167 slice 5b). All I/O goes
 * through the storage backend on the `dictionaries` workspace; the
 * absolute on-disk path returned by `getSchemaPackagePath()` is used
 * ONLY for human-readable log lines.
 */
import * as YAML from 'yaml';
import type { Entity } from '../models/EntitySchema.js';
import { getSchemaPackagePath } from '../utils/fileOperations.js';
import { logger } from '../utils/logger.js';
import { storageRegistry } from '../storage/contract/StorageBackendToken.js';
import type { IStorageBackend } from '../storage/contract/IStorageBackend.js';
import { wsId, pathOf, type WorkspaceId, type Path, type Stat } from '../storage/contract/types.js';

const WS: WorkspaceId = wsId('dictionaries');
const SCHEMA_DIR: Path = pathOf('.dico/schemas');

function getStorage(): IStorageBackend { return storageRegistry.getBackend(); }

async function statOrNull(p: Path): Promise<Stat | null> {
  try { return await getStorage().stat(WS, p); }
  catch (e) { if ((e as { code?: string }).code === 'not-found') return null; throw e; }
}

async function readOrNull(p: Path): Promise<string | null> {
  try { return await getStorage().read(WS, p); }
  catch (e) { if ((e as { code?: string }).code === 'not-found') return null; throw e; }
}

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
  const slug = entity.name;
  const filePath: Path = pathOf(`.dico/schemas/${slug}.entity.yaml`);

  // Ensure the schemas directory exists (idempotent — mkdir is a no-op if present)
  if (await statOrNull(SCHEMA_DIR) === null) {
    await getStorage().mkdir(WS, SCHEMA_DIR, true);
    logger.info(`[#165b] Created schema package directory at ${getSchemaPackagePath()}`);
  }

  // Collision check: if the file already exists but has a different uuid, fail.
  // One read replaces existsSync+readFileSync; if file is missing readOrNull returns
  // null and we skip the entire collision block.
  const existingContent = await readOrNull(filePath);
  if (existingContent !== null) {
    try {
      const existing = YAML.parse(existingContent);
      const existingEntities: Entity[] = Array.isArray(existing?.entities) ? existing.entities : [];
      const existingEntity = existingEntities.find((e: Entity) => e.name === slug);
      if (existingEntity && existingEntity.uuid !== entity.uuid) {
        throw new Error(
          `[#165b] writeSchemaEntity: collision — file '${getSchemaPackagePath()}/${slug}.entity.yaml' ` +
          `contains entity uuid '${existingEntity.uuid}' but write request uses uuid '${entity.uuid}'. ` +
          `Delete the file first or use the same uuid.`,
        );
      }
    } catch (e) {
      if (e instanceof Error && e.message.includes('[#165b] writeSchemaEntity: collision')) throw e;
      // If we can't parse the existing file, log and overwrite
      logger.warn(`[#165b] writeSchemaEntity: could not parse existing file ${String(filePath)}: ${e}. Overwriting.`);
    }
  }

  // Serialize the entity in multi-kind YAML format (#106). Byte-identical to
  // the pre-migration output — only the I/O channel changed.
  const content = { entities: [entity] };
  await getStorage().write(WS, filePath, YAML.stringify(content), { createParents: true });
  logger.info(`[#165b] writeSchemaEntity: wrote schema-entity '${slug}' to ${getSchemaPackagePath()}/${slug}.entity.yaml`);
}

/**
 * Delete the schema-entity file for a given slug.
 * Returns `false` if the file does not exist.
 * Used by `stereotypeService.deleteStereotype` when the id matches a
 * schema-entity.
 */
export async function deleteSchemaEntity(slug: string): Promise<boolean> {
  const filePath: Path = pathOf(`.dico/schemas/${slug}.entity.yaml`);

  try {
    await getStorage().delete(WS, filePath);
    logger.info(`[#165b] deleteSchemaEntity: deleted schema-entity file '${getSchemaPackagePath()}/${slug}.entity.yaml'`);
    return true;
  } catch (e) {
    if ((e as { code?: string }).code === 'not-found') return false;
    throw e;
  }
}
