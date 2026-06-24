/**
 * Tests for the logical model diff engine (#86).
 */
import { diffModels, ModelSnapshot, PackageSnapshot } from '../logicalDiff.js';
import { Entity, Attribute, AttributeType, EntityStatus, Relationship, Cardinality } from '../../models/EntitySchema.js';
import { Rule } from '../../models/Rule.js';

jest.mock('../../utils/logger');

// ────────────────────────────────────────────────────────────────────────
// Builders
// ────────────────────────────────────────────────────────────────────────

let counter = 0;
const nextId = () => `uuid-${++counter}`;

function buildAttr(overrides: Partial<Attribute> = {}): Attribute {
  return {
    uuid: overrides.uuid || nextId(),
    name: overrides.name || 'attr',
    description: overrides.description || '',
    type: overrides.type || AttributeType.STRING,
    required: overrides.required ?? true,
    ...overrides,
  };
}

function buildEntity(overrides: Partial<Entity> = {}): Entity {
  return {
    uuid: overrides.uuid || nextId(),
    name: overrides.name || 'Entity',
    description: overrides.description || '',
    status: overrides.status || EntityStatus.DRAFT,
    attributes: overrides.attributes || [],
    ...overrides,
  };
}

function buildRel(overrides: Partial<Relationship> = {}): Relationship {
  return {
    uuid: overrides.uuid || nextId(),
    type: 'structural',
    source: overrides.source || { entity: 'src', cardinality: Cardinality.MANY },
    target: overrides.target || { entity: 'tgt', cardinality: Cardinality.ONE },
    ...overrides,
  };
}

function buildRule(overrides: Partial<Rule> = {}): Rule {
  return {
    uuid: overrides.uuid || nextId(),
    name: overrides.name || 'test-rule',
    description: overrides.description || 'A test rule',
    severity: overrides.severity || 'warning',
    enforcement: overrides.enforcement || 'advisory',
    scope: overrides.scope || 'package',
    targets: overrides.targets || [{ kind: 'entity', uuid: 'ent-1' }],
    ...overrides,
  };
}

function buildPkg(overrides: Partial<PackageSnapshot> = {}): PackageSnapshot {
  return {
    packageName: overrides.packageName || 'test-service',
    entities: overrides.entities || [],
    relationships: overrides.relationships || [],
    rules: overrides.rules || [],
    ...overrides,
  };
}

function snap(...packages: PackageSnapshot[]): ModelSnapshot {
  return { packages };
}

beforeEach(() => { counter = 0; });

// ────────────────────────────────────────────────────────────────────────
// Package-level diff
// ────────────────────────────────────────────────────────────────────────

describe('package-level diff', () => {
  it('detects added packages', () => {
    const left = snap();
    const right = snap(buildPkg({ packageName: 'new-svc' }));
    const diff = diffModels(left, right);
    expect(diff.packages).toHaveLength(1);
    expect(diff.packages[0].status).toBe('added');
    expect(diff.summary.packages.added).toBe(1);
  });

  it('detects removed packages', () => {
    const left = snap(buildPkg({ packageName: 'old-svc' }));
    const right = snap();
    const diff = diffModels(left, right);
    expect(diff.packages).toHaveLength(1);
    expect(diff.packages[0].status).toBe('removed');
    expect(diff.summary.packages.removed).toBe(1);
  });

  it('detects unchanged packages', () => {
    const entity = buildEntity({ uuid: 'e1' });
    const left = snap(buildPkg({ entities: [entity] }));
    const right = snap(buildPkg({ entities: [entity] }));
    const diff = diffModels(left, right);
    expect(diff.packages[0].status).toBe('unchanged');
  });

  it('detects changed packages', () => {
    const left = snap(buildPkg({ entities: [buildEntity({ uuid: 'e1', name: 'Old' })] }));
    const right = snap(buildPkg({ entities: [buildEntity({ uuid: 'e1', name: 'New' })] }));
    const diff = diffModels(left, right);
    expect(diff.packages[0].status).toBe('changed');
  });
});

// ────────────────────────────────────────────────────────────────────────
// Entity-level diff
// ────────────────────────────────────────────────────────────────────────

