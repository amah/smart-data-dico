import { Entity, Attribute, AttributeType, EntityStatus } from '../models/EntitySchema.js';
import { writeEntityFile } from '../utils/fileOperations.js';
import { generateUUID } from '../utils/uuid.js';
import { logger } from '../utils/logger.js';

const JSON_SCHEMA_TYPE_MAP: Record<string, AttributeType> = {
  string: AttributeType.STRING,
  number: AttributeType.NUMBER,
  integer: AttributeType.INTEGER,
  boolean: AttributeType.BOOLEAN,
  object: AttributeType.OBJECT,
  array: AttributeType.ARRAY,
};

const SQL_TYPE_MAP: Record<string, AttributeType> = {
  varchar: AttributeType.STRING,
  char: AttributeType.STRING,
  text: AttributeType.STRING,
  int: AttributeType.INTEGER,
  integer: AttributeType.INTEGER,
  bigint: AttributeType.INTEGER,
  smallint: AttributeType.INTEGER,
  decimal: AttributeType.NUMBER,
  numeric: AttributeType.NUMBER,
  float: AttributeType.NUMBER,
  double: AttributeType.NUMBER,
  real: AttributeType.NUMBER,
  boolean: AttributeType.BOOLEAN,
  bool: AttributeType.BOOLEAN,
  date: AttributeType.DATE,
  timestamp: AttributeType.TIMESTAMP,
  datetime: AttributeType.DATETIME,
  time: AttributeType.TIME,
  json: AttributeType.OBJECT,
  jsonb: AttributeType.OBJECT,
  uuid: AttributeType.STRING,
  serial: AttributeType.INTEGER,
  bigserial: AttributeType.INTEGER,
};

class ImportService {
  async importFromJsonSchema(schema: any, service: string): Promise<{ entities: Entity[]; errors: string[] }> {
    const entities: Entity[] = [];
    const errors: string[] = [];

    try {
      // Handle definitions/components/properties at root level
      const definitions = schema.definitions || schema.components?.schemas || schema.properties;

      if (!definitions || typeof definitions !== 'object') {
        return { entities: [], errors: ['No definitions found in JSON Schema'] };
      }

      for (const [name, def] of Object.entries(definitions)) {
        const schemaDef = def as any;
        if (schemaDef.type !== 'object' && !schemaDef.properties) continue;

        const requiredFields = new Set(schemaDef.required || []);
        const attributes: Attribute[] = [];

        for (const [propName, propDef] of Object.entries(schemaDef.properties || {})) {
          const prop = propDef as any;
          const attrType = JSON_SCHEMA_TYPE_MAP[prop.type] || AttributeType.STRING;

          const attr: Attribute = {
            uuid: generateUUID(),
            name: propName,
            description: prop.description || '',
            type: attrType,
            required: requiredFields.has(propName),
          };

          // Map constraints
          if (prop.minLength || prop.maxLength || prop.pattern || prop.minimum || prop.maximum || prop.enum) {
            attr.constraints = {};
            if (prop.minLength !== undefined) attr.constraints.minLength = prop.minLength;
            if (prop.maxLength !== undefined) attr.constraints.maxLength = prop.maxLength;
            if (prop.pattern) attr.constraints.pattern = prop.pattern;
            if (prop.minimum !== undefined) attr.constraints.minimum = prop.minimum;
            if (prop.maximum !== undefined) attr.constraints.maximum = prop.maximum;
            if (prop.enum) {
              attr.type = AttributeType.ENUM;
              attr.constraints.enumValues = prop.enum;
            }
          }

          attributes.push(attr);
        }

        const entity: Entity = {
          uuid: generateUUID(),
          name,
          description: schemaDef.description || '',
          status: EntityStatus.DRAFT,
          attributes,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        const ok = await writeEntityFile(entity, service);
        if (ok) {
          entities.push(entity);
        } else {
          errors.push(`Failed to write entity: ${name}`);
        }
      }
    } catch (error: any) {
      errors.push(`Import error: ${error.message}`);
    }

    return { entities, errors };
  }

  async importFromSqlDdl(sql: string, service: string): Promise<{ entities: Entity[]; errors: string[] }> {
    const entities: Entity[] = [];
    const errors: string[] = [];

    try {
      // Simple SQL DDL parser — handles CREATE TABLE statements
      const tableRegex = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:`|")?(\w+)(?:`|")?\s*\(([\s\S]*?)\);/gi;
      let match;

      while ((match = tableRegex.exec(sql)) !== null) {
        const tableName = match[1];
        const columnsBlock = match[2];
        const attributes: Attribute[] = [];
        const primaryKeys = new Set<string>();

        // Extract PRIMARY KEY constraint
        const pkMatch = columnsBlock.match(/PRIMARY\s+KEY\s*\(([^)]+)\)/i);
        if (pkMatch) {
          pkMatch[1].split(',').forEach(k => primaryKeys.add(k.trim().replace(/[`"]/g, '')));
        }

        // Parse columns
        const lines = columnsBlock.split(',').map(l => l.trim()).filter(Boolean);
        for (const line of lines) {
          // Skip constraint lines
          if (/^\s*(PRIMARY|FOREIGN|UNIQUE|CHECK|CONSTRAINT|INDEX|KEY)/i.test(line)) continue;

          const colMatch = line.match(/^(?:`|")?(\w+)(?:`|")?\s+(\w+)(?:\(([^)]*)\))?(.*)/i);
          if (!colMatch) continue;

          const [, colName, sqlType, typeParams, rest] = colMatch;
          const normalizedType = sqlType.toLowerCase();
          const attrType = SQL_TYPE_MAP[normalizedType] || AttributeType.STRING;
          const isNotNull = /NOT\s+NULL/i.test(rest);
          const isPK = primaryKeys.has(colName) || /PRIMARY\s+KEY/i.test(rest);

          const attr: Attribute = {
            uuid: generateUUID(),
            name: colName,
            description: '',
            type: attrType,
            required: isNotNull || isPK,
            primaryKey: isPK || undefined,
          };

          // Map type params to constraints
          if (typeParams) {
            attr.constraints = {};
            const params = typeParams.split(',').map(p => parseInt(p.trim()));
            if (normalizedType === 'varchar' || normalizedType === 'char') {
              attr.constraints.maxLength = params[0];
            } else if (normalizedType === 'decimal' || normalizedType === 'numeric') {
              attr.constraints.precision = params[0];
              if (params[1] !== undefined) attr.constraints.scale = params[1];
            }
          }

          attributes.push(attr);
        }

        if (attributes.length === 0) continue;

        // Convert table name to PascalCase entity name
        const entityName = tableName.replace(/(^|_)(\w)/g, (_, __, c) => c.toUpperCase());

        const entity: Entity = {
          uuid: generateUUID(),
          name: entityName,
          description: `Imported from SQL table: ${tableName}`,
          status: EntityStatus.DRAFT,
          attributes,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        const ok = await writeEntityFile(entity, service);
        if (ok) {
          entities.push(entity);
        } else {
          errors.push(`Failed to write entity: ${entityName}`);
        }
      }

      if (entities.length === 0 && errors.length === 0) {
        errors.push('No CREATE TABLE statements found in the SQL');
      }
    } catch (error: any) {
      errors.push(`SQL import error: ${error.message}`);
    }

    return { entities, errors };
  }
}

export const importService = new ImportService();
