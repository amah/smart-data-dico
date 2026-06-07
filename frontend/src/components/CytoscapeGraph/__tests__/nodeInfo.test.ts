/**
 * nodeInfo.test.ts (#188)
 *
 * The info-panel payload differs by view mode:
 *   - logical: attribute ORM facts (@Id / @GeneratedValue / @Enumerated / @Embedded);
 *   - physical: columns (name + dbType) with PK/FK/UQ flags + constraints[];
 *   - structural: name · type · PK · required (unchanged).
 */
import { describe, it, expect } from 'vitest';
import type { Attribute, PhysicalConstraint } from '../../../types';
import { AttributeType } from '../../../types';
import { buildNodeInfo, logicalAttrFacts, physicalColumn, columnName, structuralTypeLabel } from '../nodeInfo';

const ID: Attribute = {
  uuid: 'a1',
  name: 'id',
  description: '',
  type: AttributeType.STRING,
  required: true,
  unique: true,
  metadata: [
    { name: 'isPrimaryKey', value: true },
    { name: 'orm.generatedValue', value: 'UUID' },
    { name: 'physical.dbType', value: 'uuid' },
  ],
};

const STATUS: Attribute = {
  uuid: 'a2',
  name: 'status',
  description: '',
  type: AttributeType.ENUM,
  required: true,
  metadata: [
    { name: 'orm.enumerated', value: 'STRING' },
    { name: 'orm.javaType', value: 'OrderStatus' },
    { name: 'physical.dbType', value: 'VARCHAR(32)' },
  ],
};

const USER_ID: Attribute = {
  uuid: 'a3',
  name: 'userId',
  description: '',
  type: AttributeType.STRING,
  required: true,
  metadata: [
    { name: 'isForeignKey', value: true },
    { name: 'physical.columnName', value: 'user_id' },
    { name: 'physical.dbType', value: 'uuid' },
  ],
};

const CONSTRAINTS: PhysicalConstraint[] = [
  { kind: 'unique', name: 'uq_order_no', columns: ['order_number'] },
  { kind: 'foreignKey', name: 'fk_user', columns: ['user_id'], references: { table: 'users', columns: ['id'] } },
  { kind: 'check', name: 'chk_total', expression: 'total >= 0' },
];

describe('structuralTypeLabel', () => {
  const objAttr = (javaType?: string): Attribute => ({
    uuid: 'o1',
    name: 'shippingAddress',
    description: '',
    type: AttributeType.OBJECT,
    required: true,
    metadata: javaType ? [{ name: 'orm.javaType', value: javaType }] : [],
  });

  it('replaces object with the embeddable type from orm.javaType', () => {
    expect(structuralTypeLabel(objAttr('Address'))).toBe('Address');
  });

  it('keeps "object" when no orm.javaType is set', () => {
    expect(structuralTypeLabel(objAttr())).toBe('object');
  });

  it('suffixes [] for array (collection) attributes', () => {
    const arr: Attribute = {
      uuid: 'a',
      name: 'lines',
      description: '',
      type: AttributeType.ARRAY,
      required: true,
      items: { uuid: 'i', name: 'item', description: '', type: AttributeType.OBJECT, required: true, metadata: [{ name: 'orm.javaType', value: 'Address' }] },
    };
    expect(structuralTypeLabel(arr)).toBe('Address[]');
  });

  it('leaves scalar types untouched', () => {
    expect(structuralTypeLabel(ID)).toBe('string');
  });
});

describe('logical facts', () => {
  it('derives ORM annotations per attribute', () => {
    expect(logicalAttrFacts(ID)).toEqual({ name: 'id', javaType: '', facts: ['@Id', '@GeneratedValue: UUID'] });
    expect(logicalAttrFacts(STATUS)).toEqual({
      name: 'status',
      javaType: 'OrderStatus',
      facts: ['@Enumerated: STRING'],
    });
  });
});

