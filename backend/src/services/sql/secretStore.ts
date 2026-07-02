/**
 * Optional, safe persistence of DB passwords for the run-SQL feature (#209).
 *
 * SECURITY MODEL
 * --------------
 * A DB password is a *personal, per-machine* secret. It must NEVER be written
 * into the project tree (`physical.yaml` is git-tracked/shared), so everything
 * here lives under `~/.dico-app/` (the same 0600 area used for Jira/Confluence
 * tokens), keyed per (package, connection identity) — never committed, never
 * logged, redacted from responses by the caller.
 *
 * An **auto-detecting provider chain** picks the strongest at-rest protection
 * available, in order:
 *   1. Electron `safeStorage`  — OS keychain / DPAPI / libsecret (desktop).
 *   2. OS keyring via `keytar` — native keyring (lazy optional dependency).
 *   3. AES-256-GCM file        — master key from `DICO_SECRET_KEY` (or a KMS),
 *                                key NEVER stored beside the ciphertext.
 *   4. Refuse                  — if none is available we do NOT persist; the UI
 *                                disables the option rather than give false
 *                                assurance (no plaintext-in-a-file fallback).
 *
 * `DICO_SECRET_PROVIDER` (`safeStorage|keytar|aesgcm|none|auto`) forces a
 * provider — primarily for tests and power users. `DICO_SECRETS_FILE` overrides
 * the file location (tests).
 *
 * ANTI-PATTERNS (intentionally not implemented): storing the password in
 * `physical.yaml`/the project tree; an encryption key committed in the repo;
 * base64/reversible "encryption"; a single shared per-package secret file.
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { APP_DIR, ensureAppDir } from '../../utils/appDir.js';
import { logger } from '../../utils/logger.js';

const KEYTAR_SERVICE = 'smart-data-dico';

function secretsFilePath(): string {
  return process.env.DICO_SECRETS_FILE || path.join(APP_DIR, 'secrets.json');
}

// ─── 0600 JSON file store (used by the safeStorage + AES-GCM providers) ──────
type FileStore = Record<string, string>;

function readFileStore(): FileStore {
  const file = secretsFilePath();
  try {
    if (!fs.existsSync(file)) return {};
    return JSON.parse(fs.readFileSync(file, 'utf8')) as FileStore;
  } catch (e) {
    logger.warn(`Could not read secrets file: ${e}`);
    return {};
  }
}

function writeFileStore(store: FileStore): void {
  const file = secretsFilePath();
  ensureAppDir();
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(store), { mode: 0o600 });
  fs.renameSync(tmp, file);
  try { fs.chmodSync(file, 0o600); } catch { /* best-effort (Windows) */ }
}

// ─── Provider contract ───────────────────────────────────────────────────────
interface SecretProvider {
  readonly name: string;
  isAvailable(): Promise<boolean>;
  set(key: string, value: string): Promise<void>;
  get(key: string): Promise<string | null>;
  delete(key: string): Promise<void>;
  /** Delete every stored secret whose key belongs to `packageName`. */
  deleteByPrefix(prefix: string): Promise<void>;
}

// 1 ─ Electron safeStorage (OS-managed key). Encrypt/decrypt only; we store the
//     ciphertext ourselves in the 0600 file.
class SafeStorageProvider implements SecretProvider {
  readonly name = 'safeStorage';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private ss: any;
  async isAvailable(): Promise<boolean> {
    if (!process.versions.electron) return false;
    try {
      // Non-literal specifier: `electron` is only present in the desktop build,
      // so keep it out of static module resolution / the dependency graph.
      const mod = 'electron';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const electron: any = await import(/* @vite-ignore */ mod);
      const ss = electron?.safeStorage;
      if (ss?.isEncryptionAvailable?.()) { this.ss = ss; return true; }
    } catch { /* not in an Electron main process */ }
    return false;
  }
  async set(key: string, value: string): Promise<void> {
    const store = readFileStore();
    store[key] = (this.ss.encryptString(value) as Buffer).toString('base64');
    writeFileStore(store);
  }
  async get(key: string): Promise<string | null> {
    const enc = readFileStore()[key];
    if (!enc) return null;
    return this.ss.decryptString(Buffer.from(enc, 'base64'));
  }
  async delete(key: string): Promise<void> {
    const store = readFileStore();
    if (key in store) { delete store[key]; writeFileStore(store); }
  }
  async deleteByPrefix(prefix: string): Promise<void> {
    const store = readFileStore();
    let changed = false;
    for (const k of Object.keys(store)) if (k.startsWith(prefix)) { delete store[k]; changed = true; }
    if (changed) writeFileStore(store);
  }
}

// 2 ─ OS keyring via keytar (lazy optional dep). The OS owns the key + storage.
class KeytarProvider implements SecretProvider {
  readonly name = 'keytar';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private keytar: any;
  async isAvailable(): Promise<boolean> {
    try {
      // Non-literal specifier: keytar is an optional native dependency (may be
      // absent); keep it out of static resolution and load it lazily.
      const name = 'keytar';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mod: any = await import(/* @vite-ignore */ name).catch(() => null);
      const keytar = mod?.default ?? mod;
      if (keytar?.getPassword) { this.keytar = keytar; return true; }
    } catch { /* native module not installed */ }
    return false;
  }
  async set(key: string, value: string): Promise<void> { await this.keytar.setPassword(KEYTAR_SERVICE, key, value); }
  async get(key: string): Promise<string | null> { return (await this.keytar.getPassword(KEYTAR_SERVICE, key)) ?? null; }
  async delete(key: string): Promise<void> { await this.keytar.deletePassword(KEYTAR_SERVICE, key); }
  async deleteByPrefix(prefix: string): Promise<void> {
    const creds: Array<{ account: string }> = await this.keytar.findCredentials(KEYTAR_SERVICE).catch(() => []);
    for (const c of creds) if (c.account.startsWith(prefix)) await this.keytar.deletePassword(KEYTAR_SERVICE, c.account);
  }
}

