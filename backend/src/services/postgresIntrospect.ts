/**
 * Postgres schema introspection (#79).
 *
 * Connects to a live Postgres instance via the pure-JS `pg` driver and reads
 * `information_schema` to produce the same `Entity[]` shape as the Oracle
 * introspector (#69 C3). Dispatch / diff / commit are dialect-agnostic — see
 * `infoSchemaIntrospect.ts` for the shared normalization + grouping core.
 *
 * Driver import is lazy so a backend without `pg` installed still boots; the
 * endpoint returns a friendly error instead of a startup failure.
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

/** Connection params for a Postgres introspection run. */
export interface PostgresConnectionConfig {
  host: string;
  port?: number;
  database: string;
  user: string;
  password: string;
  /** Schema to introspect. Defaults to 'public'. */
  schema?: string;
}

export interface IntrospectPostgresOptions extends ParseSqlDdlOptions {
  connection: PostgresConnectionConfig;
}

/**
 * Map a Postgres `data_type` (as reported by `information_schema.columns`)
 * plus its `udt_name` (for the real underlying type — e.g. information_schema
 * reports `USER-DEFINED` for enums, `ARRAY` for arrays, and the actual name
 * lives in `udt_name`) to our logical AttributeType.
 */
export function mapPostgresType(dataType: string, udtName: string | null): AttributeType {
  const t = (dataType || '').toLowerCase();
  const udt = (udtName || '').toLowerCase();

  if (t === 'uuid' || udt === 'uuid') return AttributeType.UUID;
  if (t === 'json' || t === 'jsonb' || udt === 'json' || udt === 'jsonb') return AttributeType.OBJECT;
  if (t === 'array' || udt.startsWith('_')) return AttributeType.ARRAY;
  if (t === 'boolean' || udt === 'bool') return AttributeType.BOOLEAN;
  if (
    t === 'smallint' ||
    t === 'integer' ||
    t === 'bigint' ||
    udt === 'int2' ||
    udt === 'int4' ||
    udt === 'int8'
  )
    return AttributeType.INTEGER;
  if (
    t === 'numeric' ||
    t === 'real' ||
    t === 'double precision' ||
    t === 'decimal' ||
    t === 'money'
  )
    return AttributeType.NUMBER;
  if (t === 'date') return AttributeType.DATE;
  if (t.startsWith('time without') || t === 'time') return AttributeType.TIME;
  if (t.startsWith('timestamp')) return AttributeType.TIMESTAMP;
  if (t === 'bytea') return AttributeType.STRING;
  return AttributeType.STRING;
}

/**
 * Reconstruct a JPA-style dbType string from the information_schema column
 * row so the user sees something recognisable in `physical.dbType`.
 */
export function buildPostgresDbType(row: {
  data_type: string;
  udt_name: string | null;
  character_maximum_length: number | null;
  numeric_precision: number | null;
  numeric_scale: number | null;
}): string {
  const t = (row.data_type || '').toUpperCase();
  const udt = (row.udt_name || '').toUpperCase();
  // Prefer udt_name for user-defined, JSONB, UUID — information_schema shows
  // `USER-DEFINED` / `ARRAY` which is useless in physical.dbType.
  if (t === 'USER-DEFINED' || t === 'ARRAY') return udt || t;
  if (t === 'JSONB' || udt === 'JSONB') return 'JSONB';
  if (t === 'UUID' || udt === 'UUID') return 'UUID';
  if (t === 'CHARACTER VARYING' || t === 'VARCHAR') {
    return row.character_maximum_length != null ? `VARCHAR(${row.character_maximum_length})` : 'VARCHAR';
  }
  if (t === 'CHARACTER' || t === 'CHAR') {
    return row.character_maximum_length != null ? `CHAR(${row.character_maximum_length})` : 'CHAR';
  }
  if (t === 'NUMERIC' || t === 'DECIMAL') {
    if (row.numeric_precision != null && row.numeric_scale != null && row.numeric_scale !== 0) {
      return `NUMERIC(${row.numeric_precision},${row.numeric_scale})`;
    }
    if (row.numeric_precision != null) return `NUMERIC(${row.numeric_precision})`;
    return 'NUMERIC';
  }
  return t;
}

function buildValidation(row: {
  data_type: string;
  character_maximum_length: number | null;
  numeric_precision: number | null;
  numeric_scale: number | null;
}): Attribute['validation'] | undefined {
  const t = (row.data_type || '').toLowerCase();
  if (t === 'character varying' || t === 'varchar' || t === 'character' || t === 'char') {
    return row.character_maximum_length != null ? { maxLength: row.character_maximum_length } : undefined;
  }
  if (t === 'numeric' || t === 'decimal') {
    if (row.numeric_precision == null) return undefined;
    const v: NonNullable<Attribute['validation']> = { precision: row.numeric_precision };
    if (row.numeric_scale != null) v.scale = row.numeric_scale;
    return v;
  }
  return undefined;
}

