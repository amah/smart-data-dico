/**
 * Named SQL connection library (#run-sql). Global, per-user saved connection
 * PARAMETERS — dialect/host/port/database/db-user — so the connect form offers
 * a "saved connections" picker instead of retyping. Deliberately NOT keyed by
 * project or package: a database is a machine-level thing.
 *
 * Storage: the `sqlConnections` section of `~/.dico-app/dico-app.json`
 * (0600, via appDir — the sanctioned config accessor), keyed by the SAME
 * userTag the secret store uses, so on a shared server each authenticated app
 * user sees only their own library:
 *
 *   sqlConnections: {
 *     "<userTag>": {
 *       entries: [{ id, name, dialect, connection, user, savedAt }],
 *       lastUsedByPackage: { "<packageName>": "<connectionId>" }   // prefill hint
 *     }
 *   }
 *
 * SECURITY: passwords NEVER enter this file. They live in the secret store
 * under a connection-scoped key (`connectionSecretKey`), and `sanitizeEntry`
 * strips `password`/`credentials` from any input defensively.
 */
import { getConfigSection, setConfigSection } from '../../utils/appDir.js';
import { generateUUID } from '../../utils/uuid.js';
import { userTag } from './secretStore.js';
import type { SqlDialect } from './types.js';

export interface SavedConnection {
  id: string;
  name: string;
  dialect: SqlDialect;
  connection: Record<string, unknown>;
  user: string;
  savedAt: string;
}

interface UserLibrary {
  entries: SavedConnection[];
  lastUsedByPackage: Record<string, string>;
}

type Section = Record<string, UserLibrary>;

const SECTION = 'sqlConnections';

function readSection(): Section {
  const s = getConfigSection<Section>(SECTION);
  return s && typeof s === 'object' ? s : {};
}

function libraryOf(section: Section, appUser: string): UserLibrary {
  const lib = section[userTag(appUser)];
  return {
    entries: Array.isArray(lib?.entries) ? lib.entries : [],
    lastUsedByPackage: lib?.lastUsedByPackage && typeof lib.lastUsedByPackage === 'object' ? lib.lastUsedByPackage : {},
  };
}

function writeLibrary(appUser: string, lib: UserLibrary): void {
  const section = readSection();
  section[userTag(appUser)] = lib;
  setConfigSection(SECTION, section);
}

const SECRET_KEY_RE = /^(password|passwd|pwd|credentials?|secret)$/i;

/** Deep-copy `v` with every secret-shaped key removed, at ANY depth — the API
 *  is the input boundary, so a nested `connection.options.password` must be
 *  stripped just like a top-level one. */
function stripSecrets(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stripSecrets);
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v)) {
      if (!SECRET_KEY_RE.test(k)) out[k] = stripSecrets(val);
    }
    return out;
  }
  return v;
}

/** Strip anything secret-shaped — the library holds parameters, never passwords. */
function sanitizeEntry(e: SavedConnection): SavedConnection {
  const connection = stripSecrets(e.connection ?? {}) as Record<string, unknown>;
  return { id: e.id, name: e.name, dialect: e.dialect, connection, user: e.user, savedAt: e.savedAt };
}

export function listSavedConnections(appUser: string): SavedConnection[] {
  return libraryOf(readSection(), appUser).entries.map(sanitizeEntry);
}

export function getSavedConnection(appUser: string, id: string): SavedConnection | null {
  return listSavedConnections(appUser).find((e) => e.id === id) ?? null;
}

export interface SavedConnectionInput {
  name: string;
  dialect: SqlDialect;
  connection: Record<string, unknown>;
  user?: string;
}

export function createSavedConnection(appUser: string, input: SavedConnectionInput): SavedConnection {
  const entry = sanitizeEntry({
    id: generateUUID(),
    name: input.name,
    dialect: input.dialect,
    connection: input.connection ?? {},
    user: input.user ?? '',
    savedAt: new Date().toISOString(),
  });
  const lib = libraryOf(readSection(), appUser);
  lib.entries.push(entry);
  writeLibrary(appUser, lib);
  return entry;
}

export function updateSavedConnection(appUser: string, id: string, input: SavedConnectionInput): SavedConnection | null {
  const lib = libraryOf(readSection(), appUser);
  const idx = lib.entries.findIndex((e) => e.id === id);
  if (idx === -1) return null;
  const entry = sanitizeEntry({
    ...lib.entries[idx],
    name: input.name ?? lib.entries[idx].name,
    dialect: input.dialect ?? lib.entries[idx].dialect,
    connection: input.connection ?? lib.entries[idx].connection,
    user: input.user ?? lib.entries[idx].user,
    savedAt: new Date().toISOString(),
  });
  lib.entries[idx] = entry;
  writeLibrary(appUser, lib);
  return entry;
}

/** Remove the entry and any last-used hints pointing at it. Returns false when absent. */
export function deleteSavedConnection(appUser: string, id: string): boolean {
  const lib = libraryOf(readSection(), appUser);
  const before = lib.entries.length;
  lib.entries = lib.entries.filter((e) => e.id !== id);
  if (lib.entries.length === before) return false;
  for (const [pkg, connId] of Object.entries(lib.lastUsedByPackage)) {
    if (connId === id) delete lib.lastUsedByPackage[pkg];
  }
  writeLibrary(appUser, lib);
  return true;
}

export function lastUsedByPackage(appUser: string): Record<string, string> {
  return libraryOf(readSection(), appUser).lastUsedByPackage;
}

export function setLastUsed(appUser: string, packageName: string, connectionId: string): void {
  const lib = libraryOf(readSection(), appUser);
  lib.lastUsedByPackage[packageName] = connectionId;
  writeLibrary(appUser, lib);
}
