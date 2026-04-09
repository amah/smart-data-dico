/**
 * Oracle DB schema introspection (#69 C3).
 *
 * Connects to a live Oracle database in Thin mode (no Oracle Instant Client
 * native dependency required) and reads its catalog views to produce
 * `Entity[]` matching the same JPA-style physical metadata shape that the
 * SQL DDL parser emits in #69 C1. The result slots into the existing
 * `/api/import/sql-ddl/diff` and `/commit` endpoints unchanged — diff and
 * merge don't care where the parsed entities came from.
 *
 * Catalog reads:
 *   - ALL_TABLES         → list of tables in the requested owner/schema
 *   - ALL_TAB_COLUMNS    → column name, data type, length, precision, scale, nullable
 *   - ALL_CONSTRAINTS    → primary-key constraints (CONSTRAINT_TYPE = 'P')
 *   - ALL_CONS_COLUMNS   → primary-key column membership
 *
 * Other DB engines (Postgres, MySQL, MSSQL) are deferred to ticket #82 —
 * the controller layer + diff/merge are dialect-agnostic, so a future
 * introspector only needs to emit the same Entity[] shape.
 */
import { Entity, Attribute, AttributeType, EntityStatus, MetadataEntry, PhysicalConstraint } from '../models/EntitySchema.js';
import { generateUUID } from '../utils/uuid.js';
import { logger } from '../utils/logger.js';
import {
  ParseSqlDdlOptions,
  ParseSqlDdlResult,
  stripAffixes,
  toPascalCase,
  toCamelCase,
  mapSqlTypeToAttributeType,
} from './importService.js';

/** Connection details for an Oracle introspection run. */
export interface OracleConnectionConfig {
  /** Oracle username — also the default schema (owner) to introspect. */
  user: string;
  password: string;
  /** Easy Connect string, e.g. "host:1521/service_name". */
  connectString: string;
  /**
   * Optional schema/owner to introspect. Defaults to the connecting user.
   * Case-sensitive — Oracle stores unquoted identifiers as upper-case.
   */
  owner?: string;
}

/** Options for an introspection run — connection + name-derivation rules. */
export interface IntrospectOracleOptions extends ParseSqlDdlOptions {
  connection: OracleConnectionConfig;
}

/** Raw row shapes returned by the catalog queries. */
interface TabColumnRow {
  TABLE_NAME: string;
  COLUMN_NAME: string;
  DATA_TYPE: string;
  DATA_LENGTH: number | null;
  DATA_PRECISION: number | null;
  DATA_SCALE: number | null;
  NULLABLE: string; // 'Y' | 'N'
  COLUMN_ID: number;
}

interface PkColumnRow {
  TABLE_NAME: string;
  COLUMN_NAME: string;
}

/**
 * Row shape for the secondary constraint catalog query (#85 R3).
 *
 * One row per (constraint, column) pair so we can group columns by
 * constraint name in JS. Pulls only `U` (unique), `C` (check), and
 * `R` (referential / foreign key) — primary keys are handled by the
 * separate PkColumnRow query.
 *
 * For 'R' rows the referenced table comes from `R_TABLE_NAME` (joined
 * from `ALL_CONSTRAINTS r2` on `R_CONSTRAINT_NAME`) and the referenced
 * column list comes from `R_COLUMN_NAME` (joined from
 * `ALL_CONS_COLUMNS r2cc`).
 */
interface ConstraintRow {
  TABLE_NAME: string;
  CONSTRAINT_NAME: string;
  CONSTRAINT_TYPE: 'U' | 'C' | 'R';
  COLUMN_NAME: string | null;        // null for some CHECK rows
  POSITION: number | null;           // column ordering inside the constraint
  SEARCH_CONDITION: string | null;   // for 'C' (CHECK)
  R_TABLE_NAME: string | null;       // for 'R' (FK)
  R_COLUMN_NAME: string | null;      // for 'R' (FK)
  R_POSITION: number | null;
}

/**
 * Map an Oracle DATA_TYPE (always upper-case in catalog) to a logical
 * AttributeType, falling back to the shared SQL type map for everything
 * the standard parser already knows.
 */
