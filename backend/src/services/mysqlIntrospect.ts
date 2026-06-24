/**
 * MySQL / MariaDB schema introspection (#80).
 *
 * Uses `mysql2` (pure-JS) to query information_schema and hand off to the
 * shared normalization + grouping core in `infoSchemaIntrospect.ts`.
 *
 * MySQL-specific handling:
 *   - `enum('a','b','c')` columns → `AttributeType.ENUM` with
 *     `validation.enum` set from `COLUMN_TYPE` parsing.
 *   - `json` → OBJECT.
 *   - Auto-increment flag from `EXTRA` column → `physical.autoIncrement`.
 */
import { AttributeType, Attribute, MetadataEntry } from '../models/EntitySchema.js';
import { logger } from '../utils/logger.js';
import { ParseSqlDdlOptions, ParseSqlDdlResult } from './importService.js';
import {
  NormalizedColumn,
  NormalizedPk,
  NormalizedConstraint,
  buildEntitiesFromNormalized,
} from './infoSchemaIntrospect.js';

export interface MysqlConnectionConfig {
  host: string;
  port?: number;
  database: string;
  user: string;
  password: string;
}

export interface IntrospectMysqlOptions extends ParseSqlDdlOptions {
  connection: MysqlConnectionConfig;
}

/**
 * Parse the values inside `enum('a','b','c')` or `set('x','y')` as emitted
 * in `information_schema.COLUMNS.COLUMN_TYPE`. Returns null for non-enum.
 */
export function parseEnumValues(columnType: string): string[] | null {
  const m = /^enum\((.*)\)$/i.exec(columnType.trim());
  if (!m) return null;
  // Split on ',' while respecting quoted strings. Values are single-quoted
  // by MySQL and may contain escaped quotes ('' inside a 'literal').
  const body = m[1];
  const out: string[] = [];
  const re = /'((?:[^']|'')*)'/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(body)) !== null) {
    out.push(match[1].replace(/''/g, "'"));
  }
  return out;
}

export function mapMysqlType(dataType: string, columnType: string): AttributeType {
  const t = (dataType || '').toLowerCase();
  if (parseEnumValues(columnType || '')) return AttributeType.ENUM;
  if (t === 'json') return AttributeType.OBJECT;
  if (t === 'tinyint' && /tinyint\(1\)/i.test(columnType || '')) return AttributeType.BOOLEAN;
  if (t === 'tinyint' || t === 'smallint' || t === 'mediumint' || t === 'int' || t === 'bigint')
    return AttributeType.INTEGER;
  if (t === 'decimal' || t === 'numeric' || t === 'float' || t === 'double' || t === 'real')
    return AttributeType.NUMBER;
  if (t === 'date') return AttributeType.DATE;
  if (t === 'time') return AttributeType.TIME;
  if (t === 'datetime') return AttributeType.DATETIME;
  if (t === 'timestamp') return AttributeType.TIMESTAMP;
  if (t === 'bit') return AttributeType.BOOLEAN;
  return AttributeType.STRING;
}

export function buildMysqlDbType(row: {
  DATA_TYPE: string;
  COLUMN_TYPE: string;
}): string {
  // COLUMN_TYPE already carries the full rendering (`varchar(255)`,
  // `int unsigned`, `enum('a','b')`, …), so use it verbatim but upper-cased
  // for readability in the UI.
  return (row.COLUMN_TYPE || row.DATA_TYPE || '').toUpperCase();
}

function buildValidation(row: {
  DATA_TYPE: string;
  COLUMN_TYPE: string;
  CHARACTER_MAXIMUM_LENGTH: number | null;
  NUMERIC_PRECISION: number | null;
  NUMERIC_SCALE: number | null;
}): Attribute['validation'] | undefined {
  const t = (row.DATA_TYPE || '').toLowerCase();
  const enumValues = parseEnumValues(row.COLUMN_TYPE || '');
  if (enumValues) return { enumValues };
  if (t === 'varchar' || t === 'char' || t === 'text' || t === 'tinytext' || t === 'mediumtext' || t === 'longtext') {
    return row.CHARACTER_MAXIMUM_LENGTH != null ? { maxLength: row.CHARACTER_MAXIMUM_LENGTH } : undefined;
  }
  if (t === 'decimal' || t === 'numeric') {
    if (row.NUMERIC_PRECISION == null) return undefined;
    const v: NonNullable<Attribute['validation']> = { precision: row.NUMERIC_PRECISION };
    if (row.NUMERIC_SCALE != null) v.scale = row.NUMERIC_SCALE;
    return v;
  }
  return undefined;
}

