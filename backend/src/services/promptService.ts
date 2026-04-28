/**
 * Saved prompts service (#123)
 *
 * Stores reusable AI prompt texts as JSON files in
 * ~/.dico-app/storage/prompts/ — one file per prompt: {uuid}.json
 *
 * Distinct from conversations (which capture full message histories).
 * Mirrors conversationService.ts in style and storage approach.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { PROMPTS_DIR, ensureAppDir } from '../utils/appDir.js';

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

function promptPath(id: string): string {
  return path.join(PROMPTS_DIR, `${id}.json`);
}

function readPromptFile(file: string): SavedPrompt | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(PROMPTS_DIR, file), 'utf8')) as SavedPrompt;
  } catch {
    return null;
  }
}

export const promptService = {
  list(): SavedPrompt[] {
    ensureAppDir();
    if (!fs.existsSync(PROMPTS_DIR)) return [];

    return fs.readdirSync(PROMPTS_DIR)
      .filter(f => f.endsWith('.json'))
      .map(readPromptFile)
      .filter((p): p is SavedPrompt => p !== null)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  },

  get(id: string): SavedPrompt | null {
    try {
      const p = promptPath(id);
      if (!fs.existsSync(p)) return null;
      return JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch {
      return null;
    }
  },

  create(input: SavedPromptInput): SavedPrompt {
    ensureAppDir();
    const now = new Date().toISOString();
    const prompt: SavedPrompt = {
      id: crypto.randomUUID(),
      name: input.name?.trim() || 'Untitled prompt',
      content: input.content ?? '',
      createdAt: now,
      updatedAt: now,
    };
    fs.writeFileSync(promptPath(prompt.id), JSON.stringify(prompt, null, 2), 'utf8');
    return prompt;
  },

  update(id: string, input: Partial<SavedPromptInput>): SavedPrompt | null {
    const existing = this.get(id);
    if (!existing) return null;
    const updated: SavedPrompt = {
      ...existing,
      name: input.name?.trim() || existing.name,
      content: input.content ?? existing.content,
      updatedAt: new Date().toISOString(),
    };
    ensureAppDir();
    fs.writeFileSync(promptPath(updated.id), JSON.stringify(updated, null, 2), 'utf8');
    return updated;
  },

  delete(id: string): boolean {
    try {
      const p = promptPath(id);
      if (!fs.existsSync(p)) return false;
      fs.unlinkSync(p);
      return true;
    } catch {
      return false;
    }
  },
};
