/**
 * JPA extractor — the logical (object-model) truth, to pair with Liquibase's
 * physical truth and surface drift.
 *
 * A focused, comment/string-aware static scanner (not a full Java parser): it
 * strips comments, finds @Entity/@Embeddable classes + their @Table, and reads
 * each field's annotations (@Id, @Column, @ManyToOne/@OneToMany/@ManyToMany/
 * @OneToOne, @JoinColumn, Bean Validation). It maps real-world JPA reliably;
 * exotic Java (nested generics in fields, multi-var declarations) is out of
 * scope — swap in java-parser / tree-sitter-java behind this same interface if
 * fidelity ever demands it.
 *
 * Emits CIR elements with BOTH faces: logical (fqcn/field) and physical
 * (table/column via @Table/@Column, falling back to the JPA default = the
 * simple class / field name), provenance.source 'jpa'.
 */
import { type CIRElement, type Provenance } from './types.js';

type AnnArgs = Record<string, string | number | boolean>;
type Anns = Record<string, AnnArgs>;

/** Replace // and block comments with spaces (string/char-literal aware). */
export function stripComments(src: string): string {
  let out = '';
  for (let i = 0; i < src.length; i++) {
    const c = src[i], n = src[i + 1];
    if (c === '"' || c === "'") {
      const q = c; out += c; i++;
      for (; i < src.length; i++) {
        out += src[i];
        if (src[i] === '\\') { out += src[i + 1] ?? ''; i++; continue; }
        if (src[i] === q) break;
      }
      continue;
    }
    if (c === '/' && n === '/') { while (i < src.length && src[i] !== '\n') i++; out += '\n'; continue; }
    if (c === '/' && n === '*') { i += 2; while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++; i++; out += ' '; continue; }
    out += c;
  }
  return out;
}

function coerce(v: string): string | number | boolean {
  const t = v.trim();
  if (/^".*"$/.test(t)) return t.slice(1, -1);
  if (t === 'true') return true;
  if (t === 'false') return false;
  if (/^\d+$/.test(t)) return Number(t);
  return t.replace(/\.class$/, '');
}

/** Parse an annotation block (`@A @B(x=1, y="z")`) into a name→args map. */
function parseAnnotations(block: string): Anns {
  const anns: Anns = {};
  const re = /@(\w+)\s*(?:\(([^)]*)\))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block))) {
    const args: AnnArgs = {};
    const argStr = m[2] ?? '';
    const pair = /(\w+)\s*=\s*("(?:[^"\\]|\\.)*"|true|false|\d+|[\w.]+)/g;
    let p: RegExpExecArray | null;
    let found = false;
    while ((p = pair.exec(argStr))) { found = true; args[p[1]] = coerce(p[2]); }
    if (!found && argStr.trim()) args._value = coerce(argStr);
    anns[m[1]] = args;
  }
  return anns;
}

/** Find the index of the `}` matching the `{` at `open` (string-aware). */
function matchBrace(src: string, open: number): number {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === '"' || c === "'") { const q = c; i++; for (; i < src.length; i++) { if (src[i] === '\\') { i++; continue; } if (src[i] === q) break; } continue; }
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return i;
  }
  return src.length;
}

const baseType = (t: string): string => t.replace(/.*<\s*([\w.]+)\s*>.*/, '$1').replace(/\[\]$/, '').split('.').pop() ?? t;

export interface JpaExtractOptions {
  fileRel: string;
  provenance: () => Provenance; // base provenance (git commit attached by caller)
}

