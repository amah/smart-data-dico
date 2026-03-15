import { Dictionary, DictionaryEntry } from '../Dictionary.js';

describe('Dictionary Model', () => {
  describe('Dictionary Interface', () => {
    it('should create a valid Dictionary object', () => {
      const dictionary: Dictionary = {
        id: 'test-dict-1',
        name: 'Test Dictionary',
        description: 'A test dictionary',
        version: '1.0.0',
        createdAt: new Date(),
        updatedAt: new Date(),
        rootPackage: { id: 'root', name: 'Root', entities: [], subPackages: [] },
      };

      expect(dictionary).toBeDefined();
      expect(dictionary.id).toBe('test-dict-1');
      expect(dictionary.name).toBe('Test Dictionary');
      expect(dictionary.description).toBe('A test dictionary');
      expect(dictionary.version).toBe('1.0.0');
      expect(dictionary.createdAt).toBeInstanceOf(Date);
      expect(dictionary.updatedAt).toBeInstanceOf(Date);
    });

    it('should create a Dictionary with only required fields', () => {
      const dictionary: Dictionary = {
        id: 'test-dict-2',
        name: 'Minimal Dictionary',
        rootPackage: { id: 'root', name: 'Root', entities: [], subPackages: [] },
      };

      expect(dictionary).toBeDefined();
      expect(dictionary.id).toBe('test-dict-2');
      expect(dictionary.name).toBe('Minimal Dictionary');
      expect(dictionary.description).toBeUndefined();
      expect(dictionary.version).toBeUndefined();
      expect(dictionary.createdAt).toBeUndefined();
      expect(dictionary.updatedAt).toBeUndefined();
    });
  });

  describe('DictionaryEntry Interface', () => {
    it('should create a valid DictionaryEntry object', () => {
      const entry: DictionaryEntry = {
        id: 'entry-1',
        name: 'Test Entry',
        description: 'A test entry',
        type: 'string',
        format: 'email',
        required: true,
        defaultValue: 'test@example.com',
        examples: ['user@example.com', 'admin@example.com'],
        metadata: {
          source: 'user',
          lastUpdated: '2023-01-01',
        },
      };

      expect(entry).toBeDefined();
      expect(entry.id).toBe('entry-1');
      expect(entry.name).toBe('Test Entry');
      expect(entry.description).toBe('A test entry');
      expect(entry.type).toBe('string');
      expect(entry.format).toBe('email');
      expect(entry.required).toBe(true);
      expect(entry.defaultValue).toBe('test@example.com');
      expect(entry.examples).toHaveLength(2);
      expect(entry.examples).toContain('user@example.com');
      expect(entry.metadata).toHaveProperty('source', 'user');
    });

    it('should create a DictionaryEntry with only required fields', () => {
      const entry: DictionaryEntry = {
        id: 'entry-2',
        name: 'Minimal Entry',
        description: 'A minimal entry',
        type: 'number',
      };

      expect(entry).toBeDefined();
      expect(entry.id).toBe('entry-2');
      expect(entry.name).toBe('Minimal Entry');
      expect(entry.description).toBe('A minimal entry');
      expect(entry.type).toBe('number');
      expect(entry.format).toBeUndefined();
      expect(entry.required).toBeUndefined();
      expect(entry.defaultValue).toBeUndefined();
      expect(entry.examples).toBeUndefined();
      expect(entry.metadata).toBeUndefined();
    });
  });
});