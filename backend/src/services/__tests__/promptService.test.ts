/**
 * Tests for the saved-prompts service (#123).
 *
 * Uses a temporary PROMPTS_DIR so we never touch the real ~/.dico-app/.
 * The directory is created fresh before each test and cleaned up after.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

// Override PROMPTS_DIR before importing the service so the module
// resolves the test path.
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dico-prompts-'));
const tmpPromptsDir = path.join(tmpRoot, 'prompts');

jest.mock('../../utils/appDir', () => ({
  PROMPTS_DIR: tmpPromptsDir,
  ensureAppDir: () => {
    if (!fs.existsSync(tmpPromptsDir)) {
      fs.mkdirSync(tmpPromptsDir, { recursive: true });
    }
  },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { promptService } = require('../promptService');

afterEach(() => {
  if (fs.existsSync(tmpPromptsDir)) {
    for (const f of fs.readdirSync(tmpPromptsDir)) {
      fs.unlinkSync(path.join(tmpPromptsDir, f));
    }
  }
});

afterAll(() => {
  if (fs.existsSync(tmpRoot)) {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

describe('promptService', () => {
  it('list() returns [] when storage dir is empty', () => {
    expect(promptService.list()).toEqual([]);
  });

  it('create() persists a prompt with id, timestamps, and trimmed name', () => {
    const created = promptService.create({ name: '  Summarize entity  ', content: 'Summarize: {{entity}}' });
    expect(created.id).toMatch(/[0-9a-f-]{36}/);
    expect(created.name).toBe('Summarize entity');
    expect(created.content).toBe('Summarize: {{entity}}');
    expect(created.createdAt).toBe(created.updatedAt);
    expect(fs.existsSync(path.join(tmpPromptsDir, `${created.id}.json`))).toBe(true);
  });

  it('create() defaults blank name to "Untitled prompt"', () => {
    const created = promptService.create({ name: '   ', content: 'hi' });
    expect(created.name).toBe('Untitled prompt');
  });

  it('get() returns a previously created prompt', () => {
    const created = promptService.create({ name: 'A', content: 'one' });
    const fetched = promptService.get(created.id);
    expect(fetched).toEqual(created);
  });

  it('get() returns null for an unknown id', () => {
    expect(promptService.get('does-not-exist')).toBeNull();
  });

  it('list() returns prompts sorted by updatedAt descending', () => {
    const a = promptService.create({ name: 'A', content: 'a' });
    // Force a deterministic later timestamp for b
    const b = promptService.create({ name: 'B', content: 'b' });
    const updatedB = promptService.update(b.id, { content: 'b2' })!;
    const list = promptService.list();
    expect(list.map((p: { id: string }) => p.id)).toEqual([updatedB.id, a.id]);
  });

  it('update() changes name and content and bumps updatedAt', async () => {
    const created = promptService.create({ name: 'Old', content: 'before' });
    // Wait 1ms to ensure timestamps differ
    await new Promise(r => setTimeout(r, 5));
    const updated = promptService.update(created.id, { name: 'New', content: 'after' });
    expect(updated).not.toBeNull();
    expect(updated!.name).toBe('New');
    expect(updated!.content).toBe('after');
    expect(updated!.createdAt).toBe(created.createdAt);
    expect(updated!.updatedAt > created.updatedAt).toBe(true);
  });

  it('update() returns null for unknown id', () => {
    expect(promptService.update('nope', { name: 'X' })).toBeNull();
  });

  it('update() preserves existing fields when omitted', () => {
    const created = promptService.create({ name: 'Keep', content: 'body' });
    const updated = promptService.update(created.id, { name: 'Renamed' });
    expect(updated!.name).toBe('Renamed');
    expect(updated!.content).toBe('body');
  });

  it('delete() removes the prompt file and returns true', () => {
    const created = promptService.create({ name: 'A', content: 'a' });
    expect(promptService.delete(created.id)).toBe(true);
    expect(promptService.get(created.id)).toBeNull();
  });

  it('delete() returns false for unknown id', () => {
    expect(promptService.delete('nope')).toBe(false);
  });

  it('list() ignores corrupt JSON files', () => {
    promptService.create({ name: 'Good', content: 'ok' });
    fs.writeFileSync(path.join(tmpPromptsDir, 'broken.json'), '{not-json', 'utf8');
    const list = promptService.list();
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('Good');
  });
});
