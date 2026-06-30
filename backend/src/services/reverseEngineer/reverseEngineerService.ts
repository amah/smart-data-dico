/**
 * Reverse-engineering service.
 *
 * Deterministic extraction: Liquibase changeSets (physical truth + timeline) →
 * CIR elements + lifecycle events, correlated to the git commits that introduced
 * them; optionally overlaid with JPA (logical truth) to surface DRIFT. No AI
 * here — the emitted CIR is what a later synthesis stage turns into
 * smart-data-dico YAML.
 *
 * Consumed by both surfaces of the reverse-engineer plugin: the CLI
 * (src/scripts/reverseEngineer/cli.ts) and the HTTP controller
 * (controllers/reverseEngineerController.ts → routes/reverseEngineer.routes.ts).
 *
 * Reads EXTERNAL repos by absolute path, so it uses raw fs rather than
 * IStorageBackend (which is scoped to the dico project workspace). This dir is
 * allow-listed in .eslintrc.cjs for that reason.
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

/** A pipeline progress event, surfaced to the UI's analysis panel. */
export interface ProgressEvent {
  stage: 'liquibase' | 'correlate' | 'jpa' | 'drift' | 'jira' | 'confluence' | 'emit' | 'synthesize' | 'done';
  status: 'start' | 'progress' | 'done';
  detail?: string;
  count?: number;
}
export type ProgressFn = (e: ProgressEvent) => void;
import {
  CIRElementSchema,
  CIREventSchema,
  extractTickets,
  type CIRElement,
  type CIREvent,
  type Provenance,
} from './types.js';

export interface ReverseEngineerOptions {
  /** Absolute (or cwd-relative) path to the repo to mine. */
  repoRoot: string;
  /** Master changelog path (absolute or repo-relative). */
  changelog: string;
  /** Optional JPA source dir (repo-relative or absolute) — enables drift detection. */
  srcDir?: string;
  /** Optional Jira Server config — enables ticket enrichment for the found tickets. */
  jira?: JiraConfig;
  /** Optional Confluence Server config — dumps a space into the local store. */
  confluence?: ConfluenceConfig;
  /** Optional CIR store directory. When set, the model + timeline + drift are written. */
  out?: string;
  /** Optional output dir for a loadable smart-data-dico project projected from the CIR. */
  emitDico?: string;
  /** Optional synthesis package (briefs + handoff + proposal templates) for an AI agent. */
  synthesis?: { mode: SynthesisMode };
  /** Optional progress callback — emits stage events for the UI analysis panel. */
  onProgress?: ProgressFn;
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
}

export interface ReverseEngineerOutput {
  summary: ReverseEngineerSummary;
  elements: CIRElement[];
  events: CIREvent[];
  drift: DriftFinding[];
}

const tableId = (t: string) => `entity:${t}`;
const columnId = (t: string, c: string) => `attribute:${t}.${c}`;

