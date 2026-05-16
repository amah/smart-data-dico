import { GitFilesystemStorageBackend, type IWorkspaceManager } from '../git/GitFilesystemStorageBackend.js';
import { storageRegistry } from './StorageBackendToken.js';

/**
 * Instantiates GitFilesystemStorageBackend for the given workspaceManager and
 * registers it in the storageRegistry singleton.
 *
 * Extracted into its own module so tests can import this function directly
 * without triggering Express app construction (which happens at the top of
 * server.ts via module-level side effects).
 */
export function registerStorageBackend(workspaceManager: IWorkspaceManager): GitFilesystemStorageBackend {
  const backend = new GitFilesystemStorageBackend(workspaceManager);
  storageRegistry.setBackend(backend);
  return backend;
}
