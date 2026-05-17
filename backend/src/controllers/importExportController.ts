import { Request, Response } from 'express';
import { importService } from '../services/importService.js';
import { exportService } from '../services/exportService.js';
import { qualityService } from '../services/qualityService.js';
import { serviceService } from '../services/serviceService.js';
import { diffEntities, mergeEntities, diffRelationships, mergeRelationships } from '../services/schemaDiff.js';
import { physicalTableNameOf } from '../services/schemaDiff.js';
import { introspectOracle, OracleConnectionConfig } from '../services/oracleIntrospect.js';
import { introspectPostgres, PostgresConnectionConfig } from '../services/postgresIntrospect.js';
import { introspectMysql, MysqlConnectionConfig } from '../services/mysqlIntrospect.js';
import { introspectMssql, MssqlConnectionConfig } from '../services/mssqlIntrospect.js';
import { Entity, Relationship } from '../models/EntitySchema.js';
import { readRelationshipsFile } from '../utils/fileOperations.js';
import { logger } from '../utils/logger.js';
import path from 'path';
import { getProjection } from '../storage/projection/ProjectionRegistry.js';
import { wsId } from '../storage/contract/types.js';
import type { LogicalPath } from '../storage/projection/LogicalProjection.js';

export const importJsonSchema = async (req: Request, res: Response) => {
  try {
    const { schema, service } = req.body;
    if (!schema || !service) return res.status(400).json({ message: 'schema and service are required' });
    const result = await importService.importFromJsonSchema(schema, service);
    res.json({ message: `Imported ${result.entities.length} entities`, data: result });
  } catch (error) {
    logger.error('Error importing JSON Schema', error);
    res.status(500).json({ message: 'Error importing JSON Schema', error });
  }
};

export const importSqlDdl = async (req: Request, res: Response) => {
  try {
    const { sql, service } = req.body;
    if (!sql || !service) return res.status(400).json({ message: 'sql and service are required' });
    const result = await importService.importFromSqlDdl(sql, service);
    res.json({ message: `Imported ${result.entities.length} entities`, data: result });
  } catch (error) {
    logger.error('Error importing SQL DDL', error);
    res.status(500).json({ message: 'Error importing SQL DDL', error });
  }
};

/**
 * Parse SQL DDL into in-memory entities WITHOUT writing to disk (#69 C1).
 *
 * Returns the parsed entities so the frontend wizard can show a preview
 * step. The commit step (writing to disk + merging with existing entities)
 * comes in #69 C2.
 *
 * Body: {
 *   sql: string,
 *   options?: {
 *     stripPrefixes?: string[],
 *     stripSuffixes?: string[],
 *     schema?: string,
 *   }
 * }
 */
export const previewSqlDdl = async (req: Request, res: Response) => {
  try {
    const { sql, options } = req.body;
    if (!sql || typeof sql !== 'string') {
      return res.status(400).json({ message: 'sql (string) is required' });
    }
    const result = importService.parseSqlDdl(sql, options || {});
    res.json({ message: `Parsed ${result.entities.length} entities`, data: result });
  } catch (error) {
    logger.error('Error parsing SQL DDL', error);
    res.status(500).json({ message: 'Error parsing SQL DDL', error });
  }
};

/**
 * Compute the structured diff between a parsed source schema and the
 * existing entities in a target service (#69 C2). No disk writes.
 *
 * Body: {
 *   parsed: Entity[],          // from /api/import/sql-ddl/preview
 *   targetService: string,
 * }
 *
 * Returns: { diffs: EntityDiff[] }
 */
export const diffSqlDdl = async (req: Request, res: Response) => {
  try {
    const { parsed, relationships: parsedRelationships, targetService } = req.body as {
      parsed: Entity[];
      relationships?: Relationship[];
      targetService: string;
    };
    if (!Array.isArray(parsed)) {
      return res.status(400).json({ message: 'parsed (Entity[]) is required' });
    }
    if (!targetService || typeof targetService !== 'string') {
      return res.status(400).json({ message: 'targetService (string) is required' });
    }
    const existing = await serviceService.getServiceEntities(targetService);
    const diffs = diffEntities(parsed, existing);

    // Relationship diffs (#82)
    let relationshipDiffs;
    if (parsedRelationships && parsedRelationships.length > 0) {
      const packagePath = path.join(process.cwd(), 'data-dictionaries', targetService);
      const existingRels = await readRelationshipsFile(packagePath);
      relationshipDiffs = diffRelationships(parsedRelationships, existingRels);
    }

    res.json({
      message: `Diff for ${diffs.length} entities`,
      data: {
        diffs,
        ...(relationshipDiffs ? { relationshipDiffs } : {}),
      },
    });
  } catch (error) {
    logger.error('Error computing schema diff', error);
    res.status(500).json({ message: 'Error computing schema diff', error });
  }
};

