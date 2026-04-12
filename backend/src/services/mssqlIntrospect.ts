/**
 * SQL Server schema introspection (#81).
 *
 * Uses the `mssql` package (which bundles the pure-JS `tedious` driver, so
 * no native deps) to query INFORMATION_SCHEMA. SQL Server's standard catalog
 * is close enough to the Postgres/MySQL flavour that the shared normalization
 * in `infoSchemaIntrospect.ts` does all the heavy lifting; MSSQL-specific
 * pieces are the `uniqueidentifier → UUID` map and the IDENTITY flag pulled
 * from `sys.identity_columns`.
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

export interface MssqlConnectionConfig {
  server: string;
  port?: number;
  database: string;
  user: string;
  password: string;
  /** Schema to introspect. Defaults to 'dbo'. */
  schema?: string;
  options?: {
    encrypt?: boolean;
    trustServerCertificate?: boolean;
  };
}

export interface IntrospectMssqlOptions extends ParseSqlDdlOptions {
  connection: MssqlConnectionConfig;
}

export function mapMssqlType(dataType: string): AttributeType {
  const t = (dataType || '').toLowerCase();
  if (t === 'uniqueidentifier') return AttributeType.UUID;
  if (t === 'bit') return AttributeType.BOOLEAN;
  if (
    t === 'tinyint' ||
    t === 'smallint' ||
    t === 'int' ||
    t === 'bigint'
  )
    return AttributeType.INTEGER;
  if (
    t === 'decimal' ||
    t === 'numeric' ||
    t === 'float' ||
    t === 'real' ||
    t === 'money' ||
    t === 'smallmoney'
  )
    return AttributeType.NUMBER;
  if (t === 'date') return AttributeType.DATE;
  if (t === 'time') return AttributeType.TIME;
  if (t === 'datetime' || t === 'datetime2' || t === 'smalldatetime') return AttributeType.DATETIME;
  if (t === 'datetimeoffset') return AttributeType.TIMESTAMP;
  // nvarchar / varchar / char / nchar / text / ntext / xml → STRING
  return AttributeType.STRING;
}

export function buildMssqlDbType(row: {
  DATA_TYPE: string;
  CHARACTER_MAXIMUM_LENGTH: number | null;
  NUMERIC_PRECISION: number | null;
  NUMERIC_SCALE: number | null;
}): string {
  const t = (row.DATA_TYPE || '').toUpperCase();
  if (t === 'NVARCHAR' || t === 'VARCHAR' || t === 'CHAR' || t === 'NCHAR') {
    const len = row.CHARACTER_MAXIMUM_LENGTH;
    if (len == null) return t;
    return len === -1 ? `${t}(MAX)` : `${t}(${len})`;
  }
  if (t === 'DECIMAL' || t === 'NUMERIC') {
    if (row.NUMERIC_PRECISION != null && row.NUMERIC_SCALE != null && row.NUMERIC_SCALE !== 0) {
      return `${t}(${row.NUMERIC_PRECISION},${row.NUMERIC_SCALE})`;
    }
    if (row.NUMERIC_PRECISION != null) return `${t}(${row.NUMERIC_PRECISION})`;
    return t;
  }
  return t;
}

function buildValidation(row: {
  DATA_TYPE: string;
  CHARACTER_MAXIMUM_LENGTH: number | null;
  NUMERIC_PRECISION: number | null;
  NUMERIC_SCALE: number | null;
}): Attribute['validation'] | undefined {
  const t = (row.DATA_TYPE || '').toLowerCase();
  if (t === 'varchar' || t === 'nvarchar' || t === 'char' || t === 'nchar') {
    // -1 means MAX — don't emit a bogus maxLength.
    if (row.CHARACTER_MAXIMUM_LENGTH == null || row.CHARACTER_MAXIMUM_LENGTH === -1) return undefined;
    return { maxLength: row.CHARACTER_MAXIMUM_LENGTH };
  }
  if (t === 'decimal' || t === 'numeric') {
    if (row.NUMERIC_PRECISION == null) return undefined;
    const v: NonNullable<Attribute['validation']> = { precision: row.NUMERIC_PRECISION };
    if (row.NUMERIC_SCALE != null) v.scale = row.NUMERIC_SCALE;
    return v;
  }
  return undefined;
}

