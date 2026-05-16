/**
 * Search Plugin
 *
 * Declares ownership of /search, /entities/flat routes.
 * Search results are written as dynamic Store-FS files (in-memory Redux;
 * no autosave to backend). See #154 reframe for rationale.
 *
 * NOTE: Search result files accumulate in Store FS state for the lifetime of
 * the session; no cleanup mechanism is implemented. A follow-up ticket should
 * add a TTL-based cleanup listener on `search.completed` that removes sibling
 * `search-*.json` files older than N minutes via `actions.removeNode(path)`.
 */

import type { PluginModule } from '@hamak/microkernel-spi';
import { STORE_MANAGER_TOKEN, type IStoreManager } from '@hamak/ui-store-api';
import type { StoreFileSystemFacade } from '@hamak/ui-store-impl';
import { SEARCH_SERVICE_TOKEN, STORE_FS_TOKEN } from '../../kernel/tokens';
import { SearchService } from './services/SearchService';
import type { SearchFilters, SearchResponse } from './services/SearchService';
import type { RootState } from '../../kernel/bootstrap';

/**
 * Store FS folder under which search-result dynamic files are written.
 * Path segments only — no leading/trailing separators. The plugin will
 * `mkdir(workingFolder, true)` once during the command handler.
 *
 * Default: `['dictionaries', '.dico', 'search']`.
 *
 * Files are written via `setFile`, which does NOT trigger autosave
 * (verified at `autosave-middleware.js:15-18` — only `set-file-content`
 * and `update-file-content` match). Net effect: files are in-memory Redux only.
 *
 * For truly ephemeral results, pass `['tmp', 'search']` (outside the
 * `dictionaries/` mount). The path translator's `toRemotePath` returns
 * `undefined` for non-mount paths, so even an accidental `setFileContent`
 * would no-op silently.
 */
export interface SearchPluginOptions {
  workingFolder?: string[];
}

/** Shape written to `<workingFolder>/search-<id>.json` as the file content. */
export interface SearchResultFileContent {
  /** ID is the trailing segment of the path's basename minus `search-` prefix. */
  id: string;
  query: string;
  filters?: SearchFilters;
  /** ISO-8601 UTC timestamp. */
  timestamp: string;
  /** Full backend envelope, NOT just `results` — keeps debuggability. */
  response: SearchResponse;
}

/** Return shape of `commands.run('search.search', …)`. */
export interface SearchCommandResult {
  /** Store FS path of the dynamic file just written. */
  path: string[];
  /** Inline copy of the backend response — saves callers a Store-FS read. */
  response: SearchResponse;
}

const DEFAULT_WORKING_FOLDER: readonly string[] = Object.freeze([
  'dictionaries', '.dico', 'search',
]);

/**
 * Inline 6-char alphanumeric id generator.
 * Avoids adding a `nanoid` dependency (spec Risk 3).
 * Shape: 6 lowercase base36 characters, matches `/^[a-z0-9]{6}$/`.
 */
function generateId(): string {
  const CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => CHARS[b % CHARS.length]).join('');
}

export function createSearchPlugin(options: SearchPluginOptions = {}): PluginModule {
  const workingFolder: string[] = options.workingFolder
    ? [...options.workingFolder]
    : [...DEFAULT_WORKING_FOLDER];

  return {
    async initialize(ctx) {
      ctx.views.register('routes.search', () => ({
        routes: [
          '/search',
          '/entities/flat',
          '/flat/**',
          '/tree/**',
        ],
      }));

      // #155-search: Pattern B service registration.
      // Eager useValue — no kernel deps; SearchService is self-contained.
      ctx.provide({
        provide: SEARCH_SERVICE_TOKEN,
        useValue: new SearchService(),
      });

      // Resolve Store FS + store manager — 'store-fs' must be in dependsOn
      // (bootstrap.ts change). STORE_FS_TOKEN returns the lazy Proxy at
      // initialize time; the command handler below only invokes its methods
      // at command-run time, by which point activate has fired.
      const storeFs = ctx.resolve<StoreFileSystemFacade<RootState>>(STORE_FS_TOKEN);
      const storeManager = ctx.resolve<IStoreManager>(STORE_MANAGER_TOKEN);

      // #163 + #154: register search.search command.
      // Returns { path, response } instead of the raw SearchResponse.
      const search = ctx.resolve<SearchService>(SEARCH_SERVICE_TOKEN);
      ctx.commands.register('search.search', async ({ query, filters }: { query: string; filters?: SearchFilters }): Promise<SearchCommandResult> => {
        const response = await search.searchEntities(query, filters);
        const id = generateId();
        const path = [...workingFolder, `search-${id}.json`];

        const actions = storeFs.getActions();
        // mkdir is idempotent (fs-commands.js:79 — re-mkdir of an existing
        // directory is a no-op). `parents: true` walks the path-tail from
        // root, creating any missing ancestors.
        storeManager.dispatch(actions.mkdir(workingFolder, true));

        const fileContent: SearchResultFileContent = {
          id,
          query,
          filters,
          timestamp: new Date().toISOString(),
          response,
        };
        // `setFile` does NOT trigger autosave (autosave-middleware.js:15-18 —
        // only `set-file-content` and `update-file-content` match). The
        // dynamic file lives in Redux memory; no PUT to the backend.
        storeManager.dispatch(
          actions.setFile(
            path,
            fileContent,
            'application/json',
            { override: true, contentIsPresent: true },
          ),
        );

        ctx.hooks.emit('search.completed', { path, query });
        return { path, response };
      });
    },

    async activate(_ctx) {
      console.log('[search] Plugin activated');
    },
  };
}
