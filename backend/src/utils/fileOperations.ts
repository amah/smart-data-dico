import path from 'path';
import YAML from 'yaml';
import { logger } from './logger.js';
import { Entity, Relationship, Case, ReviewComment, validateEntity } from '../models/EntitySchema.js';
import { Rule } from '../models/Rule.js';
import { Action } from '../models/Action.js';
import { StateMachine } from '../models/StateMachine.js';
import { Dictionary } from '../models/Dictionary.js';
import { sanitizeFsName } from './uuid.js';
import { config } from '../kernel/config.js';
import { storageRegistry } from '../storage/contract/StorageBackendToken.js';
import type { IStorageBackend } from '../storage/contract/IStorageBackend.js';
import { wsId, pathOf, type Path, type Stat } from '../storage/contract/types.js';

// fs is GONE. No import. Lint guard will catch regressions in a later slice.

const WS = wsId('dictionaries');

// Lazy backend resolver — copies the slice-4 pattern. The module is loaded
// at import time; the backend is only registered when server.ts boots.
// Tests that import this module without registering a backend MUST mock the
// helpers (existing `jest.mock('../../utils/fileOperations')` calls keep working).
function getStorage(): IStorageBackend { return storageRegistry.getBackend(); }

/** Try-stat that returns null on `code:'not-found'` (duck-typed per slice-2 rule). */
async function statOrNull(p: Path): Promise<Stat | null> {
  try { return await getStorage().stat(WS, p); }
  catch (e) {
    if ((e as { code?: string }).code === 'not-found') return null;
    throw e;
  }
}

/** Try-read that returns null on `code:'not-found'`. */
async function readOrNull(p: Path): Promise<string | null> {
  try { return await getStorage().read(WS, p); }
  catch (e) {
    if ((e as { code?: string }).code === 'not-found') return null;
    throw e;
  }
}

/** Delete that swallows `code:'not-found'`. */
async function deleteIfExists(p: Path): Promise<void> {
  try { await getStorage().delete(WS, p); }
  catch (e) {
    if ((e as { code?: string }).code === 'not-found') return;
    throw e;
  }
}

// Base directory for data dictionaries
/** Always reads current config.dataDir so project switching (#95) works. */
const getDataDir = () => config.dataDir;

/**
 * Reserved top-level directory names that must not be treated as packages (#105/#106).
 * `.dico/` holds project-level system files; `.git/` and `node_modules/` are
 * filesystem noise. The legacy `perspectives/` project-root folder was
 * eliminated in #106 — cases now live inside packages as sections.
 */
const RESERVED_DIRS = new Set(['.dico', '.git', 'node_modules']);

/**
 * Reserved filenames at the package level (#106). `package.yaml` is the
 * package marker (#105). `metadata.yaml` is legacy dictionary metadata.
 * All other `.yaml` files in a package folder are treated as multi-kind
 * modeling content and fed into `loadPackage`.
 */
const RESERVED_PACKAGE_FILES = new Set(['package.yaml', 'metadata.yaml']);

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
 * Normalize legacy entity shapes on read. See original implementation
 * history for the three legacy cases handled here (metadata object→array,
 * flat validation fields, legacy `constraints` name).
 *
 * Non-mutating — deep-clones the entity before normalizing.
 */
