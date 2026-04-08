/**
 * Tests for the SQL DDL parser refactor (#69 C1).
 *
 * The parser is now non-mutating (no disk writes) and emits JPA-style
 * physical metadata so the schema import wizard can show a preview, run
 * a diff, and commit only after explicit user confirmation.
 */
import { importService } from '../importService.js';
import { AttributeType } from '../../models/EntitySchema.js';

jest.mock('../../utils/logger');
jest.mock('../../utils/fileOperations', () => ({
  writeEntityFile: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../utils/uuid', () => {
  let counter = 0;
  return {
    generateUUID: jest.fn(() => `uuid-${++counter}`),
  };
});

const findMeta = (metadata: any, name: string) =>
  (metadata || []).find((m: any) => m.name === name)?.value;

describe('importService.parseSqlDdl (#69 C1)', () => {
  // ─── Smoke + happy path ────────────────────────────────────────────────
  describe('happy path', () => {
    it('parses a single CREATE TABLE with NOT NULL + PK column-level', () => {
      const sql = `
        CREATE TABLE orders (
          id VARCHAR(36) NOT NULL PRIMARY KEY,
          customer_email VARCHAR(255) NOT NULL,
          total DECIMAL(10,2) NOT NULL,
          notes TEXT
        );
      `;
      const result = importService.parseSqlDdl(sql);
      expect(result.errors).toEqual([]);
      expect(result.entities).toHaveLength(1);

      const entity = result.entities[0];
      expect(entity.name).toBe('Orders'); // PascalCase from 'orders'
      expect(entity.attributes).toHaveLength(4);

      // Physical metadata on the entity
      expect(findMeta(entity.metadata, 'physical.tableName')).toBe('orders');

      // PK column
      const idAttr = entity.attributes.find(a => a.name === 'id');
      expect(idAttr).toBeDefined();
      expect(idAttr!.required).toBe(true);
      expect(idAttr!.primaryKey).toBe(true);
      expect(findMeta(idAttr!.metadata, 'physical.columnName')).toBe('id');
      expect(findMeta(idAttr!.metadata, 'physical.dbType')).toBe('VARCHAR(36)');
      expect(findMeta(idAttr!.metadata, 'physical.nullable')).toBe(false);

      // Constraints from VARCHAR(n)
      const emailAttr = entity.attributes.find(a => a.name === 'customerEmail');
      expect(emailAttr).toBeDefined();
      expect(emailAttr!.constraints?.maxLength).toBe(255);
      expect(findMeta(emailAttr!.metadata, 'physical.columnName')).toBe('customer_email');

      // DECIMAL(p,s) extracts both
      const totalAttr = entity.attributes.find(a => a.name === 'total');
      expect(totalAttr).toBeDefined();
      expect(totalAttr!.constraints?.precision).toBe(10);
      expect(totalAttr!.constraints?.scale).toBe(2);
      expect(findMeta(totalAttr!.metadata, 'physical.dbType')).toBe('DECIMAL(10,2)');

      // Nullable column
      const notesAttr = entity.attributes.find(a => a.name === 'notes');
      expect(notesAttr).toBeDefined();
      expect(notesAttr!.required).toBe(false);
      expect(findMeta(notesAttr!.metadata, 'physical.nullable')).toBe(true);
    });

    it('parses table-level PRIMARY KEY constraint', () => {
      const sql = `
        CREATE TABLE order_items (
          order_id VARCHAR(36) NOT NULL,
          line_no INT NOT NULL,
          quantity INT NOT NULL,
          PRIMARY KEY (order_id, line_no)
        );
      `;
      const result = importService.parseSqlDdl(sql);
      expect(result.entities).toHaveLength(1);
      const entity = result.entities[0];
      expect(entity.name).toBe('OrderItems');

      const orderIdAttr = entity.attributes.find(a => a.name === 'orderId');
      const lineNoAttr = entity.attributes.find(a => a.name === 'lineNo');
      const quantityAttr = entity.attributes.find(a => a.name === 'quantity');

      expect(orderIdAttr!.primaryKey).toBe(true);
      expect(lineNoAttr!.primaryKey).toBe(true);
      expect(quantityAttr!.primaryKey).toBeFalsy();
    });

    it('parses multiple CREATE TABLE statements in one source', () => {
      const sql = `
        CREATE TABLE customers (
          id VARCHAR(36) PRIMARY KEY,
          name VARCHAR(100) NOT NULL
        );
        CREATE TABLE orders (
          id VARCHAR(36) PRIMARY KEY,
          customer_id VARCHAR(36) NOT NULL
        );
      `;
      const result = importService.parseSqlDdl(sql);
      expect(result.entities).toHaveLength(2);
      expect(result.entities.map(e => e.name).sort()).toEqual(['Customers', 'Orders']);
    });

    it('handles IF NOT EXISTS', () => {
      const sql = `CREATE TABLE IF NOT EXISTS users (id INT PRIMARY KEY);`;
      const result = importService.parseSqlDdl(sql);
      expect(result.entities).toHaveLength(1);
      expect(result.entities[0].name).toBe('Users');
    });

    it('handles quoted identifiers (backtick + double-quote)', () => {
      const sql = `
        CREATE TABLE \`users\` (
          \`id\` INT NOT NULL PRIMARY KEY,
          "email" VARCHAR(255) NOT NULL
        );
      `;
      const result = importService.parseSqlDdl(sql);
      expect(result.entities).toHaveLength(1);
      const entity = result.entities[0];
      expect(findMeta(entity.metadata, 'physical.tableName')).toBe('users');
      expect(entity.attributes.map(a => a.name)).toContain('email');
    });
  });

  // ─── UUID type detection (#69 C1) ──────────────────────────────────────
  describe('UUID type detection', () => {
    it('maps Postgres uuid columns to AttributeType.UUID', () => {
      const sql = `
        CREATE TABLE users (
          id UUID NOT NULL PRIMARY KEY,
          name VARCHAR(100) NOT NULL
        );
      `;
      const result = importService.parseSqlDdl(sql);
      const idAttr = result.entities[0].attributes.find(a => a.name === 'id');
      expect(idAttr!.type).toBe(AttributeType.UUID);
      expect(findMeta(idAttr!.metadata, 'physical.dbType')).toBe('UUID');
    });

    it('maps MSSQL uniqueidentifier to AttributeType.UUID', () => {
      const sql = `
        CREATE TABLE users (
          id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY
        );
      `;
      const result = importService.parseSqlDdl(sql);
      const idAttr = result.entities[0].attributes.find(a => a.name === 'id');
      expect(idAttr!.type).toBe(AttributeType.UUID);
    });
  });

  // ─── JPA-style physical metadata (#69 C1) ──────────────────────────────
  describe('physical metadata', () => {
    it('emits physical.tableName + physical.columnName + physical.dbType + physical.nullable', () => {
      const sql = `CREATE TABLE accounts (id INT NOT NULL PRIMARY KEY, balance DECIMAL(10,2));`;
      const result = importService.parseSqlDdl(sql);
      const entity = result.entities[0];

      expect(findMeta(entity.metadata, 'physical.tableName')).toBe('accounts');
      expect(entity.metadata?.find(m => m.name === 'physical.schema')).toBeUndefined();

      const idAttr = entity.attributes.find(a => a.name === 'id');
      expect(findMeta(idAttr!.metadata, 'physical.columnName')).toBe('id');
      expect(findMeta(idAttr!.metadata, 'physical.dbType')).toBe('INT');
      expect(findMeta(idAttr!.metadata, 'physical.nullable')).toBe(false);

      const balanceAttr = entity.attributes.find(a => a.name === 'balance');
      expect(findMeta(balanceAttr!.metadata, 'physical.dbType')).toBe('DECIMAL(10,2)');
      expect(findMeta(balanceAttr!.metadata, 'physical.nullable')).toBe(true);
    });

    it('emits physical.schema when options.schema is provided', () => {
      const sql = `CREATE TABLE orders (id INT PRIMARY KEY);`;
      const result = importService.parseSqlDdl(sql, { schema: 'sales' });
      const entity = result.entities[0];
      expect(findMeta(entity.metadata, 'physical.schema')).toBe('sales');
    });

    it('uses dialect-free metadata namespace (no physical.postgres.* / physical.oracle.*)', () => {
      const sql = `CREATE TABLE x (id INT PRIMARY KEY);`;
      const result = importService.parseSqlDdl(sql);
      const entity = result.entities[0];
      const allMetaNames = (entity.metadata || []).map(m => m.name).concat(
        ...(entity.attributes.map(a => (a.metadata || []).map(m => m.name))),
      );
      // No metadata key should contain a dialect prefix
      for (const name of allMetaNames) {
        expect(name.startsWith('physical.')).toBe(true);
        expect(name.startsWith('physical.postgres.')).toBe(false);
        expect(name.startsWith('physical.oracle.')).toBe(false);
        expect(name.startsWith('physical.mysql.')).toBe(false);
      }
    });
  });

  // ─── Name derivation (#69 C1) ──────────────────────────────────────────
  describe('name derivation', () => {
    it('strips configured prefix before PascalCase conversion', () => {
      const sql = `CREATE TABLE tbl_orders (id INT PRIMARY KEY);`;
      const result = importService.parseSqlDdl(sql, { stripPrefixes: ['tbl_'] });
      const entity = result.entities[0];
      expect(entity.name).toBe('Orders');
      // Physical metadata still carries the raw name
      expect(findMeta(entity.metadata, 'physical.tableName')).toBe('tbl_orders');
    });

    it('strips configured suffix before PascalCase conversion', () => {
      const sql = `CREATE TABLE orders_v2 (id INT PRIMARY KEY);`;
      const result = importService.parseSqlDdl(sql, { stripSuffixes: ['_v2'] });
      const entity = result.entities[0];
      expect(entity.name).toBe('Orders');
      expect(findMeta(entity.metadata, 'physical.tableName')).toBe('orders_v2');
    });

    it('strips both prefix and suffix', () => {
      const sql = `CREATE TABLE tbl_orders_v2 (id INT PRIMARY KEY);`;
      const result = importService.parseSqlDdl(sql, {
        stripPrefixes: ['tbl_'],
        stripSuffixes: ['_v2'],
      });
      expect(result.entities[0].name).toBe('Orders');
    });

    it('strip is case-insensitive', () => {
      const sql = `CREATE TABLE TBL_orders (id INT PRIMARY KEY);`;
      const result = importService.parseSqlDdl(sql, { stripPrefixes: ['tbl_'] });
      expect(result.entities[0].name).toBe('Orders');
    });

    it('first matching prefix wins', () => {
      const sql = `CREATE TABLE tbl_orders (id INT PRIMARY KEY);`;
      const result = importService.parseSqlDdl(sql, { stripPrefixes: ['nope_', 'tbl_'] });
      expect(result.entities[0].name).toBe('Orders');
    });

    it('camelCase derivation for snake_case columns', () => {
      const sql = `
        CREATE TABLE orders (
          customer_id INT NOT NULL,
          order_date_time TIMESTAMP NOT NULL
        );
      `;
      const result = importService.parseSqlDdl(sql);
      const attrNames = result.entities[0].attributes.map(a => a.name);
      expect(attrNames).toContain('customerId');
      expect(attrNames).toContain('orderDateTime');
    });

    it('column-level strip prefix is also applied', () => {
      const sql = `
        CREATE TABLE orders (
          col_id INT PRIMARY KEY,
          col_total DECIMAL(10,2)
        );
      `;
      const result = importService.parseSqlDdl(sql, { stripPrefixes: ['col_'] });
      const attrNames = result.entities[0].attributes.map(a => a.name);
      expect(attrNames).toContain('id');
      expect(attrNames).toContain('total');
      // Physical metadata preserved
      const idAttr = result.entities[0].attributes.find(a => a.name === 'id');
      expect(findMeta(idAttr!.metadata, 'physical.columnName')).toBe('col_id');
    });
  });

  // ─── Error cases ───────────────────────────────────────────────────────
  describe('errors', () => {
    it('returns an error when no CREATE TABLE statements are found', () => {
      const sql = `-- just a comment`;
      const result = importService.parseSqlDdl(sql);
      expect(result.entities).toHaveLength(0);
      expect(result.errors[0]).toContain('No CREATE TABLE');
    });
  });

  // ─── Non-destructive (no disk writes) ──────────────────────────────────
  describe('non-destructive', () => {
    it('parseSqlDdl does NOT call writeEntityFile', async () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const fileOps = require('../../utils/fileOperations');
      fileOps.writeEntityFile.mockClear();
      const sql = `CREATE TABLE orders (id INT PRIMARY KEY);`;
      importService.parseSqlDdl(sql);
      expect(fileOps.writeEntityFile).not.toHaveBeenCalled();
    });
  });
});

