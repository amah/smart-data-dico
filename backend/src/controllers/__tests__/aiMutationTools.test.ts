/**
 * Tests for aiMutationTools.ts (#191) — the shared core for all six AI
 * data-model mutation tools.
 *
 * Strategy: mock the filesystem-touching callees (fileOperations, dicoConfigService,
 * stereotypeService) and the serviceService surface so nothing hits disk.
 * Every assertion exercises the PUBLIC contract:
 *   - validation failures RETURN { success: false, error } (never throw)
 *   - service.create/update/delete is NOT called on validation failures
 *   - success returns the full structured MutationSuccess shape
 */

// --- logger stub (always required for aiMutationTools imports) ---
jest.mock('../../utils/logger');

// --- fileOperations dynamic-import mock ---
// aiMutationTools uses `await import('../utils/fileOperations.js')` inside
// ensurePackage / packageExists, so we need to register the mock before the
// module under test is loaded.
jest.mock('../../utils/fileOperations', () => ({
  listPackages: jest.fn(),
  ensurePackageDirectoryStructure: jest.fn(),
}));

// --- dicoConfigService: listDerivedTypes + resolveAttributeType ---
jest.mock('../../services/dicoConfigService', () => ({
  listDerivedTypes: jest.fn(),
  resolveAttributeType: jest.fn(),
}));

import {
  executeCreateEntity,
  executeUpdateEntity,
  executeDeleteEntity,
  executeCreateRelationship,
  executeUpdateRelationship,
  executeDeleteRelationship,
  validateEntityMutation,
  validateRelationshipMutation,
  type MutationServices,
  type CreateEntityInput,
  type UpdateEntityInput,
  type DeleteEntityInput,
  type CreateRelationshipInput,
  type UpdateRelationshipInput,
  type DeleteRelationshipInput,
} from '../aiMutationTools.js';

import { listDerivedTypes, resolveAttributeType } from '../../services/dicoConfigService.js';
import { listPackages, ensurePackageDirectoryStructure } from '../../utils/fileOperations.js';
import { AttributeType, Cardinality, EntityStatus } from '../../models/EntitySchema.js';

// Typed aliases for the mocks so we get autocomplete in the tests.
const mockListDerivedTypes = listDerivedTypes as jest.MockedFunction<typeof listDerivedTypes>;
const mockResolveAttributeType = resolveAttributeType as jest.MockedFunction<typeof resolveAttributeType>;
const mockListPackages = listPackages as jest.MockedFunction<typeof listPackages>;
const mockEnsurePackage = ensurePackageDirectoryStructure as jest.MockedFunction<typeof ensurePackageDirectoryStructure>;

// ---------------------------------------------------------------------------
// Fixture helpers — UUIDs must be RFC-4122-compliant (validateEntity checks)
// ---------------------------------------------------------------------------

// Stable UUIDs for use in fixtures.
const UUID = {
  entity1: '550e8400-e29b-41d4-a716-446655440001',
  entity2: '550e8400-e29b-41d4-a716-446655440002',
  entity3: '550e8400-e29b-41d4-a716-446655440003',
  attr1:   '550e8400-e29b-41d4-a716-446655440011',
  attr2:   '550e8400-e29b-41d4-a716-446655440012',
  attr3:   '550e8400-e29b-41d4-a716-446655440013',
  rel1:    '550e8400-e29b-41d4-a716-446655440021',
};

