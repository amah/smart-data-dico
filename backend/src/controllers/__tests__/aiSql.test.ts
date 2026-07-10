/**
 * buildSqlSchema() resolves the PHYSICAL relational schema for SQL generation:
 * physical names/types when present, sensible fallbacks from the logical/derived
 * type otherwise, and relationships as join hints.
 */
jest.mock('../../utils/fileOperations.js', () => ({
  listMicroservices: jest.fn(),
}));

import { buildSqlSchema } from '../aiSql.js';
import { listMicroservices } from '../../utils/fileOperations.js';

const mockListMicroservices = listMicroservices as jest.MockedFunction<any>;

const ORDER = 'o-uuid';
const CUSTOMER = 'c-uuid';

function makeServices() {
  return {
    serviceService: {
      getServiceEntities: jest.fn(async () => [
        {
          uuid: ORDER, name: 'Order',
          metadata: [{ name: 'physical.tableName', value: 'orders' }, { name: 'physical.schema', value: 'commerce' }],
          attributes: [
            { name: 'id', type: 'uuid', required: true, primaryKey: true,
              metadata: [{ name: 'physical.columnName', value: 'order_id' }, { name: 'physical.dbType', value: 'UUID' }] },
            // no physical mapping → fallback from derived type "money"
            { name: 'total', type: 'money', required: true },
            // no physical mapping → fallback from logical "string" + maxLength
            { name: 'note', type: 'string', validation: { maxLength: 100 } },
          ],
        },
        {
          uuid: CUSTOMER, name: 'Customer',
          attributes: [{ name: 'id', type: 'uuid', required: true, primaryKey: true }],
        },
      ]),
      getPackageRelationships: jest.fn(async () => [
        { source: { entity: CUSTOMER, cardinality: 'one' }, target: { entity: ORDER, cardinality: 'many' }, description: 'places' },
      ]),
    },
    derivedTypes: { list: jest.fn(async () => [{ name: 'money', basedOn: 'number', validation: { precision: 12, scale: 2 } }]) },
  };
}

