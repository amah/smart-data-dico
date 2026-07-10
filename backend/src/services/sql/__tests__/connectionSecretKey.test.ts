/**
 * Secret-key derivation for the named connection library (#connection-library).
 *
 * `connectionSecretKey` is id-scoped (`conn::<id>::<userTag>`) so editing a
 * saved connection's host/user keeps the password attached, while the legacy
 * `secretKey` stays identity-scoped — pinned here so the new key can never
 * silently change shape and orphan every stored password.
 */
import { connectionSecretKey, secretKey, userTag } from '../secretStore.js';

describe('userTag', () => {
  it('is a short non-secret 12-hex tag of the app user', () => {
    expect(userTag('u1')).toMatch(/^[0-9a-f]{12}$/);
    expect(userTag('u1')).toBe('bb82030dbc2b'); // pinned: changing this orphans all stored secrets
  });

  it('defaults to the `local` tag for a missing user (desktop/single-user mode)', () => {
    expect(userTag('')).toBe(userTag('local'));
  });

  it('never contains the raw app-user id', () => {
    expect(userTag('alice')).not.toContain('alice');
  });
});

describe('connectionSecretKey', () => {
  it('has the shape conn::<id>::<userTag>', () => {
    const key = connectionSecretKey('3f2a', 'u1');
    expect(key).toBe(`conn::3f2a::${userTag('u1')}`);
    expect(key).toMatch(/^conn::3f2a::[0-9a-f]{12}$/);
  });

  it('is stable for the same (id, app user)', () => {
    expect(connectionSecretKey('id-1', 'u1')).toBe(connectionSecretKey('id-1', 'u1'));
  });

  it('differs across app users and across connection ids', () => {
    const base = connectionSecretKey('id-1', 'u1');
    expect(connectionSecretKey('id-1', 'u2')).not.toBe(base);
    expect(connectionSecretKey('id-2', 'u1')).not.toBe(base);
  });

  it('depends only on (id, app user) — host/db-user edits keep the password attached', () => {
    // No connection params flow into the key at all; this pins the reason the
    // library key exists (edit host → same key → password survives).
    expect(connectionSecretKey('id-1', 'u1')).toBe(`conn::id-1::${userTag('u1')}`);
  });
});

describe('legacy secretKey — regression pin', () => {
  it('shape and exact value are unchanged by the connection-library work', () => {
    // Pinned literal: if this changes, every previously remembered ad-hoc
    // password becomes unreachable.
    expect(secretKey('orders', 'postgres', { host: 'h', port: 5432, database: 'o' }, 'app', 'u1'))
      .toBe('orders::bb82030dbc2b::bd690930b2ac429172382c3c9fd3c0bf');
  });

  it('is still order-insensitive over connection keys', () => {
    const a = secretKey('orders', 'postgres', { host: 'h', port: 5432, database: 'o' }, 'app', 'u1');
    const b = secretKey('orders', 'postgres', { database: 'o', host: 'h', port: 5432 }, 'app', 'u1');
    expect(a).toBe(b);
  });

  it('the two key namespaces cannot collide (conn:: prefix vs package prefix)', () => {
    const libKey = connectionSecretKey('abc', 'u1');
    const legacy = secretKey('conn', 'postgres', { host: 'h' }, 'app', 'u1');
    expect(libKey.startsWith('conn::abc::')).toBe(true);
    // a package literally named `conn` yields conn::<12-hex-tag>::<32-hex-fp>,
    // while library keys are conn::<uuid-or-id>::<12-hex-tag> — distinct shapes.
    expect(legacy).toMatch(/^conn::[0-9a-f]{12}::[0-9a-f]{32}$/);
    expect(libKey).not.toBe(legacy);
  });
});