function makeEntity(overrides: Record<string, any> = {}) {
  return {
    uuid: UUID.entity1,
    name: 'Product',
    description: 'A product entity',
    status: EntityStatus.DRAFT,
    attributes: [
      { uuid: UUID.attr1, name: 'id', type: AttributeType.UUID, description: 'Primary key', required: true },
      { uuid: UUID.attr2, name: 'name', type: AttributeType.STRING, description: 'Product name', required: true },
      { uuid: UUID.attr3, name: 'price', type: AttributeType.NUMBER, description: 'Price', required: false },
    ],
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeRelationship(srcUuid: string, tgtUuid: string) {
  return {
    uuid: UUID.rel1,
    description: '',
    source: { entity: srcUuid, cardinality: Cardinality.ONE },
    target: { entity: tgtUuid, cardinality: Cardinality.MANY },
  };
}

/** Build a minimal MutationServices mock with controllable return values. */
function makeMockServices(overrides: Partial<{
  createEntityResult: Awaited<ReturnType<MutationServices['serviceService']['createEntity']>>;
  updateEntityResult: Awaited<ReturnType<MutationServices['serviceService']['updateEntity']>>;
  deleteEntityResult: Awaited<ReturnType<MutationServices['serviceService']['deleteEntity']>>;
  existingEntity: any;
  findAcrossResult: { entity: any; packageName: string } | null;
  packageRelationships: any[];
  createRelationshipResult: Awaited<ReturnType<MutationServices['serviceService']['createRelationship']>>;
  updateRelationshipResult: Awaited<ReturnType<MutationServices['serviceService']['updateRelationship']>>;
  deleteRelationshipResult: Awaited<ReturnType<MutationServices['serviceService']['deleteRelationship']>>;
  stereotypes: Array<{ id: string; name: string; appliesTo: string }>;
}> = {}): MutationServices {
  const {
    createEntityResult = { success: true, errors: [] },
    updateEntityResult = { success: true, errors: [] },
    deleteEntityResult = { success: true, errors: [] },
    existingEntity = null,
    findAcrossResult = null,
    packageRelationships = [],
    createRelationshipResult = { success: true, errors: [], relationship: undefined },
    updateRelationshipResult = { success: true, errors: [] },
    deleteRelationshipResult = { success: true, errors: [] },
    stereotypes = [{ id: 'aggregate-root', name: 'Aggregate Root', appliesTo: 'entity' }],
  } = overrides;

  return {
    serviceService: {
      createEntity: jest.fn().mockResolvedValue(createEntityResult),
      updateEntity: jest.fn().mockResolvedValue(updateEntityResult),
      deleteEntity: jest.fn().mockResolvedValue(deleteEntityResult),
      getEntitySchema: jest.fn().mockResolvedValue(existingEntity),
      findEntityAcrossPackages: jest.fn().mockResolvedValue(findAcrossResult),
      getPackageRelationships: jest.fn().mockResolvedValue(packageRelationships),
      createRelationship: jest.fn().mockResolvedValue(createRelationshipResult),
      updateRelationship: jest.fn().mockResolvedValue(updateRelationshipResult),
      deleteRelationship: jest.fn().mockResolvedValue(deleteRelationshipResult),
    },
    stereotypeService: {
      getAllStereotypes: jest.fn().mockResolvedValue(stereotypes),
    },
  };
}

// ---------------------------------------------------------------------------
// Default mock setup — happy path for dicoConfigService and fileOperations
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();

  // Standard types resolve (return non-null).
  mockResolveAttributeType.mockImplementation((typeName: string) => {
    const STANDARD = new Set(['string', 'integer', 'number', 'boolean', 'date', 'datetime', 'uuid', 'enum',
      'object', 'array', 'time', 'date-time', 'timestamp', 'duration']);
    if (STANDARD.has(typeName)) {
      return { baseType: typeName as AttributeType, validation: {} };
    }
    return null;
  });
  mockListDerivedTypes.mockResolvedValue([]);
  mockListPackages.mockResolvedValue(['product-service', 'order-service', 'user-service']);
  mockEnsurePackage.mockResolvedValue(undefined);
});

// ===========================================================================
// validateEntityMutation — semantic validation
// ===========================================================================

