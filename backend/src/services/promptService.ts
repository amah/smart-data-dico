/**
 * Saved prompts service (#123)
 *
 * Stores reusable AI prompt texts as JSON files in
 * ~/.dico-app/storage/prompts/ — one file per prompt: {uuid}.json
 *
 * Distinct from conversations (which capture full message histories).
 * Mirrors conversationService.ts in style and storage approach.
 *
 * Migrated to IStorageBackend in slice-2b (#167).
 */

import * as crypto from 'crypto';
import { storageRegistry } from '../storage/contract/StorageBackendToken.js';
import type { IStorageBackend } from '../storage/contract/IStorageBackend.js';
import { wsId, pathOf, type WorkspaceId, type Path } from '../storage/contract/types.js';

export interface SavedPrompt {
  id: string;
  name: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export interface SavedPromptInput {
  name: string;
  content: string;
}

export class PromptService {
  private _storage?: IStorageBackend;
  private get storage(): IStorageBackend {
    if (!this._storage) this._storage = storageRegistry.getBackend();
    return this._storage;
  }

  constructor(
    storage?: IStorageBackend,
    private readonly ws: WorkspaceId = wsId('app'),
    private readonly promptsDir: Path = pathOf('prompts'),
  ) {
    this._storage = storage;
  }

  async list(): Promise<SavedPrompt[]> {
    let entries;
    try {
      entries = await this.storage.list(this.ws, this.promptsDir);
    } catch (e) {
      if ((e as { code?: string }).code === 'not-found') return [];
      throw e;
    }

    const prompts: SavedPrompt[] = [];
    for (const entry of entries) {
      if (entry.isDirectory || !entry.name.endsWith('.json')) continue;
      try {
        const raw = await this.storage.read(this.ws, pathOf(`${this.promptsDir}/${entry.name}`));
        const parsed = JSON.parse(raw) as SavedPrompt;
        prompts.push(parsed);
      } catch {
        // skip corrupt JSON files
      }
    }

    return prompts.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async get(id: string): Promise<SavedPrompt | null> {
    try {
      const raw = await this.storage.read(this.ws, pathOf(`${this.promptsDir}/${id}.json`));
      return JSON.parse(raw) as SavedPrompt;
    } catch (e) {
      if ((e as { code?: string }).code === 'not-found') return null;
      throw e;
    }
  }

  async create(input: SavedPromptInput): Promise<SavedPrompt> {
    const now = new Date().toISOString();
    const prompt: SavedPrompt = {
      id: crypto.randomUUID(),
      name: input.name?.trim() || 'Untitled prompt',
      content: input.content ?? '',
      createdAt: now,
      updatedAt: now,
    };
    await this.storage.write(
      this.ws,
      pathOf(`${this.promptsDir}/${prompt.id}.json`),
      JSON.stringify(prompt, null, 2),
      { createParents: true },
    );
    return prompt;
  }

  async update(id: string, input: Partial<SavedPromptInput>): Promise<SavedPrompt | null> {
    const existing = await this.get(id);
    if (!existing) return null;
    const updated: SavedPrompt = {
      ...existing,
      name: input.name?.trim() || existing.name,
      content: input.content ?? existing.content,
      updatedAt: new Date().toISOString(),
    };
    await this.storage.write(
      this.ws,
      pathOf(`${this.promptsDir}/${updated.id}.json`),
      JSON.stringify(updated, null, 2),
      { createParents: true },
    );
    return updated;
  }

  async delete(id: string): Promise<boolean> {
    try {
      await this.storage.delete(this.ws, pathOf(`${this.promptsDir}/${id}.json`));
      return true;
    } catch (e) {
      if ((e as { code?: string }).code === 'not-found') return false;
      throw e;
    }
  }
}

export const promptService = new PromptService();