export function normalizeEntityMetadata(entity: Entity | null): Entity | null {
  if (!entity) return entity;
  const cloned: Entity = JSON.parse(JSON.stringify(entity));
  if (cloned.attributes) {
    for (const attr of cloned.attributes) {
      if (attr.metadata && !Array.isArray(attr.metadata)) {
        attr.metadata = Object.entries(attr.metadata as any).map(
          ([name, value]) => ({ name, value: value as any }),
        );
      }
      const legacyConstraints = (attr as any).constraints;
      if (legacyConstraints && typeof legacyConstraints === 'object') {
        attr.validation = { ...(attr.validation || {}), ...legacyConstraints };
        delete (attr as any).constraints;
      }
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

// ────────────────────────────────────────────────────────────────────────
// Git service (lazy)
// ────────────────────────────────────────────────────────────────────────

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
  }
}

// ────────────────────────────────────────────────────────────────────────
// Directory structure
// ────────────────────────────────────────────────────────────────────────

export async function ensureDirectoryStructure(): Promise<void> {
  if (await statOrNull(pathOf('')) === null) {
    await getStorage().mkdir(WS, pathOf(''), true);
    logger.info(`Created base directory via storage backend`);
  }
  if (await statOrNull(pathOf('.dico')) === null) {
    await getStorage().mkdir(WS, pathOf('.dico'), true);
    logger.info(`Created .dico/ system directory via storage backend`);
  }
}

export async function ensurePackageDirectoryStructure(packageName: string): Promise<void> {
  if (await statOrNull(pathOf(packageName)) === null) {
    await getStorage().mkdir(WS, pathOf(packageName), true);
    logger.info(`Created package directory: ${packageName}`);
  }
  const markerPath = pathOf(`${packageName}/package.yaml`);
  if (await statOrNull(markerPath) === null) {
    await getStorage().write(WS, markerPath, YAML.stringify({ name: packageName }), { createParents: true });
  }
}

export function getPackagePath(packageName: string): string {
  return path.join(getDataDir(), packageName);
}

export async function listPackages(): Promise<string[]> {
  if (await statOrNull(pathOf('')) === null) return [];
  const entries = await getStorage().list(WS, pathOf(''));
  const out: string[] = [];
  for (const e of entries) {
    if (RESERVED_DIRS.has(e.name)) continue;
    if (!e.isDirectory) continue;
    const marker = await statOrNull(pathOf(`${e.name}/package.yaml`));
    if (marker !== null) out.push(e.name);
  }
  return out;
}

/** @deprecated Use `listPackages()`. */
export async function listMicroservices(): Promise<string[]> {
  return listPackages();
}

// ────────────────────────────────────────────────────────────────────────
// Multi-kind YAML core (#106)
// ────────────────────────────────────────────────────────────────────────

/**
 * A parsed package: all `.yaml` files in the package folder merged into
 * one logical model with per-identifier ownership tracking so writes can
 * rewrite the right file.
 */
export interface PackageModel {
  packageName: string;
  entities: Entity[];
  /** Package-scope relationships */
  relationships: Relationship[];
  /** Package-scope rules (entity-scoped rules live on `entity.rules`). */
  rules: Rule[];
  /** Cases owned by this package. */
  cases: Case[];
  /** Actions owned by entities in this package (#179). */
  actions: Action[];
  /** State machines owned by entities in this package (#179). */
  stateMachines: StateMachine[];
  /** Ownership maps (absolute file path) so writes can find the owning file. */
  ownership: {
    entityByName: Map<string, string>;
    entityByUuid: Map<string, string>;
    relationshipByUuid: Map<string, string>;
    ruleByUuid: Map<string, string>;
    caseByUuid: Map<string, string>;
    actionByUuid: Map<string, string>;
    stateMachineByUuid: Map<string, string>;
    /** Key: `${ownerRef}::${name}` — prevents duplicate (owner, name) pairs */
    actionByOwnerAndName: Map<string, string>;
    stateMachineByOwnerAndName: Map<string, string>;
  };
}

/**
 * One parsed YAML file's sections — the on-disk shape after #106. Any
 * subset of sections may be present; missing ones default to `[]`.
 */
export interface SectionsFile {
  entities: Entity[];
  relationships: Relationship[];
  rules: Rule[];
  cases: Case[];
  /** Actions (#179) */
  actions: Action[];
  /** State machines (#179) */
  stateMachines: StateMachine[];
}

/**
 * Parse the sections format from a YAML string. Exported so the git-ref
 * loader in `modelSnapshotLoader` can reuse the same parsing — it reads
 * files via `git show <ref>:<path>` rather than `fs.readFileSync`, but
 * the downstream shape is identical. `label` is used purely for error
 * messages (can be a file path, a git ref + path, etc.).
 *
 * Legacy-shape support for git-ref reads against pre-#106 commits:
 *   - A top-level object with `uuid` + `attributes` is treated as one
 *     entity wrapped in an `entities:` section (pre-#106 entity files).
 *   - A top-level YAML array is routed by `filename`:
 *       `relationships.yaml` → `relationships:`
 *       `rules.yaml` or `*.rules.yaml` → `rules:`
 * This lets the diff engine compare against commits older than the
 * multi-kind YAML cutover without rewriting their files.
 */
export function parseSectionsFromString(raw: string, label: string, filename?: string): SectionsFile {
  try {
    const parsed = YAML.parse(raw);
    if (!parsed) return { entities: [], relationships: [], rules: [], cases: [], actions: [], stateMachines: [] };

    // Legacy pre-#106: single-entity file (unwrapped `{ uuid, name, attributes }`).
    // Check FIRST because pre-#100 entity files also carried a top-level
    // `relationships:` key (per-entity relationships) that would otherwise
    // collide with the multi-kind detector below.
    if (typeof parsed === 'object' && !Array.isArray(parsed)
      && typeof parsed.uuid === 'string' && Array.isArray(parsed.attributes)) {
      return { entities: [parsed as Entity], relationships: [], rules: [], cases: [], actions: [], stateMachines: [] };
    }

    // Multi-kind sections format (#106 — current). Prefers `cases:` (#121)
    // and falls back to the legacy `perspectives:` key with a deprecation
    // warning so existing YAML keeps loading for one release.
    // Also recognizes `actions:` and `stateMachines:` (#179).
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && (
      'entities' in parsed || 'relationships' in parsed ||
      'rules' in parsed || 'cases' in parsed || 'perspectives' in parsed ||
      'actions' in parsed || 'stateMachines' in parsed
    )) {
      let cases: Case[] = [];
      if (Array.isArray(parsed.cases)) {
        cases = parsed.cases;
      } else if (Array.isArray(parsed.perspectives)) {
        console.warn(`[dico] deprecated YAML key "perspectives:" in ${label} — rename to "cases:"`);
        cases = parsed.perspectives;
      }
      return {
        entities: Array.isArray(parsed.entities) ? parsed.entities : [],
        relationships: Array.isArray(parsed.relationships) ? parsed.relationships : [],
        rules: Array.isArray(parsed.rules) ? parsed.rules : [],
        cases,
        actions: Array.isArray(parsed.actions) ? parsed.actions : [],
        stateMachines: Array.isArray(parsed.stateMachines) ? parsed.stateMachines : [],
      };
    }

    // Legacy pre-#106: top-level YAML array. Route by filename.
    if (Array.isArray(parsed) && filename) {
      if (filename === 'relationships.yaml') {
        return { entities: [], relationships: parsed, rules: [], cases: [], actions: [], stateMachines: [] };
      }
      if (filename === 'rules.yaml' || filename.endsWith('.rules.yaml')) {
        return { entities: [], relationships: [], rules: parsed, cases: [], actions: [], stateMachines: [] };
      }
    }

    return { entities: [], relationships: [], rules: [], cases: [], actions: [], stateMachines: [] };
  } catch (e) {
    logger.warn(`Failed to parse YAML: ${label}: ${e}`);
    return { entities: [], relationships: [], rules: [], cases: [], actions: [], stateMachines: [] };
  }
}

/**
 * Read and parse sections from the storage backend. Returns an empty
 * SectionsFile if the path does not exist.
 */
async function parseSectionsFromStorage(p: Path, label: string): Promise<SectionsFile> {
  const content = await readOrNull(p);
  if (content === null) {
    return { entities: [], relationships: [], rules: [], cases: [], actions: [], stateMachines: [] };
  }
  // path.basename works on both abs and workspace-rel since both use '/'
  const filename = path.basename(String(p));
  return parseSectionsFromString(content, label, filename);
}

/**
 * One (label, sections) pair for `mergePackageSections`. `label` is used
 * in collision error messages (an absolute path for disk files, a git
 * ref + path for git-ref loads).
 */
export interface ParsedSections {
  label: string;
  sections: SectionsFile;
}

/**
 * Pure merge + collision check over one package's parsed files. Shared
 * by the on-disk loader (`loadPackage`) and the git-ref loader so both
 * produce identical snapshots and enforce the same identity rules.
 *
 * Identifier collisions (same entity name, entity uuid, relationship
 * uuid, rule uuid, case uuid) are hard errors reporting both
 * owner labels.
 */
