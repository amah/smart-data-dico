/**
 * Tests for schemaEntityView.ts — #165a
 *
 * Round-trip conversion between Entity (schema-entity) and Stereotype
 * (legacy view shape), plus corner cases.
 *
 * NOTE: Uses `as any` for MetadataDefinition.fields/items/enum since
 * this branch (arch/155-batch-pattern-b) predates #164 and has the
 * narrower MetadataDefinition type (no fields/items/enum). On main
 * (#164+) these cast are unnecessary.
 */
import {
  toLegacyStereotypeView,
  fromLegacyStereotypeView,
  definitionFromAttribute,
} from '../schemaEntityView.js';
import type { Entity, Attribute, Stereotype } from '../../models/EntitySchema.js';
import { AttributeType } from '../../models/EntitySchema.js';

jest.mock('../../utils/logger');

// ── Fixtures ──────────────────────────────────────────────────────────────────

const piiSchemaEntity: Entity = {
  uuid: 'a1b2c3d4-0000-1000-8000-000000000099',
  name: 'pii',
  description: 'Personally Identifiable Information',
  stereotype: 'metadata-schema',
  attributes: [
    {
      uuid: 'a1b2c3d4-0000-1000-8000-000000000010',
      name: 'pii-category',
      description: 'Category: direct, indirect, or sensitive',
      type: AttributeType.STRING,
      required: true,
    },
    {
      uuid: 'a1b2c3d4-0000-1000-8000-000000000011',
      name: 'retention-days',
      description: 'Data retention period in days',
      type: AttributeType.NUMBER,
      required: false,
    },
  ],
  metadata: [
    { name: 'appliesTo', value: 'attribute' },
    { name: 'domain', value: 'Privacy' },
  ],
};

// ── definitionFromAttribute ────────────────────────────────────────────────────

describe('definitionFromAttribute', () => {
  it('maps name, type, description, required', () => {
    const attr: Attribute = {
      uuid: 'aaaaaaaa-0000-1000-8000-000000000001',
      name: 'myField',
      description: 'A field',
      type: AttributeType.STRING,
      required: true,
    };
    const def = definitionFromAttribute(attr);
    expect(def.name).toBe('myField');
    expect(def.type).toBe('string');
    expect(def.description).toBe('A field');
    expect(def.required).toBe(true);
  });

  it('omits description and required when falsy', () => {
    const attr: Attribute = {
      uuid: 'aaaaaaaa-0000-1000-8000-000000000002',
      name: 'optional',
      description: '',
      type: AttributeType.NUMBER,
      required: false,
    };
    const def = definitionFromAttribute(attr);
    expect(def.description).toBeUndefined();
    expect(def.required).toBeUndefined();
  });

  it('maps properties to fields (recursive)', () => {
    const attr: Attribute = {
      uuid: 'aaaaaaaa-0000-1000-8000-000000000003',
      name: 'address',
      description: 'Address object',
      type: AttributeType.OBJECT,
      required: false,
      properties: [
        {
          uuid: 'aaaaaaaa-0000-1000-8000-000000000004',
          name: 'street',
          description: 'Street',
          type: AttributeType.STRING,
          required: true,
        },
      ],
    };
    const def = definitionFromAttribute(attr);
    expect((def as any).fields).toHaveLength(1);
    expect((def as any).fields[0].name).toBe('street');
    expect((def as any).fields[0].required).toBe(true);
  });

  it('maps items (recursive)', () => {
    const attr: Attribute = {
      uuid: 'aaaaaaaa-0000-1000-8000-000000000005',
      name: 'tags',
      description: 'Tags',
      type: AttributeType.ARRAY,
      required: false,
      items: {
        uuid: 'aaaaaaaa-0000-1000-8000-000000000006',
        name: 'tag',
        description: 'Tag value',
        type: AttributeType.STRING,
        required: false,
      },
    };
    const def = definitionFromAttribute(attr);
    expect((def as any).items).toBeDefined();
    expect((def as any).items.name).toBe('tag');
    expect((def as any).items.type).toBe('string');
  });

  it('maps validation.enumValues to def.enum', () => {
    const attr: Attribute = {
      uuid: 'aaaaaaaa-0000-1000-8000-000000000007',
      name: 'status',
      description: 'Status',
      type: AttributeType.ENUM,
      required: true,
      validation: { enumValues: ['active', 'inactive', 'pending'] },
    };
    const def = definitionFromAttribute(attr);
    expect((def as any).enum).toEqual(['active', 'inactive', 'pending']);
  });
});

// ── toLegacyStereotypeView ───────────────────────────────────────────────────

