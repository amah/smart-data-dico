/**
 * In-memory cache of live DB connections for the run-SQL feature, keyed by
 * package. Holds credentials so a Run can reuse the connection set up earlier
 * (matching "the connection is already there"), but ONLY transiently:
 *
 *   - in memory only — never written to disk, never logged
 *   - per-package, TTL-expired (default 30 min of inactivity)
 *   - cleared on project switch/close
 *   - passwords are redacted from every response (see redact())
 */
import type { DbConnection, RedactedConnection } from './types.js';

interface Entry { conn: DbConnection; expiresAt: number }

export class ConnectionCache {
  private readonly map = new Map<string, Entry>();
  constructor(
    private readonly ttlMs = 30 * 60 * 1000,
    private readonly now: () => number = () => Date.now(),
  ) {}

  set(packageName: string, conn: DbConnection): void {
    this.map.set(packageName, { conn, expiresAt: this.now() + this.ttlMs });
  }

  /** Live connection for the package, or null if absent/expired (touches TTL). */
  get(packageName: string): DbConnection | null {
    const e = this.map.get(packageName);
    if (!e) return null;
    if (e.expiresAt <= this.now()) { this.map.delete(packageName); return null; }
    e.expiresAt = this.now() + this.ttlMs; // sliding expiry on use
    return e.conn;
  }

  has(packageName: string): boolean {
    return this.get(packageName) !== null;
  }

  delete(packageName: string): void {
    this.map.delete(packageName);
  }

  clear(): void {
    this.map.clear();
  }
}

/** Credential-free view, safe to return to the client. */
export function redact(conn: DbConnection): RedactedConnection {
  return { dialect: conn.dialect, connection: { ...conn.connection }, user: conn.credentials.user };
}

// Process-wide singleton (one backend process per project in dev/managed mode).
export const connectionCache = new ConnectionCache();
