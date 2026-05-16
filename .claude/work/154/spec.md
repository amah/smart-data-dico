# Spec — #154 (reframed): introduce `workingFolder` plugin option + convert searchSlice to dynamic Store-FS files

> **Reframe authority.** The ticket body (rendered as the "all 10 slices →
> REDUCER_REGISTRY_TOKEN" plan) is **superseded** by the user's reframe of
> 2026-05-16 captured in the spec-writer prompt. The reframe redirects #154
> from "rehome slices into plugins" to "introduce a `workingFolder` plugin
> factory option and prove the dynamic-file persistence pattern by
> converting `searchSlice` from Redux to Store FS-backed dynamic files."
> The mechanism (option a — string parameter on each plugin factory; NOT a
> new `WORKSPACE_REGISTRY_TOKEN`) and the deferral list are also from the
> reframe. The original plan's bigger Pattern A migrations (entity,
> package, case, rule, dictionary, diagram) remain **blocked on #167** and
> are listed under "Out of scope".

## Goal

Land two coupled mechanisms in a single ticket:

1. **`workingFolder` plugin-factory option.** Each domain plugin's factory
   (`createDataDictionaryPlugin`, `createSearchPlugin`,
   `createAiAssistancePlugin`, `createVisualizationPlugin`) gains an
   optional `workingFolder?: string` field on its options object, with a
   per-plugin sensible default. Bootstrap threads explicit values in.
   Today the value is informational + a prefix for any future Store-FS
   paths the plugin writes; it does NOT relocate existing hard-coded paths
   (stereotypes stays at `dictionaries/.dico/stereotypes.yaml`).

2. **Dynamic-file search results.** Delete `searchSlice.ts`. The
   `search.search` command writes each result to
   `<workingFolder>/search-<id>.json` (where `<id>` is a 6-char URL-safe
   random string) via `STORE_FS_TOKEN.getActions().setFile`. The command
   returns `{ path, response }` so the caller can subscribe by path **or**
   consume the inline response. `SearchComponent` keeps a single
   `useState<string[] | null>` for the **current** result path and reads
   the results through `useFile(path)` (cookbook §2 derivation). Other
   plugins/listeners can read the same file by path.

Quoted scope from the reframe: *"each plugin factory takes a
`workingFolder` string parameter at registration. The plugin's persistent
domain state lives as files in that folder via Store FS, not as a Redux
slice. […] `searchSlice` gets a special treatment: search results become
DYNAMIC FILES in the working folder (or `/tmp`). User's example phrasing:
`'search-xonncv'` — a meaningful prefix + generated id."*

## Files touched

- `frontend/src/plugins/search/searchPlugin.ts` — accept
  `{ workingFolder? }` on the factory; resolve `STORE_FS_TOKEN` +
  `STORE_MANAGER_TOKEN` during `initialize`; register the
  `search.search` command body so it writes a dynamic file and returns
  `{ path, response }`. Add `dependsOn: ['store', 'store-fs']` in
  `bootstrap.ts`.
- `frontend/src/plugins/search/services/SearchService.ts` — unchanged
  surface; remains the REST wrapper (Pattern B). The dynamic-file write
  is the plugin's responsibility, not the service's (keeps the service
  unit-testable without Store FS).
- `frontend/src/plugins/data-dictionary/dataDictionaryPlugin.ts` — accept
  `{ workingFolder? }` on the factory (default `'dictionaries'`).
  Currently informational — `StereotypeService` continues to hard-code
  `STEREOTYPES_PATH = ['dictionaries', '.dico', 'stereotypes.yaml']` (do
  not break the convention; see Decision D).
- `frontend/src/plugins/visualization/visualizationPlugin.ts` — accept
  `{ workingFolder? }` on the factory (default `'dictionaries'`).
  Informational only; visualization has no Store FS state today.