/**
 * Merge a parsed source schema into the target service and persist (#69 C2).
 *
 * Runs the same merge logic as `diffSqlDdl` but actually writes the merged
 * entities to disk via `commitParsedEntities`. The user content
 * (descriptions, non-physical metadata, model-only attributes) is preserved
 * by the merger.
 *
 * Body: {
 *   parsed: Entity[],
 *   targetService: string,
 * }
 *
 * Returns: {
 *   written: number,
 *   added: number,        // entities created
 *   merged: number,       // entities updated
 *   unchanged: number,    // entities not touched
 *   removedInSource: number,
 *   errors: string[],
 * }
 */
export const commitSqlDdl = async (req: Request, res: Response) => {
  try {
    const { parsed, relationships: parsedRelationships, targetService } = req.body as {
      parsed: Entity[];
      relationships?: Relationship[];
      targetService: string;
    };
    if (!Array.isArray(parsed)) {
      return res.status(400).json({ message: 'parsed (Entity[]) is required' });
    }
    if (!targetService || typeof targetService !== 'string') {
      return res.status(400).json({ message: 'targetService (string) is required' });
    }

    const existing = await serviceService.getServiceEntities(targetService);
    const diffs = diffEntities(parsed, existing);
    const merged = mergeEntities(parsed, existing);

    // Only write entities whose status is added/changed (skip unchanged + removedInSource)
    const writtenSet = new Set<string>();
    for (const d of diffs) {
      if (d.status === 'added' || d.status === 'changed') {
        if (d.physicalTableName) writtenSet.add(d.physicalTableName);
      }
    }
    const toWrite = merged.filter(e => {
      const t = (e.metadata || []).find(m => m.name === 'physical.tableName')?.value;
      return typeof t === 'string' && writtenSet.has(t);
    });

    const commitResult = await importService.commitParsedEntities(toWrite, targetService);

    // ── Relationship merge + write (#82) ─────────────────────────────────
    let relCounts = { added: 0, merged: 0, unchanged: 0, removedInSource: 0 };
    if (parsedRelationships && parsedRelationships.length > 0) {
      const packagePath = path.join(process.cwd(), 'data-dictionaries', targetService);
      const existingRels = await readRelationshipsFile(packagePath);

      // Build UUID map: parsed entity UUID → merged entity UUID
      // (for entities that matched existing ones by physical.tableName)
      const entityUuidMap = new Map<string, string>();
      for (const d of diffs) {
        if (d.status === 'changed' || d.status === 'unchanged') {
          if (d.source && d.existing) {
            entityUuidMap.set(d.source.uuid, d.existing.uuid);
          }
        }
      }
      // For added entities, source UUID is used as-is (new entity)

      const mergedRels = mergeRelationships(parsedRelationships, existingRels, entityUuidMap);
      const relDiffs = diffRelationships(parsedRelationships, existingRels);

      // Slice 6e.1: route through projection so subscribers see the
      // invalidation. Path-shape projection.writeRelationships needs the
      // logical `packages/<pkg>` form, not the physical filesystem path.
      const projection = getProjection(wsId('dictionaries'));
      const packageLogicalPath = `packages/${targetService}` as LogicalPath;
      await projection.writeRelationships(packageLogicalPath, mergedRels);

      relCounts = {
        added: relDiffs.filter(d => d.status === 'added').length,
        merged: relDiffs.filter(d => d.status === 'changed').length,
        unchanged: relDiffs.filter(d => d.status === 'unchanged').length,
        removedInSource: relDiffs.filter(d => d.status === 'removedInSource').length,
      };
    }

    const counts = {
      added: diffs.filter(d => d.status === 'added').length,
      merged: diffs.filter(d => d.status === 'changed').length,
      unchanged: diffs.filter(d => d.status === 'unchanged').length,
      removedInSource: diffs.filter(d => d.status === 'removedInSource').length,
    };

    res.json({
      message: `Imported: ${counts.added} created, ${counts.merged} merged, ${counts.unchanged} unchanged, ${counts.removedInSource} preserved (removed in source)`,
      data: {
        written: commitResult.written.length,
        ...counts,
        relationships: relCounts,
        errors: commitResult.errors,
      },
    });
  } catch (error) {
    logger.error('Error committing schema import', error);
    res.status(500).json({ message: 'Error committing schema import', error });
  }
};

/**
 * Connect to a live Oracle database and introspect its schema (#69 C3).
 *
 * Returns the parsed entities in the same shape as `previewSqlDdl` so the
 * frontend wizard can hand them straight to `/api/import/sql-ddl/diff`
 * and `/commit`. No disk writes occur in this endpoint.
 *
 * Body: {
 *   connection: { user, password, connectString, owner? },
 *   options?: {
 *     stripPrefixes?: string[],
 *     stripSuffixes?: string[],
 *     schema?: string,  // overrides physical.schema metadata
 *   }
 * }
 *
 * Security: Oracle credentials are accepted in the request body and never
 * persisted by this controller. Callers should ensure transport is HTTPS
 * in any non-local deployment.
 */
