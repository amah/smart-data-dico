#!/usr/bin/env npx tsx
/**
 * Data migration script: transforms entity YAML files from old model to new model.
 *
 * Old model:
 * - Entity has: id, uuid, name, description, microservice, version, packageId,
 *   attributes (with flat constraints), relationships[]
 * - Relationships embedded in entities with RelationshipType enum
 *
 * New model:
 * - Entity has: uuid, name, description?, attributes (with constraints sub-object)
 * - Relationships stored in package-level relationships.yaml
 * - Attributes have primaryKey?, constraints? sub-object
 */
import fs from 'fs';
import path from 'path';
import YAML from 'yaml';
import { randomUUID } from 'crypto';

const DATA_DIR = path.join(process.cwd(), 'data-dictionaries');
const MICROSERVICES_DIR = path.join(DATA_DIR, 'microservices');

interface OldAttribute {
  uuid: string;
  name: string;
  description: string;
  type: string;
  required: boolean;
  unique?: boolean;
  defaultValue?: any;
  examples?: any[];
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  format?: string;
  minimum?: number;
  maximum?: number;
  precision?: number;
  scale?: number;
  enumValues?: string[];
  items?: any;
  properties?: Record<string, any>;
  metadata?: Record<string, any>;
}

interface OldRelationship {
  uuid: string;
  name: string;
  description: string;
  type: string; // hasOne, hasMany, belongsTo, manyToMany
  target: string; // "service.EntityName"
  inverseName?: string;
  required: boolean;
  foreignKey?: string;
  metadata?: Record<string, any>;
}

interface OldEntity {
  uuid: string;
  id?: string;
  name: string;
  description?: string;
  microservice?: string;
  version?: string;
  packageId?: string;
  attributes: OldAttribute[];
  relationships?: OldRelationship[];
  metadata?: Record<string, any> | any[];
  createdAt?: string;
  updatedAt?: string;
}

// --- Migration helpers ---

function migrateAttribute(attr: OldAttribute): any {
  const constraints: any = {};
  let hasConstraints = false;

  for (const key of ['minLength', 'maxLength', 'pattern', 'format', 'minimum', 'maximum', 'precision', 'scale', 'enumValues'] as const) {
    if (attr[key] !== undefined) {
      constraints[key] = attr[key];
      hasConstraints = true;
    }
  }

  // Determine primaryKey from metadata
  let primaryKey: boolean | undefined;
  const metadataEntries: any[] = [];

  if (attr.metadata && typeof attr.metadata === 'object' && !Array.isArray(attr.metadata)) {
    for (const [key, value] of Object.entries(attr.metadata)) {
      if (key === 'isPrimaryKey' && value === true) {
        primaryKey = true;
      } else {
        metadataEntries.push({ name: key, value });
      }
    }
  } else if (Array.isArray(attr.metadata)) {
    // Already migrated
    metadataEntries.push(...attr.metadata);
  }

  // Remove 'reference' type (no longer valid)
  let type = attr.type;
  if (type === 'reference' || type === 'relationship') {
    type = 'string';
  }

  const newAttr: any = {
    uuid: attr.uuid,
    name: attr.name,
    description: attr.description,
    type,
    required: attr.required,
  };

  if (attr.unique) newAttr.unique = attr.unique;
  if (primaryKey) newAttr.primaryKey = true;
  if (attr.defaultValue !== undefined) newAttr.defaultValue = attr.defaultValue;
  if (attr.examples && attr.examples.length > 0) newAttr.examples = attr.examples;
  if (hasConstraints) newAttr.constraints = constraints;
  if (attr.items) newAttr.items = attr.items;

  // Convert properties from Record<string, Attr> to Attribute[]
  if (attr.properties && typeof attr.properties === 'object' && !Array.isArray(attr.properties)) {
    newAttr.properties = Object.entries(attr.properties).map(([propName, propValue]: [string, any]) => ({
      ...migrateAttribute({ ...propValue, name: propValue.name || propName }),
    }));
  } else if (Array.isArray(attr.properties)) {
    newAttr.properties = attr.properties;
  }

  if (metadataEntries.length > 0) newAttr.metadata = metadataEntries;

  return newAttr;
}

function mapRelationshipTypeToCardinalities(type: string): { sourceCard: string; targetCard: string } {
  switch (type) {
    case 'hasOne':
      return { sourceCard: 'one', targetCard: 'one' };
    case 'hasMany':
      return { sourceCard: 'one', targetCard: 'many' };
    case 'belongsTo':
      return { sourceCard: 'many', targetCard: 'one' };
    case 'manyToMany':
      return { sourceCard: 'many', targetCard: 'many' };
    default:
      return { sourceCard: 'one', targetCard: 'many' };
  }
}

// --- Main migration ---

