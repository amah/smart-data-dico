/**
 * schemaEntityView.165b.test.ts — #165b acceptance criteria
 *
 * Asserts the slug-vs-display-name extension to toLegacyStereotypeView
 * and fromLegacyStereotypeView introduced in #165b.
 *
 * Key invariants (#165b):
 *   - Stereotype.id === Entity.name (the slug, NOT uuid)
 *   - Stereotype.name === metadata['displayName'].value ?? Entity.name
 *   - fromLegacyStereotypeView sets entity.name = stereotype.id (the slug)
 *   - displayName metadata entry is created when stereotype.name !== stereotype.id
 */
import {
  toLegacyStereotypeView,
  fromLegacyStereotypeView,
} from '../schemaEntityView.js';
import type { Entity, Stereotype } from '../../models/EntitySchema.js';
import { AttributeType } from '../../models/EntitySchema.js';
import * as fs from 'fs';
import * as path from 'path';
import * as YAML from 'yaml';
import { parseSectionsFromString } from '../../utils/fileOperations.js';

jest.mock('../../utils/logger');

// ── Fixtures — mirrors actual migrated files ───────────────────────────────

const piiSchemaEntityWithDisplay: Entity = {
  uuid: 'eacafa0f-e2c6-481c-ae89-b64b353ef94c',
  name: 'pii',
  description: 'Personally Identifiable Information',
  stereotype: 'metadata-schema',
  attributes: [
    {
      uuid: '4de2568a-8b0d-428f-9760-655241030c60',
      name: 'pii-category',
      description: 'Category: direct, indirect, or sensitive',
      type: AttributeType.STRING,
      required: true,
    },
    {
      uuid: '17d38389-ce26-4c8c-b804-b332e4424749',
      name: 'retention-days',
      description: 'Data retention period in days',
      type: AttributeType.NUMBER,
      required: false,
    },
    {
      uuid: 'f749559a-095a-4b9b-b919-85e45894895e',
      name: 'encryption-required',
      description: 'Whether this field must be encrypted at rest',
      type: AttributeType.BOOLEAN,
      required: false,
    },
  ],
  metadata: [
    { name: 'appliesTo', value: 'attribute' },
    { name: 'domain', value: 'Privacy' },
    { name: 'displayName', value: 'PII' },
  ],
};

const aggregateRootEntity: Entity = {
  uuid: '7372efbf-3caf-4919-8344-b35fc235049e',
  name: 'aggregate-root',
  description: 'Root entity of an aggregate boundary',
  stereotype: 'metadata-schema',
  attributes: [
    {
      uuid: '98f16e02-8df1-4252-ac51-e8df1f1b55f6',
      name: 'bounded-context',
      description: 'Name of the bounded context this aggregate belongs to',
      type: AttributeType.STRING,
      required: true,
    },
  ],
  metadata: [
    { name: 'appliesTo', value: 'entity' },
    { name: 'domain', value: 'DDD' },
    { name: 'displayName', value: 'Aggregate Root' },
  ],
};

const eventEntity: Entity = {
  uuid: 'ca661443-bc03-4d0f-8650-b85d75516755',
  name: 'event',
  description: 'An event that represents something that happened in the domain',
  stereotype: 'metadata-schema',
  attributes: [],
  metadata: [
    { name: 'appliesTo', value: 'entity' },
    { name: 'domain', value: 'DDD' },
    { name: 'displayName', value: 'Domain Event' },
  ],
};

// Stereotype with slug=displayName (no displayName metadata needed)
const indexedEntity: Entity = {
  uuid: 'f5af1a72-a191-45d5-97f1-b814e8cf3c73',
  name: 'indexed',
  description: 'Database-indexed attribute',
  stereotype: 'metadata-schema',
  attributes: [],
  metadata: [
    { name: 'appliesTo', value: 'attribute' },
    { name: 'domain', value: 'Database' },
    // No displayName — 'indexed' is its own display name
  ],
};

// ── AC #5 — getStereotype('pii') shape ─────────────────────────────────────

