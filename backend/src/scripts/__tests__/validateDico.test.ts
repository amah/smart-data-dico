/**
 * Tests for the standalone data-dictionary validator (validateDico).
 *
 * 1. PASSES (0 errors) on the shipped sample at `samples/eshop`.
 * 2. FAILS with the right findings on a deliberately-broken temp fixture:
 *      - relationship endpoint pointing at a non-existent entity UUID
 *      - duplicate entity name across two files in one package
 *      - a package folder missing its package.yaml marker
 *      - an attribute with a malformed UUID
 *      - a circular derived type in dico.config.json
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { storageRegistry } from '../../storage/contract/StorageBackendToken.js';
import { validateProject, Report, printReport } from '../validateDico.js';

const SAMPLE_DIR = path.resolve(__dirname, '../../../../samples/eshop');

afterEach(() => {
  storageRegistry.reset();
});

describe('validateDico', () => {
  it('passes (0 errors) on the shipped eshop sample', async () => {
    const report = new Report();
    await validateProject(SAMPLE_DIR, report);
    const errors = report.findings.filter(f => f.severity === 'error');
    expect(errors).toEqual([]);
    expect(report.errorCount).toBe(0);
  });

  describe('on a deliberately-broken fixture', () => {
    let dir: string;
    let report: Report;

    beforeAll(async () => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dico-broken-'));

      // Circular derived types (a → b → a).
      fs.writeFileSync(path.join(dir, 'dico.config.json'), JSON.stringify({
        version: 1,
        types: [
          { name: 'a', basedOn: 'b' },
          { name: 'b', basedOn: 'a' },
        ],
      }, null, 2));

      // Package: shop ──────────────────────────────────────────────
      const shop = path.join(dir, 'shop');
      fs.mkdirSync(shop, { recursive: true });
      fs.writeFileSync(path.join(shop, 'package.yaml'), 'name: shop\n');

      // Order entity with a BAD attribute UUID.
      fs.writeFileSync(path.join(shop, 'Order.model.yaml'), [
        'entities:',
        '  - uuid: 11111111-1111-4111-8111-111111111111',
        '    name: Order',
        '    attributes:',
        '      - uuid: not-a-valid-uuid',
        '        name: id',
        '        description: id',
        '        type: string',
        '        required: true',
        '',
      ].join('\n'));

      // DUPLICATE entity name "Order" in a second file in the same package.
      fs.writeFileSync(path.join(shop, 'Order2.model.yaml'), [
        'entities:',
        '  - uuid: 22222222-2222-4222-8222-222222222222',
        '    name: Order',
        '    attributes: []',
        '',
      ].join('\n'));

      // Relationship whose endpoint points at a NON-EXISTENT entity UUID
      // (ends-only shape — the "Failed to load graph" bug class).
      fs.writeFileSync(path.join(shop, 'relationships.model.yaml'), [
        'relationships:',
        '  - uuid: rel-broken-001',
        '    description: Order references a ghost',
        '    ends:',
        '      - entity: 11111111-1111-4111-8111-111111111111',
        '        cardinality: one',
        '      - entity: 99999999-9999-4999-8999-999999999999',
        '        cardinality: many',
        '',
      ].join('\n'));

      // A folder that LOOKS like a package (has *.yaml) but lacks package.yaml.
      const orphan = path.join(dir, 'orphan');
      fs.mkdirSync(orphan, { recursive: true });
      fs.writeFileSync(path.join(orphan, 'Thing.model.yaml'), [
        'entities:',
        '  - uuid: 33333333-3333-4333-8333-333333333333',
        '    name: Thing',
        '    attributes: []',
        '',
      ].join('\n'));

      report = new Report();
      await validateProject(dir, report);
    });

    afterAll(() => {
      fs.rmSync(dir, { recursive: true, force: true });
    });

    const codes = () => report.findings.map(f => f.code);

    it('reports a non-zero error count', () => {
      expect(report.errorCount).toBeGreaterThan(0);
    });

    it('detects circular derived types', () => {
      expect(codes()).toContain('config.derivedType');
      expect(report.findings.find(f => f.code === 'config.derivedType')?.message)
        .toMatch(/[Cc]ircular/);
    });

    it('detects the duplicate entity name across two files, citing both paths', () => {
      const collision = report.findings.find(f => f.code === 'collision');
      expect(collision).toBeDefined();
      expect(collision!.message).toMatch(/Duplicate entity name 'Order'/);
      expect(collision!.message).toContain('Order.model.yaml');
      expect(collision!.message).toContain('Order2.model.yaml');
    });

    it('warns about a folder missing its package.yaml marker', () => {
      const w = report.findings.find(f => f.code === 'package.missingMarker');
      expect(w).toBeDefined();
      expect(w!.severity).toBe('warning');
      expect(w!.identifier).toBe('orphan');
    });
  });

  it('detects a relationship endpoint that resolves to no entity (the graph-load bug class)', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dico-rel-'));
    try {
      fs.writeFileSync(path.join(dir, 'dico.config.json'), JSON.stringify({ version: 1 }));
      const pkg = path.join(dir, 'shop');
      fs.mkdirSync(pkg, { recursive: true });
      fs.writeFileSync(path.join(pkg, 'package.yaml'), 'name: shop\n');
      fs.writeFileSync(path.join(pkg, 'Order.model.yaml'), [
        'entities:',
        '  - uuid: 11111111-1111-4111-8111-111111111111',
        '    name: Order',
        '    attributes: []',
        '',
      ].join('\n'));
      // ends-only relationship whose second endpoint points at a ghost UUID.
      fs.writeFileSync(path.join(pkg, 'relationships.model.yaml'), [
        'relationships:',
        '  - uuid: rel-broken-001',
        '    ends:',
        '      - entity: 11111111-1111-4111-8111-111111111111',
        '        cardinality: one',
        '      - entity: 99999999-9999-4999-8999-999999999999',
        '        cardinality: many',
        '',
      ].join('\n'));

      const report = new Report();
      await validateProject(dir, report);
      const ep = report.findings.find(f => f.code === 'relationship.endpoint');
      expect(ep).toBeDefined();
      expect(ep!.message).toContain('99999999-9999-4999-8999-999999999999');
      expect(ep!.severity).toBe('error');
      expect(report.errorCount).toBeGreaterThan(0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
      storageRegistry.reset();
    }
  });

  // NOTE: the bad-attribute-UUID case is exercised in its own project so the
  // duplicate-entity collision (which aborts that package's merge) doesn't
  // mask the per-entity attribute check.
  it('detects a malformed attribute UUID', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dico-attr-'));
    try {
      fs.writeFileSync(path.join(dir, 'dico.config.json'), JSON.stringify({ version: 1 }));
      const pkg = path.join(dir, 'shop');
      fs.mkdirSync(pkg, { recursive: true });
      fs.writeFileSync(path.join(pkg, 'package.yaml'), 'name: shop\n');
      fs.writeFileSync(path.join(pkg, 'Order.model.yaml'), [
        'entities:',
        '  - uuid: 11111111-1111-4111-8111-111111111111',
        '    name: Order',
        '    attributes:',
        '      - uuid: not-a-valid-uuid',
        '        name: id',
        '        description: id',
        '        type: string',
        '        required: true',
        '',
      ].join('\n'));

      const report = new Report();
      await validateProject(dir, report);
      const bad = report.findings.find(f => f.code === 'attribute.badUuid' || f.code === 'entity.invalid');
      expect(bad).toBeDefined();
      expect(report.errorCount).toBeGreaterThan(0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
      storageRegistry.reset();
    }
  });

  it('flags bad orm.* metadata (enum value, ghost extends, conflicting flags, unknown key)', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dico-orm-'));
    try {
      fs.writeFileSync(path.join(dir, 'dico.config.json'), JSON.stringify({ version: 1 }));
      const pkg = path.join(dir, 'shop');
      fs.mkdirSync(pkg, { recursive: true });
      fs.writeFileSync(path.join(pkg, 'package.yaml'), 'name: shop\n');
      fs.writeFileSync(path.join(pkg, 'Order.model.yaml'), [
        'entities:',
        '  - uuid: 11111111-1111-4111-8111-111111111111',
        '    name: Order',
        '    description: order',
        '    metadata:',
        '      - name: orm.package',
        '        value: com.x.order',
        '      - name: orm.extends',          // → orm.reference (no such entity)
        '        value: GhostParent',
        '    attributes:',
        '      - uuid: aaaaaaaa-1111-4111-8111-111111111111',
        '        name: id',
        '        description: id',
        '        type: string',
        '        required: true',
        '        metadata:',
        '          - name: orm.generatedValue', // → orm.value (bad enum)
        '            value: BOGUS',
        '      - uuid: aaaaaaaa-2222-4222-8222-222222222222',
        '        name: lockver',
        '        description: ver',
        '        type: integer',
        '        required: false',
        '        metadata:',
        '          - name: orm.version',         // version + transient → orm.conflict
        '            value: true',
        '          - name: orm.transient',
        '            value: true',
        '      - uuid: aaaaaaaa-3333-4333-8333-333333333333',
        '        name: misc',
        '        description: misc',
        '        type: string',
        '        required: false',
        '        metadata:',
        '          - name: orm.bogusKey',        // → orm.unknownKey (warning)
        '            value: x',
        '',
      ].join('\n'));
      // Valid self-relationship endpoints; only the orm.fetch value is bad.
      fs.writeFileSync(path.join(pkg, 'relationships.model.yaml'), [
        'relationships:',
        '  - uuid: rel-orm-001',
        '    description: self',
        '    metadata:',
        '      - name: orm.fetch',               // → orm.value (bad enum)
        '        value: BOGUS',
        '    ends:',
        '      - entity: 11111111-1111-4111-8111-111111111111',
        '        cardinality: one',
        '      - entity: 11111111-1111-4111-8111-111111111111',
        '        cardinality: many',
        '',
      ].join('\n'));

      const report = new Report();
      await validateProject(dir, report);
      const codes = report.findings.map(f => f.code);
      expect(codes).toContain('orm.value');       // bad enum (generatedValue + fetch)
      expect(codes).toContain('orm.reference');    // ghost orm.extends
      expect(codes).toContain('orm.conflict');     // version + transient
      const unknown = report.findings.find(f => f.code === 'orm.unknownKey');
      expect(unknown).toBeDefined();
      expect(unknown!.severity).toBe('warning');
      expect(report.errorCount).toBeGreaterThan(0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
      storageRegistry.reset();
    }
  });

  it('flags a orm.extends inheritance cycle and strategy-on-subclass', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dico-orm-inh-'));
    try {
      fs.writeFileSync(path.join(dir, 'dico.config.json'), JSON.stringify({ version: 1 }));
      const pkg = path.join(dir, 'shop');
      fs.mkdirSync(pkg, { recursive: true });
      fs.writeFileSync(path.join(pkg, 'package.yaml'), 'name: shop\n');
      // A extends B
      fs.writeFileSync(path.join(pkg, 'A.model.yaml'), [
        'entities:',
        '  - uuid: aaaaaaaa-1111-4111-8111-111111111111',
        '    name: A',
        '    description: a',
        '    metadata:',
        '      - name: orm.extends',
        '        value: B',
        '    attributes: []',
        '',
      ].join('\n'));
      // B extends A  → cycle; B also (wrongly) declares a strategy while being a subclass
      fs.writeFileSync(path.join(pkg, 'B.model.yaml'), [
        'entities:',
        '  - uuid: bbbbbbbb-2222-4222-8222-222222222222',
        '    name: B',
        '    description: b',
        '    metadata:',
        '      - name: orm.extends',
        '        value: A',
        '      - name: orm.inheritanceStrategy',
        '        value: SINGLE_TABLE',
        '    attributes: []',
        '',
      ].join('\n'));

      const report = new Report();
      await validateProject(dir, report);
      const codes = report.findings.map(f => f.code);
      expect(codes).toContain('orm.inheritanceCycle');
      const cyc = report.findings.find(f => f.code === 'orm.inheritanceCycle');
      expect(cyc!.severity).toBe('error');
      const strat = report.findings.find(f => f.code === 'orm.inheritance');
      expect(strat).toBeDefined();
      expect(strat!.severity).toBe('warning');
      expect(report.errorCount).toBeGreaterThan(0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
      storageRegistry.reset();
    }
  });

  it('prints summary stats grouped by finding category', () => {
    const report = new Report();
    report.error('relationship.endpoint', 'missing endpoint');
    report.error('relationship.endpoint', 'another missing endpoint');
    report.error('config.derivedType', 'circular type');
    report.warn('package.missingMarker', 'missing package marker');

    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    let output = '';
    try {
      printReport(report, '/tmp/project');
      output = errorSpy.mock.calls.map(call => call.join(' ')).join('\n');
    } finally {
      errorSpy.mockRestore();
    }

    expect(output).toContain('Summary: FAILED — 3 error(s), 1 warning(s).');
    expect(output).toContain('Error categories:');
    expect(output).toContain('  relationship.endpoint: 2');
    expect(output).toContain('  config.derivedType: 1');
    expect(output).toContain('Warning categories:');
    expect(output).toContain('  package.missingMarker: 1');
  });
});
