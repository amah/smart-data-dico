/**
 * modelOverviewCache (#grounding perf) — memoizes buildModelOverview so the
 * per-turn model snapshot costs zero IO on an unchanged model.
 *
 * Contract under test:
 *  - first call builds, calls within TTL serve the cached value (same ref)
 *  - invalidateModelOverviewCache() drops the cache → next call rebuilds
 *  - TTL backstop: at exactly MODEL_OVERVIEW_TTL_MS the entry is stale
 *  - concurrent callers share ONE in-flight build
 *  - a rejected build is NOT cached — the rejection propagates and the next
 *    call retries
 *  - subscribeModelOverviewCache wires invalidation to the projection bus
 *
 * The module keeps its state (cached / inflight) at module level, so every
 * test loads a FRESH copy via jest.resetModules() + dynamic import. Time is
 * controlled by spying on Date.now (the seam the module reads).
 */

type CacheModule = typeof import('../modelOverviewCache.js');

describe('modelOverviewCache', () => {
  let cache: CacheModule;
  let now: number;

  beforeEach(async () => {
    jest.resetModules();
    cache = await import('../modelOverviewCache.js');
    now = 1_000_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /** A promise with externally-controlled settle, for in-flight tests. */
  function deferred<T>() {
    let resolve!: (v: T) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
  }

  it('exports the documented TTL backstop of 60s', () => {
    expect(cache.MODEL_OVERVIEW_TTL_MS).toBe(60_000);
  });

  it('builds on the first call and serves the cache within the TTL (build fn called once, identical result)', async () => {
    const value = { summary: 'overview', totals: { entities: 3 } };
    const build = jest.fn(async () => value);

    const first = await cache.getModelOverviewCached(build);
    now += 1_000; // 1s later — well within the TTL
    const second = await cache.getModelOverviewCached(build);

    expect(build).toHaveBeenCalledTimes(1);
    expect(first).toBe(value);
    expect(second).toBe(first); // the SAME object, not a rebuild
  });

  it('serves the cache to a different build fn within the TTL (call sites pass fresh closures)', async () => {
    const buildA = jest.fn(async () => 'A');
    const buildB = jest.fn(async () => 'B');

    await cache.getModelOverviewCached(buildA);
    const got = await cache.getModelOverviewCached(buildB);

    expect(got).toBe('A');
    expect(buildB).not.toHaveBeenCalled();
  });

  it('invalidateModelOverviewCache() → the next call rebuilds', async () => {
    const build = jest.fn()
      .mockResolvedValueOnce('v1')
      .mockResolvedValueOnce('v2');

    expect(await cache.getModelOverviewCached(build)).toBe('v1');
    cache.invalidateModelOverviewCache();
    expect(await cache.getModelOverviewCached(build)).toBe('v2');
    expect(build).toHaveBeenCalledTimes(2);
  });

  it('TTL expiry → rebuild; one tick before the TTL → still cached', async () => {
    const build = jest.fn()
      .mockResolvedValueOnce('v1')
      .mockResolvedValueOnce('v2');

    await cache.getModelOverviewCached(build); // builtAt = now

    now += cache.MODEL_OVERVIEW_TTL_MS - 1; // just under → fresh
    expect(await cache.getModelOverviewCached(build)).toBe('v1');
    expect(build).toHaveBeenCalledTimes(1);

    now += 1; // exactly TTL since builtAt → stale (the check is strict `<`)
    expect(await cache.getModelOverviewCached(build)).toBe('v2');
    expect(build).toHaveBeenCalledTimes(2);
  });

  it('concurrent callers during an in-flight build share ONE build', async () => {
    const d = deferred<string>();
    const build = jest.fn(() => d.promise);

    const p1 = cache.getModelOverviewCached(build);
    const p2 = cache.getModelOverviewCached(build);
    expect(build).toHaveBeenCalledTimes(1); // second caller joined the in-flight build

    d.resolve('overview');
    await expect(p1).resolves.toBe('overview');
    await expect(p2).resolves.toBe('overview');
    expect(build).toHaveBeenCalledTimes(1);

    // ...and the shared result is now cached for later callers too.
    expect(await cache.getModelOverviewCached(build)).toBe('overview');
    expect(build).toHaveBeenCalledTimes(1);
  });

  it('an invalidation racing an in-flight build wins: the stale build is served but NOT cached', async () => {
    const d = deferred<string>();
    const build = jest.fn()
      .mockImplementationOnce(() => d.promise)   // slow build, snapshot predates the mutation
      .mockResolvedValueOnce('post-mutation');

    const p = cache.getModelOverviewCached(build);
    cache.invalidateModelOverviewCache(); // mutation lands mid-build
    d.resolve('pre-mutation');

    // the in-flight caller still gets the value it was waiting on…
    await expect(p).resolves.toBe('pre-mutation');
    // …but it was not cached: the next call rebuilds fresh instead of
    // masking the mutation until the TTL backstop.
    expect(await cache.getModelOverviewCached(build)).toBe('post-mutation');
    expect(build).toHaveBeenCalledTimes(2);
  });

  it('a rejected build is NOT cached: the rejection propagates and the next call retries', async () => {
    const boom = new Error('project scan failed');
    const build = jest.fn()
      .mockRejectedValueOnce(boom)
      .mockResolvedValueOnce('recovered');

    await expect(cache.getModelOverviewCached(build)).rejects.toThrow('project scan failed');

    // retry succeeds and its value is cached
    expect(await cache.getModelOverviewCached(build)).toBe('recovered');
    expect(await cache.getModelOverviewCached(build)).toBe('recovered');
    expect(build).toHaveBeenCalledTimes(2);
  });

  it('concurrent callers of a failing build all see the rejection (still one build)', async () => {
    const d = deferred<string>();
    const build = jest.fn(() => d.promise);

    const p1 = cache.getModelOverviewCached(build);
    const p2 = cache.getModelOverviewCached(build);
    d.reject(new Error('nope'));

    await expect(p1).rejects.toThrow('nope');
    await expect(p2).rejects.toThrow('nope');
    expect(build).toHaveBeenCalledTimes(1);
  });

  describe('subscribeModelOverviewCache', () => {
    it('registers on projection.onInvalidate and returns its unsubscribe', () => {
      const unsub = jest.fn();
      const projection = { onInvalidate: jest.fn(() => unsub) };

      const returned = cache.subscribeModelOverviewCache(projection);

      expect(projection.onInvalidate).toHaveBeenCalledTimes(1);
      expect(returned).toBe(unsub);
    });

    it('any projection invalidation event drops the cache → next call rebuilds', async () => {
      const handlers: Array<(event: unknown) => void> = [];
      const projection = {
        onInvalidate: (cb: (event: unknown) => void) => { handlers.push(cb); return () => {}; },
      };
      cache.subscribeModelOverviewCache(projection);

      const build = jest.fn()
        .mockResolvedValueOnce('v1')
        .mockResolvedValueOnce('v2')
        .mockResolvedValueOnce('v3');

      expect(await cache.getModelOverviewCached(build)).toBe('v1');

      // The subscriber ignores the event kind — EVERY event invalidates
      // (entity-written, relationships-written, rule-written, raw-changed, …).
      handlers.forEach(h => h({ kind: 'entity-written', packageName: 'ordering' }));
      expect(await cache.getModelOverviewCached(build)).toBe('v2');

      handlers.forEach(h => h({ kind: 'raw-changed' }));
      expect(await cache.getModelOverviewCached(build)).toBe('v3');
      expect(build).toHaveBeenCalledTimes(3);
    });
  });
});