describe('validateEntityMutation — validation failures return {ok:false}, not throw', () => {
  const validInput: CreateEntityInput = {
    packageName: 'product-service',
    name: 'Widget',
    attributes: [
      { name: 'id', type: 'uuid', required: true },
      { name: 'title', type: 'string' },
    ],
  };

  it('returns ok:true for a well-formed entity', async () => {
    const services = makeMockServices();
    // entity passed to validateEntityMutation must carry valid UUIDs because
    // validateEntity() enforces the UUID regex.
    const entity = makeEntity({
      name: 'Widget',
      attributes: [
        { uuid: UUID.attr1, name: 'id', type: AttributeType.UUID, description: '', required: true },
        { uuid: UUID.attr2, name: 'title', type: AttributeType.STRING, description: '', required: false },
      ],
    });
    const result = await validateEntityMutation(validInput, entity as any, services, 'create');
    expect(result.ok).toBe(true);
  });

  it('returns ok:false with error when an attribute type is unknown', async () => {
    const input: CreateEntityInput = {
      ...validInput,
      attributes: [{ name: 'foo', type: 'unicorn-type' }],
    };
    mockResolveAttributeType.mockReturnValue(null); // unknown type
    const services = makeMockServices();
    const entity = makeEntity({ name: 'Widget', attributes: input.attributes as any });
    const result = await validateEntityMutation(input, entity as any, services, 'create');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/unknown type.*unicorn-type/i);
      expect(result.error).toContain('foo');
    }
  });

  it('returns ok:false with error when stereotype is unknown', async () => {
    const input: CreateEntityInput = { ...validInput, stereotype: 'not-a-real-stereotype' };
    const services = makeMockServices({ stereotypes: [] }); // no stereotypes defined
    const entity = makeEntity({ name: 'Widget', attributes: validInput.attributes as any });
    const result = await validateEntityMutation(input, entity as any, services, 'create');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/stereotype/i);
      expect(result.error).toContain('not-a-real-stereotype');
    }
  });

  it('returns ok:false with error when there are duplicate attribute names', async () => {
    const input: CreateEntityInput = {
      ...validInput,
      attributes: [
        { name: 'dup', type: 'string' },
        { name: 'dup', type: 'integer' },
      ],
    };
    const services = makeMockServices();
    const entity = makeEntity({ name: 'Widget', attributes: input.attributes as any });
    const result = await validateEntityMutation(input, entity as any, services, 'create');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/duplicate.*attribute.*dup/i);
    }
  });

  it('returns ok:false when entity already exists on create', async () => {
    const services = makeMockServices({ existingEntity: makeEntity() });
    const entity = makeEntity({ name: 'Widget', attributes: validInput.attributes as any });
    const result = await validateEntityMutation(validInput, entity as any, services, 'create');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/already exists/i);
    }
  });

  it('returns ok:false for update when package does not exist', async () => {
    mockListPackages.mockResolvedValue([]); // no packages
    const services = makeMockServices();
    const entity = makeEntity({ name: 'Widget', attributes: validInput.attributes as any });
    const result = await validateEntityMutation(validInput, entity as any, services, 'update');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/does not exist/i);
    }
  });
});

// ===========================================================================
// executeCreateEntity
// ===========================================================================