export function normalizeMssqlColumn(
  row: {
    TABLE_NAME: string;
    COLUMN_NAME: string;
    DATA_TYPE: string;
    IS_NULLABLE: string;
    CHARACTER_MAXIMUM_LENGTH: number | null;
    NUMERIC_PRECISION: number | null;
    NUMERIC_SCALE: number | null;
    ORDINAL_POSITION: number;
  },
  identityColumns: Set<string>,
): NormalizedColumn {
  const extra: MetadataEntry[] = [];
  if (identityColumns.has(`${row.TABLE_NAME}.${row.COLUMN_NAME}`)) {
    extra.push({ name: 'physical.identity', value: true });
  }
  const validation = buildValidation(row);
  const col: NormalizedColumn = {
    tableName: row.TABLE_NAME,
    columnName: row.COLUMN_NAME,
    attributeType: mapMssqlType(row.DATA_TYPE),
    dbType: buildMssqlDbType(row),
    nullable: row.IS_NULLABLE === 'YES',
    ordinal: row.ORDINAL_POSITION,
    extraMetadata: extra,
  };
  if (validation) col.validation = validation;
  return col;
}

export async function introspectMssql(
  options: IntrospectMssqlOptions,
): Promise<ParseSqlDdlResult> {
  const { connection, ...parseOpts } = options;
  const schema = connection.schema || 'dbo';

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mssql: any;
  try {
    mssql = (await import('mssql')).default;
  } catch {
    return {
      entities: [],
      errors: ['mssql package is not available — install `mssql` to use SQL Server introspection'],
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let pool: any;
  try {
    pool = await mssql.connect({
      server: connection.server,
      port: connection.port ?? 1433,
      database: connection.database,
      user: connection.user,
      password: connection.password,
      options: {
        encrypt: connection.options?.encrypt ?? true,
        trustServerCertificate: connection.options?.trustServerCertificate ?? false,
      },
    });

    const run = async (sql: string) => {
      const req = pool.request();
      req.input('schema', mssql.NVarChar, schema);
      const res = await req.query(sql);
      return res.recordset as any[];
    };

    const colRows = await run(
      `SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, IS_NULLABLE,
              CHARACTER_MAXIMUM_LENGTH, NUMERIC_PRECISION, NUMERIC_SCALE, ORDINAL_POSITION
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = @schema
       ORDER BY TABLE_NAME, ORDINAL_POSITION`,
    );

    const pkRows = await run(
      `SELECT kcu.TABLE_NAME, kcu.COLUMN_NAME
       FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
       JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu
         ON tc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
        AND tc.TABLE_SCHEMA = kcu.TABLE_SCHEMA
       WHERE tc.TABLE_SCHEMA = @schema AND tc.CONSTRAINT_TYPE = 'PRIMARY KEY'`,
    );

    const constraintRows = await run(
      `SELECT tc.TABLE_NAME,
              tc.CONSTRAINT_NAME,
              tc.CONSTRAINT_TYPE,
              kcu.COLUMN_NAME,
              kcu.ORDINAL_POSITION AS position,
              rc.UNIQUE_CONSTRAINT_NAME AS ref_constraint,
              cc.CHECK_CLAUSE AS search_condition
       FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
       LEFT JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu
         ON kcu.CONSTRAINT_NAME = tc.CONSTRAINT_NAME
        AND kcu.TABLE_SCHEMA = tc.TABLE_SCHEMA
       LEFT JOIN INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS rc
         ON rc.CONSTRAINT_NAME = tc.CONSTRAINT_NAME
        AND rc.CONSTRAINT_SCHEMA = tc.TABLE_SCHEMA
       LEFT JOIN INFORMATION_SCHEMA.CHECK_CONSTRAINTS cc
         ON cc.CONSTRAINT_NAME = tc.CONSTRAINT_NAME
        AND cc.CONSTRAINT_SCHEMA = tc.TABLE_SCHEMA
       WHERE tc.TABLE_SCHEMA = @schema
         AND tc.CONSTRAINT_TYPE IN ('UNIQUE','CHECK','FOREIGN KEY')`,
    );

    // Resolve FK references: INFORMATION_SCHEMA only gives us the name of
    // the unique constraint the FK points at — we need a second lookup to
    // turn that into (table, column) pairs.
    const refLookup = await run(
      `SELECT kcu.CONSTRAINT_NAME, kcu.TABLE_NAME, kcu.COLUMN_NAME, kcu.ORDINAL_POSITION
       FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu
       JOIN INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
         ON tc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
        AND tc.TABLE_SCHEMA = kcu.TABLE_SCHEMA
       WHERE tc.TABLE_SCHEMA = @schema
         AND tc.CONSTRAINT_TYPE IN ('PRIMARY KEY','UNIQUE')`,
    );
    const refByConstraint = new Map<string, { table: string; column: string; position: number }[]>();
    for (const r of refLookup) {
      if (!refByConstraint.has(r.CONSTRAINT_NAME)) refByConstraint.set(r.CONSTRAINT_NAME, []);
      refByConstraint.get(r.CONSTRAINT_NAME)!.push({
        table: r.TABLE_NAME,
        column: r.COLUMN_NAME,
        position: r.ORDINAL_POSITION,
      });
    }

    // IDENTITY columns (sys.identity_columns) — join to sys.objects for name.
    const identityRows = await run(
      `SELECT t.name AS TABLE_NAME, c.name AS COLUMN_NAME
       FROM sys.identity_columns c
       JOIN sys.tables t ON t.object_id = c.object_id
       JOIN sys.schemas s ON s.schema_id = t.schema_id
       WHERE s.name = @schema`,
    );
    const identitySet = new Set<string>(
      identityRows.map((r: any) => `${r.TABLE_NAME}.${r.COLUMN_NAME}`),
    );

    const normalized = colRows.map(r => normalizeMssqlColumn(r as any, identitySet));
    const pks: NormalizedPk[] = pkRows.map(r => ({
      tableName: r.TABLE_NAME,
      columnName: r.COLUMN_NAME,
    }));
    const cons: NormalizedConstraint[] = constraintRows.map(r => {
      const type: 'U' | 'C' | 'R' =
        r.CONSTRAINT_TYPE === 'UNIQUE' ? 'U' : r.CONSTRAINT_TYPE === 'CHECK' ? 'C' : 'R';
      let refTable: string | null = null;
      let refColumn: string | null = null;
      let refPosition: number | null = null;
      if (type === 'R' && r.ref_constraint) {
        const members = refByConstraint.get(r.ref_constraint) || [];
        // Match FK column position → referenced column at the same position.
        const match = members.find(m => m.position === r.position) || members[0];
        if (match) {
          refTable = match.table;
          refColumn = match.column;
          refPosition = match.position;
        }
      }
      return {
        tableName: r.TABLE_NAME,
        constraintName: r.CONSTRAINT_NAME,
        type,
        columnName: r.COLUMN_NAME ?? null,
        position: r.position ?? null,
        searchCondition: r.search_condition ?? null,
        refTable,
        refColumn,
        refPosition,
      };
    });

    const entities = buildEntitiesFromNormalized(
      normalized,
      pks,
      schema,
      parseOpts,
      cons,
      'SQL Server',
    );
    if (entities.length === 0) {
      return { entities: [], errors: [`No tables found in SQL Server schema '${schema}'`] };
    }
    return { entities, errors: [] };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('MSSQL introspection failed', error);
    return { entities: [], errors: [`SQL Server introspection failed: ${message}`] };
  } finally {
    if (pool) {
      try {
        await pool.close();
      } catch (closeErr) {
        logger.error('Failed to close MSSQL pool', closeErr);
      }
    }
  }
}