describe('buildSqlSchema', () => {
  beforeEach(() => { jest.clearAllMocks(); mockListMicroservices.mockResolvedValue(['ordering']); });

  it('uses physical table/column/dbType when present', async () => {
    const s: any = await buildSqlSchema({}, makeServices());
    const order = s.tables.find((t: any) => t.entity === 'Order');
    expect(order.table).toBe('orders');
    expect(order.schema).toBe('commerce');
    const id = order.columns.find((c: any) => c.attribute === 'id');
    expect(id).toMatchObject({ column: 'order_id', dbType: 'UUID', primaryKey: true, nullable: false });
  });

  it('falls back to a SQL type derived from the logical/derived type when unmapped', async () => {
    const s: any = await buildSqlSchema({ dialect: 'postgres' }, makeServices());
    const order = s.tables.find((t: any) => t.entity === 'Order');
    const total = order.columns.find((c: any) => c.attribute === 'total');
    const note = order.columns.find((c: any) => c.attribute === 'note');
    expect(total.dbType).toBe('DECIMAL(12,2)');        // money → precision/scale
    expect(total.physicalMappingMissing).toBe(true);
    expect(note.dbType).toBe('VARCHAR(100)');          // string + maxLength
    const custId = s.tables.find((t: any) => t.entity === 'Customer').columns[0];
    expect(custId.dbType).toBe('UUID');                // postgres uuid
  });

  it('emits relationships as join hints and a mapping note', async () => {
    const s: any = await buildSqlSchema({}, makeServices());
    expect(s.relationships).toEqual([
      { from: 'Customer', to: 'Order', fromCardinality: 'one', toCardinality: 'many', description: 'places' },
    ]);
    // The note NAMES the affected tables so the model warns instead of guessing.
    expect(s.note).toMatch(/no explicit physical mapping/);
    expect(s.tablesWithFallbackColumns).toEqual(['orders', 'Customer']);
    expect(s.summary).toBe('Order, Customer — 1 relationship (generic, all packages)');
  });

  it('honours dialect fallbacks (mysql uuid → CHAR(36))', async () => {
    const s: any = await buildSqlSchema({ dialect: 'mysql' }, makeServices());
    const custId = s.tables.find((t: any) => t.entity === 'Customer').columns[0];
    expect(custId.dbType).toBe('CHAR(36)');
  });

  it('qualifiedName uses the physical schema when present', async () => {
    const s: any = await buildSqlSchema({}, makeServices());
    const order = s.tables.find((t: any) => t.entity === 'Order');
    const customer = s.tables.find((t: any) => t.entity === 'Customer');
    expect(order.qualifiedName).toBe('commerce.orders'); // has physical.schema
    expect(customer.qualifiedName).toBe('Customer');     // no schema, no default
  });

  // #grounding — fallback surfacing: tables whose columns carry no explicit
  // physical mapping are NAMED (tablesWithFallbackColumns + WARN note) so the
  // model warns the user instead of trusting derived names/types.
  describe('fallback surfacing (tablesWithFallbackColumns + WARN note)', () => {
    /** Attribute set with a full physical mapping (columnName + dbType). */
    const mapped = (name: string, column: string) => ({
      name, type: 'string', required: true,
      metadata: [
        { name: 'physical.columnName', value: column },
        { name: 'physical.dbType', value: 'VARCHAR(50)' },
      ],
    });

    function servicesWithEntities(entities: any[]) {
      return {
        serviceService: {
          getServiceEntities: jest.fn(async () => entities),
          getPackageRelationships: jest.fn(async () => []),
        },
        derivedTypes: { list: jest.fn(async () => []) },
      };
    }

    it('legacy isPrimaryKey metadata (no primaryKey field, no physical mapping) → PK true, physicalMappingMissing, table named in the WARN note', async () => {
      const s: any = await buildSqlSchema({}, servicesWithEntities([
        {
          uuid: 'l-uuid', name: 'LegacyOrder',
          metadata: [{ name: 'physical.tableName', value: 'legacy_orders' }],
          attributes: [
            { name: 'id', type: 'uuid', required: true,
              metadata: [{ name: 'isPrimaryKey', value: 'true' }] },
          ],
        },
      ]));

      const id = s.tables.find((t: any) => t.entity === 'LegacyOrder').columns[0];
      expect(id.primaryKey).toBe(true);            // PK survives the legacy form
      expect(id.physicalMappingMissing).toBe(true); // no physical.* on the attribute
      expect(s.tablesWithFallbackColumns).toEqual(['legacy_orders']);
      expect(s.note).toContain('legacy_orders');
      expect(s.note).toMatch(/WARN the user/);
    });

    it('fully mapped model → NO tablesWithFallbackColumns key and no WARN note', async () => {
      const s: any = await buildSqlSchema({}, servicesWithEntities([
        {
          uuid: 'm-uuid', name: 'Invoice',
          metadata: [{ name: 'physical.tableName', value: 'invoices' }],
          attributes: [mapped('number', 'invoice_number'), mapped('status', 'status_code')],
        },
      ]));

      expect(s).not.toHaveProperty('tablesWithFallbackColumns'); // absent, not empty
      expect(s.note).toContain('All columns have an explicit physical mapping.');
      expect(s.note).not.toMatch(/WARN/);
      for (const c of s.tables[0].columns) {
        expect(c).not.toHaveProperty('physicalMappingMissing');
      }
    });

    it('mixed model → only the affected tables are listed', async () => {
      const s: any = await buildSqlSchema({}, servicesWithEntities([
        {
          uuid: 'm-uuid', name: 'Invoice',
          metadata: [{ name: 'physical.tableName', value: 'invoices' }],
          attributes: [mapped('number', 'invoice_number')],
        },
        {
          uuid: 'u-uuid', name: 'Payment',
          attributes: [{ name: 'amount', type: 'number' }], // unmapped
        },
      ]));

      expect(s.tablesWithFallbackColumns).toEqual(['Payment']); // invoices NOT listed
      expect(s.note).toContain('Payment');
      expect(s.note).not.toMatch(/invoices.*no explicit physical mapping/);
      expect(s.note).toMatch(/WARN the user/);
    });
  });

  it('applies the default schema and echoes the qualify flag (#sql-settings)', async () => {
    const s: any = await buildSqlSchema({}, makeServices(), { schemaQualifyTables: true, defaultSchema: 'app' });
    const customer = s.tables.find((t: any) => t.entity === 'Customer');
    expect(customer.schema).toBe('app');
    expect(customer.qualifiedName).toBe('app.Customer');
    // a table with its own schema keeps it, not the default
    expect(s.tables.find((t: any) => t.entity === 'Order').qualifiedName).toBe('commerce.orders');
    expect(s.schemaQualifyTables).toBe(true);
    expect(s.note).toMatch(/Schema-qualify every table/);
  });
});