describe('executeCreateEntity — success contract', () => {
  const input: CreateEntityInput = {
    packageName: 'product-service',
    name: 'Product',
    description: 'A product',
    stereotype: 'aggregate-root',
    attributes: [
      { name: 'id', type: 'uuid', required: true, primaryKey: true },
      { name: 'name', type: 'string', required: true },
      { name: 'price', type: 'number', required: false },
    ],
  };

  it('returns changeKind:created, elementType:entity, name, packageName, navigate, highlight, summary', async () => {
    const services = makeMockServices();
    const result = await executeCreateEntity(input, services);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.changeKind).toBe('created');
    expect(result.elementType).toBe('entity');
    expect(result.name).toBe('Product');
    expect(result.packageName).toBe('product-service');
    expect(result.navigate).toBe('/packages/product-service/entities/Product');
    expect(result.highlight).toBe('Product');
    expect(result.summary).toMatch(/Created entity Product/);
    expect(result.summary).toMatch(/\+3 attributes?/);
    expect(result.summary).toMatch(/aggregate-root/);
  });

  it('calls serviceService.createEntity exactly once with the right packageName', async () => {
    const services = makeMockServices();
    await executeCreateEntity(input, services);
    expect(services.serviceService.createEntity).toHaveBeenCalledTimes(1);
    const [calledPkg] = (services.serviceService.createEntity as jest.Mock).mock.calls[0];
    expect(calledPkg).toBe('product-service');
  });

  it('summary includes attribute count and stereotype note', async () => {
    const services = makeMockServices();
    const result = await executeCreateEntity(input, services);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.summary).toContain('+3 attributes');
    expect(result.summary).toContain('aggregate-root');
  });

  it('summary singularizes "attribute" when count is 1', async () => {
    const singleAttr: CreateEntityInput = {
      ...input,
      attributes: [{ name: 'id', type: 'uuid', required: true }],
    };
    const services = makeMockServices();
    const result = await executeCreateEntity(singleAttr, services);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.summary).toMatch(/\+1 attribute[^s]/);
  });
});

describe('executeCreateEntity — validation failures do NOT call serviceService', () => {
  it('returns {success:false} and does NOT call createEntity for unknown type', async () => {
    mockResolveAttributeType.mockReturnValue(null);
    const services = makeMockServices();
    const input: CreateEntityInput = {
      packageName: 'product-service',
      name: 'Bogus',
      attributes: [{ name: 'x', type: 'no-such-type' }],
    };
    const result = await executeCreateEntity(input, services);

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toBeTruthy();
    expect(services.serviceService.createEntity).not.toHaveBeenCalled();
  });

  it('returns {success:false} and does NOT call createEntity for unknown stereotype', async () => {
    const services = makeMockServices({ stereotypes: [] });
    const input: CreateEntityInput = {
      packageName: 'product-service',
      name: 'Bogus',
      stereotype: 'no-such-stereotype',
      attributes: [{ name: 'id', type: 'uuid' }],
    };
    const result = await executeCreateEntity(input, services);

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toBeTruthy();
    expect(services.serviceService.createEntity).not.toHaveBeenCalled();
  });

  it('returns {success:false} and does NOT call createEntity for duplicate attribute names', async () => {
    const services = makeMockServices();
    const input: CreateEntityInput = {
      packageName: 'product-service',
      name: 'Bogus',
      attributes: [
        { name: 'x', type: 'string' },
        { name: 'x', type: 'integer' },
      ],
    };
    const result = await executeCreateEntity(input, services);

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toBeTruthy();
    expect(services.serviceService.createEntity).not.toHaveBeenCalled();
  });

  it('surfaces serviceService error as {success:false} without throwing', async () => {
    const services = makeMockServices({ createEntityResult: { success: false, errors: ['Storage write failed'] } });
    const input: CreateEntityInput = {
      packageName: 'product-service',
      name: 'Widget',
      attributes: [{ name: 'id', type: 'uuid' }],
    };
    const result = await executeCreateEntity(input, services);

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toContain('Storage write failed');
  });
});

// ===========================================================================
// executeUpdateEntity
// ===========================================================================

