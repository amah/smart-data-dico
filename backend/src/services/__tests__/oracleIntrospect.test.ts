/**
 * Tests for the Oracle introspection helpers (#69 C3).
 *
 * The catalog-row-to-Entity mapping is tested in isolation via the pure
 * `buildEntitiesFromCatalog` export — no live database needed. The
 * `introspectOracle` connection wrapper itself is exercised separately
 * with a mocked `oracledb` module to verify the connection lifecycle and
 * the lazy-import fallback when oracledb is missing.
 */
import { buildEntitiesFromCatalog, buildConstraintsByTable } from '../oracleIntrospect.js';
import { AttributeType } from '../../models/EntitySchema.js';

jest.mock('../../utils/logger');
jest.mock('../../utils/uuid', () => {
  let counter = 0;
  return {
    generateUUID: jest.fn(() => `uuid-${++counter}`),
  };
});

const findMeta = (metadata: any, name: string) =>
  (metadata || []).find((m: any) => m.name === name)?.value;

// ────────────────────────────────────────────────────────────────────────
// buildEntitiesFromCatalog — pure row → Entity mapping
// ────────────────────────────────────────────────────────────────────────

describe('buildEntitiesFromCatalog (#69 C3)', () => {
  it('groups columns by table and produces JPA-style physical metadata', () => {
    const cols = [
      { TABLE_NAME: 'ORDERS', COLUMN_NAME: 'ID', DATA_TYPE: 'NUMBER', DATA_LENGTH: 22, DATA_PRECISION: 10, DATA_SCALE: 0, NULLABLE: 'N', COLUMN_ID: 1 },
      { TABLE_NAME: 'ORDERS', COLUMN_NAME: 'CUSTOMER_ID', DATA_TYPE: 'NUMBER', DATA_LENGTH: 22, DATA_PRECISION: 10, DATA_SCALE: 0, NULLABLE: 'N', COLUMN_ID: 2 },
      { TABLE_NAME: 'ORDERS', COLUMN_NAME: 'TOTAL', DATA_TYPE: 'NUMBER', DATA_LENGTH: 22, DATA_PRECISION: 10, DATA_SCALE: 2, NULLABLE: 'Y', COLUMN_ID: 3 },
    ];
    const pkCols = [
      { TABLE_NAME: 'ORDERS', COLUMN_NAME: 'ID' },
    ];
    const entities = buildEntitiesFromCatalog(cols, pkCols, 'SALES', {});
    expect(entities).toHaveLength(1);

    const entity = entities[0];
    expect(entity.name).toBe('Orders'); // PascalCase from 'orders'
    expect(findMeta(entity.metadata, 'physical.tableName')).toBe('ORDERS');
    expect(findMeta(entity.metadata, 'physical.schema')).toBe('SALES');
    expect(entity.attributes).toHaveLength(3);

    const idAttr = entity.attributes.find(a => a.name === 'id');
    expect(idAttr).toBeDefined();
    expect(idAttr!.primaryKey).toBe(true);
    expect(idAttr!.required).toBe(true);
    expect(idAttr!.type).toBe(AttributeType.NUMBER);
    expect(findMeta(idAttr!.metadata, 'physical.columnName')).toBe('ID');
    expect(findMeta(idAttr!.metadata, 'physical.dbType')).toBe('NUMBER(10)');
    expect(findMeta(idAttr!.metadata, 'physical.nullable')).toBe(false);

    // snake_case → camelCase derivation
    const customerAttr = entity.attributes.find(a => a.name === 'customerId');
    expect(customerAttr).toBeDefined();
    expect(findMeta(customerAttr!.metadata, 'physical.columnName')).toBe('CUSTOMER_ID');

    // NUMBER(10,2) keeps both precision and scale + nullable
    const totalAttr = entity.attributes.find(a => a.name === 'total');
    expect(findMeta(totalAttr!.metadata, 'physical.dbType')).toBe('NUMBER(10,2)');
    expect(findMeta(totalAttr!.metadata, 'physical.nullable')).toBe(true);
    expect(totalAttr!.validation?.precision).toBe(10);
    expect(totalAttr!.validation?.scale).toBe(2);
  });

  it('preserves COLUMN_ID order across tables', () => {
    const cols = [
      // intentionally out of order
      { TABLE_NAME: 'CUSTOMERS', COLUMN_NAME: 'EMAIL', DATA_TYPE: 'VARCHAR2', DATA_LENGTH: 255, DATA_PRECISION: null, DATA_SCALE: null, NULLABLE: 'Y', COLUMN_ID: 2 },
      { TABLE_NAME: 'CUSTOMERS', COLUMN_NAME: 'ID', DATA_TYPE: 'NUMBER', DATA_LENGTH: 22, DATA_PRECISION: 10, DATA_SCALE: 0, NULLABLE: 'N', COLUMN_ID: 1 },
    ];
    const entities = buildEntitiesFromCatalog(cols, [{ TABLE_NAME: 'CUSTOMERS', COLUMN_NAME: 'ID' }], 'SALES', {});
    expect(entities[0].attributes.map(a => a.name)).toEqual(['id', 'email']);
  });

  it('produces multiple entities for multiple tables', () => {
    const cols = [
      { TABLE_NAME: 'CUSTOMERS', COLUMN_NAME: 'ID', DATA_TYPE: 'NUMBER', DATA_LENGTH: 22, DATA_PRECISION: 10, DATA_SCALE: 0, NULLABLE: 'N', COLUMN_ID: 1 },
      { TABLE_NAME: 'ORDERS', COLUMN_NAME: 'ID', DATA_TYPE: 'NUMBER', DATA_LENGTH: 22, DATA_PRECISION: 10, DATA_SCALE: 0, NULLABLE: 'N', COLUMN_ID: 1 },
    ];
    const pkCols = [
      { TABLE_NAME: 'CUSTOMERS', COLUMN_NAME: 'ID' },
      { TABLE_NAME: 'ORDERS', COLUMN_NAME: 'ID' },
    ];
    const entities = buildEntitiesFromCatalog(cols, pkCols, 'APP', {});
    expect(entities.map(e => e.name).sort()).toEqual(['Customers', 'Orders']);
  });

  it('maps Oracle-specific types to logical AttributeType', () => {
    const cols = [
      { TABLE_NAME: 'T', COLUMN_NAME: 'V', DATA_TYPE: 'VARCHAR2', DATA_LENGTH: 100, DATA_PRECISION: null, DATA_SCALE: null, NULLABLE: 'Y', COLUMN_ID: 1 },
      { TABLE_NAME: 'T', COLUMN_NAME: 'NV', DATA_TYPE: 'NVARCHAR2', DATA_LENGTH: 100, DATA_PRECISION: null, DATA_SCALE: null, NULLABLE: 'Y', COLUMN_ID: 2 },
      { TABLE_NAME: 'T', COLUMN_NAME: 'C', DATA_TYPE: 'CLOB', DATA_LENGTH: null, DATA_PRECISION: null, DATA_SCALE: null, NULLABLE: 'Y', COLUMN_ID: 3 },
      { TABLE_NAME: 'T', COLUMN_NAME: 'TS', DATA_TYPE: 'TIMESTAMP(6)', DATA_LENGTH: 11, DATA_PRECISION: null, DATA_SCALE: null, NULLABLE: 'Y', COLUMN_ID: 4 },
      { TABLE_NAME: 'T', COLUMN_NAME: 'BF', DATA_TYPE: 'BINARY_FLOAT', DATA_LENGTH: 4, DATA_PRECISION: null, DATA_SCALE: null, NULLABLE: 'Y', COLUMN_ID: 5 },
      { TABLE_NAME: 'T', COLUMN_NAME: 'BL', DATA_TYPE: 'BLOB', DATA_LENGTH: null, DATA_PRECISION: null, DATA_SCALE: null, NULLABLE: 'Y', COLUMN_ID: 6 },
    ];
    const entities = buildEntitiesFromCatalog(cols, [], 'APP', {});
    const byName = Object.fromEntries(entities[0].attributes.map(a => [a.name, a]));
    expect(byName.v.type).toBe(AttributeType.STRING);
    expect(byName.nv.type).toBe(AttributeType.STRING);
    expect(byName.c.type).toBe(AttributeType.STRING);
    expect(byName.ts.type).toBe(AttributeType.TIMESTAMP);
    expect(byName.bf.type).toBe(AttributeType.NUMBER);
    expect(byName.bl.type).toBe(AttributeType.STRING);
  });

  it('builds VARCHAR2(n) dbType + maxLength constraint', () => {
    const cols = [
      { TABLE_NAME: 'T', COLUMN_NAME: 'NAME', DATA_TYPE: 'VARCHAR2', DATA_LENGTH: 200, DATA_PRECISION: null, DATA_SCALE: null, NULLABLE: 'N', COLUMN_ID: 1 },
    ];
    const entities = buildEntitiesFromCatalog(cols, [], 'APP', {});
    const attr = entities[0].attributes[0];
    expect(findMeta(attr.metadata, 'physical.dbType')).toBe('VARCHAR2(200)');
    expect(attr.validation?.maxLength).toBe(200);
  });

  it('handles bare NUMBER (no precision)', () => {
    const cols = [
      { TABLE_NAME: 'T', COLUMN_NAME: 'X', DATA_TYPE: 'NUMBER', DATA_LENGTH: 22, DATA_PRECISION: null, DATA_SCALE: null, NULLABLE: 'Y', COLUMN_ID: 1 },
    ];
    const entities = buildEntitiesFromCatalog(cols, [], 'APP', {});
    expect(findMeta(entities[0].attributes[0].metadata, 'physical.dbType')).toBe('NUMBER');
  });

  it('treats NULLABLE=Y as required=false', () => {
    const cols = [
      { TABLE_NAME: 'T', COLUMN_NAME: 'NOTES', DATA_TYPE: 'VARCHAR2', DATA_LENGTH: 4000, DATA_PRECISION: null, DATA_SCALE: null, NULLABLE: 'Y', COLUMN_ID: 1 },
    ];
    const entities = buildEntitiesFromCatalog(cols, [], 'APP', {});
    expect(entities[0].attributes[0].required).toBe(false);
    expect(findMeta(entities[0].attributes[0].metadata, 'physical.nullable')).toBe(true);
  });

  it('marks composite primary keys', () => {
    const cols = [
      { TABLE_NAME: 'ORDER_ITEMS', COLUMN_NAME: 'ORDER_ID', DATA_TYPE: 'NUMBER', DATA_LENGTH: 22, DATA_PRECISION: 10, DATA_SCALE: 0, NULLABLE: 'N', COLUMN_ID: 1 },
      { TABLE_NAME: 'ORDER_ITEMS', COLUMN_NAME: 'LINE_NO', DATA_TYPE: 'NUMBER', DATA_LENGTH: 22, DATA_PRECISION: 5, DATA_SCALE: 0, NULLABLE: 'N', COLUMN_ID: 2 },
      { TABLE_NAME: 'ORDER_ITEMS', COLUMN_NAME: 'QTY', DATA_TYPE: 'NUMBER', DATA_LENGTH: 22, DATA_PRECISION: 10, DATA_SCALE: 0, NULLABLE: 'N', COLUMN_ID: 3 },
    ];
    const pkCols = [
      { TABLE_NAME: 'ORDER_ITEMS', COLUMN_NAME: 'ORDER_ID' },
      { TABLE_NAME: 'ORDER_ITEMS', COLUMN_NAME: 'LINE_NO' },
    ];
    const entities = buildEntitiesFromCatalog(cols, pkCols, 'APP', {});
    const byName = Object.fromEntries(entities[0].attributes.map(a => [a.name, a]));
    expect(byName.orderId.primaryKey).toBe(true);
    expect(byName.lineNo.primaryKey).toBe(true);
    expect(byName.qty.primaryKey).toBeFalsy();
  });

  it('strips configured prefix before deriving display name; physical kept verbatim', () => {
    const cols = [
      { TABLE_NAME: 'TBL_ORDERS', COLUMN_NAME: 'COL_ID', DATA_TYPE: 'NUMBER', DATA_LENGTH: 22, DATA_PRECISION: 10, DATA_SCALE: 0, NULLABLE: 'N', COLUMN_ID: 1 },
    ];
    const entities = buildEntitiesFromCatalog(cols, [], 'APP', {
      stripPrefixes: ['tbl_', 'col_'],
    });
    expect(entities[0].name).toBe('Orders');
    expect(findMeta(entities[0].metadata, 'physical.tableName')).toBe('TBL_ORDERS');
    expect(entities[0].attributes[0].name).toBe('id');
    expect(findMeta(entities[0].attributes[0].metadata, 'physical.columnName')).toBe('COL_ID');
  });

  it('strips configured suffix before deriving display name', () => {
    const cols = [
      { TABLE_NAME: 'ORDERS_V2', COLUMN_NAME: 'ID', DATA_TYPE: 'NUMBER', DATA_LENGTH: 22, DATA_PRECISION: 10, DATA_SCALE: 0, NULLABLE: 'N', COLUMN_ID: 1 },
    ];
    const entities = buildEntitiesFromCatalog(cols, [], 'APP', {
      stripSuffixes: ['_v2'],
    });
    expect(entities[0].name).toBe('Orders');
    expect(findMeta(entities[0].metadata, 'physical.tableName')).toBe('ORDERS_V2');
  });

  it('returns an empty list when there are no rows', () => {
    expect(buildEntitiesFromCatalog([], [], 'APP', {})).toEqual([]);
  });

  it('attaches physical constraints to the right table when constraint rows are provided (#85 R3)', () => {
    const cols = [
      { TABLE_NAME: 'ORDERS', COLUMN_NAME: 'ID', DATA_TYPE: 'NUMBER', DATA_LENGTH: 22, DATA_PRECISION: 10, DATA_SCALE: 0, NULLABLE: 'N', COLUMN_ID: 1 },
      { TABLE_NAME: 'ORDERS', COLUMN_NAME: 'ORDER_NUMBER', DATA_TYPE: 'VARCHAR2', DATA_LENGTH: 20, DATA_PRECISION: null, DATA_SCALE: null, NULLABLE: 'N', COLUMN_ID: 2 },
    ];
    const constraintRows = [
      { TABLE_NAME: 'ORDERS', CONSTRAINT_NAME: 'UQ_ORDERS_NUMBER', CONSTRAINT_TYPE: 'U' as const, COLUMN_NAME: 'ORDER_NUMBER', POSITION: 1, SEARCH_CONDITION: null, R_TABLE_NAME: null, R_COLUMN_NAME: null, R_POSITION: null },
    ];
    const entities = buildEntitiesFromCatalog(cols, [{ TABLE_NAME: 'ORDERS', COLUMN_NAME: 'ID' }], 'APP', {}, constraintRows);
    expect(entities[0].constraints).toEqual([
      { kind: 'unique', name: 'UQ_ORDERS_NUMBER', columns: ['ORDER_NUMBER'] },
    ]);
  });
});

