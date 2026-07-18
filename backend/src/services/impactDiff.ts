/**
 * Impact diff engine (#89).
 *
 * Takes a physical diff result and produces an ordered list of DDL operations
 * with risk classification. This is the deployment preview — "what DDL would
 * run to make the DB match the model?"
 *
 * Operation ordering respects FK/index dependencies:
 *   1. DROP FOREIGN KEY
 *   2. DROP INDEX / DROP CONSTRAINT
 *   3. DROP COLUMN / ALTER COLUMN / ADD COLUMN
 *   4. DROP TABLE / CREATE TABLE
 *   5. ADD CONSTRAINT / ADD INDEX
 *   6. ADD FOREIGN KEY
 */
import { PhysicalDiff } from './physicalDiff.js';
import { MetadataEntry } from '../models/EntitySchema.js';

// ────────────────────────────────────────────────────────────────────────
// Result types
// ────────────────────────────────────────────────────────────────────────

export type DdlOperationType =
  | 'CREATE_TABLE' | 'DROP_TABLE'
  | 'ADD_COLUMN' | 'DROP_COLUMN' | 'ALTER_COLUMN'
  | 'ADD_CONSTRAINT' | 'DROP_CONSTRAINT'
  | 'ADD_INDEX' | 'DROP_INDEX'
  | 'ADD_FOREIGN_KEY' | 'DROP_FOREIGN_KEY';

export type RiskLevel = 'safe' | 'caution' | 'destructive';

export interface DdlOperation {
  order: number;
  type: DdlOperationType;
  table: string;
  column?: string;
  details: Record<string, any>;
  destructive: boolean;
  risk: RiskLevel;
  riskReason?: string;
  sql?: string;
  /**
   * Source service — only set by whole-model (all-services) impact diffs.
   * Lets downstream consumers (migration export, UI grouping) know which
   * service an op belongs to in a flattened list from multiple services.
   */
  service?: string;
}

export interface ImpactDiff {
  operations: DdlOperation[];
  summary: ImpactSummary;
}

export interface ImpactSummary {
  safe: number;
  caution: number;
  destructive: number;
  tables: { created: number; dropped: number; altered: number };
  columns: { added: number; dropped: number; altered: number };
  constraints: { added: number; dropped: number };
}

// ────────────────────────────────────────────────────────────────────────
// Helper
// ────────────────────────────────────────────────────────────────────────

function readMeta(metadata: MetadataEntry[] | undefined, name: string): string | number | boolean | undefined {
  const v = (metadata || []).find(m => m.name === name)?.value;
  // MetadataValue was widened to include arrays/objects (#164); physical.*
  // keys are always scalar, so we guard to preserve the narrow return type.
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v;
  return undefined;
}

// ────────────────────────────────────────────────────────────────────────
// Core function
// ────────────────────────────────────────────────────────────────────────

/**
 * Generate ordered DDL operations from a physical diff.
 *
 * The operations transform the current DB state into the model's desired state:
 * - model-only attributes → ADD COLUMN
 * - orphaned attributes → DROP COLUMN
 * - drifted attributes → ALTER COLUMN
 * - dbOnly entities → (no action — they're in the DB already)
 * - modelOnly entities with physical.tableName → CREATE TABLE
 *
 * @param physicalDiff The physical diff result from diffPhysicalModel
 * @param dialect SQL dialect for DDL generation (default: postgres)
 */
