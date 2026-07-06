/**
 * Content-addressed store for AI system prompts (#ai-export system context).
 *
 * The effective standing system prompt (canonical body + mode suffix + AUTHORING_RULES
 * + SQL settings) is large and IDENTICAL across every conversation that shares the same
 * mode/config, so storing it on each conversation would duplicate kilobytes many times
 * over. Instead we hash the prompt and store the body ONCE under its digest; each
 * conversation keeps only the short digest (`systemContextDigest`). Exports/audits
 * resolve the digest back to the full text.
 *
 * Same workspace + IStorageBackend as conversationService, so it lives beside the
 * conversations under `<storage>/system-prompts/<digest>.txt`.
 */
import { createHash } from 'crypto';
import { storageRegistry } from '../storage/contract/StorageBackendToken.js';
import type { IStorageBackend } from '../storage/contract/IStorageBackend.js';
import { wsId, pathOf, type WorkspaceId, type Path } from '../storage/contract/types.js';

/** 16 hex chars of SHA-256 — ample to avoid collisions for a handful of prompts. */
export function systemPromptDigest(body: string): string {
  return createHash('sha256').update(body, 'utf8').digest('hex').slice(0, 16);
}

export class SystemPromptStore {
  private _storage?: IStorageBackend;
  private get storage(): IStorageBackend {
    if (!this._storage) this._storage = storageRegistry.getBackend();
    return this._storage;
  }

  constructor(
    storage?: IStorageBackend,
    private readonly ws: WorkspaceId = wsId('app'),
    private readonly dir: Path = pathOf('system-prompts'),
  ) {
    this._storage = storage;
  }

  private path(digest: string): Path {
    return pathOf(`${this.dir}/${digest}.txt`);
  }

  /** Store the prompt body if not already present; return its digest. Dedupes. */
  async put(body: string): Promise<string> {
    const digest = systemPromptDigest(body);
    const path = this.path(digest);
    try {
      await this.storage.read(this.ws, path); // already stored → skip write
    } catch {
      // createParents: the `system-prompts/` dir may not exist yet.
      await this.storage.write(this.ws, path, body, { createParents: true });
    }
    return digest;
  }

  /** Resolve a digest back to the prompt body, or null when unknown. */
  async get(digest: string): Promise<string | null> {
    if (!/^[0-9a-f]{6,64}$/.test(digest)) return null;
    try {
      return await this.storage.read(this.ws, this.path(digest));
    } catch {
      return null;
    }
  }
}

export const systemPromptStore = new SystemPromptStore();
