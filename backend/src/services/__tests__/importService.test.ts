/**
 * Tests for the SQL DDL parser refactor (#69 C1).
 *
 * The parser is now non-mutating (no disk writes) and emits JPA-style
 * physical metadata so the schema import wizard can show a preview, run
 * a diff, and commit only after explicit user confirmation.
 */
import { importService } from '../importService.js';
import { buildRelationshipsFromForeignKeys } from '../importService.js';
import { AttributeType, Cardinality } from '../../models/EntitySchema.js';

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

      // Validation from VARCHAR(n) (#85)
      const emailAttr = entity.attributes.find(a => a.name === 'customerEmail');
      expect(emailAttr).toBeDefined();
      expect(emailAttr!.validation?.maxLength).toBe(255);
      expect(findMeta(emailAttr!.metadata, 'physical.columnName')).toBe('customer_email');

      // DECIMAL(p,s) extracts both
      const totalAttr = entity.attributes.find(a => a.name === 'total');
      expect(totalAttr).toBeDefined();
      expect(totalAttr!.validation?.precision).toBe(10);
      expect(totalAttr!.validation?.scale).toBe(2);
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

  // ─── Physical constraints (#85 R3) ─────────────────────────────────────
  describe('physical constraints', () => {
    it('captures table-level UNIQUE with a CONSTRAINT name', () => {
      const sql = `
        CREATE TABLE orders (
          id VARCHAR(36) PRIMARY KEY,
          order_number VARCHAR(20) NOT NULL,
          CONSTRAINT uq_orders_number UNIQUE (order_number)
        );
      `;
      const result = importService.parseSqlDdl(sql);
      const cs = result.entities[0].constraints || [];
      expect(cs).toHaveLength(1);
      expect(cs[0]).toEqual({
        kind: 'unique',
        name: 'uq_orders_number',
        columns: ['order_number'],
      });
    });

    it('captures table-level UNIQUE without a constraint name', () => {
      const sql = `
        CREATE TABLE accounts (
          id INT PRIMARY KEY,
          email VARCHAR(255) NOT NULL,
          UNIQUE (email)
        );
      `;
      const result = importService.parseSqlDdl(sql);
      const cs = result.entities[0].constraints || [];
      expect(cs).toEqual([{ kind: 'unique', columns: ['email'] }]);
    });

    it('captures multi-column UNIQUE', () => {
      const sql = `
        CREATE TABLE order_items (
          order_id INT,
          line_no INT,
          PRIMARY KEY (order_id, line_no),
          UNIQUE (order_id, line_no)
        );
      `;
      const result = importService.parseSqlDdl(sql);
      const cs = result.entities[0].constraints || [];
      expect(cs).toEqual([{ kind: 'unique', columns: ['order_id', 'line_no'] }]);
    });

    it('captures table-level CHECK with nested parens in expression', () => {
      const sql = `
        CREATE TABLE accounts (
          id INT PRIMARY KEY,
          balance DECIMAL(10,2) NOT NULL,
          CONSTRAINT chk_balance CHECK (balance >= 0 AND balance <= 1000000)
        );
      `;
      const result = importService.parseSqlDdl(sql);
      const cs = result.entities[0].constraints || [];
      expect(cs).toHaveLength(1);
      expect(cs[0].kind).toBe('check');
      expect(cs[0].name).toBe('chk_balance');
      expect(cs[0].expression).toBe('balance >= 0 AND balance <= 1000000');
    });

    it('captures table-level FOREIGN KEY with single column', () => {
      const sql = `
        CREATE TABLE orders (
          id INT PRIMARY KEY,
          customer_id INT NOT NULL,
          FOREIGN KEY (customer_id) REFERENCES customers(id)
        );
      `;
      const result = importService.parseSqlDdl(sql);
      const cs = result.entities[0].constraints || [];
      expect(cs).toEqual([{
        kind: 'foreignKey',
        columns: ['customer_id'],
        references: { table: 'customers', columns: ['id'] },
      }]);
    });

    it('captures table-level composite FOREIGN KEY with constraint name', () => {
      const sql = `
        CREATE TABLE shipments (
          ship_id INT,
          order_id INT,
          line_no INT,
          PRIMARY KEY (ship_id),
          CONSTRAINT fk_shipments_line FOREIGN KEY (order_id, line_no) REFERENCES order_items(order_id, line_no)
        );
      `;
      const result = importService.parseSqlDdl(sql);
      const cs = result.entities[0].constraints || [];
      expect(cs).toHaveLength(1);
      expect(cs[0]).toEqual({
        kind: 'foreignKey',
        name: 'fk_shipments_line',
        columns: ['order_id', 'line_no'],
        references: { table: 'order_items', columns: ['order_id', 'line_no'] },
      });
    });

    it('captures column-level inline REFERENCES', () => {
      const sql = `
        CREATE TABLE orders (
          id INT PRIMARY KEY,
          customer_id INT NOT NULL REFERENCES customers(id)
        );
      `;
      const result = importService.parseSqlDdl(sql);
      const cs = result.entities[0].constraints || [];
      expect(cs).toEqual([{
        kind: 'foreignKey',
        columns: ['customer_id'],
        references: { table: 'customers', columns: ['id'] },
      }]);
    });

    it('captures column-level inline UNIQUE', () => {
      const sql = `
        CREATE TABLE products (
          id INT PRIMARY KEY,
          sku VARCHAR(20) NOT NULL UNIQUE
        );
      `;
      const result = importService.parseSqlDdl(sql);
      const cs = result.entities[0].constraints || [];
      expect(cs).toEqual([{ kind: 'unique', columns: ['sku'] }]);
    });

    it('omits constraints field when there are no constraints', () => {
      const sql = `
        CREATE TABLE plain (
          id INT PRIMARY KEY,
          name VARCHAR(50)
        );
      `;
      const result = importService.parseSqlDdl(sql);
      expect(result.entities[0].constraints).toBeUndefined();
    });

    it('captures ON DELETE CASCADE on table-level FOREIGN KEY', () => {
      const sql = `
        CREATE TABLE orders (
          id INT PRIMARY KEY,
          customer_id INT NOT NULL,
          CONSTRAINT fk_orders_cust FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
        );
      `;
      const result = importService.parseSqlDdl(sql);
      const fk = result.entities[0].constraints?.find(c => c.kind === 'foreignKey');
      expect(fk!.references!.onDelete).toBe('CASCADE');
      expect(fk!.references!.onUpdate).toBeUndefined();
    });

    it('captures ON DELETE SET NULL and ON UPDATE CASCADE together', () => {
      const sql = `
        CREATE TABLE orders (
          id INT PRIMARY KEY,
          customer_id INT,
          FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL ON UPDATE CASCADE
        );
      `;
      const result = importService.parseSqlDdl(sql);
      const fk = result.entities[0].constraints?.find(c => c.kind === 'foreignKey');
      expect(fk!.references!.onDelete).toBe('SET NULL');
      expect(fk!.references!.onUpdate).toBe('CASCADE');
    });

    it('captures ON DELETE on inline REFERENCES', () => {
      const sql = `
        CREATE TABLE orders (
          id INT PRIMARY KEY,
          customer_id INT NOT NULL REFERENCES customers(id) ON DELETE CASCADE
        );
      `;
      const result = importService.parseSqlDdl(sql);
      const fk = result.entities[0].constraints?.find(c => c.kind === 'foreignKey');
      expect(fk!.references!.onDelete).toBe('CASCADE');
    });

    it('omits onDelete/onUpdate when not specified', () => {
      const sql = `
        CREATE TABLE orders (
          id INT PRIMARY KEY,
          customer_id INT NOT NULL,
          FOREIGN KEY (customer_id) REFERENCES customers(id)
        );
      `;
      const result = importService.parseSqlDdl(sql);
      const fk = result.entities[0].constraints?.find(c => c.kind === 'foreignKey');
      expect(fk!.references!.onDelete).toBeUndefined();
      expect(fk!.references!.onUpdate).toBeUndefined();
    });

    it('captures multiple mixed constraints on the same table', () => {
      const sql = `
        CREATE TABLE orders (
          id INT PRIMARY KEY,
          order_number VARCHAR(20) NOT NULL,
          customer_id INT NOT NULL,
          total DECIMAL(10,2) NOT NULL,
          CONSTRAINT uq_orders_number UNIQUE (order_number),
          CONSTRAINT chk_total CHECK (total >= 0),
          CONSTRAINT fk_orders_customer FOREIGN KEY (customer_id) REFERENCES customers(id)
        );
      `;
      const result = importService.parseSqlDdl(sql);
      const cs = result.entities[0].constraints || [];
      expect(cs.map(c => c.kind).sort()).toEqual(['check', 'foreignKey', 'unique']);
      expect(cs.find(c => c.kind === 'unique')!.columns).toEqual(['order_number']);
      expect(cs.find(c => c.kind === 'check')!.expression).toBe('total >= 0');
      expect(cs.find(c => c.kind === 'foreignKey')!.references).toEqual({
        table: 'customers',
        columns: ['id'],
      });
    });
  });

  // ─── Auto-generation strategy detection (#73) ─────────────────────────
  describe('physical.generated detection', () => {
    it('detects Postgres SERIAL as identity', () => {
      const sql = `CREATE TABLE users (id SERIAL PRIMARY KEY, name VARCHAR(100));`;
      const result = importService.parseSqlDdl(sql);
      const idAttr = result.entities[0].attributes.find(a => a.name === 'id');
      expect(findMeta(idAttr!.metadata, 'physical.generated')).toBe('identity');
    });

    it('detects BIGSERIAL as identity', () => {
      const sql = `CREATE TABLE events (id BIGSERIAL PRIMARY KEY);`;
      const result = importService.parseSqlDdl(sql);
      const idAttr = result.entities[0].attributes.find(a => a.name === 'id');
      expect(findMeta(idAttr!.metadata, 'physical.generated')).toBe('identity');
    });

    it('detects GENERATED ALWAYS AS IDENTITY', () => {
      const sql = `CREATE TABLE orders (id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY);`;
      const result = importService.parseSqlDdl(sql);
      const idAttr = result.entities[0].attributes.find(a => a.name === 'id');
      expect(findMeta(idAttr!.metadata, 'physical.generated')).toBe('identity');
    });

    it('detects GENERATED BY DEFAULT AS IDENTITY', () => {
      const sql = `CREATE TABLE orders (id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY);`;
      const result = importService.parseSqlDdl(sql);
      const idAttr = result.entities[0].attributes.find(a => a.name === 'id');
      expect(findMeta(idAttr!.metadata, 'physical.generated')).toBe('identity');
    });

    it('detects MySQL AUTO_INCREMENT', () => {
      const sql = `CREATE TABLE orders (id INT AUTO_INCREMENT PRIMARY KEY);`;
      const result = importService.parseSqlDdl(sql);
      const idAttr = result.entities[0].attributes.find(a => a.name === 'id');
      expect(findMeta(idAttr!.metadata, 'physical.generated')).toBe('identity');
    });

    it('detects MSSQL IDENTITY(1,1)', () => {
      const sql = `CREATE TABLE orders (id INT IDENTITY(1,1) PRIMARY KEY);`;
      const result = importService.parseSqlDdl(sql);
      const idAttr = result.entities[0].attributes.find(a => a.name === 'id');
      expect(findMeta(idAttr!.metadata, 'physical.generated')).toBe('identity');
    });

    it('detects UUID with DEFAULT gen_random_uuid()', () => {
      const sql = `CREATE TABLE users (id UUID DEFAULT gen_random_uuid() PRIMARY KEY);`;
      const result = importService.parseSqlDdl(sql);
      const idAttr = result.entities[0].attributes.find(a => a.name === 'id');
      expect(findMeta(idAttr!.metadata, 'physical.generated')).toBe('uuid');
    });

    it('does not emit physical.generated for plain columns', () => {
      const sql = `CREATE TABLE orders (id INT PRIMARY KEY, name VARCHAR(100));`;
      const result = importService.parseSqlDdl(sql);
      const nameAttr = result.entities[0].attributes.find(a => a.name === 'name');
      expect(findMeta(nameAttr!.metadata, 'physical.generated')).toBeUndefined();
      const idAttr = result.entities[0].attributes.find(a => a.name === 'id');
      expect(findMeta(idAttr!.metadata, 'physical.generated')).toBeUndefined();
    });
  });

  // ─── SQL COMMENT extraction (#83) ──────────────────────────────────────
  describe('SQL COMMENT extraction', () => {
    it('extracts COMMENT ON TABLE and uses it as entity description', () => {
      const sql = `
        CREATE TABLE orders (
          id INT PRIMARY KEY,
          total DECIMAL(10,2)
        );
        COMMENT ON TABLE orders IS 'All customer orders';
      `;
      const result = importService.parseSqlDdl(sql);
      expect(result.entities[0].description).toBe('All customer orders');
    });

    it('extracts COMMENT ON COLUMN and uses it as attribute description', () => {
      const sql = `
        CREATE TABLE orders (
          id INT PRIMARY KEY,
          total DECIMAL(10,2)
        );
        COMMENT ON COLUMN orders.total IS 'Order total in USD';
      `;
      const result = importService.parseSqlDdl(sql);
      const totalAttr = result.entities[0].attributes.find(a => a.name === 'total');
      expect(totalAttr!.description).toBe('Order total in USD');
    });

    it('handles schema-qualified COMMENT ON COLUMN (schema.table.column)', () => {
      const sql = `
        CREATE TABLE orders (
          id INT PRIMARY KEY,
          total DECIMAL(10,2)
        );
        COMMENT ON COLUMN sales.orders.total IS 'Total amount';
      `;
      const result = importService.parseSqlDdl(sql);
      const totalAttr = result.entities[0].attributes.find(a => a.name === 'total');
      expect(totalAttr!.description).toBe('Total amount');
    });

    it('extracts MySQL inline COMMENT on column definition', () => {
      const sql = `
        CREATE TABLE products (
          id INT PRIMARY KEY,
          sku VARCHAR(20) NOT NULL COMMENT 'Stock Keeping Unit',
          price DECIMAL(10,2) COMMENT 'Retail price in EUR'
        );
      `;
      const result = importService.parseSqlDdl(sql);
      const skuAttr = result.entities[0].attributes.find(a => a.name === 'sku');
      const priceAttr = result.entities[0].attributes.find(a => a.name === 'price');
      expect(skuAttr!.description).toBe('Stock Keeping Unit');
      expect(priceAttr!.description).toBe('Retail price in EUR');
    });

    it('handles escaped single quotes in comments', () => {
      const sql = `
        CREATE TABLE orders (
          id INT PRIMARY KEY,
          notes TEXT
        );
        COMMENT ON COLUMN orders.notes IS 'Customer''s special notes';
      `;
      const result = importService.parseSqlDdl(sql);
      const notesAttr = result.entities[0].attributes.find(a => a.name === 'notes');
      expect(notesAttr!.description).toBe("Customer's special notes");
    });

    it('falls back to default description when no COMMENT ON TABLE exists', () => {
      const sql = `CREATE TABLE orders (id INT PRIMARY KEY);`;
      const result = importService.parseSqlDdl(sql);
      expect(result.entities[0].description).toBe("Imported from SQL table 'orders'");
    });

    it('leaves attribute description empty when no comment exists', () => {
      const sql = `CREATE TABLE orders (id INT PRIMARY KEY, total DECIMAL(10,2));`;
      const result = importService.parseSqlDdl(sql);
      const totalAttr = result.entities[0].attributes.find(a => a.name === 'total');
      expect(totalAttr!.description).toBe('');
    });

    it('is case-insensitive for table and column name matching', () => {
      const sql = `
        CREATE TABLE Orders (
          ID INT PRIMARY KEY,
          Total DECIMAL(10,2)
        );
        COMMENT ON COLUMN orders.total IS 'The total';
        COMMENT ON TABLE orders IS 'Order table';
      `;
      const result = importService.parseSqlDdl(sql);
      expect(result.entities[0].description).toBe('Order table');
      const totalAttr = result.entities[0].attributes.find(a => a.name === 'total');
      expect(totalAttr!.description).toBe('The total');
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

// ─── FK → Relationship extraction (#82) ────────────────────────────────
describe('FK → Relationship extraction (#82)', () => {
  it('creates a relationship from table-level FOREIGN KEY', () => {
    const sql = `
      CREATE TABLE customers (
        id INT PRIMARY KEY,
        name VARCHAR(100)
      );
      CREATE TABLE orders (
        id INT PRIMARY KEY,
        customer_id INT NOT NULL,
        FOREIGN KEY (customer_id) REFERENCES customers(id)
      );
    `;
    const result = importService.parseSqlDdl(sql);
    expect(result.relationships).toHaveLength(1);

    const rel = result.relationships![0];
    const ordersEntity = result.entities.find(e => e.name === 'Orders')!;
    const customersEntity = result.entities.find(e => e.name === 'Customers')!;

    expect(rel.source.entity).toBe(ordersEntity.uuid);
    expect(rel.target.entity).toBe(customersEntity.uuid);
    expect(rel.source.cardinality).toBe(Cardinality.MANY);
    expect(rel.target.cardinality).toBe(Cardinality.ONE);
    expect(rel.source.referenceAttributes).toEqual(['customerId']);
    expect(rel.type).toBe('structural');
  });

  it('creates a relationship from inline REFERENCES', () => {
    const sql = `
      CREATE TABLE customers (id INT PRIMARY KEY);
      CREATE TABLE orders (
        id INT PRIMARY KEY,
        customer_id INT NOT NULL REFERENCES customers(id)
      );
    `;
    const result = importService.parseSqlDdl(sql);
    expect(result.relationships).toHaveLength(1);
    expect(result.relationships![0].source.cardinality).toBe(Cardinality.MANY);
  });

  it('records physical.constraintName metadata for named FK', () => {
    const sql = `
      CREATE TABLE customers (id INT PRIMARY KEY);
      CREATE TABLE orders (
        id INT PRIMARY KEY,
        customer_id INT NOT NULL,
        CONSTRAINT fk_order_customer FOREIGN KEY (customer_id) REFERENCES customers(id)
      );
    `;
    const result = importService.parseSqlDdl(sql);
    const rel = result.relationships![0];
    const cn = (rel.metadata || []).find(m => m.name === 'physical.constraintName');
    expect(cn).toBeDefined();
    expect(cn!.value).toBe('fk_order_customer');
    expect(rel.description).toBe("Imported from FK constraint 'fk_order_customer'");
  });

  it('infers ONE-to-ONE when FK column has UNIQUE constraint', () => {
    const sql = `
      CREATE TABLE users (id INT PRIMARY KEY);
      CREATE TABLE user_profiles (
        id INT PRIMARY KEY,
        user_id INT NOT NULL UNIQUE REFERENCES users(id)
      );
    `;
    const result = importService.parseSqlDdl(sql);
    expect(result.relationships).toHaveLength(1);
    expect(result.relationships![0].source.cardinality).toBe(Cardinality.ONE);
    expect(result.relationships![0].target.cardinality).toBe(Cardinality.ONE);
  });

  it('handles composite FK', () => {
    const sql = `
      CREATE TABLE order_items (
        order_id INT,
        line_no INT,
        PRIMARY KEY (order_id, line_no)
      );
      CREATE TABLE shipments (
        id INT PRIMARY KEY,
        order_id INT NOT NULL,
        line_no INT NOT NULL,
        CONSTRAINT fk_ship_item FOREIGN KEY (order_id, line_no) REFERENCES order_items(order_id, line_no)
      );
    `;
    const result = importService.parseSqlDdl(sql);
    expect(result.relationships).toHaveLength(1);
    expect(result.relationships![0].source.referenceAttributes).toEqual(['orderId', 'lineNo']);
  });

  it('skips FK referencing a table not in the parsed set and logs warning', () => {
    const sql = `
      CREATE TABLE orders (
        id INT PRIMARY KEY,
        customer_id INT NOT NULL REFERENCES customers(id)
      );
    `;
    const result = importService.parseSqlDdl(sql);
    expect(result.relationships).toBeUndefined(); // no relationships (empty → omitted)
    expect(result.errors.some(e => e.includes('customers'))).toBe(true);
  });

  it('handles multiple FKs on the same table', () => {
    const sql = `
      CREATE TABLE customers (id INT PRIMARY KEY);
      CREATE TABLE products (id INT PRIMARY KEY);
      CREATE TABLE orders (
        id INT PRIMARY KEY,
        customer_id INT NOT NULL REFERENCES customers(id),
        product_id INT NOT NULL REFERENCES products(id)
      );
    `;
    const result = importService.parseSqlDdl(sql);
    expect(result.relationships).toHaveLength(2);
    const targets = result.relationships!.map(r => r.target.entity);
    const custEntity = result.entities.find(e => e.name === 'Customers')!;
    const prodEntity = result.entities.find(e => e.name === 'Products')!;
    expect(targets).toContain(custEntity.uuid);
    expect(targets).toContain(prodEntity.uuid);
  });

  it('returns no relationships field when no FKs exist', () => {
    const sql = `CREATE TABLE plain (id INT PRIMARY KEY, name VARCHAR(50));`;
    const result = importService.parseSqlDdl(sql);
    expect(result.relationships).toBeUndefined();
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
