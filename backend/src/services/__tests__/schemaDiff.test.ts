/**
 * Tests for the schema diff + merge logic (#69 C2).
 *
 * Validates the three invariants:
 *   1. Lookup is by physical metadata, not display name
 *   2. Never overwrite user content (description, non-physical metadata)
 *   3. Model-only attributes are sacred
 */
import { diffEntities, mergeEntities, diffPhysicalConstraints, diffRelationships, mergeRelationships } from '../schemaDiff.js';
import { Entity, Attribute, AttributeType, EntityStatus, MetadataEntry, PhysicalConstraint, Relationship, Cardinality } from '../../models/EntitySchema.js';

jest.mock('../../utils/logger');

// ────────────────────────────────────────────────────────────────────────
// Builders
// ────────────────────────────────────────────────────────────────────────

let attrCounter = 0;
let entityCounter = 0;
const nextUuid = (prefix: string) => `${prefix}-${++attrCounter}`;
const nextEntityUuid = () => `ent-${++entityCounter}`;

interface AttrOpts {
  uuid?: string;
  name?: string;
  type?: AttributeType;
  required?: boolean;
  primaryKey?: boolean;
  description?: string;
  /** Set physical.columnName + physical.dbType + physical.nullable */
  physical?: { columnName: string; dbType?: string; nullable?: boolean };
  /** Extra metadata entries (e.g. user-authored, non-physical) */
  metadata?: MetadataEntry[];
}

function buildAttr(opts: AttrOpts = {}): Attribute {
  const metadata: MetadataEntry[] = [];
  if (opts.physical) {
    metadata.push({ name: 'physical.columnName', value: opts.physical.columnName });
    if (opts.physical.dbType !== undefined) {
      metadata.push({ name: 'physical.dbType', value: opts.physical.dbType });
    }
    if (opts.physical.nullable !== undefined) {
      metadata.push({ name: 'physical.nullable', value: opts.physical.nullable });
    }
  }
  if (opts.metadata) metadata.push(...opts.metadata);
  return {
    uuid: opts.uuid || nextUuid('attr'),
    name: opts.name || 'col',
    description: opts.description || '',
    type: opts.type || AttributeType.STRING,
    required: opts.required ?? true,
    primaryKey: opts.primaryKey,
    metadata: metadata.length ? metadata : undefined,
  };
}

interface EntityOpts {
  uuid?: string;
  name?: string;
  description?: string;
  /** Set physical.tableName */
  physicalTableName?: string;
  /** Extra entity-level metadata */
  metadata?: MetadataEntry[];
  attributes?: Attribute[];
}

function buildEntity(opts: EntityOpts = {}): Entity {
  const metadata: MetadataEntry[] = [];
  if (opts.physicalTableName) {
    metadata.push({ name: 'physical.tableName', value: opts.physicalTableName });
  }
  if (opts.metadata) metadata.push(...opts.metadata);
  return {
    uuid: opts.uuid || nextEntityUuid(),
    name: opts.name || 'Entity',
    description: opts.description || '',
    status: EntityStatus.DRAFT,
    attributes: opts.attributes || [],
    metadata: metadata.length ? metadata : undefined,
  };
}

beforeEach(() => {
  attrCounter = 0;
  entityCounter = 0;
});

// ────────────────────────────────────────────────────────────────────────
// diffEntities — entity-level statuses
// ────────────────────────────────────────────────────────────────────────

