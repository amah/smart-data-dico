import fs from 'fs';
import os from 'os';
import path from 'path';
import { GitFilesystemStorageBackend, type IWorkspaceManager } from '../GitFilesystemStorageBackend.js';
import { GIT_FILESYSTEM_CAPABILITIES } from '../../contract/BackendCapabilities.js';
import { BackendError, NotFoundError } from '../../contract/errors.js';
import { wsId, pathOf } from '../../contract/types.js';

describe('GitFilesystemStorageBackend', () => {
  let tmpDir: string;
  let backend: GitFilesystemStorageBackend;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-storage-'));
    // Dynamic import avoids NodeNext tsc resolution failure for transitive @hamak packages
    // while still resolving correctly in the Jest CJS (moduleResolution:node) context.
    const { WorkspaceManager } = await import('@hamak/filesystem-server-impl' as string) as { WorkspaceManager: new (w: Record<string, string>, o: { baseDirectory: string }) => IWorkspaceManager };
    const wm = new WorkspaceManager({ dictionaries: '.' }, { baseDirectory: tmpDir });
    backend = new GitFilesystemStorageBackend(wm, { workspaceId: 'dictionaries' });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // AC #2: Contract surface is complete
  it('AC#2 — has all 12 contract methods', () => {
    const methods = [
      'read', 'list', 'stat', 'write', 'delete', 'mkdir',
      'subscribe', 'createWorkspace', 'forkWorkspace', 'mergeWorkspace',
      'deleteWorkspace', 'capabilities',
    ];
    for (const m of methods) {
      expect(typeof (backend as any)[m]).toBe('function');
    }
  });

  // AC #3: capabilities() returns the git+filesystem const
  it('AC#3 — capabilities() returns GIT_FILESYSTEM_CAPABILITIES reference', () => {
    expect(backend.capabilities()).toBe(GIT_FILESYSTEM_CAPABILITIES);
    expect(backend.capabilities().versionControl).toBe(true);
    expect(backend.capabilities().multiUser).toBe('single-user');
  });

  // AC #4: Round-trip write/read
  it('AC#4 — round-trip write + read', async () => {
    await backend.write(wsId('dictionaries'), pathOf('foo/bar.txt'), 'hello', { createParents: true });
    const content = await backend.read(wsId('dictionaries'), pathOf('foo/bar.txt'));
    expect(content).toBe('hello');
  });

  // AC #5: list returns the written entry
  it('AC#5 — list returns the written entry', async () => {
    await backend.write(wsId('dictionaries'), pathOf('foo/bar.txt'), 'hello', { createParents: true });
    const entries = await backend.list(wsId('dictionaries'), pathOf('foo'));
    expect(entries.map((e) => e.name)).toContain('bar.txt');
  });

  // AC #6: stat returns a deterministic etag; write changes it
  it('AC#6 — stat etag is stable across reads; changes after write', async () => {
    await backend.write(wsId('dictionaries'), pathOf('etag-test.txt'), 'v1', { createParents: true });
    const stat1 = await backend.stat(wsId('dictionaries'), pathOf('etag-test.txt'));
    const stat2 = await backend.stat(wsId('dictionaries'), pathOf('etag-test.txt'));
    expect(stat1.etag).toBe(stat2.etag);

    // Write different content and check etag changes
    // Use a small delay to ensure mtime changes (filesystem resolution is ~1ms)
    await new Promise((r) => setTimeout(r, 10));
    await backend.write(wsId('dictionaries'), pathOf('etag-test.txt'), 'v2');
    const stat3 = await backend.stat(wsId('dictionaries'), pathOf('etag-test.txt'));
    expect(stat3.etag).not.toBe(stat1.etag);
  });

  // AC #7: delete removes the file; subsequent read throws NotFoundError
  it('AC#7 — delete removes file and read throws NotFoundError', async () => {
    await backend.write(wsId('dictionaries'), pathOf('foo/bar.txt'), 'hello', { createParents: true });
    await backend.delete(wsId('dictionaries'), pathOf('foo/bar.txt'));
    await expect(backend.read(wsId('dictionaries'), pathOf('foo/bar.txt'))).rejects.toThrow(NotFoundError);
  });

  // AC #8: NotFoundError thrown for missing file (not raw ENOENT)
  it('AC#8 — read of missing file throws NotFoundError', async () => {
    await expect(
      backend.read(wsId('dictionaries'), pathOf('missing.txt')),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  // AC #9: mkdir creates a directory visible in list
  it('AC#9 — mkdir creates directory visible in list', async () => {
    await backend.mkdir(wsId('dictionaries'), pathOf('newdir'));
    const entries = await backend.list(wsId('dictionaries'), pathOf(''));
    expect(entries.find((e) => e.name === 'newdir')?.isDirectory).toBe(true);
  });

  // AC #10: lifecycle methods throw BackendError with code 'not-implemented'
  it('AC#10 — lifecycle methods throw BackendError not-implemented', async () => {
    const notImplMethods: Array<() => Promise<unknown>> = [
      () => backend.createWorkspace(wsId('x')),
      () => backend.forkWorkspace(wsId('x'), wsId('y')),
      () => backend.mergeWorkspace(wsId('x'), wsId('y')),
      () => backend.deleteWorkspace(wsId('x')),
    ];
    for (const fn of notImplMethods) {
      await expect(fn()).rejects.toBeInstanceOf(BackendError);
      await expect(fn()).rejects.toMatchObject({ code: 'not-implemented' });
    }
  });

  // AC #11: subscribe throws synchronously (not on .subscribe() of observable)
  it('AC#11 — subscribe throws synchronously', () => {
    expect(() => backend.subscribe(wsId('dictionaries'), pathOf(''))).toThrow(BackendError);
  });

  // Additional: subscribe error code is 'not-implemented'
  it('subscribe throws BackendError with code not-implemented', () => {
    try {
      backend.subscribe(wsId('dictionaries'), pathOf(''));
      fail('Expected to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(BackendError);
      expect((err as BackendError).code).toBe('not-implemented');
    }
  });

  // Additional: ConflictError on ifMatch mismatch
  it('write with ifMatch mismatch throws ConflictError', async () => {
    await backend.write(wsId('dictionaries'), pathOf('conflict.txt'), 'initial', { createParents: true });
    const { ConflictError: CE } = await import('../../contract/errors.js');
    await expect(
      backend.write(wsId('dictionaries'), pathOf('conflict.txt'), 'updated', { ifMatch: 'wrong-etag' }),
    ).rejects.toBeInstanceOf(CE);
  });

  // Additional: stat on a directory works
  it('stat on a directory returns isDirectory=true', async () => {
    await backend.mkdir(wsId('dictionaries'), pathOf('statdir'));
    const s = await backend.stat(wsId('dictionaries'), pathOf('statdir'));
    expect(s.isDirectory).toBe(true);
  });
});
