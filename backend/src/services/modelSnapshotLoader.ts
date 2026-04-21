/**
 * Model snapshot loader (#86).
 *
 * Loads a complete ModelSnapshot from three source types:
 *   - 'service': current working copy on disk
 *   - 'git-ref': files at a specific git commit/branch/tag
 *   - 'snapshot': in-memory data (pass-through)
 */
import { ModelSnapshot, PackageSnapshot } from './logicalDiff.js';
import { serviceService } from './serviceService.js';
import { ruleService } from './ruleService.js';
import {
  listMicroservices,
  mergePackageSections,
  parseSectionsFromString,
  getReservedPackageFiles,
  ParsedSections,
} from '../utils/fileOperations.js';
import { config } from '../kernel/config.js';
import { logger } from '../utils/logger.js';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';

const execAsync = promisify(exec);

/**
 * Source descriptor for a model snapshot.
 *
 * `'all-services'` loads every service from the current working copy at once
 * (whole-model diff). For git-ref all-services, use `'git-ref'` with
 * `service` omitted — the ref loader already walks every service directory.
 */
export type SnapshotSource =
  | { type: 'service'; name: string }
  | { type: 'all-services' }
  | { type: 'git-ref'; ref: string; service?: string }
  | { type: 'snapshot'; data: ModelSnapshot };

/**
 * Load a ModelSnapshot from a source descriptor.
 */
export async function loadModelSnapshot(source: SnapshotSource): Promise<ModelSnapshot> {
  switch (source.type) {
    case 'service':
      return loadServiceSnapshot(source.name);
    case 'all-services':
      return loadAllServicesSnapshot();
    case 'git-ref':
      return loadGitRefSnapshot(source.ref, source.service);
    case 'snapshot':
      return source.data;
  }
}

/**
 * Load the current working copy of a single service as a snapshot.
 */
async function loadServiceSnapshot(serviceName: string): Promise<ModelSnapshot> {
  const pkg = await loadPackageFromDisk(serviceName);
  return { packages: [pkg] };
}

/**
 * Load every service from the current working copy into a single snapshot.
 *
 * Used by whole-model diffs — the returned `ModelSnapshot.packages` has one
 * entry per service, and each package carries its `service` name so the
 * diff engine can group results downstream.
 */
async function loadAllServicesSnapshot(): Promise<ModelSnapshot> {
  const serviceNames = await listMicroservices();
  const packages: PackageSnapshot[] = [];
  for (const name of serviceNames) {
    try {
      packages.push(await loadPackageFromDisk(name));
    } catch (e) {
      logger.warn(`Failed to load service '${name}' for whole-model snapshot: ${e}`);
    }
  }
  return { packages };
}

/**
 * Load a package's data from the current working copy on disk.
 */
async function loadPackageFromDisk(serviceName: string): Promise<PackageSnapshot> {
  const entities = await serviceService.getServiceEntities(serviceName);
  const relationships = await serviceService.getPackageRelationships(serviceName);
  const rules = await ruleService.listRules({ packageName: serviceName });

  return {
    packageName: serviceName,
    service: serviceName,
    entities,
    relationships,
    rules,
  };
}

/**
 * Load model data at a specific git ref (#109).
 *
 * Rewritten for the post-#105/#106 layout: packages live at the project
 * root, identified by a `package.yaml` marker; each `.yaml` inside a
 * package folder may carry any mix of the `entities:` / `relationships:`
 * / `rules:` / `perspectives:` sections. Section parsing and collision
 * detection are delegated to the shared helpers in `fileOperations` so
 * disk loads and git-ref loads stay byte-identical.
 *
 * The project root inside the git tree is inferred from the current
 * `config.dataDir` relative to the repo root — so opening a project at
 * `<repo>/samples/eshop/` reads its refs at `samples/eshop/…`, and a
 * repo where the project is the repo root reads at `…` (empty prefix).
 *
 * Against commits predating #105 (when packages lived at
 * `data-dictionaries/microservices/<svc>/`) we fail fast rather than
 * silently returning empty snapshots — the caller gets an empty
 * snapshot with a log line pointing at the discovery failure.
 */
async function loadGitRefSnapshot(ref: string, service?: string): Promise<ModelSnapshot> {
  const prefix = await resolveProjectPrefixAtRef(ref);
  if (prefix === null) {
    logger.warn(
      `No project found at ref '${ref}'. Ref may predate #104 ` +
      `(no dico.config.json) — returning an empty snapshot.`,
    );
    return { packages: [] };
  }

  const packageNames = service
    ? [service]
    : await listPackagesAtRef(ref, prefix);

  const packages: PackageSnapshot[] = [];
  for (const name of packageNames) {
    const pkg = await loadPackageFromGitRef(ref, prefix, name);
    if (pkg) packages.push(pkg);
  }
  return { packages };
}

/**
 * Resolve the project path inside the git tree at `ref`. Returns a path
 * with trailing `/` when the project lives in a subfolder, the empty
 * string when it's the repo root, or `null` when no project can be found.
 *
 * Strategy (stops on first hit): probe `dico.config.json` at
 *   1. the current `config.dataDir` (relative to the repo root) — the
 *      common case for recent commits,
 *   2. `data-dictionaries/` — where the project used to live before the
 *      post-#107 samples move,
 *   3. the repo root — projects whose repo IS the project.
 */
