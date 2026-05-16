/**
 * Schema diff + merge for the import wizard (#69 C2).
 *
 * Pure functions — no side effects, no I/O. Given a parsed source schema
 * and the existing entities in a target service, produces a structured
 * diff and a merged result that respects three invariants:
 *
 *   1. **Lookup is by physical metadata, not display name.**
 *      Entities matched via `physical.tableName`. Attributes matched via
 *      `physical.columnName`. The user may have renamed the model — the
 *      physical mapping is the stable identity.
 *
 *   2. **Never overwrite user content.**
 *      A non-empty `description` or any non-physical metadata entry on
 *      the existing model attribute is preserved verbatim through the
 *      merge. Only `physical.*` fields, `type`, `required`, and
 *      `primaryKey` flow from the source.
 *
 *   3. **Model-only attributes are sacred.**
 *      An attribute without `physical.columnName` metadata is
 *      "model-only" — design-ahead intent before physical implementation.
 *      The merge never touches it. The diff surfaces it informationally
 *      so users know it exists, but never proposes to delete or change it.
 */
import { Entity, Attribute, MetadataEntry, PhysicalConstraint, Relationship } from '../models/EntitySchema.js';

// ────────────────────────────────────────────────────────────────────────
// Diff result types
// ────────────────────────────────────────────────────────────────────────

/** Status of an entity (table) in the diff. */
export type EntityDiffStatus =
  /** New table in source — no matching `physical.tableName` in model */
  | 'added'
  /** Same table in both, with at least one attribute change */
  | 'changed'
  /** Same table in both, no attribute changes */
  | 'unchanged'
  /** Model has the table; source no longer does (physical match by tableName) */
  | 'removedInSource';

/** Status of an attribute (column) in the diff. */
export type AttributeDiffStatus =
  /** New column in source — no matching `physical.columnName` in model */
  | 'added'
  /** Same column in both — physical metadata or type/required differs */
  | 'changed'
  /** Same column in both — no diff */
  | 'unchanged'
  /** Model has the column with `physical.columnName`; source doesn't */
  | 'removedInSource'
  /** Model attribute has no `physical.columnName` — design-ahead, never touched */
  | 'modelOnly';

/** Per-attribute diff entry. */
export interface AttributeDiff {
  status: AttributeDiffStatus;
  /** The display name as it would appear in the model after the merge. */
  name: string;
  /** The source attribute (parsed from DDL/DB) — present unless status is 'removedInSource' or 'modelOnly'. */
  source?: Attribute;
  /** The existing model attribute — present unless status is 'added'. */
  existing?: Attribute;
  /**
   * For 'changed' status: list of fields that differ.
   * Examples: ['type'], ['required'], ['physical.dbType', 'physical.nullable']
   */
  changedFields?: string[];
}

/** Per-physical-constraint diff entry (#85 R3). */
export interface ConstraintDiff {
  status: 'added' | 'changed' | 'unchanged' | 'removedInSource';
  /** Stable identity of the constraint — its `name` if known, else a structural key. */
  key: string;
  source?: PhysicalConstraint;
  existing?: PhysicalConstraint;
}

/** Per-entity diff entry. */
export interface EntityDiff {
  status: EntityDiffStatus;
  /** Display name as it would appear in the model after the merge. */
  name: string;
  /** Physical table name — the stable identity used for matching. */
  physicalTableName?: string;
  /** The source entity (parsed) — present unless status is 'removedInSource'. */
  source?: Entity;
  /** The existing model entity — present unless status is 'added'. */
  existing?: Entity;
  /** All attribute-level diffs for this entity. */
  attributes: AttributeDiff[];
  /** Physical constraint diffs for this entity (#85 R3). Empty if neither side declared any. */
  constraints?: ConstraintDiff[];
  /** Quick counts for the wizard summary, computed from `attributes`. */
  counts: {
    added: number;
    changed: number;
    unchanged: number;
    removedInSource: number;
    modelOnly: number;
  };
}

