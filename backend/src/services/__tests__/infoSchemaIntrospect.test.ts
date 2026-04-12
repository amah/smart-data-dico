/**
 * Unit tests for the shared information_schema introspection core and the
 * three dialect providers that sit on top of it (#79/#80/#81).
 *
 * Pure functions (normalize / buildDbType / mapType) are tested directly.
 * The connection wrappers are exercised with mocked `pg` / `mysql2/promise` /
 * `mssql` modules to verify query dispatch and lifecycle handling without a
 * live database.
 */
import { AttributeType } from '../../models/EntitySchema.js';
import {
  buildEntitiesFromNormalized,
  buildConstraintsByTable,
  NormalizedColumn,
} from '../infoSchemaIntrospect.js';
import {
  normalizePostgresColumn,
  mapPostgresType,
  buildPostgresDbType,
} from '../postgresIntrospect.js';
import {
  normalizeMysqlColumn,
  mapMysqlType,
  parseEnumValues,
} from '../mysqlIntrospect.js';
import {
  normalizeMssqlColumn,
  mapMssqlType,
  buildMssqlDbType,
} from '../mssqlIntrospect.js';

jest.mock('../../utils/logger');
jest.mock('../../utils/uuid', () => {
  let counter = 0;
  return { generateUUID: jest.fn(() => `uuid-${++counter}`) };
});

const findMeta = (metadata: any, name: string) =>
  (metadata || []).find((m: any) => m.name === name)?.value;

// ────────────────────────────────────────────────────────────────────────
// Shared builder
// ────────────────────────────────────────────────────────────────────────

describe('buildEntitiesFromNormalized (shared core, #79/#80/#81)', () => {
  const baseCol = (overrides: Partial<NormalizedColumn> = {}): NormalizedColumn => ({
    tableName: 'orders',
    columnName: 'id',
    attributeType: AttributeType.INTEGER,
    dbType: 'INT',
    nullable: false,
    ordinal: 1,
    ...overrides,
  });

  it('groups columns by table and preserves ordinal order', () => {
    const cols = [
      baseCol({ tableName: 'orders', columnName: 'id', ordinal: 1 }),
      baseCol({ tableName: 'orders', columnName: 'customer_id', ordinal: 3 }),
      baseCol({ tableName: 'orders', columnName: 'created_at', ordinal: 2, attributeType: AttributeType.TIMESTAMP, dbType: 'TIMESTAMP' }),
    ];
    const entities = buildEntitiesFromNormalized(cols, [{ tableName: 'orders', columnName: 'id' }], 'public', {}, [], 'Postgres');
    expect(entities).toHaveLength(1);
    expect(entities[0].attributes.map(a => a.name)).toEqual(['id', 'createdAt', 'customerId']);
    expect(entities[0].name).toBe('Orders');
    expect(findMeta(entities[0].metadata, 'physical.schema')).toBe('public');
  });

  it('marks required=true for PK columns and writes physical metadata', () => {
    const cols = [baseCol({ nullable: true })];
    const entities = buildEntitiesFromNormalized(cols, [{ tableName: 'orders', columnName: 'id' }], 'public', {});
    const attr = entities[0].attributes[0];
    expect(attr.primaryKey).toBe(true);
    expect(attr.required).toBe(true); // PK overrides nullable
    expect(findMeta(attr.metadata, 'physical.columnName')).toBe('id');
    expect(findMeta(attr.metadata, 'physical.dbType')).toBe('INT');
    expect(findMeta(attr.metadata, 'physical.nullable')).toBe(true);
  });

  it('merges extraMetadata onto the attribute (dialect-specific physical fields)', () => {
    const cols = [
      baseCol({
        extraMetadata: [{ name: 'physical.identity', value: true }],
      }),
    ];
    const entities = buildEntitiesFromNormalized(cols, [], 'dbo', {});
    expect(findMeta(entities[0].attributes[0].metadata, 'physical.identity')).toBe(true);
  });

  it('attaches per-table constraints produced by buildConstraintsByTable', () => {
    const cols = [baseCol({ columnName: 'email' })];
    const entities = buildEntitiesFromNormalized(
      cols,
      [],
      'public',
      {},
      [
        {
          tableName: 'orders',
          constraintName: 'uq_orders_email',
          type: 'U',
          columnName: 'email',
          position: 1,
          searchCondition: null,
          refTable: null,
          refColumn: null,
          refPosition: null,
        },
      ],
    );
    expect(entities[0].constraints).toEqual([
      { kind: 'unique', name: 'uq_orders_email', columns: ['email'] },
    ]);
  });

  it('skips auto-generated NOT NULL CHECKs in buildConstraintsByTable', () => {
    const out = buildConstraintsByTable([
      {
        tableName: 't',
        constraintName: 'nn',
        type: 'C',
        columnName: null,
        position: null,
        searchCondition: '"name" IS NOT NULL',
        refTable: null,
        refColumn: null,
        refPosition: null,
      },
    ]);
    expect(out.size).toBe(0);
  });
});

