/**
 * Per-mode info-panel payload builder (#188, Decision 2 — compact nodes).
 *
 * Nodes stay compact in every view; the selected-node detail in the info panel
 * varies by mode:
 *   - structural: attribute name · type · PK · required (unchanged behaviour).
 *   - logical: attribute ORM facts — @Id / @GeneratedValue, @Enumerated,
 *     @Embedded, @Lob, @Version and the Java type.
 *   - physical: columns (physical.columnName + physical.dbType) plus the
 *     PK / FK / unique flags and the table's constraints[].
 *
 * Pure functions of (attributes, constraints) — unit-tested in isolation and
 * consumed by CytoscapeInfoPanel.
 */
import type { Attribute, PhysicalConstraint } from '../../types';
import type { ViewMode } from './viewMode';
import { readMetaString, readMetaFlag } from './elementMeta';

export interface StructuralAttrRow {
  name: string;
  type: string;
  primaryKey: boolean;
  required: boolean;
}

export interface LogicalAttrRow {
  name: string;
  javaType: string;
  /** ORM annotations: @Id, @GeneratedValue: UUID, @Enumerated: STRING, … */
  facts: string[];
}

export interface PhysicalColumnRow {
  name: string;
  dbType: string;
  /** PK / FK / UQ flags. */
  flags: string[];
}

export interface ConstraintRow {
  kind: PhysicalConstraint['kind'];
  label: string;
}

export type NodeInfo =
  | { mode: 'structural'; attributes: StructuralAttrRow[] }
  | { mode: 'logical'; attributes: LogicalAttrRow[] }
  | { mode: 'physical'; columns: PhysicalColumnRow[]; constraints: ConstraintRow[] };

const isPrimaryKey = (attr: Attribute): boolean =>
  attr.primaryKey === true || readMetaFlag(attr.metadata, 'isPrimaryKey');

const isForeignKey = (attr: Attribute): boolean =>
  readMetaFlag(attr.metadata, 'isForeignKey');

/** Physical column name — `physical.columnName` else the attribute name. */
export function columnName(attr: Attribute): string {
  return readMetaString(attr.metadata, 'physical.columnName') || attr.name;
}

/** ORM facts for one attribute in the logical view. */
export function logicalAttrFacts(attr: Attribute): LogicalAttrRow {
  const facts: string[] = [];
  if (isPrimaryKey(attr)) facts.push('@Id');
  const generated = readMetaString(attr.metadata, 'orm.generatedValue');
  if (generated && generated !== 'NONE') facts.push(`@GeneratedValue: ${generated}`);
  const enumerated = readMetaString(attr.metadata, 'orm.enumerated');
  if (enumerated) facts.push(`@Enumerated: ${enumerated}`);
  if (readMetaFlag(attr.metadata, 'orm.embedded')) facts.push('@Embedded');
  if (readMetaFlag(attr.metadata, 'orm.elementCollection')) facts.push('@ElementCollection');
  if (readMetaFlag(attr.metadata, 'orm.lob')) facts.push('@Lob');
  if (readMetaFlag(attr.metadata, 'orm.version')) facts.push('@Version');
  if (readMetaFlag(attr.metadata, 'orm.transient')) facts.push('@Transient');
  const temporal = readMetaString(attr.metadata, 'orm.temporal');
  if (temporal) facts.push(`@Temporal: ${temporal}`);
  const javaType = readMetaString(attr.metadata, 'orm.javaType') || '';
  return { name: attr.name, javaType, facts };
}

/** Column facts (name / dbType / PK-FK-UQ flags) for one attribute in physical view. */
export function physicalColumn(
  attr: Attribute,
  fkColumns: Set<string>,
  uniqueColumns: Set<string>,
): PhysicalColumnRow {
  const name = columnName(attr);
  const flags: string[] = [];
  if (isPrimaryKey(attr)) flags.push('PK');
  if (isForeignKey(attr) || fkColumns.has(name)) flags.push('FK');
  if (attr.unique || uniqueColumns.has(name)) flags.push('UQ');
  return { name, dbType: readMetaString(attr.metadata, 'physical.dbType') || '', flags };
}

/** Human summary line for a physical constraint. */
export function constraintRow(c: PhysicalConstraint): ConstraintRow {
  const cols = (c.columns ?? []).join(', ');
  let label: string;
  switch (c.kind) {
    case 'foreignKey':
      label = `${cols} → ${c.references?.table ?? '?'}(${(c.references?.columns ?? []).join(', ')})`;
      break;
    case 'check':
      label = c.expression ?? c.name ?? 'check';
      break;
    default: // unique / index
      label = cols || c.name || c.kind;
  }
  return { kind: c.kind, label };
}

export function buildNodeInfo(
  viewMode: ViewMode | undefined,
  attributes: Attribute[] = [],
  constraints: PhysicalConstraint[] = [],
): NodeInfo {
  if (viewMode === 'logical') {
    return { mode: 'logical', attributes: attributes.map(logicalAttrFacts) };
  }
  if (viewMode === 'physical') {
    const fkColumns = new Set<string>();
    const uniqueColumns = new Set<string>();
    for (const c of constraints) {
      if (c.kind === 'foreignKey') (c.columns ?? []).forEach((col) => fkColumns.add(col));
      if (c.kind === 'unique') (c.columns ?? []).forEach((col) => uniqueColumns.add(col));
    }
    return {
      mode: 'physical',
      columns: attributes.map((a) => physicalColumn(a, fkColumns, uniqueColumns)),
      constraints: constraints.map(constraintRow),
    };
  }
  return {
    mode: 'structural',
    attributes: attributes.map((a) => ({
      name: a.name,
      type: a.type,
      primaryKey: a.primaryKey === true || readMetaFlag(a.metadata, 'isPrimaryKey'),
      required: a.required,
    })),
  };
}
