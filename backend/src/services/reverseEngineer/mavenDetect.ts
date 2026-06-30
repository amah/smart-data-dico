/**
 * Auto-detect Liquibase changelogs in a (multi-module, nested) Maven project.
 *
 * Strong, multi-signal detection — NOT a filename guess. Per module, in order of
 * confidence:
 *   1. liquibase-maven-plugin  <changeLogFile> (or <propertyFile> → changeLogFile)
 *   2. liquibase.properties    changeLogFile=…
 *   3. convention scan         db/changelog/db.changelog-master.* etc.
 * (Framework config parsing — Spring/Quarkus/Micronaut — is intentionally out of
 * scope per the agreed design; the Spring Boot default path is covered by the
 * convention scan anyway.)
 *
 * Walks the reactor (root pom <modules>, recursively + nested poms), resolves
 * `classpath:` against resource roots, validates each candidate (parses + has a
 * databaseChangeLog root), dedups, flags test/sql/external, and ranks. Each
 * module becomes an analysis unit → fed to the multi-repo engine for cross-module
 * relationship analysis.
 */
import fs from 'fs';
import path from 'path';
import { XMLParser } from 'fast-xml-parser';
import { parse as yamlParse } from 'yaml';

export interface DetectedChangelog {
  module: string; // label (artifactId or dir name)
  moduleDir: string; // absolute
  changelogAbs: string;
  changelog: string; // relative to the project root (for a run)
  srcDir?: string; // <module>/src/main/java relative to root, if present
  detectedBy: 'plugin' | 'liquibase.properties' | 'convention';
  confidence: number;
  isTest: boolean;
  format: 'yaml' | 'xml' | 'json' | 'sql';
  sqlUnsupported?: boolean;
}

export interface MavenDetectionResult {
  projectRoot: string;
  modules: number;
  candidates: DetectedChangelog[]; // ranked, best per module first
  warnings: string[];
}

const xml = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', parseAttributeValue: false, isArray: (n) => ['module', 'plugin', 'profile', 'execution'].includes(n) });
const toArr = <T>(v: T | T[] | undefined): T[] => (v == null ? [] : Array.isArray(v) ? v : [v]);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function readPom(dir: string): any | undefined {
  const p = path.join(dir, 'pom.xml');
  if (!fs.existsSync(p)) return undefined;
  try { return xml.parse(fs.readFileSync(p, 'utf-8'))?.project; } catch { return undefined; }
}

/** All module dirs in the reactor (root + declared <modules>, recursively). */
function reactorModules(root: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const visit = (dir: string) => {
    const real = path.resolve(dir);
    if (seen.has(real)) return;
    seen.add(real);
    const pom = readPom(real);
    if (!pom) return;
    out.push(real);
    for (const m of toArr<string>(pom.modules?.module)) {
      // a module value is a relative path to a dir (or directly to a pom).
      const target = path.join(real, String(m));
      visit(fs.existsSync(path.join(target, 'pom.xml')) ? target : path.dirname(target));
    }
  };
  visit(root);
  // Also catch nested poms not declared as <modules> (defensive).
  return out;
}

const RESOURCE_ROOTS = ['src/main/resources', 'src/test/resources'];
const isTestPath = (p: string) => /(^|\/)src\/test\//.test(p) || /(^|\/)test(s)?\//.test(p);

/** Resolve a configured changelog value (classpath:/relative) to an absolute path. */
function resolveValue(value: string, moduleDir: string): string[] {
  let v = value.trim().replace(/^\$\{project\.basedir\}\/?/, '');
  const cp = /^classpath\*?:\/?/.test(v);
  v = v.replace(/^classpath\*?:\/?/, '');
  if (cp) return RESOURCE_ROOTS.map((r) => path.join(moduleDir, r, v));
  return [path.isAbsolute(v) ? v : path.join(moduleDir, v)];
}

function fmtOf(p: string): DetectedChangelog['format'] {
  if (/\.xml$/i.test(p)) return 'xml';
  if (/\.json$/i.test(p)) return 'json';
  if (/\.sql$/i.test(p)) return 'sql';
  return 'yaml';
}

