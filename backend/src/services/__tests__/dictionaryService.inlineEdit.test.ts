/**
 * Tests for the backend save path used by inline edit on the Package flat view (#68).
 *
 * The frontend sends a PARTIAL package update like { description: '...' } or { name: '...' }
 * to PUT /api/packages/:rootPackage/path/. The service must merge the partial into the
 * existing metadata.yaml without losing fields the client did not send.
 */
import fs from 'fs';
import YAML from 'yaml';
import { dictionaryService } from '../dictionaryService.js';

jest.mock('fs');
jest.mock('../../utils/logger');
jest.mock('../../utils/fileOperations', () => ({
  ensureDirectoryStructure: jest.fn(),
  listAllDictionaries: jest.fn().mockResolvedValue([]),
  listAllEntities: jest.fn().mockResolvedValue([]),
  listMicroserviceEntities: jest.fn().mockResolvedValue([]),
  listMicroservices: jest.fn().mockResolvedValue([]),
  readEntityFile: jest.fn(),
  readRelationshipsFile: jest.fn().mockResolvedValue([]),
  writeDictionaryMetadata: jest.fn(),
}));

const mockedFs = fs as jest.Mocked<typeof fs>;

const buildExistingMetadata = (overrides: Record<string, unknown> = {}) => ({
  id: 'pkg-1',
  name: 'e-commerce',
  description: 'E-commerce dictionary',
  type: 'project',
  metadata: [
    { name: 'owner', value: 'data-team' },
  ],
  ...overrides,
});

describe('dictionaryService.updatePackageAtPath — inline edit save path', () => {
  let writtenYaml: string | null;

  beforeEach(() => {
    jest.clearAllMocks();
    writtenYaml = null;
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(YAML.stringify(buildExistingMetadata()) as any);
    mockedFs.writeFileSync.mockImplementation((_path, content) => {
      writtenYaml = content as string;
    });
  });

  describe('partial updates', () => {
    it('updates only the description, preserving name/type/metadata', async () => {
      const result = await dictionaryService.updatePackageAtPath(
        'e-commerce',
        [],
        { description: 'Updated description' },
      );

      expect(result.success).toBe(true);
      expect(writtenYaml).not.toBeNull();
      const written = YAML.parse(writtenYaml!);
      expect(written.description).toBe('Updated description');
      expect(written.name).toBe('e-commerce'); // preserved
      expect(written.type).toBe('project'); // preserved
      expect(written.metadata).toEqual([{ name: 'owner', value: 'data-team' }]); // preserved
      expect(written.id).toBe('pkg-1'); // preserved
    });

    it('updates only the name, preserving description/type/metadata', async () => {
      const result = await dictionaryService.updatePackageAtPath(
        'e-commerce',
        [],
        { name: 'commerce' },
      );

      expect(result.success).toBe(true);
      const written = YAML.parse(writtenYaml!);
      expect(written.name).toBe('commerce');
      expect(written.description).toBe('E-commerce dictionary'); // preserved
      expect(written.type).toBe('project'); // preserved
      expect(written.metadata).toEqual([{ name: 'owner', value: 'data-team' }]); // preserved
    });

    it('clearing description (passing empty string) is honored', async () => {
      const result = await dictionaryService.updatePackageAtPath(
        'e-commerce',
        [],
        { description: '' },
      );

      expect(result.success).toBe(true);
      const written = YAML.parse(writtenYaml!);
      // description: '' should be saved as '' (not fall back to old value)
      expect(written.description).toBe('');
    });

    it('returns the updated package shape on success', async () => {
      const result = await dictionaryService.updatePackageAtPath(
        'e-commerce',
        [],
        { description: 'New description' },
      );

      expect(result.success).toBe(true);
      expect(result.package).toBeDefined();
      expect(result.package!.name).toBe('e-commerce');
      expect(result.package!.description).toBe('New description');
      expect(result.package!.type).toBe('project');
    });
  });

  describe('error cases', () => {
    it('returns failure when the package directory does not exist', async () => {
      mockedFs.existsSync.mockReturnValueOnce(false);

      const result = await dictionaryService.updatePackageAtPath(
        'nonexistent',
        [],
        { description: 'whatever' },
      );

      expect(result.success).toBe(false);
      expect(result.errors).toContain('Package directory does not exist');
      expect(mockedFs.writeFileSync).not.toHaveBeenCalled();
    });

    it('returns failure when metadata.yaml does not exist', async () => {
      // baseDir exists, but metadata.yaml does not
      mockedFs.existsSync
        .mockReturnValueOnce(true) // baseDir
        .mockReturnValueOnce(false); // metadata.yaml

      const result = await dictionaryService.updatePackageAtPath(
        'e-commerce',
        [],
        { description: 'whatever' },
      );

      expect(result.success).toBe(false);
      expect(result.errors).toContain('metadata.yaml does not exist');
      expect(mockedFs.writeFileSync).not.toHaveBeenCalled();
    });
  });

  describe('subpackage updates', () => {
    it('targets the right metadata.yaml when path is provided', async () => {
      await dictionaryService.updatePackageAtPath(
        'e-commerce',
        ['Customer'],
        { description: 'Customer subpackage' },
      );

      // Verify the path passed to readFileSync includes the subpackage
      const readPath = (mockedFs.readFileSync.mock.calls[0][0] as string);
      expect(readPath).toContain('e-commerce');
      expect(readPath).toContain('Customer');
      expect(readPath).toContain('metadata.yaml');
    });
  });
});