describe('diffEntities — entity statuses', () => {
  it('returns added when source has a table not in existing', () => {
    const source = [
      buildEntity({
        name: 'Orders',
        physicalTableName: 'orders',
        attributes: [buildAttr({ name: 'id', physical: { columnName: 'id' } })],
      }),
    ];
    const diffs = diffEntities(source, []);
    expect(diffs).toHaveLength(1);
    expect(diffs[0].status).toBe('added');
    expect(diffs[0].counts.added).toBe(1);
  });

  it('returns unchanged when source and existing match exactly (no attribute diffs)', () => {
    const physicalAttr = { columnName: 'id', dbType: 'INT', nullable: false };
    const source = [
      buildEntity({
        physicalTableName: 'orders',
        attributes: [
          buildAttr({ name: 'id', type: AttributeType.INTEGER, required: true, physical: physicalAttr }),
        ],
      }),
    ];
    const existing = [
      buildEntity({
        name: 'Orders',  // user may have renamed; doesn't matter
        physicalTableName: 'orders',
        attributes: [
          buildAttr({ name: 'id', type: AttributeType.INTEGER, required: true, physical: physicalAttr }),
        ],
      }),
    ];
    const diffs = diffEntities(source, existing);
    expect(diffs).toHaveLength(1);
    expect(diffs[0].status).toBe('unchanged');
  });

  it('returns changed when source has different attributes than existing', () => {
    const source = [
      buildEntity({
        physicalTableName: 'orders',
        attributes: [
          buildAttr({ name: 'id', physical: { columnName: 'id' } }),
          buildAttr({ name: 'newCol', physical: { columnName: 'new_col' } }),
        ],
      }),
    ];
    const existing = [
      buildEntity({
        physicalTableName: 'orders',
        attributes: [
          buildAttr({ name: 'id', physical: { columnName: 'id' } }),
        ],
      }),
    ];
    const diffs = diffEntities(source, existing);
    expect(diffs[0].status).toBe('changed');
    expect(diffs[0].counts.added).toBe(1);
    expect(diffs[0].counts.unchanged).toBe(1);
  });

  it('returns removedInSource when existing has a physical table not in source', () => {
    const existing = [
      buildEntity({
        physicalTableName: 'old_table',
        attributes: [buildAttr({ physical: { columnName: 'id' } })],
      }),
    ];
    const diffs = diffEntities([], existing);
    expect(diffs).toHaveLength(1);
    expect(diffs[0].status).toBe('removedInSource');
  });

  it('does NOT include pure model-only entities (no physical.tableName) in the diff', () => {
    const existing = [
      buildEntity({ name: 'ModelOnly' }), // no physical.tableName
    ];
    const diffs = diffEntities([], existing);
    expect(diffs).toHaveLength(0);
  });
});

// ────────────────────────────────────────────────────────────────────────
// diffEntities — attribute-level statuses
// ────────────────────────────────────────────────────────────────────────

