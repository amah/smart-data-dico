import { dictionaryService } from '../dictionaryService';
import { listMicroservices, listMicroserviceEntities } from '../../utils/fileOperations';
import { entityService } from '../entityService';

// Mock dependencies
jest.mock('../../utils/fileOperations');
jest.mock('../entityService');
jest.mock('../../utils/logger');

describe('DictionaryService', () => {
  beforeEach(() => {
    // Clear all mocks before each test
    jest.clearAllMocks();
  });

  describe('getAllDictionaries', () => {
    it('should return all dictionaries', async () => {
      const dictionaries = await dictionaryService.getAllDictionaries();
      
      expect(listMicroservices).toHaveBeenCalledTimes(1);
      expect(dictionaries).toHaveLength(3);
      expect(dictionaries[0].id).toBe('user-service');
      expect(dictionaries[1].id).toBe('product-service');
      expect(dictionaries[2].id).toBe('order-service');
    });

    it('should return empty array on error', async () => {
      // Mock implementation to throw an error
      (listMicroservices as jest.Mock).mockRejectedValueOnce(new Error('Test error'));
      
      const dictionaries = await dictionaryService.getAllDictionaries();
      
      expect(listMicroservices).toHaveBeenCalledTimes(1);
      expect(dictionaries).toHaveLength(0);
    });
  });

  describe('getDictionaryById', () => {
    it('should return dictionary by ID', async () => {
      const dictionary = await dictionaryService.getDictionaryById('user-service');
      
      expect(listMicroservices).toHaveBeenCalledTimes(1);
      expect(dictionary).not.toBeNull();
      expect(dictionary?.id).toBe('user-service');
      expect(dictionary?.name).toBe('user-service');
    });

    it('should return null for non-existent dictionary', async () => {
      const dictionary = await dictionaryService.getDictionaryById('non-existent');
      
      expect(listMicroservices).toHaveBeenCalledTimes(1);
      expect(dictionary).toBeNull();
    });

    it('should return null on error', async () => {
      // Mock implementation to throw an error
      (listMicroservices as jest.Mock).mockRejectedValueOnce(new Error('Test error'));
      
      const dictionary = await dictionaryService.getDictionaryById('user-service');
      
      expect(listMicroservices).toHaveBeenCalledTimes(1);
      expect(dictionary).toBeNull();
    });
  });

  describe('getDictionaryEntries', () => {
    it('should return entries for a dictionary', async () => {
      // Setup spy on entityService.getEntity
      const getEntitySpy = jest.spyOn(entityService, 'getEntity');
      
      const entries = await dictionaryService.getDictionaryEntries('user-service');
      
      expect(listMicroserviceEntities).toHaveBeenCalledWith('user-service');
      expect(getEntitySpy).toHaveBeenCalledTimes(2); // Once for User, once for Profile
      expect(entries.length).toBeGreaterThan(0);
      expect(entries[0].name).toBeDefined();
      expect(entries[0].type).toBe('entity');
    });

    it('should return empty array for non-existent dictionary', async () => {
      // Mock implementation to return empty array
      (listMicroserviceEntities as jest.Mock).mockResolvedValueOnce([]);
      
      const entries = await dictionaryService.getDictionaryEntries('non-existent');
      
      expect(listMicroserviceEntities).toHaveBeenCalledWith('non-existent');
      expect(entries).toHaveLength(0);
    });

    it('should return empty array on error', async () => {
      // Mock implementation to throw an error
      (listMicroserviceEntities as jest.Mock).mockRejectedValueOnce(new Error('Test error'));
      
      const entries = await dictionaryService.getDictionaryEntries('user-service');
      
      expect(listMicroserviceEntities).toHaveBeenCalledWith('user-service');
      expect(entries).toHaveLength(0);
    });
  });

  describe('getEntityAttributes', () => {
    it('should return attributes for an entity', async () => {
      const attributes = await dictionaryService.getEntityAttributes('user-service', 'User');
      
      expect(entityService.getEntity).toHaveBeenCalledWith('user-service', 'User');
      expect(attributes.length).toBeGreaterThan(0);
      expect(attributes[0].name).toBe('id');
      expect(attributes[1].name).toBe('email');
    });

    it('should return empty array for non-existent entity', async () => {
      // Mock implementation to return null
      (entityService.getEntity as jest.Mock).mockResolvedValueOnce(null);
      
      const attributes = await dictionaryService.getEntityAttributes('user-service', 'NonExistent');
      
      expect(entityService.getEntity).toHaveBeenCalledWith('user-service', 'NonExistent');
      expect(attributes).toHaveLength(0);
    });

    it('should return empty array on error', async () => {
      // Mock implementation to throw an error
      (entityService.getEntity as jest.Mock).mockRejectedValueOnce(new Error('Test error'));
      
      const attributes = await dictionaryService.getEntityAttributes('user-service', 'User');
      
      expect(entityService.getEntity).toHaveBeenCalledWith('user-service', 'User');
      expect(attributes).toHaveLength(0);
    });
  });
});