export function buildImpactDiff(
  physicalDiff: PhysicalDiff,
  dialect: 'postgres' | 'mysql' | 'oracle' | 'mssql' = 'postgres',
): ImpactDiff {
  const ops: DdlOperation[] = [];

  for (const entity of physicalDiff.entities) {
    const table = entity.physicalTableName;
    if (!table) continue;

    // Entity-level operations
    if (entity.status === 'modelOnly' && table) {
      // Model entity has a table name but no match in DB → CREATE TABLE
      // (only if the entity actually has physical columns to create)
      const physicalAttrs = entity.attributes.filter(a => a.model?.metadata?.some(
        (m: MetadataEntry) => m.name === 'physical.columnName',
      ));
      if (physicalAttrs.length > 0) {
        const columnDefs = physicalAttrs.map(a => {
          const colName = readMeta(a.model?.metadata, 'physical.columnName') || a.attributeName;
          const dbType = readMeta(a.model?.metadata, 'physical.dbType') || 'VARCHAR(255)';
          const nullable = readMeta(a.model?.metadata, 'physical.nullable');
          const pk = a.model?.primaryKey ? ' PRIMARY KEY' : '';
          const nn = nullable === false ? ' NOT NULL' : '';
          return `${colName} ${dbType}${nn}${pk}`;
        }).join(', ');
        ops.push({
          order: 0, type: 'CREATE_TABLE', table,
          details: { columns: physicalAttrs.length },
          destructive: false, risk: 'safe',
          sql: `CREATE TABLE ${table} (${columnDefs});`,
        });
      }
      continue;
    }

    // Attribute-level operations on matched entities
    for (const attr of entity.attributes) {
      const colName = attr.physicalColumnName ||
        readMeta(attr.model?.metadata, 'physical.columnName') as string ||
        attr.attributeName;

      switch (attr.status) {
        case 'orphaned': {
          // Model maps to a column that doesn't exist in DB → ADD COLUMN to make DB match model
          const dbType = readMeta(attr.model?.metadata, 'physical.dbType') || 'VARCHAR(255)';
          const nullable = readMeta(attr.model?.metadata, 'physical.nullable');
          const notNull = nullable === false;
          const risk = notNull ? 'destructive' as const : 'safe' as const;
          ops.push({
            order: 0, type: 'ADD_COLUMN', table, column: colName as string,
            details: { dbType, notNull },
            destructive: notNull,
            risk,
            riskReason: notNull ? 'ADD COLUMN NOT NULL without default fails on non-empty table' : undefined,
            sql: `ALTER TABLE ${table} ADD COLUMN ${colName} ${dbType}${notNull ? ' NOT NULL' : ''};`,
          });
          break;
        }
        case 'dbOnly': {
          // Column exists in DB but not in model → DROP COLUMN to make DB match model
          ops.push({
            order: 0, type: 'DROP_COLUMN', table, column: colName as string,
            details: {},
            destructive: true, risk: 'destructive',
            riskReason: 'Data loss — column may contain data',
            sql: `ALTER TABLE ${table} DROP COLUMN ${colName};`,
          });
          break;
        }
        case 'drifted': {
          const sourceDbType = readMeta(attr.source?.metadata, 'physical.dbType') || '';
          const modelDbType = readMeta(attr.model?.metadata, 'physical.dbType') || '';
          const risk = assessAlterRisk(
            String(modelDbType), String(sourceDbType),
            attr.model?.required, attr.source?.required,
          );
          const targetType = modelDbType || attr.model?.type || 'VARCHAR(255)';
          ops.push({
            order: 0, type: 'ALTER_COLUMN', table, column: colName as string,
            details: {
              from: sourceDbType,
              to: modelDbType,
              driftFields: attr.driftFields,
            },
            destructive: risk === 'destructive',
            risk,
            riskReason: risk === 'caution' ? 'Type change — verify existing data fits'
              : risk === 'destructive' ? 'Narrowing type or adding NOT NULL may fail'
              : undefined,
            sql: generateAlterColumnSql(table, colName as string, String(targetType), attr.model?.required ?? false, dialect),
          });
          break;
        }
        // matched, dbOnly: no operation needed
      }
    }

    // Constraint operations
    for (const c of entity.constraints) {
      if (c.status === 'added' && c.model) {
        const isFK = c.model.kind === 'foreignKey';
        ops.push({
          order: 0,
          type: isFK ? 'ADD_FOREIGN_KEY' : 'ADD_CONSTRAINT',
          table,
          details: { kind: c.model.kind, key: c.key },
          destructive: false,
          risk: isFK ? 'caution' : 'safe',
          riskReason: isFK ? 'May fail if orphan rows exist' : undefined,
        });
      } else if (c.status === 'removed' && c.source) {
        const isFK = c.source.kind === 'foreignKey';
        ops.push({
          order: 0,
          type: isFK ? 'DROP_FOREIGN_KEY' : 'DROP_CONSTRAINT',
          table,
          details: { kind: c.source.kind, key: c.key },
          destructive: false,
          risk: 'caution',
          riskReason: isFK ? 'Removing FK relaxes referential integrity' : 'Constraint removal',
        });
      } else if (c.status === 'drifted' && c.model && c.source) {
        const sourceIsFK = c.source.kind === 'foreignKey';
        const modelIsFK = c.model.kind === 'foreignKey';
        ops.push({
          order: 0,
          type: sourceIsFK ? 'DROP_FOREIGN_KEY' : 'DROP_CONSTRAINT',
          table,
          details: { kind: c.source.kind, key: c.key },
          destructive: false,
          risk: 'caution',
          riskReason: 'Constraint definition changed',
        });
        ops.push({
          order: 0,
          type: modelIsFK ? 'ADD_FOREIGN_KEY' : 'ADD_CONSTRAINT',
          table,
          details: { kind: c.model.kind, key: c.key },
          destructive: false,
          risk: modelIsFK ? 'caution' : 'safe',
          riskReason: modelIsFK ? 'May fail if orphan rows exist' : undefined,
        });
      }
    }
  }

  // Sort by dependency order
  sortOperations(ops);

  return {
    operations: ops,
    summary: buildSummary(ops),
  };
}

