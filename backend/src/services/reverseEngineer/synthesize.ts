/**
 * Deterministic projection: CIR → a loadable smart-data-dico project.
 *
 * Two modes:
 *  - overwrite (default): write a fresh project. UUIDs are DETERMINISTIC (UUIDv5
 *    of the canonical CIR id), so repeated runs are idempotent.
 *  - merge (update mode): patch an EXISTING project in place — reuse existing
 *    UUIDs, PRESERVE human prose (descriptions, rules, review comments) and any
 *    unmodeled fields, refresh only the structural facts, add new elements, and
 *    tag attributes that vanished from the source (re.removedFromSource).
 *
 * Structural half of synthesis (no AI). Descriptions seed from Jira summaries;
 * provenance/drift land as `re.*` metadata.
 */
import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import { parse as yamlParse, stringify as yamlStringify } from 'yaml';
import { AttributeType } from '../../models/EntitySchema.js';
import type { CIRElement } from './types.js';
import type { JiraIssue } from './jira.js';

interface Meta { name: string; value: unknown }

const pascal = (s: string): string => s.replace(/(^|[_\-\s])(\w)/g, (_, __, c) => c.toUpperCase());
const simpleName = (fqcn?: string): string | undefined => fqcn?.split('.').pop();

// Deterministic UUIDv5 (SHA-1) so a given canonical key always maps to the same
// id — the basis of idempotent re-runs.
const NS = '6ba7b810-9dad-11d1-80b4-00c04fd430c8'; // RFC-4122 DNS namespace
function uuidv5(name: string): string {
  const ns = Buffer.from(NS.replace(/-/g, ''), 'hex');
  const h = createHash('sha1').update(ns).update(name).digest();
  const b = Buffer.from(h.subarray(0, 16));
  b[6] = (b[6] & 0x0f) | 0x50; // version 5
  b[8] = (b[8] & 0x3f) | 0x80; // variant
  const x = b.toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`;
}

function mapType(dt?: string): AttributeType {
  const t = (dt ?? '').toLowerCase();
  if (/\b(uuid)\b/.test(t)) return AttributeType.UUID;
  if (/bool/.test(t)) return AttributeType.BOOLEAN;
  if (/(date|time|timestamp|instant|localdate)/.test(t)) return AttributeType.DATE;
  if (/(decimal|numeric|double|float|real|bigdecimal|number|money)/.test(t)) return AttributeType.NUMBER;
  if (/(bigint|integer|smallint|serial|\bint\b|long)/.test(t)) return AttributeType.INTEGER;
  return AttributeType.STRING;
}

const CARD = {
  'many-to-one': ['many', 'one'],
  'one-to-many': ['one', 'many'],
  'one-to-one': ['one', 'one'],
  'many-to-many': ['many', 'many'],
} as const;

export type EmitMode = 'overwrite' | 'merge';
export interface EmitOptions {
  packageName?: string;
  issues?: Map<string, JiraIssue>;
  mode?: EmitMode;
}
export interface EmitResult {
  projectDir: string;
  entities: number;
  relationships: number;
  mode: EmitMode;
  merged: number; // entities patched in place (merge mode)
  added: number; // entities newly created
}

// ── Desired model (built from the CIR; structural truth + seeded prose) ──────
interface DesiredAttr { col: string; name: string; uuid: string; type: AttributeType; required: boolean; primaryKey?: boolean; unique?: boolean; validation?: unknown; metadata: Meta[] }
interface DesiredEntity { table: string; name: string; uuid: string; description: string; metadata: Meta[]; constraints: Record<string, unknown>[]; attributes: DesiredAttr[] }
interface DesiredRel { uuid: string; description: string; sourceTable: string; targetTable: string; sourceCard: string; targetCard: string; metadata: Meta[] }

function buildDesired(elements: CIRElement[], issues: Map<string, JiraIssue>) {
  const ofKind = (k: CIRElement['kind']) => elements.filter((e) => e.kind === k);
  const ticketOf = (el: CIRElement) => el.provenance.find((p) => p.ticket)?.ticket;
  const firstSummary = (el: CIRElement): string => {
    for (const p of el.provenance) { const i = p.ticket ? issues.get(p.ticket) : undefined; if (i?.summary) return i.summary; }
    return '';
  };
  const sourceMeta = (el: CIRElement): Meta[] => {
    const m: Meta[] = [];
    const t = ticketOf(el);
    const commit = el.provenance.find((p) => p.commit)?.commit;
    if (t) m.push({ name: 're.ticket', value: t });
    if (commit) m.push({ name: 're.commit', value: commit });
    if (typeof el.confidence === 'number' && el.confidence < 1) m.push({ name: 're.confidence', value: el.confidence });
    if (el.repos?.length) m.push({ name: 're.repos', value: el.repos.join(', ') });
    if (el.flags?.length) m.push({ name: 're.drift', value: el.flags.join(', ') });
    return m;
  };

  const entities: DesiredEntity[] = ofKind('entity').map((ent) => {
    const table = ent.names.physical?.table ?? ent.id.replace(/^entity:/, '');
    const name = simpleName(ent.names.logical?.fqcn) ?? pascal(table);
    const metadata: Meta[] = [{ name: 'physical.tableName', value: table }, ...sourceMeta(ent)];
    if (ent.names.logical?.fqcn) metadata.push({ name: 'orm.className', value: simpleName(ent.names.logical.fqcn)! });
    const attributes: DesiredAttr[] = elements.filter((a) => a.kind === 'attribute' && a.names.physical?.table === table).map((a) => {
      const col = a.names.physical?.column ?? a.id.split('.').pop()!;
      const validation = a.facts.validation as { maxLength?: number; pattern?: string } | undefined;
      const meta: Meta[] = [{ name: 'physical.columnName', value: col }, ...sourceMeta(a)];
      if (a.facts.isForeignKey) meta.push({ name: 'isForeignKey', value: true });
      return {
        col, name: a.names.logical?.field ?? col, uuid: uuidv5(a.id),
        type: mapType(a.facts.dataType as string), required: a.facts.nullable === false,
        ...(a.facts.isPrimaryKey ? { primaryKey: true, unique: true } : {}),
        ...(validation && (validation.maxLength || validation.pattern) ? { validation } : {}),
        metadata: meta,
      };
    });
    const constraints = elements.filter((c) => c.kind === 'constraint' && c.names.physical?.table === table).map((c) => ({
      kind: (c.facts.constraintType as string) ?? 'unique',
      ...(c.id.split('.').pop() ? { name: c.id.split('.').pop() } : {}),
      ...(Array.isArray(c.facts.foreignKeyColumns) ? { columns: c.facts.foreignKeyColumns } : {}),
    })).filter((c) => ['unique', 'index', 'check', 'foreignKey'].includes(c.kind));
    return { table, name, uuid: uuidv5(ent.id), description: firstSummary(ent), metadata, constraints, attributes };
  });

  const byTable = new Map(entities.map((e) => [e.table, e.uuid]));
  const relationships: DesiredRel[] = ofKind('relationship').map((r): DesiredRel | null => {
    const src = String(r.facts.source ?? '').replace(/^entity:/, '');
    const tgt = String(r.facts.target ?? '').replace(/^entity:/, '');
    if (!byTable.has(src) || !byTable.has(tgt)) return null;
    const [sc, tc] = CARD[r.facts.cardinality as keyof typeof CARD] ?? ['many', 'one'];
    return { uuid: uuidv5(r.id), description: `${pascal(src)} → ${pascal(tgt)}`, sourceTable: src, targetTable: tgt, sourceCard: sc, targetCard: tc, metadata: sourceMeta(r) };
  }).filter((r): r is DesiredRel => r !== null);

  return { entities, relationships };
}

// ── metadata helpers (operate on the loose YAML objects) ─────────────────────
const TOOL_META = (n: string) => n.startsWith('re.') || n === 'physical.tableName' || n === 'physical.columnName' || n === 'orm.className' || n === 'isForeignKey';
function mergeMeta(existing: Meta[] | undefined, desired: Meta[]): Meta[] {
  const human = (existing ?? []).filter((m) => !TOOL_META(m.name)); // keep human/other metadata
  return [...human, ...desired];
}

export function emitDicoProject(elements: CIRElement[], outDir: string, opts: EmitOptions = {}): EmitResult {
  const mode = opts.mode ?? 'overwrite';
  const pkg = opts.packageName ?? 'reverse-engineered';
  const { entities, relationships } = buildDesired(elements, opts.issues ?? new Map());
  const root = path.resolve(outDir);

  // Build the canonical entity object from a desired entity (overwrite / new).
  const toEntityObj = (d: DesiredEntity): Record<string, unknown> => ({
    uuid: d.uuid, name: d.name, description: d.description, metadata: d.metadata,
    ...(d.constraints.length ? { constraints: d.constraints } : {}),
    attributes: d.attributes.map((a) => ({ uuid: a.uuid, name: a.name, description: '', type: a.type, required: a.required, ...(a.primaryKey ? { primaryKey: true, unique: true } : {}), ...(a.validation ? { validation: a.validation } : {}), metadata: a.metadata })),
  });
  const toRelObj = (r: DesiredRel, uuidByTable: Map<string, string>) => ({
    uuid: r.uuid, description: r.description, type: 'structural',
    source: { entity: uuidByTable.get(r.sourceTable)!, cardinality: r.sourceCard },
    target: { entity: uuidByTable.get(r.targetTable)!, cardinality: r.targetCard },
    metadata: r.metadata,
  });

  if (mode === 'merge' && fs.existsSync(path.join(root, 'dico.config.json'))) {
    return mergeProject(root, pkg, entities, relationships, toEntityObj, toRelObj);
  }

  // ── overwrite (fresh project) ──────────────────────────────────────────────
  const uuidByTable = new Map(entities.map((e) => [e.table, e.uuid]));
  fs.mkdirSync(path.join(root, '.dico'), { recursive: true });
  fs.writeFileSync(path.join(root, 'dico.config.json'), JSON.stringify({ version: 1 }, null, 2) + '\n');
  fs.writeFileSync(path.join(root, '.dico', 'stereotypes.yaml'), '[]\n');
  const pkgDir = path.join(root, pkg);
  fs.mkdirSync(pkgDir, { recursive: true });
  fs.writeFileSync(path.join(pkgDir, 'package.yaml'), `name: ${pkg}\n`);
  for (const d of entities) fs.writeFileSync(path.join(pkgDir, `${d.name}.model.yaml`), yamlStringify({ entities: [toEntityObj(d)] }));
  if (relationships.length) fs.writeFileSync(path.join(pkgDir, 'relationships.model.yaml'), yamlStringify({ relationships: relationships.map((r) => toRelObj(r, uuidByTable)) }));
  return { projectDir: root, entities: entities.length, relationships: relationships.length, mode, merged: 0, added: entities.length };
}

// ── merge (update an existing project in place) ──────────────────────────────
interface LoadedFile { path: string; doc: Record<string, unknown>; dirty: boolean }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const metaVal = (obj: any, name: string): unknown => (obj?.metadata as Meta[] | undefined)?.find((m) => m.name === name)?.value;

function mergeProject(
  root: string,
  pkg: string,
  entities: DesiredEntity[],
  relationships: DesiredRel[],
  toEntityObj: (d: DesiredEntity) => Record<string, unknown>,
  toRelObj: (r: DesiredRel, m: Map<string, string>) => Record<string, unknown>,
): EmitResult {
  const files: LoadedFile[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const entByTable = new Map<string, { file: LoadedFile; ent: any }>();
  let relFile: LoadedFile | undefined;

  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(root, entry.name);
    if (!fs.existsSync(path.join(dir, 'package.yaml'))) continue;
    for (const f of fs.readdirSync(dir).filter((f) => /\.ya?ml$/.test(f) && f !== 'package.yaml')) {
      const p = path.join(dir, f);
      let doc: Record<string, unknown>;
      try { doc = (yamlParse(fs.readFileSync(p, 'utf-8')) ?? {}) as Record<string, unknown>; } catch { continue; }
      const lf: LoadedFile = { path: p, doc, dirty: false };
      files.push(lf);
      if (Array.isArray(doc.entities)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        for (const ent of doc.entities as any[]) {
          const key = String(metaVal(ent, 'physical.tableName') ?? ent.name ?? '').toLowerCase();
          if (key) entByTable.set(key, { file: lf, ent });
        }
      }
      if (Array.isArray(doc.relationships) && !relFile) relFile = lf;
    }
  }

  const uuidByTable = new Map<string, string>();
  let merged = 0, added = 0;
  const newEntities: DesiredEntity[] = [];

  for (const d of entities) {
    const hit = entByTable.get(d.table.toLowerCase()) ?? entByTable.get(d.name.toLowerCase());
    if (!hit) { newEntities.push(d); uuidByTable.set(d.table, d.uuid); continue; }
    const ent = hit.ent;
    uuidByTable.set(d.table, ent.uuid ?? d.uuid); // reuse the existing UUID
    // description: keep human-authored prose; only fill if empty.
    if (!ent.description || !String(ent.description).trim()) ent.description = d.description;
    ent.metadata = mergeMeta(ent.metadata, d.metadata);
    if (d.constraints.length) ent.constraints = d.constraints; // structural — refresh
    // attributes: merge by physical column
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const existingAttrs: any[] = Array.isArray(ent.attributes) ? ent.attributes : (ent.attributes = []);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const byCol = new Map<string, any>(existingAttrs.map((a) => [String(metaVal(a, 'physical.columnName') ?? a.name).toLowerCase(), a]));
    const desiredCols = new Set(d.attributes.map((a) => a.col.toLowerCase()));
    for (const da of d.attributes) {
      const ex = byCol.get(da.col.toLowerCase());
      if (ex) {
        ex.type = da.type; ex.required = da.required; // structural refresh
        if (da.validation) ex.validation = da.validation;
        if (da.primaryKey) { ex.primaryKey = true; ex.unique = true; }
        ex.metadata = mergeMeta(ex.metadata, da.metadata);
        // keep ex.uuid + ex.description (human prose)
      } else {
        existingAttrs.push({ uuid: da.uuid, name: da.name, description: '', type: da.type, required: da.required, ...(da.primaryKey ? { primaryKey: true, unique: true } : {}), ...(da.validation ? { validation: da.validation } : {}), metadata: da.metadata });
      }
    }
    // existing attrs no longer in the source → keep, tag.
    for (const ex of existingAttrs) {
      const col = String(metaVal(ex, 'physical.columnName') ?? ex.name).toLowerCase();
      if (!desiredCols.has(col)) {
        ex.metadata = Array.isArray(ex.metadata) ? ex.metadata : [];
        if (!ex.metadata.some((m: Meta) => m.name === 're.removedFromSource')) ex.metadata.push({ name: 're.removedFromSource', value: true });
      }
    }
    hit.file.dirty = true;
    merged++;
  }

  // relationships: update-or-append by source/target uuid
  if (relationships.length) {
    const target = relFile ?? (() => {
      const pkgDir = path.join(root, pkg);
      fs.mkdirSync(pkgDir, { recursive: true });
      if (!fs.existsSync(path.join(pkgDir, 'package.yaml'))) fs.writeFileSync(path.join(pkgDir, 'package.yaml'), `name: ${pkg}\n`);
      const lf: LoadedFile = { path: path.join(pkgDir, 'relationships.model.yaml'), doc: { relationships: [] }, dirty: true };
      files.push(lf);
      return lf;
    })();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rels: any[] = Array.isArray(target.doc.relationships) ? target.doc.relationships as any[] : (target.doc.relationships = [] as any[]);
    for (const r of relationships) {
      const su = uuidByTable.get(r.sourceTable), tu = uuidByTable.get(r.targetTable);
      if (!su || !tu) continue;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ex = rels.find((x: any) => x.source?.entity === su && x.target?.entity === tu);
      if (ex) { ex.source.cardinality = r.sourceCard; ex.target.cardinality = r.targetCard; ex.metadata = mergeMeta(ex.metadata, r.metadata); }
      else rels.push(toRelObj(r, uuidByTable));
    }
    target.dirty = true;
  }

  // write dirty files + new entity files
  for (const lf of files) if (lf.dirty) fs.writeFileSync(lf.path, yamlStringify(lf.doc));
  if (newEntities.length) {
    const pkgDir = path.join(root, pkg);
    fs.mkdirSync(pkgDir, { recursive: true });
    if (!fs.existsSync(path.join(pkgDir, 'package.yaml'))) fs.writeFileSync(path.join(pkgDir, 'package.yaml'), `name: ${pkg}\n`);
    for (const d of newEntities) { fs.writeFileSync(path.join(pkgDir, `${d.name}.model.yaml`), yamlStringify({ entities: [toEntityObj(d)] })); added++; }
  }

  return { projectDir: root, entities: entities.length, relationships: relationships.length, mode: 'merge', merged, added };
}
