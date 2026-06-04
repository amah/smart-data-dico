/**
 * Standalone data-dictionary project validator.
 *
 * Runs the SAME code paths the application uses when it loads a project
 * folder (the content-driven multi-kind loader in `fileOperations` +
 * `EntitySchema`/`Rule` validators + the derived-types graph check) and
 * reports every problem up front, with file paths and identifiers — so a
 * user never hits a runtime crash or a silent "Failed to load graph".
 *
 * It REUSES the real validators rather than re-implementing the format:
 *   - `mergePackageSections` / `loadPackage`  → collision detection
 *   - `validateEntity` / `validateRelationship` / `normalizeRelationship`
 *   - `validateRule`
 *   - `validateDerivedTypes`                  → circular-derivation check
 * and layers explicit cross-reference resolution on top (relationship
 * endpoints, rule targets, action ownerRef/invokeAction, state-machine
 * ownerRef/states/transitions/invoke).
 *
 * The script seeds an in-memory storage backend from the target directory
 * and points `config.dataDir` at it, so the loader operates against the
 * project under test exactly as the running server would.
 *
 * Usage:
 *   tsx src/scripts/validateDico.ts [<projectDir> | --data-dir <projectDir>]
 *   npm run validate:dico -- <projectDir>
 *
 *   <projectDir>   Folder containing dico.config.json. Defaults to
 *                  config.dataDir (the dev sample, or $DATA_DIR).
 *   --help, -h     Show this usage.
 *
 * Exit code: 0 when no errors (warnings allowed), 1 when any error found.
 */
import fs from 'fs';
import path from 'path';
import YAML from 'yaml';

import { config } from '../kernel/config.js';
import { storageRegistry } from '../storage/contract/StorageBackendToken.js';
import { InMemoryStorageBackend } from '../storage/memory/InMemoryStorageBackend.js';
import { wsId, type WorkspaceId } from '../storage/contract/types.js';

import {
  listPackages,
  loadPackage,
  parseSectionsFromString,
  mergePackageSections,
  getReservedPackageFiles,
  type ParsedSections,
  type PackageModel,
} from '../utils/fileOperations.js';
import {
  validateEntity,
  normalizeRelationship,
  type Entity,
  type Attribute,
} from '../models/EntitySchema.js';
import { isValidUUID } from '../utils/uuid.js';
import { validateRule } from '../models/Rule.js';
import { FLOW_STEP_KINDS, type FlowStep } from '../models/Action.js';
import { validateDerivedTypes, type DerivedType } from '../services/dicoConfigService.js';

const WS = wsId('dictionaries');

// ── Finding model ──────────────────────────────────────────────────────────

type Severity = 'error' | 'warning';

interface Finding {
  severity: Severity;
  /** Short stable category, e.g. 'relationship.endpoint'. */
  code: string;
  message: string;
  /** Best-effort file path (absolute) or label for the offending content. */
  file?: string;
  /** Offending identifier (uuid/name) when known. */
  identifier?: string;
}

class Report {
  readonly findings: Finding[] = [];
  add(f: Finding): void { this.findings.push(f); }
  error(code: string, message: string, file?: string, identifier?: string): void {
    this.add({ severity: 'error', code, message, file, identifier });
  }
  warn(code: string, message: string, file?: string, identifier?: string): void {
    this.add({ severity: 'warning', code, message, file, identifier });
  }
  get errorCount(): number { return this.findings.filter(f => f.severity === 'error').length; }
  get warnCount(): number { return this.findings.filter(f => f.severity === 'warning').length; }
}

// ── Backend seeding (mirrors registerStorageBackend.seedFromDisk) ────────────

/**
 * Walk `root` and load every file into the in-memory backend, then register
 * it and point `config.dataDir` at `root`. Skips `node_modules/` and `.git/`.
 * Returns the count of files seeded.
 */
