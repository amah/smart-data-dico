import { Entity, AttributeType, Attribute, Relationship } from '../models/EntitySchema.js';
import { listMicroserviceEntities, readEntityFile, readRelationshipsFile, getPackagePath } from '../utils/fileOperations.js';
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
    const definitions: Record<string, any> = {};

    for (const name of entityNames) {
      const entity = await readEntityFile(service, name);
      if (!entity) continue;

      const properties: Record<string, any> = {};
      const required: string[] = [];

      for (const attr of entity.attributes) {
        properties[attr.name] = this.attributeToJsonSchema(attr);
        if (attr.required) required.push(attr.name);
      }

      definitions[entity.name] = {
        type: 'object',
        description: entity.description || undefined,
        properties,
        ...(required.length > 0 ? { required } : {}),
      };
    }

    return {
      $schema: 'http://json-schema.org/draft-07/schema#',
      title: `${service} Data Dictionary`,
      definitions,
    };
  }

  private attributeToJsonSchema(attr: Attribute): any {
    const schema: any = {
      type: ATTR_TO_JSON_SCHEMA[attr.type] || 'string',
      description: attr.description || undefined,
    };

    if (attr.constraints) {
      if (attr.constraints.minLength !== undefined) schema.minLength = attr.constraints.minLength;
      if (attr.constraints.maxLength !== undefined) schema.maxLength = attr.constraints.maxLength;
      if (attr.constraints.pattern) schema.pattern = attr.constraints.pattern;
      if (attr.constraints.minimum !== undefined) schema.minimum = attr.constraints.minimum;
      if (attr.constraints.maximum !== undefined) schema.maximum = attr.constraints.maximum;
      if (attr.constraints.enumValues) {
        schema.enum = attr.constraints.enumValues;
      }
    }

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

  async exportToMarkdown(service: string): Promise<string> {
    const entityNames = await listMicroserviceEntities(service);
    const entities: Entity[] = [];
    for (const name of entityNames) {
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
