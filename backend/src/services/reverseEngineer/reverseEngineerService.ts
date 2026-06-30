/**
 * Reverse-engineering service.
 *
 * Per-repo: Liquibase changeSets (physical truth + timeline) → CIR + lifecycle
 * events, git-correlated, optionally overlaid with JPA (logical truth) → drift.
 * Multi-repo: run that per repo, then resolve entities ACROSS repos and analyse
 * cross-repo relationships (a FK whose referenced table lives in another repo),
 * flagging shared entities, conflicts and dangling references.
 *
 * Then enrich (Jira/Confluence), write the CIR store, project a smart-data-dico
 * project, and emit a provider-agnostic AI synthesis package. No AI here.
 */
import fs from 'fs';
import path from 'path';
import { loadChangelog, parseLength } from './liquibase.js';
import { findIntroducingCommit, firstCommit, gitAvailable, type CommitInfo } from './git.js';
import { extractJpa } from './jpa.js';
import { mergeJpa, type DriftFinding } from './drift.js';
import { enrichWithJira, attachJira, type JiraConfig, type JiraIssue } from './jira.js';
import { dumpConfluenceSpace, type ConfluenceConfig } from './confluence.js';
import { emitDicoProject } from './synthesize.js';
import { emitSynthesisPackage, type SynthesisMode } from './synthesisBrief.js';
import {
  CIRElementSchema, CIREventSchema, extractTickets,
  type CIRElement, type CIREvent, type Provenance,
} from './types.js';

export interface ProgressEvent {
  stage: 'liquibase' | 'correlate' | 'jpa' | 'drift' | 'crossrepo' | 'jira' | 'confluence' | 'emit' | 'synthesize' | 'done';
  status: 'start' | 'progress' | 'done';
  detail?: string;
  count?: number;
}
export type ProgressFn = (e: ProgressEvent) => void;

/** One repo to mine. */
export interface RepoSpec {
  name?: string;
  repoRoot: string;
  changelog: string;
  srcDir?: string;
}

interface Enrichment {
  jira?: JiraConfig;
  confluence?: ConfluenceConfig;
  out?: string;
  emitDico?: string;
  update?: boolean;
  synthesis?: { mode: SynthesisMode };
  onProgress?: ProgressFn;
}

export interface ReverseEngineerOptions extends Enrichment, RepoSpec {}
export interface MultiRepoOptions extends Enrichment { repos: RepoSpec[] }

export interface CrossRepoReport {
  repos: string[];
  sharedEntities: Array<{ table: string; repos: string[] }>;
  conflicts: Array<{ element: string; repos: string[]; detail: string }>;
  crossRepoRelationships: Array<{ relationship: string; from: string; to: string; fromRepos: string[]; toRepos: string[] }>;
  danglingReferences: Array<{ relationship: string; target: string }>;
}

export interface ReverseEngineerSummary {
  elements: number;
  events: number;
  changeSets: number;
  withCommit: number;
  jpaFiles: number;
  driftFindings: number;
  jiraIssues: number;
  confluencePages: number;
  tickets: string[];
  storeDir?: string;
  dicoProject?: string;
  synthesisDir?: string;
  repos?: string[];
  crossRepoRelationships?: number;
  sharedEntities?: number;
  conflicts?: number;
  danglingReferences?: number;
}

export interface ReverseEngineerOutput {
  summary: ReverseEngineerSummary;
  elements: CIRElement[];
  events: CIREvent[];
  drift: DriftFinding[];
  crossRepo?: CrossRepoReport;
}

const tableId = (t: string) => `entity:${t}`;
const columnId = (t: string, c: string) => `attribute:${t}.${c}`;
const uniq = (a: string[]) => [...new Set(a)];

/** Per-repo CIR build: Liquibase → correlate → JPA → drift. No enrichment/emit. */
interface RepoCir {
  label: string;
  repoRoot: string;
  elements: Map<string, CIRElement>;
  events: CIREvent[];
  drift: DriftFinding[];
  tickets: Set<string>;
  withCommit: number;
  changeSets: number;
  jpaFiles: number;
}