function seedBackendFromDisk(root: string): number {
  const backend = new InMemoryStorageBackend();
  let count = 0;
  const walk = (dir: string, rel: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '.git') continue;
        walk(abs, relPath);
      } else if (entry.isFile()) {
        const content = fs.readFileSync(abs, 'utf8');
        const wsKey = String(WS as WorkspaceId);
        const bucket = backend.files.get(wsKey);
        if (bucket) bucket.set(relPath, content);
        else backend.files.set(wsKey, new Map([[relPath, content]]));
        count++;
      }
    }
  };
  walk(root, '');
  storageRegistry.setBackend(backend);
  config.dataDir = root;
  return count;
}

// ── Checks ───────────────────────────────────────────────────────────────────

/**
 * Check 1: dico.config.json present + parseable; derived types resolve and
 * are not circular. Returns the parsed derived types for downstream
 * attribute-type resolution (empty list on any failure).
 */
function checkConfig(root: string, report: Report): DerivedType[] {
  const configPath = path.join(root, 'dico.config.json');
  if (!fs.existsSync(configPath)) {
    report.error('config.missing', 'dico.config.json not found at project root', configPath);
    return [];
  }
  let parsed: { version?: unknown; types?: unknown };
  try {
    parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (e) {
    report.error('config.parse', `dico.config.json is not valid JSON: ${(e as Error).message}`, configPath);
    return [];
  }
  if (parsed.version !== undefined && typeof parsed.version !== 'number') {
    report.warn('config.version', 'dico.config.json "version" should be a number', configPath);
  }
  const types: DerivedType[] = Array.isArray(parsed.types) ? (parsed.types as DerivedType[]) : [];
  // REUSE the exact circularity/structure check behind PUT /api/config/types.
  for (const err of validateDerivedTypes(types)) {
    report.error('config.derivedType', err, configPath);
  }
  return types;
}

/**
 * Check 2: every top-level package folder has a package.yaml marker; warn
 * if a folder looks like a package (has *.yaml) but lacks the marker.
 * Returns the list of discovered (marker-bearing) package names — the same
 * set `listPackages()` will surface to the app.
 */
function checkPackageMarkers(root: string, report: Report): string[] {
  const RESERVED = new Set(['.dico', '.git', 'node_modules']);
  const markered: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return markered;
  }
  for (const e of entries) {
    if (!e.isDirectory() || RESERVED.has(e.name)) continue;
    const dir = path.join(root, e.name);
    const hasMarker = fs.existsSync(path.join(dir, 'package.yaml'));
    if (hasMarker) {
      markered.push(e.name);
      continue;
    }
    const hasYaml = safeReaddir(dir).some(f => f.endsWith('.yaml'));
    if (hasYaml) {
      report.warn(
        'package.missingMarker',
        `Folder '${e.name}' contains .yaml files but no package.yaml marker — it will NOT load as a package`,
        dir,
        e.name,
      );
    }
  }
  return markered;
}

function safeReaddir(dir: string): string[] {
  try { return fs.readdirSync(dir); } catch { return []; }
}

/** Author-chosen slug ids (relationship/action/transition uuids) — kebab/alnum. */
function looksLikeSlug(s: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(s);
}

/**
 * Load a package the SAME way the app does (parse every non-reserved .yaml,
 * merge sections, detect collisions). Collisions throw inside
 * `mergePackageSections`; we catch and report. Returns the merged model, or
 * null when the merge threw (collision / fatal parse).
 *
 * We build the ParsedSections list from disk directly (rather than via the
 * async storage-backed `loadPackage`) so the `label` in collision messages
 * is the absolute file path, and so a parse/merge throw is attributable.
 */
function loadPackageModelFromDisk(root: string, pkg: string, report: Report): PackageModel | null {
  const dir = path.join(root, pkg);
  const reserved = getReservedPackageFiles();
  const files = safeReaddir(dir)
    .filter(f => f.endsWith('.yaml') && !reserved.has(f))
    .sort();
  const parsed: ParsedSections[] = [];
  for (const f of files) {
    const abs = path.join(dir, f);
    const raw = fs.readFileSync(abs, 'utf8');
    // Surface hard YAML syntax errors (parseSectionsFromString swallows them
    // into an empty section + a logger.warn — we want them as findings).
    try {
      YAML.parse(raw);
    } catch (e) {
      report.error('yaml.parse', `YAML parse error: ${(e as Error).message}`, abs);
      continue;
    }
    parsed.push({ label: abs, sections: parseSectionsFromString(raw, abs, f) });
  }
  try {
    return mergePackageSections(pkg, parsed);
  } catch (e) {
    // Collision (entity name/uuid, rule/case/relationship/action/sm uuid) —
    // message already cites BOTH paths.
    report.error('collision', (e as Error).message, dir, pkg);
    return null;
  }
}

