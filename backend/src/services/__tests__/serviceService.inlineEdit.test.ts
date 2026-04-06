/**
 * Tests for the backend save path used by inline cell editing in flat views (#68).
 *
 * The frontend inline-edit flow always sends the FULL entity to PUT /api/services/:svc/entities/:name
 * after mutating one field client-side. These tests verify that:
 *
 *  1. A round-trip preserves all fields the client did not touch
 *  2. Single-attribute-field updates persist correctly
 *  3. Single-metadata-entry updates persist correctly
 *  4. The entity not-found case returns a clean error
 *  5. updatedAt is refreshed; createdAt is preserved
 */
import { readEntityFile, writeEntityFile } from '../../utils/fileOperations.js';
import { serviceService } from '../serviceService.js';
import { AttributeType, Entity } from '../../models/EntitySchema.js';

jest.mock('../../utils/fileOperations');
jest.mock('../../utils/logger');
jest.mock('../stereotypeService', () => ({
  stereotypeService: {
    getStereotype: jest.fn().mockResolvedValue(null),
    validateMetadata: jest.fn().mockReturnValue([]),
  },
}));

const mockedRead = readEntityFile as jest.Mock;
const mockedWrite = writeEntityFile as jest.Mock;

const buildEntity = (overrides: Partial<Entity> = {}): Entity => ({
  uuid: 'ent-1',
  name: 'Customer',
  description: 'A customer',
  attributes: [
    {
      uuid: 'attr-1',
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
      uuid: 'attr-2',
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

describe('serviceService.updateEntity — inline edit save path', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedWrite.mockResolvedValue(true);
  });

  describe('full-entity round-trip', () => {
    it('persists an unchanged entity successfully (no-op save)', async () => {
      const entity = buildEntity();
      mockedRead.mockResolvedValue(entity);

      const result = await serviceService.updateEntity('e-commerce', entity);

      expect(result.success).toBe(true);
      expect(result.errors).toEqual([]);
      expect(mockedWrite).toHaveBeenCalledTimes(1);
    });

    it('returns failure when the entity does not exist on disk', async () => {
      mockedRead.mockResolvedValue(null);

      const result = await serviceService.updateEntity('e-commerce', buildEntity());

      expect(result.success).toBe(false);
      expect(result.errors[0]).toContain('not found');
      expect(mockedWrite).not.toHaveBeenCalled();
    });

    it('returns failure when the file write fails', async () => {
      mockedRead.mockResolvedValue(buildEntity());
      mockedWrite.mockResolvedValue(false);

      const result = await serviceService.updateEntity('e-commerce', buildEntity());

      expect(result.success).toBe(false);
      expect(result.errors).toContain('Failed to write entity file');
    });
  });

  describe('createdAt / updatedAt handling', () => {
    it('preserves createdAt from existing file and refreshes updatedAt', async () => {
      const existing = buildEntity({ createdAt: '2025-12-01T10:00:00.000Z' });
      mockedRead.mockResolvedValue(existing);

      // Client sends an entity with a different (stale) createdAt — server should ignore it
      const incoming = buildEntity({
        createdAt: '2099-01-01T00:00:00.000Z',
        updatedAt: '2099-01-01T00:00:00.000Z',
      });
      const before = Date.now();
      await serviceService.updateEntity('e-commerce', incoming);

      const written = mockedWrite.mock.calls[0][0] as Entity;
      expect(written.createdAt).toBe('2025-12-01T10:00:00.000Z');
      // updatedAt should be a fresh timestamp around "now", not the stale 2099 one
      const writtenUpdatedAt = new Date(written.updatedAt!).getTime();
      expect(writtenUpdatedAt).toBeGreaterThanOrEqual(before);
      expect(writtenUpdatedAt).toBeLessThanOrEqual(Date.now() + 1000);
    });
  });

  describe('inline single-field edits', () => {
    it('persists an entity description change without losing attributes', async () => {
      mockedRead.mockResolvedValue(buildEntity());

      // Simulate the inline-edit flow: client takes the entity, mutates description, PUTs
      const updated = buildEntity({ description: 'A premium customer' });
      const result = await serviceService.updateEntity('e-commerce', updated);

      expect(result.success).toBe(true);
      const written = mockedWrite.mock.calls[0][0] as Entity;
      expect(written.description).toBe('A premium customer');
      expect(written.attributes).toHaveLength(2);
      expect(written.attributes[0].name).toBe('email');
      expect(written.attributes[1].name).toBe('age');
    });

    it('persists an attribute name change without disturbing siblings', async () => {
      mockedRead.mockResolvedValue(buildEntity());

      const updated = buildEntity();
      // Inline-edit: rename only the first attribute
      updated.attributes[0] = { ...updated.attributes[0], name: 'email_address' };

      await serviceService.updateEntity('e-commerce', updated);

      const written = mockedWrite.mock.calls[0][0] as Entity;
      expect(written.attributes[0].name).toBe('email_address');
      expect(written.attributes[0].uuid).toBe('attr-1');
      expect(written.attributes[0].type).toBe(AttributeType.STRING);
      expect(written.attributes[0].required).toBe(true);
      expect(written.attributes[1].name).toBe('age');
    });

    it('persists an attribute type change (dropdown edit)', async () => {
      mockedRead.mockResolvedValue(buildEntity());

      const updated = buildEntity();
      updated.attributes[0] = { ...updated.attributes[0], type: AttributeType.INTEGER };

      await serviceService.updateEntity('e-commerce', updated);

      const written = mockedWrite.mock.calls[0][0] as Entity;
      expect(written.attributes[0].type).toBe(AttributeType.INTEGER);
      // Other fields preserved
      expect(written.attributes[0].name).toBe('email');
      expect(written.attributes[0].description).toBe('Customer email');
    });

    it('persists toggling required from true to false', async () => {
      mockedRead.mockResolvedValue(buildEntity());

      const updated = buildEntity();
      updated.attributes[0] = { ...updated.attributes[0], required: false };

      await serviceService.updateEntity('e-commerce', updated);

      const written = mockedWrite.mock.calls[0][0] as Entity;
      expect(written.attributes[0].required).toBe(false);
    });

    it('persists a description (textarea) change with multiline content', async () => {
      mockedRead.mockResolvedValue(buildEntity());

      const updated = buildEntity();
      updated.attributes[0] = {
        ...updated.attributes[0],
        description: 'Line one\nLine two\nLine three',
      };

      await serviceService.updateEntity('e-commerce', updated);

      const written = mockedWrite.mock.calls[0][0] as Entity;
      expect(written.attributes[0].description).toBe('Line one\nLine two\nLine three');
    });
  });

  describe('inline metadata edits', () => {
    it('updates a single existing metadata entry, preserving the others', async () => {
      mockedRead.mockResolvedValue(buildEntity());

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

      const written = mockedWrite.mock.calls[0][0] as Entity;
      const meta = written.attributes[0].metadata!;
      expect(meta).toHaveLength(2);
      expect(meta.find(m => m.name === 'pii')?.value).toBe(true);
      expect(meta.find(m => m.name === 'source')?.value).toBe('imported');
    });

    it('appends a new metadata entry on an attribute that had no metadata', async () => {
      mockedRead.mockResolvedValue(buildEntity());

      const updated = buildEntity();
      // attr-2 (age) has no metadata initially
      updated.attributes[1] = {
        ...updated.attributes[1],
        metadata: [{ name: 'sensitive', value: false }],
      };

      await serviceService.updateEntity('e-commerce', updated);

      const written = mockedWrite.mock.calls[0][0] as Entity;
      expect(written.attributes[1].metadata).toEqual([{ name: 'sensitive', value: false }]);
      // Other attribute's metadata untouched
      expect(written.attributes[0].metadata).toHaveLength(2);
    });

    it('toggles a boolean (flag) metadata value', async () => {
      mockedRead.mockResolvedValue(buildEntity());

      const updated = buildEntity();
      updated.attributes[0] = {
        ...updated.attributes[0],
        metadata: [
          { name: 'pii', value: false }, // toggled from true
          { name: 'source', value: 'registration' },
        ],
      };

      await serviceService.updateEntity('e-commerce', updated);

      const written = mockedWrite.mock.calls[0][0] as Entity;
      expect(written.attributes[0].metadata!.find(m => m.name === 'pii')?.value).toBe(false);
    });
  });
});
