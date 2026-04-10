/**
 * Diff API controllers (#86, #88).
 *
 * Exposes the logical and physical model diff engines via REST endpoints.
 */
import { Request, Response } from 'express';
import { diffModels } from '../services/logicalDiff.js';
import { loadModelSnapshot, SnapshotSource } from '../services/modelSnapshotLoader.js';
import { diffPhysicalModel } from '../services/physicalDiff.js';
import { buildImpactDiff, DdlOperation } from '../services/impactDiff.js';
import { generateMigration, MigrationFormat } from '../services/migrationGenerator.js';
import { importService } from '../services/importService.js';
import { serviceService } from '../services/serviceService.js';
import { logger } from '../utils/logger.js';

/**
 * POST /api/diff/logical
 *
 * Compare two model snapshots and return a structured diff.
 *
 * Body: {
 *   left:  SnapshotSource,   // { type: 'service'|'git-ref'|'snapshot', ... }
 *   right: SnapshotSource,
 * }
 */
export const logicalDiff = async (req: Request, res: Response) => {
  try {
    const { left, right } = req.body as {
      left: SnapshotSource;
      right: SnapshotSource;
    };

    if (!left || !left.type) {
      return res.status(400).json({ message: 'left (SnapshotSource) is required' });
    }
    if (!right || !right.type) {
      return res.status(400).json({ message: 'right (SnapshotSource) is required' });
    }

    const [leftSnapshot, rightSnapshot] = await Promise.all([
      loadModelSnapshot(left),
      loadModelSnapshot(right),
    ]);

    const diff = diffModels(leftSnapshot, rightSnapshot);

    res.json({
      message: `Diff: ${diff.summary.packages.changed} packages changed, ${diff.summary.entities.added + diff.summary.entities.changed + diff.summary.entities.removed + diff.summary.entities.moved} entity changes`,
      data: diff,
    });
  } catch (error) {
    logger.error('Error computing logical diff', error);
    res.status(500).json({ message: 'Error computing logical diff', error: String(error) });
  }
};

/**
 * POST /api/diff/physical
 *
 * Compare model physical metadata against a DB source (DDL or introspection).
 *
 * Body: {
 *   service: string,
 *   source: {
 *     type: 'ddl',
 *     sql: string,
 *     options?: ParseSqlDdlOptions
 *   }
 * }
 */
export const physicalDiff = async (req: Request, res: Response) => {
  try {
    const { service, source } = req.body;

    if (!service || typeof service !== 'string') {
      return res.status(400).json({ message: 'service (string) is required' });
    }
    if (!source || !source.type) {
      return res.status(400).json({ message: 'source (object with type) is required' });
    }

    // Load model entities
    const modelEntities = await serviceService.getServiceEntities(service);

    // Parse source entities
    let sourceEntities;
    if (source.type === 'ddl') {
      if (!source.sql || typeof source.sql !== 'string') {
        return res.status(400).json({ message: 'source.sql (string) is required for type ddl' });
      }
      const parsed = importService.parseSqlDdl(source.sql, source.options || {});
      if (parsed.entities.length === 0 && parsed.errors.length > 0) {
        return res.status(400).json({ message: parsed.errors[0], data: parsed });
      }
      sourceEntities = parsed.entities;
    } else {
      return res.status(400).json({ message: `Unsupported source type: ${source.type}. Supported: ddl` });
    }

    const diff = diffPhysicalModel(modelEntities, sourceEntities);

    res.json({
      message: `Physical diff: ${diff.summary.matched} matched, ${diff.summary.drifted} drifted, ${diff.summary.modelOnly} model-only, ${diff.summary.orphaned} orphaned, ${diff.summary.dbOnly} DB-only`,
      data: diff,
    });
  } catch (error) {
    logger.error('Error computing physical diff', error);
    res.status(500).json({ message: 'Error computing physical diff', error: String(error) });
  }
};

/**
 * POST /api/diff/impact
 *
 * Compute the deployment impact (ordered DDL operations) from a physical diff.
 *
 * Body: {
 *   service: string,
 *   source: { type: 'ddl', sql: string, options?: ... },
 *   dialect?: 'postgres' | 'mysql' | 'oracle' | 'mssql'
 * }
 */
export const impactDiffEndpoint = async (req: Request, res: Response) => {
  try {
    const { service, source, dialect } = req.body;

    if (!service || typeof service !== 'string') {
      return res.status(400).json({ message: 'service (string) is required' });
    }
    if (!source || !source.type) {
      return res.status(400).json({ message: 'source (object with type) is required' });
    }

    const modelEntities = await serviceService.getServiceEntities(service);

    let sourceEntities;
    if (source.type === 'ddl') {
      if (!source.sql) return res.status(400).json({ message: 'source.sql is required' });
      const parsed = importService.parseSqlDdl(source.sql, source.options || {});
      sourceEntities = parsed.entities;
    } else {
      return res.status(400).json({ message: `Unsupported source type: ${source.type}` });
    }

    const physDiff = diffPhysicalModel(modelEntities, sourceEntities);
    const impact = buildImpactDiff(physDiff, dialect || 'postgres');

    res.json({
      message: `Impact: ${impact.operations.length} operations (${impact.summary.safe} safe, ${impact.summary.caution} caution, ${impact.summary.destructive} destructive)`,
      data: impact,
    });
  } catch (error) {
    logger.error('Error computing impact diff', error);
    res.status(500).json({ message: 'Error computing impact diff', error: String(error) });
  }
};

/**
 * POST /api/export/migration
 *
 * Generate migration scripts from DDL operations.
 *
 * Body: {
 *   operations: DdlOperation[],
 *   dialect: 'postgres' | 'mysql' | 'oracle' | 'mssql',
 *   format: 'sql' | 'liquibase-xml' | 'liquibase-yaml' | 'flyway-sql',
 *   options?: { author?, changesetPrefix?, includeRollback?, schemaName?, skipDestructive? }
 * }
 */
export const exportMigration = async (req: Request, res: Response) => {
  try {
    const { operations, dialect, format, options } = req.body as {
      operations: DdlOperation[];
      dialect: string;
      format: MigrationFormat;
      options?: any;
    };

    if (!Array.isArray(operations)) {
      return res.status(400).json({ message: 'operations (DdlOperation[]) is required' });
    }
    if (!format) {
      return res.status(400).json({ message: 'format is required (sql, liquibase-xml, liquibase-yaml, flyway-sql)' });
    }

    const result = generateMigration(operations, dialect || 'postgres', format, options || {});

    // Set appropriate content type for download
    const contentTypes: Record<string, string> = {
      'sql': 'text/sql',
      'liquibase-xml': 'application/xml',
      'liquibase-yaml': 'text/yaml',
      'flyway-sql': 'text/sql',
    };

    res.setHeader('Content-Type', contentTypes[format] || 'text/plain');
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    res.send(result.content);
  } catch (error) {
    logger.error('Error generating migration', error);
    res.status(500).json({ message: 'Error generating migration', error: String(error) });
  }
};
