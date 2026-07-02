/**
 * Secret store (#209) — provider selection, AES-GCM round-trip, refusal when no
 * secure provider is available, and package-scoped deletion. Tests force the
 * AES-GCM provider (DICO_SECRET_PROVIDER=aesgcm + DICO_SECRET_KEY) against a
 * throwaway secrets file so the OS keyring is never touched.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  capabilities,
  secretKey,
  saveSecret,
  getSecret,
  deleteSecret,
  deleteSecretsForPackage,
  resetSecretProvider,
} from '../secretStore.js';

let secretsFile: string;

function useAesGcm(key = 'super-secret-master-key') {
  process.env.DICO_SECRET_PROVIDER = 'aesgcm';
  process.env.DICO_SECRET_KEY = key;
  resetSecretProvider();
}

beforeEach(() => {
  secretsFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dico-secrets-')), 'secrets.json');
  process.env.DICO_SECRETS_FILE = secretsFile;
  useAesGcm();
});

afterEach(() => {
  delete process.env.DICO_SECRET_PROVIDER;
  delete process.env.DICO_SECRET_KEY;
  delete process.env.DICO_SECRETS_FILE;
  resetSecretProvider();
  try { fs.rmSync(path.dirname(secretsFile), { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('capabilities', () => {
  it('reports the AES-GCM provider when DICO_SECRET_KEY is set', async () => {
    const caps = await capabilities();
    expect(caps).toEqual({ canStore: true, provider: 'aesgcm' });
  });

  it('refuses (canStore=false) when no provider is available', async () => {
    process.env.DICO_SECRET_PROVIDER = 'none';
    resetSecretProvider();
    const caps = await capabilities();
    expect(caps.canStore).toBe(false);
    expect(caps.provider).toBeNull();
    expect(caps.reason).toMatch(/keyring|DICO_SECRET_KEY/i);
  });

  it('refuses when aesgcm is selected but no key is present', async () => {
    delete process.env.DICO_SECRET_KEY;
    resetSecretProvider();
    expect((await capabilities()).canStore).toBe(false);
  });
});

describe('secretKey', () => {
  it('is stable across connection-field ordering and prefixed by package', () => {
    const a = secretKey('orders', 'postgres', { host: 'h', port: 5432, database: 'o' }, 'app', 'u1');
    const b = secretKey('orders', 'postgres', { database: 'o', port: 5432, host: 'h' }, 'app', 'u1');
    expect(a).toBe(b);
    expect(a.startsWith('orders::')).toBe(true);
  });

  it('differs by db-user, connection, package, and app-user', () => {
    const base = secretKey('orders', 'postgres', { host: 'h' }, 'app', 'u1');
    expect(secretKey('orders', 'postgres', { host: 'h' }, 'other', 'u1')).not.toBe(base);
    expect(secretKey('orders', 'postgres', { host: 'other' }, 'app', 'u1')).not.toBe(base);
    expect(secretKey('billing', 'postgres', { host: 'h' }, 'app', 'u1')).not.toBe(base);
    expect(secretKey('orders', 'postgres', { host: 'h' }, 'app', 'u2')).not.toBe(base); // app-user isolation
  });
});

describe('app-user isolation', () => {
  it('one app user cannot read or forget another app user\'s secret', async () => {
    const k1 = secretKey('orders', 'postgres', { host: 'h' }, 'app', 'u1');
    const k2 = secretKey('orders', 'postgres', { host: 'h' }, 'app', 'u2');
    await saveSecret(k1, 'u1-secret');
    await saveSecret(k2, 'u2-secret');

    expect(await getSecret(k2)).toBe('u2-secret'); // u2 sees only its own
    await deleteSecretsForPackage('orders', 'u1'); // u1 forgets its package secrets
    expect(await getSecret(k1)).toBeNull();
    expect(await getSecret(k2)).toBe('u2-secret'); // u2 untouched
  });
});

describe('AES-GCM round-trip', () => {
  it('saves and retrieves a password', async () => {
    const k = secretKey('orders', 'postgres', { host: 'h' }, 'app', 'u1');
    await saveSecret(k, 's3cr3t');
    expect(await getSecret(k)).toBe('s3cr3t');
  });

  it('writes the secrets file with 0600 perms and no plaintext', async () => {
    const k = secretKey('orders', 'postgres', { host: 'h' }, 'app', 'u1');
    await saveSecret(k, 'plaintext-password');
    const raw = fs.readFileSync(secretsFile, 'utf8');
    expect(raw).not.toContain('plaintext-password');
    expect(raw).toMatch(/gcm1:/);
    if (process.platform !== 'win32') {
      expect(fs.statSync(secretsFile).mode & 0o777).toBe(0o600);
    }
  });

  it('returns null for a missing key', async () => {
    expect(await getSecret(secretKey('orders', 'postgres', { host: 'h' }, 'nobody', 'u1'))).toBeNull();
  });

  it('cannot decrypt with a different master key', async () => {
    const k = secretKey('orders', 'postgres', { host: 'h' }, 'app', 'u1');
    await saveSecret(k, 's3cr3t');
    useAesGcm('a-totally-different-key'); // rotate the master key
    expect(await getSecret(k)).toBeNull();
  });
});

describe('deletion', () => {
  it('deleteSecret removes one entry', async () => {
    const k = secretKey('orders', 'postgres', { host: 'h' }, 'app', 'u1');
    await saveSecret(k, 's3cr3t');
    await deleteSecret(k);
    expect(await getSecret(k)).toBeNull();
  });

  it('deleteSecretsForPackage removes only that package', async () => {
    const ordersA = secretKey('orders', 'postgres', { host: 'h' }, 'app', 'u1');
    const ordersB = secretKey('orders', 'postgres', { host: 'h2' }, 'app', 'u1');
    const billing = secretKey('billing', 'postgres', { host: 'h' }, 'app', 'u1');
    await saveSecret(ordersA, 'a');
    await saveSecret(ordersB, 'b');
    await saveSecret(billing, 'c');

    await deleteSecretsForPackage('orders', 'u1');

    expect(await getSecret(ordersA)).toBeNull();
    expect(await getSecret(ordersB)).toBeNull();
    expect(await getSecret(billing)).toBe('c'); // untouched
  });
});

describe('refusal', () => {
  it('saveSecret throws when no secure provider is available', async () => {
    process.env.DICO_SECRET_PROVIDER = 'none';
    resetSecretProvider();
    await expect(saveSecret('orders::x', 's3cr3t')).rejects.toThrow(/refus/i);
  });

  it('getSecret returns null (never throws) when no provider is available', async () => {
    process.env.DICO_SECRET_PROVIDER = 'none';
    resetSecretProvider();
    expect(await getSecret('orders::x')).toBeNull();
  });
});