- `frontend/src/plugins/ai-assistance/aiPlugin.ts` — extend
  `AiPluginOptions` with `workingFolder?: string` (default
  `'dictionaries/.dico/ai'`). Informational only — chat state stays in
  AIChatPanel's local `useState` per #162 spec; AI Pattern A file work
  is deferred to a later ticket.
- `frontend/src/kernel/bootstrap.ts` — drop `searchReducer` import +
  `reducerRegistry.register('search', searchReducer)` call; thread
  explicit `workingFolder` values into the four plugin factories; add
  `'store-fs'` to the `search` plugin's `dependsOn`.
- `frontend/src/store/slices/searchSlice.ts` — **DELETE**. Dead-code
  today (no consumer reads `state.search.*`); the migrations from #163
  already routed components through `useCommand` / `commands.run`.
- `frontend/src/components/SearchComponent.tsx` — replace
  `useState<SearchResult[]>([])` with `useState<string[] | null>(null)`
  holding the current search-result-file path; derive `results` from
  `useService<StoreFileSystemFacade>(STORE_FS_TOKEN)` via a new helper
  hook (see "Public surface"); `error` and `loading` continue to live in
  `useState` per cookbook §2 Pattern-B note (no service-method-level
  Store-FS facade for Pattern B-shaped data) — see Risk 5 about whether
  to upgrade these to file-state.
- `frontend/src/plugins/search/services/__tests__/spec-grep-guards.search.test.ts`
  — **rewrite criterion #13**. Today the guard asserts `searchSlice.ts`
  exists and its thunk body calls `ctx.commands.run('search.search', …)`.
  After this ticket `searchSlice.ts` does not exist; the guard must
  instead assert that file's **absence** AND assert the search plugin's
  `initialize` registers the dynamic-file command body.
- `frontend/src/plugins/data-dictionary/services/__tests__/spec-grep-guards.commands.test.ts`
  — **rewrite criterion #16**. Today the guard asserts
  `searchSlice.ts calls commands.run for search.search`. Replace with a
  guard that `searchSlice.ts` does not exist.
- `frontend/src/plugins/search/__tests__/searchPlugin.commands.test.ts`
  — extend the existing test or add a sibling test asserting:
  (a) `commands.run('search.search', { query: 'x' })` resolves with a
  result shaped `{ path: string[]; response: SearchResponse }`;
  (b) `host.rootActivationCtx.resolve(STORE_FS_TOKEN).selectFileFromRoot(getState(), path)`
  returns a `FileNode<SearchResultFileContent>` whose `content.results`
  matches the MSW fixture.
- `frontend/src/components/__tests__/SearchComponent.test.tsx` — keep the
  existing `#16` / `#17` behavior assertions. The component should still
  render the result row and append filter params to the URL; no
  test-file edits expected if the component preserves UX. (Should the
  test fail due to async file-derived state, the test-author cycle adds
  `await screen.findByText('Order')` rather than altering the assertion.)

## Public surface (signatures)