// 3 ─ AES-256-GCM envelope encryption. Key derived (scrypt) from DICO_SECRET_KEY
//     which is provided out-of-band (env/KMS) — never stored beside the ciphertext.
class AesGcmProvider implements SecretProvider {
  readonly name = 'aesgcm';
  private key(): Buffer | null {
    const secret = process.env.DICO_SECRET_KEY;
    if (!secret || secret.length < 8) return null;
    // Static salt: the master key is the real secret; this only stretches it to 32 bytes.
    return crypto.scryptSync(secret, 'dico-secret-store-v1', 32);
  }
  async isAvailable(): Promise<boolean> { return this.key() !== null; }
  async set(key: string, value: string): Promise<void> {
    const k = this.key()!;
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', k, iv);
    const ct = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    const store = readFileStore();
    store[key] = `gcm1:${iv.toString('base64')}:${tag.toString('base64')}:${ct.toString('base64')}`;
    writeFileStore(store);
  }
  async get(key: string): Promise<string | null> {
    const blob = readFileStore()[key];
    if (!blob || !blob.startsWith('gcm1:')) return null;
    const k = this.key();
    if (!k) return null;
    const [, ivB, tagB, ctB] = blob.split(':');
    try {
      const decipher = crypto.createDecipheriv('aes-256-gcm', k, Buffer.from(ivB, 'base64'));
      decipher.setAuthTag(Buffer.from(tagB, 'base64'));
      return Buffer.concat([decipher.update(Buffer.from(ctB, 'base64')), decipher.final()]).toString('utf8');
    } catch (e) {
      logger.warn(`Failed to decrypt stored secret (wrong DICO_SECRET_KEY?): ${e}`);
      return null;
    }
  }
  async delete(key: string): Promise<void> {
    const store = readFileStore();
    if (key in store) { delete store[key]; writeFileStore(store); }
  }
  async deleteByPrefix(prefix: string): Promise<void> {
    const store = readFileStore();
    let changed = false;
    for (const k of Object.keys(store)) if (k.startsWith(prefix)) { delete store[k]; changed = true; }
    if (changed) writeFileStore(store);
  }
}

const PROVIDERS: SecretProvider[] = [new SafeStorageProvider(), new KeytarProvider(), new AesGcmProvider()];

let selected: SecretProvider | null | undefined; // undefined = not yet resolved, null = none available

async function resolveProvider(): Promise<SecretProvider | null> {
  if (selected !== undefined) return selected;
  const forced = process.env.DICO_SECRET_PROVIDER;
  if (forced === 'none') return (selected = null);
  const chain = forced && forced !== 'auto' ? PROVIDERS.filter((p) => p.name === forced) : PROVIDERS;
  for (const p of chain) {
    try { if (await p.isAvailable()) return (selected = p); } catch { /* try next */ }
  }
  return (selected = null);
}

/** Test/hook: force re-evaluation of the provider chain (env may have changed). */
export function resetSecretProvider(): void { selected = undefined; }

export interface SecretCapabilities { canStore: boolean; provider: string | null; reason?: string }

export async function capabilities(): Promise<SecretCapabilities> {
  const p = await resolveProvider();
  if (p) return { canStore: true, provider: p.name };
  return {
    canStore: false,
    provider: null,
    reason: 'No secure secret store on this machine. Install an OS keyring (keytar) or set DICO_SECRET_KEY to enable saving passwords.',
  };
}

/** Stable, non-secret key for a (package, connection identity). packageName is a
 *  cleartext prefix so a package's secrets can be forgotten in one call. */
export function secretKey(packageName: string, dialect: string, connection: Record<string, unknown>, user: string): string {
  const stable = JSON.stringify({ dialect, connection: sortKeys(connection), user });
  const fp = crypto.createHash('sha256').update(stable).digest('hex').slice(0, 32);
  return `${packageName}::${fp}`;
}

function sortKeys(o: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]));
}

/** Persist a password. Throws if no secure provider is available. */
export async function saveSecret(key: string, password: string): Promise<void> {
  const p = await resolveProvider();
  if (!p) throw new Error('No secure secret store available; refusing to persist the password.');
  await p.set(key, password);
}

export async function getSecret(key: string): Promise<string | null> {
  const p = await resolveProvider();
  return p ? p.get(key).catch(() => null) : null;
}

export async function deleteSecret(key: string): Promise<void> {
  const p = await resolveProvider();
  if (p) await p.delete(key).catch(() => {});
}

/** Forget every saved secret for a package (all connection identities). */
export async function deleteSecretsForPackage(packageName: string): Promise<void> {
  const p = await resolveProvider();
  if (p) await p.deleteByPrefix(`${packageName}::`).catch(() => {});
}
