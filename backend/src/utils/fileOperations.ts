import fs from 'fs';
import path from 'path';
import YAML from 'yaml';
import { logger } from './logger.js';
import { Entity, Relationship, Case, ReviewComment, validateEntity } from '../models/EntitySchema.js';
import { Rule } from '../models/Rule.js';
import { Dictionary } from '../models/Dictionary.js';
import { sanitizeFsName } from './uuid.js';
import { config } from '../kernel/config.js';

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

export function getPackagePath(packageName: string): string {
  return path.join(getDataDir(), packageName);
}

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
  /** Ownership maps (absolute file path) so writes can find the owning file. */
  ownership: {
    entityByName: Map<string, string>;
    entityByUuid: Map<string, string>;
    relationshipByUuid: Map<string, string>;
    ruleByUuid: Map<string, string>;
    caseByUuid: Map<string, string>;
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
    if (!parsed) return { entities: [], relationships: [], rules: [], cases: [] };

    // Legacy pre-#106: single-entity file (unwrapped `{ uuid, name, attributes }`).
    // Check FIRST because pre-#100 entity files also carried a top-level
    // `relationships:` key (per-entity relationships) that would otherwise
    // collide with the multi-kind detector below.
    if (typeof parsed === 'object' && !Array.isArray(parsed)
      && typeof parsed.uuid === 'string' && Array.isArray(parsed.attributes)) {
      return { entities: [parsed as Entity], relationships: [], rules: [], cases: [] };
    }

    // Multi-kind sections format (#106 — current). Prefers `cases:` (#121)
    // and falls back to the legacy `perspectives:` key with a deprecation
    // warning so existing YAML keeps loading for one release.
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && (
      'entities' in parsed || 'relationships' in parsed ||
      'rules' in parsed || 'cases' in parsed || 'perspectives' in parsed
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
      };
    }

    // Legacy pre-#106: top-level YAML array. Route by filename.
    if (Array.isArray(parsed) && filename) {
      if (filename === 'relationships.yaml') {
        return { entities: [], relationships: parsed, rules: [], cases: [] };
      }
      if (filename === 'rules.yaml' || filename.endsWith('.rules.yaml')) {
        return { entities: [], relationships: [], rules: parsed, cases: [] };
      }
    }

    return { entities: [], relationships: [], rules: [], cases: [] };
  } catch (e) {
    logger.warn(`Failed to parse YAML: ${label}: ${e}`);
    return { entities: [], relationships: [], rules: [], cases: [] };
  }
}

function parseSections(filePath: string): SectionsFile {
  try {
    return parseSectionsFromString(fs.readFileSync(filePath, 'utf8'), filePath, path.basename(filePath));
  } catch (e) {
    logger.warn(`Failed to read YAML: ${filePath}: ${e}`);
    return { entities: [], relationships: [], rules: [], cases: [] };
  }
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
    ownership: {
      entityByName: new Map(),
      entityByUuid: new Map(),
      relationshipByUuid: new Map(),
      ruleByUuid: new Map(),
      caseByUuid: new Map(),
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
  }

  return model;
}

/** Returns the filenames considered reserved at the package level. */
export function getReservedPackageFiles(): ReadonlySet<string> {
  return RESERVED_PACKAGE_FILES;
}

/**
 * Write sections back to a file. If every section is empty, delete the
 * file (prevents empty YAML from lingering after the last entity is
 * moved or deleted). Preserves stable section order for diff-friendly
 * commits.
 */
function writeSections(filePath: string, sections: SectionsFile): void {
  const payload: any = {};
  if (sections.entities.length > 0) payload.entities = sections.entities;
  if (sections.relationships.length > 0) payload.relationships = sections.relationships;
  if (sections.rules.length > 0) payload.rules = sections.rules;
  if (sections.cases.length > 0) payload.cases = sections.cases;

  if (Object.keys(payload).length === 0) {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    return;
  }
  fs.writeFileSync(filePath, YAML.stringify(payload), 'utf8');
}

function listPackageYamlFiles(packageName: string): string[] {
  const dir = getPackagePath(packageName);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.yaml') && !RESERVED_PACKAGE_FILES.has(f))
    .map(f => path.join(dir, f))
    .sort();
}

/**
 * Load every `.yaml` file in a package folder and merge their sections
 * (#106). Thin wrapper over `mergePackageSections` that reads from disk;
 * the git-ref loader in `modelSnapshotLoader` calls the same merger with
 * contents fetched via `git show`.
 */