describe('diffEntities — attribute statuses', () => {
  it('marks an attribute as added when no matching physical.columnName exists', () => {
    const source = [
      buildEntity({
        physicalTableName: 'orders',
        attributes: [
          buildAttr({ physical: { columnName: 'id' } }),
          buildAttr({ physical: { columnName: 'total' } }),
        ],
      }),
    ];
    const existing = [
      buildEntity({
        physicalTableName: 'orders',
        attributes: [buildAttr({ physical: { columnName: 'id' } })],
      }),
    ];
    const diffs = diffEntities(source, existing);
    const totalDiff = diffs[0].attributes.find(a => a.source?.metadata?.some(m => m.value === 'total'));
    expect(totalDiff?.status).toBe('added');
  });

  it('marks an attribute as changed when physical.dbType differs', () => {
    const source = [
      buildEntity({
        physicalTableName: 'orders',
        attributes: [buildAttr({ physical: { columnName: 'name', dbType: 'VARCHAR(200)' } })],
      }),
    ];
    const existing = [
      buildEntity({
        physicalTableName: 'orders',
        attributes: [buildAttr({ physical: { columnName: 'name', dbType: 'VARCHAR(100)' } })],
      }),
    ];
    const diffs = diffEntities(source, existing);
    const ad = diffs[0].attributes[0];
    expect(ad.status).toBe('changed');
    expect(ad.changedFields).toContain('physical.dbType');
  });

  it('marks an attribute as changed when type differs', () => {
    const source = [
      buildEntity({
        physicalTableName: 'orders',
        attributes: [buildAttr({ type: AttributeType.UUID, physical: { columnName: 'id' } })],
      }),
    ];
    const existing = [
      buildEntity({
        physicalTableName: 'orders',
        attributes: [buildAttr({ type: AttributeType.STRING, physical: { columnName: 'id' } })],
      }),
    ];
    const diffs = diffEntities(source, existing);
    expect(diffs[0].attributes[0].status).toBe('changed');
    expect(diffs[0].attributes[0].changedFields).toContain('type');
  });

  it('marks an attribute as removedInSource when existing has physical.columnName but source doesn’t', () => {
    const source = [
      buildEntity({
        physicalTableName: 'orders',
        attributes: [buildAttr({ physical: { columnName: 'id' } })],
      }),
    ];
    const existing = [
      buildEntity({
        physicalTableName: 'orders',
        attributes: [
          buildAttr({ physical: { columnName: 'id' } }),
          buildAttr({ name: 'oldCol', physical: { columnName: 'old_col' } }),
        ],
      }),
    ];
    const diffs = diffEntities(source, existing);
    const oldDiff = diffs[0].attributes.find(a => a.existing?.name === 'oldCol');
    expect(oldDiff?.status).toBe('removedInSource');
  });

  it('marks an attribute as modelOnly when it has no physical.columnName', () => {
    const source = [
      buildEntity({
        physicalTableName: 'orders',
        attributes: [buildAttr({ physical: { columnName: 'id' } })],
      }),
    ];
    const existing = [
      buildEntity({
        physicalTableName: 'orders',
        attributes: [
          buildAttr({ physical: { columnName: 'id' } }),
          buildAttr({ name: 'designAhead' /* no physical */ }),
        ],
      }),
    ];
    const diffs = diffEntities(source, existing);
    const modelOnly = diffs[0].attributes.find(a => a.existing?.name === 'designAhead');
    expect(modelOnly?.status).toBe('modelOnly');
    // And NOT counted as removedInSource
    expect(diffs[0].counts.removedInSource).toBe(0);
    expect(diffs[0].counts.modelOnly).toBe(1);
  });

  it('does not falsely flag a model-only attribute when re-importing the same source', () => {
    const physical = { columnName: 'id' };
    const sourceAttrs = [buildAttr({ physical })];
    const source = [buildEntity({ physicalTableName: 't', attributes: sourceAttrs })];

    // Existing has the same physical column PLUS a model-only design-ahead attr
    const existing = [
      buildEntity({
        physicalTableName: 't',
        attributes: [
          buildAttr({ physical }),
          buildAttr({ name: 'futureCol' }),
        ],
      }),
    ];
    const diffs = diffEntities(source, existing);
    const counts = diffs[0].counts;
    expect(counts.added).toBe(0);
    expect(counts.changed).toBe(0);
    expect(counts.modelOnly).toBe(1);
    // The entity has model-only changes only — overall status should be 'unchanged'
    expect(diffs[0].status).toBe('unchanged');
  });
});

// ────────────────────────────────────────────────────────────────────────
// mergeEntities — invariant 2: never overwrite user content
// ────────────────────────────────────────────────────────────────────────

