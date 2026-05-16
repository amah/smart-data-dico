/**
 * Tests for the per-category auto-approve policy decoder (#59).
 *
 * The decoder is the single point of trust between localStorage and the
 * runtime policy lookup — any malformed value MUST fall back to the
 * default for that category. We never want a user with a corrupted
 * `ai-auto-approve-policy` entry to silently get their `create` policy
 * flipped to `auto`.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  AI_AUTO_APPROVE_POLICY_KEY,
  AI_AUTO_APPROVE_LEGACY_KEY,
  DEFAULT_AI_AUTO_APPROVE_POLICY,
  decodePolicy,
  loadPolicy,
  savePolicy,
  shouldAutoApprove,
  getEffectivePolicy,
} from '../aiAutoApprovePolicy';

class MemoryStorage implements Storage {
  private store = new Map<string, string>();
  get length() { return this.store.size; }
  clear() { this.store.clear(); }
  getItem(key: string) { return this.store.has(key) ? this.store.get(key)! : null; }
  key(i: number) { return Array.from(this.store.keys())[i] ?? null; }
  removeItem(key: string) { this.store.delete(key); }
  setItem(key: string, value: string) { this.store.set(key, String(value)); }
}

describe('decodePolicy', () => {
  it('returns the default policy when the input is null', () => {
    expect(decodePolicy(null)).toEqual(DEFAULT_AI_AUTO_APPROVE_POLICY);
  });

  it('returns the default policy when the input is an empty string', () => {
    expect(decodePolicy('')).toEqual(DEFAULT_AI_AUTO_APPROVE_POLICY);
  });

  it('returns the default policy when the JSON is malformed', () => {
    expect(decodePolicy('{not json')).toEqual(DEFAULT_AI_AUTO_APPROVE_POLICY);
  });

  it('returns the default policy when the parsed value is a non-object', () => {
    expect(decodePolicy('"auto"')).toEqual(DEFAULT_AI_AUTO_APPROVE_POLICY);
    expect(decodePolicy('42')).toEqual(DEFAULT_AI_AUTO_APPROVE_POLICY);
    expect(decodePolicy('null')).toEqual(DEFAULT_AI_AUTO_APPROVE_POLICY);
  });

  it('decodes a complete, valid policy object', () => {
    const raw = JSON.stringify({
      read: 'auto',
      navigate: 'auto',
      create: 'review',
      modify: 'review',
      delete: 'review',
    });
    expect(decodePolicy(raw)).toEqual({
      read: 'auto',
      navigate: 'auto',
      create: 'review',
      modify: 'review',
      delete: 'review',
    });
  });

  it('fills missing categories from the default policy', () => {
    const raw = JSON.stringify({ read: 'review' });
    expect(decodePolicy(raw)).toEqual({
      ...DEFAULT_AI_AUTO_APPROVE_POLICY,
      read: 'review',
    });
  });

  it('discards unknown category keys without breaking the rest', () => {
    const raw = JSON.stringify({ read: 'auto', wat: 'auto', create: 'review' });
    const decoded = decodePolicy(raw);
    expect(decoded).toEqual({
      ...DEFAULT_AI_AUTO_APPROVE_POLICY,
      read: 'auto',
      create: 'review',
    });
    expect((decoded as Record<string, unknown>).wat).toBeUndefined();
  });

  it('discards invalid decision values without breaking the rest', () => {
    const raw = JSON.stringify({ read: 'always', create: 'review' });
    expect(decodePolicy(raw)).toEqual({
      ...DEFAULT_AI_AUTO_APPROVE_POLICY,
      // `always` is not a valid decision; falls back to default ('auto')
      read: 'auto',
      create: 'review',
    });
  });

  it('returns a fresh object — mutating the result does not pollute defaults', () => {
    const a = decodePolicy(null);
    a.create = 'auto';
    const b = decodePolicy(null);
    expect(b.create).toBe('review');
  });
});

describe('loadPolicy', () => {
  let storage: MemoryStorage;

  beforeEach(() => {
    storage = new MemoryStorage();
  });

  it('returns the default policy when neither v2 nor legacy keys are set', () => {
    expect(loadPolicy(storage)).toEqual(DEFAULT_AI_AUTO_APPROVE_POLICY);
  });

  it('loads and clamps the v2 policy from storage', () => {
    storage.setItem(
      AI_AUTO_APPROVE_POLICY_KEY,
      // Hand-edited storage with delete=auto must be clamped to review.
      JSON.stringify({ read: 'auto', navigate: 'auto', create: 'auto', modify: 'auto', delete: 'auto' }),
    );
    expect(loadPolicy(storage)).toEqual({
      read: 'auto',
      navigate: 'auto',
      create: 'auto',
      modify: 'auto',
      delete: 'review',
    });
  });

  it('migrates the legacy `ai-auto-approve=false` to all-review', () => {
    storage.setItem(AI_AUTO_APPROVE_LEGACY_KEY, 'false');
    expect(loadPolicy(storage)).toEqual({
      read: 'review',
      navigate: 'review',
      create: 'review',
      modify: 'review',
      delete: 'review',
    });
  });

  it('ignores the legacy key when the v2 key is present', () => {
    storage.setItem(AI_AUTO_APPROVE_LEGACY_KEY, 'false');
    storage.setItem(
      AI_AUTO_APPROVE_POLICY_KEY,
      JSON.stringify({ read: 'auto', navigate: 'auto', create: 'review', modify: 'review', delete: 'review' }),
    );
    expect(loadPolicy(storage)).toEqual(DEFAULT_AI_AUTO_APPROVE_POLICY);
  });
});

describe('savePolicy', () => {
  it('writes a JSON-encoded effective policy to the v2 key', () => {
    const storage = new MemoryStorage();
    savePolicy(
      { read: 'auto', navigate: 'review', create: 'review', modify: 'review', delete: 'auto' },
      storage,
    );
    const raw = storage.getItem(AI_AUTO_APPROVE_POLICY_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    // delete=auto was clamped to delete=review on save.
    expect(parsed.delete).toBe('review');
    expect(parsed.read).toBe('auto');
    expect(parsed.navigate).toBe('review');
  });
});

describe('shouldAutoApprove', () => {
  const policy = {
    read: 'auto' as const,
    navigate: 'auto' as const,
    create: 'review' as const,
    modify: 'review' as const,
    delete: 'review' as const,
  };

  it('returns true when the category is set to auto', () => {
    expect(shouldAutoApprove(policy, 'read')).toBe(true);
    expect(shouldAutoApprove(policy, 'navigate')).toBe(true);
  });

  it('returns false when the category is set to review', () => {
    expect(shouldAutoApprove(policy, 'create')).toBe(false);
    expect(shouldAutoApprove(policy, 'modify')).toBe(false);
  });

  it('returns false (review) when the category is missing or null', () => {
    expect(shouldAutoApprove(policy, undefined)).toBe(false);
    expect(shouldAutoApprove(policy, null)).toBe(false);
  });

  it('always returns false for delete even if storage was tampered with', () => {
    const tampered = { ...policy, delete: 'auto' as const };
    expect(shouldAutoApprove(tampered, 'delete')).toBe(false);
    // getEffectivePolicy clamps the underlying value too.
    expect(getEffectivePolicy(tampered).delete).toBe('review');
  });
});