/**
 * Coerce a `properties`/`attributes` value into an attribute array. The
 * schema permits `properties` to be either an array of attributes or a
 * keyed object map (`type: ['array','object']`), so handle both.
 */
function asAttributeArray(v: unknown): Attribute[] {
  if (Array.isArray(v)) return v as Attribute[];
  if (v && typeof v === 'object') return Object.values(v as Record<string, Attribute>);
  return [];
}

/** Recursively collect every attribute (incl. nested properties/items). */
function collectAttributes(attrs: unknown, acc: Attribute[]): void {
  for (const a of asAttributeArray(attrs)) {
    if (!a || typeof a !== 'object') continue;
    acc.push(a);
    if (a.properties) collectAttributes(a.properties, acc);
    // `items` is a single nested attribute, not a map — wrap it.
    if (a.items && typeof a.items === 'object') collectAttributes([a.items], acc);
  }
}

/**
 * Checks 4–8 over a fully merged package model.
 *
 * `globalEntityUuids` spans every package: relationships in the shipped
 * sample legitimately cross package boundaries (an Order in order-service
 * points at a User in user-service), and the graph builder resolves
 * endpoints across all loaded packages — so endpoint/owner resolution is
 * checked globally, not just within the owning package.
 *
 * Severity policy mirrors what the app ACTUALLY enforces at load time:
 *   - Collisions, bad entity/attribute UUIDs, malformed relationship shape,
 *     and endpoints that resolve to NO entity anywhere → ERROR (these break
 *     load / the graph).
 *   - Rich shape checks the loader does NOT run (validateRule, slug-uuid
 *     pattern on relationships/actions, rule-target resolution) → WARNING,
 *     so the validator stays faithful and passes on a healthy project while
 *     still surfacing quality issues.
 */