describe('mergeEntities — preserves user content', () => {
  it('preserves a user-edited description through a type change', () => {
    const source = [
      buildEntity({
        physicalTableName: 'orders',
        attributes: [
          buildAttr({
            name: 'id',
            type: AttributeType.UUID,
            description: 'Imported from SQL', // source description (will lose)
            physical: { columnName: 'id', dbType: 'UUID' },
          }),
        ],
      }),
    ];
    const existing = [
      buildEntity({
        physicalTableName: 'orders',
        attributes: [
          buildAttr({
            name: 'orderId',
            type: AttributeType.STRING,
            description: 'The user-authored description we must keep',
            physical: { columnName: 'id', dbType: 'VARCHAR(36)' },
          }),
        ],
      }),
    ];
    const merged = mergeEntities(source, existing);
    const mergedAttr = merged[0].attributes[0];
    expect(mergedAttr.description).toBe('The user-authored description we must keep');
    expect(mergedAttr.type).toBe(AttributeType.UUID);
    // Display name preserved (user may have renamed)
    expect(mergedAttr.name).toBe('orderId');
  });

  it('fills empty description from source description when existing is empty', () => {
    const source = [
      buildEntity({
        physicalTableName: 'orders',
        attributes: [
          buildAttr({
            description: 'Source description',
            physical: { columnName: 'id' },
          }),
        ],
      }),
    ];
    const existing = [
      buildEntity({
        physicalTableName: 'orders',
        attributes: [
          buildAttr({
            description: '', // empty
            physical: { columnName: 'id' },
          }),
        ],
      }),
    ];
    const merged = mergeEntities(source, existing);
    expect(merged[0].attributes[0].description).toBe('Source description');
  });

  it('preserves non-physical metadata on attributes (e.g. user tags)', () => {
    const source = [
      buildEntity({
        physicalTableName: 'orders',
        attributes: [
          buildAttr({
            physical: { columnName: 'id', dbType: 'INT', nullable: false },
          }),
        ],
      }),
    ];
    const existing = [
      buildEntity({
        physicalTableName: 'orders',
        attributes: [
          buildAttr({
            physical: { columnName: 'id', dbType: 'INT', nullable: false },
            metadata: [{ name: 'pii', value: false }, { name: 'data-source', value: 'crm' }],
          }),
        ],
      }),
    ];
    const merged = mergeEntities(source, existing);
    const mergedMeta = merged[0].attributes[0].metadata!;
    // Non-physical entries preserved
    expect(mergedMeta.find(m => m.name === 'pii')?.value).toBe(false);
    expect(mergedMeta.find(m => m.name === 'data-source')?.value).toBe('crm');
    // Physical entries refreshed from source
    expect(mergedMeta.find(m => m.name === 'physical.columnName')?.value).toBe('id');
  });

  it('preserves entity uuid + display name through a merge', () => {
    const existingUuid = 'ent-existing';
    const source = [
      buildEntity({
        name: 'NewName',
        physicalTableName: 'orders',
        attributes: [buildAttr({ physical: { columnName: 'id', dbType: 'UUID' } })],
      }),
    ];
    const existing = [
      buildEntity({
        uuid: existingUuid,
        name: 'PreservedName',
        physicalTableName: 'orders',
        attributes: [buildAttr({ physical: { columnName: 'id', dbType: 'INT' } })],
      }),
    ];
    const merged = mergeEntities(source, existing);
    expect(merged[0].uuid).toBe(existingUuid);
    expect(merged[0].name).toBe('PreservedName');
  });

  it('refreshes physical.* metadata on the entity but preserves non-physical entries', () => {
    const source = [
      buildEntity({
        physicalTableName: 'orders',
        metadata: [{ name: 'physical.schema', value: 'sales' }],
        attributes: [buildAttr({ physical: { columnName: 'id' } })],
      }),
    ];
    const existing = [
      buildEntity({
        physicalTableName: 'orders',
        metadata: [{ name: 'owner', value: 'data-team' }],
        attributes: [buildAttr({ physical: { columnName: 'id' } })],
      }),
    ];
    const merged = mergeEntities(source, existing);
    const meta = merged[0].metadata!;
    expect(meta.find(m => m.name === 'owner')?.value).toBe('data-team');
    expect(meta.find(m => m.name === 'physical.schema')?.value).toBe('sales');
    expect(meta.find(m => m.name === 'physical.tableName')?.value).toBe('orders');
  });
});

// ────────────────────────────────────────────────────────────────────────
// mergeEntities — invariant 3: model-only attributes are sacred
// ────────────────────────────────────────────────────────────────────────

