import { Entity, Attribute, AttributeType, EntityStatus, MetadataEntry, PhysicalConstraint, Relationship, Cardinality, ReferentialAction } from '../models/EntitySchema.js';
import { writeEntityFile } from '../utils/fileOperations.js';
import { generateUUID } from '../utils/uuid.js';
import { logger } from '../utils/logger.js';

/**
 * Options controlling how SQL DDL is parsed into the logical model (#69 C1).
 */
export interface ParseSqlDdlOptions {
  /**
   * Prefixes to strip from table / column names before case conversion.
   * E.g. ['tbl_', 'mv_'] turns `tbl_orders` → `orders` → `Orders`.
   */
  stripPrefixes?: string[];
  /**
   * Suffixes to strip from table / column names before case conversion.
   * E.g. ['_v2', '_old'] turns `orders_v2` → `orders` → `Orders`.
   */
  stripSuffixes?: string[];
  /** Optional schema name recorded as `physical.schema` metadata on each entity. */
  schema?: string;
}

/** Result of parsing a SQL DDL string. No disk side effects. */
export interface ParseSqlDdlResult {
  entities: Entity[];
  /** Relationships inferred from FK constraints (#82). */
  relationships?: Relationship[];
  errors: string[];
}

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
  uuid: AttributeType.UUID,
  uniqueidentifier: AttributeType.UUID,
  serial: AttributeType.INTEGER,
  bigserial: AttributeType.INTEGER,
};

/**
 * Strip configured prefixes / suffixes from a SQL identifier and return the
 * residue. The first match wins on each list. Used by name derivation (#69 C1).
 *
 * Exported so other importers (Oracle DB introspection in #69 C3, future
 * Postgres/MySQL in #82) can derive display names with the same rules.
 */
export function stripAffixes(name: string, prefixes: string[] = [], suffixes: string[] = []): string {
  let out = name;
  for (const prefix of prefixes) {
    if (prefix && out.toLowerCase().startsWith(prefix.toLowerCase())) {
      out = out.slice(prefix.length);
      break;
    }
  }
  for (const suffix of suffixes) {
    if (suffix && out.toLowerCase().endsWith(suffix.toLowerCase())) {
      out = out.slice(0, out.length - suffix.length);
      break;
    }
  }
  return out;
}

/** snake_case / kebab-case / mixed → PascalCase. Used for entity names. */
export function toPascalCase(name: string): string {
  return name
    .replace(/[_\-\s]+(\w)/g, (_, c) => c.toUpperCase())
    .replace(/^(\w)/, (_, c) => c.toUpperCase());
}

/** snake_case / kebab-case / mixed → camelCase. Used for attribute names. */
export function toCamelCase(name: string): string {
  const pascal = toPascalCase(name);
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}

/**
 * Map a normalised database type token (lowercased, no parens) to the
 * logical AttributeType. Shared across SQL DDL parsing and DB introspection
 * so the same type rules apply everywhere.
 */
export function mapSqlTypeToAttributeType(normalizedType: string): AttributeType {
  return SQL_TYPE_MAP[normalizedType] || AttributeType.STRING;
}

/**
 * Strip surrounding `backticks` / "double quotes" from a SQL identifier
 * and trim whitespace. Used wherever the parser pulls a column or table
 * name out of a regex capture group.
 */
function unquoteIdent(s: string): string {
  return s.trim().replace(/^[`"]|[`"]$/g, '');
}

/**
 * Split a parenthesised column list like `(id, customer_id)` into
 * individual identifiers, ignoring quoting. Used by the constraint
 * extractor for UNIQUE / FOREIGN KEY column lists.
 */
function splitColumnList(inside: string): string[] {
  return inside.split(',').map(c => unquoteIdent(c)).filter(Boolean);
}

/**
 * Read the parenthesised body that immediately follows the keyword token
 * starting at `start` in `text`. Tracks paren depth so a CHECK clause like
 * `CHECK (col >= 0 AND col <= 100)` is captured intact.
 *
 * Returns the inner text (without the surrounding parens) plus the index
 * just past the closing paren, or null if no balanced parens are found.
 */
function readParenBody(text: string, start: number): { body: string; end: number } | null {
  let i = start;
  while (i < text.length && text[i] !== '(') i++;
  if (i >= text.length) return null;
  let depth = 0;
  const bodyStart = i + 1;
  for (; i < text.length; i++) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')') {
      depth--;
      if (depth === 0) return { body: text.slice(bodyStart, i), end: i + 1 };
    }
  }
  return null;
}

