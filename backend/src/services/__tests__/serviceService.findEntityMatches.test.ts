/**
 * serviceService.findEntityMatches.test.ts
 *
 * findEntityMatches() returns ALL `{ entity, packageName }` matches for a
 * name across packages, with one precedence rule: a hit in the preferred
 * package wins outright (single match, no wider scan). It underpins the AI
 * getEntityDetails tool, which turns a multi-match into a disambiguation
 * list instead of the thrown error findEntityAcrossPackages produces.
 *
 * findEntityAcrossPackages() now delegates to it — the dedicated suite in
 * serviceService.findEntityAcrossPackages.test.ts is the full regression
 * guard; a consistency spot-check lives at the bottom of this file.
 */

import { AttributeType, type Entity } from '../../models/EntitySchema.js';
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

function makeEntity(uuid: string, name: string): Entity {
  return {
    uuid,
    name,
    description: `${name} (fixture)`,
    attributes: [
      {
        uuid: `${uuid.slice(0, -3)}aa1`,
        name: 'id',
        description: 'identifier',
        type: AttributeType.UUID,
        required: true,
      },
    ],
  };
}

function createSeededBackend(packageNames: string[]): InMemoryStorageBackend {
  const backend = new InMemoryStorageBackend();
  const ws = String(DICT_WS);
  if (!backend.files.has(ws)) backend.files.set(ws, new Map());
  let rootDirs = backend.dirs.get(ws);
  if (!rootDirs) {
    rootDirs = new Set<string>();
    backend.dirs.set(ws, rootDirs);
  }
  rootDirs.add('');
  for (const p of packageNames) {
    backend.files.get(ws)!.set(`${p}/package.yaml`, `name: ${p}\n`);
  }
  return backend;
}

let backend: InMemoryStorageBackend;
let projection: LogicalProjection;

beforeEach(async () => {
  backend = createSeededBackend(['order-service', 'user-service', 'product-service']);
  await setBackendDynamic(backend);
  projection = new LogicalProjection(backend, DICT_WS);
  registerProjection(DICT_WS, projection);

  const assertSeeded = (label: string, r: { success: boolean; errors: string[] }) => {
    if (!r.success) throw new Error(`seed failed (${label}): ${r.errors.join('; ')}`);
  };
  // Order lives uniquely in order-service
  assertSeeded('Order', await serviceService.createEntity('order-service', makeEntity('00000000-0000-4000-8000-000000000001', 'Order')));
  // User lives uniquely in user-service
  assertSeeded('User', await serviceService.createEntity('user-service', makeEntity('00000000-0000-4000-8000-000000000002', 'User')));
  // Address exists in BOTH user-service and product-service (ambiguous-by-name)
  assertSeeded('Address/user', await serviceService.createEntity('user-service', makeEntity('00000000-0000-4000-8000-000000000003', 'Address')));
  assertSeeded('Address/product', await serviceService.createEntity('product-service', makeEntity('00000000-0000-4000-8000-000000000004', 'Address')));
});

afterEach(async () => {
  await resetRegistryDynamic();
  resetProjectionRegistry();
});

describe('serviceService.findEntityMatches', () => {
  it('returns an empty array when the name exists in no package', async () => {
    expect(await serviceService.findEntityMatches('NoSuchEntity')).toEqual([]);
  });

  it('returns the single match for a uniquely-named entity', async () => {
    const matches = await serviceService.findEntityMatches('Order');
    expect(matches).toHaveLength(1);
    expect(matches[0].packageName).toBe('order-service');
    expect(matches[0].entity.name).toBe('Order');
    expect(matches[0].entity.uuid).toBe('00000000-0000-4000-8000-000000000001');
  });

  it('returns EVERY match when the name lives in multiple packages', async () => {
    const matches = await serviceService.findEntityMatches('Address');
    expect(matches).toHaveLength(2);
    expect(matches.map(m => m.packageName).sort()).toEqual(['product-service', 'user-service']);
    // each match carries the package-local entity, not a shared copy
    expect(matches.map(m => m.entity.uuid).sort()).toEqual([
      '00000000-0000-4000-8000-000000000003',
      '00000000-0000-4000-8000-000000000004',
    ]);
  });

  it('a hit in preferredPackage wins outright — single match, duplicates elsewhere ignored', async () => {
    const matches = await serviceService.findEntityMatches('Address', 'user-service');
    expect(matches).toHaveLength(1);
    expect(matches[0].packageName).toBe('user-service');
    expect(matches[0].entity.uuid).toBe('00000000-0000-4000-8000-000000000003');
  });

  it('falls back to a full cross-package scan when preferredPackage has no such entity', async () => {
    const matches = await serviceService.findEntityMatches('User', 'order-service');
    expect(matches).toHaveLength(1);
    expect(matches[0].packageName).toBe('user-service');
  });
});

describe('findEntityAcrossPackages delegation consistency (regression)', () => {
  it('a unique findEntityMatches result and findEntityAcrossPackages agree', async () => {
    const [match] = await serviceService.findEntityMatches('Order');
    const resolved = await serviceService.findEntityAcrossPackages('Order');
    expect(resolved).not.toBeNull();
    expect(resolved!.packageName).toBe(match.packageName);
    expect(resolved!.entity.uuid).toBe(match.entity.uuid);
  });

  it('still throws the disambiguation error on a multi-package name (unchanged contract)', async () => {
    await expect(serviceService.findEntityAcrossPackages('Address')).rejects.toThrow(
      /exists in multiple packages/,
    );
  });

  it('still returns null when the name is unknown (unchanged contract)', async () => {
    expect(await serviceService.findEntityAcrossPackages('NoSuchEntity')).toBeNull();
  });
});
