/**
 * Model snapshot loader (#86).
 *
 * Loads a complete ModelSnapshot from three source types:
 *   - 'service': current working copy on disk
 *   - 'git-ref': files at a specific git commit/branch/tag
 *   - 'snapshot': in-memory data (pass-through)
 */
import { Entity, Relationship } from '../models/EntitySchema.js';
import { Rule } from '../models/Rule.js';
import { ModelSnapshot, PackageSnapshot } from './logicalDiff.js';
import { serviceService } from './serviceService.js';
import { ruleService } from './ruleService.js';
import {
  listMicroservices,
  getPackagePath,
  readRelationshipsFile,
} from '../utils/fileOperations.js';
import { logger } from '../utils/logger.js';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
// @ts-ignore — js-yaml has no declaration file in this project
import yaml from 'js-yaml';

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
 * Load model data at a specific git ref.
 *
 * Uses `git show {ref}:{path}` to read YAML files without checking out.
 * If `service` is specified, loads only that package; otherwise loads all.
 */
async function loadGitRefSnapshot(ref: string, service?: string): Promise<ModelSnapshot> {
  const packages: PackageSnapshot[] = [];

  if (service) {
    const pkg = await loadPackageFromGitRef(ref, service);
    if (pkg) packages.push(pkg);
  } else {
    // Discover all services at the given ref
    const serviceNames = await listServicesAtRef(ref);
    for (const svc of serviceNames) {
      const pkg = await loadPackageFromGitRef(ref, svc);
      if (pkg) packages.push(pkg);
    }
  }

  return { packages };
}

/**
 * List microservice directory names at a git ref.
 */
async function listServicesAtRef(ref: string): Promise<string[]> {
  try {
    const { stdout } = await execAsync(
      `git ls-tree --name-only ${ref} data-dictionaries/microservices/`,
      { cwd: process.cwd() },
    );
    return stdout.trim().split('\n').filter(Boolean).map(line => {
      // git ls-tree returns full paths or just names depending on trailing /
      const name = line.replace(/^data-dictionaries\/microservices\//, '').replace(/\/$/, '');
      return name;
    });
  } catch {
    return [];
  }
}

/**
 * Load a single package's data from a git ref.
 */
async function loadPackageFromGitRef(ref: string, serviceName: string): Promise<PackageSnapshot | null> {
  try {
    const basePath = `data-dictionaries/microservices/${serviceName}`;

    // List entity files at this ref
    const entityFiles = await listEntityFilesAtRef(ref, basePath);
    const entities: Entity[] = [];
    for (const file of entityFiles) {
      const content = await readFileAtRef(ref, `${basePath}/${file}`);
      if (content) {
        try {
          const entity = yaml.load(content) as Entity;
          if (entity && entity.uuid) entities.push(entity);
        } catch (e) {
          logger.warn(`Failed to parse entity ${file} at ${ref}: ${e}`);
        }
      }
    }

    // Read relationships.yaml
    const relContent = await readFileAtRef(ref, `${basePath}/relationships.yaml`);
    const relationships: Relationship[] = relContent
      ? (yaml.load(relContent) as Relationship[] || [])
      : [];

    // Read package-level rules.yaml
    const rulesContent = await readFileAtRef(ref, `${basePath}/rules.yaml`);
    const rules: Rule[] = rulesContent
      ? (yaml.load(rulesContent) as Rule[] || [])
      : [];

    // Read entity-sidecar rules
    const ruleFiles = await listFilesMatchingAtRef(ref, basePath, /\.rules\.yaml$/);
    for (const file of ruleFiles) {
      const content = await readFileAtRef(ref, `${basePath}/${file}`);
      if (content) {
        try {
          const entityRules = yaml.load(content) as Rule[];
          if (Array.isArray(entityRules)) rules.push(...entityRules);
        } catch { /* skip unparseable */ }
      }
    }

    return {
      packageName: serviceName,
      service: serviceName,
      entities,
      relationships,
      rules,
    };
  } catch (e) {
    logger.warn(`Failed to load package ${serviceName} at ${ref}: ${e}`);
    return null;
  }
}

/**
 * Read a single file at a git ref via `git show`.
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

/**
 * List entity YAML files (excluding metadata, relationships, rules, comments).
 */
async function listEntityFilesAtRef(ref: string, basePath: string): Promise<string[]> {
  try {
    const { stdout } = await execAsync(
      `git ls-tree --name-only "${ref}" "${basePath}/"`,
      { cwd: process.cwd() },
    );
    const allFiles = stdout.trim().split('\n').filter(Boolean).map(line =>
      line.replace(`${basePath}/`, ''),
    );
    // Filter to entity YAML files only
    const excluded = /^(metadata|relationships|rules)\.yaml$|\.comments\.yaml$|\.rules\.yaml$/;
    return allFiles.filter(f => f.endsWith('.yaml') && !excluded.test(f));
  } catch {
    return [];
  }
}

/**
 * List files matching a regex pattern at a git ref.
 */
async function listFilesMatchingAtRef(ref: string, basePath: string, pattern: RegExp): Promise<string[]> {
  try {
    const { stdout } = await execAsync(
      `git ls-tree --name-only "${ref}" "${basePath}/"`,
      { cwd: process.cwd() },
    );
    return stdout.trim().split('\n')
      .filter(Boolean)
      .map(line => line.replace(`${basePath}/`, ''))
      .filter(f => pattern.test(f));
  } catch {
    return [];
  }
}
