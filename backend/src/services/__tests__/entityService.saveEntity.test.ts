/**
 * entityService.saveEntity.test.ts — #167 slice 6b'
 *
 * Proves that EntityService.saveEntity routes through the registered
 * LogicalProjection (so the slice-6c UuidIndex sees the invalidation event),
 * and that the early-return structural-validation path still works without
 * touching the projection.
 *
 * Fixture strategy: Option A (copy-paste) — fourth use of the eshop fixture.
 * Next consumer (slice 6e or 6b''/6b''') should extract to a shared
 * `_fixtures.ts` helper module.
 */

import { AttributeType, type Entity } from '../../models/EntitySchema.js';
import { InMemoryStorageBackend } from '../../storage/memory/InMemoryStorageBackend.js';
import { wsId } from '../../storage/contract/types.js';
import { LogicalProjection } from '../../storage/projection/LogicalProjection.js';
import { registerProjection, resetProjectionRegistry } from '../../storage/projection/ProjectionRegistry.js';
import { UuidIndex, resetUuidIndexRegistry } from '../../storage/projection/UuidIndex.js';
import { entityService } from '../entityService.js';

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

describe('EntityService.saveEntity — slice 6b\' projection routing', () => {
  it('ES-T1: writes through the registered projection; uuid index sees the entry', async () => {
    registerProjection(DICT_WS, projection);
    await uuidIndex.rebuild();
    uuidIndex.start();

    const entity: Entity = {
      uuid: '00000000-0000-4000-8000-00000000b001',
      name: 'Foo',
      description: 'A test entity routed through saveEntity',
      attributes: [
        {
          uuid: '00000000-0000-4000-8000-00000000b0a1',
          name: 'id',
          description: 'identifier',
          type: AttributeType.UUID,
          required: true,
        },
      ],
    };

    const result = await entityService.saveEntity(entity, 'blank-service');
    expect(result).toEqual({ success: true, errors: [] });

    // The projection round-trip sees the new entity.
    const readBack = await projection.readEntity('packages/blank-service/entities/Foo');
    expect(readBack?.uuid).toBe(entity.uuid);

    // The uuid index registered the entry — proves the saveEntity write
    // fired an invalidation event on the SAME projection the index
    // subscribed to. This is the closure of slice-6c Risk §11.6 for this
    // controller-routed write path.
    expect(uuidIndex.findPathByUuid(entity.uuid)).toBe('packages/blank-service/entities/Foo');
  });

  it('ES-T2: early-returns on structural validation failure without touching the projection', async () => {
    // Deliberately do NOT register a projection. The early-return validation
    // must fire BEFORE getProjection is called; otherwise the test would
    // surface a "not registered" error.
    const invalidEntity = { name: '', attributes: [] } as unknown as Entity;

    const result = await entityService.saveEntity(invalidEntity, 'blank-service');

    expect(result.success).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    // Proves we did NOT reach the projection call — if we had, the error
    // would mention "not registered" (see ProjectionRegistry.getProjection).
    expect(result.errors.join(' ')).not.toMatch(/not registered/);
  });
});