describe('mergeEntities — model-only preservation', () => {
  it('never touches a model-only attribute even when other attributes change', () => {
    const source = [
      buildEntity({
        physicalTableName: 'orders',
        attributes: [
          buildAttr({
            type: AttributeType.UUID, // changed from STRING
            physical: { columnName: 'id', dbType: 'UUID' },
          }),
        ],
      }),
    ];
    const modelOnlyAttrUuid = 'model-only-attr';
    const existing = [
      buildEntity({
        physicalTableName: 'orders',
        attributes: [
          buildAttr({
            type: AttributeType.STRING,
            physical: { columnName: 'id', dbType: 'VARCHAR(36)' },
          }),
          buildAttr({
            uuid: modelOnlyAttrUuid,
            name: 'futureCol',
            description: 'will be implemented next sprint',
            // no physical metadata → model-only
          }),
        ],
      }),
    ];
    const merged = mergeEntities(source, existing);
    expect(merged[0].attributes).toHaveLength(2);
    const modelOnly = merged[0].attributes.find(a => a.uuid === modelOnlyAttrUuid);
    expect(modelOnly).toBeDefined();
    expect(modelOnly!.name).toBe('futureCol');
    expect(modelOnly!.description).toBe('will be implemented next sprint');
  });
});

// ────────────────────────────────────────────────────────────────────────
// mergeEntities — invariant 1: lookup by physical metadata
// ────────────────────────────────────────────────────────────────────────

describe('mergeEntities — physical-metadata-based lookup', () => {
  it('matches an entity even after the user renamed the model display name', () => {
    const source = [
      buildEntity({
        name: 'Orders',
        physicalTableName: 'tbl_orders',
        attributes: [
          buildAttr({ type: AttributeType.UUID, physical: { columnName: 'id', dbType: 'UUID' } }),
        ],
      }),
    ];
    const existing = [
      buildEntity({
        // User renamed it
        name: 'CustomerOrders',
        physicalTableName: 'tbl_orders',
        attributes: [
          buildAttr({
            type: AttributeType.STRING,
            physical: { columnName: 'id', dbType: 'VARCHAR(36)' },
          }),
        ],
      }),
    ];
    const merged = mergeEntities(source, existing);
    // One merged entity, NOT a duplicate
    expect(merged).toHaveLength(1);
    expect(merged[0].name).toBe('CustomerOrders');
    expect(merged[0].attributes[0].type).toBe(AttributeType.UUID);
  });

  it('matches an attribute even after the user renamed the column display name', () => {
    const source = [
      buildEntity({
        physicalTableName: 'orders',
        attributes: [
          buildAttr({
            name: 'customerId', // source camelCase
            type: AttributeType.UUID,
            physical: { columnName: 'customer_id', dbType: 'UUID' },
          }),
        ],
      }),
    ];
    const existing = [
      buildEntity({
        physicalTableName: 'orders',
        attributes: [
          buildAttr({
            name: 'buyerId', // user renamed
            type: AttributeType.STRING,
            physical: { columnName: 'customer_id', dbType: 'VARCHAR(36)' },
          }),
        ],
      }),
    ];
    const merged = mergeEntities(source, existing);
    expect(merged[0].attributes).toHaveLength(1);
    expect(merged[0].attributes[0].name).toBe('buyerId'); // preserved
    expect(merged[0].attributes[0].type).toBe(AttributeType.UUID);
  });
});

// ────────────────────────────────────────────────────────────────────────
// mergeEntities — pass-through cases
// ────────────────────────────────────────────────────────────────────────

describe('mergeEntities — pass-through', () => {
  it('passes added entities through verbatim with refreshed timestamps', () => {
    const source = [
      buildEntity({
        physicalTableName: 'new_table',
        attributes: [buildAttr({ physical: { columnName: 'id' } })],
      }),
    ];
    const merged = mergeEntities(source, []);
    expect(merged).toHaveLength(1);
    expect(merged[0].updatedAt).toBeDefined();
  });

  it('passes unchanged entities through with no edit', () => {
    const physical = { columnName: 'id', dbType: 'INT', nullable: false };
    const sharedAttr = buildAttr({ physical });
    const source = [buildEntity({ physicalTableName: 't', attributes: [sharedAttr] })];
    const existingEntity = buildEntity({
      uuid: 'ent-fixed',
      name: 'PreservedName',
      physicalTableName: 't',
      attributes: [buildAttr({ physical })],
    });
    const merged = mergeEntities(source, [existingEntity]);
    expect(merged[0].uuid).toBe('ent-fixed');
    expect(merged[0].name).toBe('PreservedName');
  });

  it('preserves removedInSource entities (model-first)', () => {
    const removedEntity = buildEntity({
      uuid: 'ent-removed',
      physicalTableName: 'old_table',
      attributes: [buildAttr({ physical: { columnName: 'id' } })],
    });
    const merged = mergeEntities([], [removedEntity]);
    expect(merged).toHaveLength(1);
    expect(merged[0].uuid).toBe('ent-removed');
  });
});