```ts
// frontend/src/plugins/search/searchPlugin.ts
export interface SearchPluginOptions {
  /**
   * Store FS folder under which search-result dynamic files are written.
   * Path segments only — no leading/trailing separators. The plugin will
   * `mkdir(workingFolder, true)` once during `initialize`.
   *
   * Default: `['dictionaries', '.dico', 'search']`.
   *
   * Choose a path **under the remote-fs mount** (`dictionaries/`) only if
   * search results should hit the backend disk. The default sits under
   * `dictionaries/.dico/search`, which IS under the mount — so theoretical
   * writes via `setFileContent` would be PUT'd. We write via `setFile`,
   * which the framework explicitly does NOT autosave (verified at
   * `frontend/node_modules/@hamak/ui-store-impl/dist/middleware/autosave-middleware.js:15-18`).
   * Net effect: files are in-memory Redux only.
   *
   * For truly ephemeral results, pass `['tmp', 'search']` (or any path
   * outside `dictionaries/`). The path translator's `toRemotePath`
   * returns `undefined` for non-mount paths (verified at
   * `frontend/node_modules/@hamak/ui-remote-fs/dist/spi/providers/i-path-translator.js:19-30`),
   * so even an accidental `setFileContent` would no-op silently.
   */
  workingFolder?: string[];
}

export function createSearchPlugin(options?: SearchPluginOptions): PluginModule;

// frontend/src/plugins/data-dictionary/dataDictionaryPlugin.ts
export interface DataDictionaryPluginOptions {
  /**
   * Informational at this stage — does NOT relocate existing hard-coded
   * paths (`StereotypeService` keeps `STEREOTYPES_PATH`). Threading this
   * through lets future tickets parameterize without another factory
   * signature change.
   *
   * Default: `['dictionaries']` (the remote-fs mount root).
   */
  workingFolder?: string[];
}

export function createDataDictionaryPlugin(
  options?: DataDictionaryPluginOptions,
): PluginModule;

// frontend/src/plugins/visualization/visualizationPlugin.ts
export interface VisualizationPluginOptions {
  workingFolder?: string[]; // default ['dictionaries']; informational
}

export function createVisualizationPlugin(
  options?: VisualizationPluginOptions,
): PluginModule;

// frontend/src/plugins/ai-assistance/aiPlugin.ts
export interface AiPluginOptions {
  enabled?: boolean;
  /**
   * Informational at this stage. Default
   * `['dictionaries', '.dico', 'ai']`. AIService's Pattern A file work
   * (conversations / prompts as files) is a follow-up; today the value
   * is just stored on the plugin instance.
   */
  workingFolder?: string[];
}

// frontend/src/plugins/search/services/SearchService.ts
// (unchanged surface — keep the Pattern B REST wrapper as-is)
export interface SearchResponse { message: string; data: SearchResult[]; }
export interface SearchFilters { /* unchanged */ }
export class SearchService {
  searchEntities(query: string, filters?: SearchFilters): Promise<SearchResponse>;
}

// NEW — frontend/src/plugins/search/searchPlugin.ts (module-scope helpers)
/** Shape written to `<workingFolder>/search-<id>.json` as the file content. */
export interface SearchResultFileContent {
  /** ID is the trailing segment of the path's basename minus `search-` prefix. */
  id: string;
  query: string;
  filters?: SearchFilters;
  /** ISO-8601 UTC timestamp; `Date.now()` written via `new Date(Date.now()).toISOString()`. */
  timestamp: string;
  /** Full backend envelope, NOT just `results` — keeps debuggability. */
  response: SearchResponse;
}

/**
 * Return shape of `commands.run('search.search', …)`. Breaking change vs.
 * the post-#163 return shape (`SearchResponse`). See "Risks" #4.
 */
export interface SearchCommandResult {
  /** Store FS path of the dynamic file just written. */
  path: string[];
  /** Inline copy of the backend response — saves callers a Store-FS read. */
  response: SearchResponse;
}
```

```tsx
// frontend/src/components/SearchComponent.tsx — relevant fragment
const SearchComponent = () => {
  const run = useCommand();
  const storeFs = useService<StoreFileSystemFacade<RootState>>(STORE_FS_TOKEN);

  // EPHEMERAL UI state per cookbook §2 (Pattern B note still applies for
  // loading/error — no service-level file representation for the in-flight
  // request itself).
  const [currentPath, setCurrentPath] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // …query, focusedIdx, filters, availableServices, stereotypes — unchanged

  // Derive results from the Store-FS node for the current search id.
  const fileSelector = useMemo(
    () => (currentPath ? storeFs.createFileSelector(currentPath) : null),
    [storeFs, currentPath],
  );
  const file = useSelector<RootState, FileNode<SearchResultFileContent> | undefined>(
    (state) => (fileSelector ? (fileSelector(state) as FileNode<SearchResultFileContent> | undefined) : undefined),
  );
  const results: SearchResult[] = file?.content?.response.data ?? [];

  const performSearch = async (searchQuery: string) => {
    if (!searchQuery.trim()) { setCurrentPath(null); return; }
    try {
      setLoading(true); setError(null);
      const { path } = await run('search.search', {
        query: searchQuery,
        filters: /* unchanged */ undefined,
      }) as SearchCommandResult;
      setCurrentPath(path);
    } catch { setError('Failed to perform search.'); }
    finally { setLoading(false); }
  };
  // …rest of the render is unchanged
};
```

