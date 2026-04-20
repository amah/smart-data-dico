import fs from 'fs';
import path from 'path';
import YAML from 'yaml';
import { logger } from './logger.js';
import { Entity, Relationship, Perspective, ReviewComment, validateEntity } from '../models/EntitySchema.js';
import { Rule } from '../models/Rule.js';
import { Dictionary } from '../models/Dictionary.js';
import { generateEntityFilename, sanitizeFsName } from './uuid.js';
import { config } from '../kernel/config.js';

// Base directory for data dictionaries
/** Always reads current config.dataDir so project switching (#95) works. */
const getDataDir = () => config.dataDir;

/**
 * Reserved top-level directory names that must not be treated as packages (#105).
 * `.dico/` holds project-level system files; `perspectives/` is the global perspective
 * folder (obsoleted by #106 but still read here); `.git/` and `node_modules/` are
 * obvious filesystem noise.
 */
const RESERVED_DIRS = new Set(['.dico', '.git', 'node_modules', 'perspectives']);

/**
 * Predicate: is a file an entity YAML? Post-#105 canonical form is
 * `<Name>.entity.yaml`. Dedicated filenames (`package.yaml`, `metadata.yaml`,
 * `relationships.yaml`, `rules.yaml`, `*.comments.yaml`, `*.rules.yaml`) are
 * excluded.
 */
function isEntityFile(file: string): boolean {
  return file.endsWith('.entity.yaml');
}

/**
 * Validation field names recognized by `AttributeValidation` (#85). Used by
 * the legacy normalizer below to lift flat validation fields off the
 * attribute root into the canonical nested `validation` object.
 */
const VALIDATION_FIELD_NAMES = [
  'minLength', 'maxLength', 'pattern', 'format',
  'minimum', 'maximum', 'precision', 'scale',
  'enumValues',
] as const;

/**
 * Normalize legacy entity shapes on read.
 *
 * Three pre-existing legacy formats need normalizing so the rest of the
 * system can assume canonical shapes:
 *
 *  1. Attribute metadata stored as a plain object instead of MetadataEntry[]
 *     (e.g. `metadata: {isPrimaryKey: true}` → `metadata: [{name: ..., value: ...}]`)
 *
 *  2. Validation fields stored flat on the attribute (e.g. `format: email`
 *     directly on the attribute) → moved into `attr.validation.format`.
 *
 *  3. Validation fields stored nested under the legacy name `constraints`
 *     (#85: renamed to `validation`) → moved into `attr.validation`. This
 *     keeps every entity YAML on disk readable regardless of which era it
 *     was written in, while the canonical in-memory shape is always
 *     `attr.validation`.
 *
 * The legacy `attribute.constraints` name is retired in #85 because the
 * word "constraint" is now reserved for *physical* DB constraints (unique,
 * check, foreignKey, …) stored under `entity.metadata['physical.constraints']`.
 * Three concepts, three homes — see #85 for the rationale.
 *
 * **Non-mutating** (#77): the input entity is left untouched. We deep-clone
 * the entity first via JSON round-trip (Entity is plain JSON-serializable
 * data so this is safe and cheap relative to the YAML parse that produced
 * it). This guarantees that an incidental write of the same entity object
 * back to disk won't persist the legacy→canonical normalization as a
 * spurious diff.
 */
