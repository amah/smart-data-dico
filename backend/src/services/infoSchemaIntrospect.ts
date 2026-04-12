/**
 * Shared information_schema introspection core (#79/#80/#81).
 *
 * Postgres, MySQL, and MSSQL all expose the same standard SQL catalog views
 * (`information_schema.tables`, `information_schema.columns`,
 * `information_schema.table_constraints`, `information_schema.key_column_usage`)
 * and the only meaningful differences are: driver package, connection config
 * shape, and a handful of dialect-specific type tokens (JSONB, uniqueidentifier,
 * ENUM(…), IDENTITY). This module factors out the dialect-neutral parts so each
 * provider only has to: (1) run the catalog queries with its own driver, and
 * (2) map its own type tokens via `mapType(rawType, row)`.
 *
 * The resulting Entity[] has exactly the same JPA-style shape as the SQL DDL
 * parser (#69 C1) and the Oracle introspector (#69 C3), so the downstream
 * /api/import/sql-ddl/diff and /commit endpoints consume it unchanged.
 */
import {
  Entity,
  Attribute,
  AttributeType,
  EntityStatus,
  MetadataEntry,
  PhysicalConstraint,
} from '../models/EntitySchema.js';
import { generateUUID } from '../utils/uuid.js';
import {
  ParseSqlDdlOptions,
  stripAffixes,
  toPascalCase,
  toCamelCase,
} from './importService.js';

/**
 * A column row already normalised by a provider. `dbType` is the
 * JPA-style rendering (`VARCHAR(255)`, `NUMERIC(10,2)`, `JSONB`, …) that
 * lands in `physical.dbType`; `attributeType` is the logical type; and
 * `extraMetadata` carries dialect-specific physical metadata entries
 * (e.g. `physical.identity = true` for MSSQL IDENTITY columns).
 */
export interface NormalizedColumn {
  tableName: string;
  columnName: string;
  attributeType: AttributeType;
  dbType: string;
  nullable: boolean;
  ordinal: number;
  validation?: Attribute['validation'];
  extraMetadata?: MetadataEntry[];
}

/** Primary-key membership row — one per (table, column) in a PK. */
export interface NormalizedPk {
  tableName: string;
  columnName: string;
}

/**
 * Constraint row — one per (constraint, column member). The grouping logic
 * bucket rows by constraint name and emits one PhysicalConstraint per bucket.
 * Non-PK unique / check / foreign key only — PKs travel via NormalizedPk.
 */
export interface NormalizedConstraint {
  tableName: string;
  constraintName: string;
  type: 'U' | 'C' | 'R';
  columnName: string | null;
  position: number | null;
  searchCondition: string | null;
  refTable: string | null;
  refColumn: string | null;
  refPosition: number | null;
}

/**
 * Group constraint rows into `PhysicalConstraint[]` keyed by table name.
 * Direct port of `buildConstraintsByTable` from oracleIntrospect so all
 * providers share the same semantics — including the skip of auto-generated
 * `col IS NOT NULL` CHECKs that would otherwise duplicate `physical.nullable`.
 */
export function buildConstraintsByTable(
  rows: NormalizedConstraint[],
): Map<string, PhysicalConstraint[]> {
  const out = new Map<string, PhysicalConstraint[]>();
  type Bucket = {
    type: 'U' | 'C' | 'R';
    tableName: string;
    constraintName: string;
    cols: { name: string; pos: number }[];
    refTable: string | null;
    refCols: { name: string; pos: number }[];
    expression: string | null;
  };
  const buckets = new Map<string, Bucket>();
  for (const r of rows) {
    const key = `${r.tableName}::${r.constraintName}`;
    let b = buckets.get(key);
    if (!b) {
      b = {
        type: r.type,
        tableName: r.tableName,
        constraintName: r.constraintName,
        cols: [],
        refTable: r.refTable,
        refCols: [],
        expression: r.searchCondition,
      };
      buckets.set(key, b);
    }
    if (r.columnName) {
      b.cols.push({ name: r.columnName, pos: r.position ?? 0 });
    }
    if (r.refColumn) {
      b.refCols.push({ name: r.refColumn, pos: r.refPosition ?? 0 });
    }
  }

  for (const b of buckets.values()) {
    b.cols.sort((a, b) => a.pos - b.pos);
    b.refCols.sort((a, b) => a.pos - b.pos);

    let pc: PhysicalConstraint | null = null;
    if (b.type === 'U') {
      pc = {
        kind: 'unique',
        name: b.constraintName,
        columns: b.cols.map(c => c.name),
      };
    } else if (b.type === 'R') {
      if (!b.refTable || b.refCols.length === 0) continue;
      pc = {
        kind: 'foreignKey',
        name: b.constraintName,
        columns: b.cols.map(c => c.name),
        references: {
          table: b.refTable,
          columns: b.refCols.map(c => c.name),
        },
      };
    } else if (b.type === 'C') {
      const expr = (b.expression || '').trim();
      if (/^"?\w+"?\s+IS\s+NOT\s+NULL$/i.test(expr)) continue;
      if (!expr) continue;
      pc = { kind: 'check', name: b.constraintName, expression: expr };
    }
    if (pc) {
      if (!out.has(b.tableName)) out.set(b.tableName, []);
      out.get(b.tableName)!.push(pc);
    }
  }
  return out;
}

