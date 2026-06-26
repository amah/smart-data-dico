/**
 * buildEntityDetails() surfaces the layers the AI previously could not see —
 * field validation, the physical table/column/dbType mapping, constraints, and
 * inline rules — so the model can write physically-correct SQL and reason about
 * the physical model.
 */
import { buildEntityDetails } from '../aiController.js';

const entity = {
  name: 'Order',
  description: 'An order',
  stereotype: 'aggregate-root',
  metadata: [
    { name: 'physical.tableName', value: 'CUST_MASTER_T' },
    { name: 'physical.schema', value: 'legacy_dump' },
  ],
  attributes: [
    {
      name: 'id', type: 'uuid', required: true, primaryKey: true,
      metadata: [
        { name: 'physical.columnName', value: 'pk_47' },
        { name: 'physical.dbType', value: 'VARCHAR(8)' },
      ],
    },
    {
      name: 'orderNumber', type: 'string', required: true,
      validation: { pattern: '^ORD-[0-9]{8}$', maxLength: 12 },
      metadata: [
        { name: 'physical.columnName', value: 'cust_email_addr' },
        { name: 'physical.dbType', value: 'BOOLEAN' },
      ],
    },
    { name: 'status', type: 'string' }, // no physical mapping → no `physical` key
  ],
  constraints: [{ kind: 'unique', columns: ['orderNumber'] }],
  rules: [{ name: 'order-total-matches-lines', description: 'total = sum(lines)', severity: 'error', extra: 'dropped' }],
};

describe('buildEntityDetails', () => {
  const d = buildEntityDetails(entity) as any;

  it('exposes the entity physical table + schema', () => {
    expect(d.physical).toEqual({ tableName: 'CUST_MASTER_T', schema: 'legacy_dump' });
  });

  it('exposes per-attribute physical column + dbType and validation', () => {
    const byName = Object.fromEntries(d.attributes.map((a: any) => [a.name, a]));
    expect(byName.id.physical).toEqual({ columnName: 'pk_47', dbType: 'VARCHAR(8)' });
    expect(byName.orderNumber.physical).toEqual({ columnName: 'cust_email_addr', dbType: 'BOOLEAN' });
    expect(byName.orderNumber.validation).toEqual({ pattern: '^ORD-[0-9]{8}$', maxLength: 12 });
  });

  it('omits the physical key for attributes without a physical mapping', () => {
    const status = d.attributes.find((a: any) => a.name === 'status');
    expect(status.physical).toBeUndefined();
  });

  it('passes through constraints and trims rules to name/description/severity', () => {
    expect(d.constraints).toEqual([{ kind: 'unique', columns: ['orderNumber'] }]);
    expect(d.rules).toEqual([{ name: 'order-total-matches-lines', description: 'total = sum(lines)', severity: 'error' }]);
  });

  it('keeps the logical shape (name/type/required/primaryKey)', () => {
    expect(d.name).toBe('Order');
    expect(d.stereotype).toBe('aggregate-root');
    const id = d.attributes.find((a: any) => a.name === 'id');
    expect(id).toMatchObject({ type: 'uuid', required: true, primaryKey: true });
  });
});
