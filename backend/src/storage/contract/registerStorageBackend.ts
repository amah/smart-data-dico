import { GitFilesystemStorageBackend, type IWorkspaceManager } from '../git/GitFilesystemStorageBackend.js';
import { InMemoryStorageBackend } from '../memory/InMemoryStorageBackend.js';
import { storageRegistry } from './StorageBackendToken.js';
import { wsId, type WorkspaceId } from './types.js';
import type { IStorageBackend } from './IStorageBackend.js';
import { logger } from '../../utils/logger.js';
import { config } from '../../kernel/config.js';
import * as fs from 'fs';
import * as path from 'path';

export type BackendKind = 'git' | 'memory';

/**
 * Returns the backend kind selected by the STORAGE_BACKEND env-var.
 * Defaults to 'git' when unset or empty. Throws for unrecognised values.
 */
export function selectedBackendKind(): BackendKind {
  const raw = (process.env.STORAGE_BACKEND ?? 'git').toLowerCase();
  if (raw === 'memory') return 'memory';
  if (raw === 'git' || raw === '') return 'git';
  throw new Error(
    `Invalid STORAGE_BACKEND=${process.env.STORAGE_BACKEND}. Expected 'git' or 'memory'.`,
  );
}

/**
 * Instantiates and registers the storage backend selected by STORAGE_BACKEND.
 *
 * - 'git' (default): GitFilesystemStorageBackend wrapping the given workspaceManager.
 * - 'memory': InMemoryStorageBackend seeded from config.dataDir (one-shot, synchronous).
 *   The passed workspaceManager is still constructed by the caller because
 *   `getFileRouter()` and the git plugin both consume it for /fs and /api/git routes
 *   — those routes are independent of IStorageBackend.
 *
 * Extracted into its own module so tests can import this function directly
 * without triggering Express app construction (which happens at the top of
 * server.ts via module-level side effects).
 */
export function registerStorageBackend(workspaceManager: IWorkspaceManager): IStorageBackend {
  const kind = selectedBackendKind();
  if (kind === 'memory') {
    const backend = new InMemoryStorageBackend();
    seedFromDisk(backend, config.dataDir, wsId('dictionaries'));
    storageRegistry.setBackend(backend);
    logger.info('Storage backend: memory (seeded from disk)', { dataDir: config.dataDir });
    return backend;
  }
  const backend = new GitFilesystemStorageBackend(workspaceManager);
  storageRegistry.setBackend(backend);
  logger.info('Storage backend: git');
  return backend;
}

/**
 * Synchronous one-shot bootstrap: walks `root` recursively, writing every
 * file into the in-memory backend's `files` Map directly (NOT via `write()`)
 * so that seed-time writes do NOT fire subscribe() change-events.
 *
 * Skips `node_modules/` and `.git/` defensively — a future user pointing
 * DATA_DIR at a working tree shouldn't OOM the process.
 *
 * The 'app' workspace (used by promptService / conversationService) is left
 * empty — they create files on first write, matching the slice-2b design
 * where 'app' points at ~/.dico-app/storage/ (empty by default).
 */
function seedFromDisk(backend: InMemoryStorageBackend, root: string, ws: WorkspaceId): void {
  const walk = (dir: string, rel: string): void => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '.git') continue;
        walk(abs, relPath);
      } else if (entry.isFile()) {
        const content = fs.readFileSync(abs, 'utf8');
        // Direct map insertion bypasses async write() — avoids firing seed-time
        // 'change' events on the EventEmitter.
        const wsKey = String(ws);
        const bucket = backend.files.get(wsKey);
        if (bucket) {
          bucket.set(relPath, content);
        } else {
          backend.files.set(wsKey, new Map([[relPath, content]]));
        }
      }
    }
  };
  if (!fs.existsSync(root)) {
    logger.warn(`Memory backend seed: dataDir ${root} does not exist — workspace left empty.`);
    return;
  }
  walk(root, '');
  logger.info(`Memory backend seeded ${backend.files.get(String(ws))?.size ?? 0} files from ${root}`);
}