function checkPackageModel(
  pkg: string,
  model: PackageModel,
  globalEntityUuids: Set<string>,
  globalAttrUuids: Map<string, string>,
  report: Report,
): void {
  const fileOf = model.ownership;

  // ── Check 4: entities validate; attribute UUIDs valid + globally unique ──
  for (const entity of model.entities) {
    const label = fileOf.entityByName.get(entity.name) || fileOf.entityByUuid.get(entity.uuid) || pkg;
    const { valid, errors } = validateEntity(entity);
    if (!valid) {
      for (const err of errors) {
        report.error('entity.invalid', `Entity '${entity.name}': ${err}`, label, entity.uuid);
      }
    }
    // Deep attribute UUID validity + global uniqueness (validateEntity only
    // checks top-level attribute UUIDs, not nested properties/items).
    const allAttrs: Attribute[] = [];
    collectAttributes(entity.attributes, allAttrs);
    for (const attr of allAttrs) {
      if (!isValidUUID(attr.uuid)) {
        report.error(
          'attribute.badUuid',
          `Attribute '${attr.name}' on entity '${entity.name}' has invalid UUID '${attr.uuid}'`,
          label, attr.uuid,
        );
        continue;
      }
      const prior = globalAttrUuids.get(attr.uuid);
      if (prior) {
        report.error(
          'attribute.duplicateUuid',
          `Duplicate attribute UUID '${attr.uuid}' (attribute '${attr.name}' on entity '${entity.name}'): also used at ${prior}`,
          label, attr.uuid,
        );
      } else {
        globalAttrUuids.set(attr.uuid, `${label} (entity '${entity.name}', attribute '${attr.name}')`);
      }
    }
  }

  // ── Check 5: relationships — shape resolvable + endpoints resolve ──
  // NOTE: the loader runs `normalizeRelationship` (shape) but NOT
  // `validateRelationship` (which would reject slug uuids like
  // `rel-order-item-001` that the shipped sample uses). We follow the
  // loader: shape + endpoint resolution are errors; a non-UUID `uuid` is a
  // warning only.
  for (const rel of model.relationships) {
    const label = fileOf.relationshipByUuid.get(rel.uuid) || pkg;
    if (!rel.uuid) {
      report.error('relationship.noUuid', `A relationship in package '${pkg}' has no uuid`, label);
      continue;
    }
    if (!isValidUUID(rel.uuid) && !looksLikeSlug(rel.uuid)) {
      report.warn('relationship.uuid', `Relationship '${rel.uuid}' uuid is neither a UUID nor a clean slug`, label, rel.uuid);
    }
    const normalized = normalizeRelationship(rel);
    if (!normalized) {
      report.error(
        'relationship.shape',
        `Relationship '${rel.uuid}' has neither ends[] nor source/target — it cannot be loaded (this is the "Failed to load graph" class)`,
        label, rel.uuid,
      );
      continue;
    }
    // Endpoint entity UUIDs must resolve to SOME entity across the loaded
    // project. An endpoint that resolves nowhere is the bug class behind
    // "Failed to load graph".
    for (const end of normalized.ends ?? []) {
      if (!end?.entity) {
        report.error('relationship.endpoint', `Relationship '${rel.uuid}' has an end with no entity UUID`, label, rel.uuid);
      } else if (!globalEntityUuids.has(end.entity)) {
        report.error(
          'relationship.endpoint',
          `Relationship '${rel.uuid}' endpoint entity '${end.entity}' does not resolve to any entity in the project`,
          label, rel.uuid,
        );
      }
    }
  }

  // ── Check 6: rules validate; entity-scoped targets resolve ──
  const allRules = [
    ...model.rules,
    ...model.entities.flatMap(e => (e.rules || []).map(r => ({ rule: r, owner: e }))),
  ].map(r => ('rule' in r ? r : { rule: r, owner: undefined as Entity | undefined }));

  for (const { rule, owner } of allRules) {
    const label = (owner && (fileOf.entityByUuid.get(owner.uuid) || fileOf.entityByName.get(owner.name)))
      || fileOf.ruleByUuid.get(rule.uuid)
      || pkg;
    // The loader does NOT call validateRule (the shipped sample has rules
    // missing `enforcement`), so shape problems are warnings, not errors.
    for (const err of validateRule(rule)) {
      report.warn('rule.shape', `Rule '${rule.name || rule.uuid}': ${err}`, label, rule.uuid);
    }
    if (rule.scope === 'entity' && rule.entityUuid && !globalEntityUuids.has(rule.entityUuid)) {
      report.error(
        'rule.entityRef',
        `Entity-scoped rule '${rule.name || rule.uuid}' entityUuid '${rule.entityUuid}' does not resolve to any entity in the project`,
        label, rule.uuid,
      );
    }
    for (const t of rule.targets || []) {
      if ((t.kind === 'entity' || t.kind === 'attribute') && t.uuid && isValidUUID(t.uuid)) {
        const known = globalEntityUuids.has(t.uuid) || globalAttrUuids.has(t.uuid);
        if (!known) {
          report.warn(
            'rule.targetRef',
            `Rule '${rule.name || rule.uuid}' target '${t.uuid}' (${t.kind}) does not resolve in the project`,
            label, rule.uuid,
          );
        }
      }
    }
  }

  // ── Check 7: actions — ownerRef resolves; flow kinds valid; invoke resolves ──
  const actionUuids = new Set(model.actions.map(a => a.uuid));
  for (const action of model.actions) {
    const label = fileOf.actionByUuid.get(action.uuid) || pkg;
    if (!action.ownerRef || !globalEntityUuids.has(action.ownerRef)) {
      report.error(
        'action.ownerRef',
        `Action '${action.name}' ownerRef '${action.ownerRef}' does not resolve to any entity in the project`,
        label, action.uuid,
      );
    }
    checkFlowSteps(action.flow, action.uuid, action.name, label, actionUuids, report);
  }

  // ── Check 8: state machines ──
  for (const sm of model.stateMachines) {
    const label = fileOf.stateMachineByUuid.get(sm.uuid) || pkg;
    if (!sm.ownerRef || !globalEntityUuids.has(sm.ownerRef)) {
      report.error(
        'stateMachine.ownerRef',
        `State machine '${sm.name}' ownerRef '${sm.ownerRef}' does not resolve to an entity in package '${pkg}'`,
        label, sm.uuid,
      );
    }
    const stateNames = new Set((sm.states || []).map(s => s.name));
    if (!sm.initialState || !stateNames.has(sm.initialState)) {
      report.error(
        'stateMachine.initialState',
        `State machine '${sm.name}' initialState '${sm.initialState}' is not a declared state`,
        label, sm.uuid,
      );
    }
    if (sm.stateAttribute) {
      const owner = model.entities.find(e => e.uuid === sm.ownerRef);
      const attrNames = new Set((owner?.attributes || []).map(a => a.name));
      if (owner && !attrNames.has(sm.stateAttribute)) {
        report.warn(
          'stateMachine.stateAttribute',
          `State machine '${sm.name}' stateAttribute '${sm.stateAttribute}' is not an attribute on owner '${owner.name}'`,
          label, sm.uuid,
        );
      }
    }
    const txUuids = new Set<string>();
    for (const tx of sm.transitions || []) {
      if (tx.uuid) {
        if (txUuids.has(tx.uuid)) {
          report.error('stateMachine.transitionUuid', `State machine '${sm.name}' has duplicate transition uuid '${tx.uuid}'`, label, sm.uuid);
        }
        txUuids.add(tx.uuid);
      }
      if (tx.from !== '*' && !stateNames.has(tx.from)) {
        report.error(
          'stateMachine.transitionFrom',
          `State machine '${sm.name}' transition '${tx.uuid}' from-state '${tx.from}' is not declared (or '*')`,
          label, sm.uuid,
        );
      }
      if (!stateNames.has(tx.to)) {
        report.error(
          'stateMachine.transitionTo',
          `State machine '${sm.name}' transition '${tx.uuid}' to-state '${tx.to}' is not a declared state`,
          label, sm.uuid,
        );
      }
      for (const ref of tx.invoke || []) {
        if (!actionUuids.has(ref)) {
          report.error(
            'stateMachine.invokeRef',
            `State machine '${sm.name}' transition '${tx.uuid}' invokes unknown action '${ref}' in package '${pkg}'`,
            label, sm.uuid,
          );
        }
      }
    }
  }
}