// ────────────────────────────────────────────────────────────────────────
// Helpers — physical metadata extraction
// ────────────────────────────────────────────────────────────────────────

const PHYSICAL_PREFIX = 'physical.';

/** Read a metadata entry value by name. */
function readMeta(metadata: MetadataEntry[] | undefined, name: string): string | number | boolean | undefined {
  if (!metadata) return undefined;
  const v = metadata.find(m => m.name === name)?.value;
  // MetadataValue was widened to include arrays/objects (#164); physical.*
  // keys are always scalar, so we guard to preserve the narrow return type.
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v;
  return undefined;
}

/** Read the physical table name from an entity (the stable identity). */
export function physicalTableNameOf(entity: Entity): string | undefined {
  const v = readMeta(entity.metadata, 'physical.tableName');
  return typeof v === 'string' ? v : undefined;
}

/** Read the physical column name from an attribute. Returns undefined for model-only attrs. */
export function physicalColumnNameOf(attr: Attribute): string | undefined {
  const v = readMeta(attr.metadata, 'physical.columnName');
  return typeof v === 'string' ? v : undefined;
}

/** True if this is a model-only attribute (no physical mapping). */
export function isModelOnly(attr: Attribute): boolean {
  return physicalColumnNameOf(attr) === undefined;
}

/**
 * Build a snapshot of an attribute's physical fields for shallow comparison.
 * Used to detect 'changed' status by comparing source vs existing.
 */
interface PhysicalSnapshot {
  type: string;
  required: boolean;
  primaryKey: boolean;
  dbType?: string | number | boolean;
  nullable?: string | number | boolean;
}

function snapshotPhysical(attr: Attribute): PhysicalSnapshot {
  return {
    type: attr.type,
    required: !!attr.required,
    primaryKey: !!attr.primaryKey,
    dbType: readMeta(attr.metadata, 'physical.dbType'),
    nullable: readMeta(attr.metadata, 'physical.nullable'),
  };
}

/** Diff two attribute physical snapshots. Returns the list of changed field names. */
function diffSnapshots(source: PhysicalSnapshot, existing: PhysicalSnapshot): string[] {
  const changed: string[] = [];
  if (source.type !== existing.type) changed.push('type');
  if (source.required !== existing.required) changed.push('required');
  if (source.primaryKey !== existing.primaryKey) changed.push('primaryKey');
  if (source.dbType !== existing.dbType) changed.push('physical.dbType');
  if (source.nullable !== existing.nullable) changed.push('physical.nullable');
  return changed;
}

/**
 * Stable identity key for a PhysicalConstraint (#85 R3).
 *
 * Uses the optional `name` (DB constraint name) when present, since that's
 * the only field guaranteed stable across re-imports if the user later
 * renames a column or expression. Falls back to a structural key built
 * from kind + columns + expression + references for unnamed constraints.
 */
function constraintKey(c: PhysicalConstraint): string {
  if (c.name) return `name:${c.name}`;
  const cols = (c.columns || []).join(',');
  const ref = c.references ? `${c.references.table}(${(c.references.columns || []).join(',')})` : '';
  const expr = (c.expression || '').replace(/\s+/g, ' ').trim();
  return `${c.kind}|${cols}|${expr}|${ref}`;
}

/**
 * True when two PhysicalConstraints describe the same logical constraint
 * (same kind, same columns, same expression / referenced table+cols).
 * Used to detect 'unchanged' constraints when both sides share a name.
 */
function constraintsStructurallyEqual(a: PhysicalConstraint, b: PhysicalConstraint): boolean {
  if (a.kind !== b.kind) return false;
  const aCols = (a.columns || []).join(',');
  const bCols = (b.columns || []).join(',');
  if (aCols !== bCols) return false;
  if ((a.expression || '').replace(/\s+/g, ' ').trim() !== (b.expression || '').replace(/\s+/g, ' ').trim()) return false;
  const aRef = a.references ? `${a.references.table}(${(a.references.columns || []).join(',')})` : '';
  const bRef = b.references ? `${b.references.table}(${(b.references.columns || []).join(',')})` : '';
  if (aRef !== bRef) return false;
  return true;
}