describe('entity-level diff', () => {
  it('detects added entities', () => {
    const left = snap(buildPkg());
    const right = snap(buildPkg({ entities: [buildEntity({ uuid: 'e1', name: 'Order' })] }));
    const diff = diffModels(left, right);
    const entityDiffs = diff.packages[0].entities;
    expect(entityDiffs).toHaveLength(1);
    expect(entityDiffs[0].status).toBe('added');
    expect(entityDiffs[0].entityName).toBe('Order');
    expect(diff.summary.entities.added).toBe(1);
  });

  it('detects removed entities', () => {
    const left = snap(buildPkg({ entities: [buildEntity({ uuid: 'e1', name: 'Order' })] }));
    const right = snap(buildPkg());
    const diff = diffModels(left, right);
    expect(diff.packages[0].entities[0].status).toBe('removed');
    expect(diff.summary.entities.removed).toBe(1);
  });

  it('detects unchanged entities', () => {
    const entity = buildEntity({ uuid: 'e1', name: 'Order', attributes: [buildAttr({ uuid: 'a1' })] });
    const diff = diffModels(snap(buildPkg({ entities: [entity] })), snap(buildPkg({ entities: [entity] })));
    expect(diff.packages[0].entities[0].status).toBe('unchanged');
  });

  it('detects changed entity fields (name, description, status)', () => {
    const left = buildEntity({ uuid: 'e1', name: 'Order', description: 'Old desc' });
    const right = buildEntity({ uuid: 'e1', name: 'Order', description: 'New desc' });
    const diff = diffModels(snap(buildPkg({ entities: [left] })), snap(buildPkg({ entities: [right] })));
    const ed = diff.packages[0].entities[0];
    expect(ed.status).toBe('changed');
    expect(ed.changedFields).toContain('description');
  });

  it('detects entity moved between packages', () => {
    const entity = buildEntity({ uuid: 'e1', name: 'SharedEntity' });
    const left = snap(
      buildPkg({ packageName: 'svc-a', entities: [entity] }),
      buildPkg({ packageName: 'svc-b' }),
    );
    const right = snap(
      buildPkg({ packageName: 'svc-a' }),
      buildPkg({ packageName: 'svc-b', entities: [entity] }),
    );
    const diff = diffModels(left, right);

    // svc-a should NOT show entity as removed (it moved)
    const svcA = diff.packages.find(p => p.packageName === 'svc-a')!;
    expect(svcA.entities.filter(e => e.status === 'removed')).toHaveLength(0);

    // svc-b should show entity as moved
    const svcB = diff.packages.find(p => p.packageName === 'svc-b')!;
    const moved = svcB.entities.find(e => e.status === 'moved');
    expect(moved).toBeDefined();
    expect(moved!.movedFrom).toBe('svc-a');
    expect(moved!.entityName).toBe('SharedEntity');
    expect(diff.summary.entities.moved).toBe(1);
  });
});

// ────────────────────────────────────────────────────────────────────────
// Attribute-level diff
// ────────────────────────────────────────────────────────────────────────