function extractRepoCir(repo: RepoSpec, progress: ProgressFn, label: string): RepoCir {
  const tag = (s: string) => (label ? `[${label}] ${s}` : s);
  const repoRoot = path.resolve(repo.repoRoot);
  const masterAbs = path.isAbsolute(repo.changelog) ? repo.changelog : path.join(repoRoot, repo.changelog);
  progress({ stage: 'liquibase', status: 'start', detail: tag('parsing changelog') });
  const changeSets = loadChangelog(masterAbs, repoRoot);
  progress({ stage: 'liquibase', status: 'done', count: changeSets.length, detail: tag(`${changeSets.length} changeSets`) });
  const hasGit = gitAvailable(repoRoot);

  const elements = new Map<string, CIRElement>();
  const events: CIREvent[] = [];
  const allTickets = new Set<string>();
  let withCommit = 0;
  const commitCache = new Map<string, CommitInfo | undefined>();

  const upsert = (id: string, kind: CIRElement['kind'], names: CIRElement['names'], facts: Record<string, unknown>, prov: Provenance, status: CIRElement['lifecycle']['status'] = 'active'): CIRElement => {
    let el = elements.get(id);
    if (!el) { el = { id, kind, names, facts: {}, provenance: [], lifecycle: { status }, confidence: 1 }; elements.set(id, el); }
    Object.assign(el.facts, facts);
    el.provenance.push(prov);
    el.lifecycle.status = status;
    return el;
  };

  progress({ stage: 'correlate', status: 'start', detail: tag('linking changeSets to commits') });
  let csIndex = 0;
  for (const cs of changeSets) {
    progress({ stage: 'correlate', status: 'progress', detail: tag(`${++csIndex}/${changeSets.length} ${cs.id}`) });
    const cacheKey = cs.id + cs.file;
    const commit = hasGit
      ? (commitCache.has(cacheKey) ? commitCache.get(cacheKey) : (() => { const c = findIntroducingCommit(repoRoot, cs.file, cs.id); commitCache.set(cacheKey, c); return c; })())
      : undefined;
    if (commit) withCommit++;
    const tickets = extractTickets(cs.id, cs.comment, commit?.message);
    tickets.forEach((t) => allTickets.add(t));
    const ticket = tickets[0];
    const ts = commit?.date ?? new Date(0).toISOString();
    const baseProv = (): Provenance => ({ source: 'liquibase', ref: `${cs.file}#${cs.id}`, commit: commit?.sha, ticket, author: cs.author });
    const emit = (element: string, type: CIREvent['type'], change: string, details?: Record<string, unknown>) => {
      events.push({ ts, element, type, change, source: { system: 'liquibase', file: cs.file, changeSetId: cs.id, author: cs.author, comment: cs.comment }, commit: commit ? { ...commit } : undefined, details });
    };

    for (const op of cs.changes) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const [[opName, body]] = Object.entries(op) as [[string, any]];
      switch (opName) {
        case 'createTable': {
          const table = body.tableName as string;
          const el = upsert(tableId(table), 'entity', { physical: { table } }, {}, baseProv());
          el.lifecycle.bornEvent = `${cs.id}:createTable:${table}`;
          emit(tableId(table), 'born', 'createTable', { table });
          for (const colWrap of body.columns ?? []) {
            const col = colWrap.column;
            const constraints = col.constraints ?? {};
            const facts: Record<string, unknown> = { dataType: col.type, nullable: constraints.nullable !== false, isPrimaryKey: constraints.primaryKey === true };
            const len = parseLength(col.type);
            if (len) facts.validation = { maxLength: len };
            if (col.defaultValue !== undefined) facts.defaultValue = col.defaultValue;
            upsert(columnId(table, col.name), 'attribute', { physical: { table, column: col.name } }, facts, baseProv());
            emit(columnId(table, col.name), 'born', 'addColumn', { table, column: col.name, type: col.type });
            if (constraints.unique) {
              const cid = `constraint:${table}.uq_${col.name}`;
              upsert(cid, 'constraint', { physical: { table, column: col.name } }, { constraintType: 'unique', foreignKeyColumns: [col.name] }, baseProv());
              emit(cid, 'born', 'addUniqueConstraint', { table, column: col.name });
            }
          }
          break;
        }
        case 'addColumn': {
          const table = body.tableName as string;
          for (const colWrap of body.columns ?? []) {
            const col = colWrap.column;
            const facts: Record<string, unknown> = { dataType: col.type, nullable: (col.constraints?.nullable) !== false };
            const len = parseLength(col.type);
            if (len) facts.validation = { maxLength: len };
            if (col.defaultValue !== undefined) facts.defaultValue = col.defaultValue;
            upsert(columnId(table, col.name), 'attribute', { physical: { table, column: col.name } }, facts, baseProv());
            emit(columnId(table, col.name), 'born', 'addColumn', { table, column: col.name, type: col.type });
          }
          break;
        }
        case 'addForeignKeyConstraint': {
          const from = body.baseTableName as string;
          const to = body.referencedTableName as string;
          const rid = `relationship:${from}->${to}`;
          upsert(rid, 'relationship', { physical: { table: from } }, { source: tableId(from), target: tableId(to), cardinality: 'many-to-one', foreignKeyColumns: String(body.baseColumnNames ?? '').split(',').map((s) => s.trim()) }, baseProv());
          emit(rid, 'born', 'addForeignKeyConstraint', { from, to, fk: body.constraintName });
          break;
        }
        case 'addUniqueConstraint': {
          const table = body.tableName as string;
          const cols = String(body.columnNames ?? '').split(',').map((s) => s.trim());
          const cid = `constraint:${table}.${body.constraintName ?? 'uq_' + cols.join('_')}`;
          upsert(cid, 'constraint', { physical: { table } }, { constraintType: 'unique', foreignKeyColumns: cols }, baseProv());
          emit(cid, 'born', 'addUniqueConstraint', { table, columns: cols });
          break;
        }
        case 'createIndex': {
          const table = body.tableName as string;
          const cid = `constraint:${table}.${body.indexName}`;
          upsert(cid, 'constraint', { physical: { table } }, { constraintType: 'index' }, baseProv());
          emit(cid, 'born', 'createIndex', { table, index: body.indexName });
          break;
        }
        case 'addNotNullConstraint': {
          const table = body.tableName as string;
          const el = upsert(columnId(table, body.columnName), 'attribute', { physical: { table, column: body.columnName } }, { nullable: false }, baseProv());
          el.lifecycle.lastChangedEvent = `${cs.id}:addNotNullConstraint`;
          emit(columnId(table, body.columnName), 'modified', 'addNotNullConstraint', { table, column: body.columnName });
          break;
        }
        case 'dropColumn': {
          const table = body.tableName as string;
          const col = body.columnName ?? (body.columns?.[0]?.column?.name);
          const id = columnId(table, col);
          const el = elements.get(id);
          if (el) el.lifecycle.status = 'removed';
          emit(id, 'removed', 'dropColumn', { table, column: col });
          break;
        }
        default:
          emit(`changeset:${cs.id}`, 'modified', opName, { raw: body });
      }
    }
  }

  for (const el of elements.values()) {
    if (!el.provenance.some((p) => p.commit)) {
      el.confidence = 0.6;
      el.flags = uniq([...(el.flags ?? []), 'no-introducing-commit']);
    }
  }
  progress({ stage: 'correlate', status: 'done', count: withCommit, detail: tag(`${withCommit}/${changeSets.length} commit-linked`) });

  // JPA overlay → drift
  let drift: DriftFinding[] = [];
  let jpaFiles = 0;
  if (repo.srcDir) {
    progress({ stage: 'jpa', status: 'start', detail: tag('scanning JPA entities') });
    const srcAbs = path.isAbsolute(repo.srcDir) ? repo.srcDir : path.join(repoRoot, repo.srcDir);
    const jpaElements: CIRElement[] = [];
    for (const file of walkJava(srcAbs)) {
      jpaFiles++;
      const rel = path.relative(repoRoot, file);
      const commit = hasGit ? firstCommit(repoRoot, rel) : undefined;
      commit?.tickets?.forEach((t) => allTickets.add(t));
      const prov = (): Provenance => ({ source: 'jpa', ref: rel, commit: commit?.sha, ticket: commit?.tickets?.[0], author: commit?.author });
      jpaElements.push(...extractJpa(fs.readFileSync(file, 'utf-8'), { fileRel: rel, provenance: prov }));
    }
    progress({ stage: 'jpa', status: 'done', count: jpaFiles, detail: tag(`${jpaFiles} Java files`) });
    progress({ stage: 'drift', status: 'start', detail: tag('') });
    drift = mergeJpa(elements, jpaElements);
    progress({ stage: 'drift', status: 'done', count: drift.length, detail: tag(`${drift.length} findings`) });
  }

  if (label) for (const el of elements.values()) el.repos = [label];
  return { label, repoRoot, elements, events, drift, tickets: allTickets, withCommit, changeSets: changeSets.length, jpaFiles };
}