export function mergePackageSections(
  packageName: string,
  parsed: ParsedSections[],
): PackageModel {
  const model: PackageModel = {
    packageName,
    entities: [],
    relationships: [],
    rules: [],
    cases: [],
    actions: [],
    stateMachines: [],
    ownership: {
      entityByName: new Map(),
      entityByUuid: new Map(),
      relationshipByUuid: new Map(),
      ruleByUuid: new Map(),
      caseByUuid: new Map(),
      actionByUuid: new Map(),
      stateMachineByUuid: new Map(),
      actionByOwnerAndName: new Map(),
      stateMachineByOwnerAndName: new Map(),
    },
  };

  for (const { label, sections } of parsed) {
    for (const raw of sections.entities) {
      if (!raw?.name || !raw?.uuid) continue;
      const byName = model.ownership.entityByName.get(raw.name);
      if (byName) {
        throw new Error(
          `Duplicate entity name '${raw.name}' in package '${packageName}': ${byName} and ${label}`,
        );
      }
      const byUuid = model.ownership.entityByUuid.get(raw.uuid);
      if (byUuid) {
        throw new Error(
          `Duplicate entity uuid '${raw.uuid}' in package '${packageName}': ${byUuid} and ${label}`,
        );
      }
      model.ownership.entityByName.set(raw.name, label);
      model.ownership.entityByUuid.set(raw.uuid, label);
      const normalized = normalizeEntityMetadata(raw);
      if (normalized) model.entities.push(normalized);
    }

    for (const rel of sections.relationships) {
      if (!rel?.uuid) continue;
      const existing = model.ownership.relationshipByUuid.get(rel.uuid);
      if (existing) {
        throw new Error(
          `Duplicate relationship uuid '${rel.uuid}' in package '${packageName}': ${existing} and ${label}`,
        );
      }
      model.ownership.relationshipByUuid.set(rel.uuid, label);
      model.relationships.push(rel);
    }

    for (const rule of sections.rules) {
      if (!rule?.uuid) continue;
      const existing = model.ownership.ruleByUuid.get(rule.uuid);
      if (existing) {
        throw new Error(
          `Duplicate rule uuid '${rule.uuid}' in package '${packageName}': ${existing} and ${label}`,
        );
      }
      model.ownership.ruleByUuid.set(rule.uuid, label);
      model.rules.push(rule);
    }

    for (const c of sections.cases) {
      if (!c?.uuid) continue;
      const existing = model.ownership.caseByUuid.get(c.uuid);
      if (existing) {
        throw new Error(
          `Duplicate case uuid '${c.uuid}' in package '${packageName}': ${existing} and ${label}`,
        );
      }
      model.ownership.caseByUuid.set(c.uuid, label);
      model.cases.push(c);
    }

    // Actions (#179)
    for (const action of (sections.actions || [])) {
      if (!action?.uuid || !action?.name || !action?.ownerRef) continue;
      const byUuid = model.ownership.actionByUuid.get(action.uuid);
      if (byUuid) {
        throw new Error(
          `Duplicate action uuid '${action.uuid}' in package '${packageName}': ${byUuid} and ${label}`,
        );
      }
      const ownerNameKey = `${action.ownerRef}::${action.name}`;
      const byOwnerAndName = model.ownership.actionByOwnerAndName.get(ownerNameKey);
      if (byOwnerAndName) {
        throw new Error(
          `Duplicate action name '${action.name}' for ownerRef '${action.ownerRef}' in package '${packageName}': ${byOwnerAndName} and ${label}`,
        );
      }
      model.ownership.actionByUuid.set(action.uuid, label);
      model.ownership.actionByOwnerAndName.set(ownerNameKey, label);
      model.actions.push(action);
    }

    // State machines (#179)
    for (const sm of (sections.stateMachines || [])) {
      if (!sm?.uuid || !sm?.name || !sm?.ownerRef) continue;
      const byUuid = model.ownership.stateMachineByUuid.get(sm.uuid);
      if (byUuid) {
        throw new Error(
          `Duplicate stateMachine uuid '${sm.uuid}' in package '${packageName}': ${byUuid} and ${label}`,
        );
      }
      const ownerNameKey = `${sm.ownerRef}::${sm.name}`;
      const byOwnerAndName = model.ownership.stateMachineByOwnerAndName.get(ownerNameKey);
      if (byOwnerAndName) {
        throw new Error(
          `Duplicate stateMachine name '${sm.name}' for ownerRef '${sm.ownerRef}' in package '${packageName}': ${byOwnerAndName} and ${label}`,
        );
      }
      model.ownership.stateMachineByUuid.set(sm.uuid, label);
      model.ownership.stateMachineByOwnerAndName.set(ownerNameKey, label);
      model.stateMachines.push(sm);
    }
  }

  return model;
}

/** Returns the filenames considered reserved at the package level. */
export function getReservedPackageFiles(): ReadonlySet<string> {
  return RESERVED_PACKAGE_FILES;
}

/**
 * Write sections back to a file via the storage backend. If every section
 * is empty, delete the file (prevents empty YAML from lingering after the
 * last entity is moved or deleted). Preserves stable section order for
 * diff-friendly commits.
 */
async function writeSectionsToStorage(p: Path, sections: SectionsFile): Promise<void> {
  const payload: Record<string, unknown> = {};
  if (sections.entities.length > 0) payload.entities = sections.entities;
  if (sections.relationships.length > 0) payload.relationships = sections.relationships;
  if (sections.rules.length > 0) payload.rules = sections.rules;
  if (sections.cases.length > 0) payload.cases = sections.cases;
  if (sections.actions.length > 0) payload.actions = sections.actions;
  if (sections.stateMachines.length > 0) payload.stateMachines = sections.stateMachines;

  if (Object.keys(payload).length === 0) {
    await deleteIfExists(p);
    return;
  }
  await getStorage().write(WS, p, YAML.stringify(payload), { createParents: true });
}

/**
 * List workspace-relative paths to all non-reserved `.yaml` files in the
 * given package directory, sorted lexicographically.
 */
async function listPackageYamlFilePaths(packageName: string): Promise<Path[]> {
  const dir = pathOf(packageName);
  if (await statOrNull(dir) === null) return [];
  const entries = await getStorage().list(WS, dir);
  return entries
    .filter(e => !e.isDirectory)
    .map(e => e.name)
    .filter(f => f.endsWith('.yaml') && !RESERVED_PACKAGE_FILES.has(f))
    .sort()
    .map(f => pathOf(`${packageName}/${f}`));
}

/**
 * Load every `.yaml` file in a package folder and merge their sections
 * (#106). Thin wrapper over `mergePackageSections` that reads from disk;
 * the git-ref loader in `modelSnapshotLoader` calls the same merger with
 * contents fetched via `git show`.
 */
export async function loadPackage(packageName: string): Promise<PackageModel> {
  const files = await listPackageYamlFilePaths(packageName);
  const parsed: ParsedSections[] = await Promise.all(
    files.map(async (p) => ({
      label: String(p),
      sections: await parseSectionsFromStorage(p, String(p)),
    })),
  );
  return mergePackageSections(packageName, parsed);
}

// ────────────────────────────────────────────────────────────────────────
// Schema package — `.dico/schemas/` carve-out (#165a)
// ────────────────────────────────────────────────────────────────────────

/**
 * Resolve the on-disk path for the schema package.
 * Returns `<dataDir>/.dico/schemas`.
 *
 * The schema package is NEVER returned by `listPackages()` — it lives
 * under `.dico/` which is in `RESERVED_DIRS`. Only `schemaEntityService`
 * imports this function so that schema-entities don't surface as
 * ordinary package entities.
 */
export function getSchemaPackagePath(): string {
  return path.join(getDataDir(), '.dico', 'schemas');
}

