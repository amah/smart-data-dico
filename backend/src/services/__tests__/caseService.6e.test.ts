/**
 * caseService.6e.test.ts — #167 slice 6e.1
 *
 * Proves that caseService.create / update / delete / upsertNode route
 * through the registered LogicalProjection (AC8).
 */

import { AttributeType, type Case, type Entity } from '../../models/EntitySchema.js';
import { InMemoryStorageBackend } from '../../storage/memory/InMemoryStorageBackend.js';
import { wsId } from '../../storage/contract/types.js';
import { LogicalProjection } from '../../storage/projection/LogicalProjection.js';
import { registerProjection, resetProjectionRegistry } from '../../storage/projection/ProjectionRegistry.js';
import { caseService } from '../caseService.js';

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

const ROOT_ENTITY: Entity = {
  uuid: '00000000-0000-4000-8000-00000000d001',
  name: 'Root',
  description: 'A root entity for case tests',
  attributes: [
    {
      uuid: '00000000-0000-4000-8000-00000000d0a1',
      name: 'id',
      description: 'identifier',
      type: AttributeType.UUID,
      required: true,
    },
  ],
};

let backend: InMemoryStorageBackend;
let projection: LogicalProjection;

beforeEach(async () => {
  backend = createSeededBackend();
  await setBackendDynamic(backend);
  projection = new LogicalProjection(backend, DICT_WS);
  registerProjection(DICT_WS, projection);

  // Seed a root entity so resolveCaseHomePackage finds blank-service.
  await projection.writeEntity('packages/blank-service/entities/Root', ROOT_ENTITY);
});

afterEach(async () => {
  await resetRegistryDynamic();
  resetProjectionRegistry();
});

describe('CaseService — slice 6e.1 projection routing (AC8)', () => {
  it('CS-T1: create invokes projection.writeCase exactly once with the new case', async () => {
    const spy = jest.spyOn(projection, 'writeCase');

    const data: Partial<Case> = {
      uuid: 'case-00000000-0000-4000-8000-00000000c001',
      name: 'Created',
      rootEntities: [ROOT_ENTITY.uuid],
    };
    const result = await caseService.create(data);
    expect(result.success).toBe(true);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toBe('packages/blank-service/cases/Created');
    expect(spy.mock.calls[0][1].uuid).toBe(data.uuid);
    expect(spy.mock.calls[0][1].name).toBe('Created');
  });

  it('CS-T2: update invokes projection.writeCase exactly once with the merged case', async () => {
    // Seed an existing case.
    const existing: Case = {
      uuid: 'case-00000000-0000-4000-8000-00000000c002',
      name: 'Existing',
      rootEntities: [ROOT_ENTITY.uuid],
      nodes: [],
      maxDepth: 5,
      metadata: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await projection.writeCase('packages/blank-service/cases/Existing', existing);

    const spy = jest.spyOn(projection, 'writeCase');

    const result = await caseService.update(existing.uuid, { description: 'updated' });
    expect(result.success).toBe(true);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toBe('packages/blank-service/cases/Existing');
    expect(spy.mock.calls[0][1].description).toBe('updated');
  });

  it('CS-T3: delete invokes projection.deleteCase exactly once', async () => {
    const existing: Case = {
      uuid: 'case-00000000-0000-4000-8000-00000000c003',
      name: 'Disposable',
      rootEntities: [ROOT_ENTITY.uuid],
      nodes: [],
      maxDepth: 5,
      metadata: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await projection.writeCase('packages/blank-service/cases/Disposable', existing);

    const writeSpy = jest.spyOn(projection, 'writeCase');
    const deleteSpy = jest.spyOn(projection, 'deleteCase');

    const result = await caseService.delete(existing.uuid);
    expect(result.success).toBe(true);

    expect(deleteSpy).toHaveBeenCalledTimes(1);
    expect(deleteSpy.mock.calls[0][0]).toBe('packages/blank-service/cases/Disposable');
    expect(writeSpy).not.toHaveBeenCalled();
  });

  it('CS-T4: upsertNode invokes projection.writeCase exactly once', async () => {
    const existing: Case = {
      uuid: 'case-00000000-0000-4000-8000-00000000c004',
      name: 'Annotated',
      rootEntities: [ROOT_ENTITY.uuid],
      nodes: [],
      maxDepth: 5,
      metadata: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await projection.writeCase('packages/blank-service/cases/Annotated', existing);

    const spy = jest.spyOn(projection, 'writeCase');

    const result = await caseService.upsertNode(existing.uuid, { path: 'Root/Child', exclude: true });
    expect(result.success).toBe(true);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toBe('packages/blank-service/cases/Annotated');
    const writtenCase = spy.mock.calls[0][1];
    expect(writtenCase.nodes!.find(n => n.path === 'Root/Child')?.exclude).toBe(true);
  });

  it('CS-T5: delete returns failure (without calling deleteCase) when uuid not found', async () => {
    const deleteSpy = jest.spyOn(projection, 'deleteCase');

    const result = await caseService.delete('case-nonexistent');
    expect(result.success).toBe(false);
    expect(deleteSpy).not.toHaveBeenCalled();
  });
});
