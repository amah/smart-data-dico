/**
 * Per-service physical configuration (whole-model diff).
 *
 * Stores the *non-secret* parts of each service's target database: dialect
 * + connection host/port/database/schema. Credentials (user/password) are
 * NEVER persisted here — they come at request time from the diff caller and
 * are only held in memory for the duration of the introspection.
 *
 * File layout: `<serviceName>/physical.yaml` (workspace-relative)
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
import YAML from 'yaml';
import { logger } from '../utils/logger.js';
import { storageRegistry } from '../storage/contract/StorageBackendToken.js';
import type { IStorageBackend } from '../storage/contract/IStorageBackend.js';
import { wsId, pathOf, type WorkspaceId } from '../storage/contract/types.js';

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

class PhysicalConfigService {
  private _storage?: IStorageBackend;
  private get storage(): IStorageBackend {
    if (!this._storage) this._storage = storageRegistry.getBackend();
    return this._storage;
  }

  constructor(
    storage?: IStorageBackend,
    private readonly ws: WorkspaceId = wsId('dictionaries'),
  ) {
    this._storage = storage;
  }

  /**
   * Read the physical config for a service, or return null if it isn't set.
   * Missing file and parse errors both resolve to null so callers can fall
   * back cleanly (e.g. "physical config missing — skipping this service").
   */
  async get(serviceName: string): Promise<PhysicalConfig | null> {
    try {
      const raw = await this.storage.read(this.ws, pathOf(`${serviceName}/physical.yaml`));
      const parsed = YAML.parse(raw) as PhysicalConfig;
      if (!parsed || !parsed.dialect) return null;
      return parsed;
    } catch (e) {
      if ((e as { code?: string }).code === 'not-found') return null;
      logger.warn(`Failed to parse ${serviceName}/physical.yaml: ${e}`);
      return null;
    }
  }

  /**
   * Write the physical config for a service. Fails (throws) if the parent
   * service directory doesn't exist — configs for unknown services are a
   * caller bug, not something to silently create.
   */
  async set(serviceName: string, config: PhysicalConfig): Promise<void> {
    // Verify service directory exists (stat throws not-found if absent)
    try {
      await this.storage.stat(this.ws, pathOf(serviceName));
    } catch (e) {
      if ((e as { code?: string }).code === 'not-found') {
        throw new Error(`Service '${serviceName}' does not exist`);
      }
      throw e;
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
    await this.storage.write(this.ws, pathOf(`${serviceName}/physical.yaml`), YAML.stringify(safe));
  }

  /**
   * Delete a service's physical config. No-op if the file doesn't exist.
   */
  async delete(serviceName: string): Promise<void> {
    try {
      await this.storage.delete(this.ws, pathOf(`${serviceName}/physical.yaml`));
    } catch (e) {
      if ((e as { code?: string }).code === 'not-found') return;
      throw e;
    }
  }
}

const _instance = new PhysicalConfigService();

export const getPhysicalConfig = (s: string): Promise<PhysicalConfig | null> => _instance.get(s);
export const setPhysicalConfig = (s: string, c: PhysicalConfig): Promise<void> => _instance.set(s, c);
export const deletePhysicalConfig = (s: string): Promise<void> => _instance.delete(s);

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

// Export the class for test injection
export { PhysicalConfigService };
