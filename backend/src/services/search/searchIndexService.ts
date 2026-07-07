/**
 * SearchIndexService — process-wide owner of the SearchIndex (#search-index).
 *
 * Wires the FTS5 index to the two things it needs: the package loader (to build
 * documents) and the projection event bus (to stay fresh). Lifecycle mirrors
 * UuidIndex — `init()` opens + full-rebuilds once at boot, `subscribe()` keeps
 * it incrementally up to date on every write. All failures are swallowed to a
 * warning: if the index can't build, `search()` returns [] and callers fall
 * back to the legacy scan, so search never hard-breaks.
 *
 * Scope note: like the frontend spotlight (`buildRecords`), this indexes each
 * top-level package's own entities/relationships/cases. Deep subpackage entity
 * recursion is a documented follow-up.
 */
import { SearchIndex, searchIndexPathFor, type SearchHit, type SearchOptions } from './searchIndex.js';
import { config } from '../../kernel/config.js';
import { logger } from '../../utils/logger.js';
import type { Package } from '../../models/Dictionary.js';
import type {
  LogicalProjection,
  ProjectionInvalidationEvent,
  Unsubscribe,
} from '../../storage/projection/LogicalProjection.js';

const RESERVED_DIRS = new Set(['.dico', '.git', 'node_modules']);

let index: SearchIndex | null = null;

/** The live index, or null before init / when SQLite is unavailable. */
export function getSearchIndex(): SearchIndex | null {
  return index && index.isReady() ? index : null;
}

/** Convenience: ranked search, or [] when the index isn't ready. */
export function searchModel(query: string, opts?: SearchOptions): SearchHit[] {
  return getSearchIndex()?.search(query, opts) ?? [];
}

// Lazy import to avoid a static cycle (dictionaryService → … → this module).
async function loadAllPackages(): Promise<Package[]> {
  const { dictionaryService } = await import('../dictionaryService.js');
  return dictionaryService.listAllPackagesAndEntities();
}

async function loadOnePackage(name: string): Promise<Package | null> {
  const { dictionaryService } = await import('../dictionaryService.js');
  return dictionaryService.getPackageByPath(name, []);
}

/**
 * Open the index and do a full rebuild from disk. Returns true if the index is
 * live afterward. Safe to call again (re-opens only if needed).
 */
export async function initSearchIndex(): Promise<boolean> {
  if (!index) index = new SearchIndex(searchIndexPathFor(config.dataDir));
  const ok = await index.open();
  if (!ok) return false;
  try {
    const packages = await loadAllPackages();
    index.rebuildFrom(packages);
    logger.info(`SearchIndex: built (${index.count()} docs from ${packages.length} packages)`);
  } catch (e) {
    logger.warn(`SearchIndex: initial build failed — ${e instanceof Error ? e.message : String(e)}`);
  }
  return index.isReady();
}

/** Re-index a single top-level package by name (or drop it if gone). */
export async function reindexPackageByName(name: string): Promise<void> {
  const idx = getSearchIndex();
  if (!idx || !name) return;
  try {
    const pkg = await loadOnePackage(name);
    if (pkg) idx.reindexPackage(pkg);
    else idx.removePackage(name);
  } catch (e) {
    logger.warn(`SearchIndex: reindex of "${name}" failed — ${e instanceof Error ? e.message : String(e)}`);
  }
}

/**
 * Derive the owning top-level package from a projection event. Logical paths
 * look like `packages/<pkg>/entities/<name>`; raw physical paths on the
 * git/disk backend are `<pkg>/...` (no `packages/` prefix). Returns null for
 * events that don't map to a single package (→ caller full-rebuilds).
 */
export function packageOfEvent(event: ProjectionInvalidationEvent): string | null {
  const fromLogical = (p?: string): string | null => {
    if (!p) return null;
    const segs = p.split('/').filter(Boolean);
    const i = segs.indexOf('packages');
    const name = i >= 0 ? segs[i + 1] : segs[0];
    return name && !RESERVED_DIRS.has(name) ? name : null;
  };
  switch (event.kind) {
    case 'entity-written':
    case 'entity-deleted':
    case 'case-written':
    case 'case-deleted':
      return fromLogical(event.logicalPath);
    case 'relationships-written':
      return fromLogical(event.packagePath);
    case 'rule-written':
      return event.scope === 'package' || event.scope === 'case' ? fromLogical(event.anchorLogicalPath) : null;
    case 'rule-deleted':
      return null; // no anchor path on delete → full rebuild
    case 'raw-changed': {
      const segs = event.physicalPath.replace(/\\/g, '/').split('/').filter(Boolean);
      if (segs.length < 2) return null; // workspace-root file → full rebuild
      return RESERVED_DIRS.has(segs[0]) ? null : segs[0];
    }
    default:
      return null;
  }
}

/**
 * Subscribe to projection invalidations and keep the index fresh. A resolvable
 * package is reindexed in isolation; an unresolvable event (global rule, root
 * file) triggers a debounced full rebuild. Returns an Unsubscribe (tests).
 */
export function subscribeSearchIndex(projection: LogicalProjection): Unsubscribe {
  let rebuildTimer: NodeJS.Timeout | null = null;
  const scheduleFullRebuild = () => {
    if (rebuildTimer) return;
    rebuildTimer = setTimeout(() => {
      rebuildTimer = null;
      void (async () => {
        const idx = getSearchIndex();
        if (!idx) return;
        try {
          idx.rebuildFrom(await loadAllPackages());
        } catch (e) {
          logger.warn(`SearchIndex: full rebuild failed — ${e instanceof Error ? e.message : String(e)}`);
        }
      })();
    }, 250);
  };

  return projection.onInvalidate((event) => {
    if (!getSearchIndex()) return;
    const pkg = packageOfEvent(event);
    if (pkg) void reindexPackageByName(pkg);
    else scheduleFullRebuild();
  });
}

/** Test helper — reset the singleton. */
export function resetSearchIndexForTest(): void {
  index?.close();
  index = null;
}

/** Test helper — inject a ready index so tool glue can be exercised in isolation. */
export function __setSearchIndexForTest(idx: SearchIndex | null): void {
  index = idx;
}