function mapOracleDataType(dataType: string): AttributeType {
  const t = dataType.toUpperCase();
  // Oracle-specific tokens that the SQL_TYPE_MAP in importService doesn't cover
  if (t === 'NUMBER') return AttributeType.NUMBER;
  if (t === 'BINARY_FLOAT' || t === 'BINARY_DOUBLE') return AttributeType.NUMBER;
  if (t.startsWith('TIMESTAMP')) return AttributeType.TIMESTAMP;
  if (t === 'NVARCHAR2' || t === 'VARCHAR2' || t === 'NCHAR' || t === 'LONG' || t === 'CLOB' || t === 'NCLOB') {
    return AttributeType.STRING;
  }
  if (t === 'RAW' || t === 'BLOB' || t === 'BFILE') return AttributeType.STRING;
  if (t === 'ROWID' || t === 'UROWID') return AttributeType.STRING;
  // Fall through to the shared map (handles VARCHAR, INTEGER, DATE, etc.)
  return mapSqlTypeToAttributeType(t.toLowerCase());
}

/**
 * Build the JPA-style `physical.dbType` string from a NUMBER / VARCHAR2 row.
 *
 * Oracle catalog stores DATA_LENGTH for character types and
 * DATA_PRECISION / DATA_SCALE for NUMBER. Reconstruct the SQL-ish form
 * the user would recognise: VARCHAR2(255), NUMBER(10,2), NUMBER(38), etc.
 */
function buildDbType(row: TabColumnRow): string {
  const t = row.DATA_TYPE.toUpperCase();
  if (t === 'NUMBER') {
    if (row.DATA_PRECISION != null && row.DATA_SCALE != null && row.DATA_SCALE !== 0) {
      return `NUMBER(${row.DATA_PRECISION},${row.DATA_SCALE})`;
    }
    if (row.DATA_PRECISION != null) {
      return `NUMBER(${row.DATA_PRECISION})`;
    }
    return 'NUMBER';
  }
  if (
    (t === 'VARCHAR2' || t === 'NVARCHAR2' || t === 'CHAR' || t === 'NCHAR' || t === 'RAW') &&
    row.DATA_LENGTH != null
  ) {
    return `${t}(${row.DATA_LENGTH})`;
  }
  return t;
}

/**
 * Build numeric/length validation metadata to attach to the logical attribute,
 * mirroring what the SQL parser produces for VARCHAR(n) and DECIMAL(p,s).
 * (#85: was `buildConstraints`; renamed alongside the field rename.)
 */
function buildValidation(row: TabColumnRow): Attribute['validation'] | undefined {
  const t = row.DATA_TYPE.toUpperCase();
  if (t === 'VARCHAR2' || t === 'NVARCHAR2' || t === 'CHAR' || t === 'NCHAR') {
    return row.DATA_LENGTH != null ? { maxLength: row.DATA_LENGTH } : undefined;
  }
  if (t === 'NUMBER' && row.DATA_PRECISION != null) {
    const c: NonNullable<Attribute['validation']> = { precision: row.DATA_PRECISION };
    if (row.DATA_SCALE != null) c.scale = row.DATA_SCALE;
    return c;
  }
  return undefined;
}

/**
 * Group constraint catalog rows into PhysicalConstraint[] per table (#85 R3).
 *
 * Each constraint may span multiple rows (one per column member). We bucket
 * by `(TABLE_NAME, CONSTRAINT_NAME)`, sort columns by POSITION, and emit
 * one PhysicalConstraint per bucket.
 *
 * Filters out auto-generated NOT NULL CHECK constraints — Oracle stores
 * `col IS NOT NULL` as a SEARCH_CONDITION on a CHECK constraint, but
 * nullability is already captured via `physical.nullable` on the attribute.
 * Re-emitting it as a check constraint would create spurious diff noise.
 */
