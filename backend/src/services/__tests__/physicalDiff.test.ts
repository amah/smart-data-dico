/**
 * Tests for the physical model diff engine (#88).
 */
import { diffPhysicalModel } from '../physicalDiff.js';
import { Entity, Attribute, AttributeType, EntityStatus, MetadataEntry } from '../../models/EntitySchema.js';

jest.mock('../../utils/logger');

let counter = 0;
const nextId = () => `uuid-${++counter}`;
beforeEach(() => { counter = 0; });

function buildAttr(opts: {
  uuid?: string; name?: string; type?: AttributeType; required?: boolean; primaryKey?: boolean;
  columnName?: string; dbType?: string; nullable?: boolean;
}): Attribute {
  const metadata: MetadataEntry[] = [];
  if (opts.columnName) {
    metadata.push({ name: 'physical.columnName', value: opts.columnName });
    if (opts.dbType) metadata.push({ name: 'physical.dbType', value: opts.dbType });
    if (opts.nullable !== undefined) metadata.push({ name: 'physical.nullable', value: opts.nullable });
  }
  return {
    uuid: opts.uuid || nextId(),
    name: opts.name || 'attr',
    description: '',
    type: opts.type || AttributeType.STRING,
    required: opts.required ?? true,
    primaryKey: opts.primaryKey,
    metadata: metadata.length > 0 ? metadata : undefined,
  };
}

function buildEntity(opts: {
  uuid?: string; name?: string; tableName?: string; attributes?: Attribute[];
  constraints?: any[];
}): Entity {
  const metadata: MetadataEntry[] = [];
  if (opts.tableName) metadata.push({ name: 'physical.tableName', value: opts.tableName });
  return {
    uuid: opts.uuid || nextId(),
    name: opts.name || 'Entity',
    description: '',
    status: EntityStatus.DRAFT,
    attributes: opts.attributes || [],
    metadata: metadata.length > 0 ? metadata : undefined,
    constraints: opts.constraints,
  };
}