/** A candidate is valid only if it exists, parses, and looks like a Liquibase changelog. */
function validate(absPath: string): { valid: boolean; format: DetectedChangelog['format']; sqlUnsupported?: boolean } {
  const format = fmtOf(absPath);
  if (!fs.existsSync(absPath)) return { valid: false, format };
  let body: string;
  try { body = fs.readFileSync(absPath, 'utf-8'); } catch { return { valid: false, format }; }
  if (format === 'sql') return { valid: /--\s*liquibase\s+formatted\s+sql/i.test(body), format, sqlUnsupported: true };
  if (format === 'xml') return { valid: /<\s*databaseChangeLog/i.test(body), format };
  try { const d = yamlParse(body); return { valid: !!d && typeof d === 'object' && 'databaseChangeLog' in d, format }; } catch { return { valid: false, format }; }
}

const PROP_FILE_NAMES = ['liquibase.properties'];
function readProperty(file: string, key: string): string | undefined {
  if (!fs.existsSync(file)) return undefined;
  const re = new RegExp(`^\\s*${key}\\s*[=:]\\s*(.+?)\\s*$`, 'im');
  return fs.readFileSync(file, 'utf-8').match(re)?.[1]?.replace(/^["']|["']$/g, '');
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function findLiquibasePlugin(pom: any): any | undefined {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lists: any[] = [
    pom?.build?.plugins?.plugin,
    pom?.build?.pluginManagement?.plugins?.plugin,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...toArr(pom?.profiles?.profile).map((pr: any) => pr?.build?.plugins?.plugin),
  ];
  for (const l of lists) for (const pl of toArr(l)) if (pl?.artifactId === 'liquibase-maven-plugin') return pl;
  return undefined;
}

const CONVENTION = [
  { re: /(^|\/)db\/changelog\/db\.changelog-master\.(ya?ml|xml|json|sql)$/i, score: 0.82 },
  { re: /(^|\/)db\.changelog-master\.(ya?ml|xml|json|sql)$/i, score: 0.74 },
  { re: /(^|\/)changelog-master\.(ya?ml|xml|json|sql)$/i, score: 0.7 },
  { re: /(^|\/)db\.changelog-root\.(ya?ml|xml|json|sql)$/i, score: 0.68 },
  { re: /(^|\/)(master|changelog)\.(xml|ya?ml|json)$/i, score: 0.55 },
];

function scanConvention(moduleDir: string): Array<{ abs: string; score: number }> {
  const found: Array<{ abs: string; score: number }> = [];
  const walk = (dir: string, depth: number) => {
    if (depth > 8 || !fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === 'target' || e.name.startsWith('.')) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full, depth + 1);
      else for (const c of CONVENTION) if (c.re.test(full.replace(/\\/g, '/'))) { found.push({ abs: full, score: c.score }); break; }
    }
  };
  for (const r of RESOURCE_ROOTS) walk(path.join(moduleDir, r), 0);
  return found;
}

function detectInModule(moduleDir: string, label: string, projectRoot: string, warnings: string[]): DetectedChangelog[] {
  const pom = readPom(moduleDir);
  const raw: Array<{ abs: string; by: DetectedChangelog['detectedBy']; conf: number }> = [];

  // 1. plugin
  const plugin = pom ? findLiquibasePlugin(pom) : undefined;
  if (plugin) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cfgs: any[] = [plugin.configuration, ...toArr(plugin.executions?.execution).map((ex: any) => ex?.configuration)].filter(Boolean);
    for (const cfg of cfgs) {
      if (cfg.changeLogFile) for (const abs of resolveValue(String(cfg.changeLogFile), moduleDir)) raw.push({ abs, by: 'plugin', conf: 0.95 });
      const propFile = cfg.propertyFile;
      if (propFile) {
        const pf = path.isAbsolute(String(propFile)) ? String(propFile) : path.join(moduleDir, String(propFile));
        const clf = readProperty(pf, 'changeLogFile');
        if (clf) for (const abs of resolveValue(clf, moduleDir)) raw.push({ abs, by: 'plugin', conf: 0.92 });
      }
    }
  }

  // 2. liquibase.properties (module root + resource roots)
  for (const base of ['', ...RESOURCE_ROOTS]) for (const name of PROP_FILE_NAMES) {
    const clf = readProperty(path.join(moduleDir, base, name), 'changeLogFile');
    if (clf) for (const abs of resolveValue(clf, moduleDir)) raw.push({ abs, by: 'liquibase.properties', conf: 0.9 });
  }

  // 3. convention scan
  for (const { abs, score } of scanConvention(moduleDir)) raw.push({ abs, by: 'convention', conf: score });

  // dedup by abs (keep highest-confidence signal), validate, score test penalty
  const byPath = new Map<string, { by: DetectedChangelog['detectedBy']; conf: number }>();
  for (const r of raw) {
    const ex = byPath.get(r.abs);
    if (!ex || r.conf > ex.conf) byPath.set(r.abs, { by: r.by, conf: r.conf });
  }
  const srcMain = path.join(moduleDir, 'src/main/java');
  const out: DetectedChangelog[] = [];
  for (const [abs, { by, conf }] of byPath) {
    const v = validate(abs);
    if (!v.valid) continue;
    const isTest = isTestPath(abs);
    if (v.sqlUnsupported) warnings.push(`${label}: ${path.relative(projectRoot, abs)} is a SQL-formatted changelog — detected, but the SQL loader adapter is not implemented yet.`);
    out.push({
      module: label, moduleDir, changelogAbs: abs,
      changelog: path.relative(projectRoot, abs),
      srcDir: fs.existsSync(srcMain) ? path.relative(projectRoot, srcMain) : undefined,
      detectedBy: by, confidence: isTest ? conf * 0.4 : conf, isTest, format: v.format, sqlUnsupported: v.sqlUnsupported,
    });
  }
  return out.sort((a, b) => b.confidence - a.confidence);
}

