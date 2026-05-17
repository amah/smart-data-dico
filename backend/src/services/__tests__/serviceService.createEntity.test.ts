/**
 * serviceService.createEntity.test.ts — #167 slice 6b''
 *
 * Proves that ServiceService.createEntity routes through the registered
 * LogicalProjection (so the slice-6c UuidIndex sees the invalidation event),
 * and that the existing-entity pre-check short-circuits BEFORE the projection
 * is touched (boundary preservation).
 *
 * Fixture strategy: Option A (copy-paste) — fifth use of the eshop fixture.
 * Next consumer should extract to a shared `_fixtures.ts` helper module.
 */

import { AttributeType, type Entity } from '../../models/EntitySchema.js';
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

describe('ServiceService.createEntity — slice 6b\'\' projection routing', () => {
  it('SS-T1: writes through the registered projection; uuid index sees the entry', async () => {
    registerProjection(DICT_WS, projection);
    await uuidIndex.rebuild();
    uuidIndex.start();

    const entity: Entity = {
      uuid: '00000000-0000-4000-8000-00000000c001',
      name: 'Foo',
      description: 'A test entity routed through createEntity',
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

    const result = await serviceService.createEntity('blank-service', entity);
    expect(result).toEqual({ success: true, errors: [] });

    // The projection round-trip sees the new entity.
    const readBack = await projection.readEntity('packages/blank-service/entities/Foo');
    expect(readBack?.uuid).toBe(entity.uuid);

    // The uuid index registered the entry — proves the createEntity write
    // fired an invalidation event on the SAME projection the index
    // subscribed to. This is the closure of slice-6c Risk §11.6 for this
    // controller-routed write path (POST /api/services/:service/entities).
    expect(uuidIndex.findPathByUuid(entity.uuid)).toBe('packages/blank-service/entities/Foo');
  });

  it('SS-T2: pre-check rejection (existing entity) does NOT reach the projection', async () => {
    // Register the projection so a "not registered" error would NOT mask the
    // boundary-preservation we are asserting.
    registerProjection(DICT_WS, projection);

    const existing: Entity = {
      uuid: '00000000-0000-4000-8000-00000000c002',
      name: 'Foo',
      description: 'Pre-seeded existing entity',
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
    await projection.writeEntity('packages/blank-service/entities/Foo', existing);

    const duplicate: Entity = {
      ...existing,
      uuid: '00000000-0000-4000-8000-00000000c003',
      description: 'Attempted overwrite via createEntity',
    };

    const result = await serviceService.createEntity('blank-service', duplicate);

    expect(result.success).toBe(false);
    expect(result.errors[0]).toBe('Entity blank-service.Foo already exists');

    // Boundary preservation: the projection still holds the original entity,
    // proving the pre-check short-circuited before the projection write.
    const readBack = await projection.readEntity('packages/blank-service/entities/Foo');
    expect(readBack?.uuid).toBe(existing.uuid);
  });
});
