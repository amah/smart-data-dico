/**
 * Tests for the impact diff engine (#89).
 */
import { buildImpactDiff } from '../impactDiff.js';
import { diffPhysicalModel } from '../physicalDiff.js';
import { Entity, AttributeType, EntityStatus, MetadataEntry } from '../../models/EntitySchema.js';

jest.mock('../../utils/logger');

let counter = 0;
const nextId = () => `uuid-${++counter}`;
beforeEach(() => { counter = 0; });

function attr(opts: { name: string; columnName?: string; type?: AttributeType; dbType?: string; required?: boolean; primaryKey?: boolean; nullable?: boolean }) {
  const metadata: MetadataEntry[] = [];
  if (opts.columnName) {
    metadata.push({ name: 'physical.columnName', value: opts.columnName });
    if (opts.dbType) metadata.push({ name: 'physical.dbType', value: opts.dbType });
    if (opts.nullable !== undefined) metadata.push({ name: 'physical.nullable', value: opts.nullable });
  }
  return {
    uuid: nextId(), name: opts.name, description: '',
    type: opts.type || AttributeType.STRING, required: opts.required ?? true,
    primaryKey: opts.primaryKey,
    metadata: metadata.length > 0 ? metadata : undefined,
  };
}

function entity(opts: { name: string; tableName?: string; attributes: any[]; constraints?: any[] }): Entity {
  const metadata: MetadataEntry[] = [];
  if (opts.tableName) metadata.push({ name: 'physical.tableName', value: opts.tableName });
  return {
    uuid: nextId(), name: opts.name, description: '', status: EntityStatus.DRAFT,
    attributes: opts.attributes, metadata: metadata.length > 0 ? metadata : undefined,
    constraints: opts.constraints,
  };
}

