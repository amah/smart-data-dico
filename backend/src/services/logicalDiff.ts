/**
 * Logical model diff engine (#86).
 *
 * Pure functions that compare two model graphs at every level:
 *   package → entity → attribute → relationship → constraint → rule
 *
 * Identity keys:
 *   - Entity/Attribute/Rule/Case: UUID
 *   - Relationship: UUID (user-created) or physical.constraintName (imported FK)
 *   - Constraint: name (if present) or structural key
 *
 * Supports move detection: an entity with the same UUID appearing in
 * different packages is reported as 'moved', not 'removed + added'.
 */
import { Entity, Attribute, Relationship, PhysicalConstraint, MetadataEntry } from '../models/EntitySchema.js';
import { Rule } from '../models/Rule.js';

// ────────────────────────────────────────────────────────────────────────
// Public result types
// ────────────────────────────────────────────────────────────────────────

export type DiffStatus = 'added' | 'changed' | 'removed' | 'unchanged';
export type EntityDiffStatus = DiffStatus | 'moved';

export interface LogicalDiff {
  packages: PackageDiff[];
  summary: LogicalDiffSummary;
}

export interface PackageDiff {
  status: DiffStatus;
  packageName: string;
  entities: EntityLogicalDiff[];
  relationships: RelationshipLogicalDiff[];
  rules: RuleLogicalDiff[];
  counts: PackageDiffCounts;
}

export interface PackageDiffCounts {
  entities: { added: number; changed: number; removed: number; moved: number; unchanged: number };
  relationships: { added: number; changed: number; removed: number; unchanged: number };
  rules: { added: number; changed: number; removed: number; unchanged: number };
}

export interface EntityLogicalDiff {
  status: EntityDiffStatus;
  entityUuid: string;
  entityName: string;
  /** Package it moved from (only when status === 'moved'). */
  movedFrom?: string;
  left?: Entity;
  right?: Entity;
  attributes: AttributeLogicalDiff[];
  constraints: ConstraintLogicalDiff[];
  /** Entity-level fields that differ (name, description, stereotype, status). */
  changedFields?: string[];
}

export interface AttributeLogicalDiff {
  status: DiffStatus;
  attributeUuid: string;
  attributeName: string;
  left?: Attribute;
  right?: Attribute;
  changedFields?: string[];
}

export interface RelationshipLogicalDiff {
  status: DiffStatus;
  relationshipUuid: string;
  left?: Relationship;
  right?: Relationship;
  changedFields?: string[];
}

export interface ConstraintLogicalDiff {
  status: DiffStatus;
  key: string;
  left?: PhysicalConstraint;
  right?: PhysicalConstraint;
}

export interface RuleLogicalDiff {
  status: DiffStatus;
  ruleUuid: string;
  ruleName: string;
  left?: Rule;
  right?: Rule;
  changedFields?: string[];
}

export interface LogicalDiffSummary {
  packages: { added: number; changed: number; removed: number; unchanged: number };
  entities: { added: number; changed: number; removed: number; moved: number; unchanged: number };
  attributes: { added: number; changed: number; removed: number; unchanged: number };
  relationships: { added: number; changed: number; removed: number; unchanged: number };
  rules: { added: number; changed: number; removed: number; unchanged: number };
}

// ────────────────────────────────────────────────────────────────────────
// Model snapshot — the input to the diff engine
// ────────────────────────────────────────────────────────────────────────

/** A single package's data, as loaded from disk or a git ref. */
export interface PackageSnapshot {
  packageName: string;
  /**
   * Service (root package) this snapshot belongs to. Populated by the loader
   * so a ModelSnapshot that spans multiple services can disambiguate otherwise
   * identically-named sub-packages and group diffs by service downstream.
   * Optional for backwards compatibility with callers that build snapshots
   * from memory without a hosting service.
   */
  service?: string;
  entities: Entity[];
  relationships: Relationship[];
  rules: Rule[];
}

