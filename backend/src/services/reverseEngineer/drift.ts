/**
 * Merge the JPA (logical) CIR into the Liquibase (physical) CIR and surface
 * drift — the dividend of having both. Drift findings are attached to the merged
 * element's `flags[]` and returned as a list for the report.
 */
import { type CIRElement } from './types.js';

export interface DriftFinding {
  element: string;
  kind: 'table-missing' | 'column-missing' | 'relationship-no-fk' | 'nullable-mismatch' | 'length-mismatch' | 'orphan-column';
  detail: string;
}

const maxLen = (el: CIRElement): number | undefined => (el.facts.validation as { maxLength?: number } | undefined)?.maxLength;

/** Mutates `physical` (the Liquibase element map) in place; returns drift findings. */
export function mergeJpa(physical: Map<string, CIRElement>, jpa: CIRElement[]): DriftFinding[] {
  const drift: DriftFinding[] = [];
  const jpaIds = new Set(jpa.map((e) => e.id));
  const flag = (el: CIRElement, kind: DriftFinding['kind'], detail: string) => {
    el.flags = [...(el.flags ?? []), kind].filter((v, i, a) => a.indexOf(v) === i);
    drift.push({ element: el.id, kind, detail });
  };

  for (const j of jpa) {
    const db = physical.get(j.id);
    if (db) {
      // Same element seen from both sides → enrich + compare.
      db.names.logical = db.names.logical ?? j.names.logical;
      db.provenance.push(...j.provenance);
      if (j.kind === 'attribute') {
        const jn = j.facts.nullable, dn = db.facts.nullable;
        if (typeof jn === 'boolean' && typeof dn === 'boolean' && jn !== dn) {
          flag(db, 'nullable-mismatch', `JPA nullable=${jn} but DB nullable=${dn}`);
        }
        const jl = maxLen(j), dl = maxLen(db);
        if (jl && dl && jl !== dl) flag(db, 'length-mismatch', `JPA maxLength=${jl} but DB maxLength=${dl}`);
      }
    } else {
      // In code, not in the DB schema.
      const kind = j.kind === 'entity' ? 'table-missing' : j.kind === 'relationship' ? 'relationship-no-fk' : 'column-missing';
      j.confidence = 0.7;
      flag(j, kind, `In JPA (${j.names.logical?.fqcn ?? ''}${j.names.logical?.field ? '.' + j.names.logical.field : ''}) but not in Liquibase`);
      physical.set(j.id, j); // keep it in the model so the gap is visible
    }
  }

  // Columns in the DB with no JPA field — only flag on tables JPA actually covers.
  const jpaTables = new Set(jpa.filter((j) => j.provenance.some((p) => p.source === 'jpa')).map((j) => j.names.physical?.table));
  for (const [id, el] of physical) {
    if (el.kind !== 'attribute' || jpaIds.has(id)) continue;
    if (el.provenance.some((p) => p.source === 'jpa')) continue;
    if (jpaTables.has(el.names.physical?.table)) flag(el, 'orphan-column', `Column in DB but no JPA field on ${el.names.physical?.table}`);
  }

  return drift;
}