/**
 * Normalise an information_schema.columns row for the shared builder.
 * Exported for unit testing without a live DB.
 */
export function normalizePostgresColumn(row: {
  table_name: string;
  column_name: string;
  data_type: string;
  udt_name: string | null;
  is_nullable: string;
  character_maximum_length: number | null;
  numeric_precision: number | null;
  numeric_scale: number | null;
  ordinal_position: number;
}): NormalizedColumn {
  const extra: MetadataEntry[] = [];
  if (row.udt_name) extra.push({ name: 'physical.udtName', value: row.udt_name });
  const validation = buildValidation(row);
  const col: NormalizedColumn = {
    tableName: row.table_name,
    columnName: row.column_name,
    attributeType: mapPostgresType(row.data_type, row.udt_name),
    dbType: buildPostgresDbType(row),
    nullable: row.is_nullable === 'YES',
    ordinal: row.ordinal_position,
    extraMetadata: extra,
  };
  if (validation) col.validation = validation;
  return col;
}

/**
 * Connect to Postgres and return parsed entities. Lifecycle-safe: the pool
 * is ended in `finally` so idle connections don't linger after the request.
 */
export async function introspectPostgres(
  options: IntrospectPostgresOptions,
): Promise<ParseSqlDdlResult> {
  const { connection, ...parseOpts } = options;
  const schema = connection.schema || 'public';

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let pg: any;
  try {
    pg = await import('pg');
  } catch {
    return {
      entities: [],
      errors: ['pg package is not available — install `pg` to use Postgres introspection'],
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Pool = (pg.Pool || pg.default?.Pool) as any;
  const pool = new Pool({
    host: connection.host,
    port: connection.port ?? 5432,
    database: connection.database,
    user: connection.user,
    password: connection.password,
  });

  try {
    const colsRes = await pool.query(
      `SELECT table_name, column_name, data_type, udt_name, is_nullable,
              character_maximum_length, numeric_precision, numeric_scale, ordinal_position
       FROM information_schema.columns
       WHERE table_schema = $1
       ORDER BY table_name, ordinal_position`,
      [schema],
    );

    const pkRes = await pool.query(
      `SELECT kcu.table_name, kcu.column_name
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
       WHERE tc.table_schema = $1 AND tc.constraint_type = 'PRIMARY KEY'`,
      [schema],
    );

    const constraintRes = await pool.query(
      `SELECT tc.table_name,
              tc.constraint_name,
              tc.constraint_type,
              kcu.column_name,
              kcu.ordinal_position AS position,
              cc.check_clause      AS search_condition,
              ccu.table_name       AS ref_table,
              ccu.column_name      AS ref_column,
              kcu.position_in_unique_constraint AS ref_position
       FROM information_schema.table_constraints tc
       LEFT JOIN information_schema.key_column_usage kcu
         ON kcu.constraint_name = tc.constraint_name
        AND kcu.table_schema = tc.table_schema
       LEFT JOIN information_schema.check_constraints cc
         ON cc.constraint_name = tc.constraint_name
        AND cc.constraint_schema = tc.table_schema
       LEFT JOIN information_schema.constraint_column_usage ccu
         ON ccu.constraint_name = tc.constraint_name
        AND ccu.constraint_schema = tc.table_schema
       WHERE tc.table_schema = $1
         AND tc.constraint_type IN ('UNIQUE','CHECK','FOREIGN KEY')`,
      [schema],
    );

    const normalized = (colsRes.rows as any[]).map(normalizePostgresColumn);
    const pks: NormalizedPk[] = (pkRes.rows as any[]).map(r => ({
      tableName: r.table_name,
      columnName: r.column_name,
    }));
    const constraintRows: NormalizedConstraint[] = (constraintRes.rows as any[]).map(r => ({
      tableName: r.table_name,
      constraintName: r.constraint_name,
      type:
        r.constraint_type === 'UNIQUE'
          ? 'U'
          : r.constraint_type === 'CHECK'
            ? 'C'
            : 'R',
      columnName: r.column_name ?? null,
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
      constraintRows,
      'Postgres',
    );
    if (entities.length === 0) {
      return { entities: [], errors: [`No tables found in Postgres schema '${schema}'`] };
    }
    return { entities, errors: [] };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Postgres introspection failed', error);
    return { entities: [], errors: [`Postgres introspection failed: ${message}`] };
  } finally {
    try {
      await pool.end();
    } catch (endErr) {
      logger.error('Failed to end Postgres pool', endErr);
    }
  }
}