export async function loadPackage(packageName: string): Promise<PackageModel> {
  const files = listPackageYamlFiles(packageName);
  const parsed: ParsedSections[] = files.map(filePath => ({
    label: filePath,
    sections: parseSections(filePath),
  }));
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

    // Locate the owning file by uuid OR by name (handles both renames
    // and fresh writes that happen to reuse a name).
    const files = listPackageYamlFiles(packageName);
    let ownerFile: string | null = null;
    let ownerSections: SectionsFile | null = null;

    for (const f of files) {
      const s = parseSections(f);
      const idx = s.entities.findIndex(e => e?.uuid === entity.uuid || e?.name === entity.name);
      if (idx >= 0) {
        ownerFile = f;
        ownerSections = s;
        break;
      }
    }

    if (ownerFile && ownerSections) {
      ownerSections.entities = ownerSections.entities.filter(
        e => e.uuid !== entity.uuid && e.name !== entity.name,
      );
      ownerSections.entities.push(entity);
      writeSections(ownerFile, ownerSections);
      logger.info(`Entity written: ${entity.name} → ${ownerFile}`);
      await commitChanges(ownerFile, `Updated entity: ${entity.name} (${entity.uuid})`);
      return true;
    }

    const newFilePath = path.join(packageDir, `${sanitizeFsName(entity.name)}.model.yaml`);
    writeSections(newFilePath, {
      entities: [entity], relationships: [], rules: [], cases: [],
    });
    logger.info(`Entity written to new file: ${newFilePath}`);
    await commitChanges(newFilePath, `Added entity: ${entity.name} (${entity.uuid})`);
    return true;
  } catch (error) {
    logger.error(`Error writing entity file: ${error}`);
    return false;
  }
}

/**
 * Deletes an entity from its owning file. If that was the only content
 * in the file, `writeSections` removes the file itself.
 */
export async function deleteEntityFile(packageName: string, entityName: string): Promise<boolean> {
  try {
    const files = listPackageYamlFiles(packageName);
    for (const f of files) {
      const s = parseSections(f);
      const before = s.entities.length;
      s.entities = s.entities.filter(e => e.name !== entityName);
      if (s.entities.length !== before) {
        writeSections(f, s);
        logger.info(`Entity deleted from: ${f}`);
        await commitChanges(f, `Deleted entity: ${entityName}`);
        return true;
      }
    }
    logger.warn(`Entity not found for deletion: ${packageName}.${entityName}`);
    return false;
  } catch (error) {
    logger.error(`Error deleting entity file: ${error}`);
    return false;
  }
}