/**
 * List workspace-relative paths to all `.yaml` files in the schema package
 * directory and its `_meta/` subdirectory. Unlike `listPackageYamlFilePaths`,
 * this function descends one level into `_meta/`.
 *
 * The schema package is NOT required to have `package.yaml` present for
 * the loader to read it (absence is logged as a warning). If the
 * directory itself is missing, an empty list is returned silently.
 */
async function listSchemaPackageYamlFilePaths(): Promise<Path[]> {
  const schemaDir = pathOf('.dico/schemas');
  if (await statOrNull(schemaDir) === null) return [];

  const files: Path[] = [];

  // Top-level files in .dico/schemas/
  try {
    const topEntries = await getStorage().list(WS, schemaDir);
    const topFiles = topEntries
      .filter(e => !e.isDirectory && e.name.endsWith('.yaml') && e.name !== 'package.yaml')
      .map(e => e.name)
      .sort()
      .map(f => pathOf(`.dico/schemas/${f}`));
    files.push(...topFiles);
  } catch {
    // ignore read errors
  }

  // Files in the reserved _meta/ subdirectory
  const metaDir = pathOf('.dico/schemas/_meta');
  if (await statOrNull(metaDir) !== null) {
    try {
      const metaEntries = await getStorage().list(WS, metaDir);
      const metaFiles = metaEntries
        .filter(e => !e.isDirectory && e.name.endsWith('.yaml'))
        .map(e => e.name)
        .sort()
        .map(f => pathOf(`.dico/schemas/_meta/${f}`));
      files.push(...metaFiles);
    } catch {
      // ignore read errors
    }
  }

  return files;
}

/**
 * Load the `.dico/schemas/` directory as a package, bypassing
 * `RESERVED_DIRS` exclusion. Returns an empty `PackageModel` if the
 * directory is missing. Logs a warning if `package.yaml` is absent (the
 * package marker is expected). Internally delegates to the same
 * `mergePackageSections` pipeline as `loadPackage()` so identifier-
 * collision rules apply identically within the schema package.
 *
 * Two layers are read: files directly under `.dico/schemas/` AND files
 * directly under `.dico/schemas/_meta/` (reserved for bootstrap entities).
 *
 * The schema package is NEVER returned by `listPackages()` — the
 * frontend doesn't see it as an ordinary package. Only
 * `schemaEntityService` imports this function.
 */
export async function loadSchemaPackage(): Promise<PackageModel> {
  const packageName = '.dico/schemas';

  if (await statOrNull(pathOf('.dico/schemas')) === null) {
    return mergePackageSections(packageName, []);
  }

  if (await statOrNull(pathOf('.dico/schemas/package.yaml')) === null) {
    logger.warn(
      `[#165a] Schema package marker missing at .dico/schemas/package.yaml. ` +
      `The metadata-schema bootstrap entity may not load correctly.`,
    );
  }

  const files = await listSchemaPackageYamlFilePaths();
  const parsed: ParsedSections[] = await Promise.all(
    files.map(async (p) => ({
      label: String(p),
      sections: await parseSectionsFromStorage(p, String(p)),
    })),
  );

  return mergePackageSections(packageName, parsed);
}

// ────────────────────────────────────────────────────────────────────────
// Entity CRUD (backed by loadPackage)
// ────────────────────────────────────────────────────────────────────────

/**
 * Reads a single entity from a package. Delegates to `loadPackage` and
 * matches by name. Legacy normalization is applied inside `loadPackage`.
 */
export async function readEntityFile(packageName: string, entityName: string): Promise<Entity | null> {
  try {
    const pkg = await loadPackage(packageName);
    return pkg.entities.find(e => e.name === entityName) || null;
  } catch (error) {
    logger.error(`Error reading entity ${packageName}.${entityName}: ${error}`);
    return null;
  }
}

/**
 * Writes an entity into its owning file, or creates `<Name>.model.yaml`
 * for new entities (#106 default write convention). Renames update the
 * owning file in-place; the owning file is always looked up by uuid to
 * handle the rename case.
 */
export async function writeEntityFile(entity: Entity, packageName?: string): Promise<{ ok: boolean; physicalPath?: string }> {
  try {
    const validation = validateEntity(entity);
    if (!validation.valid) {
      logger.error(`Invalid entity: ${validation.errors.join(', ')}`);
      return { ok: false };
    }
    if (!packageName) {
      logger.error('Package name is required to write entity file');
      return { ok: false };
    }

    await ensurePackageDirectoryStructure(packageName);

    // Locate the owning file by uuid OR by name (handles both renames
    // and fresh writes that happen to reuse a name).
    const files = await listPackageYamlFilePaths(packageName);
    let ownerFile: Path | null = null;
    let ownerSections: SectionsFile | null = null;

    for (const f of files) {
      const s = await parseSectionsFromStorage(f, String(f));
      if (s.entities.some(e => e?.uuid === entity.uuid || e?.name === entity.name)) {
        ownerFile = f;
        ownerSections = s;
        break;
      }
    }

    if (ownerFile && ownerSections) {
      // PRESERVE non-entity sections by reading the full SectionsFile and only
      // mutating .entities. Other sections (relationships, rules, cases) pass through untouched.
      ownerSections.entities = ownerSections.entities.filter(
        e => e.uuid !== entity.uuid && e.name !== entity.name,
      );
      ownerSections.entities.push(entity);
      await writeSectionsToStorage(ownerFile, ownerSections);
      logger.info(`Entity written: ${entity.name} → ${String(ownerFile)}`);
      await commitChanges(String(ownerFile), `Updated entity: ${entity.name} (${entity.uuid})`);
      return { ok: true, physicalPath: String(ownerFile) };
    }

    const newFilePath = pathOf(`${packageName}/${sanitizeFsName(entity.name)}.model.yaml`);
    await writeSectionsToStorage(newFilePath, {
      entities: [entity], relationships: [], rules: [], cases: [], actions: [], stateMachines: [],
    });
    logger.info(`Entity written to new file: ${String(newFilePath)}`);
    await commitChanges(String(newFilePath), `Added entity: ${entity.name} (${entity.uuid})`);
    return { ok: true, physicalPath: String(newFilePath) };
  } catch (error) {
    logger.error(`Error writing entity file: ${error}`);
    return { ok: false };
  }
}

/**
 * Deletes an entity from its owning file. If that was the only content
 * in the file, `writeSectionsToStorage` removes the file itself.
 */