/**
 * Diff two physical-constraint arrays (#85 R3).
 *
 * Matches entries by `name` first, then falls back to a structural key
 * (kind + columns + expression + references). Anonymous constraints with
 * different shapes show up as one removed + one added rather than as a
 * single 'changed' entry — that's the right semantics because there's no
 * way to know they're "the same" constraint without an identity hint.
 *
 * Returns an empty array if neither side declared any constraints.
 */
export function diffPhysicalConstraints(
  source: PhysicalConstraint[] | undefined,
  existing: PhysicalConstraint[] | undefined,
): ConstraintDiff[] {
  const out: ConstraintDiff[] = [];
  const sourceList = source || [];
  const existingList = existing || [];
  if (sourceList.length === 0 && existingList.length === 0) return out;

  const existingByKey = new Map<string, PhysicalConstraint>();
  for (const c of existingList) existingByKey.set(constraintKey(c), c);
  const matched = new Set<string>();

  for (const s of sourceList) {
    const k = constraintKey(s);
    const match = existingByKey.get(k);
    if (!match) {
      // Try a name-based fallback: same name but different shape → 'changed'
      let renamedMatch: PhysicalConstraint | undefined;
      let renamedKey: string | undefined;
      if (s.name) {
        for (const [key, c] of existingByKey) {
          if (matched.has(key)) continue;
          if (c.name === s.name) {
            renamedMatch = c;
            renamedKey = key;
            break;
          }
        }
      }
      if (renamedMatch) {
        matched.add(renamedKey!);
        out.push({ status: 'changed', key: k, source: s, existing: renamedMatch });
      } else {
        out.push({ status: 'added', key: k, source: s });
      }
      continue;
    }
    matched.add(k);
    if (constraintsStructurallyEqual(s, match)) {
      out.push({ status: 'unchanged', key: k, source: s, existing: match });
    } else {
      out.push({ status: 'changed', key: k, source: s, existing: match });
    }
  }

  for (const [k, c] of existingByKey) {
    if (matched.has(k)) continue;
    out.push({ status: 'removedInSource', key: k, existing: c });
  }

  return out;
}

/**
 * Compare entity-level `physical.*` metadata between source and existing.
 * Returns the list of physical metadata names that differ.
 *
 * Entity-level physical metadata changes (e.g. `physical.schema` added or
 * changed) must trigger a 'changed' status even when no attribute changed,
 * so the merge can refresh those entries on disk.
 */
function diffEntityPhysicalMetadata(source: Entity, existing: Entity): string[] {
  const changed: string[] = [];
  const sourcePhys = new Map<string, string | number | boolean>();
  const existingPhys = new Map<string, string | number | boolean>();
  for (const m of source.metadata || []) {
    // MetadataValue widened (#164); physical.* keys are always scalar
    if (m.name.startsWith(PHYSICAL_PREFIX) && (typeof m.value === 'string' || typeof m.value === 'number' || typeof m.value === 'boolean')) {
      sourcePhys.set(m.name, m.value);
    }
  }
  for (const m of existing.metadata || []) {
    if (m.name.startsWith(PHYSICAL_PREFIX) && (typeof m.value === 'string' || typeof m.value === 'number' || typeof m.value === 'boolean')) {
      existingPhys.set(m.name, m.value);
    }
  }
  for (const [name, value] of sourcePhys) {
    if (existingPhys.get(name) !== value) changed.push(name);
  }
  for (const name of existingPhys.keys()) {
    if (!sourcePhys.has(name)) changed.push(name);
  }
  return changed;
}

// ────────────────────────────────────────────────────────────────────────
// diffEntities
// ────────────────────────────────────────────────────────────────────────

/**
 * Compute the structured diff between a parsed source schema and the
 * existing entities in a target service.
 */
