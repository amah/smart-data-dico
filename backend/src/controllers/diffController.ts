/**
 * Diff API controllers (#86, #88).
 *
 * Exposes the logical and physical model diff engines via REST endpoints.
 */
import { Request, Response } from 'express';
import { diffModels } from '../services/logicalDiff.js';
import { loadModelSnapshot, SnapshotSource } from '../services/modelSnapshotLoader.js';
import { diffPhysicalModel, PhysicalDiff } from '../services/physicalDiff.js';
import { buildImpactDiff, DdlOperation, ImpactDiff } from '../services/impactDiff.js';
import { generateMigration, MigrationFormat } from '../services/migrationGenerator.js';
import { importService } from '../services/importService.js';
import { serviceService } from '../services/serviceService.js';
import {
  getPhysicalConfig,
  setPhysicalConfig,
  deletePhysicalConfig,
  mergeCredentials,
  PhysicalConfig,
  PhysicalDialect,
} from '../services/physicalConfigService.js';
import { introspectOracle, OracleConnectionConfig } from '../services/oracleIntrospect.js';
import { introspectPostgres, PostgresConnectionConfig } from '../services/postgresIntrospect.js';
import { introspectMysql, MysqlConnectionConfig } from '../services/mysqlIntrospect.js';
import { introspectMssql, MssqlConnectionConfig } from '../services/mssqlIntrospect.js';
import { Entity } from '../models/EntitySchema.js';
import { listMicroservices } from '../utils/fileOperations.js';
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

// ═══════════════════════════════════════════════════════════════════════
// Whole-model (all-services) endpoints
// ═══════════════════════════════════════════════════════════════════════

/**
 * A per-service source spec for whole-model physical diffs. Either:
 *   - `ddl`:  paste / upload DDL for one service
 *   - `live`: introspect the live database using the persisted physical
 *             config + per-request credentials for this service
 */
type PerServiceSource =
  | { type: 'ddl'; sql: string; options?: Record<string, unknown> }
  | {
      type: 'live';
      credentials: { user: string; password: string };
      /** Optional per-request overrides layered on the persisted config. */
      connectionOverrides?: Record<string, unknown>;
    };

/**
 * Run a live introspection for one service using its persisted physical
 * config plus the user-supplied credentials. Throws on missing config /
 * unknown dialect / driver failure — the caller catches and records the
 * failure per service.
 */
async function introspectServiceLive(
  serviceName: string,
  credentials: { user: string; password: string },
  connectionOverrides?: Record<string, unknown>,
): Promise<Entity[]> {
  const config = getPhysicalConfig(serviceName);
  if (!config) {
    throw new Error(`No physical.yaml config for service '${serviceName}'`);
  }
  const hydrated = mergeCredentials(config, credentials);
  const connection = { ...hydrated.connection, ...(connectionOverrides || {}) };

  switch (config.dialect) {
    case 'oracle': {
      const result = await introspectOracle({
        connection: connection as unknown as OracleConnectionConfig,
      });
      if (result.errors.length > 0 && result.entities.length === 0) {
        throw new Error(result.errors[0]);
      }
      return result.entities;
    }
    case 'postgres': {
      const result = await introspectPostgres({
        connection: connection as unknown as PostgresConnectionConfig,
      });
      if (result.errors.length > 0 && result.entities.length === 0) {
        throw new Error(result.errors[0]);
      }
      return result.entities;
    }
    case 'mysql': {
      const result = await introspectMysql({
        connection: connection as unknown as MysqlConnectionConfig,
      });
      if (result.errors.length > 0 && result.entities.length === 0) {
        throw new Error(result.errors[0]);
      }
      return result.entities;
    }
    case 'mssql': {
      const result = await introspectMssql({
        connection: connection as unknown as MssqlConnectionConfig,
      });
      if (result.errors.length > 0 && result.entities.length === 0) {
        throw new Error(result.errors[0]);
      }
      return result.entities;
    }
    default:
      throw new Error(`Unknown dialect '${(config as PhysicalConfig).dialect}'`);
  }
}

/**
 * Resolve one service's source entities (DDL parse OR live introspection).
 * Returns null + an error message on failure so the aggregator can keep
 * going with the remaining services.
 */
