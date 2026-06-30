/**
 * Liquibase changelog extractor. Supports YAML and XML changelogs (the two
 * dominant formats); `loadChangelog` dispatches by file extension and follows
 * `include` / `includeAll` recursively — including across formats (an XML master
 * can include YAML leaves and vice-versa). Both adapters normalize to the SAME
 * canonical `RawChangeSet[]` shape the service consumes (YAML-native op shape).
 *
 * SQL-formatted changelogs are the next adapter. Ordering note: the XML parser
 * groups same-typed siblings, so cross-type document order within a single file
 * is approximate — timeline order comes from commit dates regardless.
 */
import fs from 'fs';
import path from 'path';
import { parse as parseYaml } from 'yaml';
import { XMLParser } from 'fast-xml-parser';
import type { RawChangeSet } from './types.js';

interface YamlEntry {
  changeSet?: { id: string | number; author?: string; comment?: string; changes?: Array<Record<string, unknown>> };
  include?: { file: string; relativeToChangelogFile?: boolean };
  includeAll?: { path: string; relativeToChangelogFile?: boolean };
}

const toArray = <T>(v: T | T[] | undefined): T[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

/** Resolve an include target relative to the changelog dir (default) or repo root. */
function resolveInclude(dir: string, repoRoot: string, file: string, relativeToChangelogFile?: boolean): string {
  return relativeToChangelogFile === false ? path.join(repoRoot, file) : path.join(dir, file);
}

/** Read + parse one changelog into ordered changeSets, following includes. */
export function loadChangelog(absFile: string, repoRoot: string, seen = new Set<string>()): RawChangeSet[] {
  const real = path.resolve(absFile);
  if (seen.has(real)) return []; // guard against include cycles
  seen.add(real);
  if (!fs.existsSync(real)) {
    process.stderr.write(`[liquibase] missing changelog: ${real}\n`);
    return [];
  }
  const content = fs.readFileSync(real, 'utf-8');
  return /\.xml$/i.test(real)
    ? loadXmlChangelog(content, real, repoRoot, seen)
    : loadYamlChangelog(content, real, repoRoot, seen);
}

function loadYamlChangelog(content: string, real: string, repoRoot: string, seen: Set<string>): RawChangeSet[] {
  const doc = parseYaml(content) as { databaseChangeLog?: YamlEntry[] } | null;
  const dir = path.dirname(real);
  const out: RawChangeSet[] = [];
  for (const entry of doc?.databaseChangeLog ?? []) {
    if (entry.changeSet) {
      const cs = entry.changeSet;
      out.push({ id: String(cs.id), author: cs.author, comment: cs.comment, file: path.relative(repoRoot, real), changes: cs.changes ?? [] });
    } else if (entry.include?.file) {
      out.push(...loadChangelog(resolveInclude(dir, repoRoot, entry.include.file, entry.include.relativeToChangelogFile), repoRoot, seen));
    } else if (entry.includeAll?.path) {
      out.push(...loadIncludeAll(resolveInclude(dir, repoRoot, entry.includeAll.path, entry.includeAll.relativeToChangelogFile), repoRoot, seen));
    }
  }
  return out;
}

const xmlParser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', parseAttributeValue: true });

function loadXmlChangelog(content: string, real: string, repoRoot: string, seen: Set<string>): RawChangeSet[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dcl = (xmlParser.parse(content) as any)?.databaseChangeLog;
  if (!dcl) return [];
  const dir = path.dirname(real);
  const rel = path.relative(repoRoot, real);
  const out: RawChangeSet[] = [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const inc of toArray<any>(dcl.include)) {
    if (inc['@_file']) out.push(...loadChangelog(resolveInclude(dir, repoRoot, inc['@_file'], inc['@_relativeToChangelogFile']), repoRoot, seen));
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const inc of toArray<any>(dcl.includeAll)) {
    if (inc['@_path']) out.push(...loadIncludeAll(resolveInclude(dir, repoRoot, inc['@_path'], inc['@_relativeToChangelogFile']), repoRoot, seen));
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const cs of toArray<any>(dcl.changeSet)) {
    out.push({
      id: String(cs['@_id']),
      author: cs['@_author'],
      comment: typeof cs.comment === 'string' ? cs.comment : cs.comment?.['#text'],
      file: rel,
      changes: xmlChanges(cs),
    });
  }
  return out;
}

/** Build the canonical `changes` array from an XML changeSet's child op elements. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function xmlChanges(cs: any): Array<Record<string, unknown>> {
  const changes: Array<Record<string, unknown>> = [];
  for (const [key, value] of Object.entries(cs)) {
    if (key.startsWith('@_') || key === 'comment' || key === '#text') continue;
    for (const op of toArray(value)) changes.push({ [key]: stripAttrs(op) });
  }
  return changes;
}

/** Recursively turn fast-xml-parser output into the YAML-native op shape. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function stripAttrs(node: any): any {
  if (node === null || typeof node !== 'object') return node;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node)) {
    if (k === '#text') continue;
    if (k.startsWith('@_')) out[k.slice(2)] = v;
    else if (k === 'column') out.columns = toArray(v).map((c) => ({ column: stripAttrs(c) }));
    else if (k === 'constraints') out.constraints = stripAttrs(toArray(v)[0] ?? v);
    else out[k] = stripAttrs(v);
  }
  return out;
}

/** includeAll: every *.yaml/*.yml/*.xml under a directory, lexically ordered. */
function loadIncludeAll(base: string, repoRoot: string, seen: Set<string>): RawChangeSet[] {
  if (!fs.existsSync(base)) return [];
  const out: RawChangeSet[] = [];
  for (const f of fs.readdirSync(base).filter((f) => /\.(ya?ml|xml)$/i.test(f)).sort()) {
    out.push(...loadChangelog(path.join(base, f), repoRoot, seen));
  }
  return out;
}

/** Extract `n` from a Liquibase type like VARCHAR(254) / NVARCHAR2(50). */
export function parseLength(type: unknown): number | undefined {
  const m = typeof type === 'string' ? type.match(/\((\d+)/) : null;
  return m ? Number(m[1]) : undefined;
}
