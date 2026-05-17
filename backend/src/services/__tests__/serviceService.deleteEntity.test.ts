/**
 * serviceService.deleteEntity.test.ts — #167 slice 6b''''
 *
 * Proves that ServiceService.deleteEntity routes through the registered
 * LogicalProjection (so the slice-6c UuidIndex sees the invalidation event),
 * and that both pre-checks (not-found, relationship-reference) still short
 * circuit without touching the projection's delete path.
 *
 * Fixture strategy: Option A (copy-paste) — fifth use of the blank-service
 * fixture. Shared helper extraction still pending (tracked in slice 6e).
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

const BLANK_PACKAGE_YAML = `name: blank-service\n`;

function createSeededBackend(): InMemoryStorageBackend {
  const backend = new InMemoryStorageBackend();
  const ws = String(DICT_WS);
  if (!backend.files.has(ws)) backend.files.set(ws, new Map());
  // Root-dir marker so listPackages() succeeds (see slice-6c fixture rationale).
  let rootDirs = backend.dirs.get(ws);
  if (!rootDirs) {
    rootDirs = new Set<string>();
    backend.dirs.set(ws, rootDirs);
  }
  rootDirs.add('');
  backend.files.get(ws)!.set('blank-service/package.yaml', BLANK_PACKAGE_YAML);
  return backend;
}

function makeFoo(): Entity {
  return {
    uuid: '00000000-0000-4000-8000-00000000c001',
    name: 'Foo',
    description: 'foo',
    attributes: [
      {
        uuid: '00000000-0000-4000-8000-00000000c0a1',
        name: 'id',
        description: 'identifier',
        type: AttributeType.UUID,
        required: true,
      },
    ],
  };
}

function makeBar(): Entity {
  return {
    uuid: '00000000-0000-4000-8000-00000000c002',
    name: 'Bar',
    description: 'bar',
    attributes: [
      {
        uuid: '00000000-0000-4000-8000-00000000c0a2',
        name: 'id',
        description: 'identifier',
        type: AttributeType.UUID,
        required: true,
      },
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

describe("ServiceService.deleteEntity — slice 6b'''' projection routing", () => {
  it('SD-T1: deletes through the registered projection; uuid index forgets the entry', async () => {
    registerProjection(DICT_WS, projection);
    await uuidIndex.rebuild();
    uuidIndex.start();

    const foo = makeFoo();
    await projection.writeEntity('packages/blank-service/entities/Foo', foo);

    // Sanity: the uuid index sees the entry pre-delete.
    expect(uuidIndex.findPathByUuid(foo.uuid)).toBe('packages/blank-service/entities/Foo');

    const result = await serviceService.deleteEntity('blank-service', 'Foo');
    expect(result.success).toBe(true);
    expect(result.errors).toEqual([]);

    // Projection round-trip — no entity at that path.
    const readBack = await projection.readEntity('packages/blank-service/entities/Foo');
    expect(readBack).toBeNull();

    // The uuid index forgot the entry — proves the delete fired an
    // invalidation event on the SAME projection the index subscribed to.
    // This is the closure of slice-6c Risk §11.6 for the controller-routed
    // DELETE /api/services/:service/entities/:name path.
    expect(uuidIndex.findPathByUuid(foo.uuid)).toBeNull();
  });

  it('SD-T2: not-found pre-check returns failure without touching the projection', async () => {
    // Register projection so a "not registered" error would NOT mask the
    // boundary check — the pre-check must fire BEFORE getProjection() is
    // called.
    registerProjection(DICT_WS, projection);

    const result = await serviceService.deleteEntity('blank-service', 'Nonexistent');

    expect(result.success).toBe(false);
    expect(result.errors[0]).toMatch(/Entity blank-service\.Nonexistent not found/);
    // Proves we did NOT reach the projection call — if we had, the error
    // would mention "not registered" or surface from projection.deleteEntity.
    expect(result.errors.join(' ')).not.toMatch(/not registered/);
  });

  it('SD-T3: relationship-reference pre-check returns failure without deleting', async () => {
    registerProjection(DICT_WS, projection);
    await uuidIndex.rebuild();
    uuidIndex.start();

    const foo = makeFoo();
    const bar = makeBar();
    await projection.writeEntity('packages/blank-service/entities/Foo', foo);
    await projection.writeEntity('packages/blank-service/entities/Bar', bar);

    // Seed a package-level relationship referencing Foo by uuid. Shape mirrors
    // the on-disk schema (each end carries its own cardinality — see
    // EntitySchema.RelationshipEnd and fileOperations.multiKind.test.ts).
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
    backend.files.get(String(DICT_WS))!.set('blank-service/relationships.model.yaml', relYaml);

    const result = await serviceService.deleteEntity('blank-service', 'Foo');

    expect(result.success).toBe(false);
    expect(result.errors[0]).toContain(
      'Cannot delete entity blank-service.Foo because it is referenced in 1 relationship(s)'
    );

    // Boundary preservation — projection.deleteEntity was NOT called, so the
    // entity is still readable.
    const stillThere = await projection.readEntity('packages/blank-service/entities/Foo');
    expect(stillThere?.uuid).toBe(foo.uuid);

    // And the uuid index still tracks it.
    expect(uuidIndex.findPathByUuid(foo.uuid)).toBe('packages/blank-service/entities/Foo');
  });
});