// ────────────────────────────────────────────────────────────────────────
// Postgres (#79)
// ────────────────────────────────────────────────────────────────────────

describe('Postgres provider (#79) — pure helpers', () => {
  it('maps Postgres types to logical AttributeType', () => {
    expect(mapPostgresType('uuid', 'uuid')).toBe(AttributeType.UUID);
    expect(mapPostgresType('jsonb', 'jsonb')).toBe(AttributeType.OBJECT);
    expect(mapPostgresType('json', 'json')).toBe(AttributeType.OBJECT);
    expect(mapPostgresType('timestamp with time zone', 'timestamptz')).toBe(AttributeType.TIMESTAMP);
    expect(mapPostgresType('integer', 'int4')).toBe(AttributeType.INTEGER);
    expect(mapPostgresType('bigint', 'int8')).toBe(AttributeType.INTEGER);
    expect(mapPostgresType('numeric', 'numeric')).toBe(AttributeType.NUMBER);
    expect(mapPostgresType('boolean', 'bool')).toBe(AttributeType.BOOLEAN);
    expect(mapPostgresType('date', 'date')).toBe(AttributeType.DATE);
    expect(mapPostgresType('character varying', 'varchar')).toBe(AttributeType.STRING);
  });

  it('renders VARCHAR(n) and NUMERIC(p,s) for physical.dbType', () => {
    expect(
      buildPostgresDbType({
        data_type: 'character varying',
        udt_name: 'varchar',
        character_maximum_length: 255,
        numeric_precision: null,
        numeric_scale: null,
      }),
    ).toBe('VARCHAR(255)');
    expect(
      buildPostgresDbType({
        data_type: 'numeric',
        udt_name: 'numeric',
        character_maximum_length: null,
        numeric_precision: 10,
        numeric_scale: 2,
      }),
    ).toBe('NUMERIC(10,2)');
    expect(
      buildPostgresDbType({
        data_type: 'jsonb',
        udt_name: 'jsonb',
        character_maximum_length: null,
        numeric_precision: null,
        numeric_scale: null,
      }),
    ).toBe('JSONB');
  });

  it('normalizePostgresColumn produces VARCHAR maxLength validation + nullable flag', () => {
    const col = normalizePostgresColumn({
      table_name: 'customers',
      column_name: 'email',
      data_type: 'character varying',
      udt_name: 'varchar',
      is_nullable: 'NO',
      character_maximum_length: 255,
      numeric_precision: null,
      numeric_scale: null,
      ordinal_position: 2,
    });
    expect(col.attributeType).toBe(AttributeType.STRING);
    expect(col.dbType).toBe('VARCHAR(255)');
    expect(col.nullable).toBe(false);
    expect(col.validation?.maxLength).toBe(255);
  });

  it('normalizePostgresColumn maps uuid → UUID type and records udtName metadata', () => {
    const col = normalizePostgresColumn({
      table_name: 'users',
      column_name: 'id',
      data_type: 'uuid',
      udt_name: 'uuid',
      is_nullable: 'NO',
      character_maximum_length: null,
      numeric_precision: null,
      numeric_scale: null,
      ordinal_position: 1,
    });
    expect(col.attributeType).toBe(AttributeType.UUID);
    expect(col.dbType).toBe('UUID');
    expect(col.extraMetadata?.find(m => m.name === 'physical.udtName')?.value).toBe('uuid');
  });
});

