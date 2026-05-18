/**
 * serviceService.findEntityAcrossPackages.test.ts
 *
 * Exercises the cross-package entity resolver added when the same-package
 * constraint was removed from the relationship-creation tools (agent +
 * MCP). The resolver underpins cross-package relationships being
 * first-class: the AI/MCP tools no longer require both endpoints to live
 * in one package.
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

describe('serviceService.findEntityAcrossPackages', () => {
  it('returns null when the name is not found in any package', async () => {
    const result = await serviceService.findEntityAcrossPackages('NoSuchEntity');
    expect(result).toBeNull();
  });

  it('finds a uniquely-named entity in its package when no preferred package is given', async () => {
    const result = await serviceService.findEntityAcrossPackages('Order');
    expect(result).not.toBeNull();
    expect(result!.packageName).toBe('order-service');
    expect(result!.entity.name).toBe('Order');
  });

  it('finds a cross-package endpoint when caller hints the wrong preferred package', async () => {
    // caller mistakenly believes User lives in order-service — resolver
    // should fall back to scanning every package and still locate it.
    const result = await serviceService.findEntityAcrossPackages('User', 'order-service');
    expect(result).not.toBeNull();
    expect(result!.packageName).toBe('user-service');
  });

  it('honors the preferred package when the entity exists there', async () => {
    // Address exists in BOTH user-service and product-service; preferring
    // user-service must return THAT one without triggering ambiguity.
    const result = await serviceService.findEntityAcrossPackages('Address', 'user-service');
    expect(result).not.toBeNull();
    expect(result!.packageName).toBe('user-service');
  });

  it('throws a disambiguation error when the name lives in multiple packages and no preference is given', async () => {
    await expect(serviceService.findEntityAcrossPackages('Address')).rejects.toThrow(
      /exists in multiple packages: .*user-service.*product-service|product-service.*user-service/,
    );
  });
});