describe('executeUpdateEntity — success contract', () => {
  // Use valid UUIDs — validateEntity() checks RFC-4122 format.
  const existingEntityUuid = '550e8400-e29b-41d4-a716-446655440099';
  const attrAUuid = '550e8400-e29b-41d4-a716-4466554400a1';
  const attrBUuid = '550e8400-e29b-41d4-a716-4466554400b2';

  const existingEntity = makeEntity({
    uuid: existingEntityUuid,
    name: 'Product',
    createdAt: '2023-01-01T00:00:00.000Z',
    attributes: [
      { uuid: attrAUuid, name: 'id', type: AttributeType.UUID, description: 'PK', required: true },
      { uuid: attrBUuid, name: 'name', type: AttributeType.STRING, description: '', required: true },
    ] as any,
  });

  const input: UpdateEntityInput = {
    packageName: 'product-service',
    name: 'Product',
    description: 'Updated description',
    attributes: [
      { name: 'id', type: 'uuid', required: true },
      { name: 'name', type: 'string', required: true },
      { name: 'price', type: 'number' }, // new attribute
    ],
  };

  it('returns changeKind:updated and elementType:entity', async () => {
    const services = makeMockServices({ existingEntity });
    const result = await executeUpdateEntity(input, services);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.changeKind).toBe('updated');
    expect(result.elementType).toBe('entity');
    expect(result.name).toBe('Product');
    expect(result.packageName).toBe('product-service');
  });

  it('preserves the existing entity uuid (does not generate a new one)', async () => {
    const services = makeMockServices({ existingEntity });
    await executeUpdateEntity(input, services);

    const [, entityArg] = (services.serviceService.updateEntity as jest.Mock).mock.calls[0];
    expect(entityArg.uuid).toBe(existingEntityUuid);
  });

  it('carries over attribute uuids by name for unchanged attributes', async () => {
    const services = makeMockServices({ existingEntity });
    await executeUpdateEntity(input, services);

    const [, entityArg] = (services.serviceService.updateEntity as jest.Mock).mock.calls[0];
    const idAttr = entityArg.attributes.find((a: any) => a.name === 'id');
    expect(idAttr.uuid).toBe(attrAUuid); // preserved
  });

  it('returns {success:false} when entity does not exist, without calling updateEntity', async () => {
    const services = makeMockServices({ existingEntity: null });
    const result = await executeUpdateEntity(input, services);

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toMatch(/not found/i);
    expect(services.serviceService.updateEntity).not.toHaveBeenCalled();
  });

  it('summary reflects +1 attribute delta', async () => {
    // Existing has 2 attributes; input adds a 3rd.
    const services = makeMockServices({ existingEntity });
    const result = await executeUpdateEntity(input, services);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.summary).toMatch(/\+1 attribute/);
  });

  it('summary reflects unchanged attributes when count is the same', async () => {
    const sameCountInput: UpdateEntityInput = {
      ...input,
      attributes: [
        { name: 'id', type: 'uuid', required: true },
        { name: 'name', type: 'string', required: true },
      ],
    };
    const services = makeMockServices({ existingEntity });
    const result = await executeUpdateEntity(sameCountInput, services);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.summary).toMatch(/unchanged/);
  });
});

// ===========================================================================
// executeDeleteEntity
// ===========================================================================

describe('executeDeleteEntity — success contract', () => {
  const input: DeleteEntityInput = {
    packageName: 'product-service',
    name: 'Product',
  };

  it('returns changeKind:deleted and elementType:entity', async () => {
    const services = makeMockServices();
    const result = await executeDeleteEntity(input, services);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.changeKind).toBe('deleted');
    expect(result.elementType).toBe('entity');
    expect(result.name).toBe('Product');
    expect(result.packageName).toBe('product-service');
  });

  it('navigate points at the PACKAGE page (entity page no longer exists)', async () => {
    const services = makeMockServices();
    const result = await executeDeleteEntity(input, services);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.navigate).toBe('/packages/product-service');
    // No highlight on deletes (entity no longer exists in the page).
    expect((result as any).highlight).toBeUndefined();
  });

  it('returns {success:false} when serviceService signals a cascade-safety error', async () => {
    const services = makeMockServices({
      deleteEntityResult: {
        success: false,
        errors: ['Entity "Product" is referenced in 2 relationship(s)'],
      },
    });
    const result = await executeDeleteEntity(input, services);

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toMatch(/referenced in 2 relationship/i);
  });

  it('returns {success:false} and surfaces service error text without throwing', async () => {
    const services = makeMockServices({
      deleteEntityResult: { success: false, errors: ['not found'] },
    });
    const result = await executeDeleteEntity(input, services);

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toContain('not found');
  });
});

// ===========================================================================
// validateRelationshipMutation
// ===========================================================================

