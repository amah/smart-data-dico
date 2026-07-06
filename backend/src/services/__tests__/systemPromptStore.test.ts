/**
 * systemPromptStore — content-addressed dedupe for AI system prompts (#ai-export).
 * Uses a tiny in-memory IStorageBackend stub so the digest/put/get contract is
 * exercised without touching disk.
 */
import { SystemPromptStore, systemPromptDigest } from '../systemPromptStore.js';

// Minimal in-memory backend: only read/write are used by the store.
function memBackend() {
  const files = new Map<string, string>();
  const writes = { count: 0 };
  const backend = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async read(_ws: any, path: any): Promise<string> {
      const v = files.get(String(path));
      if (v === undefined) throw new Error('ENOENT');
      return v;
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async write(_ws: any, path: any, content: string): Promise<void> {
      writes.count++;
      files.set(String(path), content);
    },
  };
  return { backend, files, writes };
}

describe('systemPromptDigest', () => {
  it('is stable and content-addressed (same body → same digest, 16 hex)', () => {
    const a = systemPromptDigest('hello world');
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(systemPromptDigest('hello world')).toBe(a);
    expect(systemPromptDigest('different')).not.toBe(a);
  });
});

describe('SystemPromptStore', () => {
  it('stores once and dedupes identical bodies', async () => {
    const { backend, writes } = memBackend();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const store = new SystemPromptStore(backend as any);
    const body = 'You are an assistant.\n\nAUTHORING_RULES …';
    const d1 = await store.put(body);
    const d2 = await store.put(body); // same content → no second write
    expect(d1).toBe(d2);
    expect(writes.count).toBe(1);
    expect(await store.get(d1)).toBe(body);
  });

  it('returns null for an unknown or malformed digest', async () => {
    const { backend } = memBackend();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const store = new SystemPromptStore(backend as any);
    expect(await store.get('deadbeefdeadbeef')).toBeNull();
    expect(await store.get('not-a-digest!')).toBeNull();
  });
});
