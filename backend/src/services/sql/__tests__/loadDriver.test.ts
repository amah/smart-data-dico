/**
 * loadDriver — lazy optional-driver loading with fallback resolution bases.
 *
 * When the app runs from the npx cache, a bare `import('oracledb')` cannot see
 * the user's launch directory or the global npm root (ESM ignores NODE_PATH).
 * loadDriver therefore retries resolution from fallback bases. Contract:
 *  - a bare-resolvable package loads without touching the bases
 *  - a package present under a fallback base's node_modules loads from there,
 *    in base order, including subpath specifiers ('mysql2/promise' style)
 *  - a package found under a base whose LOAD then fails (broken install /
 *    native ABI mismatch) propagates the real error — not "isn't installed"
 *  - nothing anywhere → actionable error naming the npm install options
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { loadDriver } from '../executors.js';

/** Create <root>/node_modules/<name> as a tiny CJS package. */
function fakePkg(root: string, name: string, indexJs: string, extraFiles?: Record<string, string>) {
  const dir = path.join(root, 'node_modules', name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name, version: '1.0.0', main: 'index.js' }));
  fs.writeFileSync(path.join(dir, 'index.js'), indexJs);
  for (const [rel, content] of Object.entries(extraFiles ?? {})) {
    fs.writeFileSync(path.join(dir, rel), content);
  }
}

describe('loadDriver', () => {
  let baseA: string;
  let baseB: string;

  beforeEach(() => {
    baseA = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-driver-a-'));
    baseB = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-driver-b-'));
  });

  afterEach(() => {
    fs.rmSync(baseA, { recursive: true, force: true });
    fs.rmSync(baseB, { recursive: true, force: true });
  });

  it('loads a bare-resolvable package without needing any fallback base', async () => {
    const mod = await loadDriver('zod', []); // a real dependency of the backend
    expect(mod.z ?? mod.default ?? mod).toBeTruthy();
  });

  it('falls back to a base directory when the bare import misses', async () => {
    fakePkg(baseA, 'sdd-fake-driver', 'module.exports = { marker: "from-A" };');
    const mod: any = await loadDriver('sdd-fake-driver', [baseA]);
    expect((mod.default ?? mod).marker).toBe('from-A');
  });

  it('tries bases in order — the first base that resolves wins', async () => {
    fakePkg(baseA, 'sdd-ordered-driver', 'module.exports = { marker: "A" };');
    fakePkg(baseB, 'sdd-ordered-driver', 'module.exports = { marker: "B" };');
    const mod: any = await loadDriver('sdd-ordered-driver', [baseA, baseB]);
    expect((mod.default ?? mod).marker).toBe('A');
  });

  it('skips a base that lacks the package and resolves from a later one', async () => {
    fakePkg(baseB, 'sdd-later-driver', 'module.exports = { marker: "B" };');
    const mod: any = await loadDriver('sdd-later-driver', [baseA, baseB]);
    expect((mod.default ?? mod).marker).toBe('B');
  });

  it('resolves subpath specifiers like mysql2/promise from a fallback base', async () => {
    fakePkg(baseA, 'sdd-subpath-driver', 'module.exports = { root: true };', {
      'promise.js': 'module.exports = { marker: "subpath" };',
    });
    const mod: any = await loadDriver('sdd-subpath-driver/promise.js', [baseA]);
    expect((mod.default ?? mod).marker).toBe('subpath');
  });

  it('propagates a REAL load failure from a resolved package instead of claiming "not installed"', async () => {
    fakePkg(baseA, 'sdd-broken-driver', 'throw new Error("ABI mismatch: was compiled against a different Node.js version");');
    await expect(loadDriver('sdd-broken-driver', [baseA]))
      .rejects.toThrow(/ABI mismatch/);
  });

  it('nothing found anywhere → actionable error naming both install options', async () => {
    await expect(loadDriver('sdd-absent-driver', [baseA, baseB]))
      .rejects.toThrow(/isn't installed.*npm install sdd-absent-driver.*npm install -g sdd-absent-driver/s);
  });

  it('strips the subpath when naming the missing package in the error', async () => {
    await expect(loadDriver('sdd-absent-driver/promise', [baseA]))
      .rejects.toThrow(/npm install sdd-absent-driver(?!\/)/);
  });
});