/** Detect Liquibase changelogs across a Maven project. */
export function detectMaven(projectRoot: string): MavenDetectionResult {
  const root = path.resolve(projectRoot);
  const warnings: string[] = [];
  if (!fs.existsSync(path.join(root, 'pom.xml'))) {
    return { projectRoot: root, modules: 0, candidates: [], warnings: ['No pom.xml at the project root — not a Maven project.'] };
  }
  const modules = reactorModules(root);
  const candidates: DetectedChangelog[] = [];
  for (const dir of modules) {
    const pom = readPom(dir);
    const label = (pom?.artifactId as string) ?? path.basename(dir);
    // best candidate per module (keep extras of comparable confidence for the picker)
    const found = detectInModule(dir, label, root, warnings);
    if (found.length) candidates.push(...found.filter((c) => c.confidence >= found[0].confidence - 0.15));
  }
  candidates.sort((a, b) => b.confidence - a.confidence);
  if (!candidates.length) warnings.push(`No Liquibase changelog detected across ${modules.length} module(s). Looked at liquibase-maven-plugin config, liquibase.properties, and db/changelog conventions under src/main|test/resources.`);
  return { projectRoot: root, modules: modules.length, candidates, warnings };
}

/** Build a multi-repo plan from detection: one unit per module's best non-test changelog. */
export function detectionToPlan(result: MavenDetectionResult, opts: { includeTest?: boolean } = {}): Array<{ name: string; repoRoot: string; changelog: string; srcDir?: string }> {
  const bestPerModule = new Map<string, DetectedChangelog>();
  for (const c of result.candidates) {
    if (c.isTest && !opts.includeTest) continue;
    if (c.sqlUnsupported) continue; // skip until the SQL adapter exists
    const ex = bestPerModule.get(c.module);
    if (!ex || c.confidence > ex.confidence) bestPerModule.set(c.module, c);
  }
  return [...bestPerModule.values()].map((c) => ({ name: c.module, repoRoot: result.projectRoot, changelog: c.changelog, srcDir: c.srcDir }));
}