describe('physical columns', () => {
  it('uses physical.columnName, dbType and PK/FK/UQ flags', () => {
    expect(columnName(USER_ID)).toBe('user_id');
    const fkCols = new Set(['user_id']);
    const uqCols = new Set(['order_number']);
    expect(physicalColumn(ID, fkCols, uqCols)).toEqual({ name: 'id', dbType: 'uuid', flags: ['PK', 'UQ'] });
    expect(physicalColumn(USER_ID, fkCols, uqCols)).toEqual({ name: 'user_id', dbType: 'uuid', flags: ['FK'] });
  });
});

describe('buildNodeInfo dispatch', () => {
  const attrs = [ID, STATUS, USER_ID];

  it('logical → ORM facts', () => {
    const info = buildNodeInfo('logical', attrs, CONSTRAINTS);
    expect(info.mode).toBe('logical');
    if (info.mode !== 'logical') throw new Error('mode');
    expect(info.attributes.find((a) => a.name === 'id')!.facts).toContain('@Id');
    expect((info as any).columns).toBeUndefined();
  });

  it('physical → columns + constraints with flags from constraints[]', () => {
    const info = buildNodeInfo('physical', attrs, CONSTRAINTS);
    if (info.mode !== 'physical') throw new Error('mode');
    // FK/UQ flags derived from constraint columns
    expect(info.columns.find((c) => c.name === 'user_id')!.flags).toContain('FK');
    expect(info.constraints.map((c) => c.kind).sort()).toEqual(['check', 'foreignKey', 'unique']);
    const fk = info.constraints.find((c) => c.kind === 'foreignKey')!;
    expect(fk.label).toContain('users');
  });

  it('physical → flattens an @Embedded field into the owner table columns', () => {
    const shipping: Attribute = {
      uuid: 's',
      name: 'shippingAddress',
      description: '',
      type: AttributeType.OBJECT,
      required: true,
      metadata: [
        { name: 'orm.embedded', value: true },
        { name: 'orm.javaType', value: 'Address' },
      ],
    };
    const addressFields: Attribute[] = [
      { uuid: 'f1', name: 'fullName', description: '', type: AttributeType.STRING, required: true },
      { uuid: 'f2', name: 'street', description: '', type: AttributeType.STRING, required: true },
    ];
    const embeddables = new Map([['Address', addressFields]]);
    const info = buildNodeInfo('physical', [ID, shipping], [], embeddables);
    if (info.mode !== 'physical') throw new Error('mode');
    const names = info.columns.map((c) => c.name);
    expect(names).toContain('id'); // plain column kept
    expect(names).toContain('shippingAddress.fullName'); // embeddable flattened + prefixed
    expect(names).toContain('shippingAddress.street');
    expect(names).not.toContain('shippingAddress'); // not shown as a single object column
  });

  it('physical → leaves @Embedded as a single column when the embeddable is unknown', () => {
    const shipping: Attribute = {
      uuid: 's',
      name: 'shippingAddress',
      description: '',
      type: AttributeType.OBJECT,
      required: true,
      metadata: [{ name: 'orm.embedded', value: true }, { name: 'orm.javaType', value: 'Address' }],
    };
    const info = buildNodeInfo('physical', [shipping], [], new Map()); // no embeddable index
    if (info.mode !== 'physical') throw new Error('mode');
    expect(info.columns.map((c) => c.name)).toEqual(['shippingAddress']);
  });

  it('structural → name · type · PK · required (unchanged shape)', () => {
    const info = buildNodeInfo('structural', attrs, CONSTRAINTS);
    if (info.mode !== 'structural') throw new Error('mode');
    expect(info.attributes[0]).toEqual({ name: 'id', type: 'string', primaryKey: true, required: true });
    expect((info as any).constraints).toBeUndefined();
  });

  it('undefined view mode defaults to structural', () => {
    expect(buildNodeInfo(undefined, attrs).mode).toBe('structural');
  });

  it('payloads genuinely differ across modes', () => {
    const l = buildNodeInfo('logical', attrs, CONSTRAINTS);
    const p = buildNodeInfo('physical', attrs, CONSTRAINTS);
    const s = buildNodeInfo('structural', attrs, CONSTRAINTS);
    expect(l).not.toEqual(p);
    expect(p).not.toEqual(s);
    expect(l).not.toEqual(s);
  });
});
