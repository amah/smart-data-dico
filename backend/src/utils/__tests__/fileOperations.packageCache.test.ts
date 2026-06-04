import { InMemoryStorageBackend } from '../../storage/memory/InMemoryStorageBackend.js';
import { storageRegistry } from '../../storage/contract/StorageBackendToken.js';
import YAML from 'yaml';
import { loadPackage, invalidatePackageCache, writeEntityFile } from '../fileOperations.js';
import type { Entity } from '../../models/EntitySchema.js';

// Verifies the loadPackage cache + its invalidation paths (perf fix for the
// O(n²) per-entity readEntityFile loops). The cache must:
//   - dedupe repeated loads of the same package,
//   - clear on in-process writes (writeSectionsToStorage),
//   - clear when the storage backend is swapped (storageRegistry),
//   - clear on explicit invalidatePackageCache (used by the watcher rebuild).

const ent = (uuid: string, name: string): Entity =>
  ({ uuid, name, description: name, attributes: [] } as Entity);

function seedPkg(backend: InMemoryStorageBackend, files: Record<string, string>): void {
  const m = new Map<string, string>([['pkg/package.yaml', YAML.stringify({ name: 'pkg' })]]);
  for (const [f, c] of Object.entries(files)) m.set(`pkg/${f}`, c);
  backend.files.set('dictionaries', m);
}

describe('loadPackage cache', () => {
  let backend: InMemoryStorageBackend;

  beforeEach(() => {
    storageRegistry.reset();
    backend = new InMemoryStorageBackend();
    storageRegistry.setBackend(backend);
  });

  it('caches across calls and does not observe out-of-band disk writes until invalidated', async () => {
    seedPkg(backend, { 'A.model.yaml': YAML.stringify({ entities: [ent('a1b2c3d4-e5f6-4a7b-89ab-000000000001', 'A')] }) });

    expect((await loadPackage('pkg')).entities.map(e => e.name)).toEqual(['A']);

    // Write a second entity DIRECTLY to the backend, bypassing the write path.
    backend.files.get('dictionaries')!.set(
      'pkg/B.model.yaml',
      YAML.stringify({ entities: [ent('a1b2c3d4-e5f6-4a7b-89ab-000000000002', 'B')] }),
    );

    // Still served from cache → only A.
    expect((await loadPackage('pkg')).entities.map(e => e.name)).toEqual(['A']);

    // Explicit invalidation → fresh read sees both.
    invalidatePackageCache('pkg');
    expect((await loadPackage('pkg')).entities.map(e => e.name).sort()).toEqual(['A', 'B']);
  });

  it('invalidates on an in-process write (writeEntityFile)', async () => {
    seedPkg(backend, { 'A.model.yaml': YAML.stringify({ entities: [ent('a1b2c3d4-e5f6-4a7b-89ab-000000000001', 'A')] }) });
    expect((await loadPackage('pkg')).entities).toHaveLength(1);

    await writeEntityFile(ent('a1b2c3d4-e5f6-4a7b-89ab-000000000003', 'C'), 'pkg');

    expect((await loadPackage('pkg')).entities.map(e => e.name).sort()).toEqual(['A', 'C']);
  });

  it('clears when the storage backend is swapped', async () => {
    seedPkg(backend, { 'A.model.yaml': YAML.stringify({ entities: [ent('a1b2c3d4-e5f6-4a7b-89ab-000000000001', 'A')] }) });
    expect((await loadPackage('pkg')).entities).toHaveLength(1);

    // A fresh, empty backend — the cached model must not leak across it.
    const fresh = new InMemoryStorageBackend();
    storageRegistry.setBackend(fresh);

    expect((await loadPackage('pkg')).entities).toHaveLength(0);
  });
});