/**
 * Extract physical constraints from a single column-block line (#85 R3).
 *
 * Handles two layouts:
 *
 *  1. **Table-level** lines that start with an optional `CONSTRAINT name`
 *     prefix followed by UNIQUE / CHECK / FOREIGN KEY:
 *
 *       CONSTRAINT uq_orders_number UNIQUE (order_number)
 *       CHECK (total >= 0)
 *       FOREIGN KEY (customer_id) REFERENCES customers(id)
 *
 *  2. **Column-level** clauses appended to a column definition:
 *
 *       customer_id VARCHAR(36) NOT NULL REFERENCES customers(id)
 *       order_number VARCHAR(20) UNIQUE
 *
 * The `columnContext` argument carries the column name when the line is
 * a column definition — used to attach a column-level UNIQUE or REFERENCES
 * to the right column. Pass undefined for table-level lines.
 *
 * Skips PRIMARY KEY (handled separately by the existing primary-key path)
 * and bare KEY/INDEX clauses (which are MySQL syntactic sugar for indexes
 * and don't carry integrity guarantees the schema diff cares about).
 */
/** Parse ON DELETE / ON UPDATE referential actions from trailing FK text (#73). */
function parseReferentialActions(text: string): { onDelete?: ReferentialAction; onUpdate?: ReferentialAction } {
  const result: { onDelete?: ReferentialAction; onUpdate?: ReferentialAction } = {};
  const actionPattern = /ON\s+(DELETE|UPDATE)\s+(CASCADE|SET\s+NULL|SET\s+DEFAULT|RESTRICT|NO\s+ACTION)/gi;
  let m;
  while ((m = actionPattern.exec(text)) !== null) {
    const trigger = m[1].toUpperCase() as 'DELETE' | 'UPDATE';
    const action = m[2].toUpperCase().replace(/\s+/g, ' ') as ReferentialAction;
    if (trigger === 'DELETE') result.onDelete = action;
    else result.onUpdate = action;
  }
  return result;
}