/** A complete model snapshot — one or more packages. */
export interface ModelSnapshot {
  packages: PackageSnapshot[];
}

// ────────────────────────────────────────────────────────────────────────
// Core diff function
// ────────────────────────────────────────────────────────────────────────

/**
 * Compare two model snapshots and produce a structured diff.
 *
 * @param left  The "before" state (e.g., previous version, base branch)
 * @param right The "after" state (e.g., current version, feature branch)
 */
export function diffModels(left: ModelSnapshot, right: ModelSnapshot): LogicalDiff {
  const leftByName = new Map(left.packages.map(p => [p.packageName, p]));
  const rightByName = new Map(right.packages.map(p => [p.packageName, p]));

  // Build global entity→package maps for move detection
  const leftEntityPkg = new Map<string, string>(); // entity UUID → package name
  const rightEntityPkg = new Map<string, string>();
  const leftEntityByUuid = new Map<string, Entity>();
  for (const pkg of left.packages) {
    for (const e of pkg.entities) {
      leftEntityPkg.set(e.uuid, pkg.packageName);
      leftEntityByUuid.set(e.uuid, e);
    }
  }
  for (const pkg of right.packages) {
    for (const e of pkg.entities) rightEntityPkg.set(e.uuid, pkg.packageName);
  }

  // Detect moved entities: same UUID, different package
  const movedEntities = new Map<string, { from: string; to: string; left: Entity }>();
  for (const [uuid, rightPkg] of rightEntityPkg) {
    const leftPkg = leftEntityPkg.get(uuid);
    if (leftPkg && leftPkg !== rightPkg) {
      const leftEntity = leftEntityByUuid.get(uuid);
      if (leftEntity) movedEntities.set(uuid, { from: leftPkg, to: rightPkg, left: leftEntity });
    }
  }

  const allPackageNames = new Set([...leftByName.keys(), ...rightByName.keys()]);
  const packageDiffs: PackageDiff[] = [];

  for (const pkgName of allPackageNames) {
    const leftPkg = leftByName.get(pkgName);
    const rightPkg = rightByName.get(pkgName);

    if (!leftPkg && rightPkg) {
      // Added package
      const entities = rightPkg.entities.map(e => diffEntityAdded(e));
      const relationships = rightPkg.relationships.map(r => diffRelAdded(r));
      const rules = rightPkg.rules.map(r => diffRuleAdded(r));
      packageDiffs.push({
        status: 'added',
        packageName: pkgName,
        entities,
        relationships,
        rules,
        counts: buildPackageCounts(entities, relationships, rules),
      });
      continue;
    }

    if (leftPkg && !rightPkg) {
      // Removed package — but exclude entities that moved to another package
      const entities = leftPkg.entities
        .filter(e => !movedEntities.has(e.uuid))
        .map(e => diffEntityRemoved(e));
      const relationships = leftPkg.relationships.map(r => diffRelRemoved(r));
      const rules = leftPkg.rules.map(r => diffRuleRemoved(r));
      packageDiffs.push({
        status: 'removed',
        packageName: pkgName,
        entities,
        relationships,
        rules,
        counts: buildPackageCounts(entities, relationships, rules),
      });
      continue;
    }

    // Both exist — diff contents
    const entities = diffEntityLists(
      leftPkg!.entities, rightPkg!.entities, movedEntities, pkgName,
    );
    const relationships = diffRelationshipLists(leftPkg!.relationships, rightPkg!.relationships);
    const rules = diffRuleLists(leftPkg!.rules, rightPkg!.rules);
    const counts = buildPackageCounts(entities, relationships, rules);

    const hasChanges =
      counts.entities.added + counts.entities.changed + counts.entities.removed + counts.entities.moved > 0 ||
      counts.relationships.added + counts.relationships.changed + counts.relationships.removed > 0 ||
      counts.rules.added + counts.rules.changed + counts.rules.removed > 0;

    packageDiffs.push({
      status: hasChanges ? 'changed' : 'unchanged',
      packageName: pkgName,
      entities,
      relationships,
      rules,
      counts,
    });
  }

  return {
    packages: packageDiffs,
    summary: buildSummary(packageDiffs),
  };
}