// ────────────────────────────────────────────────────────────────────────
// diffPhysicalConstraints (#85 R3)
// ────────────────────────────────────────────────────────────────────────

describe('diffPhysicalConstraints (#85 R3)', () => {
  const uniqueOnEmail: PhysicalConstraint = {
    kind: 'unique',
    name: 'uq_users_email',
    columns: ['email'],
  };
  const checkBalance: PhysicalConstraint = {
    kind: 'check',
    name: 'chk_balance',
    expression: 'balance >= 0',
  };
  const fkOrdersCustomer: PhysicalConstraint = {
    kind: 'foreignKey',
    name: 'fk_orders_customer',
    columns: ['customer_id'],
    references: { table: 'customers', columns: ['id'] },
  };

  it('returns empty when both sides have no constraints', () => {
    expect(diffPhysicalConstraints(undefined, undefined)).toEqual([]);
    expect(diffPhysicalConstraints([], [])).toEqual([]);
  });

  it('reports source-only constraints as added', () => {
    const out = diffPhysicalConstraints([uniqueOnEmail], []);
    expect(out).toHaveLength(1);
    expect(out[0].status).toBe('added');
    expect(out[0].source).toBe(uniqueOnEmail);
  });

  it('reports model-only constraints as removedInSource', () => {
    const out = diffPhysicalConstraints([], [uniqueOnEmail]);
    expect(out).toHaveLength(1);
    expect(out[0].status).toBe('removedInSource');
    expect(out[0].existing).toBe(uniqueOnEmail);
  });

  it('reports identical constraints (matched by name) as unchanged', () => {
    const out = diffPhysicalConstraints([uniqueOnEmail], [{ ...uniqueOnEmail }]);
    expect(out).toHaveLength(1);
    expect(out[0].status).toBe('unchanged');
  });

  it('reports same-name but different-shape constraints as changed', () => {
    const evolvedCheck: PhysicalConstraint = {
      kind: 'check',
      name: 'chk_balance',
      expression: 'balance >= 0 AND balance <= 1000000',
    };
    const out = diffPhysicalConstraints([evolvedCheck], [checkBalance]);
    expect(out).toHaveLength(1);
    expect(out[0].status).toBe('changed');
    expect(out[0].source).toBe(evolvedCheck);
    expect(out[0].existing).toBe(checkBalance);
  });

  it('matches anonymous constraints by structural key (kind + columns)', () => {
    const a: PhysicalConstraint = { kind: 'unique', columns: ['email'] };
    const b: PhysicalConstraint = { kind: 'unique', columns: ['email'] };
    const out = diffPhysicalConstraints([a], [b]);
    expect(out).toHaveLength(1);
    expect(out[0].status).toBe('unchanged');
  });

  it('reports a foreign key with a changed referenced table as changed', () => {
    const moved: PhysicalConstraint = {
      ...fkOrdersCustomer,
      references: { table: 'archived_customers', columns: ['id'] },
    };
    const out = diffPhysicalConstraints([moved], [fkOrdersCustomer]);
    expect(out).toHaveLength(1);
    expect(out[0].status).toBe('changed');
  });

  it('handles a mix of added/changed/removed/unchanged in one call', () => {
    const evolvedCheck: PhysicalConstraint = {
      kind: 'check',
      name: 'chk_balance',
      expression: 'balance > 0',
    };
    const newIndex: PhysicalConstraint = {
      kind: 'index',
      name: 'idx_orders_created',
      columns: ['created_at'],
    };
    const source = [uniqueOnEmail, evolvedCheck, newIndex];
    const existing = [{ ...uniqueOnEmail }, checkBalance, fkOrdersCustomer];
    const out = diffPhysicalConstraints(source, existing);
    const byStatus = out.reduce<Record<string, number>>((acc, d) => {
      acc[d.status] = (acc[d.status] || 0) + 1;
      return acc;
    }, {});
    expect(byStatus).toEqual({ unchanged: 1, changed: 1, added: 1, removedInSource: 1 });
  });

  it('whitespace differences in CHECK expressions do not count as changes', () => {
    const padded: PhysicalConstraint = {
      kind: 'check',
      name: 'chk_balance',
      expression: '  balance   >=   0  ',
    };
    const out = diffPhysicalConstraints([padded], [checkBalance]);
    expect(out[0].status).toBe('unchanged');
  });
});