export async function deleteEntityFile(packageName: string, entityName: string): Promise<{ ok: boolean; physicalPath?: string }> {
  try {
    const files = await listPackageYamlFilePaths(packageName);
    for (const f of files) {
      const s = await parseSectionsFromStorage(f, String(f));
      const before = s.entities.length;
      s.entities = s.entities.filter(e => e.name !== entityName);
      if (s.entities.length !== before) {
        await writeSectionsToStorage(f, s);
        logger.info(`Entity deleted from: ${String(f)}`);
        await commitChanges(String(f), `Deleted entity: ${entityName}`);
        return { ok: true, physicalPath: String(f) };
      }
    }
    logger.warn(`Entity not found for deletion: ${packageName}.${entityName}`);
    return { ok: false };
  } catch (error) {
    logger.error(`Error deleting entity file: ${error}`);
    return { ok: false };
  }
}

/**
 * Lists every entity name across every package (post-#106 flat layout).
 * Returns `{ microservice, name, path }` tuples where `path` is the file
 * that currently owns the entity (workspace-relative string after slice 5).
 */
export async function listAllEntities(): Promise<Array<{ microservice: string; name: string; path: string }>> {
  const entities: Array<{ microservice: string; name: string; path: string }> = [];
  const packages = await listPackages();
  for (const microservice of packages) {
    try {
      const pkg = await loadPackage(microservice);
      for (const entity of pkg.entities) {
        entities.push({
          microservice,
          name: entity.name,
          path: pkg.ownership.entityByName.get(entity.name) || '',
        });
      }
    } catch (e) {
      logger.warn(`Failed to load package ${microservice}: ${e}`);
    }
  }
  return entities;
}

export async function listMicroserviceEntities(microservice: string): Promise<string[]> {
  try {
    const pkg = await loadPackage(microservice);
    return pkg.entities.map(e => e.name);
  } catch (error) {
    logger.error(`Error listing package entities: ${error}`);
    return [];
  }
}

// ────────────────────────────────────────────────────────────────────────
// Relationships — package-level, section-based (#106)
// ────────────────────────────────────────────────────────────────────────

/**
 * Read all relationships in a package. Merges `relationships:` sections
 * from every `.yaml` in the package folder.
 */
export async function readRelationshipsFile(packagePath: string): Promise<Relationship[]> {
  try {
    const packageName = path.basename(packagePath);
    const pkg = await loadPackage(packageName);
    return pkg.relationships;
  } catch (error) {
    logger.error(`Error reading relationships file: ${error}`);
    return [];
  }
}

/**
 * Write the package's relationships list. Consolidates onto the first
 * file that currently owns any relationship, clearing other owners'
 * relationship sections. Falls back to `relationships.model.yaml` if no
 * file currently owns relationships.
 */
export async function writeRelationshipsFile(packagePath: string, relationships: Relationship[]): Promise<{ ok: boolean; physicalPath?: string }> {
  try {
    const packageName = path.basename(packagePath);
    await ensurePackageDirectoryStructure(packageName);

    const files = await listPackageYamlFilePaths(packageName);
    let targetFile: Path | null = null;

    for (const f of files) {
      const s = await parseSectionsFromStorage(f, String(f));
      if (s.relationships.length > 0) {
        if (targetFile === null) {
          targetFile = f;
        } else {
          // Another file also held relationships — clear it so we don't
          // leave duplicates after consolidation.
          s.relationships = [];
          await writeSectionsToStorage(f, s);
        }
      }
    }

    if (!targetFile) {
      targetFile = pathOf(`${packageName}/relationships.model.yaml`);
    }

    const existing = await parseSectionsFromStorage(targetFile, String(targetFile));
    existing.relationships = relationships;
    await writeSectionsToStorage(targetFile, existing);
    logger.info(`Relationships written to: ${String(targetFile)}`);
    await commitChanges(String(targetFile), `Updated relationships in ${packageName}`);
    return { ok: true, physicalPath: String(targetFile) };
  } catch (error) {
    logger.error(`Error writing relationships file: ${error}`);
    return { ok: false };
  }
}

/**
 * Collects all relationships across every package for cross-service BFS.
 */
export async function getAllRelationships(): Promise<{ packageName: string; relationships: Relationship[] }[]> {
  const result: { packageName: string; relationships: Relationship[] }[] = [];
  try {
    const packages = await listPackages();
    for (const name of packages) {
      try {
        const pkg = await loadPackage(name);
        if (pkg.relationships.length > 0) {
          result.push({ packageName: name, relationships: pkg.relationships });
        }
      } catch (e) {
        logger.warn(`Failed to read relationships for package ${name}: ${e}`);
      }
    }
  } catch (error) {
    logger.error(`Error collecting all relationships: ${error}`);
  }
  return result;
}

// ────────────────────────────────────────────────────────────────────────
// Review comments — inlined on entity (#106; sidecars eliminated)
// ────────────────────────────────────────────────────────────────────────

/** Read review comments inlined on an entity by uuid. */
export async function readComments(service: string, entityUuid: string): Promise<ReviewComment[]> {
  try {
    const pkg = await loadPackage(service);
    const entity = pkg.entities.find(e => e.uuid === entityUuid);
    return entity?.reviewComments || [];
  } catch (error) {
    logger.error(`Error reading comments: ${error}`);
    return [];
  }
}

/** Write review comments inlined on an entity by uuid. Persists via writeEntityFile. */
export async function writeComments(service: string, entityUuid: string, comments: ReviewComment[]): Promise<boolean> {
  try {
    const pkg = await loadPackage(service);
    const entity = pkg.entities.find(e => e.uuid === entityUuid);
    if (!entity) {
      logger.warn(`Entity not found for comments: ${service}.${entityUuid}`);
      return false;
    }
    entity.reviewComments = comments.length > 0 ? comments : undefined;
    const { ok } = await writeEntityFile(entity, service);
    return ok;
  } catch (error) {
    logger.error(`Error writing comments: ${error}`);
    return false;
  }
}

// ────────────────────────────────────────────────────────────────────────
// Rules — three scopes (entity-inlined, package-section, case, global)
// ────────────────────────────────────────────────────────────────────────

/** Read entity-scoped rules inlined on the entity (replaces the sidecar — #106). */
export async function readEntityRules(service: string, entityUuid: string): Promise<Rule[]> {
  try {
    const pkg = await loadPackage(service);
    const entity = pkg.entities.find(e => e.uuid === entityUuid);
    return entity?.rules || [];
  } catch (error) {
    logger.error(`Error reading entity rules: ${error}`);
    return [];
  }
}

/** Write entity-scoped rules inline on the entity; persists via writeEntityFile. */
export async function writeEntityRules(service: string, entityUuid: string, rules: Rule[]): Promise<{ ok: boolean; physicalPath?: string }> {
  try {
    const pkg = await loadPackage(service);
    const entity = pkg.entities.find(e => e.uuid === entityUuid);
    if (!entity) {
      logger.warn(`Entity not found for rules: ${service}.${entityUuid}`);
      return { ok: false };
    }
    entity.rules = rules.length > 0 ? rules : undefined;
    return await writeEntityFile(entity, service);
  } catch (error) {
    logger.error(`Error writing entity rules: ${error}`);
    return { ok: false };
  }
}