// ────────────────────────────────────────────────────────────────────────
// Entity diff
// ────────────────────────────────────────────────────────────────────────

function diffEntityLists(
  leftEntities: Entity[],
  rightEntities: Entity[],
  movedEntities: Map<string, { from: string; to: string; left: Entity }>,
  currentPkg: string,
): EntityLogicalDiff[] {
  const diffs: EntityLogicalDiff[] = [];
  const leftByUuid = new Map(leftEntities.map(e => [e.uuid, e]));
  const rightByUuid = new Map(rightEntities.map(e => [e.uuid, e]));
  const matched = new Set<string>();

  // Walk right side — added, changed, unchanged, or moved-in
  for (const [uuid, right] of rightByUuid) {
    const moveInfo = movedEntities.get(uuid);

    if (moveInfo && moveInfo.to === currentPkg) {
      // Entity moved INTO this package
      matched.add(uuid);
      const left = moveInfo.left;
      const attrs = diffAttributeLists(left.attributes, right.attributes);
      const constraints = diffConstraintLists(left.constraints, right.constraints);
      const changedFields = diffEntityFields(left, right);

      diffs.push({
        status: 'moved',
        entityUuid: uuid,
        entityName: right.name,
        movedFrom: moveInfo.from,
        left,
        right,
        attributes: attrs,
        constraints,
        changedFields: changedFields?.length ? changedFields : undefined,
      });
      continue;
    }

    const left = leftByUuid.get(uuid);
    if (!left) {
      // Added entity (skip if it moved away from another package — handled there)
      if (moveInfo) continue;
      diffs.push(diffEntityAdded(right));
      continue;
    }

    matched.add(uuid);
    // Both exist — compare
    const attrs = diffAttributeLists(left.attributes, right.attributes);
    const constraints = diffConstraintLists(left.constraints, right.constraints);
    const changedFields = diffEntityFields(left, right);
    const hasChanges =
      attrs.some(a => a.status !== 'unchanged') ||
      constraints.some(c => c.status !== 'unchanged') ||
      changedFields.length > 0;

    diffs.push({
      status: hasChanges ? 'changed' : 'unchanged',
      entityUuid: uuid,
      entityName: right.name,
      left,
      right,
      attributes: attrs,
      constraints,
      changedFields: changedFields.length > 0 ? changedFields : undefined,
    });
  }

  // Walk left side — removed entities (not matched and not moved)
  for (const [uuid, left] of leftByUuid) {
    if (matched.has(uuid)) continue;
    if (movedEntities.has(uuid)) continue; // moved away, handled in target package
    diffs.push(diffEntityRemoved(left));
  }

  return diffs;
}

function diffEntityAdded(entity: Entity): EntityLogicalDiff {
  return {
    status: 'added',
    entityUuid: entity.uuid,
    entityName: entity.name,
    right: entity,
    attributes: entity.attributes.map(a => diffAttrAdded(a)),
    constraints: (entity.constraints || []).map(c => ({
      status: 'added' as const,
      key: constraintKey(c),
      right: c,
    })),
  };
}

function diffEntityRemoved(entity: Entity): EntityLogicalDiff {
  return {
    status: 'removed',
    entityUuid: entity.uuid,
    entityName: entity.name,
    left: entity,
    attributes: entity.attributes.map(a => diffAttrRemoved(a)),
    constraints: (entity.constraints || []).map(c => ({
      status: 'removed' as const,
      key: constraintKey(c),
      left: c,
    })),
  };
}

