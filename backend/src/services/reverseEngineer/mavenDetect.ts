/**
 * Auto-detect Liquibase changelogs in a (multi-module, nested) Maven project — or
 * across a parent directory of several cloned Maven projects.
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
 *
 * Detection is **streaming and non-blocking**: `detectMavenStream` is an
 * `async function*` over `fs.promises` that yields `project` / `module` /
 * `candidate` / `warning` events as it walks the tree, so a very large
 * parent-of-clones reports live progress and never blocks the event loop.
 * `detectMaven` is a thin wrapper that drains the generator for callers that only
 * want the aggregate result.
 */
import fs from 'fs';
import path from 'path';
import { XMLParser } from 'fast-xml-parser';
import { parse as yamlParse } from 'yaml';

export interface DetectedChangelog {
  module: string; // label (artifactId or dir name; clone-prefixed when scanning multiple projects)
  moduleDir: string; // absolute
  repoRoot: string; // absolute — the Maven project (git clone) this module belongs to; the run's repoRoot
  changelogAbs: string;
  changelog: string; // relative to repoRoot (for a run)
  srcDir?: string; // <module>/src/main/java relative to repoRoot, if present
  detectedBy: 'plugin' | 'liquibase.properties' | 'convention';
  confidence: number;
  isTest: boolean;
  format: 'yaml' | 'xml' | 'json' | 'sql';
  sqlUnsupported?: boolean;
}

export interface MavenDetectionResult {
  projectRoot: string; // the scan root (may be a parent dir of several clones)
  projects: number; // number of distinct Maven projects (git clones) found under the scan root
  modules: number; // total modules across all projects
  candidates: DetectedChangelog[]; // ranked, best per module first
  warnings: string[];
}

/** Live event emitted by {@link detectMavenStream} as the scan progresses. */
export type DetectEvent =
  | { type: 'project'; project: string; path: string; index: number; total: number }
  | { type: 'module'; module: string; project: string }
  | { type: 'candidate'; candidate: DetectedChangelog }
  | { type: 'warning'; message: string };

const xml = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', parseAttributeValue: false, isArray: (n) => ['module', 'plugin', 'profile', 'execution'].includes(n) });
const toArr = <T>(v: T | T[] | undefined): T[] => (v == null ? [] : Array.isArray(v) ? v : [v]);