export function diffEntities(parsed: Entity[], existing: Entity[]): EntityDiff[] {
  const diffs: EntityDiff[] = [];

  // Build a lookup of existing entities by physical.tableName (stable identity).
  // Entities without physical.tableName are excluded from the source-driven diff
  // — they're pure model-only entities and the import has nothing to say about them.
  const existingByTable = new Map<string, Entity>();
  for (const e of existing) {
    const t = physicalTableNameOf(e);
    if (t) existingByTable.set(t, e);
  }

  const matchedExistingTables = new Set<string>();

  // Walk parsed entities — each is either 'added' or matches an existing entity.
  for (const source of parsed) {
    const tableName = physicalTableNameOf(source);
    const match = tableName ? existingByTable.get(tableName) : undefined;

    if (!match) {
      // New table in source — every attribute is 'added'
      const attrs: AttributeDiff[] = source.attributes.map(a => ({
        status: 'added' as const,
        name: a.name,
        source: a,
      }));
      diffs.push({
        status: 'added',
        name: source.name,
        physicalTableName: tableName,
        source,
        attributes: attrs,
        counts: countAttrDiffs(attrs),
      });
      continue;
    }

    matchedExistingTables.add(tableName!);

    // Diff attributes within the matched table
    const attrDiffs = diffAttributes(source.attributes, match.attributes);
    const counts = countAttrDiffs(attrDiffs);
    // Entity-level physical metadata differences (e.g. physical.schema)
    // also count as changes — the merge needs to refresh them on disk.
    const entityMetaChanged = diffEntityPhysicalMetadata(source, match).length > 0;
    // Physical constraint diffs (#85 R3) — added/changed/removed counts
    // toward the entity's `changed` status; pure 'unchanged' constraint
    // lists do not.
    const constraintDiffs = diffPhysicalConstraints(source.constraints, match.constraints);
    const constraintHasChanges = constraintDiffs.some(c => c.status !== 'unchanged');
    const hasChanges =
      counts.added + counts.changed + counts.removedInSource > 0 ||
      entityMetaChanged ||
      constraintHasChanges;

    diffs.push({
      status: hasChanges ? 'changed' : 'unchanged',
      // Existing display name wins (the user may have renamed the model)
      name: match.name,
      physicalTableName: tableName,
      source,
      existing: match,
      attributes: attrDiffs,
      ...(constraintDiffs.length > 0 ? { constraints: constraintDiffs } : {}),
      counts,
    });
  }

  // Entities that exist in the model but were NOT seen in the source are
  // 'removedInSource' — but only if they have a physical.tableName (i.e. they
  // were imported at some point). Pure model-only entities are not affected.
  for (const e of existing) {
    const t = physicalTableNameOf(e);
    if (!t) continue;
    if (matchedExistingTables.has(t)) continue;
    // Model-only attributes within a removed-in-source entity are still
    // listed for clarity but never proposed for deletion.
    const attrs: AttributeDiff[] = e.attributes.map(a => ({
      status: isModelOnly(a) ? ('modelOnly' as const) : ('removedInSource' as const),
      name: a.name,
      existing: a,
    }));
    diffs.push({
      status: 'removedInSource',
      name: e.name,
      physicalTableName: t,
      existing: e,
      attributes: attrs,
      counts: countAttrDiffs(attrs),
    });
  }

  return diffs;
}

