import { InMemoryStorageBackend } from '../../storage/memory/InMemoryStorageBackend.js';
import { DictionaryService } from '../dictionaryService.js';
import { wsId } from '../../storage/contract/types.js';
import { listAllDictionaries, readEntityFile } from '../../utils/fileOperations.js';

// Mock dependencies
jest.mock('../../utils/fileOperations');
jest.mock('../../utils/logger');

const WS = wsId('dictionaries');

describe('DictionaryService', () => {
  let backend: InMemoryStorageBackend;
  let dictionaryService: DictionaryService;

  beforeEach(() => {
    jest.clearAllMocks();
    backend = new InMemoryStorageBackend();
    dictionaryService = new DictionaryService(backend, WS);
  });

  describe('getAllDictionaries', () => {
    it('should return all dictionaries', async () => {
      (listAllDictionaries as jest.Mock).mockResolvedValue(['microservices/svc-a', 'microservices/svc-b']);

      const dictionaries = await dictionaryService.getAllDictionaries();

      expect(listAllDictionaries).toHaveBeenCalledTimes(1);
      // getDictionaryById creates dictionaries from microservices/ IDs
      expect(dictionaries).toHaveLength(2);
    });

    it('should return empty array on error', async () => {
      (listAllDictionaries as jest.Mock).mockRejectedValueOnce(new Error('Test error'));

      const dictionaries = await dictionaryService.getAllDictionaries();

      expect(listAllDictionaries).toHaveBeenCalledTimes(1);
      expect(dictionaries).toHaveLength(0);
    });
  });

  describe('getEntityAttributes', () => {
    it('should return attributes for an entity', async () => {
      (readEntityFile as jest.Mock).mockResolvedValue({
        id: 'User',
        uuid: 'a38d1597-cc4f-4934-bb08-c876c023f693',
        name: 'User',
        microservice: 'user-service',
        version: '1.0.0',
        attributes: [
          { uuid: 'b49e2608-dd5f-4045-aa09-d464c234e694', name: 'id', type: 'string', description: 'ID', required: true },
          { uuid: 'c5af3719-ee6f-4156-bb1a-e575d345f7a5', name: 'email', type: 'string', description: 'Email', required: true },
        ],
      });

      const attributes = await dictionaryService.getEntityAttributes('user-service', 'User');

      expect(readEntityFile).toHaveBeenCalledWith('user-service', 'User');
      expect(attributes).toHaveLength(2);
      expect(attributes[0].name).toBe('id');
      expect(attributes[1].name).toBe('email');
    });

    it('should return empty array for non-existent entity', async () => {
      (readEntityFile as jest.Mock).mockResolvedValue(null);

      const attributes = await dictionaryService.getEntityAttributes('user-service', 'NonExistent');

      expect(readEntityFile).toHaveBeenCalledWith('user-service', 'NonExistent');
      expect(attributes).toHaveLength(0);
    });

    it('should return empty array on error', async () => {
      (readEntityFile as jest.Mock).mockRejectedValueOnce(new Error('Test error'));

      const attributes = await dictionaryService.getEntityAttributes('user-service', 'User');

      expect(readEntityFile).toHaveBeenCalledWith('user-service', 'User');
      expect(attributes).toHaveLength(0);
    });
  });
});