// ────────────────────────────────────────────────────────────────────────
// buildConstraintsByTable — pure constraint-row → PhysicalConstraint mapping (#85 R3)
// ────────────────────────────────────────────────────────────────────────

describe('buildConstraintsByTable (#85 R3)', () => {
  const row = (overrides: any) => ({
    TABLE_NAME: 'T',
    CONSTRAINT_NAME: 'C',
    CONSTRAINT_TYPE: 'U',
    COLUMN_NAME: null,
    POSITION: null,
    SEARCH_CONDITION: null,
    R_TABLE_NAME: null,
    R_COLUMN_NAME: null,
    R_POSITION: null,
    ...overrides,
  });

  it('maps a single-column UNIQUE constraint', () => {
    const out = buildConstraintsByTable([
      row({ CONSTRAINT_NAME: 'UQ_EMAIL', CONSTRAINT_TYPE: 'U', COLUMN_NAME: 'EMAIL', POSITION: 1 }),
    ]);
    expect(out.get('T')).toEqual([
      { kind: 'unique', name: 'UQ_EMAIL', columns: ['EMAIL'] },
    ]);
  });

  it('groups multi-column UNIQUE rows in POSITION order', () => {
    const out = buildConstraintsByTable([
      row({ CONSTRAINT_NAME: 'UQ_OI', CONSTRAINT_TYPE: 'U', COLUMN_NAME: 'LINE_NO', POSITION: 2 }),
      row({ CONSTRAINT_NAME: 'UQ_OI', CONSTRAINT_TYPE: 'U', COLUMN_NAME: 'ORDER_ID', POSITION: 1 }),
    ]);
    expect(out.get('T')![0].columns).toEqual(['ORDER_ID', 'LINE_NO']);
  });

  it('maps a CHECK constraint with its expression', () => {
    const out = buildConstraintsByTable([
      row({
        CONSTRAINT_NAME: 'CHK_BAL',
        CONSTRAINT_TYPE: 'C',
        COLUMN_NAME: 'BALANCE',
        POSITION: 1,
        SEARCH_CONDITION: 'balance >= 0',
      }),
    ]);
    expect(out.get('T')).toEqual([
      { kind: 'check', name: 'CHK_BAL', expression: 'balance >= 0' },
    ]);
  });

  it('skips auto-generated NOT NULL CHECK constraints', () => {
    const out = buildConstraintsByTable([
      row({
        CONSTRAINT_NAME: 'SYS_C001',
        CONSTRAINT_TYPE: 'C',
        COLUMN_NAME: 'EMAIL',
        POSITION: 1,
        SEARCH_CONDITION: '"EMAIL" IS NOT NULL',
      }),
    ]);
    expect(out.size).toBe(0);
  });

  it('maps a single-column FOREIGN KEY with a reference', () => {
    const out = buildConstraintsByTable([
      row({
        CONSTRAINT_NAME: 'FK_ORDERS_CUSTOMER',
        CONSTRAINT_TYPE: 'R',
        COLUMN_NAME: 'CUSTOMER_ID',
        POSITION: 1,
        R_TABLE_NAME: 'CUSTOMERS',
        R_COLUMN_NAME: 'ID',
        R_POSITION: 1,
      }),
    ]);
    expect(out.get('T')).toEqual([
      {
        kind: 'foreignKey',
        name: 'FK_ORDERS_CUSTOMER',
        columns: ['CUSTOMER_ID'],
        references: { table: 'CUSTOMERS', columns: ['ID'] },
      },
    ]);
  });

  it('maps a composite FOREIGN KEY with two pairs of columns', () => {
    const out = buildConstraintsByTable([
      row({
        CONSTRAINT_NAME: 'FK_OI',
        CONSTRAINT_TYPE: 'R',
        COLUMN_NAME: 'ORDER_ID',
        POSITION: 1,
        R_TABLE_NAME: 'ORDERS',
        R_COLUMN_NAME: 'ID',
        R_POSITION: 1,
      }),
      row({
        CONSTRAINT_NAME: 'FK_OI',
        CONSTRAINT_TYPE: 'R',
        COLUMN_NAME: 'LINE_NO',
        POSITION: 2,
        R_TABLE_NAME: 'ORDERS',
        R_COLUMN_NAME: 'LINE_NO',
        R_POSITION: 2,
      }),
    ]);
    expect(out.get('T')![0]).toEqual({
      kind: 'foreignKey',
      name: 'FK_OI',
      columns: ['ORDER_ID', 'LINE_NO'],
      references: { table: 'ORDERS', columns: ['ID', 'LINE_NO'] },
    });
  });

  it('returns an empty map when given no rows', () => {
    expect(buildConstraintsByTable([]).size).toBe(0);
  });
});