describe('Postgres provider (#79) — connection lifecycle', () => {
  beforeEach(() => jest.resetModules());

  it('queries information_schema and ends the pool on the happy path', async () => {
    const mockEnd = jest.fn().mockResolvedValue(undefined);
    const mockQuery = jest.fn()
      // columns
      .mockResolvedValueOnce({
        rows: [
          {
            table_name: 'orders',
            column_name: 'id',
            data_type: 'uuid',
            udt_name: 'uuid',
            is_nullable: 'NO',
            character_maximum_length: null,
            numeric_precision: null,
            numeric_scale: null,
            ordinal_position: 1,
          },
        ],
      })
      // pks
      .mockResolvedValueOnce({ rows: [{ table_name: 'orders', column_name: 'id' }] })
      // constraints
      .mockResolvedValueOnce({ rows: [] });
    const mockPool = jest.fn(() => ({ query: mockQuery, end: mockEnd }));

    jest.doMock(
      'pg',
      () => ({ __esModule: true, Pool: mockPool, default: { Pool: mockPool } }),
      { virtual: true },
    );

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { introspectPostgres } = require('../postgresIntrospect');
    const result = await introspectPostgres({
      connection: { host: 'localhost', database: 'sales', user: 'app', password: 'pw' },
    });

    expect(mockPool).toHaveBeenCalledWith({
      host: 'localhost',
      port: 5432,
      database: 'sales',
      user: 'app',
      password: 'pw',
    });
    expect(mockQuery).toHaveBeenCalledTimes(3);
    // First query binds schema 'public' by default
    expect(mockQuery.mock.calls[0][1]).toEqual(['public']);
    expect(mockEnd).toHaveBeenCalledTimes(1);
    expect(result.entities).toHaveLength(1);
    expect(result.entities[0].name).toBe('Orders');
    expect(result.entities[0].attributes[0].type).toBe(AttributeType.UUID);
  });

  it('returns an error and still ends the pool on query failure', async () => {
    const mockEnd = jest.fn().mockResolvedValue(undefined);
    const mockQuery = jest.fn().mockRejectedValue(new Error('connection refused'));
    const mockPool = jest.fn(() => ({ query: mockQuery, end: mockEnd }));
    jest.doMock(
      'pg',
      () => ({ __esModule: true, Pool: mockPool, default: { Pool: mockPool } }),
      { virtual: true },
    );

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { introspectPostgres } = require('../postgresIntrospect');
    const result = await introspectPostgres({
      connection: { host: 'localhost', database: 'sales', user: 'app', password: 'pw' },
    });
    expect(result.entities).toEqual([]);
    expect(result.errors[0]).toContain('connection refused');
    expect(mockEnd).toHaveBeenCalledTimes(1);
  });
});

// ────────────────────────────────────────────────────────────────────────
// MySQL (#80)
// ────────────────────────────────────────────────────────────────────────

describe('MySQL provider (#80) — pure helpers', () => {
  it('parseEnumValues extracts enum values from COLUMN_TYPE', () => {
    expect(parseEnumValues("enum('pending','shipped','done')")).toEqual(['pending', 'shipped', 'done']);
    expect(parseEnumValues("enum('it''s','ok')")).toEqual(["it's", 'ok']);
    expect(parseEnumValues('varchar(255)')).toBeNull();
  });

  it('mapMysqlType returns ENUM, BOOLEAN for tinyint(1), INTEGER for int', () => {
    expect(mapMysqlType('int', 'int(11)')).toBe(AttributeType.INTEGER);
    expect(mapMysqlType('tinyint', 'tinyint(1)')).toBe(AttributeType.BOOLEAN);
    expect(mapMysqlType('tinyint', 'tinyint(4)')).toBe(AttributeType.INTEGER);
    expect(mapMysqlType('enum', "enum('a','b')")).toBe(AttributeType.ENUM);
    expect(mapMysqlType('json', 'json')).toBe(AttributeType.OBJECT);
    expect(mapMysqlType('datetime', 'datetime')).toBe(AttributeType.DATETIME);
    expect(mapMysqlType('timestamp', 'timestamp')).toBe(AttributeType.TIMESTAMP);
  });

  it('normalizeMysqlColumn produces enumValues validation for enum columns', () => {
    const col = normalizeMysqlColumn({
      TABLE_NAME: 'orders',
      COLUMN_NAME: 'status',
      DATA_TYPE: 'enum',
      COLUMN_TYPE: "enum('pending','shipped','delivered')",
      IS_NULLABLE: 'NO',
      CHARACTER_MAXIMUM_LENGTH: null,
      NUMERIC_PRECISION: null,
      NUMERIC_SCALE: null,
      ORDINAL_POSITION: 5,
      EXTRA: null,
    });
    expect(col.attributeType).toBe(AttributeType.ENUM);
    expect(col.validation?.enumValues).toEqual(['pending', 'shipped', 'delivered']);
  });

  it('normalizeMysqlColumn records auto_increment as physical.autoIncrement metadata', () => {
    const col = normalizeMysqlColumn({
      TABLE_NAME: 'orders',
      COLUMN_NAME: 'id',
      DATA_TYPE: 'int',
      COLUMN_TYPE: 'int(11) unsigned',
      IS_NULLABLE: 'NO',
      CHARACTER_MAXIMUM_LENGTH: null,
      NUMERIC_PRECISION: 10,
      NUMERIC_SCALE: 0,
      ORDINAL_POSITION: 1,
      EXTRA: 'auto_increment',
    });
    expect(col.extraMetadata?.find(m => m.name === 'physical.autoIncrement')?.value).toBe(true);
  });

  it('normalizeMysqlColumn maps json → OBJECT', () => {
    const col = normalizeMysqlColumn({
      TABLE_NAME: 'orders',
      COLUMN_NAME: 'payload',
      DATA_TYPE: 'json',
      COLUMN_TYPE: 'json',
      IS_NULLABLE: 'YES',
      CHARACTER_MAXIMUM_LENGTH: null,
      NUMERIC_PRECISION: null,
      NUMERIC_SCALE: null,
      ORDINAL_POSITION: 4,
      EXTRA: null,
    });
    expect(col.attributeType).toBe(AttributeType.OBJECT);
  });
});