describe('toLegacyStereotypeView — #165b slug-vs-display split', () => {
  it('AC#5: pii schema-entity → {id: "pii", name: "PII", domain: "Privacy", appliesTo: "attribute"}', () => {
    const result = toLegacyStereotypeView(piiSchemaEntityWithDisplay);
    expect(result.id).toBe('pii');
    expect(result.name).toBe('PII');
    expect((result as any).domain).toBe('Privacy');
    expect(result.appliesTo).toBe('attribute');
    expect(result.metadataDefinitions).toHaveLength(3);
    expect(result.metadataDefinitions[0].name).toBe('pii-category');
    expect(result.metadataDefinitions[0].required).toBe(true);
  });

  it('aggregate-root schema-entity → {id: "aggregate-root", name: "Aggregate Root"}', () => {
    const result = toLegacyStereotypeView(aggregateRootEntity);
    expect(result.id).toBe('aggregate-root');
    expect(result.name).toBe('Aggregate Root');
    expect((result as any).domain).toBe('DDD');
    expect(result.appliesTo).toBe('entity');
  });

  it('event schema-entity → {id: "event", name: "Domain Event"}', () => {
    const result = toLegacyStereotypeView(eventEntity);
    expect(result.id).toBe('event');
    expect(result.name).toBe('Domain Event');
  });

  it('indexed schema-entity (no displayName) → {id: "indexed", name: "indexed"} (falls back to slug)', () => {
    const result = toLegacyStereotypeView(indexedEntity);
    expect(result.id).toBe('indexed');
    expect(result.name).toBe('indexed');
  });

  it('entity uuid is NOT surfaced as Stereotype.id', () => {
    const result = toLegacyStereotypeView(piiSchemaEntityWithDisplay);
    expect(result.id).not.toBe(piiSchemaEntityWithDisplay.uuid);
    expect(result.id).toBe('pii');
  });
});

// ── fromLegacyStereotypeView — #165b symmetric mapping ─────────────────────