/** Resolve entities across repos and analyse cross-repo relationships. */
function combineRepos(parts: RepoCir[]): { cir: RepoCir; report: CrossRepoReport } {
  const elements = new Map<string, CIRElement>();
  const reposById = new Map<string, Set<string>>();
  const events: CIREvent[] = [];
  const drift: DriftFinding[] = [];
  const tickets = new Set<string>();
  const conflicts: CrossRepoReport['conflicts'] = [];
  let withCommit = 0, changeSets = 0, jpaFiles = 0;

  const addRepo = (id: string, label: string) => (reposById.get(id) ?? reposById.set(id, new Set()).get(id)!).add(label);
  const maxLen = (el: CIRElement) => (el.facts.validation as { maxLength?: number } | undefined)?.maxLength;

  for (const p of parts) {
    events.push(...p.events); drift.push(...p.drift); p.tickets.forEach((t) => tickets.add(t));
    withCommit += p.withCommit; changeSets += p.changeSets; jpaFiles += p.jpaFiles;
    for (const [id, el] of p.elements) {
      addRepo(id, p.label);
      const ex = elements.get(id);
      if (!ex) { elements.set(id, el); continue; }
      ex.provenance.push(...el.provenance);
      if (el.flags) ex.flags = uniq([...(ex.flags ?? []), ...el.flags]);
      if (ex.kind === 'attribute') {
        const typeDiff = el.facts.dataType !== undefined && ex.facts.dataType !== el.facts.dataType;
        const nullDiff = el.facts.nullable !== undefined && ex.facts.nullable !== el.facts.nullable;
        const lx = maxLen(ex), le = maxLen(el);
        if (typeDiff || nullDiff || (lx && le && lx !== le)) {
          ex.flags = uniq([...(ex.flags ?? []), 'cross-repo-conflict']);
          conflicts.push({ element: id, repos: [...reposById.get(id)!].sort(), detail: typeDiff ? `dataType ${ex.facts.dataType} vs ${el.facts.dataType}` : nullDiff ? `nullable ${ex.facts.nullable} vs ${el.facts.nullable}` : `maxLength ${lx} vs ${le}` });
        }
      }
    }
  }
  for (const [id, set] of reposById) { const el = elements.get(id); if (el) el.repos = [...set].sort(); }

  const sharedEntities = [...reposById].filter(([id, s]) => id.startsWith('entity:') && s.size > 1).map(([id, s]) => ({ table: id.replace('entity:', ''), repos: [...s].sort() }));

  const crossRepoRelationships: CrossRepoReport['crossRepoRelationships'] = [];
  const danglingReferences: CrossRepoReport['danglingReferences'] = [];
  for (const [id, el] of elements) {
    if (el.kind !== 'relationship') continue;
    const tgtId = String(el.facts.target);
    const relRepos = reposById.get(id) ?? new Set<string>();
    if (!elements.has(tgtId)) {
      el.flags = uniq([...(el.flags ?? []), 'cross-repo-dangling']);
      danglingReferences.push({ relationship: id, target: tgtId.replace('entity:', '') });
      continue;
    }
    const tgtRepos = reposById.get(tgtId) ?? new Set<string>();
    const disjoint = relRepos.size > 0 && tgtRepos.size > 0 && [...relRepos].every((r) => !tgtRepos.has(r));
    if (disjoint) {
      el.flags = uniq([...(el.flags ?? []), 'cross-repo']);
      el.facts.crossRepo = true;
      crossRepoRelationships.push({ relationship: id, from: id.replace('relationship:', '').split('->')[0], to: tgtId.replace('entity:', ''), fromRepos: [...relRepos].sort(), toRepos: [...tgtRepos].sort() });
    }
  }

  const report: CrossRepoReport = { repos: parts.map((p) => p.label), sharedEntities, conflicts, crossRepoRelationships, danglingReferences };
  const cir: RepoCir = { label: `multi(${parts.length})`, repoRoot: parts.map((p) => p.repoRoot).join(', '), elements, events, drift, tickets, withCommit, changeSets, jpaFiles };
  return { cir, report };
}