describe('MySQL provider (#80) — connection lifecycle', () => {
  beforeEach(() => jest.resetModules());

  it('queries information_schema and ends the connection on success', async () => {
    const mockEnd = jest.fn().mockResolvedValue(undefined);
    const mockExecute = jest.fn()
      .mockResolvedValueOnce([[{
        TABLE_NAME: 'orders',
        COLUMN_NAME: 'id',
        DATA_TYPE: 'int',
        COLUMN_TYPE: 'int(11)',
        IS_NULLABLE: 'NO',
        CHARACTER_MAXIMUM_LENGTH: null,
        NUMERIC_PRECISION: 10,
        NUMERIC_SCALE: 0,
        ORDINAL_POSITION: 1,
        EXTRA: 'auto_increment',
      }]])
      .mockResolvedValueOnce([[{ TABLE_NAME: 'orders', COLUMN_NAME: 'id' }]])
      .mockResolvedValueOnce([[]]);
    const mockCreate = jest.fn().mockResolvedValue({ execute: mockExecute, end: mockEnd });

    jest.doMock(
      'mysql2/promise',
      () => ({
        __esModule: true,
        createConnection: mockCreate,
        default: { createConnection: mockCreate },
      }),
      { virtual: true },
    );

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { introspectMysql } = require('../mysqlIntrospect');
    const result = await introspectMysql({
      connection: { host: 'localhost', database: 'sales', user: 'app', password: 'pw' },
    });

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ host: 'localhost', port: 3306, database: 'sales' }),
    );
    expect(mockExecute).toHaveBeenCalledTimes(3);
    expect(mockEnd).toHaveBeenCalledTimes(1);
    expect(result.entities).toHaveLength(1);
    expect(result.entities[0].attributes[0].primaryKey).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────────
// MSSQL (#81)
// ────────────────────────────────────────────────────────────────────────

describe('MSSQL provider (#81) — pure helpers', () => {
  it('mapMssqlType maps uniqueidentifier → UUID and bit → BOOLEAN', () => {
    expect(mapMssqlType('uniqueidentifier')).toBe(AttributeType.UUID);
    expect(mapMssqlType('bit')).toBe(AttributeType.BOOLEAN);
    expect(mapMssqlType('int')).toBe(AttributeType.INTEGER);
    expect(mapMssqlType('datetime2')).toBe(AttributeType.DATETIME);
    expect(mapMssqlType('datetimeoffset')).toBe(AttributeType.TIMESTAMP);
    expect(mapMssqlType('nvarchar')).toBe(AttributeType.STRING);
  });

  it('buildMssqlDbType renders NVARCHAR(MAX) when CHARACTER_MAXIMUM_LENGTH is -1', () => {
    expect(
      buildMssqlDbType({
        DATA_TYPE: 'nvarchar',
        CHARACTER_MAXIMUM_LENGTH: -1,
        NUMERIC_PRECISION: null,
        NUMERIC_SCALE: null,
      }),
    ).toBe('NVARCHAR(MAX)');
    expect(
      buildMssqlDbType({
        DATA_TYPE: 'nvarchar',
        CHARACTER_MAXIMUM_LENGTH: 200,
        NUMERIC_PRECISION: null,
        NUMERIC_SCALE: null,
      }),
    ).toBe('NVARCHAR(200)');
    expect(
      buildMssqlDbType({
        DATA_TYPE: 'decimal',
        CHARACTER_MAXIMUM_LENGTH: null,
        NUMERIC_PRECISION: 18,
        NUMERIC_SCALE: 4,
      }),
    ).toBe('DECIMAL(18,4)');
  });

  it('normalizeMssqlColumn flags IDENTITY columns from the identity set', () => {
    const identity = new Set(['orders.id']);
    const col = normalizeMssqlColumn(
      {
        TABLE_NAME: 'orders',
        COLUMN_NAME: 'id',
        DATA_TYPE: 'uniqueidentifier',
        IS_NULLABLE: 'NO',
        CHARACTER_MAXIMUM_LENGTH: null,
        NUMERIC_PRECISION: null,
        NUMERIC_SCALE: null,
        ORDINAL_POSITION: 1,
      },
      identity,
    );
    expect(col.attributeType).toBe(AttributeType.UUID);
    expect(col.extraMetadata?.find(m => m.name === 'physical.identity')?.value).toBe(true);
  });

  it('normalizeMssqlColumn skips maxLength validation for NVARCHAR(MAX)', () => {
    const col = normalizeMssqlColumn(
      {
        TABLE_NAME: 'orders',
        COLUMN_NAME: 'notes',
        DATA_TYPE: 'nvarchar',
        IS_NULLABLE: 'YES',
        CHARACTER_MAXIMUM_LENGTH: -1,
        NUMERIC_PRECISION: null,
        NUMERIC_SCALE: null,
        ORDINAL_POSITION: 2,
      },
      new Set(),
    );
    expect(col.validation).toBeUndefined();
    expect(col.dbType).toBe('NVARCHAR(MAX)');
  });
});

describe('MSSQL provider (#81) — connection lifecycle', () => {
  beforeEach(() => jest.resetModules());

  it('dispatches INFORMATION_SCHEMA queries and closes the pool on success', async () => {
    const mockClose = jest.fn().mockResolvedValue(undefined);
    const recordsets = [
      // columns
      [{
        TABLE_NAME: 'orders',
        COLUMN_NAME: 'id',
        DATA_TYPE: 'uniqueidentifier',
        IS_NULLABLE: 'NO',
        CHARACTER_MAXIMUM_LENGTH: null,
        NUMERIC_PRECISION: null,
        NUMERIC_SCALE: null,
        ORDINAL_POSITION: 1,
      }],
      // pks
      [{ TABLE_NAME: 'orders', COLUMN_NAME: 'id' }],
      // constraints (U/C/FK)
      [],
      // ref lookup
      [],
      // identity columns
      [{ TABLE_NAME: 'orders', COLUMN_NAME: 'id' }],
    ];
    const query = jest.fn().mockImplementation(() =>
      Promise.resolve({ recordset: recordsets.shift() }),
    );
    const request = {
      input: jest.fn().mockReturnThis(),
      query,
    };
    const pool = { request: jest.fn(() => request), close: mockClose };
    const mockConnect = jest.fn().mockResolvedValue(pool);

    jest.doMock(
      'mssql',
      () => ({
        __esModule: true,
        default: { connect: mockConnect, NVarChar: 'NVARCHAR' },
      }),
      { virtual: true },
    );

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { introspectMssql } = require('../mssqlIntrospect');
    const result = await introspectMssql({
      connection: {
        server: 'db.example.com',
        database: 'sales',
        user: 'app',
        password: 'pw',
        schema: 'sales',
      },
    });

    expect(mockConnect).toHaveBeenCalledWith(
      expect.objectContaining({
        server: 'db.example.com',
        port: 1433,
        database: 'sales',
      }),
    );
    // 5 queries: columns, pks, constraints, ref lookup, identity
    expect(query).toHaveBeenCalledTimes(5);
    expect(mockClose).toHaveBeenCalledTimes(1);
    expect(result.entities).toHaveLength(1);
    const attr = result.entities[0].attributes[0];
    expect(attr.type).toBe(AttributeType.UUID);
    expect(attr.metadata?.find((m: any) => m.name === 'physical.identity')?.value).toBe(true);
  });

  it('returns a lazy-import error when the mssql package is missing', async () => {
    jest.doMock(
      'mssql',
      () => {
        throw new Error('Cannot find module');
      },
      { virtual: true },
    );

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { introspectMssql } = require('../mssqlIntrospect');
    const result = await introspectMssql({
      connection: {
        server: 'db.example.com',
        database: 'sales',
        user: 'app',
        password: 'pw',
      },
    });
    expect(result.entities).toEqual([]);
    expect(result.errors[0]).toContain('mssql package is not available');
  });
});