```ts
// frontend/src/plugins/search/searchPlugin.ts — full new initialize body
import { nanoid } from 'nanoid';                  // already in deps? — see Risk 3
import {
  STORE_MANAGER_TOKEN,
  type IStoreManager,
} from '@hamak/ui-store-api';
import type { StoreFileSystemFacade } from '@hamak/ui-store-impl';
import { SEARCH_SERVICE_TOKEN, STORE_FS_TOKEN } from '../../kernel/tokens';
import type { RootState } from '../../kernel/bootstrap';

const DEFAULT_WORKING_FOLDER: readonly string[] = Object.freeze([
  'dictionaries', '.dico', 'search',
]);

export function createSearchPlugin(options: SearchPluginOptions = {}): PluginModule {
  const workingFolder: string[] = options.workingFolder
    ? [...options.workingFolder]
    : [...DEFAULT_WORKING_FOLDER];

  return {
    async initialize(ctx) {
      ctx.views.register('routes.search', () => ({
        routes: ['/search', '/entities/flat', '/flat/**', '/tree/**'],
      }));

      // Pattern B: register the REST wrapper as a useValue, unchanged.
      ctx.provide({
        provide: SEARCH_SERVICE_TOKEN,
        useValue: new SearchService(),
      });

      // Resolve Store FS + store manager — store-fs plugin must be in
      // dependsOn (bootstrap.ts change). STORE_FS_TOKEN returns the lazy
      // Proxy at initialize time; the command handler below only invokes
      // its methods at command-run time, by which point activate has fired
      // (verified at storeFsPlugin.ts lifecycle comments).
      const storeFs = ctx.resolve<StoreFileSystemFacade<RootState>>(STORE_FS_TOKEN);
      const storeManager = ctx.resolve<IStoreManager>(STORE_MANAGER_TOKEN);
      const search = ctx.resolve<SearchService>(SEARCH_SERVICE_TOKEN);

      ctx.commands.register('search.search', async (
        { query, filters }: { query: string; filters?: SearchFilters },
      ): Promise<SearchCommandResult> => {
        const response = await search.searchEntities(query, filters);
        const id = nanoid(6).toLowerCase();
        const path = [...workingFolder, `search-${id}.json`];

        const actions = storeFs.getActions();
        // mkdir is idempotent (verified at fs-commands.js:79 — re-mkdir of
        // an existing directory is a no-op). `parents: true` walks the
        // path-tail from root, creating any missing ancestors.
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
```

## Framework APIs used

All cited paths are inside
`frontend/node_modules/@hamak/…/dist/`. Each cite has a `.d.ts` AND a
`.js` mate read where the surface has runtime side-effects.

- `StoreFileSystemFacade<S>` — class with `getActions()`,
  `createFileSelector(path)`, `selectFileFromRoot(state, path)`.
  - `dist/fs/core/fs-facade.d.ts:17-26` (declared methods)
  - `dist/fs/core/fs-facade.js` (runtime — no side effects beyond
    storing the adapter reference; method bodies delegate to the adapter)
- `FileSystemNodeActions` returned by `getActions()` — provides
  `mkdir(path, parents?, extensionStates?)` and
  `setFile(path, content, schema, params?)` action creators.
  - `dist/fs/core/fs-adapter.d.ts:36-58` (declared methods + types)
  - `dist/fs/core/fs-adapter.js` (factory + action-type strings)
  - Runtime behavior of executed commands (must-read for `setFile` /
    `mkdir` semantics):
    `dist/fs/commands/fs-commands.js:69-103` (`executeMkdir`,
    `parents=true` branch),
    `dist/fs/commands/fs-commands.js:126-149` (`executeSetFile` — silent
    no-op when parent dir missing; `override: true` lets us re-write)