describe('toLegacyStereotypeView', () => {
  it('produces correct Stereotype from schema-entity', () => {
    const result = toLegacyStereotypeView(piiSchemaEntity);
    expect(result.id).toBe(piiSchemaEntity.uuid);
    expect(result.name).toBe('pii');
    expect((result as any).description).toBe('Personally Identifiable Information');
    expect(result.appliesTo).toBe('attribute');
    expect((result as any).domain).toBe('Privacy');
    expect(result.metadataDefinitions).toHaveLength(2);
    expect(result.metadataDefinitions[0].name).toBe('pii-category');
    expect(result.metadataDefinitions[0].required).toBe(true);
    expect(result.metadataDefinitions[1].name).toBe('retention-days');
  });

  it('defaults appliesTo to entity when metadata is absent', () => {
    const entity: Entity = {
      uuid: 'bbbbbbbb-0000-1000-8000-000000000001',
      name: 'simple',
      stereotype: 'metadata-schema',
      attributes: [],
    };
    const result = toLegacyStereotypeView(entity);
    expect(result.appliesTo).toBe('entity');
  });

  it('defaults appliesTo to entity when appliesTo metadata value is invalid', () => {
    const entity: Entity = {
      uuid: 'bbbbbbbb-0000-1000-8000-000000000002',
      name: 'badApplies',
      stereotype: 'metadata-schema',
      attributes: [],
      metadata: [{ name: 'appliesTo', value: 'bogus' }],
    };
    const result = toLegacyStereotypeView(entity);
    expect(result.appliesTo).toBe('entity');
  });

  it('omits description and domain when absent', () => {
    const entity: Entity = {
      uuid: 'bbbbbbbb-0000-1000-8000-000000000003',
      name: 'minimal',
      stereotype: 'metadata-schema',
      attributes: [],
    };
    const result = toLegacyStereotypeView(entity);
    expect((result as any).description).toBeUndefined();
    expect((result as any).domain).toBeUndefined();
  });

  it('silently drops constraints (criterion 8 — #85 governance)', () => {
    const entity: Entity = {
      uuid: 'bbbbbbbb-0000-1000-8000-000000000004',
      name: 'withConstraints',
      stereotype: 'metadata-schema',
      attributes: [],
      constraints: [{ kind: 'unique', columns: ['name'] }],
    };
    const result = toLegacyStereotypeView(entity);
    // Result has no constraint information — it's dropped
    expect((result as any).constraints).toBeUndefined();
    // metadataDefinitions is empty (no attrs), not synthesized from constraints
    expect(result.metadataDefinitions).toHaveLength(0);
  });
});

// ── fromLegacyStereotypeView ─────────────────────────────────────────────────

describe('fromLegacyStereotypeView', () => {
  it('produces a valid entity from a legacy stereotype', () => {
    const input: Stereotype = {
      id: 'a1b2c3d4-0000-1000-8000-000000000099',
      name: 'pii',
      appliesTo: 'attribute',
      metadataDefinitions: [
        { name: 'pii-category', type: 'string' as any, required: true },
        { name: 'retention-days', type: 'number' as any },
      ],
    } as any;
    const result = fromLegacyStereotypeView(input);
    expect(result.uuid).toBe(input.id); // valid UUID → reused
    expect(result.name).toBe('pii');
    expect(result.stereotype).toBe('metadata-schema');
    expect(result.attributes).toHaveLength(2);
    expect(result.attributes[0].name).toBe('pii-category');
    expect(result.attributes[0].required).toBe(true);
  });

  it('generates a new UUID when legacy id is not a valid UUID', () => {
    const legacyStereotype: Stereotype = {
      id: 'aggregate-root',
      name: 'Aggregate Root',
      appliesTo: 'entity',
      metadataDefinitions: [],
    };
    const result = fromLegacyStereotypeView(legacyStereotype);
    // uuid must be a valid UUID format (v4 generated)
    expect(result.uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(result.uuid).not.toBe('aggregate-root');
  });

  it('stores appliesTo as metadata entry', () => {
    const input: Stereotype = {
      id: 'a1b2c3d4-0000-1000-8000-000000000099',
      name: 'pii',
      appliesTo: 'attribute',
      metadataDefinitions: [],
    };
    const result = fromLegacyStereotypeView(input);
    const appliesTo = result.metadata?.find(m => m.name === 'appliesTo');
    expect(appliesTo?.value).toBe('attribute');
  });

  it('sets stereotype field to metadata-schema', () => {
    const input: Stereotype = {
      id: 'a1b2c3d4-0000-1000-8000-000000000099',
      name: 'pii',
      appliesTo: 'attribute',
      metadataDefinitions: [],
    };
    const result = fromLegacyStereotypeView(input);
    expect(result.stereotype).toBe('metadata-schema');
  });
});

// ── Round-trip ───────────────────────────────────────────────────────────────

describe('round-trip Entity → Stereotype → Entity', () => {
  it('schema-entity → toLegacyStereotypeView → fromLegacyStereotypeView preserves key fields', () => {
    const stereotype = toLegacyStereotypeView(piiSchemaEntity);
    const back = fromLegacyStereotypeView(stereotype);

    // UUID is reused since it was a valid UUID
    expect(back.uuid).toBe(piiSchemaEntity.uuid);
    expect(back.name).toBe(piiSchemaEntity.name);
    expect(back.stereotype).toBe('metadata-schema');
    expect(back.attributes).toHaveLength(piiSchemaEntity.attributes.length);
    expect(back.attributes[0].name).toBe(piiSchemaEntity.attributes[0].name);
  });

  it('Stereotype → fromLegacyStereotypeView → toLegacyStereotypeView is lossless for core fields', () => {
    const input: Stereotype = {
      id: 'a1b2c3d4-0000-1000-8000-000000000099',
      name: 'pii',
      appliesTo: 'attribute',
      metadataDefinitions: [
        { name: 'pii-category', type: 'string' as any, required: true },
      ],
    } as any;

    const entity = fromLegacyStereotypeView(input);
    const back = toLegacyStereotypeView(entity);

    expect(back.id).toBe(input.id);
    expect(back.name).toBe(input.name);
    expect(back.appliesTo).toBe(input.appliesTo);
    expect(back.metadataDefinitions).toHaveLength(input.metadataDefinitions.length);
    expect(back.metadataDefinitions[0].name).toBe(input.metadataDefinitions[0].name);
  });
});
