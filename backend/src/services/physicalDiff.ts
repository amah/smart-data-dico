/**
 * Physical model diff engine (#88).
 *
 * Compares the model's physical metadata layer against a parsed DB source
 * (from DDL or live introspection), producing a bidirectional gap analysis.
 *
 * Six gap types:
 *   - modelOnly:  attribute has no physical.columnName (design-ahead)
 *   - orphaned:   attribute has physical.columnName but column not in source
 *   - dbOnly:     source column has no matching model attribute
 *   - drifted:    both exist but type/nullable/dbType differ
 *   - matched:    both exist and agree
 *   - entityModelOnly / entityDbOnly: entity-level gaps
 */
import { Entity, Attribute, MetadataEntry, PhysicalConstraint } from '../models/EntitySchema.js';
import { physicalTableNameOf, physicalColumnNameOf } from './schemaDiff.js';

// ────────────────────────────────────────────────────────────────────────
// Result types
// ────────────────────────────────────────────────────────────────────────

export type PhysicalAttrStatus = 'matched' | 'modelOnly' | 'orphaned' | 'dbOnly' | 'drifted';
export type PhysicalEntityStatus = 'matched' | 'modelOnly' | 'dbOnly';

export interface PhysicalDiff {
  entities: PhysicalEntityDiff[];
  summary: PhysicalDiffSummary;
}

export interface PhysicalEntityDiff {
  status: PhysicalEntityStatus;
  entityName: string;
  entityUuid?: string;
  physicalTableName: string;
  attributes: PhysicalAttributeDiff[];
  constraints: PhysicalConstraintDiff[];
}

export interface PhysicalAttributeDiff {
  status: PhysicalAttrStatus;
  attributeName: string;
  attributeUuid?: string;
  physicalColumnName?: string;
  /** Fields that differ when status is 'drifted'. */
  driftFields?: string[];
  model?: Attribute;
  source?: Attribute;
}

export interface PhysicalConstraintDiff {
  status: 'matched' | 'added' | 'removed' | 'drifted';
  key: string;
  model?: PhysicalConstraint;
  source?: PhysicalConstraint;
}

export interface PhysicalDiffSummary {
  matched: number;
  modelOnly: number;
  orphaned: number;
  dbOnly: number;
  drifted: number;
  entities: { matched: number; modelOnly: number; dbOnly: number };
}

// ────────────────────────────────────────────────────────────────────────
// Helper: read metadata value
// ────────────────────────────────────────────────────────────────────────

function readMeta(metadata: MetadataEntry[] | undefined, name: string): string | number | boolean | undefined {
  const v = (metadata || []).find(m => m.name === name)?.value;
  // MetadataValue was widened to include arrays/objects (#164); physical.*
  // keys are always scalar, so we guard to preserve the narrow return type.
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v;
  return undefined;
}

// ────────────────────────────────────────────────────────────────────────
// Core diff function
// ────────────────────────────────────────────────────────────────────────

/**
 * Compare model entities (with physical metadata) against parsed source
 * entities (from DDL/introspection).
 *
 * @param model    Entities from the current model (with physical.* metadata)
 * @param source   Entities parsed from DDL or introspected from DB
 */