describe('validateRelationshipMutation — schema-level validation', () => {
  it('returns ok:true for a well-formed relationship', () => {
    // UUIDs must be RFC-4122 compliant — validateRelationship checks this.
    const rel = makeRelationship(UUID.entity2, UUID.entity3);
    const result = validateRelationshipMutation(rel as any);
    expect(result.ok).toBe(true);
  });

  it('returns ok:false if the relationship uuid is not a valid RFC-4122 UUID', () => {
    const rel = {
      uuid: 'not-a-real-uuid',
      description: '',
      source: { entity: UUID.entity2, cardinality: Cardinality.ONE },
      target: { entity: UUID.entity3, cardinality: Cardinality.MANY },
    };
    const result = validateRelationshipMutation(rel as any);
    // validateRelationship checks the uuid pattern
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeTruthy();
    }
  });
});

// ===========================================================================
// executeCreateRelationship
// ===========================================================================

describe('executeCreateRelationship — success contract', () => {
  const srcEntity = makeEntity({ uuid: UUID.entity2, name: 'Order' });
  const tgtEntity = makeEntity({ uuid: UUID.entity3, name: 'OrderItem' });

  const input: CreateRelationshipInput = {
    sourceEntityName: 'Order',
    targetEntityName: 'OrderItem',
    sourcePackage: 'order-service',
    targetPackage: 'order-service',
    sourceCardinality: 'one',
    targetCardinality: 'many',
    description: 'Order contains items',
  };

  it('returns elementType:relationship, changeKind:created, arrow-notation name', async () => {
    const services = makeMockServices({
      findAcrossResult: { entity: srcEntity as any, packageName: 'order-service' },
    });
    // findEntityAcrossPackages is called twice — once for src, once for tgt.
    (services.serviceService.findEntityAcrossPackages as jest.Mock)
      .mockResolvedValueOnce({ entity: srcEntity, packageName: 'order-service' })
      .mockResolvedValueOnce({ entity: tgtEntity, packageName: 'order-service' });

    const result = await executeCreateRelationship(input, services);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.elementType).toBe('relationship');
    expect(result.changeKind).toBe('created');
    expect(result.name).toBe('Order → OrderItem');
    expect(result.packageName).toBe('order-service');
  });

  it('summary includes cardinality notation', async () => {
    const services = makeMockServices();
    (services.serviceService.findEntityAcrossPackages as jest.Mock)
      .mockResolvedValueOnce({ entity: srcEntity, packageName: 'order-service' })
      .mockResolvedValueOnce({ entity: tgtEntity, packageName: 'order-service' });

    const result = await executeCreateRelationship(input, services);

    expect(result.success).toBe(true);
    if (!result.success) return;
    // one → many  ⇒  "1 → 0..*"
    expect(result.summary).toMatch(/1\s*→\s*0\.\.\*/);
  });

  it('returns {success:false} and does NOT call createRelationship when source entity not found', async () => {
    const services = makeMockServices();
    // findEntityAcrossPackages returns null for source
    (services.serviceService.findEntityAcrossPackages as jest.Mock).mockResolvedValue(null);

    const result = await executeCreateRelationship(input, services);

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toMatch(/source entity.*not found/i);
    expect(services.serviceService.createRelationship).not.toHaveBeenCalled();
  });

  it('returns {success:false} and does NOT call createRelationship when target entity not found', async () => {
    const services = makeMockServices();
    (services.serviceService.findEntityAcrossPackages as jest.Mock)
      .mockResolvedValueOnce({ entity: srcEntity, packageName: 'order-service' })
      .mockResolvedValueOnce(null); // target missing

    const result = await executeCreateRelationship(input, services);

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toMatch(/target entity.*not found/i);
    expect(services.serviceService.createRelationship).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// executeUpdateRelationship
// ===========================================================================

describe('executeUpdateRelationship — success contract', () => {
  const srcUuidU = '550e8400-e29b-41d4-a716-446655440031';
  const tgtUuidU = '550e8400-e29b-41d4-a716-446655440032';
  const srcEntity = makeEntity({ uuid: srcUuidU, name: 'Order' });
  const tgtEntity = makeEntity({ uuid: tgtUuidU, name: 'OrderItem' });

  const existingRel = makeRelationship(srcUuidU, tgtUuidU);

  const input: UpdateRelationshipInput = {
    sourceEntityName: 'Order',
    targetEntityName: 'OrderItem',
    sourcePackage: 'order-service',
    targetPackage: 'order-service',
    sourceCardinality: 'many',
    targetCardinality: 'many',
  };

  it('returns changeKind:updated, elementType:relationship, arrow name, summary with cardinality', async () => {
    const services = makeMockServices({ packageRelationships: [existingRel] });
    (services.serviceService.findEntityAcrossPackages as jest.Mock)
      .mockResolvedValueOnce({ entity: srcEntity, packageName: 'order-service' })
      .mockResolvedValueOnce({ entity: tgtEntity, packageName: 'order-service' });

    const result = await executeUpdateRelationship(input, services);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.changeKind).toBe('updated');
    expect(result.elementType).toBe('relationship');
    expect(result.name).toBe('Order → OrderItem');
    expect(result.summary).toMatch(/0\.\.\*\s*→\s*0\.\.\*/);
  });

  it('returns {success:false} when relationship not found in package', async () => {
    const services = makeMockServices({ packageRelationships: [] }); // no rels
    (services.serviceService.findEntityAcrossPackages as jest.Mock)
      .mockResolvedValueOnce({ entity: srcEntity, packageName: 'order-service' })
      .mockResolvedValueOnce({ entity: tgtEntity, packageName: 'order-service' });

    const result = await executeUpdateRelationship(input, services);

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toMatch(/no relationship.*found/i);
    expect(services.serviceService.updateRelationship).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// executeDeleteRelationship
// ===========================================================================

describe('executeDeleteRelationship — success contract', () => {
  const srcUuidD = '550e8400-e29b-41d4-a716-446655440041';
  const tgtUuidD = '550e8400-e29b-41d4-a716-446655440042';
  const srcEntity = makeEntity({ uuid: srcUuidD, name: 'Order' });
  const tgtEntity = makeEntity({ uuid: tgtUuidD, name: 'OrderItem' });

  const existingRel = makeRelationship(srcUuidD, tgtUuidD);

  const input: DeleteRelationshipInput = {
    packageName: 'order-service',
    sourceEntityName: 'Order',
    targetEntityName: 'OrderItem',
  };

  it('returns changeKind:deleted, elementType:relationship, arrow name, navigate to package', async () => {
    const services = makeMockServices({ packageRelationships: [existingRel] });
    (services.serviceService.findEntityAcrossPackages as jest.Mock)
      .mockResolvedValueOnce({ entity: srcEntity, packageName: 'order-service' })
      .mockResolvedValueOnce({ entity: tgtEntity, packageName: 'order-service' });

    const result = await executeDeleteRelationship(input, services);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.changeKind).toBe('deleted');
    expect(result.elementType).toBe('relationship');
    expect(result.name).toBe('Order → OrderItem');
    expect(result.navigate).toBe('/packages/order-service');
    expect(result.summary).toMatch(/Deleted relationship Order → OrderItem/);
  });

  it('returns {success:false} when relationship uuid not found', async () => {
    const services = makeMockServices({ packageRelationships: [] });
    (services.serviceService.findEntityAcrossPackages as jest.Mock)
      .mockResolvedValueOnce({ entity: srcEntity, packageName: 'order-service' })
      .mockResolvedValueOnce({ entity: tgtEntity, packageName: 'order-service' });

    const result = await executeDeleteRelationship(input, services);

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toMatch(/no relationship.*found/i);
    expect(services.serviceService.deleteRelationship).not.toHaveBeenCalled();
  });
});