describe('fromLegacyStereotypeView — #165b slug-as-name', () => {
  it('sets entity.name = stereotype.id (the slug)', () => {
    const stereotype: Stereotype = {
      id: 'pii',
      name: 'PII',
      appliesTo: 'attribute',
      metadataDefinitions: [],
    };
    const entity = fromLegacyStereotypeView(stereotype);
    expect(entity.name).toBe('pii');
  });

  it('creates displayName metadata when name !== id', () => {
    const stereotype: Stereotype = {
      id: 'aggregate-root',
      name: 'Aggregate Root',
      appliesTo: 'entity',
      metadataDefinitions: [],
    };
    const entity = fromLegacyStereotypeView(stereotype);
    expect(entity.name).toBe('aggregate-root');
    const displayName = entity.metadata?.find(m => m.name === 'displayName');
    expect(displayName?.value).toBe('Aggregate Root');
  });

  it('does NOT create displayName metadata when name === id', () => {
    const stereotype: Stereotype = {
      id: 'indexed',
      name: 'indexed',
      appliesTo: 'attribute',
      metadataDefinitions: [],
    };
    const entity = fromLegacyStereotypeView(stereotype);
    expect(entity.name).toBe('indexed');
    const displayName = entity.metadata?.find(m => m.name === 'displayName');
    expect(displayName).toBeUndefined();
  });

  it('always generates a fresh UUID regardless of id format', () => {
    const slug: Stereotype = { id: 'pii', name: 'PII', appliesTo: 'attribute', metadataDefinitions: [] };
    const entityFromSlug = fromLegacyStereotypeView(slug);
    expect(entityFromSlug.uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(entityFromSlug.uuid).not.toBe('pii');
  });
});

// ── AC#8 — round-trip preserves slug identity ────────────────────────────

describe('round-trip AC#8 — slug identity preserved', () => {
  it('pii.entity.yaml round-trip: entity.name stays "pii", displayName stays "PII"', () => {
    const stereotype = toLegacyStereotypeView(piiSchemaEntityWithDisplay);
    const back = fromLegacyStereotypeView(stereotype);

    expect(back.name).toBe('pii');
    const displayName = back.metadata?.find(m => m.name === 'displayName');
    expect(displayName?.value).toBe('PII');
    expect(back.stereotype).toBe('metadata-schema');
  });

  it('aggregate-root round-trip: entity.name stays "aggregate-root"', () => {
    const stereotype = toLegacyStereotypeView(aggregateRootEntity);
    const back = fromLegacyStereotypeView(stereotype);

    expect(back.name).toBe('aggregate-root');
    const displayName = back.metadata?.find(m => m.name === 'displayName');
    expect(displayName?.value).toBe('Aggregate Root');
  });

  it('event round-trip: entity.name stays "event", displayName stays "Domain Event"', () => {
    const stereotype = toLegacyStereotypeView(eventEntity);
    const back = fromLegacyStereotypeView(stereotype);

    expect(back.name).toBe('event');
    const displayName = back.metadata?.find(m => m.name === 'displayName');
    expect(displayName?.value).toBe('Domain Event');
  });
});

// ── AC#2 — migrated YAML files parse correctly ───────────────────────────

describe('AC#2 — migrated schema-entity YAML files parse correctly', () => {
  const schemasDir = path.join(
    __dirname,
    '../../../../samples/eshop/.dico/schemas',
  );

  const expectedSlugs = [
    'aggregate-root',
    'value-object',
    'event',
    'reference-data',
    'pii',
    'indexed',
    'deprecated',
  ];

  it('each migrated file parses as multi-kind YAML with exactly one entity', () => {
    for (const slug of expectedSlugs) {
      const filePath = path.join(schemasDir, `${slug}.entity.yaml`);
      expect(fs.existsSync(filePath)).toBe(true);

      const raw = fs.readFileSync(filePath, 'utf8');
      const sections = parseSectionsFromString(raw, filePath, `${slug}.entity.yaml`);

      expect(sections.entities).toHaveLength(1);
      const entity = sections.entities[0];
      expect(entity.stereotype).toBe('metadata-schema');
      expect(entity.name).toBe(slug);
      expect(entity.uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
      expect(Array.isArray(entity.attributes)).toBe(true);
    }
  });

  it('each migrated entity view has correct slug-based id (AC#4 partial)', () => {
    for (const slug of expectedSlugs) {
      const filePath = path.join(schemasDir, `${slug}.entity.yaml`);
      const raw = fs.readFileSync(filePath, 'utf8');
      const sections = parseSectionsFromString(raw, filePath, `${slug}.entity.yaml`);
      const entity = sections.entities[0];

      const view = toLegacyStereotypeView(entity);
      expect(view.id).toBe(slug);
      expect(typeof view.name).toBe('string');
      expect(view.name.length).toBeGreaterThan(0);
    }
  });

  it('AC#3 — stereotypes.yaml is emptied to []', () => {
    const stereotypesFile = path.join(
      __dirname,
      '../../../../samples/eshop/.dico/stereotypes.yaml',
    );
    const content = fs.readFileSync(stereotypesFile, 'utf8');
    // Should parse as an empty array
    const parsed = YAML.parse(content);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(0);
  });

  it('AC#13 — no migrated schema-entity has constraints[]', () => {
    for (const slug of expectedSlugs) {
      const filePath = path.join(schemasDir, `${slug}.entity.yaml`);
      const raw = fs.readFileSync(filePath, 'utf8');
      const sections = parseSectionsFromString(raw, filePath, `${slug}.entity.yaml`);
      const entity = sections.entities[0];

      const view = toLegacyStereotypeView(entity);
      expect((view as any).constraints).toBeUndefined();
    }
  });
});

// ── AC#15 — HTTP API response shape ─────────────────────────────────────────

describe('AC#15 — Stereotype view shape', () => {
  const allowedKeys = new Set(['id', 'name', 'description', 'domain', 'appliesTo', 'metadataDefinitions']);

  it('pii view has only allowed keys', () => {
    const result = toLegacyStereotypeView(piiSchemaEntityWithDisplay);
    const keys = Object.keys(result);
    for (const key of keys) {
      expect(allowedKeys.has(key)).toBe(true);
    }
    expect(result.id).toBeDefined();
    expect(result.name).toBeDefined();
    expect(result.appliesTo).toBeDefined();
    expect(result.metadataDefinitions).toBeDefined();
  });
});
