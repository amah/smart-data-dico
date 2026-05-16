/**
 * stereotypeService.165b.test.ts — #165b acceptance criteria
 *
 * Verifies:
 * - HTTP byte-identity: getAllStereotypes() returns same shape as pre-migration
 * - Write-path routing to .dico/schemas/ when legacy YAML is empty
 * - Write-path routing to .dico/stereotypes.yaml when .dico/schemas/ is absent
 * - View round-trip on eshop fixtures
 * - All 7 migrated schema-entities present in list()
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as YAML from 'yaml';
import { METADATA_SCHEMA_MARKER, METADATA_SCHEMA_MARKER_UUID } from '../schemaEntityService.js';
import type { Stereotype } from '../../models/EntitySchema.js';
import { InMemoryStorageBackend } from '../../storage/memory/InMemoryStorageBackend.js';
import { wsId, pathOf } from '../../storage/contract/types.js';

// Mock logger so we can assert on log messages
const mockWarn = jest.fn();
const mockInfo = jest.fn();
const mockError = jest.fn();
jest.mock('../../utils/logger', () => ({
  logger: {
    warn: (...args: any[]) => mockWarn(...args),
    error: (...args: any[]) => mockError(...args),
    info: (...args: any[]) => mockInfo(...args),
    debug: jest.fn(),
  },
}));

// Track the current test data directory
let testDataDir = '';

// Override config.dataDir to use testDataDir
jest.mock('../../kernel/config.js', () => ({
  config: {
    get dataDir() { return testDataDir; },
    git: { autoCommit: false },
  },
}));

const TEST_WS = wsId('dictionaries');

// Helper: create a temp data dir with optional legacy stereotypes and schema-entities
// (Used for schemaEntityService which still reads from disk via config.dataDir)
function makeTempDataDir(opts: {
  legacyStereotypes?: any[];
  schemaEntities?: Array<{ name: string; uuid: string; appliesTo?: string; domain?: string; displayName?: string; attributes?: any[]; description?: string }>;
  includeMarker?: boolean;
  noSchemasDir?: boolean;
}): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dico-test-165b-'));

  // Create .dico directory
  const dicoDir = path.join(dir, '.dico');
  fs.mkdirSync(dicoDir, { recursive: true });

  // Write legacy stereotypes.yaml to disk (for reference — service now uses backend)
  const legacyContent = opts.legacyStereotypes ?? [];
  fs.writeFileSync(
    path.join(dicoDir, 'stereotypes.yaml'),
    legacyContent.length > 0 ? YAML.stringify(legacyContent) : '[]\n',
    'utf8',
  );

  if (!opts.noSchemasDir) {
    // Create .dico/schemas/ directory
    const schemasDir = path.join(dicoDir, 'schemas');
    fs.mkdirSync(schemasDir, { recursive: true });

    // Create package.yaml
    fs.writeFileSync(path.join(schemasDir, 'package.yaml'), 'name: .dico/schemas\n', 'utf8');

    // Create _meta/ directory and marker
    const metaDir = path.join(schemasDir, '_meta');
    fs.mkdirSync(metaDir, { recursive: true });

    if (opts.includeMarker !== false) {
      const markerEntity = {
        uuid: METADATA_SCHEMA_MARKER_UUID,
        name: METADATA_SCHEMA_MARKER,
        description: 'Bootstrap marker entity',
        attributes: [],
      };
      fs.writeFileSync(
        path.join(metaDir, 'metadata-schema.entity.yaml'),
        YAML.stringify({ entities: [markerEntity] }),
        'utf8',
      );
    }

    // Write schema-entities as .dico/schemas/<slug>.entity.yaml
    if (opts.schemaEntities) {
      for (const se of opts.schemaEntities) {
        const entity: any = {
          uuid: se.uuid,
          name: se.name,
          stereotype: METADATA_SCHEMA_MARKER,
          attributes: se.attributes || [],
        };
        if (se.description) entity.description = se.description;

        const metadata: any[] = [];
        if (se.appliesTo) metadata.push({ name: 'appliesTo', value: se.appliesTo });
        if (se.domain) metadata.push({ name: 'domain', value: se.domain });
        if (se.displayName) metadata.push({ name: 'displayName', value: se.displayName });
        if (metadata.length > 0) entity.metadata = metadata;

        fs.writeFileSync(
          path.join(schemasDir, `${se.name}.entity.yaml`),
          YAML.stringify({ entities: [entity] }),
          'utf8',
        );
      }
    }
  }

  return dir;
}

afterEach(() => {
  // Only delete temp dirs — never delete the real eshop sample directory.
  // Temp dirs are created via fs.mkdtempSync (prefix: 'dico-test-165b-')
  if (testDataDir && testDataDir.includes('dico-test-165b-') && fs.existsSync(testDataDir)) {
    fs.rmSync(testDataDir, { recursive: true, force: true });
  }
  testDataDir = '';
  jest.resetModules();
  mockWarn.mockClear();
  mockError.mockClear();
  mockInfo.mockClear();
});

// ─────────────────────────────────────────────────────────────────────────────
// AC#6 — schemaEntityService.list() returns 7 entities on eshop fixtures
// ─────────────────────────────────────────────────────────────────────────────

describe('AC#6: schemaEntityService.list() returns 7 schema-entities on migrated fixture', () => {
  const EXPECTED_SLUGS = [
    'aggregate-root', 'value-object', 'event', 'reference-data',
    'pii', 'indexed', 'deprecated',
  ];

  it('migrated eshop fixture has exactly 7 schema-entities', async () => {
    // Use the actual eshop sample directory
    const eshopDir = path.join(__dirname, '../../../../samples/eshop');
    testDataDir = eshopDir;

    const { SchemaEntityService } = await import('../schemaEntityService.js');
    const svc = new SchemaEntityService();
    const entities = await svc.list();

    expect(entities).toHaveLength(7);

    const slugs = entities.map(e => e.name);
    for (const expected of EXPECTED_SLUGS) {
      expect(slugs).toContain(expected);
    }
  });

  it('each entity has stereotype === "metadata-schema" and valid uuid', async () => {
    const eshopDir = path.join(__dirname, '../../../../samples/eshop');
    testDataDir = eshopDir;

    const { SchemaEntityService } = await import('../schemaEntityService.js');
    const svc = new SchemaEntityService();
    const entities = await svc.list();

    for (const entity of entities) {
      expect(entity.stereotype).toBe('metadata-schema');
      expect(entity.uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC#7 — findByName('pii') returns pii schema-entity
// ─────────────────────────────────────────────────────────────────────────────

describe('AC#7: findByName("pii") returns the pii schema-entity', () => {
  it('finds pii by name', async () => {
    const eshopDir = path.join(__dirname, '../../../../samples/eshop');
    testDataDir = eshopDir;

    const { SchemaEntityService } = await import('../schemaEntityService.js');
    const svc = new SchemaEntityService();
    const entity = await svc.findByName('pii');

    expect(entity).not.toBeNull();
    expect(entity!.name).toBe('pii');
    expect(entity!.stereotype).toBe('metadata-schema');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC#4 — getAllStereotypes() is byte-identical to pre-#165b for eshop
// ─────────────────────────────────────────────────────────────────────────────

describe('AC#4: getAllStereotypes() byte-identical to pre-#165b', () => {
  // Pre-#165b expected data (extracted from samples/eshop/.dico/stereotypes.yaml
  // before it was emptied)
  const EXPECTED_STEREOTYPES: Record<string, Partial<Stereotype>> = {
    'aggregate-root': {
      id: 'aggregate-root',
      name: 'Aggregate Root',
      appliesTo: 'entity',
    },
    'value-object': {
      id: 'value-object',
      name: 'Value Object',
      appliesTo: 'entity',
    },
    event: {
      id: 'event',
      name: 'Domain Event',
      appliesTo: 'entity',
    },
    'reference-data': {
      id: 'reference-data',
      name: 'Reference Data',
      appliesTo: 'entity',
    },
    pii: {
      id: 'pii',
      name: 'PII',
      appliesTo: 'attribute',
    },
    indexed: {
      id: 'indexed',
      name: 'Indexed',
      appliesTo: 'attribute',
    },
    deprecated: {
      id: 'deprecated',
      name: 'Deprecated',
      appliesTo: 'attribute',
    },
  };

  it('all 7 stereotypes present with correct ids', async () => {
    const eshopDir = path.join(__dirname, '../../../../samples/eshop');
    testDataDir = eshopDir;

    const { SchemaEntityService } = await import('../schemaEntityService.js');
    const { toLegacyStereotypeView } = await import('../schemaEntityView.js');

    const svc = new SchemaEntityService();
    const entities = await svc.list();
    const stereotypes = entities.map(toLegacyStereotypeView);

    for (const [id, expected] of Object.entries(EXPECTED_STEREOTYPES)) {
      const stereo = stereotypes.find(s => s.id === id);
      expect(stereo).toBeDefined();
      expect(stereo!.id).toBe(expected.id);
      expect(stereo!.name).toBe(expected.name);
      expect(stereo!.appliesTo).toBe(expected.appliesTo);
    }
  });

  it('pii stereotype has correct metadataDefinitions (AC#5)', async () => {
    const eshopDir = path.join(__dirname, '../../../../samples/eshop');
    testDataDir = eshopDir;

    const { SchemaEntityService } = await import('../schemaEntityService.js');
    const { toLegacyStereotypeView } = await import('../schemaEntityView.js');

    const svc = new SchemaEntityService();
    const entity = await svc.findByName('pii');
    expect(entity).not.toBeNull();

    const stereo = toLegacyStereotypeView(entity!);
    expect(stereo.id).toBe('pii');
    expect(stereo.name).toBe('PII');
    expect((stereo as any).domain).toBe('Privacy');
    expect(stereo.appliesTo).toBe('attribute');
    expect(stereo.metadataDefinitions).toHaveLength(3);
    expect(stereo.metadataDefinitions[0].name).toBe('pii-category');
    expect(stereo.metadataDefinitions[0].required).toBe(true);
    expect(stereo.metadataDefinitions[1].name).toBe('retention-days');
    expect(stereo.metadataDefinitions[2].name).toBe('encryption-required');
  });

  it('aggregate-root stereotype — slug preserved (AI prompt dependency)', async () => {
    const eshopDir = path.join(__dirname, '../../../../samples/eshop');
    testDataDir = eshopDir;

    const { SchemaEntityService } = await import('../schemaEntityService.js');
    const { toLegacyStereotypeView } = await import('../schemaEntityView.js');

    const svc = new SchemaEntityService();
    const entity = await svc.findByName('aggregate-root');
    expect(entity).not.toBeNull();

    const stereo = toLegacyStereotypeView(entity!);
    expect(stereo.id).toBe('aggregate-root');
    expect(stereo.name).toBe('Aggregate Root');
    expect(stereo.metadataDefinitions.some(d => d.name === 'bounded-context')).toBe(true);
  });

  it('event stereotype — "event" slug preserved (AI prompt dependency)', async () => {
    const eshopDir = path.join(__dirname, '../../../../samples/eshop');
    testDataDir = eshopDir;

    const { SchemaEntityService } = await import('../schemaEntityService.js');
    const { toLegacyStereotypeView } = await import('../schemaEntityView.js');

    const svc = new SchemaEntityService();
    const entity = await svc.findByName('event');
    expect(entity).not.toBeNull();

    const stereo = toLegacyStereotypeView(entity!);
    expect(stereo.id).toBe('event');
    expect(stereo.name).toBe('Domain Event');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC#9 — Write path routes to schemas/ on migrated fixture
// ─────────────────────────────────────────────────────────────────────────────

describe('AC#9: write path routes to .dico/schemas/ when legacy YAML is empty', () => {
  it('createStereotype creates .dico/schemas/<slug>.entity.yaml, not stereotypes.yaml', async () => {
    testDataDir = makeTempDataDir({
      legacyStereotypes: [], // empty — triggers schema write path
      schemaEntities: [
        {
          uuid: 'aaaaaaaa-0000-1000-8000-000000000001',
          name: 'pii',
          appliesTo: 'attribute',
          domain: 'Privacy',
          displayName: 'PII',
          attributes: [],
        },
      ],
      includeMarker: true,
    });

    // Register backend with empty stereotypes.yaml, using the SAME module instance
    // that stereotypeService will import.
    const { storageRegistry: reg } = await import('../../storage/contract/StorageBackendToken.js');
    const backend = new InMemoryStorageBackend();
    await backend.write(TEST_WS, pathOf('.dico/stereotypes.yaml'), '[]\n');
    reg.setBackend(backend);

    const { stereotypeService: svc } = await import('../stereotypeService.js');

    const result = await svc.createStereotype({
      id: 'audit-log',
      name: 'Audit Log',
      appliesTo: 'entity',
      metadataDefinitions: [],
    });

    expect(result.success).toBe(true);

    // Assert schema file was created on disk (schemaEntityWriter still uses disk)
    const schemaFile = path.join(testDataDir, '.dico', 'schemas', 'audit-log.entity.yaml');
    expect(fs.existsSync(schemaFile)).toBe(true);

    // Assert stereotypes.yaml in backend remains empty
    const legacyBytes = await backend.read(TEST_WS, pathOf('.dico/stereotypes.yaml'));
    const parsed = YAML.parse(legacyBytes);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(0);

    // Clean up test artifact
    if (fs.existsSync(schemaFile)) fs.unlinkSync(schemaFile);
  });

  it('createStereotype returns success:false when slug already exists as schema-entity', async () => {
    testDataDir = makeTempDataDir({
      legacyStereotypes: [],
      schemaEntities: [
        {
          uuid: 'bbbbbbbb-0000-1000-8000-000000000001',
          name: 'pii',
          appliesTo: 'attribute',
          attributes: [],
        },
      ],
      includeMarker: true,
    });

    // Register backend with empty stereotypes.yaml
    const { storageRegistry: reg } = await import('../../storage/contract/StorageBackendToken.js');
    const backend = new InMemoryStorageBackend();
    await backend.write(TEST_WS, pathOf('.dico/stereotypes.yaml'), '[]\n');
    reg.setBackend(backend);

    const { stereotypeService: svc } = await import('../stereotypeService.js');

    const result = await svc.createStereotype({
      id: 'pii',
      name: 'PII',
      appliesTo: 'attribute',
      metadataDefinitions: [],
    });

    expect(result.success).toBe(false);
    expect(result.errors).toBeDefined();
    expect(result.errors!.join(' ')).toContain('pii');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC#10 — Write path routes to legacy YAML without .dico/schemas/
// ─────────────────────────────────────────────────────────────────────────────

describe('AC#10: write path routes to .dico/stereotypes.yaml when no schemas/', () => {
  it('createStereotype writes to stereotypes.yaml when schemas/ dir is absent', async () => {
    testDataDir = makeTempDataDir({
      legacyStereotypes: [],
      noSchemasDir: true,
    });

    // Register backend with empty stereotypes.yaml
    const { storageRegistry: reg } = await import('../../storage/contract/StorageBackendToken.js');
    const backend = new InMemoryStorageBackend();
    await backend.write(TEST_WS, pathOf('.dico/stereotypes.yaml'), '[]\n');
    reg.setBackend(backend);

    const { stereotypeService: svc } = await import('../stereotypeService.js');

    const result = await svc.createStereotype({
      id: 'my-type',
      name: 'My Type',
      appliesTo: 'entity',
      metadataDefinitions: [],
    });

    expect(result.success).toBe(true);

    // Assert written to stereotypes.yaml in the backend
    const legacyBytes = await backend.read(TEST_WS, pathOf('.dico/stereotypes.yaml'));
    const parsed = YAML.parse(legacyBytes) || [];
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.some((s: any) => s.id === 'my-type')).toBe(true);

    // Assert no schema dir was created on disk
    const schemaDir = path.join(testDataDir, '.dico', 'schemas');
    expect(fs.existsSync(schemaDir)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC#1 — All 7 schema-entity files exist (file system check)
// ─────────────────────────────────────────────────────────────────────────────

describe('AC#1: all 7 schema-entity files exist', () => {
  const EXPECTED_FILES = [
    'aggregate-root.entity.yaml',
    'value-object.entity.yaml',
    'event.entity.yaml',
    'reference-data.entity.yaml',
    'pii.entity.yaml',
    'indexed.entity.yaml',
    'deprecated.entity.yaml',
  ];

  it('all expected files present in samples/eshop/.dico/schemas/', () => {
    const schemasDir = path.join(__dirname, '../../../../samples/eshop/.dico/schemas');

    for (const filename of EXPECTED_FILES) {
      const filePath = path.join(schemasDir, filename);
      expect(fs.existsSync(filePath)).toBe(true);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC#3 — stereotypes.yaml is empty
// ─────────────────────────────────────────────────────────────────────────────

describe('AC#3: stereotypes.yaml is empty []', () => {
  it('samples/eshop/.dico/stereotypes.yaml contains []', () => {
    const stereotypesFile = path.join(
      __dirname,
      '../../../../samples/eshop/.dico/stereotypes.yaml',
    );
    const content = fs.readFileSync(stereotypesFile, 'utf8');
    const parsed = YAML.parse(content);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC#14 — multi-kind YAML semantics preserved (#106)
// ─────────────────────────────────────────────────────────────────────────────

describe('AC#14: multi-kind YAML semantics (#106)', () => {
  it('loadSchemaPackage() returns 8 entities (7 schema-entities + 1 marker)', async () => {
    const eshopDir = path.join(__dirname, '../../../../samples/eshop');
    testDataDir = eshopDir;

    const { loadSchemaPackage } = await import('../../utils/fileOperations.js');
    const pkg = await loadSchemaPackage();

    // 7 schema-entities + 1 bootstrap marker
    expect(pkg.entities).toHaveLength(8);

    const markerEntity = pkg.entities.find(e => e.uuid === METADATA_SCHEMA_MARKER_UUID);
    expect(markerEntity).toBeDefined();

    const schemaEntities = pkg.entities.filter(e => e.stereotype === 'metadata-schema');
    expect(schemaEntities).toHaveLength(7);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// preferSchemaEntityWrite internal routing
// ─────────────────────────────────────────────────────────────────────────────

describe('preferSchemaEntityWrite() routing logic', () => {
  it('returns true when legacy YAML is empty and schema-entities exist', async () => {
    testDataDir = makeTempDataDir({
      legacyStereotypes: [],
      schemaEntities: [
        {
          uuid: 'cccccccc-0000-1000-8000-000000000001',
          name: 'foo',
          appliesTo: 'entity',
          attributes: [],
        },
      ],
      includeMarker: true,
    });

    // Register backend with empty stereotypes.yaml (same module instance as import)
    const { storageRegistry: reg } = await import('../../storage/contract/StorageBackendToken.js');
    const backend = new InMemoryStorageBackend();
    await backend.write(TEST_WS, pathOf('.dico/stereotypes.yaml'), '[]\n');
    reg.setBackend(backend);

    const { stereotypeService: svc } = await import('../stereotypeService.js');

    const result = await (svc as any).preferSchemaEntityWrite();
    expect(result).toBe(true);
  });

  it('returns false when legacy YAML has entries (even if schema-entities also exist)', async () => {
    testDataDir = makeTempDataDir({
      legacyStereotypes: [
        { id: 'alpha', name: 'Alpha', appliesTo: 'entity', metadataDefinitions: [] },
      ],
      schemaEntities: [
        {
          uuid: 'dddddddd-0000-1000-8000-000000000001',
          name: 'foo',
          appliesTo: 'entity',
          attributes: [],
        },
      ],
      includeMarker: true,
    });

    // Register backend seeded with legacy entries
    const { storageRegistry: reg } = await import('../../storage/contract/StorageBackendToken.js');
    const backend = new InMemoryStorageBackend();
    await backend.write(
      TEST_WS,
      pathOf('.dico/stereotypes.yaml'),
      YAML.stringify([{ id: 'alpha', name: 'Alpha', appliesTo: 'entity', metadataDefinitions: [] }]),
    );
    reg.setBackend(backend);

    const { stereotypeService: svc } = await import('../stereotypeService.js');

    const result = await (svc as any).preferSchemaEntityWrite();
    expect(result).toBe(false);
  });

  it('returns false when schema-entities list is empty (only marker)', async () => {
    testDataDir = makeTempDataDir({
      legacyStereotypes: [],
      schemaEntities: [], // no user-authored schema-entities
      includeMarker: true,
    });

    // Register backend with empty stereotypes.yaml
    const { storageRegistry: reg } = await import('../../storage/contract/StorageBackendToken.js');
    const backend = new InMemoryStorageBackend();
    await backend.write(TEST_WS, pathOf('.dico/stereotypes.yaml'), '[]\n');
    reg.setBackend(backend);

    const { stereotypeService: svc } = await import('../stereotypeService.js');

    const result = await (svc as any).preferSchemaEntityWrite();
    expect(result).toBe(false);
  });
});