export function normalizeEntityMetadata(entity: Entity | null): Entity | null {
  if (!entity) return entity;
  // Deep clone first so the on-disk shape is preserved if the input is
  // later written back (e.g. via servicesApi.updateEntity from an inline edit).
  const cloned: Entity = JSON.parse(JSON.stringify(entity));
  if (cloned.attributes) {
    for (const attr of cloned.attributes) {
      // 1. Metadata: object → MetadataEntry[]
      if (attr.metadata && !Array.isArray(attr.metadata)) {
        attr.metadata = Object.entries(attr.metadata as any).map(
          ([name, value]) => ({ name, value: value as any }),
        );
      }
      // 2. Legacy nested-as-`constraints` → canonical `validation` (#85)
      const legacyConstraints = (attr as any).constraints;
      if (legacyConstraints && typeof legacyConstraints === 'object') {
        attr.validation = { ...(attr.validation || {}), ...legacyConstraints };
        delete (attr as any).constraints;
      }
      // 3. Legacy flat validation fields → canonical nested `validation`
      const flat: Record<string, any> = {};
      let hasFlat = false;
      for (const field of VALIDATION_FIELD_NAMES) {
        if ((attr as any)[field] !== undefined) {
          flat[field] = (attr as any)[field];
          delete (attr as any)[field];
          hasFlat = true;
        }
      }
      if (hasFlat) {
        attr.validation = { ...(attr.validation || {}), ...flat };
      }
    }
  }
  if (cloned.metadata && !Array.isArray(cloned.metadata)) {
    cloned.metadata = Object.entries(cloned.metadata as any).map(
      ([name, value]) => ({ name, value: value as any }),
    );
  }
  return cloned;
}

// Lazy-loaded git service from @hamak/ui-remote-git-fs-backend
let gitServiceInstance: any = null;

async function getGitService() {
  if (gitServiceInstance) return gitServiceInstance;
  try {
    const gitModule = await import('@hamak/ui-remote-git-fs-backend');
    const workspaceRoots = new Map<string, string>([
      ['dictionaries', getDataDir()],
    ]);
    gitServiceInstance = gitModule.createGitService(workspaceRoots);
    return gitServiceInstance;
  } catch {
    logger.warn('Git service not available');
    return null;
  }
}

/**
 * Ensures the data dictionaries directory structure exists.
 * Layout (#104, #105): system files under `.dico/`; packages are top-level
 * folders created on demand by `ensurePackageDirectoryStructure`.
 */
export async function ensureDirectoryStructure(): Promise<void> {
  const baseDir = getDataDir();

  if (!fs.existsSync(baseDir)) {
    fs.mkdirSync(baseDir, { recursive: true });
    logger.info(`Created base directory: ${baseDir}`);
  }

  const dicoDir = path.join(baseDir, '.dico');
  if (!fs.existsSync(dicoDir)) {
    fs.mkdirSync(dicoDir, { recursive: true });
    logger.info(`Created .dico/ system directory: ${dicoDir}`);
  }
}

/**
 * Ensure a named package folder exists with a `package.yaml` marker (#105).
 */
export function ensurePackageDirectoryStructure(packageName: string): void {
  const packageDir = getPackagePath(packageName);
  if (!fs.existsSync(packageDir)) {
    fs.mkdirSync(packageDir, { recursive: true });
    logger.info(`Created package directory: ${packageDir}`);
  }
  const markerPath = path.join(packageDir, 'package.yaml');
  if (!fs.existsSync(markerPath)) {
    fs.writeFileSync(markerPath, YAML.stringify({ name: packageName }), 'utf8');
  }
}

/**
 * Reads an entity from a YAML file at `<package>/<Name>.entity.yaml` (#105).
 * Falls back to a content scan for casing / sanitization edge cases.
 */
export async function readEntityFile(packageName: string, entityName: string): Promise<Entity | null> {
  try {
    const packagePath = path.join(getDataDir(), packageName);
    if (!fs.existsSync(packagePath)) return null;

    const canonicalPath = path.join(packagePath, `${sanitizeFsName(entityName)}.entity.yaml`);
    if (fs.existsSync(canonicalPath)) {
      const content = fs.readFileSync(canonicalPath, 'utf8');
      return normalizeEntityMetadata(YAML.parse(content) as Entity);
    }

    // Fallback: match by `entity.name` (e.g. renames awaiting a file move)
    const files = fs.readdirSync(packagePath).filter(isEntityFile);
    for (const file of files) {
      try {
        const content = fs.readFileSync(path.join(packagePath, file), 'utf8');
        const entity = YAML.parse(content) as Entity;
        if (entity?.name === entityName) return normalizeEntityMetadata(entity);
      } catch {
        continue;
      }
    }
    return null;
  } catch (error) {
    logger.error(`Error reading entity file: ${error}`);
    return null;
  }
}