/** Read package-scoped rules (merged across all `.yaml` files in the package). */
export async function readPackageRules(service: string): Promise<Rule[]> {
  try {
    const pkg = await loadPackage(service);
    return pkg.rules;
  } catch (error) {
    logger.error(`Error reading package rules: ${error}`);
    return [];
  }
}

/**
 * Write package-scoped rules. Consolidates to the first file that currently
 * owns any rule (clearing others) or creates `rules.model.yaml` if none.
 */
export async function writePackageRules(service: string, rules: Rule[]): Promise<{ ok: boolean; physicalPath?: string }> {
  try {
    await ensurePackageDirectoryStructure(service);
    const files = await listPackageYamlFilePaths(service);
    let targetFile: Path | null = null;

    for (const f of files) {
      const s = await parseSectionsFromStorage(f, String(f));
      if (s.rules.length > 0) {
        if (targetFile === null) {
          targetFile = f;
        } else {
          s.rules = [];
          await writeSectionsToStorage(f, s);
        }
      }
    }

    if (!targetFile) {
      targetFile = pathOf(`${service}/rules.model.yaml`);
    }

    const existing = await parseSectionsFromStorage(targetFile, String(targetFile));
    existing.rules = rules;
    await writeSectionsToStorage(targetFile, existing);
    logger.info(`Package rules written to: ${String(targetFile)}`);
    await commitChanges(String(targetFile), `Updated rules in ${service}`);
    return { ok: true, physicalPath: String(targetFile) };
  } catch (error) {
    logger.error(`Error writing package rules: ${error}`);
    return { ok: false };
  }
}

/**
 * List every (service, entityUuid) pair that has inlined entity-scoped
 * rules. Replaces the sidecar directory walk from the pre-#106 layout.
 */
export async function listAllEntityRuleFiles(): Promise<Array<{ service: string; entityUuid: string }>> {
  const result: Array<{ service: string; entityUuid: string }> = [];
  try {
    const packages = await listPackages();
    for (const service of packages) {
      try {
        const pkg = await loadPackage(service);
        for (const entity of pkg.entities) {
          if (entity.rules && entity.rules.length > 0) {
            result.push({ service, entityUuid: entity.uuid });
          }
        }
      } catch (e) {
        logger.warn(`Failed to load package ${service} for rule listing: ${e}`);
      }
    }
  } catch (error) {
    logger.error(`Error listing entity rule files: ${error}`);
  }
  return result;
}

/** Packages that currently have at least one package-scope rule. */
export async function listPackagesWithRules(): Promise<string[]> {
  try {
    const packages = await listPackages();
    const result: string[] = [];
    for (const service of packages) {
      try {
        const pkg = await loadPackage(service);
        if (pkg.rules.length > 0) result.push(service);
      } catch { /* skip */ }
    }
    return result;
  } catch (error) {
    logger.error(`Error listing packages with rules: ${error}`);
    return [];
  }
}

/** Read rules embedded in a case. */
export async function readCaseRules(caseUuid: string): Promise<Rule[]> {
  try {
    const c = await readCaseFile(caseUuid);
    if (!c) return [];
    return (c.rules as Rule[]) || [];
  } catch (error) {
    logger.error(`Error reading case rules: ${error}`);
    return [];
  }
}

/** Write rules embedded in a case (preserves the rest of the case). */
export async function writeCaseRules(caseUuid: string, rules: Rule[]): Promise<{ ok: boolean; physicalPath?: string }> {
  try {
    const c = await readCaseFile(caseUuid);
    if (!c) return { ok: false };
    c.rules = rules;
    c.updatedAt = new Date().toISOString();
    return await writeCaseFile(c);
  } catch (error) {
    logger.error(`Error writing case rules: ${error}`);
    return { ok: false };
  }
}

// ────────────────────────────────────────────────────────────────────────
// Global (cross-package) rules (#75) — project-root rules.yaml
// ────────────────────────────────────────────────────────────────────────

export async function readGlobalRules(): Promise<Rule[]> {
  try {
    const content = await readOrNull(pathOf('rules.yaml'));
    if (content === null) return [];
    return YAML.parse(content) || [];
  } catch (error) {
    logger.error(`Error reading global rules: ${error}`);
    return [];
  }
}

export async function writeGlobalRules(rules: Rule[]): Promise<{ ok: boolean; physicalPath?: string }> {
  try {
    if (rules.length === 0) {
      await deleteIfExists(pathOf('rules.yaml'));
      return { ok: true, physicalPath: 'rules.yaml' };
    }
    await getStorage().write(WS, pathOf('rules.yaml'), YAML.stringify(rules));
    return { ok: true, physicalPath: 'rules.yaml' };
  } catch (error) {
    logger.error(`Error writing global rules: ${error}`);
    return { ok: false };
  }
}

// ────────────────────────────────────────────────────────────────────────
// Cases — package-embedded (#106; global folder eliminated)
// ────────────────────────────────────────────────────────────────────────

/**
 * List every case across every package. The legacy project-root
 * `perspectives/` folder is no longer supported (eliminated by migration).
 */
export async function listCases(): Promise<Case[]> {
  const all: Case[] = [];
  try {
    const packages = await listPackages();
    for (const pkg of packages) {
      try {
        const model = await loadPackage(pkg);
        all.push(...model.cases);
      } catch (e) {
        logger.warn(`Failed to load cases for ${pkg}: ${e}`);
      }
    }
  } catch (error) {
    logger.error(`Error listing cases: ${error}`);
  }
  return all;
}

/** Locate the package + file that owns a case by uuid. */
async function findCaseOwner(uuid: string): Promise<{ packageName: string; filePath: string } | null> {
  const packages = await listPackages();
  for (const pkg of packages) {
    try {
      const model = await loadPackage(pkg);
      const filePath = model.ownership.caseByUuid.get(uuid);
      if (filePath) return { packageName: pkg, filePath };
    } catch { /* skip */ }
  }
  return null;
}

export async function readCaseFile(uuid: string): Promise<Case | null> {
  try {
    const packages = await listPackages();
    for (const pkg of packages) {
      try {
        const model = await loadPackage(pkg);
        const c = model.cases.find(x => x.uuid === uuid);
        if (c) return c;
      } catch { /* skip */ }
    }
    return null;
  } catch (error) {
    logger.error(`Error reading case ${uuid}: ${error}`);
    return null;
  }
}

/**
 * Write a case. Placement rules:
 *   1. If a file already owns this case, rewrite it there.
 *   2. Otherwise, place it in the package of its first root entity as
 *      `<Name>.case.yaml` (#121 default convention).
 *   3. If no root-entity package can be resolved, fall back to the first
 *      package on disk so the write doesn't silently fail.
 */