export const previewOracleSchema = async (req: Request, res: Response) => {
  try {
    const { connection, options } = req.body as {
      connection: OracleConnectionConfig;
      options?: { stripPrefixes?: string[]; stripSuffixes?: string[]; schema?: string };
    };
    if (!connection || typeof connection !== 'object') {
      return res.status(400).json({ message: 'connection (object) is required' });
    }
    const connRecord = connection as unknown as Record<string, unknown>;
    const missing = ['user', 'password', 'connectString'].filter(
      k => typeof connRecord[k] !== 'string' || !connRecord[k],
    );
    if (missing.length > 0) {
      return res.status(400).json({ message: `connection missing required fields: ${missing.join(', ')}` });
    }
    const result = await introspectOracle({ connection, ...(options || {}) });
    if (result.entities.length === 0 && result.errors.length > 0) {
      return res.status(502).json({ message: result.errors[0], data: result });
    }
    res.json({ message: `Introspected ${result.entities.length} tables`, data: result });
  } catch (error) {
    logger.error('Error introspecting Oracle schema', error);
    res.status(500).json({ message: 'Error introspecting Oracle schema', error });
  }
};

/**
 * Unified DB schema introspection endpoint (#79/#80/#81).
 *
 * Body: { dialect: 'oracle' | 'postgres' | 'mysql' | 'mssql',
 *         connection: <dialect-specific>, options? }
 *
 * The endpoint dispatches to the right provider and returns the same
 * ParseSqlDdlResult shape as `previewOracleSchema`, so the wizard flow
 * downstream (`/diff`, `/commit`) is dialect-agnostic.
 */
export const previewDbSchema = async (req: Request, res: Response) => {
  try {
    const { dialect, connection, options } = req.body as {
      dialect: string;
      connection: Record<string, unknown>;
      options?: { stripPrefixes?: string[]; stripSuffixes?: string[]; schema?: string };
    };
    if (!dialect || typeof dialect !== 'string') {
      return res.status(400).json({ message: 'dialect (string) is required' });
    }
    if (!connection || typeof connection !== 'object') {
      return res.status(400).json({ message: 'connection (object) is required' });
    }

    const requireFields = (fields: string[]) => {
      const missing = fields.filter(
        k => typeof connection[k] !== 'string' || !connection[k],
      );
      if (missing.length > 0) {
        res.status(400).json({ message: `connection missing required fields: ${missing.join(', ')}` });
        return false;
      }
      return true;
    };

    let result;
    switch (dialect.toLowerCase()) {
      case 'oracle':
        if (!requireFields(['user', 'password', 'connectString'])) return;
        result = await introspectOracle({
          connection: connection as unknown as OracleConnectionConfig,
          ...(options || {}),
        });
        break;
      case 'postgres':
      case 'postgresql':
        if (!requireFields(['host', 'database', 'user', 'password'])) return;
        result = await introspectPostgres({
          connection: connection as unknown as PostgresConnectionConfig,
          ...(options || {}),
        });
        break;
      case 'mysql':
      case 'mariadb':
        if (!requireFields(['host', 'database', 'user', 'password'])) return;
        result = await introspectMysql({
          connection: connection as unknown as MysqlConnectionConfig,
          ...(options || {}),
        });
        break;
      case 'mssql':
      case 'sqlserver':
        if (!requireFields(['server', 'database', 'user', 'password'])) return;
        result = await introspectMssql({
          connection: connection as unknown as MssqlConnectionConfig,
          ...(options || {}),
        });
        break;
      default:
        return res.status(400).json({
          message: `Unknown dialect '${dialect}'. Supported: oracle, postgres, mysql, mssql.`,
        });
    }

    if (result.entities.length === 0 && result.errors.length > 0) {
      return res.status(502).json({ message: result.errors[0], data: result });
    }
    res.json({ message: `Introspected ${result.entities.length} tables`, data: result });
  } catch (error) {
    logger.error('Error introspecting DB schema', error);
    res.status(500).json({ message: 'Error introspecting DB schema', error });
  }
};

export const exportJsonSchema = async (req: Request, res: Response) => {
  try {
    const { service } = req.params;
    const schema = await exportService.exportToJsonSchema(service);
    res.json(schema);
  } catch (error) {
    logger.error('Error exporting JSON Schema', error);
    res.status(500).json({ message: 'Error exporting JSON Schema', error });
  }
};

export const exportMarkdown = async (req: Request, res: Response) => {
  try {
    const { service } = req.params;
    const markdown = await exportService.exportToMarkdown(service);
    res.setHeader('Content-Type', 'text/markdown');
    res.setHeader('Content-Disposition', `attachment; filename="${service}-data-dictionary.md"`);
    res.send(markdown);
  } catch (error) {
    logger.error('Error exporting Markdown', error);
    res.status(500).json({ message: 'Error exporting Markdown', error });
  }
};

export const getQualityReport = async (req: Request, res: Response) => {
  try {
    const service = req.query.service as string | undefined;
    const report = await qualityService.getQualityReport(service);
    res.json({ message: 'Success', data: report });
  } catch (error) {
    logger.error('Error getting quality report', error);
    res.status(500).json({ message: 'Error getting quality report', error });
  }
};