function extractConstraintsFromLine(
  line: string,
  columnContext: string | undefined,
): PhysicalConstraint[] {
  const out: PhysicalConstraint[] = [];

  // ─── Table-level: optional `CONSTRAINT name` prefix ──────────────────
  const tableLevel = line.match(/^\s*(?:CONSTRAINT\s+(?:`|")?(\w+)(?:`|")?\s+)?(UNIQUE|CHECK|FOREIGN\s+KEY)\b/i);
  if (tableLevel && !columnContext) {
    const constraintName = tableLevel[1];
    const kw = tableLevel[2].toUpperCase().replace(/\s+/g, ' ');
    const afterKeyword = line.slice(tableLevel.index! + tableLevel[0].length);

    if (kw === 'UNIQUE') {
      const body = readParenBody(afterKeyword, 0);
      if (body) {
        out.push({
          kind: 'unique',
          ...(constraintName ? { name: constraintName } : {}),
          columns: splitColumnList(body.body),
        });
      }
    } else if (kw === 'CHECK') {
      const body = readParenBody(afterKeyword, 0);
      if (body) {
        out.push({
          kind: 'check',
          ...(constraintName ? { name: constraintName } : {}),
          expression: body.body.trim(),
        });
      }
    } else if (kw === 'FOREIGN KEY') {
      const cols = readParenBody(afterKeyword, 0);
      if (cols) {
        const tail = afterKeyword.slice(cols.end);
        const refMatch = tail.match(/REFERENCES\s+(?:`|")?(\w+)(?:`|")?/i);
        if (refMatch) {
          const refTail = tail.slice(refMatch.index! + refMatch[0].length);
          const refCols = readParenBody(refTail, 0);
          if (refCols) {
            const afterRefCols = tail.slice(refMatch.index! + refMatch[0].length + (refCols.end));
            const actions = parseReferentialActions(afterRefCols);
            out.push({
              kind: 'foreignKey',
              ...(constraintName ? { name: constraintName } : {}),
              columns: splitColumnList(cols.body),
              references: {
                table: refMatch[1],
                columns: splitColumnList(refCols.body),
                ...(actions.onDelete ? { onDelete: actions.onDelete } : {}),
                ...(actions.onUpdate ? { onUpdate: actions.onUpdate } : {}),
              },
            });
          }
        }
      }
    }
    return out;
  }

  // ─── Column-level inline clauses ─────────────────────────────────────
  if (columnContext) {
    // UNIQUE keyword (must not be preceded by NOT — `NOT UNIQUE` is non-standard
    // but keeps us safe). Match `\bUNIQUE\b` not followed by `(` (which would be
    // a table-level UNIQUE on a constraint-line confused as a column).
    if (/\bUNIQUE\b(?!\s*\()/i.test(line)) {
      out.push({ kind: 'unique', columns: [columnContext] });
    }
    // Inline REFERENCES table(col) — single referencing column = the current one.
    const refMatch = line.match(/REFERENCES\s+(?:`|")?(\w+)(?:`|")?\s*\(\s*((?:[`"]?\w+[`"]?\s*,?\s*)+)\)/i);
    if (refMatch) {
      const afterRef = line.slice(refMatch.index! + refMatch[0].length);
      const actions = parseReferentialActions(afterRef);
      out.push({
        kind: 'foreignKey',
        columns: [columnContext],
        references: {
          table: refMatch[1],
          columns: splitColumnList(refMatch[2]),
          ...(actions.onDelete ? { onDelete: actions.onDelete } : {}),
          ...(actions.onUpdate ? { onUpdate: actions.onUpdate } : {}),
        },
      });
    }
    // Inline CHECK (expression) — paren-balanced
    const checkIdx = line.search(/\bCHECK\s*\(/i);
    if (checkIdx >= 0) {
      const body = readParenBody(line, checkIdx);
      if (body) {
        out.push({ kind: 'check', expression: body.body.trim() });
      }
    }
  }

  return out;
}

// ────────────────────────────────────────────────────────────────────────
// Auto-generation strategy detection (#73)
// ────────────────────────────────────────────────────────────────────────

/**
 * Detect the value-generation strategy for a column from its SQL type and
 * trailing definition text. Returns the strategy string or empty string.
 *
 * Recognised patterns:
 *   - Postgres SERIAL / BIGSERIAL / SMALLSERIAL → 'identity'
 *   - Postgres 10+ GENERATED {ALWAYS|BY DEFAULT} AS IDENTITY → 'identity'
 *   - MySQL AUTO_INCREMENT → 'identity'
 *   - MSSQL IDENTITY / IDENTITY(seed, increment) → 'identity'
 *   - Column type contains 'uuid' + DEFAULT gen_random_uuid()/uuid_generate_v4()/UUID() → 'uuid'
 */
function detectGeneratedStrategy(normalizedType: string, rest: string): string {
  // SERIAL types (Postgres shorthand for integer + auto-increment sequence)
  if (normalizedType === 'serial' || normalizedType === 'bigserial' || normalizedType === 'smallserial') {
    return 'identity';
  }
  // GENERATED {ALWAYS | BY DEFAULT} AS IDENTITY (SQL standard / Postgres 10+)
  if (/GENERATED\s+(?:ALWAYS|BY\s+DEFAULT)\s+AS\s+IDENTITY/i.test(rest)) {
    return 'identity';
  }
  // MySQL AUTO_INCREMENT
  if (/AUTO_INCREMENT/i.test(rest)) {
    return 'identity';
  }
  // MSSQL IDENTITY or IDENTITY(seed, increment)
  if (/\bIDENTITY\b(?:\s*\(\s*\d+\s*,\s*\d+\s*\))?/i.test(rest)) {
    return 'identity';
  }
  // UUID default generation (various dialects)
  if (normalizedType === 'uuid' || normalizedType === 'uniqueidentifier') {
    if (/DEFAULT\s+(?:gen_random_uuid|uuid_generate_v4|newid|UUID)\s*\(\s*\)/i.test(rest)) {
      return 'uuid';
    }
  }
  return '';
}

// ────────────────────────────────────────────────────────────────────────
// SQL COMMENT extraction helpers (#83)
// ────────────────────────────────────────────────────────────────────────

/**
 * Extract `COMMENT ON TABLE <table> IS '<text>'` statements.
 * Returns a map from lowercased table name → comment text.
 */
function extractTableComments(sql: string): Map<string, string> {
  const map = new Map<string, string>();
  const regex = /COMMENT\s+ON\s+TABLE\s+(?:(?:`|")?(\w+)(?:`|")?\.)?(?:`|")?(\w+)(?:`|")?\s+IS\s+'((?:[^']|'')*)'/gi;
  let m;
  while ((m = regex.exec(sql)) !== null) {
    const tableName = m[2].toLowerCase();
    const text = m[3].replace(/''/g, "'");
    map.set(tableName, text);
  }
  return map;
}

/**
 * Extract `COMMENT ON COLUMN <table>.<column> IS '<text>'` statements.
 * Returns a map from "table.column" (both lowercased) → comment text.
 */
function extractColumnComments(sql: string): Map<string, string> {
  const map = new Map<string, string>();
  const regex = /COMMENT\s+ON\s+COLUMN\s+(?:(?:`|")?(\w+)(?:`|")?\.)?(?:`|")?(\w+)(?:`|")?\.(?:`|")?(\w+)(?:`|")?\s+IS\s+'((?:[^']|'')*)'/gi;
  let m;
  while ((m = regex.exec(sql)) !== null) {
    const tableName = m[2].toLowerCase();
    const colName = m[3].toLowerCase();
    const text = m[4].replace(/''/g, "'");
    map.set(`${tableName}.${colName}`, text);
  }
  return map;
}

/**
 * Extract MySQL inline `COMMENT 'text'` from a column definition's trailing text.
 * Returns the comment string, or empty string if none found.
 */
function extractMysqlInlineComment(rest: string): string {
  const m = rest.match(/\bCOMMENT\s+'((?:[^']|'')*)'(?:\s|,|$)/i);
  if (!m) return '';
  return m[1].replace(/''/g, "'");
}

// ────────────────────────────────────────────────────────────────────────
// FK → Relationship extraction (second pass, #82)
// ────────────────────────────────────────────────────────────────────────

/**
 * Build relationships from foreignKey constraints on the parsed entities.
 *
 * Two-pass approach: entities are already fully built (first pass), so we
 * can resolve target entity UUIDs by matching the FK's `references.table`
 * against `physical.tableName` metadata. FK columns on the source side are
 * recorded as `referenceAttributes` so the data lineage is fully traceable.
 *
 * Cardinality inference:
 *   - Source side (table with the FK column): MANY by default.
 *     Exception: if the FK column has a UNIQUE constraint or is a PK, source = ONE.
 *   - Target side (referenced table): always ONE.
 *
 * Cross-schema FKs (target table not in the parsed set) are logged as
 * warnings in the errors array and skipped.
 */
export function buildRelationshipsFromForeignKeys(
  entities: Entity[],
  errors: string[],
): Relationship[] {
  // Build lookup: raw table name (lowercased) → entity
  const entityByTable = new Map<string, Entity>();
  for (const e of entities) {
    const tableName = (e.metadata || []).find(m => m.name === 'physical.tableName')?.value;
    if (typeof tableName === 'string') {
      entityByTable.set(tableName.toLowerCase(), e);
    }
  }

  const relationships: Relationship[] = [];

  for (const entity of entities) {
    const fks = (entity.constraints || []).filter(c => c.kind === 'foreignKey');
    if (fks.length === 0) continue;

    // Build a set of columns that have a UNIQUE constraint or are PKs
    const uniqueColumns = new Set<string>();
    for (const attr of entity.attributes) {
      if (attr.primaryKey) {
        const colName = (attr.metadata || []).find(m => m.name === 'physical.columnName')?.value;
        if (typeof colName === 'string') uniqueColumns.add(colName.toLowerCase());
      }
    }
    for (const c of entity.constraints || []) {
      if (c.kind === 'unique' && c.columns?.length === 1) {
        uniqueColumns.add(c.columns[0].toLowerCase());
      }
    }

    for (const fk of fks) {
      if (!fk.references) continue;
      const targetTable = fk.references.table.toLowerCase();
      const targetEntity = entityByTable.get(targetTable);

      if (!targetEntity) {
        errors.push(`FK constraint${fk.name ? ` '${fk.name}'` : ''} on table '${(entity.metadata || []).find(m => m.name === 'physical.tableName')?.value}' references table '${fk.references.table}' which is not in the parsed set — skipped`);
        continue;
      }

      // Cardinality: if FK column(s) are all unique/PK → ONE, otherwise MANY
      const fkCols = (fk.columns || []).map(c => c.toLowerCase());
      const isOneToOne = fkCols.length > 0 && fkCols.every(c => uniqueColumns.has(c));

      // Check if FK columns are all NOT NULL → mandatory relationship
      const fkColsNotNull = fkCols.every(col => {
        const attr = entity.attributes.find(a =>
          (a.metadata || []).find(m => m.name === 'physical.columnName')?.value?.toString().toLowerCase() === col
        );
        return attr?.required === true;
      });

      // Map FK column names to logical attribute names for referenceAttributes
      const refAttrNames = fkCols.map(col => {
        const attr = entity.attributes.find(a =>
          (a.metadata || []).find(m => m.name === 'physical.columnName')?.value?.toString().toLowerCase() === col
        );
        return attr?.name || col;
      });

      const relMetadata: MetadataEntry[] = [];
      if (fk.name) {
        relMetadata.push({ name: 'physical.constraintName', value: fk.name });
      }

      const rel: Relationship = {
        uuid: generateUUID(),
        description: fk.name
          ? `Imported from FK constraint '${fk.name}'`
          : `Imported FK: ${(entity.metadata || []).find(m => m.name === 'physical.tableName')?.value}(${(fk.columns || []).join(', ')}) → ${fk.references.table}(${fk.references.columns.join(', ')})`,
        type: 'structural',
        source: {
          entity: entity.uuid,
          cardinality: isOneToOne ? Cardinality.ONE : Cardinality.MANY,
          referenceAttributes: refAttrNames,
        },
        target: {
          entity: targetEntity.uuid,
          cardinality: Cardinality.ONE,
        },
        ...(relMetadata.length > 0 ? { metadata: relMetadata } : {}),
      };

      relationships.push(rel);
    }
  }

  return relationships;
}

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

          // Map validation fields (#85)
          if (prop.minLength || prop.maxLength || prop.pattern || prop.minimum || prop.maximum || prop.enum) {
            attr.validation = {};
            if (prop.minLength !== undefined) attr.validation.minLength = prop.minLength;
            if (prop.maxLength !== undefined) attr.validation.maxLength = prop.maxLength;
            if (prop.pattern) attr.validation.pattern = prop.pattern;
            if (prop.minimum !== undefined) attr.validation.minimum = prop.minimum;
            if (prop.maximum !== undefined) attr.validation.maximum = prop.maximum;
            if (prop.enum) {
              attr.type = AttributeType.ENUM;
              attr.validation.enumValues = prop.enum;
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

  /**
   * Parse SQL DDL into in-memory entities (#69 C1). No disk writes.
   *
   * Emits JPA-style physical metadata on each entity and attribute:
   *   entity.metadata: [{ name: 'physical.tableName', value: <raw table name> }, ...]
   *   attr.metadata:   [{ name: 'physical.columnName', value: <raw column name> },
   *                    { name: 'physical.dbType', value: <raw SQL type, e.g. VARCHAR(255)> },
   *                    { name: 'physical.nullable', value: true|false }]
   *
   * Display names are derived from the raw SQL identifiers via the configured
   * stripPrefixes/stripSuffixes lists, then converted to PascalCase (entities)
   * or camelCase (attributes). Storage round-trips through these helpers, so
   * re-importing the same DDL produces stable display names.
   */
  parseSqlDdl(sql: string, options: ParseSqlDdlOptions = {}): ParseSqlDdlResult {
    const entities: Entity[] = [];
    const errors: string[] = [];
    const { stripPrefixes = [], stripSuffixes = [], schema } = options;

    try {
      // ── Pass 0: extract COMMENT ON and MySQL inline COMMENT (#83) ──────
      const tableComments = extractTableComments(sql);
      const columnComments = extractColumnComments(sql);

      // CREATE TABLE [IF NOT EXISTS] [`"]name[`"] (columns_block);
      const tableRegex = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:`|")?(\w+)(?:`|")?\s*\(([\s\S]*?)\);/gi;
      let match;

      while ((match = tableRegex.exec(sql)) !== null) {
        const rawTableName = match[1];
        const columnsBlock = match[2];
        const attributes: Attribute[] = [];
        const primaryKeys = new Set<string>();
        const tableConstraints: PhysicalConstraint[] = [];

        // Extract table-level PRIMARY KEY constraint (one or more columns)
        const pkMatch = columnsBlock.match(/PRIMARY\s+KEY\s*\(([^)]+)\)/i);
        if (pkMatch) {
          pkMatch[1].split(',').forEach(k => primaryKeys.add(k.trim().replace(/[`"]/g, '')));
        }

        // Split columns block on commas, but be aware of nested parens (e.g. DECIMAL(10,2)).
        // Simple state machine: track paren depth so commas inside DECIMAL(p,s) don't split.
        const lines: string[] = [];
        {
          let depth = 0;
          let buf = '';
          for (const ch of columnsBlock) {
            if (ch === '(') depth++;
            else if (ch === ')') depth--;
            if (ch === ',' && depth === 0) {
              if (buf.trim()) lines.push(buf.trim());
              buf = '';
            } else {
              buf += ch;
            }
          }
          if (buf.trim()) lines.push(buf.trim());
        }

        for (const line of lines) {
          // Table-level constraint lines: capture, then skip column parsing.
          if (/^\s*(PRIMARY|FOREIGN|UNIQUE|CHECK|CONSTRAINT|INDEX|KEY)/i.test(line)) {
            tableConstraints.push(...extractConstraintsFromLine(line, undefined));
            continue;
          }

          const colMatch = line.match(/^(?:`|")?(\w+)(?:`|")?\s+(\w+)(?:\(([^)]*)\))?(.*)/i);
          if (!colMatch) continue;

          const [, rawColName, sqlType, typeParams, rest] = colMatch;
          const normalizedType = sqlType.toLowerCase();
          const attrType = SQL_TYPE_MAP[normalizedType] || AttributeType.STRING;
          const isNotNull = /NOT\s+NULL/i.test(rest);
          const isPK = primaryKeys.has(rawColName) || /PRIMARY\s+KEY/i.test(rest);

          // Derive display name from raw SQL identifier
          const displayName = toCamelCase(stripAffixes(rawColName, stripPrefixes, stripSuffixes));

          // Build raw dbType string for physical metadata (e.g. VARCHAR(255), DECIMAL(10,2))
          const rawDbType = typeParams ? `${sqlType.toUpperCase()}(${typeParams})` : sqlType.toUpperCase();

          // Detect auto-generation strategy (#73)
          const generatedStrategy = detectGeneratedStrategy(normalizedType, rest);

          const attrMetadata: MetadataEntry[] = [
            { name: 'physical.columnName', value: rawColName },
            { name: 'physical.dbType', value: rawDbType },
            { name: 'physical.nullable', value: !isNotNull && !isPK },
          ];
          if (generatedStrategy) {
            attrMetadata.push({ name: 'physical.generated', value: generatedStrategy });
          }

          // Column description from SQL COMMENT (#83): MySQL inline or COMMENT ON COLUMN
          const colComment = extractMysqlInlineComment(rest)
            || columnComments.get(`${rawTableName.toLowerCase()}.${rawColName.toLowerCase()}`)
            || '';

          const attr: Attribute = {
            uuid: generateUUID(),
            name: displayName,
            description: colComment,
            type: attrType,
            required: isNotNull || isPK,
            primaryKey: isPK || undefined,
            metadata: attrMetadata,
          };

          // Map type params to logical validation (#85)
          if (typeParams) {
            attr.validation = {};
            const params = typeParams.split(',').map(p => parseInt(p.trim()));
            if (normalizedType === 'varchar' || normalizedType === 'char') {
              attr.validation.maxLength = params[0];
            } else if (normalizedType === 'decimal' || normalizedType === 'numeric') {
              attr.validation.precision = params[0];
              if (params[1] !== undefined) attr.validation.scale = params[1];
            }
          }

          // Column-level constraint clauses (#85 R3): UNIQUE, REFERENCES, CHECK
          tableConstraints.push(...extractConstraintsFromLine(line, rawColName));

          attributes.push(attr);
        }

        if (attributes.length === 0) continue;

        // Derive entity name from raw SQL identifier
        const entityName = toPascalCase(stripAffixes(rawTableName, stripPrefixes, stripSuffixes));

        const entityMetadata: MetadataEntry[] = [
          { name: 'physical.tableName', value: rawTableName },
        ];
        if (schema) {
          entityMetadata.push({ name: 'physical.schema', value: schema });
        }

        // Entity description: prefer COMMENT ON TABLE, fall back to default (#83)
        const tableComment = tableComments.get(rawTableName.toLowerCase());
        const entityDescription = tableComment || `Imported from SQL table '${rawTableName}'`;

        const entity: Entity = {
          uuid: generateUUID(),
          name: entityName,
          description: entityDescription,
          status: EntityStatus.DRAFT,
          attributes,
          metadata: entityMetadata,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        if (tableConstraints.length > 0) {
          entity.constraints = tableConstraints;
        }

        entities.push(entity);
      }

      if (entities.length === 0 && errors.length === 0) {
        errors.push('No CREATE TABLE statements found in the SQL');
      }
    } catch (error: any) {
      errors.push(`SQL parse error: ${error.message}`);
    }

    // ── Second pass: FK constraints → relationships (#82) ────────────────
    const relationships = buildRelationshipsFromForeignKeys(entities, errors);

    return {
      entities,
      ...(relationships.length > 0 ? { relationships } : {}),
      errors,
    };
  }

  /**
   * Persist already-parsed entities to disk under the given service / package.
   * Caller is responsible for any merge / conflict resolution beforehand
   * (#69 C2 introduces the merger; v1 callers either pass already-merged
   * entities or use the legacy `importFromSqlDdl` wrapper which writes blindly).
   */
  async commitParsedEntities(
    entities: Entity[],
    service: string,
  ): Promise<{ written: Entity[]; errors: string[] }> {
    const written: Entity[] = [];
    const errors: string[] = [];
    for (const entity of entities) {
      try {
        const ok = await writeEntityFile(entity, service);
        if (ok) {
          written.push(entity);
        } else {
          errors.push(`Failed to write entity: ${entity.name}`);
        }
      } catch (error: any) {
        errors.push(`Error writing entity ${entity.name}: ${error.message}`);
      }
    }
    return { written, errors };
  }

  /**
   * Back-compat wrapper for the original importFromSqlDdl signature.
   * Parses + writes immediately, no preview, no merge. Existing callers
   * (the `/api/import/sql-ddl` route) keep working unchanged.
   */
  async importFromSqlDdl(sql: string, service: string): Promise<{ entities: Entity[]; errors: string[] }> {
    const parsed = this.parseSqlDdl(sql);
    if (parsed.errors.length > 0 && parsed.entities.length === 0) {
      return { entities: [], errors: parsed.errors };
    }
    const committed = await this.commitParsedEntities(parsed.entities, service);
    return {
      entities: committed.written,
      errors: [...parsed.errors, ...committed.errors],
    };
  }
}

export const importService = new ImportService();
