/**
 * physicalMapping (#grounding) — the SHARED attribute physical-mapping
 * normalization used by getSqlSchema (aiSql.ts) and getEntityDetails
 * (aiController.ts), so both tell the model the same story.
 *
 * Two authoring generations must both resolve:
 *  - reverse-engineered files: `physical.columnName`/`physical.dbType`
 *    metadata + the `Attribute.primaryKey` schema field
 *  - legacy hand-authored files (eshop sample): PK as `isPrimaryKey`
 *    attribute metadata, no column mapping at all
 */
import { metaValue, resolveAttributePhysical } from '../physicalMapping.js';

describe('metaValue', () => {
  const meta = [
    { name: 'physical.columnName', value: 'order_id' },
    { name: 'maxRows', value: 42 },
    { name: 'nullValue', value: null },
    { name: 'flag', value: false },
  ];

  it('returns the value of the named entry as a string', () => {
    expect(metaValue(meta, 'physical.columnName')).toBe('order_id');
  });

  it('stringifies non-string values', () => {
    expect(metaValue(meta, 'maxRows')).toBe('42');
    expect(metaValue(meta, 'flag')).toBe('false'); // false != null → stringified
  });

  it('returns undefined for a missing entry, a null value, or missing metadata', () => {
    expect(metaValue(meta, 'no.such.key')).toBeUndefined();
    expect(metaValue(meta, 'nullValue')).toBeUndefined();
    expect(metaValue(undefined, 'physical.columnName')).toBeUndefined();
    expect(metaValue([], 'physical.columnName')).toBeUndefined();
  });
});

describe('resolveAttributePhysical', () => {
  it('returns physical.columnName / physical.dbType metadata as-is', () => {
    const out = resolveAttributePhysical({
      metadata: [
        { name: 'physical.columnName', value: 'order_total' },
        { name: 'physical.dbType', value: 'DECIMAL(12,2)' },
      ],
    });
    expect(out.columnName).toBe('order_total');
    expect(out.dbType).toBe('DECIMAL(12,2)');
  });

  it('omits columnName/dbType entirely when no physical metadata exists', () => {
    const out = resolveAttributePhysical({ metadata: [{ name: 'other', value: 'x' }] });
    expect(out.columnName).toBeUndefined();
    expect(out.dbType).toBeUndefined();
    // the keys are omitted, not set to undefined — callers spread this object
    expect('columnName' in out).toBe(false);
    expect('dbType' in out).toBe(false);
  });

  it('handles an attribute with no metadata array at all', () => {
    expect(resolveAttributePhysical({})).toEqual({ primaryKey: false });
  });

  it('can return one of columnName/dbType without the other', () => {
    const out = resolveAttributePhysical({
      metadata: [{ name: 'physical.dbType', value: 'UUID' }],
    });
    expect(out.dbType).toBe('UUID');
    expect('columnName' in out).toBe(false);
  });

  describe('primaryKey resolution', () => {
    it('Attribute.primaryKey field true wins', () => {
      expect(resolveAttributePhysical({ primaryKey: true }).primaryKey).toBe(true);
    });

    it('field explicitly false wins over legacy metadata saying true (the schema field is authoritative)', () => {
      const out = resolveAttributePhysical({
        primaryKey: false,
        metadata: [{ name: 'isPrimaryKey', value: 'true' }],
      });
      expect(out.primaryKey).toBe(false);
    });

    it.each([
      ['true', true],
      ['yes', true],
      ['1', true],
      ['TRUE', true],   // case-insensitive
      ['Yes', true],
      [true, true],     // boolean metadata value
      [1, true],        // numeric 1 stringifies to '1'
      ['false', false],
      ['no', false],
      ['0', false],
      ['', false],
    ])('absent field + isPrimaryKey metadata %p → %p', (value, expected) => {
      const out = resolveAttributePhysical({
        metadata: [{ name: 'isPrimaryKey', value }],
      });
      expect(out.primaryKey).toBe(expected);
    });

    it('no field and no metadata → false', () => {
      expect(resolveAttributePhysical({ metadata: [] }).primaryKey).toBe(false);
      expect(resolveAttributePhysical({}).primaryKey).toBe(false);
    });
  });
});