describe('buildImpactDiff (#89)', () => {
  it('generates ADD COLUMN for model columns not in DB (orphaned in physical diff)', () => {
    const model = [entity({
      name: 'Order', tableName: 'orders', attributes: [
        attr({ name: 'id', columnName: 'id', dbType: 'INT', required: true }),
        attr({ name: 'discount', columnName: 'discount_code', dbType: 'VARCHAR(20)', required: false, nullable: true }),
      ],
    })];
    const source = [entity({
      name: 'Order', tableName: 'orders', attributes: [
        attr({ name: 'id', columnName: 'id', dbType: 'INT', required: true }),
      ],
    })];
    const physDiff = diffPhysicalModel(model, source);
    const impact = buildImpactDiff(physDiff);
    const addCol = impact.operations.find(o => o.type === 'ADD_COLUMN');
    expect(addCol).toBeDefined();
    expect(addCol!.column).toBe('discount_code');
    expect(addCol!.risk).toBe('safe');
    expect(addCol!.sql).toContain('ADD COLUMN discount_code VARCHAR(20)');
  });

  it('flags ADD COLUMN NOT NULL as destructive', () => {
    const model = [entity({
      name: 'Order', tableName: 'orders', attributes: [
        attr({ name: 'id', columnName: 'id', dbType: 'INT' }),
        attr({ name: 'status', columnName: 'status', dbType: 'VARCHAR(20)', required: true, nullable: false }),
      ],
    })];
    const source = [entity({
      name: 'Order', tableName: 'orders', attributes: [
        attr({ name: 'id', columnName: 'id', dbType: 'INT' }),
      ],
    })];
    const physDiff = diffPhysicalModel(model, source);
    const impact = buildImpactDiff(physDiff);
    const addCol = impact.operations.find(o => o.type === 'ADD_COLUMN');
    expect(addCol!.risk).toBe('destructive');
    expect(addCol!.riskReason).toContain('NOT NULL');
  });

  it('generates DROP COLUMN for DB columns not in model (dbOnly in physical diff)', () => {
    const model = [entity({
      name: 'Order', tableName: 'orders', attributes: [
        attr({ name: 'id', columnName: 'id', dbType: 'INT' }),
      ],
    })];
    const source = [entity({
      name: 'Order', tableName: 'orders', attributes: [
        attr({ name: 'id', columnName: 'id', dbType: 'INT' }),
        attr({ name: 'oldCol', columnName: 'old_col', dbType: 'VARCHAR(50)' }),
      ],
    })];
    const physDiff = diffPhysicalModel(model, source);
    const impact = buildImpactDiff(physDiff);
    const dropCol = impact.operations.find(o => o.type === 'DROP_COLUMN');
    expect(dropCol).toBeDefined();
    expect(dropCol!.risk).toBe('destructive');
  });

  it('generates ALTER COLUMN for drifted attrs', () => {
    const model = [entity({
      name: 'Order', tableName: 'orders', attributes: [
        attr({ name: 'total', columnName: 'total', type: AttributeType.NUMBER, dbType: 'DECIMAL(10,2)' }),
      ],
    })];
    const source = [entity({
      name: 'Order', tableName: 'orders', attributes: [
        attr({ name: 'total', columnName: 'total', type: AttributeType.INTEGER, dbType: 'BIGINT' }),
      ],
    })];
    const physDiff = diffPhysicalModel(model, source);
    const impact = buildImpactDiff(physDiff);
    const alterCol = impact.operations.find(o => o.type === 'ALTER_COLUMN');
    expect(alterCol).toBeDefined();
    expect(alterCol!.sql).toContain('ALTER COLUMN total TYPE DECIMAL(10,2)');
  });

  it('generates ADD COLUMN ops for entity whose table is not in source', () => {
    // When the model has a table not in source, physicalDiff marks all physical
    // attrs as 'orphaned' → impact generates ADD COLUMN for each
    const model = [entity({
      name: 'Discount', tableName: 'discounts', attributes: [
        attr({ name: 'id', columnName: 'id', dbType: 'INT', primaryKey: true }),
        attr({ name: 'code', columnName: 'code', dbType: 'VARCHAR(20)', nullable: false }),
      ],
    })];
    const source: Entity[] = [];
    const physDiff = diffPhysicalModel(model, source);
    const impact = buildImpactDiff(physDiff);
    const addCols = impact.operations.filter(o => o.type === 'ADD_COLUMN');
    expect(addCols).toHaveLength(2);
    expect(addCols.map(o => o.column).sort()).toEqual(['code', 'id']);
  });

  it('orders operations: DROP FK before DROP COLUMN before ADD COLUMN before ADD FK', () => {
    // Model has new_col + fk_new; source has old_col + fk_old
    // Impact should: DROP fk_old → DROP old_col → ADD new_col → ADD fk_new
    const model = [entity({
      name: 'Order', tableName: 'orders',
      attributes: [
        attr({ name: 'id', columnName: 'id', dbType: 'INT' }),
        attr({ name: 'newCol', columnName: 'new_col', dbType: 'VARCHAR(20)', nullable: true }),
      ],
      constraints: [{ kind: 'foreignKey', name: 'fk_new', columns: ['new_col'], references: { table: 'other', columns: ['id'] } }],
    })];
    const source = [entity({
      name: 'Order', tableName: 'orders',
      attributes: [
        attr({ name: 'id', columnName: 'id', dbType: 'INT' }),
        attr({ name: 'oldCol', columnName: 'old_col', dbType: 'VARCHAR(50)' }),
      ],
      constraints: [{ kind: 'foreignKey', name: 'fk_old', columns: ['old_col'], references: { table: 'other', columns: ['id'] } }],
    })];
    const physDiff = diffPhysicalModel(model, source);
    const impact = buildImpactDiff(physDiff);
    const types = impact.operations.map(o => o.type);
    // fk_old is in source but not model → should be DROP_CONSTRAINT (removed)
    // old_col is in source but not model → DROP_COLUMN (dbOnly)
    // new_col is in model but not source → ADD_COLUMN (orphaned)
    // fk_new is in model but not source → ADD_FOREIGN_KEY (removed from source side)
    const dropFkIdx = types.findIndex(t => t === 'DROP_FOREIGN_KEY' || t === 'DROP_CONSTRAINT');
    const dropColIdx = types.indexOf('DROP_COLUMN');
    const addColIdx = types.indexOf('ADD_COLUMN');
    const addFkIdx = types.indexOf('ADD_FOREIGN_KEY');
    if (dropFkIdx >= 0 && dropColIdx >= 0) expect(dropFkIdx).toBeLessThan(dropColIdx);
    if (dropColIdx >= 0 && addColIdx >= 0) expect(dropColIdx).toBeLessThan(addColIdx);
    if (addColIdx >= 0 && addFkIdx >= 0) expect(addColIdx).toBeLessThan(addFkIdx);
  });

  it('generates dialect-specific SQL for MySQL', () => {
    const model = [entity({
      name: 'Order', tableName: 'orders', attributes: [
        attr({ name: 'total', columnName: 'total', type: AttributeType.NUMBER, dbType: 'DECIMAL(12,2)' }),
      ],
    })];
    const source = [entity({
      name: 'Order', tableName: 'orders', attributes: [
        attr({ name: 'total', columnName: 'total', type: AttributeType.NUMBER, dbType: 'DECIMAL(10,2)' }),
      ],
    })];
    const physDiff = diffPhysicalModel(model, source);
    const impact = buildImpactDiff(physDiff, 'mysql');
    const alter = impact.operations.find(o => o.type === 'ALTER_COLUMN');
    expect(alter!.sql).toContain('MODIFY COLUMN');
  });

  it('computes summary correctly', () => {
    // Model: id + new_col (orphaned → ADD)  +  old_col (orphaned → ADD)
    // Source: id + old_col2 (dbOnly → DROP)
    const model = [entity({
      name: 'Order', tableName: 'orders', attributes: [
        attr({ name: 'id', columnName: 'id', dbType: 'INT' }),
        attr({ name: 'newCol', columnName: 'new_col', dbType: 'VARCHAR(20)', nullable: true }),
      ],
    })];
    const source = [entity({
      name: 'Order', tableName: 'orders', attributes: [
        attr({ name: 'id', columnName: 'id', dbType: 'INT' }),
        attr({ name: 'oldCol2', columnName: 'old_col2', dbType: 'VARCHAR(50)' }),
      ],
    })];
    const physDiff = diffPhysicalModel(model, source);
    const impact = buildImpactDiff(physDiff);
    expect(impact.summary.columns.added).toBe(1);    // new_col (model has, DB doesn't)
    expect(impact.summary.columns.dropped).toBe(1);   // old_col2 (DB has, model doesn't)
  });
});