/** Diff a parsed source attribute list against an existing model attribute list. */
function diffAttributes(source: Attribute[], existing: Attribute[]): AttributeDiff[] {
  const diffs: AttributeDiff[] = [];

  // Build lookup of existing model attrs by physical.columnName.
  // Attributes WITHOUT physical.columnName are model-only — handled separately.
  const existingByCol = new Map<string, Attribute>();
  const modelOnlyAttrs: Attribute[] = [];
  for (const a of existing) {
    const c = physicalColumnNameOf(a);
    if (c) existingByCol.set(c, a);
    else modelOnlyAttrs.push(a);
  }

  const matchedColumnNames = new Set<string>();

  // Walk source attributes — added or changed/unchanged
  for (const sa of source) {
    const colName = physicalColumnNameOf(sa);
    const match = colName ? existingByCol.get(colName) : undefined;

    if (!match) {
      diffs.push({ status: 'added', name: sa.name, source: sa });
      continue;
    }

    matchedColumnNames.add(colName!);
    const changedFields = diffSnapshots(snapshotPhysical(sa), snapshotPhysical(match));
    // A description fill (existing empty, source has one) is also a change
    // — the merge will fill the existing description from the source.
    if (!match.description && sa.description) {
      changedFields.push('description');
    }
    if (changedFields.length === 0) {
      diffs.push({
        status: 'unchanged',
        name: match.name,
        source: sa,
        existing: match,
      });
    } else {
      diffs.push({
        status: 'changed',
        name: match.name,
        source: sa,
        existing: match,
        changedFields,
      });
    }
  }

  // Existing physical attributes NOT in the source → removedInSource
  for (const [col, attr] of existingByCol) {
    if (matchedColumnNames.has(col)) continue;
    diffs.push({
      status: 'removedInSource',
      name: attr.name,
      existing: attr,
    });
  }

  // Model-only attributes — informational, never touched
  for (const attr of modelOnlyAttrs) {
    diffs.push({
      status: 'modelOnly',
      name: attr.name,
      existing: attr,
    });
  }

  return diffs;
}

function countAttrDiffs(attrs: AttributeDiff[]): EntityDiff['counts'] {
  const counts = { added: 0, changed: 0, unchanged: 0, removedInSource: 0, modelOnly: 0 };
  for (const a of attrs) counts[a.status]++;
  return counts;
}

// ────────────────────────────────────────────────────────────────────────
// mergeEntities
// ────────────────────────────────────────────────────────────────────────

/**
 * Merge a parsed source schema into the existing entities. Produces the list
 * of entities to write back to disk after the import is committed.
 *
 * - 'added' entities pass through verbatim
 * - 'changed' entities yield a merged entity that:
 *     * keeps the existing display name and uuid
 *     * keeps the existing description (never overwritten unless empty)
 *     * keeps the existing entity-level metadata, with only the
 *       `physical.*` entries refreshed from the source
 *     * for each attribute:
 *         - 'added' → appended verbatim from source
 *         - 'changed' → existing attr with `type`/`required`/`primaryKey`
 *           updated and `physical.*` metadata refreshed; description and
 *           non-physical metadata preserved
 *         - 'unchanged' → existing attr untouched
 *         - 'removedInSource' → preserved (model-first)
 *         - 'modelOnly' → preserved (never touched)
 * - 'removedInSource' entities yield the existing entity unchanged
 * - 'unchanged' entities yield the existing entity unchanged
 *
 * The merger does NOT write to disk — it returns the list of entities the
 * caller should pass to `commitParsedEntities` (or equivalent) for persistence.
 */