/** Run the pipeline; returns the CIR and (optionally) writes the store. Async because Jira enrichment hits the network. */
export async function runReverseEngineer(opts: ReverseEngineerOptions): Promise<ReverseEngineerOutput> {
  const progress: ProgressFn = opts.onProgress ?? (() => {});
  const repoRoot = path.resolve(opts.repoRoot);
  const masterAbs = path.isAbsolute(opts.changelog) ? opts.changelog : path.join(repoRoot, opts.changelog);
  progress({ stage: 'liquibase', status: 'start', detail: 'parsing changelog' });
  const changeSets = loadChangelog(masterAbs, repoRoot);
  progress({ stage: 'liquibase', status: 'done', count: changeSets.length, detail: `${changeSets.length} changeSets` });
  const hasGit = gitAvailable(repoRoot);

  const elements = new Map<string, CIRElement>();
  const events: CIREvent[] = [];
  const allTickets = new Set<string>();
  let withCommit = 0;
  const commitCache = new Map<string, CommitInfo | undefined>();

  const upsert = (
    id: string,
    kind: CIRElement['kind'],
    names: CIRElement['names'],
    facts: Record<string, unknown>,
    prov: Provenance,
    status: CIRElement['lifecycle']['status'] = 'active',
  ): CIRElement => {
    let el = elements.get(id);
    if (!el) {
      el = { id, kind, names, facts: {}, provenance: [], lifecycle: { status }, confidence: 1 };
      elements.set(id, el);
    }
    Object.assign(el.facts, facts);
    el.provenance.push(prov);
    el.lifecycle.status = status;
    return el;
  };

  progress({ stage: 'correlate', status: 'start', detail: 'linking changeSets to commits' });
  let csIndex = 0;
  for (const cs of changeSets) {
    progress({ stage: 'correlate', status: 'progress', detail: `${++csIndex}/${changeSets.length} ${cs.id}` });
    const cacheKey = cs.id + cs.file;
    const commit = hasGit
      ? (commitCache.has(cacheKey)
          ? commitCache.get(cacheKey)
          : (() => { const c = findIntroducingCommit(repoRoot, cs.file, cs.id); commitCache.set(cacheKey, c); return c; })())
      : undefined;
    if (commit) withCommit++;
    const tickets = extractTickets(cs.id, cs.comment, commit?.message);
    tickets.forEach((t) => allTickets.add(t));
    const ticket = tickets[0];
    const ts = commit?.date ?? new Date(0).toISOString();

    const baseProv = (): Provenance => ({
      source: 'liquibase',
      ref: `${cs.file}#${cs.id}`,
      commit: commit?.sha,
      ticket,
      author: cs.author,
    });

    const emit = (element: string, type: CIREvent['type'], change: string, details?: Record<string, unknown>) => {
      events.push({
        ts,
        element,
        type,
        change,
        source: { system: 'liquibase', file: cs.file, changeSetId: cs.id, author: cs.author, comment: cs.comment },
        commit: commit ? { ...commit } : undefined,
        details,
      });
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
            const facts: Record<string, unknown> = {
              dataType: col.type,
              nullable: constraints.nullable !== false,
              isPrimaryKey: constraints.primaryKey === true,
            };
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
          upsert(
            rid,
            'relationship',
            { physical: { table: from } },
            { source: tableId(from), target: tableId(to), cardinality: 'many-to-one', foreignKeyColumns: String(body.baseColumnNames ?? '').split(',').map((s) => s.trim()) },
            baseProv(),
          );
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

  // Confidence: drop a notch when no introducing commit was found.
  for (const el of elements.values()) {
    if (!el.provenance.some((p) => p.commit)) {
      el.confidence = 0.6;
      el.flags = [...(el.flags ?? []), 'no-introducing-commit'].filter((v, i, a) => a.indexOf(v) === i);
    }
  }

  progress({ stage: 'correlate', status: 'done', count: withCommit, detail: `${withCommit}/${changeSets.length} commit-linked` });

  // ── JPA overlay (logical truth) → merge + drift ────────────────────────────
  let drift: DriftFinding[] = [];
  let jpaFiles = 0;
  if (opts.srcDir) {
    progress({ stage: 'jpa', status: 'start', detail: 'scanning JPA entities' });
    const srcAbs = path.isAbsolute(opts.srcDir) ? opts.srcDir : path.join(repoRoot, opts.srcDir);
    const jpaElements: CIRElement[] = [];
    for (const file of walkJava(srcAbs)) {
      jpaFiles++;
      const rel = path.relative(repoRoot, file);
      const commit = hasGit ? firstCommit(repoRoot, rel) : undefined;
      commit?.tickets?.forEach((t) => allTickets.add(t));
      const prov = (): Provenance => ({ source: 'jpa', ref: rel, commit: commit?.sha, ticket: commit?.tickets?.[0], author: commit?.author });
      jpaElements.push(...extractJpa(fs.readFileSync(file, 'utf-8'), { fileRel: rel, provenance: prov }));
    }
    progress({ stage: 'jpa', status: 'done', count: jpaFiles, detail: `${jpaFiles} Java files` });
    progress({ stage: 'drift', status: 'start' });
    drift = mergeJpa(elements, jpaElements);
    progress({ stage: 'drift', status: 'done', count: drift.length, detail: `${drift.length} findings` });
  }

  // ── Jira enrichment (the "why") ────────────────────────────────────────────
  // Fetch each correlated ticket, cache it, and tag the elements it touched.
  let jiraIssues = 0;
  let jiraIssueMap = new Map<string, JiraIssue>();
  if (opts.jira?.baseUrl && opts.jira.enabled !== false && allTickets.size > 0) {
    progress({ stage: 'jira', status: 'start', detail: `fetching ${allTickets.size} tickets` });
    const enriched = await enrichWithJira([...allTickets].sort(), opts.jira, { outDir: opts.out });
    attachJira(elements.values(), enriched.issues);
    jiraIssues = enriched.issues.size;
    jiraIssueMap = enriched.issues;
    for (const e of enriched.errors) process.stderr.write(`[jira] ${e.key}: ${e.error}\n`);
    progress({ stage: 'jira', status: 'done', count: jiraIssues, detail: `${jiraIssues} issues` });
  }

  // ── Confluence dump (domain corpus for AI retrieval) ───────────────────────
  let confluencePages = 0;
  if (opts.confluence?.baseUrl && opts.confluence.enabled !== false && opts.confluence.spaceKey) {
    progress({ stage: 'confluence', status: 'start', detail: `dumping space ${opts.confluence.spaceKey}` });
    const dump = await dumpConfluenceSpace(opts.confluence, { outDir: opts.out });
    confluencePages = dump.pages.length;
    for (const e of dump.errors) process.stderr.write(`[confluence] ${e}\n`);
    progress({ stage: 'confluence', status: 'done', count: confluencePages, detail: `${confluencePages} pages` });
  }

  const model = [...elements.values()];
  let storeDir: string | undefined;
  if (opts.out) {
    storeDir = path.resolve(opts.out);
    writeStore(storeDir, model, events, drift);
  }

  // ── Project the CIR into a loadable smart-data-dico project ────────────────
  let dicoProject: string | undefined;
  if (opts.emitDico) {
    progress({ stage: 'emit', status: 'start', detail: 'writing smart-data-dico project' });
    dicoProject = emitDicoProject(model, opts.emitDico, { issues: jiraIssueMap }).projectDir;
    progress({ stage: 'emit', status: 'done', detail: dicoProject });
  }

  // ── Synthesis package (grounded input + handoff for an AI agent) ───────────
  let synthesisDir: string | undefined;
  if (opts.synthesis) {
    const target = dicoProject ?? storeDir;
    if (target) {
      progress({ stage: 'synthesize', status: 'start', detail: `building ${opts.synthesis.mode} package` });
      const r = emitSynthesisPackage(model, drift, {
        outDir: target,
        mode: opts.synthesis.mode,
        jiraIssues: jiraIssueMap,
        confluenceDir: storeDir ? path.join(storeDir, 'enrichment', 'confluence') : undefined,
        repoRoot,
      });
      synthesisDir = r.synthesisDir;
      progress({ stage: 'synthesize', status: 'done', count: r.briefs, detail: `${r.briefs} briefs (${opts.synthesis.mode})` });
    }
  }

  progress({ stage: 'done', status: 'done', detail: `${model.length} elements` });

  return {
    summary: {
      elements: model.length,
      events: events.length,
      changeSets: changeSets.length,
      withCommit,
      jpaFiles,
      driftFindings: drift.length,
      jiraIssues,
      confluencePages,
      tickets: [...allTickets].sort(),
      storeDir,
      dicoProject,
      synthesisDir,
    },
    elements: model,
    events,
    drift,
  };
}

/** Recursively collect *.java files under a directory. */
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

function safe(id: string): string {
  return id.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function writeStore(out: string, elements: CIRElement[], events: CIREvent[], drift: DriftFinding[]): void {
  const dirFor: Record<CIRElement['kind'], string> = {
    entity: 'entities',
    attribute: 'attributes',
    relationship: 'relationships',
    constraint: 'constraints',
  };
  for (const sub of ['entities', 'attributes', 'relationships', 'constraints']) {
    fs.mkdirSync(path.join(out, 'model', sub), { recursive: true });
  }
  fs.mkdirSync(path.join(out, 'timeline'), { recursive: true });
  for (const el of elements) {
    CIRElementSchema.parse(el); // runtime-validate against the schema
    fs.writeFileSync(path.join(out, 'model', dirFor[el.kind], `${safe(el.id)}.json`), JSON.stringify(el, null, 2) + '\n');
  }
  const lines = events.map((e) => JSON.stringify(CIREventSchema.parse(e)));
  fs.writeFileSync(path.join(out, 'timeline', 'events.jsonl'), lines.join('\n') + '\n');
  fs.writeFileSync(path.join(out, 'drift.json'), JSON.stringify(drift, null, 2) + '\n');
}