describe('importService.commitParsedEntities (#69 C1)', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fileOps = require('../../utils/fileOperations');

  beforeEach(() => {
    fileOps.writeEntityFile.mockClear();
    fileOps.writeEntityFile.mockResolvedValue(true);
  });

  it('writes each entity to disk via writeEntityFile and returns the written list', async () => {
    const parsed = importService.parseSqlDdl(`
      CREATE TABLE customers (id INT PRIMARY KEY);
      CREATE TABLE orders (id INT PRIMARY KEY);
    `);
    const result = await importService.commitParsedEntities(parsed.entities, 'test-svc');
    expect(result.written).toHaveLength(2);
    expect(result.errors).toEqual([]);
    expect(fileOps.writeEntityFile).toHaveBeenCalledTimes(2);
  });

  it('reports errors for failed writes but continues', async () => {
    fileOps.writeEntityFile
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false); // second entity fails
    const parsed = importService.parseSqlDdl(`
      CREATE TABLE customers (id INT PRIMARY KEY);
      CREATE TABLE orders (id INT PRIMARY KEY);
    `);
    const result = await importService.commitParsedEntities(parsed.entities, 'test-svc');
    expect(result.written).toHaveLength(1);
    expect(result.errors[0]).toContain('Failed to write entity');
  });
});