describe('attribute-level diff', () => {
  it('detects added attributes', () => {
    const left = buildEntity({ uuid: 'e1', attributes: [buildAttr({ uuid: 'a1', name: 'id' })] });
    const right = buildEntity({ uuid: 'e1', attributes: [
      buildAttr({ uuid: 'a1', name: 'id' }),
      buildAttr({ uuid: 'a2', name: 'email' }),
    ]});
    const diff = diffModels(snap(buildPkg({ entities: [left] })), snap(buildPkg({ entities: [right] })));
    const attrs = diff.packages[0].entities[0].attributes;
    expect(attrs.find(a => a.attributeName === 'email')!.status).toBe('added');
    expect(diff.summary.attributes.added).toBe(1);
  });

  it('detects removed attributes', () => {
    const left = buildEntity({ uuid: 'e1', attributes: [
      buildAttr({ uuid: 'a1', name: 'id' }),
      buildAttr({ uuid: 'a2', name: 'email' }),
    ]});
    const right = buildEntity({ uuid: 'e1', attributes: [buildAttr({ uuid: 'a1', name: 'id' })] });
    const diff = diffModels(snap(buildPkg({ entities: [left] })), snap(buildPkg({ entities: [right] })));
    const attrs = diff.packages[0].entities[0].attributes;
    expect(attrs.find(a => a.attributeName === 'email')!.status).toBe('removed');
  });

  it('detects changed attribute type', () => {
    const left = buildEntity({ uuid: 'e1', attributes: [
      buildAttr({ uuid: 'a1', name: 'total', type: AttributeType.NUMBER }),
    ]});
    const right = buildEntity({ uuid: 'e1', attributes: [
      buildAttr({ uuid: 'a1', name: 'total', type: AttributeType.INTEGER }),
    ]});
    const diff = diffModels(snap(buildPkg({ entities: [left] })), snap(buildPkg({ entities: [right] })));
    const attr = diff.packages[0].entities[0].attributes[0];
    expect(attr.status).toBe('changed');
    expect(attr.changedFields).toContain('type');
  });

  it('detects changed attribute name (rename)', () => {
    const left = buildEntity({ uuid: 'e1', attributes: [
      buildAttr({ uuid: 'a1', name: 'customerEmail' }),
    ]});
    const right = buildEntity({ uuid: 'e1', attributes: [
      buildAttr({ uuid: 'a1', name: 'email' }),
    ]});
    const diff = diffModels(snap(buildPkg({ entities: [left] })), snap(buildPkg({ entities: [right] })));
    const attr = diff.packages[0].entities[0].attributes[0];
    expect(attr.status).toBe('changed');
    expect(attr.changedFields).toContain('name');
  });
});

// ────────────────────────────────────────────────────────────────────────
// Relationship diff
// ────────────────────────────────────────────────────────────────────────

describe('relationship diff', () => {
  it('detects added relationships', () => {
    const rel = buildRel({ uuid: 'r1' });
    const diff = diffModels(snap(buildPkg()), snap(buildPkg({ relationships: [rel] })));
    expect(diff.packages[0].relationships[0].status).toBe('added');
    expect(diff.summary.relationships.added).toBe(1);
  });

  it('detects removed relationships', () => {
    const rel = buildRel({ uuid: 'r1' });
    const diff = diffModels(snap(buildPkg({ relationships: [rel] })), snap(buildPkg()));
    expect(diff.packages[0].relationships[0].status).toBe('removed');
  });

  it('detects changed relationship cardinality', () => {
    const left = buildRel({ uuid: 'r1', source: { entity: 'e1', cardinality: Cardinality.MANY } });
    const right = buildRel({ uuid: 'r1', source: { entity: 'e1', cardinality: Cardinality.ONE } });
    const diff = diffModels(
      snap(buildPkg({ relationships: [left] })),
      snap(buildPkg({ relationships: [right] })),
    );
    const rd = diff.packages[0].relationships[0];
    expect(rd.status).toBe('changed');
    expect(rd.changedFields).toContain('source.cardinality');
  });
});

// ────────────────────────────────────────────────────────────────────────
// Constraint diff
// ────────────────────────────────────────────────────────────────────────

describe('constraint diff', () => {
  it('detects added constraints', () => {
    const left = buildEntity({ uuid: 'e1' });
    const right = buildEntity({ uuid: 'e1', constraints: [{ kind: 'unique', name: 'uq_id', columns: ['id'] }] });
    const diff = diffModels(snap(buildPkg({ entities: [left] })), snap(buildPkg({ entities: [right] })));
    expect(diff.packages[0].entities[0].constraints[0].status).toBe('added');
  });

  it('detects removed constraints', () => {
    const left = buildEntity({ uuid: 'e1', constraints: [{ kind: 'check', expression: 'total >= 0' }] });
    const right = buildEntity({ uuid: 'e1' });
    const diff = diffModels(snap(buildPkg({ entities: [left] })), snap(buildPkg({ entities: [right] })));
    expect(diff.packages[0].entities[0].constraints[0].status).toBe('removed');
  });
});

// ────────────────────────────────────────────────────────────────────────
// Rule diff
// ────────────────────────────────────────────────────────────────────────