// ────────────────────────────────────────────────────────────────────────
// diffEntities — physical constraint changes drive entity status (#85 R3)
// ────────────────────────────────────────────────────────────────────────

describe('diffEntities — physical constraints affect entity status (#85 R3)', () => {
  it('an entity whose only difference is a new physical constraint is reported as changed', () => {
    const baseAttr = buildAttr({ physical: { columnName: 'id', dbType: 'INT', nullable: false } });
    const source: Entity = {
      ...buildEntity({ physicalTableName: 'orders', attributes: [baseAttr] }),
      constraints: [{ kind: 'unique', name: 'uq_orders_id', columns: ['id'] }],
    };
    const existing = buildEntity({ physicalTableName: 'orders', attributes: [baseAttr] });
    const diffs = diffEntities([source], [existing]);
    expect(diffs).toHaveLength(1);
    expect(diffs[0].status).toBe('changed');
    expect(diffs[0].constraints).toBeDefined();
    expect(diffs[0].constraints![0].status).toBe('added');
  });

  it('an entity with identical attributes AND identical constraints is unchanged', () => {
    const baseAttr = buildAttr({ physical: { columnName: 'id', dbType: 'INT', nullable: false } });
    const constraints: PhysicalConstraint[] = [{ kind: 'unique', name: 'uq_orders_id', columns: ['id'] }];
    const source: Entity = { ...buildEntity({ physicalTableName: 'orders', attributes: [baseAttr] }), constraints };
    const existing: Entity = { ...buildEntity({ physicalTableName: 'orders', attributes: [baseAttr] }), constraints: [{ ...constraints[0] }] };
    const diffs = diffEntities([source], [existing]);
    expect(diffs[0].status).toBe('unchanged');
  });

  it('mergeEntities replaces existing.constraints with the source list on a changed entity', () => {
    const baseAttr = buildAttr({ physical: { columnName: 'id', dbType: 'INT', nullable: false } });
    const source: Entity = {
      ...buildEntity({ physicalTableName: 'orders', attributes: [baseAttr] }),
      constraints: [{ kind: 'unique', name: 'uq_orders_id_v2', columns: ['id'] }],
    };
    const existing: Entity = {
      ...buildEntity({ physicalTableName: 'orders', attributes: [baseAttr] }),
      constraints: [{ kind: 'unique', name: 'uq_orders_id', columns: ['id'] }],
    };
    const merged = mergeEntities([source], [existing]);
    expect(merged[0].constraints).toEqual([
      { kind: 'unique', name: 'uq_orders_id_v2', columns: ['id'] },
    ]);
  });
});

// ────────────────────────────────────────────────────────────────────────
// Relationship diff + merge (#82)
// ────────────────────────────────────────────────────────────────────────

let relCounter = 0;
function buildRel(opts: {
  uuid?: string;
  sourceEntity?: string;
  targetEntity?: string;
  sourceCardinality?: Cardinality;
  targetCardinality?: Cardinality;
  constraintName?: string;
  referenceAttributes?: string[];
  description?: string;
}): Relationship {
  const metadata: MetadataEntry[] = [];
  if (opts.constraintName) {
    metadata.push({ name: 'physical.constraintName', value: opts.constraintName });
  }
  return {
    uuid: opts.uuid || `rel-${++relCounter}`,
    description: opts.description || 'FK relationship',
    type: 'structural',
    source: {
      entity: opts.sourceEntity || 'src-ent',
      cardinality: opts.sourceCardinality || Cardinality.MANY,
      referenceAttributes: opts.referenceAttributes || ['fkCol'],
    },
    target: {
      entity: opts.targetEntity || 'tgt-ent',
      cardinality: opts.targetCardinality || Cardinality.ONE,
    },
    ...(metadata.length > 0 ? { metadata } : {}),
  };
}

