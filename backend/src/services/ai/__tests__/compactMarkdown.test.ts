import { entityDetailsToMarkdown, sqlSchemaToMarkdown } from '../compactMarkdown.js';

describe('compact AI Markdown', () => {
  it('renders entity details as readable tables and escapes cell delimiters', () => {
    const markdown = entityDetailsToMarkdown({
      name: 'Order', packageName: 'sales', description: 'Customer | order',
      physical: { schema: 'commerce', tableName: 'orders' },
      attributes: [{
        name: 'total', type: 'money', required: true, primaryKey: false,
        description: 'Gross total', validation: { min: 0 },
        physical: { columnName: 'total_amount', dbType: 'DECIMAL(12,2)' },
      }],
      constraints: [{ kind: 'check', expression: 'total >= 0' }],
      rules: [{ name: 'PositiveTotal', severity: 'error', description: 'Must be positive' }],
    });

    expect(markdown).toContain('# Order — `sales`');
    expect(markdown).toContain('Customer \\| order');
    expect(markdown).toContain('Physical table: `commerce.orders`');
    expect(markdown).toContain('| `total` | `money` | required | total_amount : DECIMAL(12,2) | `{"min":0}` | Gross total |');
    expect(markdown).toContain('**PositiveTotal** [error]: Must be positive');
  });

  it('is materially smaller than repetitive JSON for a large entity', () => {
    const details = {
      name: 'LargeEntity', packageName: 'large', description: 'Large test entity',
      attributes: Array.from({ length: 200 }, (_, i) => ({
        name: `field${i}`, type: 'string', required: true, primaryKey: false,
        physical: { columnName: `field_${i}`, dbType: 'VARCHAR(255)' },
      })),
    };
    const markdown = entityDetailsToMarkdown(details);
    expect(Buffer.byteLength(markdown)).toBeLessThan(Buffer.byteLength(JSON.stringify(details)) * 0.75);
  });

  it('renders physical SQL tables, columns, relationships and mapping warnings', () => {
    const markdown = sqlSchemaToMarkdown({
      dialect: 'postgres', scope: 'entities: Order',
      tables: [{
        entity: 'Order', package: 'ordering', qualifiedName: 'commerce.orders',
        columns: [{ attribute: 'id', column: 'order_id', dbType: 'UUID', nullable: false, primaryKey: true }],
      }],
      relationships: [{ from: 'Customer', fromCardinality: 'one', to: 'Order', toCardinality: 'many', description: 'places' }],
      note: 'Use physical names.',
    });
    expect(markdown).toContain('# Physical SQL schema');
    expect(markdown).toContain('## Order — `commerce.orders`');
    expect(markdown).toContain('| `id` | `order_id` | `UUID` | PK, required |');
    expect(markdown).toContain('| `Customer` | one | `Order` | many | places |');
  });
});
