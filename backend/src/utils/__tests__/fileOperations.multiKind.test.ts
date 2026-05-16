import { InMemoryStorageBackend } from '../../storage/memory/InMemoryStorageBackend.js';
import { storageRegistry } from '../../storage/contract/StorageBackendToken.js';
import { wsId } from '../../storage/contract/types.js';
import YAML from 'yaml';
import {
  writeEntityFile,
  writeEntityRules,
  writeRelationshipsFile,
  deleteEntityFile,
} from '../fileOperations.js';
import type { Entity, Relationship } from '../../models/EntitySchema.js';
import { EntityStatus, Cardinality } from '../../models/EntitySchema.js';

describe('fileOperations multi-kind preservation (#106)', () => {
  let backend: InMemoryStorageBackend;
  const WS = wsId('dictionaries');

  beforeEach(() => {
    storageRegistry.reset();
    backend = new InMemoryStorageBackend();
    storageRegistry.setBackend(backend);
  });

  it('writeEntityFile preserves co-located rules and relationships in the same YAML file', async () => {
    // Seed a multi-kind file containing one entity, one rule, one relationship
    const originalEntity: Entity = {
      uuid: 'a1b2c3d4-e5f6-4a7b-89ab-000000000001',
      name: 'Order',
      description: 'orig',
      status: EntityStatus.DRAFT,
      attributes: [],
    };
    const rule = {
      uuid: 'a1b2c3d4-e5f6-4a7b-89ab-000000000010',
      name: 'order-positive',
      severity: 'error',
      scope: 'entity',
      targets: [],
    };
    const rel = {
      uuid: 'a1b2c3d4-e5f6-4a7b-89ab-000000000011',
      source: { entity: 'a1b2c3d4-e5f6-4a7b-89ab-000000000001', cardinality: Cardinality.ONE },
      target: { entity: 'a1b2c3d4-e5f6-4a7b-89ab-000000000002', cardinality: Cardinality.MANY },
    };

    const initial = YAML.stringify({
      entities: [originalEntity],
      relationships: [rel],
      rules: [rule],
    });

    backend.files.set('dictionaries', new Map([
      ['order-service/package.yaml', YAML.stringify({ name: 'order-service' })],
      ['order-service/Order.model.yaml', initial],
    ]));

    // Write a modified entity — only description changes
    const result = await writeEntityFile({ ...originalEntity, description: 'updated' }, 'order-service');
    expect(result).toBe(true);

    // Read back the FILE and assert rules + relationships are untouched
    const after = await backend.read(WS, 'order-service/Order.model.yaml' as any);
    const parsed = YAML.parse(after);
    expect(parsed.entities).toHaveLength(1);
    expect(parsed.entities[0].description).toBe('updated');
    expect(parsed.relationships).toEqual([rel]);
    expect(parsed.rules).toEqual([rule]);
  });

  it('writeEntityRules does not disturb co-located relationships section', async () => {
    const entity: Entity = {
      uuid: 'a1b2c3d4-e5f6-4a7b-89ab-000000000020',
      name: 'Product',
      description: 'a product',
      status: EntityStatus.DRAFT,
      attributes: [],
    };
    const rel: Relationship = {
      uuid: 'a1b2c3d4-e5f6-4a7b-89ab-000000000021',
      source: { entity: 'a1b2c3d4-e5f6-4a7b-89ab-000000000020', cardinality: Cardinality.ONE },
      target: { entity: 'a1b2c3d4-e5f6-4a7b-89ab-000000000022', cardinality: Cardinality.MANY },
    };

    const initial = YAML.stringify({
      entities: [entity],
      relationships: [rel],
    });

    backend.files.set('dictionaries', new Map([
      ['catalog/package.yaml', YAML.stringify({ name: 'catalog' })],
      ['catalog/Product.model.yaml', initial],
    ]));

    const newRule = {
      uuid: 'rule-new',
      name: 'price-positive',
      severity: 'error',
      scope: 'entity',
      targets: [],
    };
    const result = await writeEntityRules('catalog', 'a1b2c3d4-e5f6-4a7b-89ab-000000000020', [newRule] as any);
    expect(result).toBe(true);

    // The relationships section must still be there
    const after = await backend.read(WS, 'catalog/Product.model.yaml' as any);
    const parsed = YAML.parse(after);
    expect(parsed.entities).toHaveLength(1);
    expect(parsed.entities[0].rules).toHaveLength(1);
    expect(parsed.entities[0].rules[0].uuid).toBe('rule-new');
    expect(parsed.relationships).toEqual([rel]);
  });

  it('writeRelationshipsFile does not disturb co-located entity in the consolidated target file', async () => {
    const entity: Entity = {
      uuid: 'a1b2c3d4-e5f6-4a7b-89ab-000000000030',
      name: 'Customer',
      description: 'a customer',
      status: EntityStatus.DRAFT,
      attributes: [],
    };
    const existingRel: Relationship = {
      uuid: 'a1b2c3d4-e5f6-4a7b-89ab-000000000031',
      source: { entity: 'a1b2c3d4-e5f6-4a7b-89ab-000000000030', cardinality: Cardinality.ONE },
      target: { entity: 'a1b2c3d4-e5f6-4a7b-89ab-000000000032', cardinality: Cardinality.MANY },
    };

    const initial = YAML.stringify({
      entities: [entity],
      relationships: [existingRel],
    });

    backend.files.set('dictionaries', new Map([
      ['crm/package.yaml', YAML.stringify({ name: 'crm' })],
      ['crm/Customer.model.yaml', initial],
    ]));

    const newRel: Relationship = {
      uuid: 'a1b2c3d4-e5f6-4a7b-89ab-000000000033',
      source: { entity: 'a1b2c3d4-e5f6-4a7b-89ab-000000000030', cardinality: Cardinality.ONE },
      target: { entity: 'a1b2c3d4-e5f6-4a7b-89ab-000000000034', cardinality: Cardinality.MANY },
    };
    // writeRelationshipsFile takes packagePath (which uses path.basename internally)
    const result = await writeRelationshipsFile('crm', [existingRel, newRel]);
    expect(result).toBe(true);

    // The entity must still be there in the consolidated file
    const after = await backend.read(WS, 'crm/Customer.model.yaml' as any);
    const parsed = YAML.parse(after);
    expect(parsed.entities).toHaveLength(1);
    expect(parsed.entities[0].uuid).toBe('a1b2c3d4-e5f6-4a7b-89ab-000000000030');
    expect(parsed.relationships).toHaveLength(2);
  });

  it('writeSectionsToStorage (via deleteEntityFile) deletes the file when all sections become empty', async () => {
    const entity: Entity = {
      uuid: 'a1b2c3d4-e5f6-4a7b-89ab-000000000040',
      name: 'Solo',
      description: 'sole entity in file',
      status: EntityStatus.DRAFT,
      attributes: [],
    };

    const initial = YAML.stringify({ entities: [entity] });

    backend.files.set('dictionaries', new Map([
      ['solo-service/package.yaml', YAML.stringify({ name: 'solo-service' })],
      ['solo-service/Solo.model.yaml', initial],
    ]));

    // Delete the sole entity — the file should be removed
    const result = await deleteEntityFile('solo-service', 'Solo');
    expect(result).toBe(true);

    // File should no longer exist
    const ws = backend.files.get('dictionaries');
    expect(ws?.has('solo-service/Solo.model.yaml')).toBe(false);
  });
});