- `FileNode<T>`, `FileContentSchema`, `FileSystemState` — re-exports.
  - `@hamak/ui-store-api/dist/fs/index.d.ts:1` (re-exports from
    `@hamak/shared-utils`)
  - `@hamak/shared-utils/dist/core-utils-filesystem.d.ts` (definitions)
- `STORE_FS_TOKEN` — our local symbol (kernel/tokens.ts), backed by the
  lazy `Proxy<StoreFileSystemFacade<RootState>>` provided in
  `storeFsPlugin.initialize`. Proxy access pre-`activate` throws; the
  search command body invokes facade methods only at command-run time
  (post-activate), so safe.
  - `frontend/src/plugins/store/storeFsPlugin.ts:99-115` (Proxy decl)
- `STORE_MANAGER_TOKEN`, `IStoreManager` — provided by the framework
  store plugin in its `initialize`.
  - `@hamak/ui-store-api/dist/api/store-manager.d.ts`
  - `@hamak/ui-store-impl/dist/plugin/store-plugin-factory.js:79`
    (registers `'fs'` slice — confirms the path under which our facade
    selector reads state)
- `RemoteFsAutosaveProvider.supports(path)` — verified that paths OUTSIDE
  the `dictionaries` mount return `false` from `toRemotePath` →
  `supports` returns `false` → `setFileContent` against `/tmp/search/…`
  would no-op anyway. Not invoked by `setFile`.
  - `@hamak/ui-remote-fs/dist/impl/autosave/remote-fs-autosave-provider.js`
    lines 33-46 (the `supports` body)
  - `@hamak/ui-remote-fs/dist/spi/providers/i-path-translator.js:19-30`
    (`toRemotePath` returns `undefined` when path is not under mount)
- `host.rootActivationCtx.commands.run(name, input)` — already used by
  `useCommand` (`frontend/src/kernel/useCommand.ts:23-32`).
- `nanoid` — small ID generator. **Not yet a frontend dep** — see Risk 3.

## Acceptance criteria

1. `frontend/src/store/slices/searchSlice.ts` does not exist after this
   ticket (`fs.existsSync` returns false; spec-grep guard asserts via
   `fs.readdirSync`).
2. `frontend/src/kernel/bootstrap.ts` contains no import of `searchSlice`
   and no `reducerRegistry.register('search', …)` line. (Grep: zero
   matches for `searchSlice` AND zero matches for
   `register\(['"]search['"]`.)
3. `createSearchPlugin` accepts an optional
   `SearchPluginOptions = { workingFolder?: string[] }`. Calling it
   without arguments still returns a valid `PluginModule`. (Type-level
   assertion in `searchPlugin.search.test.ts`; runtime assertion: the
   bootstrap-test `host.rootActivationCtx.resolve(SEARCH_SERVICE_TOKEN)`
   still passes.)
4. `createDataDictionaryPlugin`, `createVisualizationPlugin`, and
   `createAiAssistancePlugin` each accept an optional
   `workingFolder?: string[]` field on their options object. Calls
   without options still produce equivalent plugin modules.
5. After `bootstrapApplication()`,
   `host.rootActivationCtx.commands.has('search.search') === true`.
6. `commands.run('search.search', { query: 'Order' })` resolves with an
   object shaped `{ path: string[]; response: SearchResponse }`:
   - `path` is a 4-segment array whose final segment matches
     `/^search-[a-z0-9_-]{6}\.json$/`.
   - `path[0..2]` equals the plugin's effective `workingFolder` (default
     `['dictionaries', '.dico', 'search']` in bootstrap-test bootstrap).
   - `response` equals the backend envelope (MSW fixture).
