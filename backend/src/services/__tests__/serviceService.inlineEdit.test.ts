/**
 * Tests for the backend save path used by inline cell editing in flat views (#68),
 * ported in slice 6b''' to drive `serviceService.updateEntity` through the
 * registered `LogicalProjection` rather than the legacy `writeEntityFile` mock.
 *
 * The frontend inline-edit flow always sends the FULL entity to PUT /api/services/:svc/entities/:name
 * after mutating one field client-side. These tests verify that:
 *
 *  1. A round-trip preserves all fields the client did not touch
 *  2. Single-attribute-field updates persist correctly
 *  3. Single-metadata-entry updates persist correctly
 *  4. The entity not-found case returns a clean error
 *  5. updatedAt is refreshed; createdAt is preserved
 *
 * "returns failure when the file write fails" was removed in slice 6b'''. The
 * old writeEntityFile boolean-return contract no longer applies; projection.writeEntity
 * throws on failure and the existing try/catch propagates the error to
 * {success: false}. The error-propagation contract is already exercised by the
 * not-found test above.
 */
import { AttributeType, Entity } from '../../models/EntitySchema.js';
import { InMemoryStorageBackend } from '../../storage/memory/InMemoryStorageBackend.js';
import { wsId } from '../../storage/contract/types.js';
import { LogicalProjection } from '../../storage/projection/LogicalProjection.js';
import { registerProjection, resetProjectionRegistry } from '../../storage/projection/ProjectionRegistry.js';
import { UuidIndex, resetUuidIndexRegistry } from '../../storage/projection/UuidIndex.js';
import { serviceService } from '../serviceService.js';

