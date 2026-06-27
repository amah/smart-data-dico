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
  dialect: z.enum(['generic', 'postgres', 'mysql', 'mssql', 'oracle', 'sqlite']).optional()
    .describe('Target SQL dialect — tunes fallback column types (default generic)'),
});
export type GetSqlSchemaInput = z.infer<typeof getSqlSchemaInputSchema>;

export const getSqlSchemaParameters = {
  type: 'object',
  properties: {
    packageName: { type: 'string', description: 'Scope to one package (omit for the whole model)' },
    dialect: { type: 'string', enum: ['generic', 'postgres', 'mysql', 'mssql', 'oracle', 'sqlite'], description: 'Target SQL dialect (default generic)' },
  },
} as const;

// --- helpers ----------------------------------------------------------------

function metaValue(meta: Array<{ name: string; value: unknown }> | undefined, name: string): string | undefined {
  const e = meta?.find(m => m.name === name);
  return e && e.value != null ? String(e.value) : undefined;
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
  const physName = metaValue(a.metadata, 'physical.columnName');
  const physType = metaValue(a.metadata, 'physical.dbType');
  const resolved = resolveBase(String(a.type || 'string'), a.validation as any, derived);
  return {
    attribute: a.name,
    column: physName ?? a.name,
    dbType: physType ?? sqlType(resolved.base, resolved.validation, dialect),
    nullable: !a.required,
    primaryKey: !!a.primaryKey,
    ...(physName || physType ? {} : { physicalMappingMissing: true }),
  };
}

// --- core -------------------------------------------------------------------

export interface SqlSchemaOptions {
  /** Always schema-qualify table names (reflects the ai.sql config). */
  schemaQualifyTables?: boolean;
  /** Default schema applied to tables that have no physical.schema. */
  defaultSchema?: string;
}

export async function buildSqlSchema(input: GetSqlSchemaInput, services: SqlSchemaServices, opts?: SqlSchemaOptions): Promise<Record<string, unknown>> {
  const dialect = (input.dialect ?? 'generic') as SqlDialect;
  const { listMicroservices } = await import('../utils/fileOperations.js');
  const pkgs = input.packageName ? [input.packageName] : await listMicroservices();

  const derivedList = await services.derivedTypes.list().catch(() => []);
  const derived = new Map(derivedList.map(d => [d.name, d]));

  // Build across all packages for cross-package endpoint name resolution,
  // but only emit tables for the requested scope.
  const allPkgs = await listMicroservices();
  const nameByUuid = new Map<string, string>();
  for (const p of allPkgs) {
    for (const e of await services.serviceService.getServiceEntities(p).catch(() => [])) nameByUuid.set(e.uuid, e.name);
  }

  const tables: unknown[] = [];
  const relationships: unknown[] = [];
  let missing = 0;
  for (const p of pkgs) {
    const entities = await services.serviceService.getServiceEntities(p).catch(() => []);
    for (const e of entities) {
      // The entity's own physical schema, or the configured default schema.
      const schema = metaValue(e.metadata, 'physical.schema') ?? (opts?.defaultSchema?.trim() || undefined);
      const table = metaValue(e.metadata, 'physical.tableName') ?? e.name;
      const columns = (e.attributes ?? []).map(a => {
        const c = columnFor(a, derived, dialect);
        if ('physicalMappingMissing' in c) missing++;
        return c;
      });
      tables.push({
        entity: e.name,
        table,
        ...(schema ? { schema } : {}),
        // Ready-to-use name for SQL — schema.table when a schema is known.
        qualifiedName: schema ? `${schema}.${table}` : table,
        columns,
      });
    }
    for (const r of await services.serviceService.getPackageRelationships(p).catch(() => [])) {
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

  const scope = input.packageName ?? 'all packages';
  return {
    // #tool-summary — concise self-describing line for the tool card.
    summary: `${tables.length} table${tables.length === 1 ? '' : 's'}, ${relationships.length} relationship${relationships.length === 1 ? '' : 's'} (${dialect}, ${scope})`,
    dialect,
    scope,
    schemaQualifyTables: !!opts?.schemaQualifyTables,
    tables,
    relationships,
    note: 'Use these PHYSICAL table/column names and dbTypes when writing SQL. '
      + (opts?.schemaQualifyTables ? 'Schema-qualify every table (use each table\'s qualifiedName). ' : '')
      + (missing > 0
        ? `${missing} column(s) have no physical mapping — their dbType is a fallback derived from the logical type; flag this to the user.`
        : 'All columns have an explicit physical mapping.'),
  };
}
