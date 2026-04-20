import { Entity, AttributeType, Attribute, Relationship, AttributeValidation } from '../models/EntitySchema.js';
import { listMicroserviceEntities, readEntityFile, readRelationshipsFile, getPackagePath } from '../utils/fileOperations.js';
import { listDerivedTypes, resolveAttributeType, DerivedType } from './dicoConfigService.js';
import { logger } from '../utils/logger.js';

const ATTR_TO_JSON_SCHEMA: Record<string, string> = {
  [AttributeType.STRING]: 'string',
  [AttributeType.NUMBER]: 'number',
  [AttributeType.INTEGER]: 'integer',
  [AttributeType.BOOLEAN]: 'boolean',
  [AttributeType.DATETIME]: 'string',
  [AttributeType.DATE]: 'string',
  [AttributeType.TIME]: 'string',
  [AttributeType.DATE_TIME]: 'string',
  [AttributeType.TIMESTAMP]: 'string',
  [AttributeType.DURATION]: 'string',
  [AttributeType.ENUM]: 'string',
  [AttributeType.OBJECT]: 'object',
  [AttributeType.ARRAY]: 'array',
};

class ExportService {
  async exportToJsonSchema(service: string): Promise<any> {
    const entityNames = await listMicroserviceEntities(service);
    const derivedTypes = await listDerivedTypes();
    const definitions: Record<string, any> = {};

    for (const rawName of entityNames) {
      const name = rawName.includes('_') ? rawName.split('_').slice(1).join('_') : rawName;
      const entity = await readEntityFile(service, name);
      if (!entity || !Array.isArray(entity.attributes)) continue;

      const properties: Record<string, any> = {};
      const required: string[] = [];

      for (const attr of entity.attributes) {
        properties[attr.name] = this.attributeToJsonSchema(attr, derivedTypes);
        if (attr.required) required.push(attr.name);
      }

      definitions[entity.name] = {
        type: 'object',
        description: entity.description || undefined,
        properties,
        ...(required.length > 0 ? { required } : {}),
      };
    }

    // Derived types expose as named $defs (#107). Attributes that declare
    // a derived type point at `#/$defs/<name>`, so consumers can dereference
    // once and apply validation to every attribute that uses the type.
    const $defs: Record<string, any> = {};
    for (const dt of derivedTypes) {
      $defs[dt.name] = this.derivedTypeToJsonSchema(dt, derivedTypes);
    }

    return {
      $schema: 'http://json-schema.org/draft-07/schema#',
      title: `${service} Data Dictionary`,
      ...(Object.keys($defs).length > 0 ? { $defs } : {}),
      definitions,
    };
  }

  private derivedTypeToJsonSchema(dt: DerivedType, all: DerivedType[]): any {
    const resolved = resolveAttributeType(dt.name, all);
    if (!resolved) return { description: dt.description };
    const schema: any = {
      type: ATTR_TO_JSON_SCHEMA[resolved.baseType] || 'string',
      description: dt.description || undefined,
    };
    this.applyValidationToSchema(schema, resolved.validation);
    return schema;
  }

  private attributeToJsonSchema(attr: Attribute, derivedTypes: DerivedType[] = []): any {
    // If the attribute declares a derived type, point at the $defs entry
    // and layer the attribute-level validation on top.
    if (!Object.values(AttributeType).includes(attr.type as AttributeType)) {
      const resolved = resolveAttributeType(attr.type, derivedTypes);
      if (resolved) {
        const schema: any = { $ref: `#/$defs/${attr.type}` };
        if (attr.description) schema.description = attr.description;
        this.applyValidationToSchema(schema, attr.validation);
        if (attr.defaultValue !== undefined) schema.default = attr.defaultValue;
        return schema;
      }
    }

    const schema: any = {
      type: ATTR_TO_JSON_SCHEMA[attr.type] || 'string',
      description: attr.description || undefined,
    };

    this.applyValidationToSchema(schema, attr.validation);

    if (attr.type === AttributeType.DATETIME || attr.type === AttributeType.DATE_TIME) {
      schema.format = 'date-time';
    } else if (attr.type === AttributeType.DATE) {
      schema.format = 'date';
    } else if (attr.type === AttributeType.TIME) {
      schema.format = 'time';
    }

    if (attr.defaultValue !== undefined) schema.default = attr.defaultValue;

    return schema;
  }

