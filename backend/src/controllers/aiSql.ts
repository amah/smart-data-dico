/**
 * getSqlSchema — the PHYSICAL relational schema of the model, purpose-built to
 * ground the AI chat when it generates SQL queries/DDL. For each entity it
 * resolves the physical table + columns (physical.columnName / physical.dbType),
 * falling back to a sensible SQL type derived from the logical/derived type when
 * no physical mapping exists, and lists relationships as join hints.
 *
 * Conceptual (Order.orderNumber : money) vs physical (orders.order_total
 * DECIMAL(12,2)) is the whole point: queries must use the physical names/types,
 * and this tool hands the model exactly those in one call.
 */
import { z } from 'zod';
import type { Attribute, Entity, Relationship } from '../models/EntitySchema.js';
import type { DerivedType } from '../services/dicoConfigService.js';
import { metaValue, resolveAttributePhysical } from '../services/ai/physicalMapping.js';
import { sqlSchemaToMarkdown, type AgentOutputFormat } from '../services/ai/compactMarkdown.js';

export interface SqlSchemaServices {
  serviceService: {
    getServiceEntities(pkg: string): Promise<Entity[]>;
    getPackageRelationships(pkg: string): Promise<Relationship[]>;
  };
  derivedTypes: { list(): Promise<DerivedType[]> };
}

export type SqlDialect = 'generic' | 'postgres' | 'mysql' | 'mssql' | 'oracle' | 'sqlite';

export const getSqlSchemaInputSchema = z.object({
  packageName: z.string().optional().describe('Scope to one package (omit for the whole model)'),
  entityNames: z.array(z.string()).optional()
    .describe('PREFERRED scope on large models: the target entity names (resolved across all packages). Their directly-related entities are included automatically so JOINs can be derived.'),
  dialect: z.enum(['generic', 'postgres', 'mysql', 'mssql', 'oracle', 'sqlite']).optional()
    .describe('Target SQL dialect — tunes fallback column types (default generic)'),
  format: z.enum(['markdown', 'json']).optional()
    .describe('Result format (default markdown; use json for structured compatibility)'),
});
export type GetSqlSchemaInput = z.infer<typeof getSqlSchemaInputSchema>;

export const getSqlSchemaParameters = {
  type: 'object',
  properties: {
    packageName: { type: 'string', description: 'Scope to one package (omit for the whole model)' },
    entityNames: { type: 'array', items: { type: 'string' }, description: 'PREFERRED scope on large models: target entity names, resolved across all packages; directly-related entities are included automatically for JOINs' },
    dialect: { type: 'string', enum: ['generic', 'postgres', 'mysql', 'mssql', 'oracle', 'sqlite'], description: 'Target SQL dialect (default generic)' },
    format: { type: 'string', enum: ['markdown', 'json'], description: 'Result format (default markdown)' },
  },
} as const;

// --- helpers ----------------------------------------------------------------

/** Join up to `max` names for a tool-card summary; "+N more" past the cap. */
function nameList(names: string[], max = 8): string {
  if (!names.length) return '';
  return names.length <= max ? names.join(', ') : `${names.slice(0, max).join(', ')} +${names.length - max} more`;
}

/** Resolve a (possibly derived) type to its base standard type + merged validation. */
function resolveBase(
  type: string,
  validation: Record<string, any> | undefined,
  derived: Map<string, DerivedType>,
): { base: string; validation: Record<string, any> } {
  let base = type;
  let merged = { ...(validation ?? {}) };
  const seen = new Set<string>();
  while (derived.has(base) && !seen.has(base)) {
    seen.add(base);
    const d = derived.get(base)!;
    // base→derived merge, but the attribute's own validation wins.
    merged = { ...(d.validation ?? {}), ...merged };
    base = d.basedOn;
  }
  return { base, validation: merged };
}

/** Map a base standard type (+validation) to a SQL column type for the dialect. */
function sqlType(base: string, v: Record<string, any>, dialect: SqlDialect): string {
  switch (base) {
    case 'uuid':
      return dialect === 'postgres' ? 'UUID' : dialect === 'mssql' ? 'UNIQUEIDENTIFIER' : 'CHAR(36)';
    case 'string':
    case 'enum':
      return `VARCHAR(${v.maxLength ?? (base === 'enum' ? 50 : 255)})`;
    case 'integer':
      return 'INTEGER';
    case 'number':
      return v.precision ? `DECIMAL(${v.precision},${v.scale ?? 0})` : 'DECIMAL';
    case 'boolean':
      return dialect === 'mysql' ? 'TINYINT(1)' : dialect === 'mssql' ? 'BIT' : 'BOOLEAN';
    case 'date':
      return 'DATE';
    case 'time':
      return 'TIME';
    case 'datetime':
    case 'timestamp':
      return dialect === 'postgres' ? 'TIMESTAMP' : dialect === 'mysql' ? 'DATETIME' : 'TIMESTAMP';
    default:
      return 'VARCHAR(255)';
  }
}