async function resolveProjectPrefixAtRef(ref: string): Promise<string | null> {
  let repoRoot: string;
  try {
    const { stdout } = await execAsync('git rev-parse --show-toplevel', {
      cwd: process.cwd(),
    });
    repoRoot = stdout.trim();
  } catch (e) {
    logger.warn(`Could not resolve git repo root: ${e}`);
    return null;
  }

  const candidates: string[] = [];
  const rel = path.relative(repoRoot, config.dataDir);
  const primary = !rel || rel === '.' || rel.startsWith('..') ? '' : rel.replace(/\\/g, '/') + '/';
  candidates.push(primary);
  if (primary !== 'data-dictionaries/') candidates.push('data-dictionaries/');
  if (primary !== '') candidates.push('');

  for (const prefix of candidates) {
    const marker = await readFileAtRef(ref, `${prefix}dico.config.json`);
    if (marker !== null) return prefix;
  }
  return null;
}

/**
 * Discover package folders at the ref: walk the project root at the
 * ref, keep entries that have a `package.yaml` child (#105 marker).
 */
async function listPackagesAtRef(ref: string, prefix: string): Promise<string[]> {
  try {
    const { stdout } = await execAsync(
      // `--full-tree` is critical: the backend's cwd is `backend/`, but
      // `prefix` is relative to the repo root. Without it, ls-tree
      // interprets the pathspec relative to cwd and returns nothing
      // (or worse — a stale/partial listing).
      `git ls-tree --name-only --full-tree "${ref}" "${prefix}"`,
      { cwd: process.cwd() },
    );
    const entries = stdout.trim().split('\n')
      .filter(Boolean)
      .map(line => line.replace(prefix, '').replace(/\/$/, ''))
      .filter(name => name && !name.startsWith('.') && name !== 'node_modules');

    const packages: string[] = [];
    for (const name of entries) {
      const markerPath = `${prefix}${name}/package.yaml`;
      const marker = await readFileAtRef(ref, markerPath);
      if (marker !== null) packages.push(name);
    }
    return packages;
  } catch (e) {
    logger.warn(`Failed to list packages at ref '${ref}': ${e}`);
    return [];
  }
}

/**
 * Load a single package's data at the ref. Reads every `.yaml` in the
 * package folder (excluding reserved filenames) via `git show`, feeds
 * them into the shared `mergePackageSections` helper so collision
 * detection and section merging match the on-disk loader exactly.
 */
async function loadPackageFromGitRef(
  ref: string,
  prefix: string,
  packageName: string,
): Promise<PackageSnapshot | null> {
  try {
    const basePath = `${prefix}${packageName}`;
    const yamlFiles = await listPackageYamlFilesAtRef(ref, basePath);

    const parsed: ParsedSections[] = [];
    for (const file of yamlFiles) {
      const fullPath = `${basePath}/${file}`;
      const content = await readFileAtRef(ref, fullPath);
      if (content === null) continue;
      parsed.push({
        label: `${ref}:${fullPath}`,
        sections: parseSectionsFromString(content, `${ref}:${fullPath}`, file),
      });
    }

    const model = mergePackageSections(packageName, parsed);
    return {
      packageName,
      service: packageName,
      entities: model.entities,
      relationships: model.relationships,
      rules: [
        ...model.rules,
        // Entity-scoped rules inlined on entities (#106) feed the same
        // diff engine — surface them in the flat rules list.
        ...model.entities.flatMap(e => e.rules || []),
      ],
    };
  } catch (e) {
    logger.warn(`Failed to load package '${packageName}' at ref '${ref}': ${e}`);
    return null;
  }
}

/**
 * List non-reserved `.yaml` files directly under a package at the ref.
 * Skips `package.yaml` and `metadata.yaml` (same reserved set the
 * on-disk loader uses).
 */
async function listPackageYamlFilesAtRef(ref: string, basePath: string): Promise<string[]> {
  try {
    const { stdout } = await execAsync(
      `git ls-tree --name-only --full-tree "${ref}" "${basePath}/"`,
      { cwd: process.cwd() },
    );
    const reserved = getReservedPackageFiles();
    return stdout.trim().split('\n')
      .filter(Boolean)
      .map(line => line.replace(`${basePath}/`, ''))
      .filter(f => f.endsWith('.yaml') && !reserved.has(f))
      // Legacy pre-#106 sidecars live alongside entity files — skip. Their
      // content is already inlined onto entities in the post-#106 layout.
      .filter(f => !f.endsWith('.comments.yaml'));
  } catch {
    return [];
  }
}

/**
 * Read a single file at a git ref via `git show`. Returns null when
 * the path does not exist at that ref.
 */
async function readFileAtRef(ref: string, filePath: string): Promise<string | null> {
  try {
    const { stdout } = await execAsync(
      `git show "${ref}:${filePath}"`,
      { cwd: process.cwd(), maxBuffer: 10 * 1024 * 1024 },
    );
    return stdout;
  } catch {
    return null;
  }
}