/**
 * Writes an entity as `<package>/<Name>.entity.yaml` (#105). Ensures the
 * package folder + `package.yaml` marker exist. If an existing file owns
 * this entity (same UUID) under a different name, it's removed first so
 * renames don't leave orphan files.
 */
export async function writeEntityFile(entity: Entity, packageName?: string): Promise<boolean> {
  try {
    const validation = validateEntity(entity);
    if (!validation.valid) {
      logger.error(`Invalid entity: ${validation.errors.join(', ')}`);
      return false;
    }
    if (!packageName) {
      logger.error('Package name is required to write entity file');
      return false;
    }

    ensurePackageDirectoryStructure(packageName);
    const packageDir = getPackagePath(packageName);

    const newFilename = generateEntityFilename(entity.uuid, entity.name);

    // Remove any prior file owning this UUID under a different name (rename case)
    for (const file of fs.readdirSync(packageDir).filter(isEntityFile)) {
      if (file === newFilename) continue;
      try {
        const existing = YAML.parse(fs.readFileSync(path.join(packageDir, file), 'utf8')) as Entity;
        if (existing?.uuid === entity.uuid) {
          fs.unlinkSync(path.join(packageDir, file));
          logger.info(`Removed prior entity file on rename: ${file}`);
        }
      } catch {
        continue;
      }
    }

    const filePath = path.join(packageDir, newFilename);
    fs.writeFileSync(filePath, YAML.stringify(entity), 'utf8');
    logger.info(`Entity written to file: ${filePath}`);

    try {
      await commitChanges(filePath, `Updated entity: ${entity.name} (${entity.uuid})`);
    } catch (gitError) {
      logger.warn(`Git operations failed: ${gitError}`);
    }

    return true;
  } catch (error) {
    logger.error(`Error writing entity file: ${error}`);
    return false;
  }
}

/**
 * Reads relationships from a package's relationships.yaml file
 */
export async function readRelationshipsFile(packagePath: string): Promise<Relationship[]> {
  try {
    const filePath = path.join(packagePath, 'relationships.yaml');
    if (!fs.existsSync(filePath)) {
      return [];
    }

    const content = fs.readFileSync(filePath, 'utf8');
    const parsed = YAML.parse(content);

    if (!parsed || !Array.isArray(parsed)) {
      return [];
    }

    return parsed as Relationship[];
  } catch (error) {
    logger.error(`Error reading relationships file: ${error}`);
    return [];
  }
}

/**
 * Writes relationships to a package's relationships.yaml file
 */
export async function writeRelationshipsFile(packagePath: string, relationships: Relationship[]): Promise<boolean> {
  try {
    if (!fs.existsSync(packagePath)) {
      fs.mkdirSync(packagePath, { recursive: true });
    }

    const filePath = path.join(packagePath, 'relationships.yaml');
    const yamlContent = YAML.stringify(relationships);

    fs.writeFileSync(filePath, yamlContent, 'utf8');
    logger.info(`Relationships written to file: ${filePath}`);

    try {
      await commitChanges(filePath, `Updated relationships in ${path.basename(packagePath)}`);
    } catch (gitError) {
      logger.warn(`Git operations failed: ${gitError}`);
    }

    return true;
  } catch (error) {
    logger.error(`Error writing relationships file: ${error}`);
    return false;
  }
}

/**
 * Gets the full path for a package directory (#105 — packages are
 * top-level folders of the project root).
 */
export function getPackagePath(packageName: string): string {
  return path.join(getDataDir(), packageName);
}

/**
 * List all packages — top-level folders containing `package.yaml`.
 */
export async function listPackages(): Promise<string[]> {
  const baseDir = getDataDir();
  if (!fs.existsSync(baseDir)) return [];
  return fs.readdirSync(baseDir).filter(name => {
    if (RESERVED_DIRS.has(name)) return false;
    const p = path.join(baseDir, name);
    try {
      if (!fs.statSync(p).isDirectory()) return false;
    } catch {
      return false;
    }
    return fs.existsSync(path.join(p, 'package.yaml'));
  });
}