// ────────────────────────────────────────────────────────────────────────
// Risk assessment
// ────────────────────────────────────────────────────────────────────────

function assessAlterRisk(
  modelType: string, sourceType: string,
  modelRequired?: boolean, sourceRequired?: boolean,
): RiskLevel {
  // Adding NOT NULL where it was nullable
  if (modelRequired && !sourceRequired) return 'caution';

  // Type narrowing detection (simple heuristic)
  const modelUpper = modelType.toUpperCase();
  const sourceUpper = sourceType.toUpperCase();

  // VARCHAR narrowing
  const modelLen = extractVarcharLength(modelUpper);
  const sourceLen = extractVarcharLength(sourceUpper);
  if (modelLen && sourceLen && modelLen < sourceLen) return 'caution';

  // Numeric narrowing
  if (modelUpper.includes('INT') && sourceUpper.includes('BIGINT')) return 'safe'; // widening
  if (modelUpper.includes('BIGINT') && sourceUpper.includes('INT') && !sourceUpper.includes('BIGINT')) return 'caution'; // mismatch

  return 'safe';
}

function extractVarcharLength(type: string): number | null {
  const m = type.match(/VARCHAR\((\d+)\)/i);
  return m ? parseInt(m[1]) : null;
}

// ────────────────────────────────────────────────────────────────────────
// SQL generation helpers
// ────────────────────────────────────────────────────────────────────────

function generateAlterColumnSql(
  table: string, column: string, targetType: string, notNull: boolean,
  dialect: string,
): string {
  switch (dialect) {
    case 'mysql':
      return `ALTER TABLE ${table} MODIFY COLUMN ${column} ${targetType}${notNull ? ' NOT NULL' : ''};`;
    case 'oracle':
      return `ALTER TABLE ${table} MODIFY (${column} ${targetType}${notNull ? ' NOT NULL' : ''});`;
    case 'mssql':
      return `ALTER TABLE ${table} ALTER COLUMN ${column} ${targetType}${notNull ? ' NOT NULL' : ''};`;
    default: // postgres
      return `ALTER TABLE ${table} ALTER COLUMN ${column} TYPE ${targetType};${notNull ? `\nALTER TABLE ${table} ALTER COLUMN ${column} SET NOT NULL;` : ''}`;
  }
}

// ────────────────────────────────────────────────────────────────────────
// Operation ordering
// ────────────────────────────────────────────────────────────────────────

const ORDER_PRIORITY: Record<DdlOperationType, number> = {
  DROP_FOREIGN_KEY: 1,
  DROP_INDEX: 2,
  DROP_CONSTRAINT: 3,
  DROP_COLUMN: 4,
  ALTER_COLUMN: 5,
  ADD_COLUMN: 6,
  DROP_TABLE: 7,
  CREATE_TABLE: 8,
  ADD_CONSTRAINT: 9,
  ADD_INDEX: 10,
  ADD_FOREIGN_KEY: 11,
};

function sortOperations(ops: DdlOperation[]) {
  ops.sort((a, b) => ORDER_PRIORITY[a.type] - ORDER_PRIORITY[b.type]);
  ops.forEach((op, i) => { op.order = i + 1; });
}

// ────────────────────────────────────────────────────────────────────────
// Summary
// ────────────────────────────────────────────────────────────────────────

function buildSummary(ops: DdlOperation[]): ImpactSummary {
  const summary: ImpactSummary = {
    safe: 0, caution: 0, destructive: 0,
    tables: { created: 0, dropped: 0, altered: 0 },
    columns: { added: 0, dropped: 0, altered: 0 },
    constraints: { added: 0, dropped: 0 },
  };

  const alteredTables = new Set<string>();

  for (const op of ops) {
    summary[op.risk]++;
    switch (op.type) {
      case 'CREATE_TABLE': summary.tables.created++; break;
      case 'DROP_TABLE': summary.tables.dropped++; break;
      case 'ADD_COLUMN': summary.columns.added++; alteredTables.add(op.table); break;
      case 'DROP_COLUMN': summary.columns.dropped++; alteredTables.add(op.table); break;
      case 'ALTER_COLUMN': summary.columns.altered++; alteredTables.add(op.table); break;
      case 'ADD_CONSTRAINT': case 'ADD_INDEX': case 'ADD_FOREIGN_KEY':
        summary.constraints.added++; break;
      case 'DROP_CONSTRAINT': case 'DROP_INDEX': case 'DROP_FOREIGN_KEY':
        summary.constraints.dropped++; break;
    }
  }

  summary.tables.altered = alteredTables.size;
  return summary;
}
