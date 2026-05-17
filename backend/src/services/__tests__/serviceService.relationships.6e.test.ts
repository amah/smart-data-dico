/**
 * serviceService.relationships.6e.test.ts — #167 slice 6e.1
 *
 * Proves that serviceService.createRelationship / updateRelationship /
 * deleteRelationship route through the registered LogicalProjection (AC7).
 *
 * Uses the same dynamic-import + projection-registration pattern as the
 * slice-6b'' / 6b''' tests (createEntity / updateEntity).
 */

import { Cardinality, type Relationship } from '../../models/EntitySchema.js';
import { InMemoryStorageBackend } from '../../storage/memory/InMemoryStorageBackend.js';
import { wsId } from '../../storage/contract/types.js';
import { LogicalProjection } from '../../storage/projection/LogicalProjection.js';
import { registerProjection, resetProjectionRegistry } from '../../storage/projection/ProjectionRegistry.js';
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
  let rootDirs = backend.dirs.get(ws);
  if (!rootDirs) {
    rootDirs = new Set<string>();
    backend.dirs.set(ws, rootDirs);
  }
  rootDirs.add('');
  backend.files.get(ws)!.set('blank-service/package.yaml', BLANK_PACKAGE_YAML);
  return backend;
}

function makeRel(uuid: string): Relationship {
  return {
    uuid,
    description: 'A → B',
    source: {
      entity: '00000000-0000-4000-8000-0000000000a1',
      cardinality: Cardinality.ONE,
    },
    target: {
      entity: '00000000-0000-4000-8000-0000000000a2',
      cardinality: Cardinality.MANY,
    },
  };
}

let backend: InMemoryStorageBackend;
let projection: LogicalProjection;

beforeEach(async () => {
  backend = createSeededBackend();
  await setBackendDynamic(backend);
  projection = new LogicalProjection(backend, DICT_WS);
  registerProjection(DICT_WS, projection);
});

afterEach(async () => {
  await resetRegistryDynamic();
  resetProjectionRegistry();
});

describe('ServiceService relationship CRUD — slice 6e.1 projection routing (AC7)', () => {
  it('SR-T1: createRelationship invokes projection.writeRelationships exactly once', async () => {
    const spy = jest.spyOn(projection, 'writeRelationships');

    const rel = makeRel('rel-00000000-0000-4000-8000-00000000c001');
    const result = await serviceService.createRelationship('blank-service', rel);

    expect(result.success).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toBe('packages/blank-service');
    const relsArg = spy.mock.calls[0][1];
    expect(relsArg.map(r => r.uuid)).toContain(rel.uuid);
  });

  it('SR-T2: updateRelationship invokes projection.writeRelationships exactly once', async () => {
    const rel = makeRel('rel-00000000-0000-4000-8000-00000000c002');
    // Seed the relationship via the projection so subsequent update has
    // something to find. Spy is installed AFTER the seed.
    await projection.writeRelationships('packages/blank-service', [rel]);

    const spy = jest.spyOn(projection, 'writeRelationships');

    const updated: Relationship = {
      ...rel,
      description: 'updated',
    };
    const result = await serviceService.updateRelationship('blank-service', rel.uuid, updated);
    expect(result.success).toBe(true);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toBe('packages/blank-service');
    const relsArg = spy.mock.calls[0][1];
    const writtenRel = relsArg.find(r => r.uuid === rel.uuid);
    expect(writtenRel).toBeDefined();
    expect(writtenRel!.description).toBe('updated');
  });

  it('SR-T3: deleteRelationship invokes projection.writeRelationships exactly once', async () => {
    const rel = makeRel('rel-00000000-0000-4000-8000-00000000c003');
    await projection.writeRelationships('packages/blank-service', [rel]);

    const spy = jest.spyOn(projection, 'writeRelationships');

    const result = await serviceService.deleteRelationship('blank-service', rel.uuid);
    expect(result.success).toBe(true);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toBe('packages/blank-service');
    expect(spy.mock.calls[0][1].map(r => r.uuid)).not.toContain(rel.uuid);
  });

  it('SR-T4: updateRelationship returns failure (and does NOT call projection) when uuid missing', async () => {
    const spy = jest.spyOn(projection, 'writeRelationships');

    const ghost = makeRel('rel-00000000-0000-4000-8000-00000000c099');
    const result = await serviceService.updateRelationship('blank-service', ghost.uuid, ghost);

    expect(result.success).toBe(false);
    expect(result.errors[0]).toContain('not found');
    expect(spy).not.toHaveBeenCalled();
  });
});
