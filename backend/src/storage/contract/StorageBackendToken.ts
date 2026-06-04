import type { IStorageBackend } from './IStorageBackend.js';
import type { IDictionaryQuery } from './IDictionaryQuery.js';

export const STORAGE_BACKEND_TOKEN: unique symbol = Symbol('STORAGE_BACKEND');
export const DICTIONARY_QUERY_TOKEN: unique symbol = Symbol('DICTIONARY_QUERY');

// Backend has no DI container (ADR-0001). Use a module-scoped singleton.
class StorageRegistry {
  private backend?: IStorageBackend;
  private query?: IDictionaryQuery;
  private changeListeners: Array<() => void> = [];

  /**
   * Subscribe to backend swaps/resets. Caches keyed on backend contents
   * (e.g. the loadPackage cache) register here so they clear when the
   * backend changes — chiefly so tests that install a fresh in-memory
   * backend per case don't read stale cached data.
   */
  onBackendChange(fn: () => void): void { this.changeListeners.push(fn); }
  private notifyChange(): void { for (const fn of this.changeListeners) fn(); }

  setBackend(b: IStorageBackend): void { this.backend = b; this.notifyChange(); }
  getBackend(): IStorageBackend {
    if (!this.backend) throw new Error('STORAGE_BACKEND not registered. server.ts must call storageRegistry.setBackend() at startup.');
    return this.backend;
  }
  setQuery(q: IDictionaryQuery): void { this.query = q; }
  getQuery(): IDictionaryQuery | undefined { return this.query; }

  /** Test helper. */
  reset(): void { this.backend = undefined; this.query = undefined; this.notifyChange(); }
}

export const storageRegistry = new StorageRegistry();