export function diffPhysicalModel(model: Entity[], source: Entity[]): PhysicalDiff {
  const entityDiffs: PhysicalEntityDiff[] = [];

  // Build lookup: physical table name → source entity
  const sourceByTable = new Map<string, Entity>();
  for (const e of source) {
    const t = physicalTableNameOf(e);
    if (t) sourceByTable.set(t.toLowerCase(), e);
  }

  // Build lookup: physical table name → model entity
  const modelByTable = new Map<string, Entity>();
  for (const e of model) {
    const t = physicalTableNameOf(e);
    if (t) modelByTable.set(t.toLowerCase(), e);
  }

  const matchedTables = new Set<string>();

  // Walk model entities
  for (const modelEntity of model) {
    const tableName = physicalTableNameOf(modelEntity);

    if (!tableName) {
      // Entity has no physical mapping — fully model-only entity
      entityDiffs.push({
        status: 'modelOnly',
        entityName: modelEntity.name,
        entityUuid: modelEntity.uuid,
        physicalTableName: '',
        attributes: modelEntity.attributes.map(a => ({
          status: 'modelOnly' as const,
          attributeName: a.name,
          attributeUuid: a.uuid,
          model: a,
        })),
        constraints: [],
      });
      continue;
    }

    const sourceEntity = sourceByTable.get(tableName.toLowerCase());
    if (!sourceEntity) {
      // Model entity maps to a table not in the source → all physical attrs are orphaned
      entityDiffs.push(diffEntityOrphaned(modelEntity, tableName));
      continue;
    }

    matchedTables.add(tableName.toLowerCase());
    // Both exist — diff attributes and constraints
    entityDiffs.push(diffEntityMatched(modelEntity, sourceEntity, tableName));
  }

  // Walk source entities not matched — dbOnly
  for (const sourceEntity of source) {
    const tableName = physicalTableNameOf(sourceEntity);
    if (!tableName) continue;
    if (matchedTables.has(tableName.toLowerCase())) continue;

    entityDiffs.push({
      status: 'dbOnly',
      entityName: sourceEntity.name,
      physicalTableName: tableName,
      attributes: sourceEntity.attributes.map(a => ({
        status: 'dbOnly' as const,
        attributeName: a.name,
        physicalColumnName: physicalColumnNameOf(a),
        source: a,
      })),
      constraints: (sourceEntity.constraints || []).map(c => ({
        status: 'added' as const,
        key: constraintKey(c),
        source: c,
      })),
    });
  }

  return {
    entities: entityDiffs,
    summary: buildSummary(entityDiffs),
  };
}

// ────────────────────────────────────────────────────────────────────────
// Entity-level diff helpers
// ────────────────────────────────────────────────────────────────────────

function diffEntityOrphaned(modelEntity: Entity, tableName: string): PhysicalEntityDiff {
  const attributes: PhysicalAttributeDiff[] = modelEntity.attributes.map(a => {
    const colName = physicalColumnNameOf(a);
    return {
      status: colName ? 'orphaned' as const : 'modelOnly' as const,
      attributeName: a.name,
      attributeUuid: a.uuid,
      physicalColumnName: colName,
      model: a,
    };
  });

  return {
    status: 'matched', // entity exists in model with physical mapping, just table missing
    entityName: modelEntity.name,
    entityUuid: modelEntity.uuid,
    physicalTableName: tableName,
    attributes,
    constraints: (modelEntity.constraints || []).map(c => ({
      status: 'removed' as const,
      key: constraintKey(c),
      model: c,
    })),
  };
}