7. After step 6, `STORE_FS_TOKEN.selectFileFromRoot(state, path)`
   returns a `FileNode<SearchResultFileContent>` whose `content`
   contains `{ id, query, filters, timestamp, response }` and whose
   `state.contentLoaded === true`.
8. Two sequential calls
   `commands.run('search.search', { query: 'A' })` and
   `commands.run('search.search', { query: 'B' })` produce two distinct
   paths (different `<id>`); both files coexist in Store FS state
   simultaneously (no implicit cleanup).
9. The dynamic file at `dictionaries/.dico/search/search-<id>.json` is
   **not** PUT to the backend. Asserted by intercepting outbound
   `/fs/...` requests through MSW and asserting no `PUT` is observed
   for the result-file path during a `commands.run('search.search', …)`
   call. (Justification: `setFile` does not trigger autosave —
   `autosave-middleware.js:15-18`. The guard prevents a regression that
   silently swaps to `setFileContent`.)
10. `SearchComponent` continues to render the result row given an MSW
    fixture (existing `SearchComponent.test.tsx` `#16`/`#17` pass).
    Rendering goes through `useFile(currentPath)` rather than through
    a `useState<SearchResult[]>` mutated by `performSearch`. Asserted by
    spec-grep guard: `SearchComponent.tsx` no longer contains the literal
    `useState<SearchResult[]>` declaration and contains a call to
    `storeFs.createFileSelector` (or imports `createFileSelector` via
    a helper).
11. Spec-grep guard rewrites:
    - `spec-grep-guards.search.test.ts` criterion `#13` is replaced. The
      new guard asserts `fs.existsSync(SEARCH_SLICE) === false` AND
      asserts `searchPlugin.ts` contains a `ctx.commands.register('search.search', …)`
      whose body calls `actions.setFile(`. Narrow regexes per the
      calibration rules (committed `4a72ec1`).
    - `spec-grep-guards.commands.test.ts` criterion `#16` `searchSlice.ts
      calls commands.run for search.search` is replaced by `searchSlice.ts
      does not exist`. The SearchComponent assertion `calls commands.run
      for search.search` is preserved.

## Out of scope

- entity, package, case, rule, dictionary, diagram slice migration to
  Store FS — **blocked on #167** (backend projection). These slices
  remain centrally registered in `bootstrap.ts`. The reframe explicitly
  defers them.
- `authSlice` migration — stays in Redux. The session token is
  ephemeral and security-sensitive; persisting it to a Store-FS file
  would be a regression.
- Cleanup mechanism for accumulating `search-<id>.json` files — see
  Risk 1. Out of scope; the spec proposes a TTL approach but does not
  implement.
- Cookbook §6 (dynamic-file persistence) — content authoring deferred.
  This ticket DOES introduce the pattern in code; the cookbook gap is
  surfaced as Risk 2 with no fix.
- Workspace-scoped Store FS (per-plugin sandbox) — single shared FS
  today; per-plugin namespace is a future ticket.
- ESLint `import/no-restricted-paths` rule forbidding cross-plugin
  slice imports — original #154 already had this out of scope.
- Renaming `servicesSlice` → `packagesSlice` — same.
- Threading `workingFolder` into `StereotypeService.STEREOTYPES_PATH` —
  see Decision D. Stays hard-coded; threading the value through the
  plugin factory option lets a follow-up ticket pick this up without
  another signature change.
- `WORKSPACE_REGISTRY_TOKEN` mechanism (option b from the reframe) —
  explicitly rejected by the user in favor of option a.

## Dependencies

- **Coordinates with** #163 (commands+events framework adoption). #163
  introduced `commands.run('search.search', …)`; this ticket changes its
  return shape from `SearchResponse` to `{ path, response }`. A
  consumer-side migration is required for any out-of-tree caller that
  destructured the response directly. In-tree the only caller is
  `SearchComponent.tsx`, updated in this ticket.
- **Coordinates with** #166 / PR #172 (StereotypeService Pattern A).
  Decision D keeps `STEREOTYPES_PATH` hard-coded; the new
  `workingFolder` option on `data-dictionary` is informational. No
  Pattern A code paths change.