describe('rule diff', () => {
  it('detects added rules', () => {
    const rule = buildRule({ uuid: 'rule-1' });
    const diff = diffModels(snap(buildPkg()), snap(buildPkg({ rules: [rule] })));
    expect(diff.packages[0].rules[0].status).toBe('added');
    expect(diff.summary.rules.added).toBe(1);
  });

  it('detects removed rules', () => {
    const rule = buildRule({ uuid: 'rule-1' });
    const diff = diffModels(snap(buildPkg({ rules: [rule] })), snap(buildPkg()));
    expect(diff.packages[0].rules[0].status).toBe('removed');
  });

  it('detects changed rule severity', () => {
    const left = buildRule({ uuid: 'rule-1', severity: 'warning' });
    const right = buildRule({ uuid: 'rule-1', severity: 'error' });
    const diff = diffModels(snap(buildPkg({ rules: [left] })), snap(buildPkg({ rules: [right] })));
    const rd = diff.packages[0].rules[0];
    expect(rd.status).toBe('changed');
    expect(rd.changedFields).toContain('severity');
  });

  it('detects unchanged rules', () => {
    const rule = buildRule({ uuid: 'rule-1' });
    const diff = diffModels(snap(buildPkg({ rules: [rule] })), snap(buildPkg({ rules: [rule] })));
    expect(diff.packages[0].rules[0].status).toBe('unchanged');
  });
});

// ────────────────────────────────────────────────────────────────────────
// Summary
// ────────────────────────────────────────────────────────────────────────

describe('summary counts', () => {
  it('aggregates counts across all packages', () => {
    const left = snap(
      buildPkg({
        packageName: 'svc-a',
        entities: [
          buildEntity({ uuid: 'e1', name: 'Order', attributes: [buildAttr({ uuid: 'a1' }), buildAttr({ uuid: 'a2' })] }),
          buildEntity({ uuid: 'e2', name: 'ToRemove' }),
        ],
        relationships: [buildRel({ uuid: 'r1' })],
        rules: [buildRule({ uuid: 'rule-1' })],
      }),
    );
    const right = snap(
      buildPkg({
        packageName: 'svc-a',
        entities: [
          buildEntity({ uuid: 'e1', name: 'OrderRenamed', attributes: [buildAttr({ uuid: 'a1' }), buildAttr({ uuid: 'a3', name: 'newAttr' })] }),
          buildEntity({ uuid: 'e3', name: 'NewEntity' }),
        ],
        relationships: [buildRel({ uuid: 'r1' }), buildRel({ uuid: 'r2' })],
        rules: [],
      }),
    );

    const diff = diffModels(left, right);
    expect(diff.summary.entities.changed).toBe(1);  // e1 renamed
    expect(diff.summary.entities.removed).toBe(1);  // e2
    expect(diff.summary.entities.added).toBe(1);     // e3
    expect(diff.summary.attributes.removed).toBe(1); // a2 removed
    expect(diff.summary.attributes.added).toBe(1);   // a3 added
    expect(diff.summary.relationships.added).toBe(1); // r2
    expect(diff.summary.rules.removed).toBe(1);       // rule-1
  });
});

// ────────────────────────────────────────────────────────────────────────
// Multi-package scenarios
// ────────────────────────────────────────────────────────────────────────

describe('multi-package', () => {
  it('handles multiple packages with mixed changes', () => {
    const left = snap(
      buildPkg({ packageName: 'svc-a', entities: [buildEntity({ uuid: 'e1' })] }),
      buildPkg({ packageName: 'svc-b', entities: [buildEntity({ uuid: 'e2' })] }),
    );
    const right = snap(
      buildPkg({ packageName: 'svc-a', entities: [buildEntity({ uuid: 'e1' })] }),
      buildPkg({ packageName: 'svc-c', entities: [buildEntity({ uuid: 'e3' })] }),
    );
    const diff = diffModels(left, right);
    expect(diff.packages).toHaveLength(3); // svc-a (unchanged), svc-b (removed), svc-c (added)
    expect(diff.packages.find(p => p.packageName === 'svc-a')!.status).toBe('unchanged');
    expect(diff.packages.find(p => p.packageName === 'svc-b')!.status).toBe('removed');
    expect(diff.packages.find(p => p.packageName === 'svc-c')!.status).toBe('added');
  });
});