export function buildConstraintsByTable(
  rows: ConstraintRow[],
): Map<string, PhysicalConstraint[]> {
  const out = new Map<string, PhysicalConstraint[]>();
  // Bucket rows by (table, constraint name)
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
    const key = `${r.TABLE_NAME}::${r.CONSTRAINT_NAME}`;
    let b = buckets.get(key);
    if (!b) {
      b = {
        type: r.CONSTRAINT_TYPE,
        tableName: r.TABLE_NAME,
        constraintName: r.CONSTRAINT_NAME,
        cols: [],
        refTable: r.R_TABLE_NAME,
        refCols: [],
        expression: r.SEARCH_CONDITION,
      };
      buckets.set(key, b);
    }
    if (r.COLUMN_NAME) {
      b.cols.push({ name: r.COLUMN_NAME, pos: r.POSITION ?? 0 });
    }
    if (r.R_COLUMN_NAME) {
      b.refCols.push({ name: r.R_COLUMN_NAME, pos: r.R_POSITION ?? 0 });
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
      // Skip NOT NULL CHECKs (auto-generated, redundant with physical.nullable)
      if (/^"?\w+"?\s+IS\s+NOT\s+NULL$/i.test(expr)) continue;
      if (!expr) continue;
      pc = {
        kind: 'check',
        name: b.constraintName,
        expression: expr,
      };
    }
    if (pc) {
      if (!out.has(b.tableName)) out.set(b.tableName, []);
      out.get(b.tableName)!.push(pc);
    }
  }

  return out;
}

/**
 * Group catalog rows into Entity objects with attributes, primary-key flags,
 * and JPA-style physical metadata. Pure — no I/O.
 *
 * Exported for unit testing the row-grouping logic without a live database.
 */