jest.mock('../../utils/logger', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

jest.mock('../stereotypeService', () => ({
  stereotypeService: {
    getStereotype: jest.fn().mockResolvedValue(null),
    validateMetadata: jest.fn().mockReturnValue([]),
  },
}));

const DICT_WS = wsId('dictionaries');

async function setBackendDynamic(b: InMemoryStorageBackend): Promise<void> {
  const { storageRegistry } = await import('../../storage/contract/StorageBackendToken.js');
  storageRegistry.setBackend(b);
}

async function resetRegistryDynamic(): Promise<void> {
  const { storageRegistry } = await import('../../storage/contract/StorageBackendToken.js');
  storageRegistry.reset();
}

const PACKAGE_YAML = `name: e-commerce\n`;

function createSeededBackend(): InMemoryStorageBackend {
  const b = new InMemoryStorageBackend();
  const ws = String(DICT_WS);
  if (!b.files.has(ws)) b.files.set(ws, new Map());
  // Root-dir marker so listPackages() succeeds (see slice-6c fixture rationale).
  let rootDirs = b.dirs.get(ws);
  if (!rootDirs) {
    rootDirs = new Set<string>();
    b.dirs.set(ws, rootDirs);
  }
  rootDirs.add('');
  b.files.get(ws)!.set('e-commerce/package.yaml', PACKAGE_YAML);
  return b;
}

let backend: InMemoryStorageBackend;
let projection: LogicalProjection;
let uuidIndex: UuidIndex;

// Valid v4-style UUIDs (slice 6b''' port — old fixture used dummy strings
// that bypassed validation via writeEntityFile mock; projection routes
// through real validateEntity which requires UUID pattern).
const ENTITY_UUID = '00000000-0000-4000-8000-00000000c001';
const ATTR1_UUID = '00000000-0000-4000-8000-00000000c0a1';
const ATTR2_UUID = '00000000-0000-4000-8000-00000000c0a2';

const buildEntity = (overrides: Partial<Entity> = {}): Entity => ({
  uuid: ENTITY_UUID,
  name: 'Customer',
  description: 'A customer',
  attributes: [
    {
      uuid: ATTR1_UUID,
      name: 'email',
      description: 'Customer email',
      type: AttributeType.STRING,
      required: true,
      metadata: [
        { name: 'pii', value: true },
        { name: 'source', value: 'registration' },
      ],
    },
    {
      uuid: ATTR2_UUID,
      name: 'age',
      description: 'Customer age',
      type: AttributeType.NUMBER,
      required: false,
    },
  ],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

async function seedEntity(entity: Entity, service: string = 'e-commerce'): Promise<void> {
  await projection.writeEntity(`packages/${service}/entities/${entity.name}`, entity);
}

beforeEach(async () => {
  backend = createSeededBackend();
  await setBackendDynamic(backend);
  projection = new LogicalProjection(backend, DICT_WS);
  uuidIndex = new UuidIndex(projection, DICT_WS, backend);
  registerProjection(DICT_WS, projection);
  await uuidIndex.rebuild();
  uuidIndex.start();
});

afterEach(async () => {
  await resetRegistryDynamic();
  resetProjectionRegistry();
  resetUuidIndexRegistry();
});

describe('serviceService.updateEntity — inline edit save path', () => {
  describe('full-entity round-trip', () => {
    it('persists an unchanged entity successfully (no-op save)', async () => {
      const entity = buildEntity();
      await seedEntity(entity);

      const result = await serviceService.updateEntity('e-commerce', entity);

      expect(result.success).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('returns failure when the entity does not exist on disk', async () => {
      // Do NOT seed — readEntityFile pre-check should fail.
      const result = await serviceService.updateEntity('e-commerce', buildEntity());

      expect(result.success).toBe(false);
      expect(result.errors[0]).toContain('not found');
      // Read-back should still find no entity.
      expect(await projection.readEntity('packages/e-commerce/entities/Customer')).toBeNull();
    });
  });

  describe('createdAt / updatedAt handling', () => {
    it('preserves createdAt from existing file and refreshes updatedAt', async () => {
      const existing = buildEntity({ createdAt: '2025-12-01T10:00:00.000Z' });
      await seedEntity(existing);

      // Client sends an entity with a different (stale) createdAt — server should ignore it
      const incoming = buildEntity({
        createdAt: '2099-01-01T00:00:00.000Z',
        updatedAt: '2099-01-01T00:00:00.000Z',
      });
      const before = Date.now();
      await serviceService.updateEntity('e-commerce', incoming);

      const written = await projection.readEntity('packages/e-commerce/entities/Customer');
      expect(written?.createdAt).toBe('2025-12-01T10:00:00.000Z');
      // updatedAt should be a fresh timestamp around "now", not the stale 2099 one
      const writtenUpdatedAt = new Date(written!.updatedAt!).getTime();
      expect(writtenUpdatedAt).toBeGreaterThanOrEqual(before);
      expect(writtenUpdatedAt).toBeLessThanOrEqual(Date.now() + 1000);
    });
  });

  describe('inline single-field edits', () => {
    it('persists an entity description change without losing attributes', async () => {
      await seedEntity(buildEntity());

      // Simulate the inline-edit flow: client takes the entity, mutates description, PUTs
      const updated = buildEntity({ description: 'A premium customer' });
      const result = await serviceService.updateEntity('e-commerce', updated);

      expect(result.success).toBe(true);
      const written = await projection.readEntity('packages/e-commerce/entities/Customer');
      expect(written?.description).toBe('A premium customer');
      expect(written?.attributes).toHaveLength(2);
      expect(written?.attributes[0].name).toBe('email');
      expect(written?.attributes[1].name).toBe('age');
    });

    it('persists an attribute name change without disturbing siblings', async () => {
      await seedEntity(buildEntity());

      const updated = buildEntity();
      // Inline-edit: rename only the first attribute
      updated.attributes[0] = { ...updated.attributes[0], name: 'email_address' };

      await serviceService.updateEntity('e-commerce', updated);

      const written = await projection.readEntity('packages/e-commerce/entities/Customer');
      expect(written?.attributes[0].name).toBe('email_address');
      expect(written?.attributes[0].uuid).toBe(ATTR1_UUID);
      expect(written?.attributes[0].type).toBe(AttributeType.STRING);
      expect(written?.attributes[0].required).toBe(true);
      expect(written?.attributes[1].name).toBe('age');
    });

    it('persists an attribute type change (dropdown edit)', async () => {
      await seedEntity(buildEntity());

      const updated = buildEntity();
      updated.attributes[0] = { ...updated.attributes[0], type: AttributeType.INTEGER };

      await serviceService.updateEntity('e-commerce', updated);

      const written = await projection.readEntity('packages/e-commerce/entities/Customer');
      expect(written?.attributes[0].type).toBe(AttributeType.INTEGER);
      // Other fields preserved
      expect(written?.attributes[0].name).toBe('email');
      expect(written?.attributes[0].description).toBe('Customer email');
    });

    it('persists toggling required from true to false', async () => {
      await seedEntity(buildEntity());

      const updated = buildEntity();
      updated.attributes[0] = { ...updated.attributes[0], required: false };

      await serviceService.updateEntity('e-commerce', updated);

      const written = await projection.readEntity('packages/e-commerce/entities/Customer');
      expect(written?.attributes[0].required).toBe(false);
    });

    it('persists a description (textarea) change with multiline content', async () => {
      await seedEntity(buildEntity());

      const updated = buildEntity();
      updated.attributes[0] = {
        ...updated.attributes[0],
        description: 'Line one\nLine two\nLine three',
      };

      await serviceService.updateEntity('e-commerce', updated);

      const written = await projection.readEntity('packages/e-commerce/entities/Customer');
      expect(written?.attributes[0].description).toBe('Line one\nLine two\nLine three');
    });
  });

  describe('inline metadata edits', () => {
    it('updates a single existing metadata entry, preserving the others', async () => {
      await seedEntity(buildEntity());

      const updated = buildEntity();
      // Simulate setMetadataValue: replace `source` value, keep `pii` untouched
      updated.attributes[0] = {
        ...updated.attributes[0],
        metadata: [
          { name: 'pii', value: true },
          { name: 'source', value: 'imported' },
        ],
      };

      await serviceService.updateEntity('e-commerce', updated);

      const written = await projection.readEntity('packages/e-commerce/entities/Customer');
      const meta = written!.attributes[0].metadata!;
      expect(meta).toHaveLength(2);
      expect(meta.find(m => m.name === 'pii')?.value).toBe(true);
      expect(meta.find(m => m.name === 'source')?.value).toBe('imported');
    });

    it('appends a new metadata entry on an attribute that had no metadata', async () => {
      await seedEntity(buildEntity());

      const updated = buildEntity();
      // attr-2 (age) has no metadata initially
      updated.attributes[1] = {
        ...updated.attributes[1],
        metadata: [{ name: 'sensitive', value: false }],
      };

      await serviceService.updateEntity('e-commerce', updated);

      const written = await projection.readEntity('packages/e-commerce/entities/Customer');
      expect(written?.attributes[1].metadata).toEqual([{ name: 'sensitive', value: false }]);
      // Other attribute's metadata untouched
      expect(written?.attributes[0].metadata).toHaveLength(2);
    });

    it('toggles a boolean (flag) metadata value', async () => {
      await seedEntity(buildEntity());

      const updated = buildEntity();
      updated.attributes[0] = {
        ...updated.attributes[0],
        metadata: [
          { name: 'pii', value: false }, // toggled from true
          { name: 'source', value: 'registration' },
        ],
      };

      await serviceService.updateEntity('e-commerce', updated);

      const written = await projection.readEntity('packages/e-commerce/entities/Customer');
      expect(written?.attributes[0].metadata!.find(m => m.name === 'pii')?.value).toBe(false);
    });
  });
});