/**
 * Lists all entities across all packages (#105 — flat package layout).
 */
export async function listAllEntities(): Promise<Array<{ microservice: string; name: string; path: string }>> {
  const entities: Array<{ microservice: string; name: string; path: string }> = [];
  const packages = await listPackages();
  for (const microservice of packages) {
    const packagePath = getPackagePath(microservice);
    const files = fs.readdirSync(packagePath).filter(isEntityFile);
    for (const file of files) {
      const name = file.replace(/\.entity\.yaml$/, '');
      entities.push({ microservice, name, path: path.join(packagePath, file) });
    }
  }
  return entities;
}

/**
 * Lists all entity names in a specific package.
 */
export async function listMicroserviceEntities(microservice: string): Promise<string[]> {
  try {
    const packagePath = getPackagePath(microservice);
    if (!fs.existsSync(packagePath)) return [];
    return fs.readdirSync(packagePath)
      .filter(isEntityFile)
      .map(file => file.replace(/\.entity\.yaml$/, ''));
  } catch (error) {
    logger.error(`Error listing package entities: ${error}`);
    return [];
  }
}

/**
 * @deprecated Use `listPackages()` — kept as an alias during the #105
 * cutover for existing callers that use "microservice" vocabulary.
 */
export async function listMicroservices(): Promise<string[]> {
  return listPackages();
}

/**
 * Commits changes to git via @hamak/ui-remote-git-fs-backend
 */
async function commitChanges(filePath: string, message: string): Promise<void> {
  if (!config.git.autoCommit) return;

  try {
    const gitService = await getGitService();
    if (!gitService) {
      logger.warn('Git service not available, skipping commit');
      return;
    }

    await gitService.commit('dictionaries', '.', { message, paths: [filePath] });
    logger.info(`Changes committed: ${message}`);
  } catch (error) {
    logger.error(`Git error: ${error}`);
    throw error;
  }
}

/**
 * Deletes an entity file (`<Name>.entity.yaml`). Falls back to scanning
 * file contents for the case of name-to-filename drift.
 */
export async function deleteEntityFile(microservice: string, entityName: string): Promise<boolean> {
  try {
    const packagePath = getPackagePath(microservice);
    if (!fs.existsSync(packagePath)) {
      logger.warn(`Package directory not found: ${packagePath}`);
      return false;
    }

    let filePath: string | null = null;
    const canonical = path.join(packagePath, `${sanitizeFsName(entityName)}.entity.yaml`);
    if (fs.existsSync(canonical)) {
      filePath = canonical;
    } else {
      for (const file of fs.readdirSync(packagePath).filter(isEntityFile)) {
        const fullPath = path.join(packagePath, file);
        try {
          const entity = YAML.parse(fs.readFileSync(fullPath, 'utf8')) as Entity;
          if (entity?.name === entityName) { filePath = fullPath; break; }
        } catch { continue; }
      }
    }

    if (!filePath) {
      logger.warn(`Entity file not found for deletion: ${microservice}.${entityName}`);
      return false;
    }

    fs.unlinkSync(filePath);
    logger.info(`Entity file deleted: ${filePath}`);

    try {
      await commitChanges(filePath, `Deleted entity: ${entityName}`);
    } catch (gitError) {
      logger.warn(`Git operations failed: ${gitError}`);
    }

    return true;
  } catch (error) {
    logger.error(`Error deleting entity file: ${error}`);
    return false;
  }
}

/**
 * Writes dictionary metadata to a YAML file
 */