/**
 * Build `Entity[]` from normalized catalog rows. Pure — no I/O.
 * Shared by the Postgres / MySQL / MSSQL providers.
 *
 * `sourceLabel` is used in the entity description line only
 * (e.g. "Imported from Postgres table public.orders").
 */
export function buildEntitiesFromNormalized(
  columns: NormalizedColumn[],
  pkColumns: NormalizedPk[],
  schema: string,
  options: ParseSqlDdlOptions,
  constraintRows: NormalizedConstraint[] = [],
  sourceLabel = 'database',
): Entity[] {
  const { stripPrefixes = [], stripSuffixes = [] } = options;

  const pkByTable = new Map<string, Set<string>>();
  for (const r of pkColumns) {
    if (!pkByTable.has(r.tableName)) pkByTable.set(r.tableName, new Set());
    pkByTable.get(r.tableName)!.add(r.columnName);
  }

  const constraintsByTable = buildConstraintsByTable(constraintRows);

  const byTable = new Map<string, NormalizedColumn[]>();
  for (const r of columns) {
    if (!byTable.has(r.tableName)) byTable.set(r.tableName, []);
    byTable.get(r.tableName)!.push(r);
  }
  for (const arr of byTable.values()) {
    arr.sort((a, b) => a.ordinal - b.ordinal);
  }

  const entities: Entity[] = [];
  for (const [tableName, rows] of byTable) {
    if (rows.length === 0) continue;
    const pkSet = pkByTable.get(tableName) || new Set<string>();

    const attributes: Attribute[] = rows.map(row => {
      const isPK = pkSet.has(row.columnName);
      const isNotNull = !row.nullable;
      const displayName = toCamelCase(
        stripAffixes(row.columnName.toLowerCase(), stripPrefixes, stripSuffixes),
      );

      const metadata: MetadataEntry[] = [
        { name: 'physical.columnName', value: row.columnName },
        { name: 'physical.dbType', value: row.dbType },
        { name: 'physical.nullable', value: row.nullable },
        ...(row.extraMetadata || []),
      ];

      const attr: Attribute = {
        uuid: generateUUID(),
        name: displayName,
        description: '',
        type: row.attributeType,
        required: isNotNull || isPK,
        primaryKey: isPK || undefined,
        metadata,
      };
      if (row.validation) attr.validation = row.validation;
      return attr;
    });

    const entityName = toPascalCase(
      stripAffixes(tableName.toLowerCase(), stripPrefixes, stripSuffixes),
    );
    const entityMetadata: MetadataEntry[] = [
      { name: 'physical.tableName', value: tableName },
      { name: 'physical.schema', value: schema },
    ];

    const entity: Entity = {
      uuid: generateUUID(),
      name: entityName,
      description: `Imported from ${sourceLabel} table ${schema}.${tableName}`,
      status: EntityStatus.DRAFT,
      attributes,
      metadata: entityMetadata,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const tableConstraints = constraintsByTable.get(tableName);
    if (tableConstraints && tableConstraints.length > 0) {
      entity.constraints = tableConstraints;
    }
    entities.push(entity);
  }

  return entities;
}