beforeEach(() => { relCounter = 0; });

describe('diffRelationships (#82)', () => {
  it('detects added relationships', () => {
    const source = [buildRel({ constraintName: 'fk_new' })];
    const diffs = diffRelationships(source, []);
    expect(diffs).toHaveLength(1);
    expect(diffs[0].status).toBe('added');
  });

  it('detects unchanged relationships by constraintName', () => {
    const source = [buildRel({ constraintName: 'fk_order_customer', sourceEntity: 'a', targetEntity: 'b' })];
    const existing = [buildRel({ constraintName: 'fk_order_customer', sourceEntity: 'a', targetEntity: 'b' })];
    const diffs = diffRelationships(source, existing);
    expect(diffs).toHaveLength(1);
    expect(diffs[0].status).toBe('unchanged');
  });

  it('detects removedInSource for imported relationships no longer in source', () => {
    const existing = [buildRel({ constraintName: 'fk_old' })];
    const diffs = diffRelationships([], existing);
    expect(diffs).toHaveLength(1);
    expect(diffs[0].status).toBe('removedInSource');
  });

  it('ignores user-created relationships (no physical.constraintName)', () => {
    const existing = [buildRel({})]; // no constraintName
    const diffs = diffRelationships([], existing);
    // User-created rels are not matched, so not in diff output
    expect(diffs).toHaveLength(0);
  });
});

describe('mergeRelationships (#82)', () => {
  it('adds new relationships with remapped entity UUIDs', () => {
    const source = [buildRel({
      constraintName: 'fk_order_cust',
      sourceEntity: 'parsed-order',
      targetEntity: 'parsed-cust',
    })];
    const entityMap = new Map([
      ['parsed-order', 'existing-order'],
      ['parsed-cust', 'existing-cust'],
    ]);
    const merged = mergeRelationships(source, [], entityMap);
    expect(merged).toHaveLength(1);
    expect(merged[0].source.entity).toBe('existing-order');
    expect(merged[0].target.entity).toBe('existing-cust');
  });

  it('preserves user-created relationships untouched', () => {
    const existing = [buildRel({ uuid: 'user-rel', description: 'Manual link' })];
    const merged = mergeRelationships([], existing, new Map());
    expect(merged).toHaveLength(1);
    expect(merged[0].uuid).toBe('user-rel');
    expect(merged[0].description).toBe('Manual link');
  });

  it('preserves existing description when merging changed relationships', () => {
    const source = [buildRel({
      constraintName: 'fk_order_cust',
      sourceEntity: 'a',
      targetEntity: 'b',
      description: 'Imported FK',
      sourceCardinality: Cardinality.ONE, // changed
    })];
    const existing = [buildRel({
      constraintName: 'fk_order_cust',
      uuid: 'existing-uuid',
      sourceEntity: 'a',
      targetEntity: 'b',
      description: 'User-edited description',
    })];
    const merged = mergeRelationships(source, existing, new Map());
    const fkRel = merged.find(r =>
      (r.metadata || []).some(m => m.name === 'physical.constraintName' && m.value === 'fk_order_cust')
    );
    expect(fkRel).toBeDefined();
    expect(fkRel!.uuid).toBe('existing-uuid');
    expect(fkRel!.description).toBe('User-edited description');
  });

  it('preserves removedInSource relationships (model-first)', () => {
    const existing = [buildRel({ constraintName: 'fk_old', uuid: 'old-uuid' })];
    const merged = mergeRelationships([], existing, new Map());
    // User-created (no constraintName) are kept + removedInSource are kept
    expect(merged.find(r => r.uuid === 'old-uuid')).toBeDefined();
  });
});