/** Shared tail: enrich → write store → emit dico → synthesis → summary. */
async function finalize(cir: RepoCir, opts: Enrichment, progress: ProgressFn, crossRepo?: CrossRepoReport): Promise<ReverseEngineerOutput> {
  const allTickets = cir.tickets;

  let jiraIssues = 0;
  let jiraIssueMap = new Map<string, JiraIssue>();
  if (opts.jira?.baseUrl && opts.jira.enabled !== false && allTickets.size > 0) {
    progress({ stage: 'jira', status: 'start', detail: `fetching ${allTickets.size} tickets` });
    const enriched = await enrichWithJira([...allTickets].sort(), opts.jira, { outDir: opts.out });
    attachJira(cir.elements.values(), enriched.issues);
    jiraIssues = enriched.issues.size; jiraIssueMap = enriched.issues;
    for (const e of enriched.errors) process.stderr.write(`[jira] ${e.key}: ${e.error}\n`);
    progress({ stage: 'jira', status: 'done', count: jiraIssues, detail: `${jiraIssues} issues` });
  }

  let confluencePages = 0;
  if (opts.confluence?.baseUrl && opts.confluence.enabled !== false && opts.confluence.spaceKey) {
    progress({ stage: 'confluence', status: 'start', detail: `dumping space ${opts.confluence.spaceKey}` });
    const dump = await dumpConfluenceSpace(opts.confluence, { outDir: opts.out });
    confluencePages = dump.pages.length;
    for (const e of dump.errors) process.stderr.write(`[confluence] ${e}\n`);
    progress({ stage: 'confluence', status: 'done', count: confluencePages, detail: `${confluencePages} pages` });
  }

  const model = [...cir.elements.values()];
  let storeDir: string | undefined;
  if (opts.out) { storeDir = path.resolve(opts.out); writeStore(storeDir, model, cir.events, cir.drift, crossRepo); }

  let dicoProject: string | undefined;
  if (opts.emitDico) {
    progress({ stage: 'emit', status: 'start', detail: opts.update ? 'merging into existing project' : 'writing smart-data-dico project' });
    const r = emitDicoProject(model, opts.emitDico, { issues: jiraIssueMap, mode: opts.update ? 'merge' : 'overwrite' });
    dicoProject = r.projectDir;
    progress({ stage: 'emit', status: 'done', detail: r.mode === 'merge' ? `${r.merged} merged, ${r.added} added` : dicoProject });
  }

  let synthesisDir: string | undefined;
  if (opts.synthesis) {
    const target = dicoProject ?? storeDir;
    if (target) {
      progress({ stage: 'synthesize', status: 'start', detail: `building ${opts.synthesis.mode} package` });
      const r = emitSynthesisPackage(model, cir.drift, { outDir: target, mode: opts.synthesis.mode, jiraIssues: jiraIssueMap, confluenceDir: storeDir ? path.join(storeDir, 'enrichment', 'confluence') : undefined, repoRoot: cir.repoRoot });
      synthesisDir = r.synthesisDir;
      progress({ stage: 'synthesize', status: 'done', count: r.briefs, detail: `${r.briefs} briefs (${opts.synthesis.mode})` });
    }
  }

  progress({ stage: 'done', status: 'done', detail: `${model.length} elements` });

  return {
    summary: {
      elements: model.length, events: cir.events.length, changeSets: cir.changeSets, withCommit: cir.withCommit,
      jpaFiles: cir.jpaFiles, driftFindings: cir.drift.length, jiraIssues, confluencePages,
      tickets: [...allTickets].sort(), storeDir, dicoProject, synthesisDir,
      ...(crossRepo ? {
        repos: crossRepo.repos,
        crossRepoRelationships: crossRepo.crossRepoRelationships.length,
        sharedEntities: crossRepo.sharedEntities.length,
        conflicts: crossRepo.conflicts.length,
        danglingReferences: crossRepo.danglingReferences.length,
      } : {}),
    },
    elements: model, events: cir.events, drift: cir.drift, crossRepo,
  };
}