function main() {
  if (!fs.existsSync(MICROSERVICES_DIR)) {
    console.log('No microservices directory found. Nothing to migrate.');
    return;
  }

  const packages = fs.readdirSync(MICROSERVICES_DIR)
    .filter(item => fs.statSync(path.join(MICROSERVICES_DIR, item)).isDirectory());

  console.log(`Found ${packages.length} packages to migrate.`);

  // Step 1: Build UUID lookup map from all entities
  const entityLookup = new Map<string, string>(); // "service.EntityName" -> UUID
  const entityNameByUuid = new Map<string, string>(); // UUID -> entityName

  for (const pkg of packages) {
    const pkgDir = path.join(MICROSERVICES_DIR, pkg);
    const files = fs.readdirSync(pkgDir)
      .filter(f => (f.endsWith('.yaml') || f.endsWith('.yml')) && f !== 'metadata.yaml' && f !== 'relationships.yaml');

    for (const file of files) {
      try {
        const content = fs.readFileSync(path.join(pkgDir, file), 'utf8');
        const entity = YAML.parse(content) as OldEntity;
        if (entity.name && entity.uuid) {
          const key = `${entity.microservice || pkg}.${entity.name}`;
          entityLookup.set(key, entity.uuid);
          entityNameByUuid.set(entity.uuid, entity.name);
        }
      } catch (e) {
        console.warn(`  Skipping invalid file: ${file}`);
      }
    }
  }

  console.log(`Built lookup map with ${entityLookup.size} entities.`);

  // Step 2: Migrate each package
  for (const pkg of packages) {
    console.log(`\nMigrating package: ${pkg}`);
    const pkgDir = path.join(MICROSERVICES_DIR, pkg);
    const files = fs.readdirSync(pkgDir)
      .filter(f => (f.endsWith('.yaml') || f.endsWith('.yml')) && f !== 'metadata.yaml' && f !== 'relationships.yaml');

    const packageRelationships: any[] = [];
    const seenRelationshipPairs = new Set<string>();

    for (const file of files) {
      const filePath = path.join(pkgDir, file);
      try {
        const content = fs.readFileSync(filePath, 'utf8');
        const entity = YAML.parse(content) as OldEntity;

        console.log(`  Migrating entity: ${entity.name}`);

        // Extract relationships before removing them
        if (entity.relationships && entity.relationships.length > 0) {
          for (const rel of entity.relationships) {
            const { sourceCard, targetCard } = mapRelationshipTypeToCardinalities(rel.type);

            // Resolve target UUID
            let targetUuid = rel.target;
            if (entityLookup.has(rel.target)) {
              targetUuid = entityLookup.get(rel.target)!;
            }

            // Create a canonical pair key to deduplicate bidirectional relationships
            const pairKey = [entity.uuid, targetUuid].sort().join('::');
            if (seenRelationshipPairs.has(pairKey)) {
              continue; // Skip duplicate
            }
            seenRelationshipPairs.add(pairKey);

            const newRel: any = {
              uuid: rel.uuid || randomUUID(),
              source: {
                entity: entity.uuid,
                cardinality: sourceCard,
              },
              target: {
                entity: targetUuid,
                cardinality: targetCard,
              },
            };

            if (rel.description) newRel.description = rel.description;
            if (rel.inverseName) newRel.source.name = rel.inverseName;
            if (rel.name) newRel.target.name = rel.name;

            // Handle foreignKey
            if (rel.foreignKey) {
              if (rel.type === 'belongsTo' || rel.type === 'hasOne') {
                newRel.source.referenceAttributes = [rel.foreignKey];
              } else {
                newRel.target.referenceAttributes = [rel.foreignKey];
              }
            }

            packageRelationships.push(newRel);
          }
        }

        // Migrate entity: remove old fields, add new structure
        const newEntity: any = {
          uuid: entity.uuid,
          name: entity.name,
        };

        if (entity.description) newEntity.description = entity.description;

        // Migrate attributes
        newEntity.attributes = (entity.attributes || []).map(migrateAttribute);

        // Migrate entity-level metadata
        if (entity.metadata) {
          if (typeof entity.metadata === 'object' && !Array.isArray(entity.metadata)) {
            const entries = Object.entries(entity.metadata).map(([k, v]) => ({ name: k, value: v }));
            if (entries.length > 0) newEntity.metadata = entries;
          } else if (Array.isArray(entity.metadata)) {
            newEntity.metadata = entity.metadata;
          }
        }

        if (entity.createdAt) newEntity.createdAt = entity.createdAt;
        if (entity.updatedAt) newEntity.updatedAt = entity.updatedAt;

        // Write updated entity
        const yamlContent = YAML.stringify(newEntity);
        fs.writeFileSync(filePath, yamlContent, 'utf8');
        console.log(`    Written: ${file}`);
      } catch (e) {
        console.error(`    Error migrating ${file}:`, e);
      }
    }

    // Write package-level relationships.yaml
    if (packageRelationships.length > 0) {
      const relPath = path.join(pkgDir, 'relationships.yaml');
      const relContent = YAML.stringify(packageRelationships);
      fs.writeFileSync(relPath, relContent, 'utf8');
      console.log(`  Written relationships.yaml with ${packageRelationships.length} relationships`);
    }
  }

  console.log('\nMigration complete!');
}

main();