/** Extract CIR elements from one .java source. */
export function extractJpa(src0: string, opts: JpaExtractOptions): CIRElement[] {
  const src = stripComments(src0);
  const pkg = src.match(/\bpackage\s+([\w.]+)\s*;/)?.[1] ?? '';
  const elements: CIRElement[] = [];

  // Each class with a preceding annotation block.
  const classRe = /((?:@\w+\s*(?:\([^)]*\))?\s*)+)(?:public|final|abstract|\s)*class\s+(\w+)/g;
  let cm: RegExpExecArray | null;
  while ((cm = classRe.exec(src))) {
    const classAnns = parseAnnotations(cm[1]);
    if (!('Entity' in classAnns) && !('Embeddable' in classAnns)) continue;
    const className = cm[2];
    const fqcn = pkg ? `${pkg}.${className}` : className;
    const table = (classAnns.Table?.name as string) ?? className;

    const bodyOpen = src.indexOf('{', cm.index);
    const body = src.slice(bodyOpen + 1, matchBrace(src, bodyOpen));

    const prov = (): Provenance => ({ ...opts.provenance(), source: 'jpa', ref: `${fqcn}` });

    elements.push({
      id: `entity:${table}`,
      kind: 'entity',
      names: { physical: { table }, logical: { fqcn } },
      facts: { entity: true },
      provenance: [{ ...prov(), ref: `${opts.fileRel}:${className}` }],
      lifecycle: { status: 'active' },
      confidence: 1,
    });

    // Fields: annotation block + type + name, terminated by `=` or `;`
    // (methods have `(` before the terminator → naturally excluded).
    const fieldRe = /((?:@\w+\s*(?:\([^)]*\))?\s*)+)(?:public|private|protected|static|final|transient|volatile|\s)*([\w.]+(?:<[^;{=]*>)?(?:\[\])?)\s+(\w+)\s*(?:=|;)/g;
    let fm: RegExpExecArray | null;
    while ((fm = fieldRe.exec(body))) {
      const anns = parseAnnotations(fm[1]);
      const javaType = fm[2].trim();
      const field = fm[3];
      const isRel = ['ManyToOne', 'OneToMany', 'ManyToMany', 'OneToOne'].find((r) => r in anns);

      if (isRel) {
        // MVP maps only the OWNING, FK-bearing side (@ManyToOne / @OneToOne with
        // @JoinColumn) to a physical relationship + column — the side whose FK
        // lives on THIS table. Inverse collections (@OneToMany(mappedBy=…),
        // @ManyToMany) carry no column here and would otherwise create false
        // "missing FK" drift; they're a later refinement.
        const owning = (isRel === 'ManyToOne' || isRel === 'OneToOne') && typeof anns.JoinColumn?.name === 'string';
        if (!owning) continue;
        const card = isRel === 'OneToOne' ? 'one-to-one' : 'many-to-one';
        const target = baseType(javaType);
        const col = anns.JoinColumn.name as string;
        elements.push({
          id: `relationship:${table}->${target.toLowerCase()}`,
          kind: 'relationship',
          names: { physical: { table }, logical: { fqcn, field } },
          facts: { source: `entity:${table}`, target: `entity:${target.toLowerCase()}`, cardinality: card, foreignKeyColumns: [col] },
          provenance: [prov()],
          lifecycle: { status: 'active' },
          confidence: 1,
        });
        elements.push({
          id: `attribute:${table}.${col}`,
          kind: 'attribute',
          names: { physical: { table, column: col }, logical: { fqcn, field } },
          facts: { dataType: javaType, nullable: anns.JoinColumn?.nullable !== false, isForeignKey: true },
          provenance: [prov()],
          lifecycle: { status: 'active' },
          confidence: 1,
        });
        continue;
      }

      const column = (anns.Column?.name as string) ?? field;
      const length = (anns.Column?.length as number) ?? (anns.Size?.max as number);
      const nullable = anns.Column?.nullable === false ? false : !('NotNull' in anns) && !('Id' in anns);
      const validation: Record<string, unknown> = {};
      if (length) validation.maxLength = length;
      if (anns.Pattern?.regexp) validation.pattern = anns.Pattern.regexp;
      const facts: Record<string, unknown> = {
        dataType: javaType,
        nullable,
        isPrimaryKey: 'Id' in anns,
      };
      if (Object.keys(validation).length) facts.validation = validation;
      elements.push({
        id: `attribute:${table}.${column}`,
        kind: 'attribute',
        names: { physical: { table, column }, logical: { fqcn, field } },
        facts,
        provenance: [prov()],
        lifecycle: { status: 'active' },
        confidence: 1,
      });
    }
  }
  return elements;
}