/**
 * Lists every entity name across every package (post-#106 flat layout).
 * Returns `{ microservice, name, path }` tuples where `path` is the file
 * that currently owns the entity.
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
export async function writeRelationshipsFile(packagePath: string, relationships: Relationship[]): Promise<boolean> {
  try {
    const packageName = path.basename(packagePath);
    ensurePackageDirectoryStructure(packageName);

    const files = listPackageYamlFiles(packageName);
    let targetFile: string | null = null;

    for (const f of files) {
      const s = parseSections(f);
      if (s.relationships.length > 0) {
        if (targetFile === null) {
          targetFile = f;
        } else {
          // Another file also held relationships — clear it so we don't
          // leave duplicates after consolidation.
          s.relationships = [];
          writeSections(f, s);
        }
      }
    }

    if (!targetFile) {
      targetFile = path.join(packagePath, 'relationships.model.yaml');
    }

    const existing = fs.existsSync(targetFile)
      ? parseSections(targetFile)
      : { entities: [], relationships: [], rules: [], cases: [] };
    existing.relationships = relationships;
    writeSections(targetFile, existing);
    logger.info(`Relationships written to: ${targetFile}`);
    await commitChanges(targetFile, `Updated relationships in ${packageName}`);
    return true;
  } catch (error) {
    logger.error(`Error writing relationships file: ${error}`);
    return false;
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
    return await writeEntityFile(entity, service);
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
export async function writeEntityRules(service: string, entityUuid: string, rules: Rule[]): Promise<boolean> {
  try {
    const pkg = await loadPackage(service);
    const entity = pkg.entities.find(e => e.uuid === entityUuid);
    if (!entity) {
      logger.warn(`Entity not found for rules: ${service}.${entityUuid}`);
      return false;
    }
    entity.rules = rules.length > 0 ? rules : undefined;
    return await writeEntityFile(entity, service);
  } catch (error) {
    logger.error(`Error writing entity rules: ${error}`);
    return false;
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
export async function writePackageRules(service: string, rules: Rule[]): Promise<boolean> {
  try {
    ensurePackageDirectoryStructure(service);
    const packageDir = getPackagePath(service);
    const files = listPackageYamlFiles(service);
    let targetFile: string | null = null;

    for (const f of files) {
      const s = parseSections(f);
      if (s.rules.length > 0) {
        if (targetFile === null) {
          targetFile = f;
        } else {
          s.rules = [];
          writeSections(f, s);
        }
      }
    }

    if (!targetFile) {
      targetFile = path.join(packageDir, 'rules.model.yaml');
    }

    const existing = fs.existsSync(targetFile)
      ? parseSections(targetFile)
      : { entities: [], relationships: [], rules: [], cases: [] };
    existing.rules = rules;
    writeSections(targetFile, existing);
    logger.info(`Package rules written to: ${targetFile}`);
    await commitChanges(targetFile, `Updated rules in ${service}`);
    return true;
  } catch (error) {
    logger.error(`Error writing package rules: ${error}`);
    return false;
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
export async function writeCaseRules(caseUuid: string, rules: Rule[]): Promise<boolean> {
  try {
    const c = await readCaseFile(caseUuid);
    if (!c) return false;
    c.rules = rules;
    c.updatedAt = new Date().toISOString();
    return await writeCaseFile(c);
  } catch (error) {
    logger.error(`Error writing case rules: ${error}`);
    return false;
  }
}

// ────────────────────────────────────────────────────────────────────────
// Global (cross-package) rules (#75) — project-root rules.yaml
// ────────────────────────────────────────────────────────────────────────

const getGlobalRulesPath = () => path.join(getDataDir(), 'rules.yaml');

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
export async function writeCaseFile(c: Case): Promise<boolean> {
  try {
    const owner = await findCaseOwner(c.uuid);
    if (owner) {
      const sections = parseSections(owner.filePath);
      sections.cases = sections.cases.filter(p => p.uuid !== c.uuid);
      sections.cases.push(c);
      writeSections(owner.filePath, sections);
      await commitChanges(owner.filePath, `Updated case: ${c.name}`);
      return true;
    }

    const targetPackage = await resolveCaseHomePackage(c);
    if (!targetPackage) {
      logger.error(`Cannot write case ${c.uuid}: no package found`);
      return false;
    }
    ensurePackageDirectoryStructure(targetPackage);
    const filename = `${sanitizeFsName(c.name || c.uuid)}.case.yaml`;
    const filePath = path.join(getPackagePath(targetPackage), filename);

    const sections: SectionsFile = fs.existsSync(filePath)
      ? parseSections(filePath)
      : { entities: [], relationships: [], rules: [], cases: [] };
    sections.cases.push(c);
    writeSections(filePath, sections);
    await commitChanges(filePath, `Added case: ${c.name}`);
    return true;
  } catch (error) {
    logger.error(`Error writing case: ${error}`);
    return false;
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

export async function deleteCaseFile(uuid: string): Promise<boolean> {
  try {
    const owner = await findCaseOwner(uuid);
    if (!owner) return false;
    const sections = parseSections(owner.filePath);
    sections.cases = sections.cases.filter(p => p.uuid !== uuid);
    writeSections(owner.filePath, sections);
    await commitChanges(owner.filePath, `Deleted case ${uuid}`);
    return true;
  } catch (error) {
    logger.error(`Error deleting case ${uuid}: ${error}`);
    return false;
  }
}

// ────────────────────────────────────────────────────────────────────────
// Dictionary metadata (legacy)
// ────────────────────────────────────────────────────────────────────────

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
      updatedAt: dictionary.updatedAt,
    };

    fs.writeFileSync(filePath, YAML.stringify(metadata), 'utf8');
    logger.info(`Dictionary metadata written to file: ${filePath}`);
    await commitChanges(filePath, `Updated dictionary metadata: ${dictionary.name}`);
    return true;
  } catch (error) {
    logger.error(`Error writing dictionary metadata: ${error}`);
    return false;
  }
}

export async function listAllDictionaries(): Promise<string[]> {
  try {
    const baseDir = getDataDir();
    const dictionaries: string[] = [];
    if (!fs.existsSync(baseDir)) return [];

    dictionaries.push(...await listPackages());

    const items = fs.readdirSync(baseDir);
    for (const item of items) {
      if (RESERVED_DIRS.has(item)) continue;
      if (dictionaries.includes(item)) continue;
      const itemPath = path.join(baseDir, item);
      if (fs.statSync(itemPath).isDirectory()) {
        const metadataPath = path.join(itemPath, 'metadata.yaml');
        if (fs.existsSync(metadataPath)) {
          dictionaries.push(item);
        }
      }
    }

    return dictionaries;
  } catch (error) {
    logger.error(`Error listing all dictionaries: ${error}`);
    return [];
  }
}