export async function writeDictionaryMetadata(dictionary: Dictionary): Promise<boolean> {
  try {
    const dictionaryDir = path.join(getDataDir(), dictionary.id);

    if (!fs.existsSync(dictionaryDir)) {
      fs.mkdirSync(dictionaryDir, { recursive: true });
      logger.info(`Created dictionary directory: ${dictionaryDir}`);
    }

    const filePath = path.join(dictionaryDir, 'metadata.yaml');

    const metadata = {
      id: dictionary.id,
      name: dictionary.name,
      description: dictionary.description,
      metadataDefinitions: dictionary.metadataDefinitions,
      createdAt: dictionary.createdAt,
      updatedAt: dictionary.updatedAt
    };

    const yamlContent = YAML.stringify(metadata);

    fs.writeFileSync(filePath, yamlContent, 'utf8');
    logger.info(`Dictionary metadata written to file: ${filePath}`);

    try {
      await commitChanges(filePath, `Updated dictionary metadata: ${dictionary.name}`);
    } catch (gitError) {
      logger.warn(`Git operations failed: ${gitError}`);
    }

    return true;
  } catch (error) {
    logger.error(`Error writing dictionary metadata: ${error}`);
    return false;
  }
}

/**
 * Lists all available dictionaries
 */
export async function listAllDictionaries(): Promise<string[]> {
  try {
    const baseDir = getDataDir();
    const dictionaries: string[] = [];

    if (!fs.existsSync(baseDir)) {
      return [];
    }

    // Packages at the project root (#105)
    dictionaries.push(...await listPackages());

    const items = fs.readdirSync(baseDir);
    for (const item of items) {
      if (RESERVED_DIRS.has(item)) continue;
      if (dictionaries.includes(item)) continue;
      const itemPath = path.join(baseDir, item);

      if (fs.statSync(itemPath).isDirectory()) {
        {
          const metadataPath = path.join(itemPath, 'metadata.yaml');
          if (fs.existsSync(metadataPath)) {
            dictionaries.push(item);
          }
        }
      }
    }

    return dictionaries;
  } catch (error) {
    logger.error(`Error listing all dictionaries: ${error}`);
    return [];
  }
}

// --- Perspective file operations ---

const getPerspectivesDir = () => path.join(getDataDir(), 'perspectives');

export async function listPerspectives(): Promise<Perspective[]> {
  try {
    if (!fs.existsSync(getPerspectivesDir())) return [];
    const files = fs.readdirSync(getPerspectivesDir()).filter(f => f.endsWith('.yaml'));
    return files.map(f => {
      const content = fs.readFileSync(path.join(getPerspectivesDir(), f), 'utf8');
      return YAML.parse(content) as Perspective;
    }).filter(Boolean);
  } catch (error) {
    logger.error(`Error listing perspectives: ${error}`);
    return [];
  }
}

export async function readPerspectiveFile(uuid: string): Promise<Perspective | null> {
  try {
    // First try direct filename match
    const directPath = path.join(getPerspectivesDir(), `${uuid}.yaml`);
    if (fs.existsSync(directPath)) {
      const content = fs.readFileSync(directPath, 'utf8');
      return YAML.parse(content) as Perspective;
    }
    // Fall back to scanning all files for matching uuid field
    if (!fs.existsSync(getPerspectivesDir())) return null;
    const files = fs.readdirSync(getPerspectivesDir()).filter(f => f.endsWith('.yaml'));
    for (const f of files) {
      const content = fs.readFileSync(path.join(getPerspectivesDir(), f), 'utf8');
      const perspective = YAML.parse(content) as Perspective;
      if (perspective?.uuid === uuid) return perspective;
    }
    return null;
  } catch (error) {
    logger.error(`Error reading perspective ${uuid}: ${error}`);
    return null;
  }
}

export async function writePerspectiveFile(perspective: Perspective): Promise<boolean> {
  try {
    if (!fs.existsSync(getPerspectivesDir())) {
      fs.mkdirSync(getPerspectivesDir(), { recursive: true });
    }
    const filePath = path.join(getPerspectivesDir(), `${perspective.uuid}.yaml`);
    fs.writeFileSync(filePath, YAML.stringify(perspective), 'utf8');
    return true;
  } catch (error) {
    logger.error(`Error writing perspective: ${error}`);
    return false;
  }
}

