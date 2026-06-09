/**
 * In-memory search index for the top-bar spotlight (⌘K).
 *
 * A lightweight client-side index built once from `getAllPackages()` (+ the
 * stereotype list) and queried with Fuse.js for fuzzy, typo-tolerant matching.
 * Matching is case-insensitive (Fuse default) so "ORDER", "order" and "Order"
 * all hit the same records.
 *
 * "Everything" is indexed — entities, attributes, packages, relationships,
 * entity metadata, cases and stereotypes — but results are re-ranked so the
 * primary modelling objects (entity → attribute → package) float to the top
 * ahead of incidental matches, blending Fuse's match score with a per-kind tier.
 *
 * Pure module (no React) so it can be unit-tested in isolation.
 */
import Fuse from 'fuse.js';
import type { Package, Stereotype } from '../../../types';

export type RecordKind =
  | 'entity'
  | 'attribute'
  | 'package'
  | 'relationship'
  | 'metadata'
  | 'case'
  | 'stereotype';

export interface IndexRecord {
  /** Stable unique id for the record (used as React key + de-dupe). */
  id: string;
  kind: RecordKind;
  /** Primary label shown + most heavily weighted for matching. */
  name: string;
  description: string;
  /** Owning package ('' for project-level records like stereotypes). */
  service: string;
  /** Owning entity name for attribute / metadata records. */
  entityName?: string;
  /** Extra free text folded into matching (type, stereotype, parent entity…). */
  keywords: string;
  /** Router path to navigate to when the record is chosen. */
  route: string;
}

/**
 * Per-kind ranking tier — lower is more important. The primary modelling
 * objects outrank incidental matches of equal textual quality.
 */
export const KIND_TIER: Record<RecordKind, number> = {
  entity: 0,
  attribute: 1,
  package: 2,
  relationship: 3,
  case: 3,
  metadata: 4,
  stereotype: 4,
};

/** Each tier worsens the effective score by this much (Fuse score: 0 = perfect). */
const TIER_PENALTY = 0.06;

const entityRoute = (service: string, entity: string) =>
  `/packages/${service}/entities/${entity}`;

/**
 * Flatten the package tree (+ stereotypes) into a flat record list. Defensive
 * about optional/legacy fields — entities may carry inline `rules` (#106) and
 * metadata that aren't in the strict TS type.
 */
export function buildRecords(packages: Package[], stereotypes: Stereotype[] = []): IndexRecord[] {
  const records: IndexRecord[] = [];

  for (const pkg of packages) {
    const service = pkg.name;

    records.push({
      id: `package:${service}`,
      kind: 'package',
      name: service,
      description: pkg.description ?? '',
      service,
      keywords: 'package service',
      route: `/packages/${service}`,
    });

    for (const entity of pkg.entities ?? []) {
      const route = entityRoute(service, entity.name);
      records.push({
        id: `entity:${service}:${entity.name}`,
        kind: 'entity',
        name: entity.name,
        description: entity.description ?? '',
        service,
        keywords: `entity ${entity.stereotype ?? ''} ${entity.status ?? ''}`.trim(),
        route,
      });

      for (const attr of entity.attributes ?? []) {
        records.push({
          id: `attr:${service}:${entity.name}:${attr.name}`,
          kind: 'attribute',
          name: attr.name,
          description: attr.description ?? '',
          service,
          entityName: entity.name,
          keywords: `attribute ${entity.name} ${attr.type ?? ''}`.trim(),
          route,
        });
      }

      for (const meta of entity.metadata ?? []) {
        records.push({
          id: `meta:${service}:${entity.name}:${meta.name}`,
          kind: 'metadata',
          name: meta.name,
          description: String(meta.value ?? ''),
          service,
          entityName: entity.name,
          keywords: `metadata ${entity.name}`,
          route,
        });
      }
    }

    for (const rel of pkg.relationships ?? []) {
      const label = rel.description || rel.type || 'relationship';
      records.push({
        id: `rel:${service}:${rel.uuid}`,
        kind: 'relationship',
        name: label,
        description: rel.description ?? '',
        service,
        keywords: `relationship ${rel.type ?? ''}`.trim(),
        route: `/packages/${service}`,
      });
    }

    for (const c of pkg.cases ?? []) {
      records.push({
        id: `case:${c.uuid}`,
        kind: 'case',
        name: c.name,
        description: c.description ?? '',
        service,
        keywords: 'case',
        route: `/cases/${c.uuid}`,
      });
    }
  }

  for (const st of stereotypes) {
    records.push({
      id: `stereotype:${st.id}`,
      kind: 'stereotype',
      name: st.name,
      description: st.description ?? '',
      service: '',
      keywords: `stereotype ${st.domain ?? ''}`.trim(),
      route: '/stereotypes',
    });
  }

  return records;
}

const FUSE_OPTIONS: import('fuse.js').IFuseOptions<IndexRecord> = {
  includeScore: true,
  ignoreLocation: true, // match anywhere in the field, not just the start
  threshold: 0.4, // moderate fuzziness — tolerant of typos, not noisy
  minMatchCharLength: 1,
  keys: [
    { name: 'name', weight: 0.7 },
    { name: 'description', weight: 0.2 },
    { name: 'keywords', weight: 0.1 },
  ],
};

export function createSearchIndex(records: IndexRecord[]): Fuse<IndexRecord> {
  return new Fuse(records, FUSE_OPTIONS);
}

/**
 * Run a query and return up to `limit` records, blending Fuse's match score
 * with the per-kind tier so entities/attributes/packages lead. An empty query
 * yields nothing (the caller shows its own idle state).
 */
export function rankedSearch(
  fuse: Fuse<IndexRecord>,
  query: string,
  limit = 8,
): IndexRecord[] {
  const q = query.trim();
  if (!q) return [];

  return fuse
    .search(q)
    .map((r) => ({
      record: r.item,
      // Fuse score is 0 (perfect) → 1 (poor); add the tier penalty so a slightly
      // better-matching relationship can't bury an entity match.
      effective: (r.score ?? 1) + KIND_TIER[r.item.kind] * TIER_PENALTY,
    }))
    .sort((a, b) => a.effective - b.effective)
    .slice(0, limit)
    .map((r) => r.record);
}