function diffEntityMatched(modelEntity: Entity, sourceEntity: Entity, tableName: string): PhysicalEntityDiff {
  // Build source column lookup
  const sourceByCol = new Map<string, Attribute>();
  for (const a of sourceEntity.attributes) {
    const col = physicalColumnNameOf(a);
    if (col) sourceByCol.set(col.toLowerCase(), a);
  }

  const attributes: PhysicalAttributeDiff[] = [];
  const matchedCols = new Set<string>();

  // Walk model attributes
  for (const modelAttr of modelEntity.attributes) {
    const colName = physicalColumnNameOf(modelAttr);

    if (!colName) {
      // Model-only attribute (no physical mapping)
      attributes.push({
        status: 'modelOnly',
        attributeName: modelAttr.name,
        attributeUuid: modelAttr.uuid,
        model: modelAttr,
      });
      continue;
    }

    const sourceAttr = sourceByCol.get(colName.toLowerCase());
    if (!sourceAttr) {
      // Orphaned — model maps to column not in source
      attributes.push({
        status: 'orphaned',
        attributeName: modelAttr.name,
        attributeUuid: modelAttr.uuid,
        physicalColumnName: colName,
        model: modelAttr,
      });
      continue;
    }

    matchedCols.add(colName.toLowerCase());

    // Both exist — check for drift
    const driftFields = detectDrift(modelAttr, sourceAttr);
    attributes.push({
      status: driftFields.length > 0 ? 'drifted' : 'matched',
      attributeName: modelAttr.name,
      attributeUuid: modelAttr.uuid,
      physicalColumnName: colName,
      driftFields: driftFields.length > 0 ? driftFields : undefined,
      model: modelAttr,
      source: sourceAttr,
    });
  }

  // Source columns not matched — dbOnly
  for (const sourceAttr of sourceEntity.attributes) {
    const col = physicalColumnNameOf(sourceAttr);
    if (!col) continue;
    if (matchedCols.has(col.toLowerCase())) continue;
    attributes.push({
      status: 'dbOnly',
      attributeName: sourceAttr.name,
      physicalColumnName: col,
      source: sourceAttr,
    });
  }

  // Constraint diff
  const constraints = diffConstraints(modelEntity.constraints, sourceEntity.constraints);

  return {
    status: 'matched',
    entityName: modelEntity.name,
    entityUuid: modelEntity.uuid,
    physicalTableName: tableName,
    attributes,
    constraints,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Drift detection
// ────────────────────────────────────────────────────────────────────────

function detectDrift(model: Attribute, source: Attribute): string[] {
  const drifts: string[] = [];

  // Type drift
  if (model.type !== source.type) drifts.push('type');

  // Required / nullable drift
  if (model.required !== source.required) drifts.push('required');

  // dbType drift
  const modelDbType = readMeta(model.metadata, 'physical.dbType');
  const sourceDbType = readMeta(source.metadata, 'physical.dbType');
  if (modelDbType && sourceDbType && String(modelDbType).toLowerCase() !== String(sourceDbType).toLowerCase()) {
    drifts.push('physical.dbType');
  }

  // Nullable drift
  const modelNullable = readMeta(model.metadata, 'physical.nullable');
  const sourceNullable = readMeta(source.metadata, 'physical.nullable');
  if (modelNullable !== undefined && sourceNullable !== undefined && modelNullable !== sourceNullable) {
    drifts.push('physical.nullable');
  }

  // PrimaryKey drift
  if (!!model.primaryKey !== !!source.primaryKey) drifts.push('primaryKey');

  return drifts;
}

// ────────────────────────────────────────────────────────────────────────
// Constraint diff
// ────────────────────────────────────────────────────────────────────────

function constraintKey(c: PhysicalConstraint): string {
  if (c.name) return `name:${c.name}`;
  const cols = (c.columns || []).join(',');
  const ref = c.references ? `${c.references.table}(${(c.references.columns || []).join(',')})` : '';
  const expr = (c.expression || '').replace(/\s+/g, ' ').trim();
  return `${c.kind}|${cols}|${expr}|${ref}`;
}

function diffConstraints(
  model: PhysicalConstraint[] | undefined,
  source: PhysicalConstraint[] | undefined,
): PhysicalConstraintDiff[] {
  const modelList = model || [];
  const sourceList = source || [];
  if (modelList.length === 0 && sourceList.length === 0) return [];

  const diffs: PhysicalConstraintDiff[] = [];
  const modelByKey = new Map(modelList.map(c => [constraintKey(c), c]));
  const sourceByKey = new Map(sourceList.map(c => [constraintKey(c), c]));
  const matched = new Set<string>();

  for (const [key, s] of sourceByKey) {
    const m = modelByKey.get(key);
    if (!m) {
      diffs.push({ status: 'added', key, source: s });
      continue;
    }
    matched.add(key);
    diffs.push({ status: 'matched', key, model: m, source: s });
  }

  for (const [key, m] of modelByKey) {
    if (matched.has(key)) continue;
    diffs.push({ status: 'removed', key, model: m });
  }

  return diffs;
}

// ────────────────────────────────────────────────────────────────────────
// Summary
// ────────────────────────────────────────────────────────────────────────

function buildSummary(entities: PhysicalEntityDiff[]): PhysicalDiffSummary {
  const summary: PhysicalDiffSummary = {
    matched: 0,
    modelOnly: 0,
    orphaned: 0,
    dbOnly: 0,
    drifted: 0,
    entities: { matched: 0, modelOnly: 0, dbOnly: 0 },
  };

  for (const e of entities) {
    summary.entities[e.status]++;
    for (const a of e.attributes) {
      summary[a.status]++;
    }
  }

  return summary;
}
