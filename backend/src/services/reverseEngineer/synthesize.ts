/**
 * Deterministic projection: CIR → a loadable smart-data-dico project.
 *
 * This is the structural half of synthesis (no AI): it turns the merged CIR
 * (entities/attributes/relationships/constraints + provenance + drift + Jira)
 * into the exact YAML the dictionary app consumes — entities with attributes,
 * physical constraints, relationships — seeding descriptions from Jira summaries
 * and capturing provenance/drift as metadata. An AI pass can later rewrite the
 * descriptions and propose Rules on top of this grounded skeleton.
 */
import fs from 'fs';
import path from 'path';
import { stringify as yamlStringify } from 'yaml';
import { generateUUID } from '../../utils/uuid.js';
import { AttributeType } from '../../models/EntitySchema.js';
import type { CIRElement } from './types.js';
import type { JiraIssue } from './jira.js';

interface Meta { name: string; value: string | number | boolean }

const pascal = (s: string): string => s.replace(/(^|[_\-\s])(\w)/g, (_, __, c) => c.toUpperCase());
const simpleName = (fqcn?: string): string | undefined => fqcn?.split('.').pop();

function mapType(dt?: string): AttributeType {
  const t = (dt ?? '').toLowerCase();
  if (/\b(uuid)\b/.test(t)) return AttributeType.UUID;
  if (/bool/.test(t)) return AttributeType.BOOLEAN;
  if (/(date|time|timestamp|instant|localdate)/.test(t)) return AttributeType.DATE;
  if (/(decimal|numeric|double|float|real|bigdecimal|number|money)/.test(t)) return AttributeType.NUMBER;
  if (/(bigint|integer|smallint|serial|\bint\b|long)/.test(t)) return AttributeType.INTEGER;
  return AttributeType.STRING; // varchar/char/text/clob/string/unknown
}

const CARD = {
  'many-to-one': ['many', 'one'],
  'one-to-many': ['one', 'many'],
  'one-to-one': ['one', 'one'],
  'many-to-many': ['many', 'many'],
} as const;

export interface EmitOptions {
  packageName?: string;
  issues?: Map<string, JiraIssue>;
}

export interface EmitResult {
  projectDir: string;
  entities: number;
  relationships: number;
}