function columnFor(a: Attribute, derived: Map<string, DerivedType>, dialect: SqlDialect) {
  // Shared normalization (services/ai/physicalMapping.ts): PK survives the
  // legacy `isPrimaryKey` metadata form, column/type come from physical.*.
  const phys = resolveAttributePhysical(a);
  const resolved = resolveBase(String(a.type || 'string'), a.validation as any, derived);
  return {
    attribute: a.name,
    column: phys.columnName ?? a.name,
    dbType: phys.dbType ?? sqlType(resolved.base, resolved.validation, dialect),
    nullable: !a.required,
    primaryKey: phys.primaryKey,
    ...(phys.columnName || phys.dbType ? {} : { physicalMappingMissing: true }),
  };
}

// --- core -------------------------------------------------------------------

export interface SqlSchemaOptions {
  /** Always schema-qualify table names (reflects the ai.sql config). */
  schemaQualifyTables?: boolean;
  /** Default schema applied to tables that have no physical.schema. */
  defaultSchema?: string;
}

/** Prevent an accidental whole-project schema dump from flooding AI context. */
export const MAX_UNSCOPED_SQL_SCHEMA_ENTITIES = 250;

export async function buildSqlSchema(input: GetSqlSchemaInput, services: SqlSchemaServices, opts?: SqlSchemaOptions): Promise<Record<string, unknown>> {
  const dialect = (input.dialect ?? 'generic') as SqlDialect;
  const { listMicroservices } = await import('../utils/fileOperations.js');
  const allPkgs = await listMicroservices();
  // Direct-path args arrive unvalidated — normalize entityNames defensively.
  // A non-array (e.g. entityNames: "Order") must error like the zod path does,
  // NOT silently fall through to the whole-model schema.
  if (input.entityNames !== undefined && !Array.isArray(input.entityNames)) {
    return {
      error: `entityNames must be an array of entity names, e.g. entityNames: ['Order']. `
        + `Retry with an array, or call searchModel({ query: '<entity or business term>' }) to locate the entity first.`,
    };
  }
  const requestedNames = Array.isArray(input.entityNames)
    ? input.entityNames.map(n => String(n).trim()).filter(Boolean)
    : undefined;

  if (input.packageName && !allPkgs.includes(input.packageName)) {
    return {
      error: `Package '${input.packageName}' not found. Known packages: ${nameList(allPkgs, 12) || 'none'}. `
        + `Call searchModel({ query: '<entity or business term>' }) to locate the element, `
        + `or retry with entityNames: ['<EntityName>'] — entity names resolve across all packages.`,
    };
  }

  const derivedList = await services.derivedTypes.list().catch(() => []);
  const derived = new Map(derivedList.map(d => [d.name, d]));

  // Load every package's entities ONCE — powers cross-package endpoint name
  // resolution AND (for entityNames) cross-package entity lookup.
  const entitiesByPkg = new Map<string, Entity[]>();
  for (const p of allPkgs) {
    entitiesByPkg.set(p, await services.serviceService.getServiceEntities(p).catch(() => []));
  }
  const nameByUuid = new Map<string, string>();
  for (const ents of entitiesByPkg.values()) {
    for (const e of ents) nameByUuid.set(e.uuid, e.name);
  }
  const relsByPkg = new Map<string, Relationship[]>();
  const relsFor = async (p: string): Promise<Relationship[]> => {
    if (!relsByPkg.has(p)) relsByPkg.set(p, await services.serviceService.getPackageRelationships(p).catch(() => []));
    return relsByPkg.get(p)!;
  };

  if (!requestedNames?.length) {
    const scopePackages = input.packageName ? [input.packageName] : allPkgs;
    const entityCount = scopePackages.reduce((sum, pkg) => sum + (entitiesByPkg.get(pkg)?.length ?? 0), 0);
    if (entityCount > MAX_UNSCOPED_SQL_SCHEMA_ENTITIES) {
      return {
        error: `Refusing an unscoped SQL schema dump of ${entityCount} entities; the safe limit is ${MAX_UNSCOPED_SQL_SCHEMA_ENTITIES}. `
          + `Call searchModel({ query: '<entity or business term>' }) to locate targets, then retry with entityNames: ['<EntityName>'].`,
        entityCount,
        limit: MAX_UNSCOPED_SQL_SCHEMA_ENTITIES,
        scope: input.packageName ?? 'all packages',
      };
    }
  }

  // Resolve the scope: which packages to scan, and (entityNames mode) the
  // exact entity uuids to emit — the requested entities PLUS every entity
  // directly related to one, so JOINs always have both endpoints.
  let pkgs: string[];
  let include: Set<string> | null = null; // null → every entity in `pkgs`
  let scope: string;
  const unresolved: string[] = [];
  if (requestedNames?.length) {
    pkgs = allPkgs;
    const wanted = new Set<string>();
    for (const name of requestedNames) {
      const exact: string[] = [];
      const loose: string[] = [];
      for (const ents of entitiesByPkg.values()) {
        for (const e of ents) {
          if (e.name === name) exact.push(e.uuid);
          else if (e.name.toLowerCase() === name.toLowerCase()) loose.push(e.uuid);
        }
      }
      const hits = exact.length ? exact : loose;
      if (hits.length) hits.forEach(u => wanted.add(u));
      else unresolved.push(name);
    }
    if (!wanted.size) {
      return {
        error: `None of the requested entities (${requestedNames.join(', ')}) exist in any package. `
          + `Call searchModel({ query: '<entity or business term>' }) to locate the right entity names, then retry.`,
      };
    }
    include = new Set(wanted);
    for (const p of allPkgs) {
      for (const r of await relsFor(p)) {
        if (wanted.has(r.source.entity)) include.add(r.target.entity);
        if (wanted.has(r.target.entity)) include.add(r.source.entity);
      }
    }
    const resolved = requestedNames.filter(n => !unresolved.includes(n));
    scope = `entities: ${resolved.join(', ')} (+directly related)`;
  } else {
    pkgs = input.packageName ? [input.packageName] : allPkgs;
    scope = input.packageName ?? 'all packages';
  }

  const tables: unknown[] = [];
  const relationships: unknown[] = [];
  let missing = 0;
  const fallbackTables: string[] = [];
  for (const p of pkgs) {
    const entities = (entitiesByPkg.get(p) ?? []).filter(e => !include || include.has(e.uuid));
    for (const e of entities) {
      // The entity's own physical schema, or the configured default schema.
      const schema = metaValue(e.metadata, 'physical.schema') ?? (opts?.defaultSchema?.trim() || undefined);
      const table = metaValue(e.metadata, 'physical.tableName') ?? e.name;
      let entityMissing = 0;
      const columns = (e.attributes ?? []).map(a => {
        const c = columnFor(a, derived, dialect);
        if ('physicalMappingMissing' in c) entityMissing++;
        return c;
      });
      if (entityMissing > 0) {
        missing += entityMissing;
        // Two entities may share one physical.tableName — list it once.
        if (!fallbackTables.includes(table)) fallbackTables.push(table);
      }
      tables.push({
        entity: e.name,
        package: p,
        table,
        ...(schema ? { schema } : {}),
        // Ready-to-use name for SQL — schema.table when a schema is known.
        qualifiedName: schema ? `${schema}.${table}` : table,
        columns,
      });
    }
    for (const r of await relsFor(p)) {
      if (include && !(include.has(r.source.entity) && include.has(r.target.entity))) continue;
      const from = nameByUuid.get(r.source.entity);
      const to = nameByUuid.get(r.target.entity);
      if (!from || !to) continue;
      relationships.push({
        from, to,
        fromCardinality: r.source.cardinality,
        toCardinality: r.target.cardinality,
        ...(r.description ? { description: r.description } : {}),
      });
    }
  }

  const tableNames = (tables as Array<{ entity: string }>).map(t => t.entity);
  return {
    // #tool-summary — concise line, NAMES the tables for the tool card.
    summary: `${tableNames.length ? nameList(tableNames) : 'no tables'} — ${relationships.length} relationship${relationships.length === 1 ? '' : 's'} (${dialect}, ${scope})`,
    dialect,
    scope,
    schemaQualifyTables: !!opts?.schemaQualifyTables,
    tables,
    relationships,
    ...(unresolved.length ? { unresolvedEntityNames: unresolved } : {}),
    ...(fallbackTables.length ? { tablesWithFallbackColumns: fallbackTables } : {}),
    note: 'Use these PHYSICAL table/column names and dbTypes when writing SQL. '
      + (opts?.schemaQualifyTables ? 'Schema-qualify every table (use each table\'s qualifiedName). ' : '')
      + (missing > 0
        ? `${missing} column(s) in table(s) ${nameList(fallbackTables, 6)} have no explicit physical mapping — `
          + 'their column names/dbTypes are derived from the logical model; WARN the user before relying on them.'
        : 'All columns have an explicit physical mapping.')
      + (unresolved.length
        ? ` Requested entities not found: ${unresolved.join(', ')} — call searchModel({ query: '<name>' }) to locate them.`
        : ''),
  };
}

/** AI-facing SQL schema result: compact Markdown by default, JSON on request. */
export async function executeGetSqlSchema(
  input: GetSqlSchemaInput & { format?: AgentOutputFormat },
  services: SqlSchemaServices,
  opts?: SqlSchemaOptions,
): Promise<string | Record<string, unknown>> {
  const schema = await buildSqlSchema(input, services, opts);
  return input.format === 'json' ? schema : sqlSchemaToMarkdown(schema);
}