function diffEntityFields(left: Entity, right: Entity): string[] {
  const changed: string[] = [];
  if (left.name !== right.name) changed.push('name');
  if ((left.description || '') !== (right.description || '')) changed.push('description');
  if ((left.stereotype || '') !== (right.stereotype || '')) changed.push('stereotype');
  if ((left.status || '') !== (right.status || '')) changed.push('status');
  if (!metadataEqual(left.metadata, right.metadata)) changed.push('metadata');
  return changed;
}

// ────────────────────────────────────────────────────────────────────────
// Attribute diff
// ────────────────────────────────────────────────────────────────────────

function diffAttributeLists(left: Attribute[], right: Attribute[]): AttributeLogicalDiff[] {
  const diffs: AttributeLogicalDiff[] = [];
  const leftByUuid = new Map(left.map(a => [a.uuid, a]));
  const rightByUuid = new Map(right.map(a => [a.uuid, a]));
  const matched = new Set<string>();

  for (const [uuid, r] of rightByUuid) {
    const l = leftByUuid.get(uuid);
    if (!l) {
      diffs.push(diffAttrAdded(r));
      continue;
    }
    matched.add(uuid);
    const changedFields = diffAttrFields(l, r);
    diffs.push({
      status: changedFields.length > 0 ? 'changed' : 'unchanged',
      attributeUuid: uuid,
      attributeName: r.name,
      left: l,
      right: r,
      changedFields: changedFields.length > 0 ? changedFields : undefined,
    });
  }

  for (const [uuid, l] of leftByUuid) {
    if (matched.has(uuid)) continue;
    diffs.push(diffAttrRemoved(l));
  }

  return diffs;
}

function diffAttrAdded(attr: Attribute): AttributeLogicalDiff {
  return { status: 'added', attributeUuid: attr.uuid, attributeName: attr.name, right: attr };
}

function diffAttrRemoved(attr: Attribute): AttributeLogicalDiff {
  return { status: 'removed', attributeUuid: attr.uuid, attributeName: attr.name, left: attr };
}

function diffAttrFields(left: Attribute, right: Attribute): string[] {
  const changed: string[] = [];
  if (left.name !== right.name) changed.push('name');
  if (left.type !== right.type) changed.push('type');
  if (left.required !== right.required) changed.push('required');
  if ((left.description || '') !== (right.description || '')) changed.push('description');
  if (!!left.primaryKey !== !!right.primaryKey) changed.push('primaryKey');
  if (!!left.unique !== !!right.unique) changed.push('unique');
  if (JSON.stringify(left.validation || {}) !== JSON.stringify(right.validation || {})) changed.push('validation');
  if (!metadataEqual(left.metadata, right.metadata)) changed.push('metadata');
  return changed;
}

// ────────────────────────────────────────────────────────────────────────
// Relationship diff
// ────────────────────────────────────────────────────────────────────────

function diffRelationshipLists(left: Relationship[], right: Relationship[]): RelationshipLogicalDiff[] {
  const diffs: RelationshipLogicalDiff[] = [];
  const leftByUuid = new Map(left.map(r => [r.uuid, r]));
  const rightByUuid = new Map(right.map(r => [r.uuid, r]));
  const matched = new Set<string>();

  for (const [uuid, r] of rightByUuid) {
    const l = leftByUuid.get(uuid);
    if (!l) {
      diffs.push(diffRelAdded(r));
      continue;
    }
    matched.add(uuid);
    const changedFields = diffRelFields(l, r);
    diffs.push({
      status: changedFields.length > 0 ? 'changed' : 'unchanged',
      relationshipUuid: uuid,
      left: l,
      right: r,
      changedFields: changedFields.length > 0 ? changedFields : undefined,
    });
  }

  for (const [uuid, l] of leftByUuid) {
    if (matched.has(uuid)) continue;
    diffs.push(diffRelRemoved(l));
  }

  return diffs;
}

function diffRelAdded(rel: Relationship): RelationshipLogicalDiff {
  return { status: 'added', relationshipUuid: rel.uuid, right: rel };
}