/** Walk action flow steps (incl. nested branch then/else), validating kind + invokeAction refs. */
function checkFlowSteps(
  flow: FlowStep[] | undefined,
  actionUuid: string,
  actionName: string,
  label: string,
  actionUuids: Set<string>,
  report: Report,
): void {
  for (const step of flow || []) {
    if (!FLOW_STEP_KINDS.has(step.kind)) {
      report.error('action.flowKind', `Action '${actionName}' has flow step with invalid kind '${(step as { kind: string }).kind}'`, label, actionUuid);
      continue;
    }
    if (step.kind === 'invokeAction') {
      if (!actionUuids.has(step.actionRef)) {
        report.error(
          'action.invokeRef',
          `Action '${actionName}' invokeAction references unknown action '${step.actionRef}'`,
          label, actionUuid,
        );
      }
    }
    if (step.kind === 'branch') {
      checkFlowSteps(step.then, actionUuid, actionName, label, actionUuids, report);
      checkFlowSteps(step.else, actionUuid, actionName, label, actionUuids, report);
    }
  }
}

// ── Reporting ────────────────────────────────────────────────────────────────

function printReport(report: Report, root: string): void {
  const errors = report.findings.filter(f => f.severity === 'error');
  const warnings = report.findings.filter(f => f.severity === 'warning');

  const line = (f: Finding): string => {
    const loc = f.file ? ` ${path.relative(root, f.file) || f.file}` : '';
    const id = f.identifier ? ` [${f.identifier}]` : '';
    return `  [${f.code}]${loc}${id}\n      ${f.message}`;
  };

  console.error(`\nValidating data-dictionary project: ${root}\n`);
  if (errors.length > 0) {
    console.error(`ERRORS (${errors.length}):`);
    for (const f of errors) console.error(line(f));
    console.error('');
  }
  if (warnings.length > 0) {
    console.error(`WARNINGS (${warnings.length}):`);
    for (const f of warnings) console.error(line(f));
    console.error('');
  }
  if (errors.length === 0 && warnings.length === 0) {
    console.error('OK — no problems found.\n');
  } else {
    console.error(`Summary: ${errors.length} error(s), ${warnings.length} warning(s).\n`);
  }
}