/** Write a smart-data-dico project from the CIR into `outDir`. */
export function emitDicoProject(elements: CIRElement[], outDir: string, opts: EmitOptions = {}): EmitResult {
  const pkg = opts.packageName ?? 'reverse-engineered';
  const issues = opts.issues ?? new Map<string, JiraIssue>();

  const byTable = (kind: CIRElement['kind']) =>
    elements.filter((e) => e.kind === kind);

  // table → entity uuid (for relationship wiring)
  const entityUuid = new Map<string, string>();
  const ticketOf = (el: CIRElement) => el.provenance.find((p) => p.ticket)?.ticket;
  const firstSummary = (el: CIRElement): string => {
    for (const p of el.provenance) {
      const issue = p.ticket ? issues.get(p.ticket) : undefined;
      if (issue?.summary) return issue.summary;
    }
    return '';
  };

  const sourceMeta = (el: CIRElement): Meta[] => {
    const m: Meta[] = [];
    const t = ticketOf(el);
    const commit = el.provenance.find((p) => p.commit)?.commit;
    if (t) m.push({ name: 're.ticket', value: t });
    if (commit) m.push({ name: 're.commit', value: commit });
    if (typeof el.confidence === 'number' && el.confidence < 1) m.push({ name: 're.confidence', value: el.confidence });
    if (el.flags?.length) m.push({ name: 're.drift', value: el.flags.join(', ') });
    return m;
  };

  // ── Entities + attributes ──────────────────────────────────────────────────
  const entityFiles: Array<{ name: string; entity: Record<string, unknown> }> = [];
  for (const ent of byTable('entity')) {
    const table = ent.names.physical?.table ?? ent.id.replace(/^entity:/, '');
    const name = simpleName(ent.names.logical?.fqcn) ?? pascal(table);
    const uuid = generateUUID();
    entityUuid.set(table, uuid);

    const attrs = byTable('attribute').filter((a) => a.names.physical?.table === table);
    const attributes = attrs.map((a) => {
      const col = a.names.physical?.column ?? a.id.split('.').pop()!;
      const attrName = a.names.logical?.field ?? col;
      const validation = a.facts.validation as { maxLength?: number; pattern?: string } | undefined;
      const meta: Meta[] = [{ name: 'physical.columnName', value: col }, ...sourceMeta(a)];
      if (a.facts.isForeignKey) meta.push({ name: 'isForeignKey', value: true });
      return {
        uuid: generateUUID(),
        name: attrName,
        description: '',
        type: mapType(a.facts.dataType as string),
        required: a.facts.nullable === false,
        ...(a.facts.isPrimaryKey ? { primaryKey: true, unique: true } : {}),
        ...(validation && (validation.maxLength || validation.pattern) ? { validation } : {}),
        metadata: meta,
      };
    });

    const constraints = byTable('constraint')
      .filter((c) => c.names.physical?.table === table)
      .map((c) => ({
        kind: (c.facts.constraintType as string) ?? 'unique',
        ...(c.id.split('.').pop() ? { name: c.id.split('.').pop() } : {}),
        ...(Array.isArray(c.facts.foreignKeyColumns) ? { columns: c.facts.foreignKeyColumns } : {}),
      }))
      .filter((c) => c.kind === 'unique' || c.kind === 'index' || c.kind === 'check' || c.kind === 'foreignKey');

    const metadata: Meta[] = [{ name: 'physical.tableName', value: table }, ...sourceMeta(ent)];
    if (ent.names.logical?.fqcn) metadata.push({ name: 'orm.className', value: simpleName(ent.names.logical.fqcn)! });

    entityFiles.push({
      name,
      entity: {
        uuid,
        name,
        description: firstSummary(ent),
        metadata,
        ...(constraints.length ? { constraints } : {}),
        attributes,
      },
    });
  }

  // ── Relationships (only when both ends resolve to emitted entities) ─────────
  const relationships = byTable('relationship')
    .map((r) => {
      const src = (r.facts.source as string)?.replace(/^entity:/, '');
      const tgt = (r.facts.target as string)?.replace(/^entity:/, '');
      const su = entityUuid.get(src ?? ''), tu = entityUuid.get(tgt ?? '');
      if (!su || !tu) return null;
      const [sc, tc] = CARD[(r.facts.cardinality as keyof typeof CARD)] ?? ['many', 'one'];
      return {
        uuid: generateUUID(),
        description: `${pascal(src!)} → ${pascal(tgt!)}`,
        type: 'structural',
        source: { entity: su, cardinality: sc },
        target: { entity: tu, cardinality: tc },
        metadata: sourceMeta(r),
      };
    })
    .filter(Boolean);

  // ── Write the project ───────────────────────────────────────────────────────
  const root = path.resolve(outDir);
  fs.mkdirSync(path.join(root, '.dico'), { recursive: true });
  fs.writeFileSync(path.join(root, 'dico.config.json'), JSON.stringify({ version: 1 }, null, 2) + '\n');
  fs.writeFileSync(path.join(root, '.dico', 'stereotypes.yaml'), '[]\n');
  const pkgDir = path.join(root, pkg);
  fs.mkdirSync(pkgDir, { recursive: true });
  fs.writeFileSync(path.join(pkgDir, 'package.yaml'), `name: ${pkg}\n`);
  for (const { name, entity } of entityFiles) {
    fs.writeFileSync(path.join(pkgDir, `${name}.model.yaml`), yamlStringify({ entities: [entity] }));
  }
  if (relationships.length) {
    fs.writeFileSync(path.join(pkgDir, 'relationships.model.yaml'), yamlStringify({ relationships }));
  }

  return { projectDir: root, entities: entityFiles.length, relationships: relationships.length };
}
