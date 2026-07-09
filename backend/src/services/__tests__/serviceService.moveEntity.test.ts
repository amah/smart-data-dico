/**
 * serviceService.moveEntity.test.ts — #move-entity
 *
 * Proves ServiceService.moveEntity relocates an entity between packages through
 * the registered LogicalProjection: the entity leaves the source, appears in the
 * target with its UUID intact (so the UuidIndex re-points, and UUID references
 * survive), and — unlike deleteEntity — a same-package relationship referencing
 * the entity does NOT block the move (relocation ≠ destruction).
 *
 * Fixture strategy mirrors serviceService.deleteEntity.test.ts (blank-service
 * fixture), extended to two packages.
 */

import { AttributeType, Cardinality, type Entity } from '../../models/EntitySchema.js';
import { InMemoryStorageBackend } from '../../storage/memory/InMemoryStorageBackend.js';
import { wsId } from '../../storage/contract/types.js';
import { LogicalProjection } from '../../storage/projection/LogicalProjection.js';
import { registerProjection, resetProjectionRegistry } from '../../storage/projection/ProjectionRegistry.js';
import { UuidIndex, resetUuidIndexRegistry } from '../../storage/projection/UuidIndex.js';
import { serviceService } from '../serviceService.js';

jest.mock('../../utils/logger', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

const DICT_WS = wsId('dictionaries');

async function setBackendDynamic(backend: InMemoryStorageBackend): Promise<void> {
  const { storageRegistry } = await import('../../storage/contract/StorageBackendToken.js');
  storageRegistry.setBackend(backend);
}

async function resetRegistryDynamic(): Promise<void> {
  const { storageRegistry } = await import('../../storage/contract/StorageBackendToken.js');
  storageRegistry.reset();
}

/** Seed a backend with two packages (pkg-a, pkg-b), each with a marker. */
function createSeededBackend(): InMemoryStorageBackend {
  const backend = new InMemoryStorageBackend();
  const ws = String(DICT_WS);
  if (!backend.files.has(ws)) backend.files.set(ws, new Map());
  let rootDirs = backend.dirs.get(ws);
  if (!rootDirs) {
    rootDirs = new Set<string>();
    backend.dirs.set(ws, rootDirs);
  }
  rootDirs.add('');
  backend.files.get(ws)!.set('pkg-a/package.yaml', 'name: pkg-a\n');
  backend.files.get(ws)!.set('pkg-b/package.yaml', 'name: pkg-b\n');
  return backend;
}

function makeFoo(): Entity {
  return {
    uuid: '00000000-0000-4000-8000-00000000c001',
    name: 'Foo',
    description: 'foo',
    attributes: [
      { uuid: '00000000-0000-4000-8000-00000000c0a1', name: 'id', description: 'identifier', type: AttributeType.UUID, required: true },
    ],
  };
}

function makeBar(): Entity {
  return {
    uuid: '00000000-0000-4000-8000-00000000c002',
    name: 'Bar',
    description: 'bar',
    attributes: [
      { uuid: '00000000-0000-4000-8000-00000000c0a2', name: 'id', description: 'identifier', type: AttributeType.UUID, required: true },
    ],
  };
}

let backend: InMemoryStorageBackend;
let projection: LogicalProjection;
let uuidIndex: UuidIndex;

beforeEach(async () => {
  backend = createSeededBackend();
  await setBackendDynamic(backend);
  projection = new LogicalProjection(backend, DICT_WS);
  uuidIndex = new UuidIndex(projection, DICT_WS, backend);
});

afterEach(async () => {
  await resetRegistryDynamic();
  resetProjectionRegistry();
  resetUuidIndexRegistry();
});

describe('ServiceService.moveEntity (#move-entity)', () => {
  it('MV-T1: relocates the entity, preserving its UUID; the uuid index re-points', async () => {
    registerProjection(DICT_WS, projection);
    await uuidIndex.rebuild();
    uuidIndex.start();

    const foo = makeFoo();
    await projection.writeEntity('packages/pkg-a/entities/Foo', foo);
    expect(uuidIndex.findPathByUuid(foo.uuid)).toBe('packages/pkg-a/entities/Foo');

    const result = await serviceService.moveEntity('pkg-a', 'Foo', 'pkg-b');
    expect(result.success).toBe(true);
    expect(result.errors).toEqual([]);

    // Gone from the source, present in the target, same UUID.
    expect(await projection.readEntity('packages/pkg-a/entities/Foo')).toBeNull();
    const moved = await projection.readEntity('packages/pkg-b/entities/Foo');
    expect(moved?.uuid).toBe(foo.uuid);

    // The uuid index now resolves the UUID to the target path.
    expect(uuidIndex.findPathByUuid(foo.uuid)).toBe('packages/pkg-b/entities/Foo');
  });

  it('MV-T2: a same-package relationship does NOT block the move (unlike delete)', async () => {
    registerProjection(DICT_WS, projection);
    await uuidIndex.rebuild();
    uuidIndex.start();

    const foo = makeFoo();
    const bar = makeBar();
    await projection.writeEntity('packages/pkg-a/entities/Foo', foo);
    await projection.writeEntity('packages/pkg-a/entities/Bar', bar);

    // Foo↔Bar relationship in pkg-a, referencing Foo by UUID.
    const relYaml = `relationships:
  - uuid: 00000000-0000-4000-8000-00000000d101
    description: foo-to-bar
    source:
      entity: ${foo.uuid}
      cardinality: ${Cardinality.ONE}
    target:
      entity: ${bar.uuid}
      cardinality: ${Cardinality.MANY}
`;
    backend.files.get(String(DICT_WS))!.set('pkg-a/relationships.model.yaml', relYaml);

    const result = await serviceService.moveEntity('pkg-a', 'Foo', 'pkg-b');
    expect(result.success).toBe(true);

    // Foo now lives in pkg-b; the relationship (still in pkg-a) references it by
    // UUID and remains valid — cross-package relationships are first-class.
    expect(await projection.readEntity('packages/pkg-b/entities/Foo')).not.toBeNull();
    const relFile = backend.files.get(String(DICT_WS))!.get('pkg-a/relationships.model.yaml');
    expect(relFile).toContain(foo.uuid);
  });

  it('MV-T3: rejects a name collision in the target package', async () => {
    registerProjection(DICT_WS, projection);
    await uuidIndex.rebuild();
    uuidIndex.start();

    await projection.writeEntity('packages/pkg-a/entities/Foo', makeFoo());
    // A different Foo already exists in the target.
    await projection.writeEntity('packages/pkg-b/entities/Foo', { ...makeFoo(), uuid: '00000000-0000-4000-8000-00000000ceee' });

    const result = await serviceService.moveEntity('pkg-a', 'Foo', 'pkg-b');
    expect(result.success).toBe(false);
    expect(result.errors[0]).toMatch(/already has an entity named 'Foo'/);

    // Source untouched.
    expect(await projection.readEntity('packages/pkg-a/entities/Foo')).not.toBeNull();
  });

  it('MV-T4: rejects a missing source entity', async () => {
    registerProjection(DICT_WS, projection);
    const result = await serviceService.moveEntity('pkg-a', 'Nope', 'pkg-b');
    expect(result.success).toBe(false);
    expect(result.errors[0]).toMatch(/Entity pkg-a\.Nope not found/);
  });

  it('MV-T5: rejects a non-existent target package', async () => {
    registerProjection(DICT_WS, projection);
    await uuidIndex.rebuild();
    uuidIndex.start();
    await projection.writeEntity('packages/pkg-a/entities/Foo', makeFoo());

    const result = await serviceService.moveEntity('pkg-a', 'Foo', 'ghost-pkg');
    expect(result.success).toBe(false);
    expect(result.errors[0]).toMatch(/Target package 'ghost-pkg' does not exist/);
    expect(await projection.readEntity('packages/pkg-a/entities/Foo')).not.toBeNull();
  });

  it('MV-T6: rejects moving to the same package', async () => {
    registerProjection(DICT_WS, projection);
    await projection.writeEntity('packages/pkg-a/entities/Foo', makeFoo());
    const result = await serviceService.moveEntity('pkg-a', 'Foo', 'pkg-a');
    expect(result.success).toBe(false);
    expect(result.errors[0]).toMatch(/must differ/);
  });
});