/** Single-repo run. */
export async function runReverseEngineer(opts: ReverseEngineerOptions): Promise<ReverseEngineerOutput> {
  const progress = opts.onProgress ?? (() => {});
  const cir = extractRepoCir(opts, progress, opts.name ?? '');
  return finalize(cir, opts, progress);
}

/** Multi-repo run with cross-repo entity resolution + relationship analysis. */
export async function runReverseEngineerMulti(opts: MultiRepoOptions): Promise<ReverseEngineerOutput> {
  const progress = opts.onProgress ?? (() => {});
  const parts = opts.repos.map((r, i) => extractRepoCir(r, progress, r.name ?? path.basename(path.resolve(r.repoRoot)) ?? `repo${i}`));
  progress({ stage: 'crossrepo', status: 'start', detail: `resolving ${parts.length} repos` });
  const { cir, report } = combineRepos(parts);
  progress({ stage: 'crossrepo', status: 'done', detail: `${report.crossRepoRelationships.length} cross-repo rels, ${report.sharedEntities.length} shared, ${report.conflicts.length} conflicts, ${report.danglingReferences.length} dangling` });
  return finalize(cir, opts, progress, report);
}

function walkJava(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkJava(full));
    else if (entry.isFile() && entry.name.endsWith('.java')) out.push(full);
  }
  return out;
}

