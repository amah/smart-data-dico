/**
 * Tests for the migration script generator (#90).
 */
import { generateMigration } from '../migrationGenerator.js';
import { DdlOperation } from '../impactDiff.js';

jest.mock('../../utils/logger');

const sampleOps: DdlOperation[] = [
  {
    order: 1, type: 'ADD_COLUMN', table: 'orders', column: 'discount_code',
    details: { dbType: 'VARCHAR(20)', notNull: false },
    destructive: false, risk: 'safe',
    sql: 'ALTER TABLE orders ADD COLUMN discount_code VARCHAR(20);',
  },
  {
    order: 2, type: 'ALTER_COLUMN', table: 'orders', column: 'total',
    details: { from: 'DECIMAL(10,2)', to: 'NUMERIC(12,2)', driftFields: ['type'] },
    destructive: false, risk: 'safe',
    sql: 'ALTER TABLE orders ALTER COLUMN total TYPE NUMERIC(12,2);',
  },
  {
    order: 3, type: 'DROP_COLUMN', table: 'customers', column: 'legacy_code',
    details: {},
    destructive: true, risk: 'destructive',
    riskReason: 'Data loss — column may contain data',
    sql: 'ALTER TABLE customers DROP COLUMN legacy_code;',
  },
];

describe('generateMigration (#90)', () => {
  describe('raw SQL', () => {
    it('generates SQL with destructive ops commented out', () => {
      const result = generateMigration(sampleOps, 'postgres', 'sql');
      expect(result.format).toBe('sql');
      expect(result.content).toContain('ALTER TABLE orders ADD COLUMN discount_code VARCHAR(20);');
      expect(result.content).toContain('ALTER TABLE orders ALTER COLUMN total TYPE NUMERIC(12,2);');
      // Destructive ops should be commented
      expect(result.content).toContain('-- WARNING: destructive');
      expect(result.content).toContain('-- ALTER TABLE customers DROP COLUMN legacy_code;');
      expect(result.filename).toMatch(/^migration-.*\.sql$/);
    });
  });

  describe('Liquibase XML', () => {
    it('generates valid XML changesets', () => {
      const result = generateMigration(sampleOps, 'postgres', 'liquibase-xml', {
        author: 'test-user', changesetPrefix: 'sprint-13',
      });
      expect(result.format).toBe('liquibase-xml');
      expect(result.content).toContain('<databaseChangeLog');
      expect(result.content).toContain('id="sprint-13-001"');
      expect(result.content).toContain('author="test-user"');
      expect(result.content).toContain('<addColumn tableName="orders">');
      expect(result.content).toContain('name="discount_code"');
      expect(result.content).toContain('<modifyDataType');
      expect(result.content).toContain('</databaseChangeLog>');
    });

    it('includes rollback blocks when requested', () => {
      const result = generateMigration(sampleOps, 'postgres', 'liquibase-xml', {
        includeRollback: true,
      });
      expect(result.content).toContain('<rollback>');
      expect(result.content).toContain('<dropColumn');
    });
  });

  describe('Liquibase YAML', () => {
    it('generates valid YAML changesets', () => {
      const result = generateMigration(sampleOps, 'postgres', 'liquibase-yaml', {
        changesetPrefix: 'v2',
      });
      expect(result.format).toBe('liquibase-yaml');
      expect(result.content).toContain('databaseChangeLog:');
      expect(result.content).toContain('id: "v2-001"');
      expect(result.content).toContain('addColumn:');
      expect(result.content).toContain('tableName: "orders"');
      expect(result.content).toContain('name: "discount_code"');
    });
  });

  describe('Flyway SQL', () => {
    it('generates versioned SQL statements', () => {
      const result = generateMigration(sampleOps, 'postgres', 'flyway-sql', {
        changesetPrefix: 'V2',
      });
      expect(result.format).toBe('flyway-sql');
      expect(result.content).toContain('-- V2.001__');
      expect(result.content).toContain('ALTER TABLE orders ADD COLUMN discount_code VARCHAR(20);');
      // Destructive commented
      expect(result.content).toContain('-- WARNING: destructive');
    });
  });

  describe('skipDestructive option', () => {
    it('omits destructive operations when skipDestructive is true', () => {
      const result = generateMigration(sampleOps, 'postgres', 'sql', { skipDestructive: true });
      expect(result.content).not.toContain('DROP COLUMN');
      expect(result.content).toContain('ADD COLUMN');
    });
  });
});