export function mergeEntities(parsed: Entity[], existing: Entity[]): Entity[] {
  const diffs = diffEntities(parsed, existing);
  const merged: Entity[] = [];

  for (const diff of diffs) {
    if (diff.status === 'added') {
      // Pass-through with timestamps refreshed
      merged.push({
        ...diff.source!,
        createdAt: diff.source!.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      continue;
    }

    if (diff.status === 'removedInSource' || diff.status === 'unchanged') {
      // Pass-through, no edit
      merged.push(diff.existing!);
      continue;
    }

    // 'changed' — merge attributes
    const sourceEntity = diff.source!;
    const existingEntity = diff.existing!;
    const mergedAttrs: Attribute[] = [];

    for (const ad of diff.attributes) {
      switch (ad.status) {
        case 'added':
          mergedAttrs.push(ad.source!);
          break;
        case 'unchanged':
          mergedAttrs.push(ad.existing!);
          break;
        case 'changed':
          mergedAttrs.push(mergeAttribute(ad.source!, ad.existing!));
          break;
        case 'removedInSource':
        case 'modelOnly':
          mergedAttrs.push(ad.existing!);
          break;
      }
    }

    merged.push({
      ...existingEntity,
      attributes: mergedAttrs,
      // Refresh entity-level physical.* metadata; preserve everything else
      metadata: mergeMetadata(existingEntity.metadata, sourceEntity.metadata),
      // Physical constraints (#85 R3): the source is authoritative. The DB
      // is the system of record for constraints, so a re-import always
      // replaces the existing list with the source's. Users who want to
      // attach extra invariants on top should use a Rule instead.
      constraints: sourceEntity.constraints,
      // Refresh description ONLY if existing was empty
      description: existingEntity.description || sourceEntity.description,
      updatedAt: new Date().toISOString(),
    });
  }

  return merged;
}

/**
 * Merge an existing model attribute with a parsed source attribute.
 *
 * Updates: type, required, primaryKey, physical.* metadata fields
 * Preserves: uuid, name, description (if non-empty), unique, defaultValue,
 *            examples, validation (#85), items, properties, non-physical metadata
 */
function mergeAttribute(source: Attribute, existing: Attribute): Attribute {
  return {
    ...existing,
    // Type and required flow from the source
    type: source.type,
    required: source.required,
    primaryKey: source.primaryKey ?? existing.primaryKey,
    // Description: keep existing if non-empty; otherwise take source
    description: existing.description || source.description,
    // Metadata: refresh physical.* entries, keep all others
    metadata: mergeMetadata(existing.metadata, source.metadata),
  };
}

/**
 * Merge a metadata array: refresh `physical.*` entries from source,
 * preserve everything else from existing. Non-physical entries on source
 * (e.g. user metadata that came back from a previous import) are dropped
 * — the source is authoritative only for physical fields.
 */
function mergeMetadata(
  existing: MetadataEntry[] | undefined,
  source: MetadataEntry[] | undefined,
): MetadataEntry[] {
  const result: MetadataEntry[] = [];
  // Keep all non-physical entries from existing
  for (const entry of existing || []) {
    if (!entry.name.startsWith(PHYSICAL_PREFIX)) {
      result.push(entry);
    }
  }
  // Append physical entries from source
  for (const entry of source || []) {
    if (entry.name.startsWith(PHYSICAL_PREFIX)) {
      result.push(entry);
    }
  }
  return result;
}

// ────────────────────────────────────────────────────────────────────────
// Relationship diff + merge (#82)
// ────────────────────────────────────────────────────────────────────────

/** Status of a relationship in the diff. */
export type RelationshipDiffStatus =
  | 'added'
  | 'changed'
  | 'unchanged'
  | 'removedInSource';

/** Per-relationship diff entry. */
export interface RelationshipDiff {
  status: RelationshipDiffStatus;
  key: string;
  source?: Relationship;
  existing?: Relationship;
}

/**
 * Stable identity key for an imported relationship (#82).
 *
 * Uses `physical.constraintName` metadata when present (named FK constraints).
 * Falls back to source-entity UUID + target-entity UUID + referenceAttributes
 * as a structural key for unnamed FKs.
 */
function relationshipKey(rel: Relationship): string {
  const constraintName = (rel.metadata || []).find(m => m.name === 'physical.constraintName')?.value;
  if (constraintName) return `fk:${constraintName}`;
  const refAttrs = (rel.source.referenceAttributes || []).join(',');
  return `${rel.source.entity}→${rel.target.entity}|${refAttrs}`;
}

/**
 * True when two relationships describe the same FK
 * (same source/target entities, same referenceAttributes, same cardinality).
 */
function relationshipsStructurallyEqual(a: Relationship, b: Relationship): boolean {
  if (a.source.entity !== b.source.entity) return false;
  if (a.target.entity !== b.target.entity) return false;
  if (a.source.cardinality !== b.source.cardinality) return false;
  if (a.target.cardinality !== b.target.cardinality) return false;
  const aRef = (a.source.referenceAttributes || []).join(',');
  const bRef = (b.source.referenceAttributes || []).join(',');
  return aRef === bRef;
}

/**
 * Diff parsed relationships against existing relationships in a package.
 *
 * Matching priority:
 *   1. `physical.constraintName` metadata (named FKs)
 *   2. Structural key (source→target + referenceAttributes)
 *
 * Relationships without `physical.constraintName` (manually created by
 * the user) are never matched and thus never shown as 'removedInSource'.
 */
export function diffRelationships(
  source: Relationship[],
  existing: Relationship[],
): RelationshipDiff[] {
  const out: RelationshipDiff[] = [];
  const sourceList = source || [];
  const existingList = existing || [];

  // Only match existing relationships that have physical.constraintName
  // (i.e. were previously imported). User-created relationships are untouched.
  const existingByKey = new Map<string, Relationship>();
  for (const r of existingList) {
    const cn = (r.metadata || []).find(m => m.name === 'physical.constraintName')?.value;
    if (cn) {
      existingByKey.set(`fk:${cn}`, r);
    }
  }

  const matched = new Set<string>();

  for (const s of sourceList) {
    const k = relationshipKey(s);
    const match = existingByKey.get(k);

    if (!match) {
      out.push({ status: 'added', key: k, source: s });
      continue;
    }

    matched.add(k);
    // Remap source entity UUIDs to existing entity UUIDs for comparison
    // (source entities have freshly generated UUIDs)
    if (relationshipsStructurallyEqual(
      { ...s, source: { ...s.source, entity: match.source.entity }, target: { ...s.target, entity: match.target.entity } },
      match,
    )) {
      out.push({ status: 'unchanged', key: k, source: s, existing: match });
    } else {
      out.push({ status: 'changed', key: k, source: s, existing: match });
    }
  }

  // Previously imported relationships not in source → removedInSource
  for (const [k, r] of existingByKey) {
    if (matched.has(k)) continue;
    out.push({ status: 'removedInSource', key: k, existing: r });
  }

  return out;
}

/**
 * Merge parsed relationships into existing ones.
 *
 * - 'added' → appended from source
 * - 'changed' → existing UUID + user description preserved, physical metadata refreshed
 * - 'unchanged' → pass through existing
 * - 'removedInSource' → preserved (model-first)
 * - User-created relationships (no physical.constraintName) → preserved untouched
 *
 * The `entityUuidMap` maps source entity UUIDs → existing entity UUIDs so
 * the relationship ends point to the right entities after the merge.
 */
export function mergeRelationships(
  source: Relationship[],
  existing: Relationship[],
  entityUuidMap: Map<string, string>,
): Relationship[] {
  const diffs = diffRelationships(source, existing);
  const merged: Relationship[] = [];

  // First, add all user-created relationships (no physical.constraintName)
  for (const r of existing) {
    const cn = (r.metadata || []).find(m => m.name === 'physical.constraintName')?.value;
    if (!cn) merged.push(r);
  }

  for (const d of diffs) {
    if (d.status === 'added') {
      // Remap entity UUIDs from source to target
      const rel = d.source!;
      merged.push({
        ...rel,
        source: {
          ...rel.source,
          entity: entityUuidMap.get(rel.source.entity) || rel.source.entity,
        },
        target: {
          ...rel.target,
          entity: entityUuidMap.get(rel.target.entity) || rel.target.entity,
        },
      });
    } else if (d.status === 'changed') {
      const rel = d.source!;
      const ex = d.existing!;
      merged.push({
        ...ex,
        // Preserve user-edited description
        description: ex.description || rel.description,
        source: {
          ...rel.source,
          entity: ex.source.entity,
        },
        target: {
          ...rel.target,
          entity: ex.target.entity,
        },
        // Refresh physical metadata
        metadata: mergeMetadata(ex.metadata, rel.metadata),
      });
    } else {
      // unchanged or removedInSource → keep existing
      merged.push(d.existing!);
    }
  }

  return merged;
}
