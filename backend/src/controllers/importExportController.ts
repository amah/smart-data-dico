import { Request, Response } from 'express';
import { importService } from '../services/importService.js';
import { exportService } from '../services/exportService.js';
import { qualityService } from '../services/qualityService.js';
import { serviceService } from '../services/serviceService.js';
import { diffEntities, mergeEntities } from '../services/schemaDiff.js';
import { Entity } from '../models/EntitySchema.js';
import { logger } from '../utils/logger.js';

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
    const { parsed, targetService } = req.body as {
      parsed: Entity[];
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
    res.json({ message: `Diff for ${diffs.length} entities`, data: { diffs } });
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
    const { parsed, targetService } = req.body as {
      parsed: Entity[];
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
        errors: commitResult.errors,
      },
    });
  } catch (error) {
    logger.error('Error committing schema import', error);
    res.status(500).json({ message: 'Error committing schema import', error });
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
