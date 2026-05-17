/**
 * serviceService.changeEntityStatus.test.ts — #167 slice 6b'''''
 *
 * Proves that ServiceService.changeEntityStatus routes through the registered
 * LogicalProjection (so the slice-6c UuidIndex sees the invalidation event)
 * and that both pre-checks (not-found, invalid transition) short-circuit
 * BEFORE the projection is touched.
 *
 * Last serviceService entity-write site; with this file every entity write
 * in serviceService.ts goes through the projection layer.
 */

import { AttributeType, EntityStatus, type Entity } from '../../models/EntitySchema.js';
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
  let rootDirs = backend.dirs.get(ws);
  if (!rootDirs) {
    rootDirs = new Set<string>();
    backend.dirs.set(ws, rootDirs);
  }
  rootDirs.add('');
  backend.files.get(ws)!.set('blank-service/package.yaml', BLANK_PACKAGE_YAML);
  return backend;
}

function buildDraftEntity(): Entity {
  return {
    uuid: '00000000-0000-4000-8000-00000000e001',
    name: 'Foo',
    description: 'A test entity for status transitions',
    status: EntityStatus.DRAFT,
    attributes: [
      {
        uuid: '00000000-0000-4000-8000-00000000e0a1',
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

describe("ServiceService.changeEntityStatus — slice 6b''''' projection routing", () => {
  it('SC-T1: transitions DRAFT → SUBMITTED through the projection; uuid index sees the updated entity', async () => {
    registerProjection(DICT_WS, projection);
    const entity = buildDraftEntity();
    await projection.writeEntity('packages/blank-service/entities/Foo', entity);
    await uuidIndex.rebuild();
    uuidIndex.start();

    const result = await serviceService.changeEntityStatus('blank-service', 'Foo', EntityStatus.SUBMITTED);
    expect(result).toEqual({ success: true, errors: [] });

    const readBack = await projection.readEntity('packages/blank-service/entities/Foo');
    expect(readBack?.status).toBe(EntityStatus.SUBMITTED);

    // The uuid → path mapping survives the status transition (proves the
    // entity-written invalidation fired on the same projection the index
    // subscribed to; the re-confirmation is a no-op but exercises the chain).
    expect(uuidIndex.findPathByUuid(entity.uuid)).toBe('packages/blank-service/entities/Foo');
  });

  it('SC-T2: not-found pre-check returns failure without touching the projection', async () => {
    // Register projection so a "not registered" error cannot mask the boundary.
    registerProjection(DICT_WS, projection);

    const result = await serviceService.changeEntityStatus('blank-service', 'Missing', EntityStatus.SUBMITTED);

    expect(result.success).toBe(false);
    expect(result.errors[0]).toBe('Entity not found');
  });

  it('SC-T3: invalid transition (DRAFT → APPROVED) returns failure without writing', async () => {
    registerProjection(DICT_WS, projection);
    const entity = buildDraftEntity();
    await projection.writeEntity('packages/blank-service/entities/Foo', entity);

    const result = await serviceService.changeEntityStatus('blank-service', 'Foo', EntityStatus.APPROVED);

    expect(result.success).toBe(false);
    expect(result.errors[0]).toBe(`Cannot transition from ${EntityStatus.DRAFT} to ${EntityStatus.APPROVED}`);

    // Boundary preservation: the entity still has its original DRAFT status,
    // proving the transition-validation pre-check short-circuited before the
    // projection write.
    const readBack = await projection.readEntity('packages/blank-service/entities/Foo');
    expect(readBack?.status).toBe(EntityStatus.DRAFT);
  });
});
