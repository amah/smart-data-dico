/**
 * Tests for the saved-prompts service (#123).
 *
 * Uses InMemoryStorageBackend injected via constructor — no disk I/O,
 * no jest.mock, no mkdtempSync. Pattern mirrors diagramService.test.ts.
 */

import { PromptService } from '../promptService.js';
import { InMemoryStorageBackend } from '../../__tests__/helpers/InMemoryStorageBackend.js';
import { wsId, pathOf } from '../../storage/contract/types.js';

jest.mock('../../utils/logger');

const WS = wsId('app');

describe('promptService', () => {
  let backend: InMemoryStorageBackend;
  let svc: PromptService;

  beforeEach(() => {
    backend = new InMemoryStorageBackend();
    svc = new PromptService(backend, WS, pathOf('prompts'));
  });

  it('list() returns [] when storage dir is empty', async () => {
    expect(await svc.list()).toEqual([]);
  });

  it('create() persists a prompt with id, timestamps, and trimmed name', async () => {
    const created = await svc.create({ name: '  Summarize entity  ', content: 'Summarize: {{entity}}' });
    expect(created.id).toMatch(/[0-9a-f-]{36}/);
    expect(created.name).toBe('Summarize entity');
    expect(created.content).toBe('Summarize: {{entity}}');
    expect(created.createdAt).toBe(created.updatedAt);
    // Verify it was actually written to the backend
    const raw = await backend.read(WS, pathOf(`prompts/${created.id}.json`));
    expect(JSON.parse(raw).id).toBe(created.id);
  });

  it('create() defaults blank name to "Untitled prompt"', async () => {
    const created = await svc.create({ name: '   ', content: 'hi' });
    expect(created.name).toBe('Untitled prompt');
  });

  it('get() returns a previously created prompt', async () => {
    const created = await svc.create({ name: 'A', content: 'one' });
    const fetched = await svc.get(created.id);
    expect(fetched).toEqual(created);
  });

  it('get() returns null for an unknown id', async () => {
    expect(await svc.get('does-not-exist')).toBeNull();
  });

  it('list() returns prompts sorted by updatedAt descending', async () => {
    const a = await svc.create({ name: 'A', content: 'a' });
    await new Promise((r) => setTimeout(r, 5));
    const b = await svc.create({ name: 'B', content: 'b' });
    await new Promise((r) => setTimeout(r, 5));
    const updatedB = await svc.update(b.id, { content: 'b2' });
    const list = await svc.list();
    expect(list.map((p) => p.id)).toEqual([updatedB!.id, a.id]);
  });

  it('update() changes name and content and bumps updatedAt', async () => {
    const created = await svc.create({ name: 'Old', content: 'before' });
    // Wait 1ms to ensure timestamps differ
    await new Promise((r) => setTimeout(r, 5));
    const updated = await svc.update(created.id, { name: 'New', content: 'after' });
    expect(updated).not.toBeNull();
    expect(updated!.name).toBe('New');
    expect(updated!.content).toBe('after');
    expect(updated!.createdAt).toBe(created.createdAt);
    expect(updated!.updatedAt > created.updatedAt).toBe(true);
  });

  it('update() returns null for unknown id', async () => {
    expect(await svc.update('nope', { name: 'X' })).toBeNull();
  });

  it('update() preserves existing fields when omitted', async () => {
    const created = await svc.create({ name: 'Keep', content: 'body' });
    const updated = await svc.update(created.id, { name: 'Renamed' });
    expect(updated!.name).toBe('Renamed');
    expect(updated!.content).toBe('body');
  });

  it('delete() removes the prompt and returns true', async () => {
    const created = await svc.create({ name: 'A', content: 'a' });
    expect(await svc.delete(created.id)).toBe(true);
    expect(await svc.get(created.id)).toBeNull();
  });

  it('delete() returns false for unknown id', async () => {
    expect(await svc.delete('nope')).toBe(false);
  });

  it('list() ignores corrupt JSON files', async () => {
    await svc.create({ name: 'Good', content: 'ok' });
    // Seed a corrupt JSON file directly into the backend
    await backend.write(WS, pathOf('prompts/broken.json'), '{not-json');
    const list = await svc.list();
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('Good');
  });
});