  private applyValidationToSchema(schema: any, v?: AttributeValidation): void {
    if (!v) return;
    if (v.minLength !== undefined) schema.minLength = v.minLength;
    if (v.maxLength !== undefined) schema.maxLength = v.maxLength;
    if (v.pattern) schema.pattern = v.pattern;
    if (v.minimum !== undefined) schema.minimum = v.minimum;
    if (v.maximum !== undefined) schema.maximum = v.maximum;
    if (v.enumValues) schema.enum = v.enumValues;
    if (v.format) schema.format = v.format;
  }

  async exportToMarkdown(service: string): Promise<string> {
    const entityNames = await listMicroserviceEntities(service);
    const entities: Entity[] = [];
    for (const rawName of entityNames) {
      const name = rawName.includes('_') ? rawName.split('_').slice(1).join('_') : rawName;
      const entity = await readEntityFile(service, name);
      if (entity) entities.push(entity);
    }

    let relationships: Relationship[] = [];
    try {
      relationships = await readRelationshipsFile(getPackagePath(service));
    } catch { /* ok */ }

    const lines: string[] = [];
    lines.push(`# ${service} Data Dictionary`);
    lines.push('');
    lines.push(`> Generated on ${new Date().toISOString().split('T')[0]}`);
    lines.push('');
    lines.push(`## Summary`);
    lines.push('');
    lines.push(`- **Entities**: ${entities.length}`);
    lines.push(`- **Relationships**: ${relationships.length}`);
    lines.push('');

    // Table of contents
    lines.push('## Entities');
    lines.push('');
    for (const entity of entities) {
      lines.push(`- [${entity.name}](#${entity.name.toLowerCase()})`);
    }
    lines.push('');

    // Entity details
    for (const entity of entities) {
      lines.push(`---`);
      lines.push('');
      lines.push(`### ${entity.name}`);
      lines.push('');
      if (entity.description) {
        lines.push(entity.description);
        lines.push('');
      }
      if (entity.stereotype) {
        lines.push(`**Stereotype**: ${entity.stereotype}`);
        lines.push('');
      }

      // Attributes table
      lines.push('| Attribute | Type | Required | Description |');
      lines.push('|-----------|------|----------|-------------|');
      for (const attr of entity.attributes) {
        const req = attr.required ? 'Yes' : 'No';
        const desc = (attr.description || '').replace(/\|/g, '\\|');
        const pk = attr.primaryKey ? ' (PK)' : '';
        lines.push(`| ${attr.name}${pk} | ${attr.type} | ${req} | ${desc} |`);
      }
      lines.push('');

      // Metadata
      if (entity.metadata && entity.metadata.length > 0) {
        lines.push('**Metadata**:');
        for (const m of entity.metadata) {
          lines.push(`- ${m.name}: ${m.value}`);
        }
        lines.push('');
      }
    }

    // Relationships
    if (relationships.length > 0) {
      lines.push('---');
      lines.push('');
      lines.push('## Relationships');
      lines.push('');
      lines.push('| Description | Source | Target | Cardinality |');
      lines.push('|-------------|--------|--------|-------------|');
      for (const rel of relationships) {
        const card = `${rel.source.cardinality}:${rel.target.cardinality}`;
        lines.push(`| ${rel.description || '-'} | ${rel.source.entity.slice(0, 8)}... | ${rel.target.entity.slice(0, 8)}... | ${card} |`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }
}

export const exportService = new ExportService();