export async function deletePerspectiveFile(uuid: string): Promise<boolean> {
  try {
    // Try direct filename match first, then scan by uuid field
    const directPath = path.join(getPerspectivesDir(), `${uuid}.yaml`);
    if (fs.existsSync(directPath)) {
      fs.unlinkSync(directPath);
      return true;
    }
    if (!fs.existsSync(getPerspectivesDir())) return false;
    const files = fs.readdirSync(getPerspectivesDir()).filter(f => f.endsWith('.yaml'));
    for (const f of files) {
      const content = fs.readFileSync(path.join(getPerspectivesDir(), f), 'utf8');
      const perspective = YAML.parse(content) as Perspective;
      if (perspective?.uuid === uuid) {
        fs.unlinkSync(path.join(getPerspectivesDir(), f));
        return true;
      }
    }
    return false;
  } catch (error) {
    logger.error(`Error deleting perspective ${uuid}: ${error}`);
    return false;
  }
}

/**
 * Collects all relationships from all packages for cross-service BFS traversal.
 */
export async function getAllRelationships(): Promise<{ packageName: string; relationships: Relationship[] }[]> {
  const result: { packageName: string; relationships: Relationship[] }[] = [];
  try {
    const microservices = await listMicroservices();
    for (const ms of microservices) {
      const pkgPath = path.join(getDataDir(), ms);
      const rels = await readRelationshipsFile(pkgPath);
      if (rels.length > 0) {
        result.push({ packageName: ms, relationships: rels });
      }
    }
  } catch (error) {
    logger.error(`Error collecting all relationships: ${error}`);
  }
  return result;
}

// --- Review comment file operations ---

export async function readComments(service: string, entityUuid: string): Promise<ReviewComment[]> {
  try {
    const filePath = path.join(getDataDir(), service, `${entityUuid}.comments.yaml`);
    if (!fs.existsSync(filePath)) return [];
    const content = fs.readFileSync(filePath, 'utf8');
    return YAML.parse(content) || [];
  } catch (error) {
    logger.error(`Error reading comments: ${error}`);
    return [];
  }
}

export async function writeComments(service: string, entityUuid: string, comments: ReviewComment[]): Promise<boolean> {
  try {
    const filePath = path.join(getDataDir(), service, `${entityUuid}.comments.yaml`);
    fs.writeFileSync(filePath, YAML.stringify(comments), 'utf8');
    return true;
  } catch (error) {
    logger.error(`Error writing comments: ${error}`);
    return false;
  }
}

// --- Rule file operations (#74) ---
//
// Three storage locations:
//   1. Entity-sidecar: data-dictionaries/{svc}/{entityUuid}.rules.yaml
//   2. Package:        data-dictionaries/{svc}/rules.yaml
//   3. Perspective:    embedded in data-dictionaries/perspectives/{uuid}.yaml under a `rules` array

/** Read entity-sidecar rules for a single entity. */
export async function readEntityRules(service: string, entityUuid: string): Promise<Rule[]> {
  try {
    const filePath = path.join(getDataDir(), service, `${entityUuid}.rules.yaml`);
    if (!fs.existsSync(filePath)) return [];
    const content = fs.readFileSync(filePath, 'utf8');
    return YAML.parse(content) || [];
  } catch (error) {
    logger.error(`Error reading entity rules: ${error}`);
    return [];
  }
}

/** Write entity-sidecar rules for a single entity. */
export async function writeEntityRules(service: string, entityUuid: string, rules: Rule[]): Promise<boolean> {
  try {
    const filePath = path.join(getDataDir(), service, `${entityUuid}.rules.yaml`);
    if (rules.length === 0) {
      // Delete the sidecar file when there are no rules left, to keep the tree clean
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      return true;
    }
    fs.writeFileSync(filePath, YAML.stringify(rules), 'utf8');
    return true;
  } catch (error) {
    logger.error(`Error writing entity rules: ${error}`);
    return false;
  }
}