const safe = (id: string) => id.replace(/[^a-zA-Z0-9._-]/g, '_');

function writeStore(out: string, elements: CIRElement[], events: CIREvent[], drift: DriftFinding[], crossRepo?: CrossRepoReport): void {
  const dirFor: Record<CIRElement['kind'], string> = { entity: 'entities', attribute: 'attributes', relationship: 'relationships', constraint: 'constraints' };
  for (const sub of ['entities', 'attributes', 'relationships', 'constraints']) fs.mkdirSync(path.join(out, 'model', sub), { recursive: true });
  fs.mkdirSync(path.join(out, 'timeline'), { recursive: true });
  for (const el of elements) {
    CIRElementSchema.parse(el);
    fs.writeFileSync(path.join(out, 'model', dirFor[el.kind], `${safe(el.id)}.json`), JSON.stringify(el, null, 2) + '\n');
  }
  fs.writeFileSync(path.join(out, 'timeline', 'events.jsonl'), events.map((e) => JSON.stringify(CIREventSchema.parse(e))).join('\n') + '\n');
  fs.writeFileSync(path.join(out, 'drift.json'), JSON.stringify(drift, null, 2) + '\n');
  if (crossRepo) fs.writeFileSync(path.join(out, 'cross-repo.json'), JSON.stringify(crossRepo, null, 2) + '\n');
}