function diffRelRemoved(rel: Relationship): RelationshipLogicalDiff {
  return { status: 'removed', relationshipUuid: rel.uuid, left: rel };
}

function diffRelFields(left: Relationship, right: Relationship): string[] {
  const changed: string[] = [];
  if ((left.description || '') !== (right.description || '')) changed.push('description');
  if ((left.type || '') !== (right.type || '')) changed.push('type');
  if (left.source.entity !== right.source.entity) changed.push('source.entity');
  if (left.source.cardinality !== right.source.cardinality) changed.push('source.cardinality');
  if (left.target.entity !== right.target.entity) changed.push('target.entity');
  if (left.target.cardinality !== right.target.cardinality) changed.push('target.cardinality');
  const lRef = (left.source.referenceAttributes || []).join(',');
  const rRef = (right.source.referenceAttributes || []).join(',');
  if (lRef !== rRef) changed.push('source.referenceAttributes');
  if (!metadataEqual(left.metadata, right.metadata)) changed.push('metadata');
  return changed;
}

// ────────────────────────────────────────────────────────────────────────
// Constraint diff
// ────────────────────────────────────────────────────────────────────────

function diffConstraintLists(
  left: PhysicalConstraint[] | undefined,
  right: PhysicalConstraint[] | undefined,
): ConstraintLogicalDiff[] {
  const leftList = left || [];
  const rightList = right || [];
  if (leftList.length === 0 && rightList.length === 0) return [];

  const diffs: ConstraintLogicalDiff[] = [];
  const leftByKey = new Map(leftList.map(c => [constraintKey(c), c]));
  const rightByKey = new Map(rightList.map(c => [constraintKey(c), c]));
  const matched = new Set<string>();

  for (const [key, r] of rightByKey) {
    const l = leftByKey.get(key);
    if (!l) {
      diffs.push({ status: 'added', key, right: r });
      continue;
    }
    matched.add(key);
    const eq = constraintsEqual(l, r);
    diffs.push({ status: eq ? 'unchanged' : 'changed', key, left: l, right: r });
  }

  for (const [key, l] of leftByKey) {
    if (matched.has(key)) continue;
    diffs.push({ status: 'removed', key, left: l });
  }

  return diffs;
}

function constraintKey(c: PhysicalConstraint): string {
  if (c.name) return `name:${c.name}`;
  const cols = (c.columns || []).join(',');
  const ref = c.references ? `${c.references.table}(${(c.references.columns || []).join(',')})` : '';
  const expr = (c.expression || '').replace(/\s+/g, ' ').trim();
  return `${c.kind}|${cols}|${expr}|${ref}`;
}

function constraintsEqual(a: PhysicalConstraint, b: PhysicalConstraint): boolean {
  if (a.kind !== b.kind) return false;
  if ((a.columns || []).join(',') !== (b.columns || []).join(',')) return false;
  if ((a.expression || '').trim() !== (b.expression || '').trim()) return false;
  const aRef = a.references ? `${a.references.table}(${(a.references.columns || []).join(',')})` : '';
  const bRef = b.references ? `${b.references.table}(${(b.references.columns || []).join(',')})` : '';
  return aRef === bRef;
}

// ────────────────────────────────────────────────────────────────────────
// Rule diff
// ────────────────────────────────────────────────────────────────────────

function diffRuleLists(left: Rule[], right: Rule[]): RuleLogicalDiff[] {
  const diffs: RuleLogicalDiff[] = [];
  const leftByUuid = new Map(left.map(r => [r.uuid, r]));
  const rightByUuid = new Map(right.map(r => [r.uuid, r]));
  const matched = new Set<string>();

  for (const [uuid, r] of rightByUuid) {
    const l = leftByUuid.get(uuid);
    if (!l) {
      diffs.push(diffRuleAdded(r));
      continue;
    }
    matched.add(uuid);
    const changedFields = diffRuleFields(l, r);
    diffs.push({
      status: changedFields.length > 0 ? 'changed' : 'unchanged',
      ruleUuid: uuid,
      ruleName: r.name,
      left: l,
      right: r,
      changedFields: changedFields.length > 0 ? changedFields : undefined,
    });
  }

  for (const [uuid, l] of leftByUuid) {
    if (matched.has(uuid)) continue;
    diffs.push(diffRuleRemoved(l));
  }

  return diffs;
}

