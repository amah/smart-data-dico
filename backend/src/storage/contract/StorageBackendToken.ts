import type { IStorageBackend } from './IStorageBackend.js';
import type { IDictionaryQuery } from './IDictionaryQuery.js';

export const STORAGE_BACKEND_TOKEN: unique symbol = Symbol('STORAGE_BACKEND');
export const DICTIONARY_QUERY_TOKEN: unique symbol = Symbol('DICTIONARY_QUERY');

// Backend has no DI container (ADR-0001). Use a module-scoped singleton.
class StorageRegistry {
  private backend?: IStorageBackend;
  private query?: IDictionaryQuery;

  setBackend(b: IStorageBackend): void { this.backend = b; }
  getBackend(): IStorageBackend {
    if (!this.backend) throw new Error('STORAGE_BACKEND not registered. server.ts must call storageRegistry.setBackend() at startup.');
    return this.backend;
  }
  setQuery(q: IDictionaryQuery): void { this.query = q; }
  getQuery(): IDictionaryQuery | undefined { return this.query; }

  /** Test helper. */
  reset(): void { this.backend = undefined; this.query = undefined; }
}

export const storageRegistry = new StorageRegistry();