const USAGE = `Validate a Smart Data Dictionary project folder.

Usage:
  tsx src/scripts/validateDico.ts [<projectDir> | --data-dir <projectDir>]
  npm run validate:dico -- <projectDir>

  <projectDir>   Folder containing dico.config.json. Defaults to the
                 configured dataDir ($DATA_DIR or the dev sample).
  --help, -h     Show this usage.

Exit code 0 when no errors (warnings allowed), 1 when any error is found.`;

/** Parse argv into a project dir. Returns null on --help. */
export function resolveProjectDir(argv: string[]): string | null {
  if (argv.includes('--help') || argv.includes('-h')) return null;
  const flagIdx = argv.indexOf('--data-dir');
  if (flagIdx >= 0 && argv[flagIdx + 1]) return path.resolve(argv[flagIdx + 1]);
  const positional = argv.find(a => !a.startsWith('-'));
  if (positional) return path.resolve(positional);
  return path.resolve(config.dataDir);
}

/**
 * Run the full validation against `root` into `report`. Pure of process
 * concerns (no exit / argv) so tests can call it directly.
 */
export async function validateProject(root: string, report: Report): Promise<void> {
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    report.error('project.missing', `Project directory not found: ${root}`, root);
    return;
  }

  seedBackendFromDisk(root);

  checkConfig(root, report);
  const packages = checkPackageMarkers(root, report);

  // Cross-package attribute UUID uniqueness + reference resolution.
  const globalAttrUuids = new Map<string, string>();

  // First pass: merge all packages (collision detection) and keep the models.
  const models: Array<{ pkg: string; model: PackageModel }> = [];
  for (const pkg of packages) {
    const model = loadPackageModelFromDisk(root, pkg, report);
    if (model) models.push({ pkg, model });
  }

  // Cross-check that the disk-merge agrees with the app's async loader
  // (catches any divergence in discovery / reserved-file handling).
  try {
    const appPackages = await listPackages();
    for (const pkg of appPackages) {
      if (!packages.includes(pkg)) {
        report.warn('package.discovery', `Loader discovered package '${pkg}' that the marker scan missed`, path.join(root, pkg), pkg);
      }
      // Force the app loader to run its merge too — surfaces collisions that
      // only the async path would hit (it should match the disk path).
      try { await loadPackage(pkg); }
      catch (e) { report.error('collision', (e as Error).message, path.join(root, pkg), pkg); }
    }
  } catch (e) {
    report.warn('loader.unavailable', `App loader cross-check failed: ${(e as Error).message}`, root);
  }

  // Build the project-wide entity-uuid set so cross-package references
  // (relationship endpoints, action/sm ownerRef, rule targets) resolve.
  const globalEntityUuids = new Set<string>();
  for (const { model } of models) {
    for (const e of model.entities) if (e.uuid) globalEntityUuids.add(e.uuid);
  }

  for (const { pkg, model } of models) {
    checkPackageModel(pkg, model, globalEntityUuids, globalAttrUuids, report);
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(USAGE);
    process.exit(0);
  }
  const root = resolveProjectDir(argv);
  if (!root) { console.log(USAGE); process.exit(0); }

  const report = new Report();
  await validateProject(root, report);
  printReport(report, root);
  process.exit(report.errorCount > 0 ? 1 : 0);
}

// Run only when invoked directly (not when imported by tests).
const invokedDirectly = process.argv[1] && process.argv[1].endsWith('validateDico.ts');
if (invokedDirectly) {
  main().catch((e) => {
    console.error(`validateDico crashed: ${e?.stack || e}`);
    process.exit(2);
  });
}

export { Report };
export type { Finding };
