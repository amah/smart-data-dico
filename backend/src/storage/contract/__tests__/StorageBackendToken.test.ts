import type { IWorkspaceManager } from '../../git/GitFilesystemStorageBackend.js';
import { registerStorageBackend } from '../registerStorageBackend.js';
import { storageRegistry } from '../StorageBackendToken.js';
import { GitFilesystemStorageBackend } from '../../git/GitFilesystemStorageBackend.js';

/**
 * AC #12 — Wiring test.
 * Imports only registerStorageBackend (not server.ts) to avoid booting Express.
 * Uses a minimal mock IWorkspaceManager; methods are stubs (not called here).
 */
describe('registerStorageBackend wiring', () => {
  afterEach(() => {
    storageRegistry.reset();
  });

  it('AC#12 — registers a GitFilesystemStorageBackend in the storageRegistry', () => {
    // Minimal mock — only the interface shape matters; no calls are made during registration
    const mockWm: IWorkspaceManager = {
      readFile: jest.fn(),
      listFiles: jest.fn(),
      writeFile: jest.fn(),
      deleteFile: jest.fn(),
      createDirectory: jest.fn(),
      getFile: jest.fn(),
    };

    const backend = registerStorageBackend(mockWm);

    expect(backend).toBeInstanceOf(GitFilesystemStorageBackend);
    expect(storageRegistry.getBackend()).toBe(backend);
  });

  it('storageRegistry.getBackend() throws if not registered', () => {
    // reset() already called in afterEach, but also verified here explicitly
    storageRegistry.reset();
    expect(() => storageRegistry.getBackend()).toThrow('STORAGE_BACKEND not registered');
  });
});
