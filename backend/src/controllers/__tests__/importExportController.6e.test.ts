/**
 * importExportController.6e.test.ts — #167 slice 6e.1
 *
 * Proves that the relationship write site in `commitSqlDdl` routes through
 * the registered LogicalProjection rather than calling
 * `fileOperations.writeRelationshipsFile` directly (AC9).
 *
 * Approach: spy on the projection method; invoke commitSqlDdl with a request
 * that includes relationships. Verify writeRelationships fires once with the
 * expected logical path.
 */

import { Cardinality, type Entity, type Relationship } from '../../models/EntitySchema.js';
import { InMemoryStorageBackend } from '../../storage/memory/InMemoryStorageBackend.js';
import { wsId } from '../../storage/contract/types.js';
import { LogicalProjection } from '../../storage/projection/LogicalProjection.js';
import { registerProjection, resetProjectionRegistry } from '../../storage/projection/ProjectionRegistry.js';
import { commitSqlDdl } from '../importExportController.js';

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

function mockResponse() {
  const json = jest.fn();
  const status = jest.fn().mockReturnThis();
  const res = { json, status } as unknown as import('express').Response;
  return { res, json, status };
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

describe('importExportController.commitSqlDdl — slice 6e.1 (AC9)', () => {
  it('IEC-T1: relationships in body route through projection.writeRelationships exactly once', async () => {
    const writeRelsSpy = jest.spyOn(projection, 'writeRelationships');
    const writeEntitySpy = jest.spyOn(projection, 'writeEntity');

    // One added entity + one relationship that references it.
    const e1: Entity = {
      uuid: '00000000-0000-4000-8000-00000000a001',
      name: 'OrderHeader',
      description: 'header',
      attributes: [],
      metadata: [
        { name: 'physical.tableName', value: 'order_header' },
      ],
    };
    const e2: Entity = {
      uuid: '00000000-0000-4000-8000-00000000a002',
      name: 'OrderLine',
      description: 'line',
      attributes: [],
      metadata: [
        { name: 'physical.tableName', value: 'order_line' },
      ],
    };
    const rel: Relationship = {
      uuid: 'rel-00000000-0000-4000-8000-00000000a010',
      description: 'header → line',
      source: {
        entity: e1.uuid,
        cardinality: Cardinality.ONE,
      },
      target: {
        entity: e2.uuid,
        cardinality: Cardinality.MANY,
      },
    };

    const req = {
      body: {
        parsed: [e1, e2],
        relationships: [rel],
        targetService: 'blank-service',
      },
    } as unknown as import('express').Request;
    const { res } = mockResponse();

    await commitSqlDdl(req, res);

    // Exactly one writeRelationships call with the logical path
    expect(writeRelsSpy).toHaveBeenCalledTimes(1);
    expect(writeRelsSpy.mock.calls[0][0]).toBe('packages/blank-service');
    expect(writeRelsSpy.mock.calls[0][1].map(r => r.uuid)).toContain(rel.uuid);

    // Per-entity projection.writeEntity invocations happen via importService.
    // Just confirm they fired (AC9 says "in addition to per-entity").
    expect(writeEntitySpy.mock.calls.length).toBeGreaterThan(0);
  });

  it('IEC-T2: empty relationships in body do NOT call projection.writeRelationships', async () => {
    const writeRelsSpy = jest.spyOn(projection, 'writeRelationships');

    const e1: Entity = {
      uuid: '00000000-0000-4000-8000-00000000a003',
      name: 'JustOne',
      description: 'only one',
      attributes: [],
      metadata: [
        { name: 'physical.tableName', value: 'just_one' },
      ],
    };
    const req = {
      body: {
        parsed: [e1],
        // relationships omitted intentionally
        targetService: 'blank-service',
      },
    } as unknown as import('express').Request;
    const { res } = mockResponse();

    await commitSqlDdl(req, res);

    expect(writeRelsSpy).not.toHaveBeenCalled();
  });
});