async function exists(p: string): Promise<boolean> {
  try { await fs.promises.access(p); return true; } catch { return false; }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function readPom(dir: string): Promise<any | undefined> {
  const p = path.join(dir, 'pom.xml');
  try { return xml.parse(await fs.promises.readFile(p, 'utf-8'))?.project; } catch { return undefined; }
}

/** All module dirs in the reactor (root + declared <modules>, recursively). */
async function reactorModules(root: string): Promise<string[]> {
  const seen = new Set<string>();
  const out: string[] = [];
  const visit = async (dir: string): Promise<void> => {
    const real = path.resolve(dir);
    if (seen.has(real)) return;
    seen.add(real);
    const pom = await readPom(real);
    if (!pom) return;
    out.push(real);
    for (const m of toArr<string>(pom.modules?.module)) {
      // a module value is a relative path to a dir (or directly to a pom).
      const target = path.join(real, String(m));
      await visit((await exists(path.join(target, 'pom.xml'))) ? target : path.dirname(target));
    }
  };
  await visit(root);
  return out;
}

const SKIP_DIRS = new Set(['node_modules', 'target', 'dist', 'build', '.git', '.idea', '.vscode']);

/**
 * Locate the Maven project root(s) under a scan root.
 *
 * If the scan root itself is a Maven project (`pom.xml` present) it is the single
 * project root — the classic single-repo case. Otherwise the scan root is treated
 * as a *parent directory of clones*: we descend (bounded) and collect the topmost
 * `pom.xml`-bearing directory in each branch. Each such dir is one project (one git
 * clone); its own reactor walk handles any nested modules, so we never descend past
 * the first pom we find. This is what lets a user point at a folder full of cloned
 * repos with no aggregator pom at the top.
 */
async function findProjectRoots(root: string, maxDepth = 4): Promise<string[]> {
  if (await exists(path.join(root, 'pom.xml'))) return [root];
  const roots: string[] = [];
  const visit = async (dir: string, depth: number): Promise<void> => {
    if (await exists(path.join(dir, 'pom.xml'))) { roots.push(dir); return; } // topmost pom = a project; reactor handles the rest
    if (depth >= maxDepth) return;
    let entries: fs.Dirent[];
    try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (SKIP_DIRS.has(e.name) || e.name.startsWith('.')) continue;
      await visit(path.join(dir, e.name), depth + 1);
    }
  };
  await visit(root, 0);
  return roots.sort();
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
async function validate(absPath: string): Promise<{ valid: boolean; format: DetectedChangelog['format']; sqlUnsupported?: boolean }> {
  const format = fmtOf(absPath);
  let body: string;
  try { body = await fs.promises.readFile(absPath, 'utf-8'); } catch { return { valid: false, format }; }
  if (format === 'sql') return { valid: /--\s*liquibase\s+formatted\s+sql/i.test(body), format, sqlUnsupported: true };
  if (format === 'xml') return { valid: /<\s*databaseChangeLog/i.test(body), format };
  try { const d = yamlParse(body); return { valid: !!d && typeof d === 'object' && 'databaseChangeLog' in d, format }; } catch { return { valid: false, format }; }
}

const PROP_FILE_NAMES = ['liquibase.properties'];
async function readProperty(file: string, key: string): Promise<string | undefined> {
  let body: string;
  try { body = await fs.promises.readFile(file, 'utf-8'); } catch { return undefined; }
  const re = new RegExp(`^\\s*${key}\\s*[=:]\\s*(.+?)\\s*$`, 'im');
  return body.match(re)?.[1]?.replace(/^["']|["']$/g, '');
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

async function scanConvention(moduleDir: string): Promise<Array<{ abs: string; score: number }>> {
  const found: Array<{ abs: string; score: number }> = [];
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > 8) return;
    let entries: fs.Dirent[];
    try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name === 'node_modules' || e.name === 'target' || e.name.startsWith('.')) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) await walk(full, depth + 1);
      else for (const c of CONVENTION) if (c.re.test(full.replace(/\\/g, '/'))) { found.push({ abs: full, score: c.score }); break; }
    }
  };
  for (const r of RESOURCE_ROOTS) await walk(path.join(moduleDir, r), 0);
  return found;
}

async function detectInModule(moduleDir: string, label: string, projectRoot: string, warnings: string[]): Promise<DetectedChangelog[]> {
  const pom = await readPom(moduleDir);
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
        const clf = await readProperty(pf, 'changeLogFile');
        if (clf) for (const abs of resolveValue(clf, moduleDir)) raw.push({ abs, by: 'plugin', conf: 0.92 });
      }
    }
  }

  // 2. liquibase.properties (module root + resource roots)
  for (const base of ['', ...RESOURCE_ROOTS]) for (const name of PROP_FILE_NAMES) {
    const clf = await readProperty(path.join(moduleDir, base, name), 'changeLogFile');
    if (clf) for (const abs of resolveValue(clf, moduleDir)) raw.push({ abs, by: 'liquibase.properties', conf: 0.9 });
  }

  // 3. convention scan
  for (const { abs, score } of await scanConvention(moduleDir)) raw.push({ abs, by: 'convention', conf: score });

  // dedup by abs (keep highest-confidence signal), validate, score test penalty
  const byPath = new Map<string, { by: DetectedChangelog['detectedBy']; conf: number }>();
  for (const r of raw) {
    const ex = byPath.get(r.abs);
    if (!ex || r.conf > ex.conf) byPath.set(r.abs, { by: r.by, conf: r.conf });
  }
  const srcMain = path.join(moduleDir, 'src/main/java');
  const srcExists = await exists(srcMain);
  const out: DetectedChangelog[] = [];
  for (const [abs, { by, conf }] of byPath) {
    const v = await validate(abs);
    if (!v.valid) continue;
    const isTest = isTestPath(abs);
    if (v.sqlUnsupported) warnings.push(`${label}: ${path.relative(projectRoot, abs)} is a SQL-formatted changelog — detected, but the SQL loader adapter is not implemented yet.`);
    out.push({
      module: label, moduleDir, repoRoot: projectRoot, changelogAbs: abs,
      changelog: path.relative(projectRoot, abs),
      srcDir: srcExists ? path.relative(projectRoot, srcMain) : undefined,
      detectedBy: by, confidence: isTest ? conf * 0.4 : conf, isTest, format: v.format, sqlUnsupported: v.sqlUnsupported,
    });
  }
  return out.sort((a, b) => b.confidence - a.confidence);
}