export async function writeCaseFile(c: Case): Promise<{ ok: boolean; physicalPath?: string }> {
  try {
    const owner = await findCaseOwner(c.uuid);
    if (owner) {
      const ownerPath = pathOf(owner.filePath);
      const sections = await parseSectionsFromStorage(ownerPath, owner.filePath);
      sections.cases = sections.cases.filter(p => p.uuid !== c.uuid);
      sections.cases.push(c);
      await writeSectionsToStorage(ownerPath, sections);
      await commitChanges(owner.filePath, `Updated case: ${c.name}`);
      return { ok: true, physicalPath: owner.filePath };
    }

    const targetPackage = await resolveCaseHomePackage(c);
    if (!targetPackage) {
      logger.error(`Cannot write case ${c.uuid}: no package found`);
      return { ok: false };
    }
    await ensurePackageDirectoryStructure(targetPackage);
    const filename = `${sanitizeFsName(c.name || c.uuid)}.case.yaml`;
    const filePath = pathOf(`${targetPackage}/${filename}`);

    const sections = await parseSectionsFromStorage(filePath, String(filePath));
    sections.cases.push(c);
    await writeSectionsToStorage(filePath, sections);
    await commitChanges(String(filePath), `Added case: ${c.name}`);
    return { ok: true, physicalPath: String(filePath) };
  } catch (error) {
    logger.error(`Error writing case: ${error}`);
    return { ok: false };
  }
}

/** First-root-entity's package, or the first package, or null. */
async function resolveCaseHomePackage(c: Case): Promise<string | null> {
  const packages = await listPackages();
  if (c.rootEntities && c.rootEntities.length > 0) {
    const rootUuid = c.rootEntities[0];
    for (const pkg of packages) {
      try {
        const model = await loadPackage(pkg);
        if (model.ownership.entityByUuid.has(rootUuid)) return pkg;
      } catch { /* skip */ }
    }
  }
  return packages[0] || null;
}

export async function deleteCaseFile(uuid: string): Promise<{ ok: boolean; physicalPath?: string }> {
  try {
    const owner = await findCaseOwner(uuid);
    if (!owner) return { ok: false };
    const ownerPath = pathOf(owner.filePath);
    const sections = await parseSectionsFromStorage(ownerPath, owner.filePath);
    sections.cases = sections.cases.filter(p => p.uuid !== uuid);
    await writeSectionsToStorage(ownerPath, sections);
    await commitChanges(owner.filePath, `Deleted case ${uuid}`);
    return { ok: true, physicalPath: owner.filePath };
  } catch (error) {
    logger.error(`Error deleting case ${uuid}: ${error}`);
    return { ok: false };
  }
}

// ────────────────────────────────────────────────────────────────────────
// Dictionary metadata (legacy)
// ────────────────────────────────────────────────────────────────────────

export async function writeDictionaryMetadata(dictionary: Dictionary): Promise<boolean> {
  try {
    if (await statOrNull(pathOf(dictionary.id)) === null) {
      await getStorage().mkdir(WS, pathOf(dictionary.id), true);
      logger.info(`Created dictionary directory: ${dictionary.id}`);
    }

    const filePath = pathOf(`${dictionary.id}/metadata.yaml`);

    const metadata = {
      id: dictionary.id,
      name: dictionary.name,
      description: dictionary.description,
      metadataDefinitions: dictionary.metadataDefinitions,
      createdAt: dictionary.createdAt,
      updatedAt: dictionary.updatedAt,
    };

    await getStorage().write(WS, filePath, YAML.stringify(metadata), { createParents: true });
    logger.info(`Dictionary metadata written to file: ${String(filePath)}`);
    await commitChanges(String(filePath), `Updated dictionary metadata: ${dictionary.name}`);
    return true;
  } catch (error) {
    logger.error(`Error writing dictionary metadata: ${error}`);
    return false;
  }
}

export async function listAllDictionaries(): Promise<string[]> {
  try {
    const dictionaries: string[] = [];
    if (await statOrNull(pathOf('')) === null) return [];

    dictionaries.push(...await listPackages());

    const items = await getStorage().list(WS, pathOf(''));
    for (const item of items) {
      if (RESERVED_DIRS.has(item.name)) continue;
      if (dictionaries.includes(item.name)) continue;
      if (item.isDirectory) {
        const metadataStat = await statOrNull(pathOf(`${item.name}/metadata.yaml`));
        if (metadataStat !== null) {
          dictionaries.push(item.name);
        }
      }
    }

    return dictionaries;
  } catch (error) {
    logger.error(`Error listing all dictionaries: ${error}`);
    return [];
  }
}

// ────────────────────────────────────────────────────────────────────────
// Action CRUD (#179)
// ────────────────────────────────────────────────────────────────────────

/**
 * Find which package and file own an action, by scanning all packages.
 * Returns `{ packageName, filePath }` or null if not found.
 */
export async function findActionOwner(actionUuid: string): Promise<{ packageName: string; filePath: string } | null> {
  const packages = await listPackages();
  for (const pkg of packages) {
    const files = await listPackageYamlFilePaths(pkg);
    for (const f of files) {
      const s = await parseSectionsFromStorage(f, String(f));
      if (s.actions.some(a => a.uuid === actionUuid)) {
        return { packageName: pkg, filePath: String(f) };
      }
    }
  }
  return null;
}

/**
 * Read all actions for an entity UUID across all packages.
 */
export async function readActionsForEntity(entityUuid: string): Promise<Action[]> {
  const packages = await listPackages();
  const result: Action[] = [];
  for (const pkg of packages) {
    try {
      const model = await loadPackage(pkg);
      result.push(...model.actions.filter(a => a.ownerRef === entityUuid));
    } catch { /* skip */ }
  }
  return result;
}

/**
 * Write an action into its owning file. If the action already exists
 * (matched by uuid), it is replaced in-place. Otherwise the owner entity's
 * primary model file is used; if no model file exists a dedicated
 * `<sanitizedName>.actions.yaml` is created.
 */