export function buildEntitiesFromCatalog(
  columns: TabColumnRow[],
  pkColumns: PkColumnRow[],
  owner: string,
  options: ParseSqlDdlOptions,
  constraintRows: ConstraintRow[] = [],
): Entity[] {
  const { stripPrefixes = [], stripSuffixes = [] } = options;

  // Index PK column membership: tableName → set of column names that are PK.
  const pkByTable = new Map<string, Set<string>>();
  for (const r of pkColumns) {
    if (!pkByTable.has(r.TABLE_NAME)) pkByTable.set(r.TABLE_NAME, new Set());
    pkByTable.get(r.TABLE_NAME)!.add(r.COLUMN_NAME);
  }

  // Index physical constraints by table (#85 R3).
  const constraintsByTable = buildConstraintsByTable(constraintRows);

  // Group columns by table, preserving COLUMN_ID order.
  const byTable = new Map<string, TabColumnRow[]>();
  for (const r of columns) {
    if (!byTable.has(r.TABLE_NAME)) byTable.set(r.TABLE_NAME, []);
    byTable.get(r.TABLE_NAME)!.push(r);
  }
  for (const arr of byTable.values()) {
    arr.sort((a, b) => a.COLUMN_ID - b.COLUMN_ID);
  }

  const entities: Entity[] = [];
  for (const [tableName, rows] of byTable) {
    if (rows.length === 0) continue;
    const pkSet = pkByTable.get(tableName) || new Set<string>();

    const attributes: Attribute[] = rows.map(row => {
      const isPK = pkSet.has(row.COLUMN_NAME);
      const isNotNull = row.NULLABLE === 'N';
      const dbType = buildDbType(row);
      const displayName = toCamelCase(stripAffixes(row.COLUMN_NAME.toLowerCase(), stripPrefixes, stripSuffixes));

      const metadata: MetadataEntry[] = [
        { name: 'physical.columnName', value: row.COLUMN_NAME },
        { name: 'physical.dbType', value: dbType },
        { name: 'physical.nullable', value: !isNotNull },
      ];

      const attr: Attribute = {
        uuid: generateUUID(),
        name: displayName,
        description: '',
        type: mapOracleDataType(row.DATA_TYPE),
        required: isNotNull || isPK,
        primaryKey: isPK || undefined,
        metadata,
      };
      const validation = buildValidation(row);
      if (validation) attr.validation = validation;
      return attr;
    });

    const entityName = toPascalCase(stripAffixes(tableName.toLowerCase(), stripPrefixes, stripSuffixes));

    const entityMetadata: MetadataEntry[] = [
      { name: 'physical.tableName', value: tableName },
      { name: 'physical.schema', value: owner },
    ];

    const entity: Entity = {
      uuid: generateUUID(),
      name: entityName,
      description: `Imported from Oracle table ${owner}.${tableName}`,
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

/**
 * Connect to Oracle in Thin mode and return a parsed Entity list. The
 * returned shape is identical to `parseSqlDdl()` so the same diff/merge
 * pipeline can consume it.
 *
 * The connection is closed before this function returns, even on error.
 */
export async function introspectOracle(options: IntrospectOracleOptions): Promise<ParseSqlDdlResult> {
  const { connection, ...parseOpts } = options;
  const owner = (connection.owner || connection.user).toUpperCase();

  // Lazy-import oracledb so the rest of the backend keeps starting if the
  // optional dependency is missing in a deployment that doesn't need it.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let oracledb: any;
  try {
    oracledb = (await import('oracledb')).default;
  } catch (err) {
    return {
      entities: [],
      errors: ['oracledb package is not available — install `oracledb` (Thin mode, no native deps required)'],
    };
  }

  let conn: any;
  try {
    conn = await oracledb.getConnection({
      user: connection.user,
      password: connection.password,
      connectString: connection.connectString,
    });

    // Catalog reads — owner is upper-cased to match Oracle's storage convention.
    const colsRes = await conn.execute(
      `SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, DATA_LENGTH, DATA_PRECISION, DATA_SCALE, NULLABLE, COLUMN_ID
       FROM ALL_TAB_COLUMNS
       WHERE OWNER = :owner
       ORDER BY TABLE_NAME, COLUMN_ID`,
      { owner },
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );

    const pkRes = await conn.execute(
      `SELECT cc.TABLE_NAME, cc.COLUMN_NAME
       FROM ALL_CONSTRAINTS c
       JOIN ALL_CONS_COLUMNS cc
         ON c.OWNER = cc.OWNER AND c.CONSTRAINT_NAME = cc.CONSTRAINT_NAME
       WHERE c.OWNER = :owner AND c.CONSTRAINT_TYPE = 'P'`,
      { owner },
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );

    // Physical constraints: U / C / R (#85 R3). Foreign keys join to the
    // referenced constraint via R_CONSTRAINT_NAME so we can resolve the
    // referenced table + columns in a single query.
    const constraintRes = await conn.execute(
      `SELECT
         c.TABLE_NAME,
         c.CONSTRAINT_NAME,
         c.CONSTRAINT_TYPE,
         c.SEARCH_CONDITION,
         cc.COLUMN_NAME,
         cc.POSITION,
         r.TABLE_NAME      AS R_TABLE_NAME,
         rcc.COLUMN_NAME   AS R_COLUMN_NAME,
         rcc.POSITION      AS R_POSITION
       FROM ALL_CONSTRAINTS c
       LEFT JOIN ALL_CONS_COLUMNS cc
         ON cc.OWNER = c.OWNER
        AND cc.CONSTRAINT_NAME = c.CONSTRAINT_NAME
       LEFT JOIN ALL_CONSTRAINTS r
         ON r.OWNER = c.R_OWNER
        AND r.CONSTRAINT_NAME = c.R_CONSTRAINT_NAME
       LEFT JOIN ALL_CONS_COLUMNS rcc
         ON rcc.OWNER = r.OWNER
        AND rcc.CONSTRAINT_NAME = r.CONSTRAINT_NAME
        AND rcc.POSITION = cc.POSITION
       WHERE c.OWNER = :owner
         AND c.CONSTRAINT_TYPE IN ('U','C','R')`,
      { owner },
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );

    const entities = buildEntitiesFromCatalog(
      colsRes.rows as TabColumnRow[],
      pkRes.rows as PkColumnRow[],
      owner,
      parseOpts,
      constraintRes.rows as ConstraintRow[],
    );

    if (entities.length === 0) {
      return {
        entities: [],
        errors: [`No tables found in Oracle schema '${owner}'`],
      };
    }

    return { entities, errors: [] };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Oracle introspection failed', error);
    return { entities: [], errors: [`Oracle introspection failed: ${message}`] };
  } finally {
    if (conn) {
      try {
        await conn.close();
      } catch (closeErr) {
        logger.error('Failed to close Oracle connection', closeErr);
      }
    }
  }
}