function diffRuleAdded(rule: Rule): RuleLogicalDiff {
  return { status: 'added', ruleUuid: rule.uuid, ruleName: rule.name, right: rule };
}

function diffRuleRemoved(rule: Rule): RuleLogicalDiff {
  return { status: 'removed', ruleUuid: rule.uuid, ruleName: rule.name, left: rule };
}

function diffRuleFields(left: Rule, right: Rule): string[] {
  const changed: string[] = [];
  if (left.name !== right.name) changed.push('name');
  if (left.description !== right.description) changed.push('description');
  if (left.severity !== right.severity) changed.push('severity');
  if (left.enforcement !== right.enforcement) changed.push('enforcement');
  if (left.scope !== right.scope) changed.push('scope');
  if (JSON.stringify(left.targets) !== JSON.stringify(right.targets)) changed.push('targets');
  if (JSON.stringify(left.expression || null) !== JSON.stringify(right.expression || null)) changed.push('expression');
  if (JSON.stringify(left.tags || []) !== JSON.stringify(right.tags || [])) changed.push('tags');
  return changed;
}

// ────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────

/** Shallow metadata equality (order-insensitive). */
function metadataEqual(a: MetadataEntry[] | undefined, b: MetadataEntry[] | undefined): boolean {
  const aList = a || [];
  const bList = b || [];
  if (aList.length !== bList.length) return false;
  const aMap = new Map(aList.map(m => [m.name, m.value]));
  for (const m of bList) {
    if (aMap.get(m.name) !== m.value) return false;
  }
  return true;
}

function buildPackageCounts(
  entities: EntityLogicalDiff[],
  relationships: RelationshipLogicalDiff[],
  rules: RuleLogicalDiff[],
): PackageDiffCounts {
  const ec = { added: 0, changed: 0, removed: 0, moved: 0, unchanged: 0 };
  for (const e of entities) {
    if (e.status === 'moved') ec.moved++;
    else ec[e.status]++;
  }
  const rc = { added: 0, changed: 0, removed: 0, unchanged: 0 };
  for (const r of relationships) rc[r.status]++;
  const uc = { added: 0, changed: 0, removed: 0, unchanged: 0 };
  for (const r of rules) uc[r.status]++;
  return { entities: ec, relationships: rc, rules: uc };
}

function buildSummary(packages: PackageDiff[]): LogicalDiffSummary {
  const summary: LogicalDiffSummary = {
    packages: { added: 0, changed: 0, removed: 0, unchanged: 0 },
    entities: { added: 0, changed: 0, removed: 0, moved: 0, unchanged: 0 },
    attributes: { added: 0, changed: 0, removed: 0, unchanged: 0 },
    relationships: { added: 0, changed: 0, removed: 0, unchanged: 0 },
    rules: { added: 0, changed: 0, removed: 0, unchanged: 0 },
  };

  for (const pkg of packages) {
    summary.packages[pkg.status]++;
    // Entity counts
    for (const e of pkg.entities) {
      if (e.status === 'moved') summary.entities.moved++;
      else summary.entities[e.status]++;
      // Attribute counts
      for (const a of e.attributes) summary.attributes[a.status]++;
    }
    // Relationship counts
    for (const r of pkg.relationships) summary.relationships[r.status]++;
    // Rule counts
    for (const r of pkg.rules) summary.rules[r.status]++;
  }

  return summary;
}
