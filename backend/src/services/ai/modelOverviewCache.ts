/**
 * Model-overview cache (#grounding perf).
 *
 * buildModelOverview loads every package's entities + relationships plus all
 * seven concept services — a linear IO tax that was paid on EVERY chat turn
 * just to inject the per-turn model snapshot (at 40 packages / 3000 entities,
 * dozens of file reads per turn). This module memoizes the built overview.
 *
 * Freshness has two layers:
 *  - Event invalidation: `subscribeModelOverviewCache` hooks the SAME
 *    projection bus that keeps the search index fresh (server boot), so any
 *    model mutation — entity/relationship/rule writes, raw file changes picked
 *    up by the RawFsWatcher — drops the cache. The AI's own mutation tools
 *    additionally invalidate directly from the tool-gating wrappers, so a
 *    chat-created entity is visible in the very next turn even where the
 *    watcher is disabled.
 *  - TTL backstop (MODEL_OVERVIEW_TTL_MS): covers any write path that reaches
 *    the disk without firing the bus. A snapshot a few seconds stale is fine
 *    for grounding; stale forever is not.
 */

export const MODEL_OVERVIEW_TTL_MS = 60_000;

type Unsubscribe = () => void;

let cached: { value: unknown; builtAt: number } | null = null;
let inflight: Promise<unknown> | null = null;
// Bumped on every invalidation; a build only populates the cache if no
// invalidation landed while it was in flight (its snapshot may predate the
// mutation that fired the event).
let generation = 0;

/** Drop the cached overview; the next getModelOverviewCached() rebuilds. */
export function invalidateModelOverviewCache(): void {
  cached = null;
  generation++;
}

/**
 * Wire cache invalidation to the projection bus (called once at server boot,
 * beside subscribeSearchIndex). Every invalidation event — whatever its kind —
 * drops the cache; over-invalidation just costs one lazy rebuild.
 */
export function subscribeModelOverviewCache(
  projection: { onInvalidate(cb: (event: unknown) => void): Unsubscribe },
): Unsubscribe {
  return projection.onInvalidate(() => invalidateModelOverviewCache());
}

/**
 * Serve the cached overview when fresh, otherwise (re)build via `build`.
 * Concurrent callers share a single in-flight build. A failed build is not
 * cached — the next call retries.
 *
 * Callers all receive the SAME object — treat it as frozen; formatting /
 * serializing is fine, mutating it would poison every other consumer.
 */
export async function getModelOverviewCached<T>(build: () => Promise<T>): Promise<T> {
  if (cached && Date.now() - cached.builtAt < MODEL_OVERVIEW_TTL_MS) {
    return cached.value as T;
  }
  if (!inflight) {
    const startedAt = generation;
    inflight = build()
      .then((value) => {
        // Callers still get this build's value, but it isn't cached if an
        // invalidation raced it — the next call rebuilds fresh.
        if (generation === startedAt) cached = { value, builtAt: Date.now() };
        return value as unknown;
      })
      .finally(() => { inflight = null; });
  }
  return inflight as Promise<T>;
}
