/**
 * Per-service physical configuration (whole-model diff).
 *
 * Stores the *non-secret* parts of each service's target database: dialect
 * + connection host/port/database/schema. Credentials (user/password) are
 * NEVER persisted here — they come at request time from the diff caller and
 * are only held in memory for the duration of the introspection.
 *
 * File layout: `data-dictionaries/microservices/{service}/physical.yaml`
 *   dialect: postgres
 *   connection:
 *     host: db.example.com
 *     port: 5432
 *     database: orders
 *     schema: public
 *
 * Exists so a whole-model diff (`/api/diff/physical/all`) can introspect
 * every service's database in one pass without the user re-typing host /
 * database / schema for each service. Dialects are the same four supported
 * by the unified import endpoint (#79/#80/#81): oracle, postgres, mysql, mssql.
 */
import fs from 'fs';
import path from 'path';
import YAML from 'yaml';
import { getPackagePath } from '../utils/fileOperations.js';
import { logger } from '../utils/logger.js';

export type PhysicalDialect = 'oracle' | 'postgres' | 'mysql' | 'mssql';

/**
 * Non-secret connection fields. Shape is loose on purpose — the dialect
 * providers each consume their own subset (oracle wants `connectString`,
 * postgres/mysql want `host`/`database`, mssql wants `server`). Credentials
 * are merged in at request time by the diff controller.
 */
export interface PhysicalConnectionConfig {
  host?: string;
  port?: number;
  database?: string;
  schema?: string;
  server?: string;        // mssql
  connectString?: string; // oracle
  options?: Record<string, unknown>;
}

export interface PhysicalConfig {
  dialect: PhysicalDialect;
  connection: PhysicalConnectionConfig;
}

const FILE_NAME = 'physical.yaml';

function configPath(serviceName: string): string {
  return path.join(getPackagePath(serviceName), FILE_NAME);
}

/**
 * Read the physical config for a service, or return null if it isn't set.
 * Missing file and parse errors both resolve to null so callers can fall
 * back cleanly (e.g. "physical config missing — skipping this service").
 */
export function getPhysicalConfig(serviceName: string): PhysicalConfig | null {
  const file = configPath(serviceName);
  if (!fs.existsSync(file)) return null;
  try {
    const raw = fs.readFileSync(file, 'utf-8');
    const parsed = YAML.parse(raw) as PhysicalConfig;
    if (!parsed || !parsed.dialect) return null;
    return parsed;
  } catch (e) {
    logger.warn(`Failed to parse ${file}: ${e}`);
    return null;
  }
}

/**
 * Write the physical config for a service. Fails (throws) if the parent
 * service directory doesn't exist — configs for unknown services are a
 * caller bug, not something to silently create.
 */
export function setPhysicalConfig(serviceName: string, config: PhysicalConfig): void {
  const dir = getPackagePath(serviceName);
  if (!fs.existsSync(dir)) {
    throw new Error(`Service '${serviceName}' does not exist`);
  }
  // Strip any accidentally-included credential fields — defence in depth.
  const safe: PhysicalConfig = {
    dialect: config.dialect,
    connection: { ...config.connection },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const conn = safe.connection as any;
  delete conn.user;
  delete conn.password;
  fs.writeFileSync(configPath(serviceName), YAML.stringify(safe), 'utf-8');
}

/**
 * Delete a service's physical config. No-op if the file doesn't exist.
 */
export function deletePhysicalConfig(serviceName: string): void {
  const file = configPath(serviceName);
  if (fs.existsSync(file)) fs.unlinkSync(file);
}

/**
 * Merge runtime credentials onto a persisted physical config. Returns a
 * fresh object — the input config is not mutated. Used by the diff
 * controller when hydrating a live introspection call with the user's
 * per-request credentials.
 */
export function mergeCredentials(
  config: PhysicalConfig,
  credentials: { user?: string; password?: string },
): PhysicalConfig & { connection: PhysicalConnectionConfig & { user?: string; password?: string } } {
  return {
    dialect: config.dialect,
    connection: {
      ...config.connection,
      user: credentials.user,
      password: credentials.password,
    },
  };
}