- **Coordinates with** #155-search (PR #174, currently open) — same
  files (`searchPlugin.ts`, `spec-grep-guards.search.test.ts`). Either
  PR #174 must merge first, OR this ticket rebases onto it. The spec
  assumes #174 is in.
- **Not blocked by** #167 — the dynamic-file pattern is purely
  in-memory Redux state. Backend projection is irrelevant here.
- **Not blocked by** #160 / #161 / #162 — those landed.

## Risks

1. **Search files accumulate in Store FS state forever.** Every
   `commands.run('search.search', …)` adds a node; nothing removes
   them. Memory grows linearly with query count. *Mitigation:* the
   spec proposes (but does not implement) a follow-up TTL — the search
   plugin can register a listener on `search.completed` that removes
   any sibling `search-*.json` whose `content.timestamp` is older than
   N minutes via `actions.removeNode(path)`. Document in the plugin's
   header comment; open a follow-up ticket. **Honest:** without a
   cleanup, a long-lived dev session can OOM. Real today only if a
   user runs hundreds of searches without reloading.

2. **Cookbook §6 (dynamic-file persistence) does not exist.** This
   ticket introduces a pattern the cookbook has not documented. New
   readers of `searchPlugin.ts` will not have a pattern document to
   reference. *Mitigation:* none in this ticket. The pattern needs to
   stabilize across a second use site before §6 is authored (per the
   cookbook's "three uses" rule). The spec calls this out explicitly so
   the user can decide whether to commission §6 immediately after
   merge.

3. **`nanoid` is not a frontend dependency.** Adding it pulls in ~1 KB
   and an extra build step. *Mitigation:* if `nanoid` introduction is
   objectionable, replace with a 10-line inline generator using
   `crypto.getRandomValues(new Uint8Array(4))` and base32 encoding;
   spec acceptance #6's regex (`/^search-[a-z0-9_-]{6}\.json$/`)
   accommodates either. Recommended path: inline generator (no new
   dep). Note the user's example was `'search-xonncv'` (6 chars,
   lowercase alphanumeric) — both options produce that shape.

4. **Breaking change for `search.search` command return type.** Pre-this
   ticket the command returned a `SearchResponse`. After this ticket it
   returns `{ path, response }`. Any in-tree caller using
   `commands.run('search.search', …).data` (the array shortcut) breaks.
   *Mitigation:* in-tree audit (`grep -rn "commands\.run('search\.search'"`
   → only `SearchComponent.tsx`). Update the destructure. **Out-of-tree
   risk** is real if downstream forks exist, but none are known.

5. **Pattern B `useState<loading | error>` survives in
   `SearchComponent`.** The cookbook §2 "Pattern B note" sanctions this
   today, but if the file we're now writing carries `state.contentLoaded`
   and `state.contentLoadError` (it does — every Store FS node has
   them), purists might argue we should derive loading/error from the
   node and delete the `useState`. *Mitigation:* keep `useState` for
   loading/error this ticket. The semantics differ: the file's
   `contentLoaded` becomes `true` synchronously when `setFile` lands;
   it doesn't tell us "the network request is in flight." A future
   refactor (deferred to the cookbook §6 authoring) can converge the
   two. Honest: this is a half-Pattern-A consumer.

---

**Calibration**: Reads of `@hamak/*` `.d.ts` AND `.js` performed for
every cited factory / lifecycle / action-creator surface
(`fs-facade.js`, `fs-commands.js`, `i-path-translator.js`,
`autosave-middleware.js`, `remote-fs-autosave-provider.js`).
Spec-grep regexes are narrowed (`/search-[a-z0-9_-]{6}\.json$/`,
`/ctx\.commands\.register\(\s*['"]search\.search['"]/`,
`fs.existsSync` checks). Test-author `[verified]/[unverified]`
rule applies at the test-author stage.