export function normalizeMysqlColumn(row: {
  TABLE_NAME: string;
  COLUMN_NAME: string;
  DATA_TYPE: string;
  COLUMN_TYPE: string;
  IS_NULLABLE: string;
  CHARACTER_MAXIMUM_LENGTH: number | null;
  NUMERIC_PRECISION: number | null;
  NUMERIC_SCALE: number | null;
  ORDINAL_POSITION: number;
  EXTRA: string | null;
}): NormalizedColumn {
  const extra: MetadataEntry[] = [];
  if ((row.EXTRA || '').toLowerCase().includes('auto_increment')) {
    extra.push({ name: 'physical.autoIncrement', value: true });
  }
  const validation = buildValidation(row);
  const col: NormalizedColumn = {
    tableName: row.TABLE_NAME,
    columnName: row.COLUMN_NAME,
    attributeType: mapMysqlType(row.DATA_TYPE, row.COLUMN_TYPE),
    dbType: buildMysqlDbType(row),
    nullable: row.IS_NULLABLE === 'YES',
    ordinal: row.ORDINAL_POSITION,
    extraMetadata: extra,
  };
  if (validation) col.validation = validation;
  return col;
}

export async function introspectMysql(
  options: IntrospectMysqlOptions,
): Promise<ParseSqlDdlResult> {
  const { connection, ...parseOpts } = options;
  const schema = connection.database;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mysql: any;
  try {
    mysql = await import('mysql2/promise');
  } catch {
    return {
      entities: [],
      errors: ['mysql2 package is not available — install `mysql2` to use MySQL introspection'],
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let conn: any;
  try {
    const createConnection = mysql.createConnection ?? mysql.default?.createConnection;
    conn = await createConnection({
      host: connection.host,
      port: connection.port ?? 3306,
      database: connection.database,
      user: connection.user,
      password: connection.password,
    });

    const [colRows] = await conn.execute(
      `SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, COLUMN_TYPE, IS_NULLABLE,
              CHARACTER_MAXIMUM_LENGTH, NUMERIC_PRECISION, NUMERIC_SCALE,
              ORDINAL_POSITION, EXTRA
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = ?
       ORDER BY TABLE_NAME, ORDINAL_POSITION`,
      [schema],
    );

    const [pkRows] = await conn.execute(
      `SELECT kcu.TABLE_NAME, kcu.COLUMN_NAME
       FROM information_schema.TABLE_CONSTRAINTS tc
       JOIN information_schema.KEY_COLUMN_USAGE kcu
         ON tc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
        AND tc.TABLE_SCHEMA = kcu.TABLE_SCHEMA
        AND tc.TABLE_NAME = kcu.TABLE_NAME
       WHERE tc.TABLE_SCHEMA = ? AND tc.CONSTRAINT_TYPE = 'PRIMARY KEY'`,
      [schema],
    );

    const [constraintRows] = await conn.execute(
      `SELECT tc.TABLE_NAME,
              tc.CONSTRAINT_NAME,
              tc.CONSTRAINT_TYPE,
              kcu.COLUMN_NAME,
              kcu.ORDINAL_POSITION AS position,
              kcu.REFERENCED_TABLE_NAME AS ref_table,
              kcu.REFERENCED_COLUMN_NAME AS ref_column,
              kcu.POSITION_IN_UNIQUE_CONSTRAINT AS ref_position,
              cc.CHECK_CLAUSE AS search_condition
       FROM information_schema.TABLE_CONSTRAINTS tc
       LEFT JOIN information_schema.KEY_COLUMN_USAGE kcu
         ON tc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
        AND tc.TABLE_SCHEMA = kcu.TABLE_SCHEMA
        AND tc.TABLE_NAME = kcu.TABLE_NAME
       LEFT JOIN information_schema.CHECK_CONSTRAINTS cc
         ON cc.CONSTRAINT_NAME = tc.CONSTRAINT_NAME
        AND cc.CONSTRAINT_SCHEMA = tc.TABLE_SCHEMA
       WHERE tc.TABLE_SCHEMA = ?
         AND tc.CONSTRAINT_TYPE IN ('UNIQUE','CHECK','FOREIGN KEY')`,
      [schema],
    );

    const normalized = (colRows as any[]).map(normalizeMysqlColumn);
    const pks: NormalizedPk[] = (pkRows as any[]).map(r => ({
      tableName: r.TABLE_NAME,
      columnName: r.COLUMN_NAME,
    }));
    const cons: NormalizedConstraint[] = (constraintRows as any[]).map(r => ({
      tableName: r.TABLE_NAME,
      constraintName: r.CONSTRAINT_NAME,
      type:
        r.CONSTRAINT_TYPE === 'UNIQUE'
          ? 'U'
          : r.CONSTRAINT_TYPE === 'CHECK'
            ? 'C'
            : 'R',
      columnName: r.COLUMN_NAME ?? null,
      position: r.position ?? null,
      searchCondition: r.search_condition ?? null,
      refTable: r.ref_table ?? null,
      refColumn: r.ref_column ?? null,
      refPosition: r.ref_position ?? null,
    }));

    const entities = buildEntitiesFromNormalized(
      normalized,
      pks,
      schema,
      parseOpts,
      cons,
      'MySQL',
    );
    if (entities.length === 0) {
      return { entities: [], errors: [`No tables found in MySQL database '${schema}'`] };
    }
    return { entities, errors: [] };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('MySQL introspection failed', error);
    return { entities: [], errors: [`MySQL introspection failed: ${message}`] };
  } finally {
    if (conn) {
      try {
        await conn.end();
      } catch (endErr) {
        logger.error('Failed to end MySQL connection', endErr);
      }
    }
  }
}