describe('diffPhysicalModel (#88)', () => {
  describe('entity-level gaps', () => {
    it('detects model-only entities (no physical.tableName)', () => {
      const model = [buildEntity({ name: 'ModelOnly' })]; // no tableName
      const diff = diffPhysicalModel(model, []);
      expect(diff.entities[0].status).toBe('modelOnly');
      expect(diff.summary.entities.modelOnly).toBe(1);
    });

    it('detects DB-only entities (source table not in model)', () => {
      const source = [buildEntity({ tableName: 'new_table', attributes: [buildAttr({ columnName: 'id' })] })];
      const diff = diffPhysicalModel([], source);
      expect(diff.entities[0].status).toBe('dbOnly');
      expect(diff.summary.entities.dbOnly).toBe(1);
    });

    it('matches entities by physical.tableName (case-insensitive)', () => {
      const model = [buildEntity({ tableName: 'Orders', attributes: [buildAttr({ columnName: 'id' })] })];
      const source = [buildEntity({ tableName: 'orders', attributes: [buildAttr({ columnName: 'id' })] })];
      const diff = diffPhysicalModel(model, source);
      expect(diff.entities[0].status).toBe('matched');
    });
  });

  describe('attribute-level gaps', () => {
    it('detects matched attributes', () => {
      const model = [buildEntity({
        tableName: 'orders',
        attributes: [buildAttr({ columnName: 'id', type: AttributeType.INTEGER, dbType: 'INT' })],
      })];
      const source = [buildEntity({
        tableName: 'orders',
        attributes: [buildAttr({ columnName: 'id', type: AttributeType.INTEGER, dbType: 'INT' })],
      })];
      const diff = diffPhysicalModel(model, source);
      expect(diff.entities[0].attributes[0].status).toBe('matched');
      expect(diff.summary.matched).toBe(1);
    });

    it('detects model-only attributes (no physical.columnName)', () => {
      const model = [buildEntity({
        tableName: 'orders',
        attributes: [
          buildAttr({ columnName: 'id' }),
          buildAttr({ name: 'designAhead' }), // no columnName
        ],
      })];
      const source = [buildEntity({
        tableName: 'orders',
        attributes: [buildAttr({ columnName: 'id' })],
      })];
      const diff = diffPhysicalModel(model, source);
      const attrs = diff.entities[0].attributes;
      expect(attrs.find(a => a.attributeName === 'designAhead')!.status).toBe('modelOnly');
      expect(diff.summary.modelOnly).toBe(1);
    });

    it('detects orphaned attributes (model maps to missing column)', () => {
      const model = [buildEntity({
        tableName: 'orders',
        attributes: [
          buildAttr({ columnName: 'id' }),
          buildAttr({ columnName: 'old_column', name: 'oldColumn' }),
        ],
      })];
      const source = [buildEntity({
        tableName: 'orders',
        attributes: [buildAttr({ columnName: 'id' })],
      })];
      const diff = diffPhysicalModel(model, source);
      expect(diff.entities[0].attributes.find(a => a.attributeName === 'oldColumn')!.status).toBe('orphaned');
      expect(diff.summary.orphaned).toBe(1);
    });

    it('detects DB-only columns (source column not in model)', () => {
      const model = [buildEntity({
        tableName: 'orders',
        attributes: [buildAttr({ columnName: 'id' })],
      })];
      const source = [buildEntity({
        tableName: 'orders',
        attributes: [
          buildAttr({ columnName: 'id' }),
          buildAttr({ columnName: 'created_by', name: 'createdBy' }),
        ],
      })];
      const diff = diffPhysicalModel(model, source);
      expect(diff.entities[0].attributes.find(a => a.physicalColumnName === 'created_by')!.status).toBe('dbOnly');
      expect(diff.summary.dbOnly).toBe(1);
    });

    it('detects type drift', () => {
      const model = [buildEntity({
        tableName: 'orders',
        attributes: [buildAttr({ columnName: 'total', type: AttributeType.NUMBER, dbType: 'DECIMAL(10,2)' })],
      })];
      const source = [buildEntity({
        tableName: 'orders',
        attributes: [buildAttr({ columnName: 'total', type: AttributeType.INTEGER, dbType: 'BIGINT' })],
      })];
      const diff = diffPhysicalModel(model, source);
      const attr = diff.entities[0].attributes[0];
      expect(attr.status).toBe('drifted');
      expect(attr.driftFields).toContain('type');
      expect(attr.driftFields).toContain('physical.dbType');
      expect(diff.summary.drifted).toBe(1);
    });

    it('detects nullable drift', () => {
      const model = [buildEntity({
        tableName: 'orders',
        attributes: [buildAttr({ columnName: 'notes', required: false, nullable: true })],
      })];
      const source = [buildEntity({
        tableName: 'orders',
        attributes: [buildAttr({ columnName: 'notes', required: true, nullable: false })],
      })];
      const diff = diffPhysicalModel(model, source);
      expect(diff.entities[0].attributes[0].status).toBe('drifted');
      expect(diff.entities[0].attributes[0].driftFields).toContain('required');
    });
  });

  describe('constraint gaps', () => {
    it('detects constraints added in source', () => {
      const model = [buildEntity({ tableName: 'orders', attributes: [buildAttr({ columnName: 'id' })] })];
      const source = [buildEntity({
        tableName: 'orders',
        attributes: [buildAttr({ columnName: 'id' })],
        constraints: [{ kind: 'unique', name: 'uq_id', columns: ['id'] }],
      })];
      const diff = diffPhysicalModel(model, source);
      expect(diff.entities[0].constraints[0].status).toBe('added');
    });

    it('detects constraints removed from source', () => {
      const model = [buildEntity({
        tableName: 'orders',
        attributes: [buildAttr({ columnName: 'id' })],
        constraints: [{ kind: 'unique', name: 'uq_id', columns: ['id'] }],
      })];
      const source = [buildEntity({ tableName: 'orders', attributes: [buildAttr({ columnName: 'id' })] })];
      const diff = diffPhysicalModel(model, source);
      expect(diff.entities[0].constraints[0].status).toBe('removed');
    });
  });

  describe('summary', () => {
    it('aggregates all gap types correctly', () => {
      const model = [buildEntity({
        tableName: 'orders',
        attributes: [
          buildAttr({ columnName: 'id', type: AttributeType.INTEGER }),
          buildAttr({ columnName: 'old_col', name: 'oldCol' }),
          buildAttr({ name: 'designOnly' }), // model-only
          buildAttr({ columnName: 'total', type: AttributeType.NUMBER, dbType: 'DECIMAL(10,2)' }),
        ],
      })];
      const source = [buildEntity({
        tableName: 'orders',
        attributes: [
          buildAttr({ columnName: 'id', type: AttributeType.INTEGER }),
          buildAttr({ columnName: 'new_col', name: 'newCol' }),
          buildAttr({ columnName: 'total', type: AttributeType.INTEGER, dbType: 'BIGINT' }),
        ],
      })];
      const diff = diffPhysicalModel(model, source);
      expect(diff.summary.matched).toBe(1);    // id
      expect(diff.summary.orphaned).toBe(1);    // old_col
      expect(diff.summary.modelOnly).toBe(1);   // designOnly
      expect(diff.summary.dbOnly).toBe(1);       // new_col
      expect(diff.summary.drifted).toBe(1);      // total
    });
  });
});