/** Read package-scoped rules from a single package's rules.yaml. */
export async function readPackageRules(service: string): Promise<Rule[]> {
  try {
    const filePath = path.join(getDataDir(), service, 'rules.yaml');
    if (!fs.existsSync(filePath)) return [];
    const content = fs.readFileSync(filePath, 'utf8');
    return YAML.parse(content) || [];
  } catch (error) {
    logger.error(`Error reading package rules: ${error}`);
    return [];
  }
}

/** Write package-scoped rules. */
export async function writePackageRules(service: string, rules: Rule[]): Promise<boolean> {
  try {
    const filePath = path.join(getDataDir(), service, 'rules.yaml');
    if (rules.length === 0) {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      return true;
    }
    fs.writeFileSync(filePath, YAML.stringify(rules), 'utf8');
    return true;
  } catch (error) {
    logger.error(`Error writing package rules: ${error}`);
    return false;
  }
}

/**
 * List all entity-sidecar rule files across all packages.
 * Returns tuples of (service, entityUuid) so callers can read each.
 */
export async function listAllEntityRuleFiles(): Promise<Array<{ service: string; entityUuid: string }>> {
  const result: Array<{ service: string; entityUuid: string }> = [];
  try {
    const packages = await listPackages();
    for (const service of packages) {
      const serviceDir = getPackagePath(service);
      const files = fs.readdirSync(serviceDir).filter(f => f.endsWith('.rules.yaml') && f !== 'rules.yaml');
      for (const file of files) {
        const entityUuid = file.replace('.rules.yaml', '');
        result.push({ service, entityUuid });
      }
    }
  } catch (error) {
    logger.error(`Error listing entity rule files: ${error}`);
  }
  return result;
}

/** List all packages that have a package-level rules.yaml. */
export async function listPackagesWithRules(): Promise<string[]> {
  try {
    const packages = await listPackages();
    return packages.filter(service =>
      fs.existsSync(path.join(getPackagePath(service), 'rules.yaml')),
    );
  } catch (error) {
    logger.error(`Error listing packages with rules: ${error}`);
    return [];
  }
}

/** Read perspective-scoped rules from a single perspective YAML. */
export async function readPerspectiveRules(perspectiveUuid: string): Promise<Rule[]> {
  try {
    const perspective = await readPerspectiveFile(perspectiveUuid);
    if (!perspective) return [];
    return (perspective.rules as Rule[]) || [];
  } catch (error) {
    logger.error(`Error reading perspective rules: ${error}`);
    return [];
  }
}

/** Write perspective-scoped rules — preserves the rest of the perspective YAML. */
export async function writePerspectiveRules(perspectiveUuid: string, rules: Rule[]): Promise<boolean> {
  try {
    const perspective = await readPerspectiveFile(perspectiveUuid);
    if (!perspective) return false;
    perspective.rules = rules;
    perspective.updatedAt = new Date().toISOString();
    return await writePerspectiveFile(perspective);
  } catch (error) {
    logger.error(`Error writing perspective rules: ${error}`);
    return false;
  }
}

// ────────────────────────────────────────────────────────────────────────
// Global (cross-package) rules (#75)
// ────────────────────────────────────────────────────────────────────────

const getGlobalRulesPath = () => path.join(getDataDir(), 'rules.yaml');

/** Read the global rules file (cross-package rules only). */
export async function readGlobalRules(): Promise<Rule[]> {
  try {
    if (!fs.existsSync(getGlobalRulesPath())) return [];
    const content = fs.readFileSync(getGlobalRulesPath(), 'utf8');
    return YAML.parse(content) || [];
  } catch (error) {
    logger.error(`Error reading global rules: ${error}`);
    return [];
  }
}

/** Write the global rules file. Deletes the file when empty. */
export async function writeGlobalRules(rules: Rule[]): Promise<boolean> {
  try {
    if (rules.length === 0) {
      if (fs.existsSync(getGlobalRulesPath())) fs.unlinkSync(getGlobalRulesPath());
      return true;
    }
    fs.writeFileSync(getGlobalRulesPath(), YAML.stringify(rules), 'utf8');
    return true;
  } catch (error) {
    logger.error(`Error writing global rules: ${error}`);
    return false;
  }
}