async function resolveServiceSource(
  serviceName: string,
  source: PerServiceSource,
): Promise<{ entities: Entity[]; error: null } | { entities: null; error: string }> {
  try {
    if (source.type === 'ddl') {
      const parsed = importService.parseSqlDdl(source.sql, (source.options || {}) as any);
      if (parsed.entities.length === 0 && parsed.errors.length > 0) {
        return { entities: null, error: parsed.errors[0] };
      }
      return { entities: parsed.entities, error: null };
    } else if (source.type === 'live') {
      const entities = await introspectServiceLive(
        serviceName,
        source.credentials,
        source.connectionOverrides,
      );
      return { entities, error: null };
    }
    return { entities: null, error: `Unknown source type` };
  } catch (e) {
    return { entities: null, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * POST /api/diff/physical/all
 *
 * Compare every listed service's logical model against its physical source
 * in one request. Each service has an independent source — the caller can
 * mix DDL paste for one service with live introspection for another.
 *
 * Body: {
 *   services?: string[],                          // default: all known services
 *   sources:   Record<serviceName, PerServiceSource>
 * }
 *
 * Response: {
 *   data: {
 *     byService: Record<serviceName, {
 *       status: 'ok',
 *       diff: PhysicalDiff,
 *     } | {
 *       status: 'error',
 *       error: string,
 *     }>,
 *     summary: { services: number; ok: number; failed: number;
 *                matched: number; drifted: number; modelOnly: number;
 *                orphaned: number; dbOnly: number }
 *   }
 * }
 */
export const physicalDiffAll = async (req: Request, res: Response) => {
  try {
    const { services, sources } = req.body as {
      services?: string[];
      sources: Record<string, PerServiceSource>;
    };
    if (!sources || typeof sources !== 'object') {
      return res.status(400).json({ message: 'sources (Record<service, PerServiceSource>) is required' });
    }

    const serviceList = services && services.length > 0 ? services : await listMicroservices();
    const byService: Record<string, { status: 'ok'; diff: PhysicalDiff } | { status: 'error'; error: string }> = {};
    const agg = { matched: 0, drifted: 0, modelOnly: 0, orphaned: 0, dbOnly: 0 };
    let ok = 0;
    let failed = 0;

    for (const serviceName of serviceList) {
      const src = sources[serviceName];
      if (!src) {
        byService[serviceName] = { status: 'error', error: 'No source provided for this service' };
        failed++;
        continue;
      }
      const resolved = await resolveServiceSource(serviceName, src);
      if (resolved.entities == null) {
        byService[serviceName] = { status: 'error', error: resolved.error };
        failed++;
        continue;
      }
      const modelEntities = await serviceService.getServiceEntities(serviceName);
      const diff = diffPhysicalModel(modelEntities, resolved.entities);
      byService[serviceName] = { status: 'ok', diff };
      ok++;
      agg.matched += diff.summary.matched;
      agg.drifted += diff.summary.drifted;
      agg.modelOnly += diff.summary.modelOnly;
      agg.orphaned += diff.summary.orphaned;
      agg.dbOnly += diff.summary.dbOnly;
    }

    res.json({
      message: `Physical diff (all): ${ok} ok, ${failed} failed across ${serviceList.length} services`,
      data: {
        byService,
        summary: {
          services: serviceList.length,
          ok,
          failed,
          ...agg,
        },
      },
    });
  } catch (error) {
    logger.error('Error computing whole-model physical diff', error);
    res.status(500).json({ message: 'Error computing whole-model physical diff', error: String(error) });
  }
};

/**
 * POST /api/diff/impact/all
 *
 * Per-service ordered DDL operations for a whole-model deployment. Same
 * request body as `/api/diff/physical/all` plus an optional `dialect`
 * *fallback* when a per-service physical.yaml doesn't specify one (used
 * for DDL-paste sources that carry no dialect info).
 *
 * Response groups operations by service AND flattens them into a global
 * list so the UI can show both a per-service breakdown and a single
 * "everything in order" view.
 */
export const impactDiffAll = async (req: Request, res: Response) => {
  try {
    const { services, sources, dialect: fallbackDialect } = req.body as {
      services?: string[];
      sources: Record<string, PerServiceSource>;
      dialect?: PhysicalDialect;
    };
    if (!sources || typeof sources !== 'object') {
      return res.status(400).json({ message: 'sources (Record<service, PerServiceSource>) is required' });
    }

    const serviceList = services && services.length > 0 ? services : await listMicroservices();
    const byService: Record<
      string,
      { status: 'ok'; impact: ImpactDiff; dialect: string } | { status: 'error'; error: string }
    > = {};
    const allOperations: DdlOperation[] = [];
    const agg = { safe: 0, caution: 0, destructive: 0 };
    let ok = 0;
    let failed = 0;

    for (const serviceName of serviceList) {
      const src = sources[serviceName];
      if (!src) {
        byService[serviceName] = { status: 'error', error: 'No source provided for this service' };
        failed++;
        continue;
      }
      const resolved = await resolveServiceSource(serviceName, src);
      if (resolved.entities == null) {
        byService[serviceName] = { status: 'error', error: resolved.error };
        failed++;
        continue;
      }
      const modelEntities = await serviceService.getServiceEntities(serviceName);
      const physDiff = diffPhysicalModel(modelEntities, resolved.entities);
      // Pick the dialect: per-service persisted config wins, fallback second.
      const cfg = getPhysicalConfig(serviceName);
      const dialect = cfg?.dialect || fallbackDialect || 'postgres';
      const impact = buildImpactDiff(physDiff, dialect);
      byService[serviceName] = { status: 'ok', impact, dialect };
      ok++;
      agg.safe += impact.summary.safe;
      agg.caution += impact.summary.caution;
      agg.destructive += impact.summary.destructive;
      // Tag each op with the service so downstream consumers can tell
      // which service an operation belongs to in the flat list.
      for (const op of impact.operations) {
        allOperations.push({ ...op, service: serviceName });
      }
    }

    res.json({
      message: `Impact (all): ${ok} ok, ${failed} failed; ${allOperations.length} total operations`,
      data: {
        byService,
        operations: allOperations,
        summary: {
          services: serviceList.length,
          ok,
          failed,
          operations: allOperations.length,
          ...agg,
        },
      },
    });
  } catch (error) {
    logger.error('Error computing whole-model impact diff', error);
    res.status(500).json({ message: 'Error computing whole-model impact diff', error: String(error) });
  }
};

/**
 * POST /api/export/migration/all
 *
 * Generate migration scripts for an already-computed multi-service impact.
 * The client sends the flat `operations` list from `impactDiffAll` (each
 * op tagged with `.service`) plus an output mode:
 *
 *   - mode: 'combined'   → one file, operations grouped by service
 *                          inside the same document, one dialect assumed
 *                          (or falls back to the single common dialect)
 *   - mode: 'per-service'→ one file per service, zipped into a text
 *                          response (concatenated with separators for now
 *                          — a real zip stream is a follow-up)
 *
 * The dialect is per-service (driven by each op's service + the persisted
 * physical config); the `dialect` field on the request body is only used
 * as a fallback when a service has no persisted dialect.
 */
export const exportMigrationAll = async (req: Request, res: Response) => {
  try {
    const { operations, format, options, mode, dialect: fallbackDialect } = req.body as {
      operations: (DdlOperation & { service?: string })[];
      format: MigrationFormat;
      options?: Record<string, unknown>;
      mode?: 'combined' | 'per-service';
      dialect?: PhysicalDialect;
    };
    if (!Array.isArray(operations)) {
      return res.status(400).json({ message: 'operations (DdlOperation[]) is required' });
    }
    if (!format) {
      return res.status(400).json({ message: 'format is required' });
    }

    // Group ops by service (default bucket '__default__' for untagged ops)
    const bucket = new Map<string, (DdlOperation & { service?: string })[]>();
    for (const op of operations) {
      const key = op.service || '__default__';
      if (!bucket.has(key)) bucket.set(key, []);
      bucket.get(key)!.push(op);
    }

    const pickDialect = (serviceName: string): string => {
      if (serviceName === '__default__') return fallbackDialect || 'postgres';
      const cfg = getPhysicalConfig(serviceName);
      return cfg?.dialect || fallbackDialect || 'postgres';
    };

    if (mode === 'per-service') {
      // Concatenate per-service outputs with a separator banner. Zip
      // streaming is a follow-up — plain text works everywhere today.
      const parts: string[] = [];
      for (const [serviceName, ops] of bucket) {
        const d = pickDialect(serviceName);
        const gen = generateMigration(ops, d, format, (options || {}) as any);
        parts.push(
          `-- ═══════════════════════════════════════════════════════════\n-- ${serviceName} (${d})\n-- ═══════════════════════════════════════════════════════════\n\n${gen.content}`,
        );
      }
      const contentTypes: Record<string, string> = {
        sql: 'text/sql',
        'liquibase-xml': 'application/xml',
        'liquibase-yaml': 'text/yaml',
        'flyway-sql': 'text/sql',
      };
      res.setHeader('Content-Type', contentTypes[format] || 'text/plain');
      res.setHeader('Content-Disposition', `attachment; filename="migration-all-services.${format === 'sql' || format === 'flyway-sql' ? 'sql' : format.includes('xml') ? 'xml' : 'yaml'}"`);
      res.send(parts.join('\n\n'));
      return;
    }

    // Combined mode: one document grouping by service using banners.
    // Dialect for the file picks the first service's dialect — a single
    // combined file with mixed dialects is ambiguous, so we warn the
    // caller by including the dialect in the banner.
    const combinedParts: string[] = [];
    for (const [serviceName, ops] of bucket) {
      const d = pickDialect(serviceName);
      const gen = generateMigration(ops, d, format, (options || {}) as any);
      combinedParts.push(
        `-- ─── ${serviceName} (${d}) ───\n${gen.content}`,
      );
    }
    const first = bucket.size > 0 ? pickDialect([...bucket.keys()][0]) : 'postgres';
    const header = `-- Whole-model migration (${bucket.size} service${bucket.size === 1 ? '' : 's'}, primary dialect: ${first})\n\n`;

    const contentTypes: Record<string, string> = {
      sql: 'text/sql',
      'liquibase-xml': 'application/xml',
      'liquibase-yaml': 'text/yaml',
      'flyway-sql': 'text/sql',
    };
    res.setHeader('Content-Type', contentTypes[format] || 'text/plain');
    res.setHeader('Content-Disposition', `attachment; filename="migration-whole-model.${format === 'sql' || format === 'flyway-sql' ? 'sql' : format.includes('xml') ? 'xml' : 'yaml'}"`);
    res.send(header + combinedParts.join('\n\n'));
  } catch (error) {
    logger.error('Error exporting whole-model migration', error);
    res.status(500).json({ message: 'Error exporting whole-model migration', error: String(error) });
  }
};

// ═══════════════════════════════════════════════════════════════════════
// Per-service physical config CRUD
// ═══════════════════════════════════════════════════════════════════════

/**
 * GET /api/services/:service/physical-config
 * Returns the persisted physical config (dialect + non-secret connection),
 * or 404 if none is set.
 */
export const getPhysicalConfigController = async (req: Request, res: Response) => {
  try {
    const { service } = req.params;
    const cfg = getPhysicalConfig(service);
    if (!cfg) {
      return res.status(404).json({ message: `No physical config for service '${service}'` });
    }
    res.json({ message: 'ok', data: cfg });
  } catch (error) {
    logger.error('Error reading physical config', error);
    res.status(500).json({ message: 'Error reading physical config', error: String(error) });
  }
};

/**
 * PUT /api/services/:service/physical-config
 * Body: PhysicalConfig { dialect, connection }. User/password fields in
 * `connection` are stripped defensively before writing to disk.
 */
export const putPhysicalConfigController = async (req: Request, res: Response) => {
  try {
    const { service } = req.params;
    const cfg = req.body as PhysicalConfig;
    if (!cfg || !cfg.dialect || !cfg.connection) {
      return res.status(400).json({ message: 'dialect and connection are required' });
    }
    if (!['oracle', 'postgres', 'mysql', 'mssql'].includes(cfg.dialect)) {
      return res.status(400).json({ message: `Unknown dialect '${cfg.dialect}'` });
    }
    setPhysicalConfig(service, cfg);
    res.json({ message: `Physical config saved for '${service}'`, data: getPhysicalConfig(service) });
  } catch (error) {
    logger.error('Error writing physical config', error);
    res.status(500).json({ message: 'Error writing physical config', error: String(error) });
  }
};

/**
 * DELETE /api/services/:service/physical-config
 */
export const deletePhysicalConfigController = async (req: Request, res: Response) => {
  try {
    const { service } = req.params;
    deletePhysicalConfig(service);
    res.json({ message: `Physical config deleted for '${service}'` });
  } catch (error) {
    logger.error('Error deleting physical config', error);
    res.status(500).json({ message: 'Error deleting physical config', error: String(error) });
  }
};
