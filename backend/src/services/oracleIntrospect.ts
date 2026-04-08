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
import { Entity, Attribute, AttributeType, EntityStatus, MetadataEntry } from '../models/EntitySchema.js';
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
 * Build numeric/length constraints to attach to the logical attribute,
 * mirroring what the SQL parser produces for VARCHAR(n) and DECIMAL(p,s).
 */
function buildConstraints(row: TabColumnRow): Attribute['constraints'] | undefined {
  const t = row.DATA_TYPE.toUpperCase();
  if (t === 'VARCHAR2' || t === 'NVARCHAR2' || t === 'CHAR' || t === 'NCHAR') {
    return row.DATA_LENGTH != null ? { maxLength: row.DATA_LENGTH } : undefined;
  }
  if (t === 'NUMBER' && row.DATA_PRECISION != null) {
    const c: NonNullable<Attribute['constraints']> = { precision: row.DATA_PRECISION };
    if (row.DATA_SCALE != null) c.scale = row.DATA_SCALE;
    return c;
  }
  return undefined;
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
): Entity[] {
  const { stripPrefixes = [], stripSuffixes = [] } = options;

  // Index PK column membership: tableName → set of column names that are PK.
  const pkByTable = new Map<string, Set<string>>();
  for (const r of pkColumns) {
    if (!pkByTable.has(r.TABLE_NAME)) pkByTable.set(r.TABLE_NAME, new Set());
    pkByTable.get(r.TABLE_NAME)!.add(r.COLUMN_NAME);
  }

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
      const constraints = buildConstraints(row);
      if (constraints) attr.constraints = constraints;
      return attr;
    });

    const entityName = toPascalCase(stripAffixes(tableName.toLowerCase(), stripPrefixes, stripSuffixes));

    const entityMetadata: MetadataEntry[] = [
      { name: 'physical.tableName', value: tableName },
      { name: 'physical.schema', value: owner },
    ];

    entities.push({
      uuid: generateUUID(),
      name: entityName,
      description: `Imported from Oracle table ${owner}.${tableName}`,
      status: EntityStatus.DRAFT,
      attributes,
      metadata: entityMetadata,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
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

    const entities = buildEntitiesFromCatalog(
      colsRes.rows as TabColumnRow[],
      pkRes.rows as PkColumnRow[],
      owner,
      parseOpts,
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