/**
 * Streaming detection over a Maven project or a parent-of-clones. Yields events as
 * the tree is walked (over `fs.promises`, so it never blocks the event loop) and
 * *returns* the final aggregate `MavenDetectionResult`. Consume with `for await`
 * (events) + capture the generator's return value for the aggregate, or use
 * {@link detectMaven} to just get the aggregate.
 */
export async function* detectMavenStream(scanRoot: string): AsyncGenerator<DetectEvent, MavenDetectionResult> {
  const root = path.resolve(scanRoot);
  const warnings: string[] = [];
  const projectRoots = await findProjectRoots(root);
  if (!projectRoots.length) {
    const w = `No Maven project (pom.xml) found at or under ${root}.`;
    warnings.push(w);
    yield { type: 'warning', message: w };
    return { projectRoot: root, projects: 0, modules: 0, candidates: [], warnings };
  }
  const multiProject = projectRoots.length > 1;
  const candidates: DetectedChangelog[] = [];
  let moduleCount = 0;

  for (let pi = 0; pi < projectRoots.length; pi++) {
    const pr = projectRoots[pi];
    yield { type: 'project', project: path.basename(pr), path: pr, index: pi + 1, total: projectRoots.length };
    const modules = await reactorModules(pr);
    moduleCount += modules.length;
    for (const dir of modules) {
      const pom = await readPom(dir);
      const artifactId = (pom?.artifactId as string) ?? path.basename(dir);
      // Prefix with the clone dir name when scanning several projects so labels stay
      // unique across clones (two clones may share an artifactId) and cross-repo
      // analysis sees them as distinct repos.
      const label = multiProject ? `${path.basename(pr)}/${artifactId}` : artifactId;
      yield { type: 'module', module: label, project: path.basename(pr) };
      const before = warnings.length;
      const found = await detectInModule(dir, label, pr, warnings);
      for (let i = before; i < warnings.length; i++) yield { type: 'warning', message: warnings[i] };
      if (found.length) {
        // best candidate per module (keep extras of comparable confidence for the picker)
        const kept = found.filter((c) => c.confidence >= found[0].confidence - 0.15);
        candidates.push(...kept);
        for (const c of kept) yield { type: 'candidate', candidate: c };
      }
    }
  }

  candidates.sort((a, b) => b.confidence - a.confidence);
  if (!candidates.length) {
    const scope = multiProject ? `${projectRoots.length} project(s), ${moduleCount} module(s)` : `${moduleCount} module(s)`;
    const w = `No Liquibase changelog detected across ${scope}. Looked at liquibase-maven-plugin config, liquibase.properties, and db/changelog conventions under src/main|test/resources.`;
    warnings.push(w);
    yield { type: 'warning', message: w };
  }
  return { projectRoot: root, projects: projectRoots.length, modules: moduleCount, candidates, warnings };
}

/**
 * Detect Liquibase changelogs across a Maven project — or across a parent directory
 * of several cloned Maven projects. Thin wrapper that drains {@link detectMavenStream}
 * and returns the aggregate; callers wanting live progress should consume the
 * generator directly.
 */
export async function detectMaven(scanRoot: string): Promise<MavenDetectionResult> {
  const gen = detectMavenStream(scanRoot);
  let r = await gen.next();
  while (!r.done) r = await gen.next();
  return r.value;
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
  return [...bestPerModule.values()].map((c) => ({ name: c.module, repoRoot: c.repoRoot, changelog: c.changelog, srcDir: c.srcDir }));
}