export async function writeAction(action: Action, packageName: string): Promise<{ ok: boolean; physicalPath?: string }> {
  try {
    await ensurePackageDirectoryStructure(packageName);

    // Look for an existing file that already has this action
    const files = await listPackageYamlFilePaths(packageName);
    let ownerFile: Path | null = null;
    let ownerSections: SectionsFile | null = null;

    for (const f of files) {
      const s = await parseSectionsFromStorage(f, String(f));
      if (s.actions.some(a => a.uuid === action.uuid)) {
        ownerFile = f;
        ownerSections = s;
        break;
      }
    }

    if (ownerFile && ownerSections) {
      ownerSections.actions = ownerSections.actions.filter(a => a.uuid !== action.uuid);
      ownerSections.actions.push(action);
      await writeSectionsToStorage(ownerFile, ownerSections);
      await commitChanges(String(ownerFile), `Updated action: ${action.name} (${action.uuid})`);
      return { ok: true, physicalPath: String(ownerFile) };
    }

    // New action — try to merge into the owner entity's model file
    const entityModel = await loadPackage(packageName);
    const ownerEntityFile = entityModel.ownership.entityByUuid.get(action.ownerRef);
    if (ownerEntityFile) {
      const filePath = pathOf(ownerEntityFile);
      const s = await parseSectionsFromStorage(filePath, ownerEntityFile);
      s.actions = s.actions.filter(a => a.uuid !== action.uuid);
      s.actions.push(action);
      await writeSectionsToStorage(filePath, s);
      await commitChanges(ownerEntityFile, `Added action: ${action.name} (${action.uuid})`);
      return { ok: true, physicalPath: ownerEntityFile };
    }

    // Fallback: create a dedicated actions file
    const newFilePath = pathOf(`${packageName}/${sanitizeFsName(action.name)}.actions.yaml`);
    await writeSectionsToStorage(newFilePath, {
      entities: [], relationships: [], rules: [], cases: [],
      actions: [action], stateMachines: [],
    });
    await commitChanges(String(newFilePath), `Added action: ${action.name} (${action.uuid})`);
    return { ok: true, physicalPath: String(newFilePath) };
  } catch (error) {
    logger.error(`Error writing action: ${error}`);
    return { ok: false };
  }
}

/**
 * Delete an action by UUID. Searches all packages.
 */
export async function deleteAction(uuid: string): Promise<{ ok: boolean; physicalPath?: string }> {
  try {
    const owner = await findActionOwner(uuid);
    if (!owner) return { ok: false };
    const ownerPath = pathOf(owner.filePath);
    const s = await parseSectionsFromStorage(ownerPath, owner.filePath);
    const before = s.actions.length;
    s.actions = s.actions.filter(a => a.uuid !== uuid);
    if (s.actions.length === before) return { ok: false };
    await writeSectionsToStorage(ownerPath, s);
    await commitChanges(owner.filePath, `Deleted action ${uuid}`);
    return { ok: true, physicalPath: owner.filePath };
  } catch (error) {
    logger.error(`Error deleting action ${uuid}: ${error}`);
    return { ok: false };
  }
}

// ────────────────────────────────────────────────────────────────────────
// StateMachine CRUD (#179)
// ────────────────────────────────────────────────────────────────────────

/**
 * Find which package and file own a state machine, by scanning all packages.
 */
export async function findStateMachineOwner(smUuid: string): Promise<{ packageName: string; filePath: string } | null> {
  const packages = await listPackages();
  for (const pkg of packages) {
    const files = await listPackageYamlFilePaths(pkg);
    for (const f of files) {
      const s = await parseSectionsFromStorage(f, String(f));
      if (s.stateMachines.some(m => m.uuid === smUuid)) {
        return { packageName: pkg, filePath: String(f) };
      }
    }
  }
  return null;
}

/**
 * Read all state machines for an entity UUID across all packages.
 */
export async function readStateMachinesForEntity(entityUuid: string): Promise<StateMachine[]> {
  const packages = await listPackages();
  const result: StateMachine[] = [];
  for (const pkg of packages) {
    try {
      const model = await loadPackage(pkg);
      result.push(...model.stateMachines.filter(m => m.ownerRef === entityUuid));
    } catch { /* skip */ }
  }
  return result;
}

/**
 * Write a state machine into its owning file.
 */
export async function writeStateMachine(sm: StateMachine, packageName: string): Promise<{ ok: boolean; physicalPath?: string }> {
  try {
    await ensurePackageDirectoryStructure(packageName);

    const files = await listPackageYamlFilePaths(packageName);
    let ownerFile: Path | null = null;
    let ownerSections: SectionsFile | null = null;

    for (const f of files) {
      const s = await parseSectionsFromStorage(f, String(f));
      if (s.stateMachines.some(m => m.uuid === sm.uuid)) {
        ownerFile = f;
        ownerSections = s;
        break;
      }
    }

    if (ownerFile && ownerSections) {
      ownerSections.stateMachines = ownerSections.stateMachines.filter(m => m.uuid !== sm.uuid);
      ownerSections.stateMachines.push(sm);
      await writeSectionsToStorage(ownerFile, ownerSections);
      await commitChanges(String(ownerFile), `Updated stateMachine: ${sm.name} (${sm.uuid})`);
      return { ok: true, physicalPath: String(ownerFile) };
    }

    // New state machine — try to merge into the owner entity's model file
    const entityModel = await loadPackage(packageName);
    const ownerEntityFile = entityModel.ownership.entityByUuid.get(sm.ownerRef);
    if (ownerEntityFile) {
      const filePath = pathOf(ownerEntityFile);
      const s = await parseSectionsFromStorage(filePath, ownerEntityFile);
      s.stateMachines = s.stateMachines.filter(m => m.uuid !== sm.uuid);
      s.stateMachines.push(sm);
      await writeSectionsToStorage(filePath, s);
      await commitChanges(ownerEntityFile, `Added stateMachine: ${sm.name} (${sm.uuid})`);
      return { ok: true, physicalPath: ownerEntityFile };
    }

    // Fallback: create a dedicated statemachine file
    const newFilePath = pathOf(`${packageName}/${sanitizeFsName(sm.name)}.statemachine.yaml`);
    await writeSectionsToStorage(newFilePath, {
      entities: [], relationships: [], rules: [], cases: [],
      actions: [], stateMachines: [sm],
    });
    await commitChanges(String(newFilePath), `Added stateMachine: ${sm.name} (${sm.uuid})`);
    return { ok: true, physicalPath: String(newFilePath) };
  } catch (error) {
    logger.error(`Error writing stateMachine: ${error}`);
    return { ok: false };
  }
}

/**
 * Delete a state machine by UUID.
 */
export async function deleteStateMachine(uuid: string): Promise<{ ok: boolean; physicalPath?: string }> {
  try {
    const owner = await findStateMachineOwner(uuid);
    if (!owner) return { ok: false };
    const ownerPath = pathOf(owner.filePath);
    const s = await parseSectionsFromStorage(ownerPath, owner.filePath);
    const before = s.stateMachines.length;
    s.stateMachines = s.stateMachines.filter(m => m.uuid !== uuid);
    if (s.stateMachines.length === before) return { ok: false };
    await writeSectionsToStorage(ownerPath, s);
    await commitChanges(owner.filePath, `Deleted stateMachine ${uuid}`);
    return { ok: true, physicalPath: owner.filePath };
  } catch (error) {
    logger.error(`Error deleting stateMachine ${uuid}: ${error}`);
    return { ok: false };
  }
}