// ────────────────────────────────────────────────────────────────────────
// introspectOracle — connection lifecycle + error handling
// ────────────────────────────────────────────────────────────────────────

describe('introspectOracle (#69 C3) — connection lifecycle', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it('opens, queries, and closes a connection on the happy path', async () => {
    const mockClose = jest.fn().mockResolvedValue(undefined);
    const mockExecute = jest.fn()
      .mockResolvedValueOnce({
        rows: [
          { TABLE_NAME: 'ORDERS', COLUMN_NAME: 'ID', DATA_TYPE: 'NUMBER', DATA_LENGTH: 22, DATA_PRECISION: 10, DATA_SCALE: 0, NULLABLE: 'N', COLUMN_ID: 1 },
        ],
      })
      .mockResolvedValueOnce({
        rows: [{ TABLE_NAME: 'ORDERS', COLUMN_NAME: 'ID' }],
      })
      // Third query (#85 R3): physical constraints (U/C/R)
      .mockResolvedValueOnce({ rows: [] });
    const mockGetConnection = jest.fn().mockResolvedValue({ execute: mockExecute, close: mockClose });

    jest.doMock('oracledb', () => ({
      __esModule: true,
      default: {
        getConnection: mockGetConnection,
        OUT_FORMAT_OBJECT: 4002,
      },
    }));

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { introspectOracle } = require('../oracleIntrospect');
    const result = await introspectOracle({
      connection: { user: 'sales', password: 'pw', connectString: 'host:1521/svc' },
    });

    expect(mockGetConnection).toHaveBeenCalledWith({
      user: 'sales',
      password: 'pw',
      connectString: 'host:1521/svc',
    });
    expect(mockExecute).toHaveBeenCalledTimes(3);
    expect(mockClose).toHaveBeenCalledTimes(1);
    expect(result.entities).toHaveLength(1);
    expect(result.entities[0].name).toBe('Orders');
  });

  it('uses connection.user as the default owner (upper-cased)', async () => {
    const mockClose = jest.fn().mockResolvedValue(undefined);
    const mockExecute = jest.fn()
      .mockResolvedValue({ rows: [] });
    const mockGetConnection = jest.fn().mockResolvedValue({ execute: mockExecute, close: mockClose });

    jest.doMock('oracledb', () => ({
      __esModule: true,
      default: { getConnection: mockGetConnection, OUT_FORMAT_OBJECT: 4002 },
    }));

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { introspectOracle } = require('../oracleIntrospect');
    await introspectOracle({
      connection: { user: 'app_user', password: 'pw', connectString: 'host:1521/svc' },
    });

    // Both queries should bind owner='APP_USER'
    const firstCallBinds = mockExecute.mock.calls[0][1];
    expect(firstCallBinds).toEqual({ owner: 'APP_USER' });
  });

  it('returns an error result and still closes the connection on query failure', async () => {
    const mockClose = jest.fn().mockResolvedValue(undefined);
    const mockExecute = jest.fn().mockRejectedValue(new Error('ORA-00942: table or view does not exist'));
    const mockGetConnection = jest.fn().mockResolvedValue({ execute: mockExecute, close: mockClose });

    jest.doMock('oracledb', () => ({
      __esModule: true,
      default: { getConnection: mockGetConnection, OUT_FORMAT_OBJECT: 4002 },
    }));

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { introspectOracle } = require('../oracleIntrospect');
    const result = await introspectOracle({
      connection: { user: 'sales', password: 'pw', connectString: 'host:1521/svc' },
    });
    expect(result.entities).toEqual([]);
    expect(result.errors[0]).toContain('ORA-00942');
    expect(mockClose).toHaveBeenCalledTimes(1);
  });

  it('returns an error when no tables are found in the schema', async () => {
    const mockClose = jest.fn().mockResolvedValue(undefined);
    const mockExecute = jest.fn().mockResolvedValue({ rows: [] });
    const mockGetConnection = jest.fn().mockResolvedValue({ execute: mockExecute, close: mockClose });

    jest.doMock('oracledb', () => ({
      __esModule: true,
      default: { getConnection: mockGetConnection, OUT_FORMAT_OBJECT: 4002 },
    }));

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { introspectOracle } = require('../oracleIntrospect');
    const result = await introspectOracle({
      connection: { user: 'sales', password: 'pw', connectString: 'host:1521/svc' },
    });
    expect(result.entities).toEqual([]);
    expect(result.errors[0]).toContain("No tables found");
  });
});
