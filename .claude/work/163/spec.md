# Spec — #163: arch: actually use the action/command/event framework (Slice 1 — wrap the five DI'd services)

## Goal

Stand up the first real workload on the microkernel's command bus (`ctx.commands.register` / `ctx.commands.run`) and a typed event map for the hook bus (`ctx.hooks.emit` / `ctx.hooks.on`), scoped strictly to the five services that already live in DI after #155 work (`StereotypeService`, `IntegrityService`, `DiffService`, `ImportExportService`, `SearchService`). Phase-3 typed events stay **minimal** — the file-shaped entity/relationship/case/rule/package events the ticket comments enumerate are deferred because the slices that would emit them don't exist yet (#166 entity, #161 cases/rules, #160 git, #162 ai). The slice also (a) deletes the dead `*.refresh` commands and `<plugin>:refresh-requested` hooks (Phase 7), (b) decides on `@hamak/event-channel` and `@hamak/ui-navigation` (Phase 5 — remove both), (c) adds a `/commands` debug page reading the in-process registry (Phase 6), and (d) installs a content-guard test (the project's established substitute for the missing ESLint config) that pins pages/components to go through `commands.run` for the wrapped operations. The ticket body claims "0 `commands.execute` call sites" — that is stale post-#156 (PR #171): `frontend/src/plugins/data-dictionary/dataDictionaryPlugin.ts:111` already calls `ctx.commands.run('notification.<level>', { message })`. The spec corrects the count.

The ticket body asks for "every user-facing action" to become a command. That is the long-tail goal of #163. **Slice 1 covers only the five DI'd services.** The remaining services (Dictionary, Case, Rule, Visualization, AI, Git) are wrapped in follow-up tickets after #166/#161/#160/#162/#167 land — each one adds its own command surface in its own plugin's `initialize`, against the typed event map this slice ships.

## Scope decision (read this before reading the rest)

The ticket lists 7 phases. Comments add 3 layers of scope (workspace+actor context, path-as-binding, move + dual-key events). Comment-scope is **all blocked** on tickets that aren't done — `actorUserId`/`workspaceId` on the command signature lives on #168/#169 backend storage contract; `path` as the binding requires the entity slice (#166) which doesn't exist; `move` + `entity.moved` requires the same plus #167 projection. Slice 1 therefore declines comment-scope explicitly (see "Out of scope" below) and ships the buildable kernel.

Buildable now, by phase:

- **Phase 1 inventory** — only for `stereotype`, `integrity`, `diff`, `import-export`, `search`. Inventorying entity/case/rule/git/ai/visualization actions now would generate scaffolding for services that don't exist. Deferred.
- **Phase 2 command surface** — register 19 commands wrapping the five existing DI services (18 `data-dictionary.*` from `dataDictionaryPlugin` + 1 `search.*` from `searchPlugin`) + delete the 3 dead `*.refresh` commands and the placeholder `version.commit`. Net +15 commands; ~10 component call-site rewrites from direct service-method calls to `commands.run`.
- **Phase 3 typed event map** — `frontend/src/kernel/events.ts` ships with **only the events Slice 1 actually emits**: `stereotype.changed`, `import-export.committed`, `quality.report.refreshed`. Plus already-extant `shell:theme-changed`, `auth:session-restored`, `store-fs:ready`. The aspirational `entity.*` / `package.*` / `case.*` / `rule.*` / `git.*` keys from the ticket comments stay out — they belong to the slices that emit them. The typed-emit/typed-on wrapper accepts new keys without modification when the entity slice arrives.
- **Phase 4 one cross-plugin flow** — **deferred**. The ticket's exemplar flow (`entity.deleted` → search reindex → visualization invalidate → integrity invalidate) requires the entity slice (#166) AND a live search-index AND a visualization cache. None of those exist yet. Slice 1 wires one trivial in-plugin flow as proof-of-bus only: `import-export.committed` → `quality.report.refreshed` re-emit observed by `HomePage`'s overall-score widget. Skip if it adds noise; the bus is exercised by Slice 1's command call-sites either way.
- **Phase 5 event-channel / ui-navigation decision** — REMOVE both. Verified at `frontend/node_modules/@hamak/event-channel/dist/api/index.d.ts` and `frontend/node_modules/@hamak/ui-navigation/dist/api/index.d.ts`: event-channel is an SSE-transport remote-action primitive (server → client push, requires backend), ui-navigation is a Redux navigation store (URL ↔ store sync). Neither is a local-frontend pub-sub — `ctx.hooks` already covers that. Re-evaluation triggers: event-channel revisits when #168 backend ships server-push; ui-navigation revisits when a real cross-plugin navigation use case lands.
- **Phase 6 `/commands` debug page** — IN. Small, reads `host.rootActivationCtx.commands` only (no backend route — explicitly per agent guidance). Useful for developers right now; lets future slices verify their registrations.
- **Phase 7 cleanup** — IN. Delete `data-dictionary.refresh`, `case.refresh`, `rules.refresh`, plus the three `<plugin>:refresh-requested` hook emits. Also delete `version.commit` — it currently emits `version:commit-requested` which has no listener AND is unrelated to the actual save/commit code path (which lives in pages calling `versionApi` directly). The `version.commit` command, when it returns, comes back as a wrapper over the framework git plugin (#160). Add content-guard test in lieu of the missing ESLint setup.

## Files touched

- `frontend/src/kernel/events.ts` — **new**. Typed `EventMap` interface (minimal Slice 1 keys), `emit<K extends keyof EventMap>` / `on<K extends keyof EventMap>` helpers backed by `ctx.hooks`.
- `frontend/src/kernel/commands.ts` — **new**. Optional typed wrapper over `ctx.commands.register` and `host.rootActivationCtx.commands.run`. The wrapper is a thin convenience; nothing forces consumers to use it (call-sites can use `host.rootActivationCtx.commands.run` directly).
- `frontend/src/kernel/useCommand.ts` — **new**. React-side hook returning a `run(name, args)` bound to the rootActivationCtx; mirrors `useService.ts` shape. Components prefer this over reaching into the host module directly.
- `frontend/src/plugins/data-dictionary/dataDictionaryPlugin.ts` — register `data-dictionary.stereotype.*`, `data-dictionary.integrity.*`, `data-dictionary.diff.*`, `data-dictionary.import-export.*`, `data-dictionary.quality.*` commands; emit `stereotype.changed`, `import-export.committed`, `quality.report.refreshed` from those handlers; DELETE the `data-dictionary.refresh` command and `data-dictionary:refresh-requested` emit.
- `frontend/src/plugins/search/searchPlugin.ts` — register `search.search` command wrapping `SearchService.searchEntities`. (No reindex listener — search results are computed server-side per service comment; nothing to invalidate client-side.)
- `frontend/src/plugins/case/casePlugin.ts` — DELETE the `case.refresh` command and `case:refresh-requested` emit. Plugin keeps its route registration only.
- `frontend/src/plugins/rules/rulesPlugin.ts` — DELETE the `rules.refresh` command and `rules:refresh-requested` emit. Plugin keeps its route registration only.
- `frontend/src/plugins/version-control/versionControlPlugin.ts` — DELETE the `version.commit` command and `version:commit-requested` emit. Real commit wiring returns in #160.
- `frontend/src/pages/CommandsDebugPage.tsx` — **new**. Reads `host.rootActivationCtx.commands` (impl uses the same `host` singleton from `bootstrap.ts`). Lists every command name. Route declared in dataDictionaryPlugin.ts (`/commands`) — chosen because the page lives next to dev-tooling routes and data-dictionary already owns broad route surfaces.
- `frontend/src/App.tsx` (or wherever the route table is wired) — add `<Route path="/commands" element={<CommandsDebugPage />} />`. (Spec author: confirm the exact location when implementing — the route surface is declared in plugin `views.register` but the actual `<Route>` mapping is wired in the React router setup.)
- `frontend/src/pages/IntegrityPage.tsx` — call `commands.run('data-dictionary.integrity.getReport')` instead of `integrity.getReport()`. The `useService<IntegrityService>(...)` line stays — it's still needed for the type-narrowing on the return value through Slice 1; the migration is incremental.
- `frontend/src/pages/HomePage.tsx` — same as IntegrityPage for `integrity.getReport()` and `importExport.getQualityReport()`. Two call sites (lines 114 and 147).
- `frontend/src/pages/LogicalDiffPage.tsx` — `commands.run('data-dictionary.diff.getLogical', { left, right })` replaces `diffSvc.getLogical(left, right)`.
- `frontend/src/pages/PhysicalDiffPage.tsx` — three call sites: `data-dictionary.diff.getPhysicalConfig`, `data-dictionary.diff.getPhysicalAll`, `data-dictionary.diff.getPhysicalForService`.
- `frontend/src/pages/ImportExportPage.tsx` — four call sites: `data-dictionary.import-export.importJsonSchema`, `.importSqlDdl`, `.exportJsonSchema`, `.exportMarkdown`.
- `frontend/src/pages/QualityDashboardPage.tsx` — one call site: `data-dictionary.quality.getReport`.
- `frontend/src/pages/StereotypesPage.tsx` — four call sites: `data-dictionary.stereotype.loadAll`, `.create`, `.update`, `.delete`. The hook-shaped `service.useFile()` / `service.useAll()` calls STAY — they're React hooks that read Redux, not imperative service methods, and don't belong on the command bus.
- `frontend/src/components/SearchComponent.tsx` — `commands.run('search.search', { query, filters })` replaces `search.searchEntities(...)`.
- `frontend/src/components/SchemaImportWizard.tsx` — four call sites: `data-dictionary.import-export.previewSqlDdl`, `.previewDbSchema`, `.diffSqlDdl`, `.commitSqlDdl`.
- `frontend/src/store/slices/searchSlice.ts` — `commands.run('search.search', { query })` inside the thunk (the slice is dead per its own comment, but the call-site swap is trivial and keeps the audit consistent).
- `frontend/package.json` — remove `"@hamak/event-channel": "^0.5.3"` and `"@hamak/ui-navigation": "^0.5.3"` from `dependencies`.
- `frontend/src/plugins/data-dictionary/services/__tests__/spec-grep-guards.commands.test.ts` — **new**. Mirrors the established spec-grep pattern (see `spec-grep-guards.integrity.test.ts` lines 60-78 for the file-walker shape). Asserts: each component listed above contains `commands.run('<command-name>'` for the right command; no component imports `@/services/api` for the wrapped methods; the four dead `*.refresh` command names appear nowhere in `frontend/src` outside this guard file; the typed `EventMap` exports the expected keys.
- `frontend/src/kernel/__tests__/commands.test.ts` — **new**. Unit tests for the typed wrapper.
- `frontend/src/kernel/__tests__/events.test.ts` — **new**. Unit tests for typed emit/on round-tripping.
- `frontend/src/plugins/data-dictionary/__tests__/dataDictionaryPlugin.commands.test.ts` — **new**. Boots a minimal host with the data-dictionary plugin against a mock service registration; asserts every named command is `has`-true after `bootstrapAllAtRoot()`.
- `frontend/src/plugins/search/__tests__/searchPlugin.commands.test.ts` — **new**. Same shape for the search plugin.
- `frontend/src/pages/__tests__/CommandsDebugPage.test.tsx` — **new**. Renders the page against a stub host whose `rootActivationCtx.commands.has` returns true for a known fixture set; asserts the list renders all fixture names.
- `CLAUDE.md` — **NOT TOUCHED in this slice.** Documenting the command-naming convention belongs to a follow-up cookbook fill-in (cookbook §4 currently has a TODO placeholder; spec-writer agents don't edit the cookbook per the working rules).

## Public surface (signatures)

**Command input shape convention.** All 19 commands take a single argument. 17
of 19 use a wrapped-object input (`{ field, field, ... }`) — even the
single-field cases like `delete({ id })`. The two exceptions take `void`:
`data-dictionary.stereotype.loadAll` and `data-dictionary.integrity.getReport`.
The cycle-1 review flagged `data-dictionary.stereotype.create` as a CommandMap
↔ handler mismatch (CommandMap had `input: Stereotype`, handler destructured
`{ data }`). Resolved by **wrapping**: CommandMap now declares
`input: { data: Stereotype }` and the handler keeps `({ data }: { data: Stereotype })`.
Sanity sweep across the other 18 commands found no further mismatches.

```ts
// frontend/src/kernel/events.ts
//
// Typed event map for `ctx.hooks`. Slice 1 keeps the surface narrow — only
// events that the five DI'd services actually emit. New keys land alongside
// the slices that emit them (e.g. #166 adds `entity.created` etc.).

import type { Hooks } from '@hamak/microkernel-api';

export interface EventMap {
  /** Emitted after a stereotype create / update / delete succeeds. */
  'stereotype.changed': { id: string; op: 'create' | 'update' | 'delete' };

  /**
   * Emitted after a successful SQL-DDL or JSON-Schema import commit. Carries
   * the targetService so downstream listeners (e.g. quality re-fetch) can
   * scope their refresh.
   */
  'import-export.committed': {
    service: string;
    added: number;
    merged: number;
    unchanged: number;
    removedInSource: number;
    written: number;
  };

  /**
   * Emitted after the quality report is fetched. Slice 1 fires this from the
   * command handler so the HomePage overall-score widget can react without
   * cross-importing the service.
   */
  'quality.report.refreshed': { service?: string; overall: number };

  /**
   * Pre-existing (kept). Emitted by `shellPlugin` when DaisyUI theme syncs.
   */
  'shell:theme-changed': string;

  /**
   * Pre-existing (kept). Emitted once by `authPlugin` after session restore.
   * No listener yet — kept because removing it is out of #163's scope (the
   * auth plugin owns it).
   */
  'auth:session-restored': void;

  /**
   * Pre-existing (kept). Emitted once by `storeFsPlugin` after the Store FS
   * facade is fully wired. No current listener; kept because this is exactly
   * the kind of bootstrap-coordination signal future plugins may need.
   */
  'store-fs:ready': { workspace: string };
}

export type EventName = keyof EventMap;

/**
 * Typed emit. Wraps `ctx.hooks.emit(name, payload)`. Returns void.
 *
 * Note: hooks.emit signature is `(event, ...args)` per
 * `@hamak/microkernel-api/dist/types.d.ts:15` (verified — Hooks.emit takes
 * rest args). We pass a single payload object, which arrives at the handler
 * as `(payload) => …`. For events whose EventMap value is `void`, callers
 * omit the second argument and the wrapper passes nothing.
 */
export function emit<K extends EventName>(
  hooks: Pick<Hooks, 'emit'>,
  name: K,
  ...args: EventMap[K] extends void ? [] : [EventMap[K]]
): void;

/**
 * Typed on. Wraps `ctx.hooks.on(name, handler)`. The framework's `Hooks` type
 * does NOT return a disposer (verified at
 * `@hamak/microkernel-impl/dist/runtime/registries.js` line 1 — `on(e, f) {
 * map.get(e).add(f); }` returns void). Callers that need teardown use
 * `hooks.off(name, fn)` directly. This wrapper returns void to match.
 */
export function on<K extends EventName>(
  hooks: Pick<Hooks, 'on'>,
  name: K,
  handler: EventMap[K] extends void ? () => void : (payload: EventMap[K]) => void,
): void;
```

```ts
// frontend/src/kernel/commands.ts
//
// Typed command surface for Slice 1. The five DI'd services contribute the
// command set. Adding a new command means:
//   1. Add the {input, output} pair to `CommandMap` below.
//   2. Register it in the owning plugin's `initialize` via `ctx.commands.register`.
//   3. Call it from components via `useCommand()(name, input)`.
// Removing a command means: delete the key here, delete the register call,
// delete the call-sites. Type errors enforce the audit.

import type { Stereotype, StereotypeTarget } from '../types';
import type {
  LogicalDiffOperand,
  PhysicalDiffSource,
  LogicalDiffResult,
  PhysicalDiffResult,
  PhysicalDiffAllResult,
  PhysicalConfig,
} from '../plugins/data-dictionary/services/DiffService';
import type {
  IntegrityReport,
} from '../plugins/data-dictionary/services/IntegrityService';
import type {
  SchemaImportOptions,
  DbDialect,
  ImportResponse,
  PreviewResponse,
  DiffResponse,
  CommitResponse,
  QualityReport,
} from '../plugins/data-dictionary/services/ImportExportService';
import type {
  SearchFilters,
  SearchResponse,
} from '../plugins/search/services/SearchService';

export interface CommandMap {
  // ── Stereotypes (data-dictionary) ────────────────────────────────────
  'data-dictionary.stereotype.loadAll': {
    input: void;
    output: Stereotype[];
  };
  'data-dictionary.stereotype.create': {
    // Wrapped to match the dominant CommandMap shape (17 of 19 inputs are
    // `{ key: value, ... }` objects). The handler destructures `{ data }`.
    input: { data: Stereotype };
    output: Stereotype;
  };
  'data-dictionary.stereotype.update': {
    input: { id: string; data: Partial<Stereotype> };
    output: Stereotype;
  };
  'data-dictionary.stereotype.delete': {
    input: { id: string };
    output: void;
  };

  // ── Integrity (data-dictionary) ──────────────────────────────────────
  'data-dictionary.integrity.getReport': {
    input: void;
    output: IntegrityReport;
  };

  // ── Diff (data-dictionary) ───────────────────────────────────────────
  'data-dictionary.diff.getLogical': {
    input: { left: LogicalDiffOperand; right: LogicalDiffOperand };
    output: LogicalDiffResult;
  };
  'data-dictionary.diff.getPhysicalConfig': {
    input: { service: string };
    output: PhysicalConfig;
  };
  'data-dictionary.diff.getPhysicalForService': {
    input: { service: string; source: PhysicalDiffSource };
    output: PhysicalDiffResult;
  };
  'data-dictionary.diff.getPhysicalAll': {
    input: { sources: Record<string, PhysicalDiffSource>; services?: string[] };
    output: PhysicalDiffAllResult;
  };

  // ── Import / Export (data-dictionary) ────────────────────────────────
  'data-dictionary.import-export.importJsonSchema': {
    input: { schema: unknown; service: string };
    output: ImportResponse;
  };
  'data-dictionary.import-export.importSqlDdl': {
    input: { sql: string; service: string };
    output: ImportResponse;
  };
  'data-dictionary.import-export.previewSqlDdl': {
    input: { sql: string; options?: SchemaImportOptions };
    output: PreviewResponse;
  };
  'data-dictionary.import-export.previewDbSchema': {
    input: { dialect: DbDialect; connection: Record<string, unknown>; options?: SchemaImportOptions };
    output: PreviewResponse;
  };
  'data-dictionary.import-export.diffSqlDdl': {
    input: { parsed: unknown[]; targetService: string };
    output: DiffResponse;
  };
  'data-dictionary.import-export.commitSqlDdl': {
    input: { parsed: unknown[]; targetService: string };
    output: CommitResponse;
  };
  'data-dictionary.import-export.exportJsonSchema': {
    input: { service: string };
    output: unknown;
  };
  'data-dictionary.import-export.exportMarkdown': {
    input: { service: string };
    output: string;
  };

  // ── Quality (data-dictionary) ────────────────────────────────────────
  'data-dictionary.quality.getReport': {
    input: { service?: string };
    output: QualityReport;
  };

  // ── Search (search) ──────────────────────────────────────────────────
  'search.search': {
    input: { query: string; filters?: SearchFilters };
    output: SearchResponse;
  };
}

export type CommandName = keyof CommandMap;
export type CommandInput<K extends CommandName> = CommandMap[K]['input'];
export type CommandOutput<K extends CommandName> = CommandMap[K]['output'];

/**
 * Run a typed command via the host's root activation context. Throws if
 * called pre-bootstrap (same contract as `useService`).
 *
 * Implementation calls `host.rootActivationCtx.commands.run(name, input)`,
 * which matches `CommandRegistry.run(id: string, ...args: any[])` from
 * `@hamak/microkernel-api/dist/types.d.ts:5` — verified.
 */
export function runCommand<K extends CommandName>(
  name: K,
  ...args: CommandInput<K> extends void ? [] : [CommandInput<K>]
): Promise<CommandOutput<K>>;
```

```ts
// frontend/src/kernel/useCommand.ts
//
// React-side wrapper. Components call `const run = useCommand()` once and
// then `await run('<name>', input)` per action. Mirrors the simplicity of
// `useService.ts` — no React state, just a stable function.

import type { CommandName, CommandInput, CommandOutput } from './commands';

export function useCommand(): <K extends CommandName>(
  name: K,
  ...args: CommandInput<K> extends void ? [] : [CommandInput<K>]
) => Promise<CommandOutput<K>>;
```

```ts
// frontend/src/plugins/data-dictionary/dataDictionaryPlugin.ts
// (additions inside the existing `initialize(ctx)` body, after the existing
//  ctx.provide calls — the four refresh-only blocks at lines 50-52 are
//  DELETED in the same diff.)

// Resolve the four services this plugin already provided above.
const stereotype = ctx.resolve<StereotypeService>(STEREOTYPE_SERVICE_TOKEN);
const integrity  = ctx.resolve<IntegrityService>(INTEGRITY_SERVICE_TOKEN);
const diff       = ctx.resolve<DiffService>(DIFF_SERVICE_TOKEN);
const ie         = ctx.resolve<ImportExportService>(IMPORT_EXPORT_SERVICE_TOKEN);

// Stereotype commands — each handler awaits the service method, emits an
// event for cross-plugin observation, and returns the service result.
ctx.commands.register('data-dictionary.stereotype.loadAll', () =>
  stereotype.loadAll(),
);
ctx.commands.register('data-dictionary.stereotype.create', async ({ data }: { data: Stereotype }) => {
  const created = await stereotype.create(data);
  ctx.hooks.emit('stereotype.changed', { id: created.id, op: 'create' });
  return created;
});
ctx.commands.register('data-dictionary.stereotype.update', async ({ id, data }: { id: string; data: Partial<Stereotype> }) => {
  const updated = await stereotype.update(id, data);
  ctx.hooks.emit('stereotype.changed', { id, op: 'update' });
  return updated;
});
ctx.commands.register('data-dictionary.stereotype.delete', async ({ id }: { id: string }) => {
  await stereotype.delete(id);
  ctx.hooks.emit('stereotype.changed', { id, op: 'delete' });
});

// Integrity — single read.
ctx.commands.register('data-dictionary.integrity.getReport', () => integrity.getReport());

// Diff — four reads.
ctx.commands.register('data-dictionary.diff.getLogical', ({ left, right }: { left: LogicalDiffOperand; right: LogicalDiffOperand }) =>
  diff.getLogical(left, right),
);
ctx.commands.register('data-dictionary.diff.getPhysicalConfig', ({ service }: { service: string }) =>
  diff.getPhysicalConfig(service),
);
ctx.commands.register('data-dictionary.diff.getPhysicalForService', ({ service, source }: { service: string; source: PhysicalDiffSource }) =>
  diff.getPhysicalForService(service, source),
);
ctx.commands.register('data-dictionary.diff.getPhysicalAll', ({ sources, services }: { sources: Record<string, PhysicalDiffSource>; services?: string[] }) =>
  diff.getPhysicalAll(sources, services),
);

// Import / Export — eight calls. The commit handler emits an event.
ctx.commands.register('data-dictionary.import-export.importJsonSchema', ({ schema, service }: { schema: unknown; service: string }) =>
  ie.importJsonSchema(schema, service),
);
ctx.commands.register('data-dictionary.import-export.importSqlDdl', ({ sql, service }: { sql: string; service: string }) =>
  ie.importSqlDdl(sql, service),
);
ctx.commands.register('data-dictionary.import-export.previewSqlDdl', ({ sql, options }: { sql: string; options?: SchemaImportOptions }) =>
  ie.previewSqlDdl(sql, options),
);
ctx.commands.register('data-dictionary.import-export.previewDbSchema', ({ dialect, connection, options }: { dialect: DbDialect; connection: Record<string, unknown>; options?: SchemaImportOptions }) =>
  ie.previewDbSchema(dialect, connection, options),
);
ctx.commands.register('data-dictionary.import-export.diffSqlDdl', ({ parsed, targetService }: { parsed: unknown[]; targetService: string }) =>
  ie.diffSqlDdl(parsed, targetService),
);
ctx.commands.register('data-dictionary.import-export.commitSqlDdl', async ({ parsed, targetService }: { parsed: unknown[]; targetService: string }) => {
  const res = await ie.commitSqlDdl(parsed, targetService);
  if (res?.data) {
    ctx.hooks.emit('import-export.committed', {
      service: targetService,
      added: res.data.added,
      merged: res.data.merged,
      unchanged: res.data.unchanged,
      removedInSource: res.data.removedInSource,
      written: res.data.written,
    });
  }
  return res;
});
ctx.commands.register('data-dictionary.import-export.exportJsonSchema', ({ service }: { service: string }) =>
  ie.exportJsonSchema(service),
);
ctx.commands.register('data-dictionary.import-export.exportMarkdown', ({ service }: { service: string }) =>
  ie.exportMarkdown(service),
);

// Quality — single read; emits an event so the HomePage widget can refresh
// without cross-importing the service.
ctx.commands.register('data-dictionary.quality.getReport', async ({ service }: { service?: string }) => {
  const report = await ie.getQualityReport(service);
  ctx.hooks.emit('quality.report.refreshed', { service, overall: report.overall });
  return report;
});
```

```ts
// frontend/src/plugins/search/searchPlugin.ts
// (single new register inside the existing initialize body)

const search = ctx.resolve<SearchService>(SEARCH_SERVICE_TOKEN);
ctx.commands.register('search.search', ({ query, filters }: { query: string; filters?: SearchFilters }) =>
  search.searchEntities(query, filters),
);
```

```tsx
// frontend/src/pages/CommandsDebugPage.tsx — new
//
// Pure render. Reads the in-process command registry only — no backend call.
// Implementation detail: the framework's CommandRegistry does NOT expose a
// listing API (verified at @hamak/microkernel-api/dist/types.d.ts:2-6 —
// the type has only `register`, `run`, `has`). Slice 1 therefore renders
// from the static `CommandMap` defined in `kernel/commands.ts`, validating
// each name via `commands.has(name)` so the page can flag any drift between
// the type-map and the runtime registry. (Notification commands from the
// framework plugin and any future plugin-internal commands not in CommandMap
// are not surfaced here — that's a follow-up: framework needs `commands.list`
// or we maintain a manifest. Out of scope for Slice 1.)

export function CommandsDebugPage(): JSX.Element;
```

## Framework APIs used

- `@hamak/microkernel-api` — `CommandRegistry.register(id, fn)` / `CommandRegistry.run(id, ...args)` / `CommandRegistry.has(id)` at `frontend/node_modules/@hamak/microkernel-api/dist/types.d.ts:2-6`.
- `@hamak/microkernel-api` — `Hooks.on(event, fn)` / `Hooks.off(event, fn)` / `Hooks.emit(event, ...args)` at `frontend/node_modules/@hamak/microkernel-api/dist/types.d.ts:11-15`.
- `@hamak/microkernel-impl` — runtime semantics confirmed at `frontend/node_modules/@hamak/microkernel-impl/dist/runtime/registries.js`: `commands.run(id, ...a)` throws `Command not found` if unregistered; `hooks.on` adds to a Set with no return value; `hooks.emit` fans out synchronously with spread args.
- `@hamak/microkernel-impl` — `Host.rootActivationCtx: ActivateContext` exposed publicly at `frontend/node_modules/@hamak/microkernel-impl/dist/runtime/host.d.ts:13`. `ActivateContext = ProvidedServices` (api/types.d.ts:55-57) carries `commands: CommandRegistry` and `hooks: Hooks` — so `useCommand` resolving `host.rootActivationCtx.commands.run` is sound.
- `@hamak/microkernel-spi` — `InitializationContext.commands.register` and `InitializationContext.hooks.{on,emit}` (no `off`) at `frontend/node_modules/@hamak/microkernel-spi/dist/plugin.d.ts:3-15`. Plugins register commands in `initialize`. The `commands.run` and `hooks.off` are activate-only — Slice 1 never calls them from inside `initialize`.
- `@hamak/notification` — seven `notification.*` commands registered at `frontend/node_modules/@hamak/notification/dist/impl/plugin/notification-plugin-factory.js:78-104` (`notification.show`, `.info`, `.success`, `.warning`, `.error`, `.dismiss`, `.dismissAll`). All take a single `args` object. The `dataDictionaryPlugin.ts:109-115` activate-handler already calls `ctx.commands.run('notification.<level>', { message })` — verified live, the ticket body's "0 executes" is stale.

## Acceptance criteria

Tests live in the new spec-grep-guard file `frontend/src/plugins/data-dictionary/services/__tests__/spec-grep-guards.commands.test.ts` plus the per-plugin command tests. Each criterion below is one or more grep / `expect(...)` line in those files.

1. **Typed event map exists.** `fs.existsSync('frontend/src/kernel/events.ts')` is true and the file contains `export interface EventMap` with literal keys `'stereotype.changed'`, `'import-export.committed'`, `'quality.report.refreshed'`, `'shell:theme-changed'`, `'auth:session-restored'`, `'store-fs:ready'`. Regex: `/export interface EventMap\b/` AND for each key a separate `/['"]<key>['"]\s*:/` match.

2. **Typed command map exists.** `frontend/src/kernel/commands.ts` exports `interface CommandMap` containing exactly the 19 keys enumerated in the spec's `CommandMap` block (count enforced: `(content.match(/^\s*['"][a-z][^'"]+['"]\s*:/gm) ?? []).length === 19`).

3. **`useCommand` hook exists.** `frontend/src/kernel/useCommand.ts` exists and exports `useCommand`. Regex: `/export function useCommand\b/`.

4. **`/commands` debug page exists.** `frontend/src/pages/CommandsDebugPage.tsx` exists and exports `CommandsDebugPage`.

5. **Data-dictionary plugin registers all 18 data-dictionary.* commands.** In `frontend/src/plugins/data-dictionary/dataDictionaryPlugin.ts`: regex `/ctx\.commands\.register\(\s*['"]data-dictionary\./g` matches ≥ 18 times. For each individual command name from the CommandMap (e.g. `'data-dictionary.stereotype.loadAll'`), the literal string appears exactly once inside a `ctx.commands.register(...)` call (one matcher per name).

6. **Search plugin registers `search.search`.** In `frontend/src/plugins/search/searchPlugin.ts`: regex `/ctx\.commands\.register\(\s*['"]search\.search['"]/` matches once.

7. **Dead refresh commands deleted.** In `frontend/src/plugins/data-dictionary/dataDictionaryPlugin.ts`, `frontend/src/plugins/case/casePlugin.ts`, `frontend/src/plugins/rules/rulesPlugin.ts`, `frontend/src/plugins/version-control/versionControlPlugin.ts`: zero occurrences of `'data-dictionary.refresh'`, `'case.refresh'`, `'rules.refresh'`, `'version.commit'`, `'data-dictionary:refresh-requested'`, `'case:refresh-requested'`, `'rules:refresh-requested'`, `'version:commit-requested'`. (Eight literal strings; one `expect(content).not.toMatch` per string.)

8. **`@hamak/event-channel` and `@hamak/ui-navigation` removed from package.json.** `JSON.parse(fs.readFileSync('frontend/package.json'))` has no `@hamak/event-channel` or `@hamak/ui-navigation` key in `dependencies` or `devDependencies`.

9. **Page call-site migration complete (Stereotypes).** In `frontend/src/pages/StereotypesPage.tsx`: zero occurrences of `service.create(`, `service.update(`, `service.delete(`, `service.loadAll(` (the four method calls migrated). Four corresponding `commands.run('data-dictionary.stereotype.<verb>'` (regex `/commands\.run\(\s*['"]data-dictionary\.stereotype\.(loadAll|create|update|delete)['"]/g` matches ≥ 4). Hook-shaped calls `service.useFile()` / `service.useAll()` STAY (they're not in scope for command migration — assert their presence is unchanged: regex `/service\.useFile\(/` AND `/service\.useAll\(/` each match at least once).

10. **Page call-site migration complete (Integrity).** In `frontend/src/pages/IntegrityPage.tsx`: zero occurrences of `integrity.getReport(`. One `/commands\.run\(\s*['"]data-dictionary\.integrity\.getReport['"]/` match.

11. **Page call-site migration complete (HomePage).** In `frontend/src/pages/HomePage.tsx`: zero `integrity.getReport(`, zero `importExport.getQualityReport(`. One match each for `'data-dictionary.integrity.getReport'` and `'data-dictionary.quality.getReport'` under `commands.run(`.

12. **Page call-site migration complete (LogicalDiff).** In `frontend/src/pages/LogicalDiffPage.tsx`: zero `diffSvc.getLogical(`; one `'data-dictionary.diff.getLogical'` under `commands.run(`.

13. **Page call-site migration complete (PhysicalDiff).** In `frontend/src/pages/PhysicalDiffPage.tsx`: zero `diffSvc.getPhysicalConfig(`, `diffSvc.getPhysicalAll(`, `diffSvc.getPhysicalForService(`. Three corresponding `commands.run(` lines.

14. **Page call-site migration complete (ImportExport).** In `frontend/src/pages/ImportExportPage.tsx`: zero `importExport.importJsonSchema(`, `importExport.importSqlDdl(`, `importExport.exportJsonSchema(`, `importExport.exportMarkdown(`. Four corresponding `commands.run(` lines.

15. **Page call-site migration complete (Quality).** In `frontend/src/pages/QualityDashboardPage.tsx`: zero `importExport.getQualityReport(`; one `'data-dictionary.quality.getReport'` under `commands.run(`.

16. **Page call-site migration complete (Search).** In `frontend/src/components/SearchComponent.tsx`: zero `search.searchEntities(`; one `'search.search'` under `commands.run(`. Same shape in `frontend/src/store/slices/searchSlice.ts`.

17. **Page call-site migration complete (SchemaImportWizard).** In `frontend/src/components/SchemaImportWizard.tsx`: zero `importExport.previewSqlDdl(`, `importExport.previewDbSchema(`, `importExport.diffSqlDdl(`, `importExport.commitSqlDdl(`. Four corresponding `commands.run(` lines.

18. **Runtime registration verified.** In `frontend/src/plugins/data-dictionary/__tests__/dataDictionaryPlugin.commands.test.ts`: after `await host.bootstrapAllAtRoot()`, for each of the 18 data-dictionary command names `expect(host.rootActivationCtx!.commands.has(name)).toBe(true)`. Same in the search plugin test for `'search.search'`. (Total: 19 `has`-true assertions.)

19. **Event emission verified.** In the same plugin test: invoking the `create`/`update`/`delete` stereotype commands via `commands.run` causes a registered listener on `'stereotype.changed'` to receive the payload `{ id, op }`. Invoking `commitSqlDdl` (with the service stubbed to return a non-null `data`) emits `'import-export.committed'`. Invoking `getReport` quality emits `'quality.report.refreshed'`. (Three listener-fire assertions.)

20. **CommandsDebugPage renders all registered names from CommandMap.** In `frontend/src/pages/__tests__/CommandsDebugPage.test.tsx`: rendering against a host whose `commands.has` returns true for every CommandMap key produces a DOM with at least 19 list items (one per key). Hidden-failure mode: if a key in CommandMap has no runtime register, `has` returns false and the page renders the row with a visible "not registered" marker. The test asserts that with the real bootstrap (registering all 19), zero rows render in the not-registered state.

21. **Spec-grep guard for typed-API drift.** The new `spec-grep-guards.commands.test.ts` walks `frontend/src/` and asserts:
    - Zero call-sites of `commands.execute(` outside `node_modules` (the framework method is `run`, not `execute` — guards against cookbook-prose drift).
    - For each plugin file under `frontend/src/plugins/`, count of `ctx.commands.register(` matches the per-plugin total (data-dictionary: 18, search: 1, notification adapter: 0 in our code — framework registers its 7 internally, not in our files).

## Out of scope

- **Workspace + actor context on command signatures.** Comment dated for #168/#169 scope: `actorUserId`, `workspaceId`, `requiresConfirmation`. Deferred until the storage-backend contract (#168) and per-user worktrees (#169) land. Follow-up: track on #163 itself OR open a child ticket once #168 is in PR. Slice 1's commands carry only their domain inputs.
- **Path-as-binding for entity-shaped commands.** Comment-scope: `data-dictionary.entity.save({ path, content })` etc. The entity service is not in DI yet (#166). Slice 1's commands all take REST-style or imperative parameters because that's what the wrapped services take. Entity commands land in the #166 follow-up alongside the entity slice.
- **`move` command and `entity.moved` dual-key event.** Comment-scope. Requires #167 backend projection (the spec-comment explicitly says "Backend (projection layer per #167) handles atomicity"). Deferred — track on #160 / #167 follow-up.
- **Aspirational event keys** (`entity.created`, `entity.updated`, `entity.deleted`, `package.changed`, `git.committed`, `case.resolved`, `rule.violated`). Each belongs to the slice that emits it. Adding them to `EventMap` now would create a type contract that has no producer — dead code.
- **Cross-plugin Phase 4 flow** (`entity.deleted` → search reindex → visualization invalidate → integrity invalidate). Deferred. No live consumer exists for any of those reactions today (the search slice is dead code per its own comment; visualization has no cache to invalidate; integrity is a stateless REST call). Returns when entity slice (#166) lands.
- **Slash command palette (#56) reading the command registry.** #56 is open and unstarted. The registry produced here is the source #56 will read FROM when it lands; coordination point is the `CommandMap` type.
- **Keyboard shortcut migration.** `frontend/src/components/KeyboardShortcutsModal.tsx` is a presentational list with zero keydown handlers (verified — 0 `keydown` matches, 43 lines). There's no system to migrate.
- **ESLint guardrail** ("components in pages/ and components/ may not import services directly"). No ESLint config exists in the frontend (`frontend/.eslintrc*` does not exist; only `package.json`'s `"lint"` script declares `eslint . --ext ts,tsx`). Setting up ESLint is its own ticket. Slice 1 substitutes the spec-grep-guard test (criterion #21).
- **CLAUDE.md documenting the command-naming convention.** Spec-writer agents do not edit CLAUDE.md or the cookbook (per working rules). Cookbook §4 still has TODO placeholders; the user fills them in.
- **Backend command bus / CQRS / Redux-replacement.** Per ticket body "Out of scope" — preserved verbatim.
- **`version.commit` re-introduction.** Slice 1 deletes the placeholder. The real command returns with #160 (framework-git swap).

## Dependencies

- **Depends on (merged): #155 work** — StereotypeService (#155-stereotype-slice, currently in `arch/166-stereotype-slice` and equivalent merged paths), IntegrityService + DiffService + ImportExportService + SearchService (#155-{integrity,diff,import-export,search}, merged at commit `6aecd3e` per git log). All five services exist in DI today; Slice 1 takes that as ground truth.
- **Depends on (merged): #156** — notification commands collapsed onto `@hamak/notification` factory (PR #171). `ctx.commands.run` is already used at `dataDictionaryPlugin.ts:111`. Slice 1 reuses this call site as the precedent for component-side `useCommand`.
- **Coordinates with #166 (entity slice — NOT STARTED).** When #166 lands, it adds entity commands to `CommandMap`, registers them in `dataDictionaryPlugin.ts`, and adds the `entity.*` event keys to `EventMap`. The typed map's open-extension shape (interface, not enum) makes this additive.
- **Coordinates with #161 (cases / rules fold — NOT STARTED).** When #161 folds case & rules into data-dictionary, the `data-dictionary.case.*` and `data-dictionary.rule.*` commands land alongside their services. Slice 1 deletes the dead `case.refresh` and `rules.refresh` to clear the way.
- **Coordinates with #160 (framework-git swap — NOT STARTED).** Slice 1 deletes `version.commit`. When #160 lands, real `git.*` commands replace it.
- **Coordinates with #162 (ai extract — NOT STARTED).** Future `ai.chat.send` etc. land with #162.
- **Blocked dependencies (Slice 1 doesn't need them).** #167 (backend storage), #168 (workspace contract), #169 (per-user worktrees) — all required for comment-scope (workspace+actor context, move, dual-key events) but not for Slice 1.

## Risks

1. **Cookbook §4 drift.** The cookbook says `commands.execute` but the framework method is `commands.run` (verified at `@hamak/microkernel-impl/dist/runtime/registries.js`). Slice 1's content-guard test #21 pins `commands.run` and forbids `commands.execute` in the source tree. The cookbook itself is **out of scope** (spec-writer agents don't edit it per working rules). Mitigation: surface in the spec; the user fills in §4 prose using `commands.run` when they next touch the cookbook. If they want `execute` as an alias, that needs an upstream framework change.

2. **CommandRegistry has no `list` API.** Verified at `@hamak/microkernel-api/dist/types.d.ts:2-6` — only `register`, `run`, `has`. `CommandsDebugPage` therefore enumerates from the static `CommandMap` and probes each with `has`. New commands registered ad-hoc by other plugins (e.g. the seven `notification.*` framework commands) are NOT surfaced unless added to `CommandMap`. Mitigation: criterion #21 forbids drift between `CommandMap` and the runtime registry for our own code; a follow-up may add the framework notification commands to the map explicitly or wait for `CommandRegistry.list` upstream.

3. **`ctx.hooks` doesn't return an unsubscribe disposer.** Verified at `@hamak/microkernel-impl/dist/runtime/registries.js` — `on(e, f) { map.get(e).add(f); }` returns void. Long-lived plugins that need teardown call `ctx.hooks.off(name, fn)` on `deactivate`. Slice 1 has no deactivate-time listeners on the events it emits, so this is documented but unused here. Mitigation: typed `on` wrapper returns void to match.

4. **Event emit signature mismatch between map and runtime.** `Hooks.emit(event, ...a)` accepts variadic args; the typed wrapper passes a single payload object as the second arg. Handlers receive `(payload) =>` (one positional arg). For `EventMap[K]` values that are `void` (e.g. `auth:session-restored`), the wrapper passes nothing — runtime calls `fn()`. Mitigation: covered by `kernel/__tests__/events.test.ts` (round-trip emit→on for each void-payload and object-payload case).

5. **`searchSlice.ts` is dead code (per its own comment) and the swap to `commands.run` keeps it dead.** Slice 1 migrates it anyway for audit consistency. The reducer-bug noted at `searchSlice.ts:32-36` is unrelated and stays. No mitigation needed — flag only.
