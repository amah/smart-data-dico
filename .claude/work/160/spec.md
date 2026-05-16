# Spec — #160: arch: replace hand-rolled version-control plugin with @hamak/ui-remote-git-fs

## Goal

Delete the ~28-line `versionControlPlugin.ts` and the bespoke `versionApi` HTTP client. Promote the framework's `@hamak/ui-remote-git-fs` plugin from a transport-only shim to the canonical git source of truth: rename the plugin from `remote-git` to `git`, register a thin Pattern B-style `GitService` (a wrapper around the framework's `HttpGitClient`) under a smart-data-dico-owned `GIT_SERVICE_TOKEN`, and migrate all six git-touching UI surfaces (`GitStatusIndicator`, `CommitChanges`, `CommitHistory`, `SavePublishPage`, `WorkspacesPage`, `MergePage`, plus the `HomePage` KPI strip and `LogicalDiffPage` commit-selector) to consume that service via `useService` and a new `data-dictionary.publish.*` typed command set. The ticket body summarizes it as: *"Delete the hand-rolled `version-control` plugin. Use the framework's git plugin as the single source of truth for git operations. All git UI components consume the framework's git service via DI."* The ticket's comment refinements (2026-05-15 #168 capability gating, 2026-05-16 raw-view consumption) are captured as Out-of-Scope / risk items below — neither blocks this slice, both bound where the migration may extend later.

## Files touched

### Frontend — new
- `frontend/src/plugins/git/gitPlugin.ts` — new plugin entry. Calls `createGitPlugin({...})` from `@hamak/ui-remote-git-fs`, then wraps the returned `PluginModule` so its `initialize` ALSO constructs a `GitService` (Pattern B) and registers it under our local `GIT_SERVICE_TOKEN`. Replaces `frontend/src/plugins/remote-fs/remoteGitPlugin.ts` (which is deleted).
- `frontend/src/plugins/git/services/GitService.ts` — new. Pattern B service: thin axios wrapper over the same `/api/git/dictionaries/**` endpoints the legacy `gitApi` block hits. Constructed inside the wrapped `initialize` (Pattern B precedent #155: eager `useValue`). Methods mirror the legacy `gitApi` + `versionApi` surface so the migration is mechanical.
- `frontend/src/plugins/git/services/__tests__/GitService.test.ts` — new. Vitest unit tests for `GitService` mirroring the IntegrityService test shape (`http?: AxiosInstance` injection, request URL + body asserts).
- `frontend/src/plugins/data-dictionary/services/PublishService.ts` — new. Thin domain-wrapper service for the "save & publish" composite semantics from `SavePublishPage` (commit → push). Owned by `data-dictionary` per the ticket's explicit guidance: *"any save/publish-specific logic moves to a `PublishService` inside `data-dictionary`."*
- `frontend/src/plugins/data-dictionary/services/__tests__/PublishService.test.ts` — new. Asserts the composite call sequence with a mock `GitService`.
- `frontend/src/plugins/git/__tests__/spec-grep-guards.git.test.ts` — new. Content guards for this ticket's acceptance (mirror of `spec-grep-guards.commands.test.ts`).

### Frontend — modified
- `frontend/src/kernel/tokens.ts` — add `GIT_SERVICE_TOKEN` and `PUBLISH_SERVICE_TOKEN`. Drop the legacy `VERSION_SERVICE_TOKEN` declaration (declared but never wired — see tokens.ts:14).
- `frontend/src/kernel/bootstrap.ts` — drop the `createVersionControlPlugin` import + registration block; drop `versionReducer` import + `reducerRegistry.register('version', ...)`; rename the existing `remote-git` plugin name to `git` and swap its factory from `createAppRemoteGitPlugin` (in `plugins/remote-fs/remoteGitPlugin.ts`) to the new `createGitPlugin` wrapper in `plugins/git/gitPlugin.ts`; move the registration so its name + dependsOn read `{ name: 'git', dependsOn: ['store', 'remote-fs'] }`; **also extend `data-dictionary`'s manifest from `dependsOn: ['store', 'auth', 'store-fs']` (current bootstrap.ts:108) to `dependsOn: ['store', 'auth', 'store-fs', 'git']` so the `ctx.resolve(GIT_SERVICE_TOKEN)` inside `dataDictionaryPlugin.initialize` is guaranteed to find a registered provider.**
- `frontend/src/kernel/commands.ts` — add eleven new `CommandMap` entries (see Public Surface). Increment the documented exact-count from 19 to 30 (the 19 baseline from #163 plus 11 new entries: seven `data-dictionary.git.*` and four `data-dictionary.publish.*`).
- `frontend/src/plugins/data-dictionary/dataDictionaryPlugin.ts` — register the eleven new `data-dictionary.git.*` (seven) and `data-dictionary.publish.*` (four) commands in `initialize`, after the existing 18 (`grep -cE 'ctx\.commands\.register\(' frontend/src/plugins/data-dictionary/dataDictionaryPlugin.ts` returns 18 on `main = 298dc65`; this PR raises it to 29 — see Public Surface). Resolve `GitService` via `ctx.resolve(GIT_SERVICE_TOKEN)` and `PublishService` (constructed locally, registered as `useValue`).
- `frontend/src/components/GitStatusIndicator.tsx` — replace `gitApi.getStatus / .pull / .push` with `useCommand()` for `data-dictionary.git.getStatus / .pull / .push`. Drop the `import { gitApi } from '../services/api'`.
- `frontend/src/components/CommitChanges.tsx` — replace `versionApi.commitChanges(message)` with `useCommand()('data-dictionary.publish.save', { message })`. Drop the import.
- `frontend/src/components/CommitHistory.tsx` — replace `versionApi.getCommitHistory(limit)` with `useCommand()('data-dictionary.git.log', { limit })`; replace `versionApi.revertToCommit(hash)` with `useCommand()('data-dictionary.publish.revert', { commitHash })`. Drop the import. Per the ticket's API-mapping guidance: revert is a domain-specific add-on (framework `IGitClient` has no `revert`); it routes through `PublishService.revert(...)` which keeps the existing `/api/revert` backend endpoint for one release.
- `frontend/src/pages/SavePublishPage.tsx` — replace `gitApi.getStatus / .push / .pull` and `versionApi.commitChanges` with `useCommand()` for `data-dictionary.git.getStatus`, `data-dictionary.publish.publish`, `data-dictionary.publish.sync`, `data-dictionary.publish.save`.
- `frontend/src/pages/WorkspacesPage.tsx` — replace `gitApi.getBranches / .checkout` with `useCommand()` for `data-dictionary.git.listBranches / .checkout`.
- `frontend/src/pages/MergePage.tsx` — replace `gitApi.getBranches / .getDiff / .pull` with `useCommand()` for `data-dictionary.git.listBranches / .diff / .pull`. (Merge UI behavior is unchanged — the page composes pull as a simplified merge today; #160 doesn't add a true `merge` op since the framework `IGitClient` doesn't expose one. Risk recorded below.)
- `frontend/src/pages/HomePage.tsx` — replace the lone `gitApi.getStatus()` call (line 150) with `useCommand()('data-dictionary.git.getStatus')`. **Also rewrite the JSDoc header at line 16 to remove the `gitApi.getStatus()` reference** (e.g. change `Open diff    → gitApi.getStatus() → uncommitted file count` to `Open diff    → commands.run('data-dictionary.git.getStatus') → uncommitted file count`). Without this edit AC #10 / AC #37 fail because `grep -F 'gitApi.'` matches the comment string.
- `frontend/src/pages/LogicalDiffPage.tsx` — replace `versionApi.getCommitHistory(50)` (line 252) with `useCommand()('data-dictionary.git.log', { limit: 50 })`. Drop the `versionApi` import.
- `frontend/src/services/api.ts` — DELETE the `versionApi` block (lines 208-227) and the `gitApi` block (lines 357-395). Both are now owned by `GitService`. The export list at the top stays intact for the other APIs.
- `frontend/src/App.tsx` — no change to route definitions (the routes were already mounted by `App.tsx` directly, not by `versionControlPlugin`'s `views.register`; the plugin's `routes.version-control` view contribution is dead and goes away with the plugin file).

### Frontend — deleted
- `frontend/src/plugins/version-control/` (whole folder, sole file: `versionControlPlugin.ts`).
- `frontend/src/plugins/remote-fs/remoteGitPlugin.ts` (factory moves to `frontend/src/plugins/git/gitPlugin.ts`).
- `frontend/src/store/slices/versionSlice.ts` — fully covered by `GitService` + `PublishService` return values; no other consumer reads from `state.version` (verified by grep — only consumer was `versionSlice.ts` itself self-registering thunks against `versionApi`).

### Frontend — tests modified
- `frontend/src/plugins/data-dictionary/services/__tests__/spec-grep-guards.commands.test.ts` — five concrete edits:
  - **Line 49** (`VERSION_CONTROL_PLUGIN = path.join(SRC, 'plugins', 'version-control', 'versionControlPlugin.ts');`) — DELETE the constant.
  - **Lines 234-235** (the two `VERSION_CONTROL_PLUGIN` entries in `deadCommands` array — `version.commit` and `version:commit-requested`) — DELETE both entries.
  - **Line 126** (`expect(matches.length).toBe(19);` inside the `CommandMap has exactly 19 command keys` test) — change `19` to `30`.
  - **Lines 129-149** (the `commandNames` array literal of 19 strings — verified at the spec-grep-guards file at the time of writing) — APPEND these 11 new entries in declaration order:
    ```
    'data-dictionary.git.getStatus',
    'data-dictionary.git.listBranches',
    'data-dictionary.git.checkout',
    'data-dictionary.git.log',
    'data-dictionary.git.diff',
    'data-dictionary.git.pull',
    'data-dictionary.git.push',
    'data-dictionary.publish.save',
    'data-dictionary.publish.publish',
    'data-dictionary.publish.sync',
    'data-dictionary.publish.revert',
    ```
    The iterating `for (const name of commandNames)` block below then asserts each new name appears in `commands.ts`.
  - **Lines 183-184** (`expect(matches.length).toBeGreaterThanOrEqual(18);` inside the `dataDictionaryPlugin.ts has >= 18 ctx.commands.register calls` test) — change `18` to `29`.
  - **Lines 186-205** (the `ddCommands` array literal of 18 strings) — APPEND the same 11 entries listed above. The iterating `for (const name of ddCommands)` block below then asserts each appears in `dataDictionaryPlugin.ts`.

  Net result: the 19 / 18 exact-counts become 30 / 29, and the per-name iteration block grows from 19 + 18 to 30 + 29 entries. The new commands sit inside the existing exhaustive discipline.

### Backend
- `backend/src/controllers/versionController.ts` — DELETE.
- `backend/src/services/versionService.ts` — KEEP. Still used by `backend/src/routes/project.routes.ts:63` (`getWorkingTreeStatus` for the `/api/project/status` endpoint, #95) and by the new `publish.routes.ts` (`revertToCommit`, kept for one release until the framework lands a revert op). Slim it to `getWorkingTreeStatus` + `revertToCommit` + the lazy `getGitService()` helper; drop `commitChanges` and `getCommitHistory` methods (their endpoints are deleted with `version.routes.ts`).
- `backend/src/routes/data-dictionary/version.routes.ts` — DELETE.
- `backend/src/routes/data-dictionary/publish.routes.ts` — **NEW**. One handler: `POST /api/revert` delegates to `versionService.revertToCommit(commitHash)`. Owned by data-dictionary domain; matches the `data-dictionary.publish.revert` command pair on the frontend.
- `backend/src/routes/data-dictionary/index.ts` — drop the `versionRoutes` import + `router.use(versionRoutes)` line; ADD `import publishRoutes from './publish.routes';` and `router.use(publishRoutes);`.
- `backend/src/__tests__/integration/api.test.ts` — RESHAPE the `describe('Version Control', ...)` block at lines 121-140: DELETE the `/api/commit` and `/api/history` sub-tests (their endpoints are gone with `version.routes.ts`); KEEP the `/api/revert` sub-test (the endpoint moves to the new `publish.routes.ts` but the URL is unchanged). Optionally rename the describe block to `'Publish (revert)'`.
- `backend/src/services/__mocks__/versionService.ts` — slim down the mock to `getWorkingTreeStatus` and `revertToCommit` (matches the slimmed service surface; the `/api/revert` integration test still passes via the mock).

## Public surface (signatures)

```ts
// frontend/src/kernel/tokens.ts (new entries)
export const GIT_SERVICE_TOKEN = Symbol('GitService');
export const PUBLISH_SERVICE_TOKEN = Symbol('PublishService');
```

```ts
// frontend/src/plugins/git/services/GitService.ts

import axios, { type AxiosInstance } from 'axios';

/** Mirrors GitStatusResponse from
 *  `@hamak/ui-remote-git-fs/dist/api/types/git-state.types.d.ts` but we
 *  expose the loose shape the backend actually emits (which historically
 *  included `current`, `branch` as object-or-string, etc.). */
export interface GitStatusDTO {
  branch?: { current: string; tracking?: string; ahead: number; behind: number } | string;
  current?: string;
  ahead?: number;
  behind?: number;
  hasUncommittedChanges?: boolean;
  files?: Array<{ path: string; status: string; staged?: boolean; working_dir?: string }>;
  modified?: string[];
  not_added?: string[];
  created?: string[];
  deleted?: string[];
}

export interface GitBranchListDTO {
  current: string | { name: string };
  local?: string[];
  remote?: string[];
  branches?: string[];
  all?: string[];
}

export interface GitCommitDTO {
  data: { commitHash: string };
  message?: string;
}

export interface GitLogEntryDTO {
  hash: string;
  date: string;
  author: string;
  author_name?: string;
  author_email?: string;
  message: string;
  changes?: { added: string[]; modified: string[]; deleted: string[] };
}

export class GitService {
  private readonly http: AxiosInstance;

  /** Optional axios injection for unit tests (Pattern B precedent — see
   *  IntegrityService). Production callers pass nothing and get the default
   *  instance with the auth interceptor. */
  constructor(http?: AxiosInstance) {
    this.http = http ?? GitService.createDefaultHttp();
  }

  /** GET /api/git/dictionaries/status/. */
  async getStatus(): Promise<GitStatusDTO> { ... }

  /** GET /api/git/dictionaries/branches/. */
  async listBranches(): Promise<GitBranchListDTO> { ... }

  /** POST /api/git/dictionaries/checkout/. — `create=true` creates the branch. */
  async checkout(branch: string, create?: boolean): Promise<void> { ... }

  /** POST /api/git/dictionaries/commit/. — direct framework commit
   *  (no domain stage step; used for the simple CommitChanges page). */
  async commit(message: string): Promise<GitCommitDTO> { ... }

  /** POST /api/git/dictionaries/pull/. */
  async pull(remote?: string): Promise<void> { ... }

  /** POST /api/git/dictionaries/push/. */
  async push(remote?: string): Promise<void> { ... }

  /** GET /api/git/dictionaries/diff/. (file optional). */
  async diff(file?: string): Promise<{ diff: string; file?: string }> { ... }

  /** GET /api/git/dictionaries/log/. — log is provided by the framework's
   *  HttpGitClient (`/log/<path>?maxCount=N`). The framework backend already
   *  serves this; the legacy `/api/history` endpoint is deleted. */
  async log(limit?: number): Promise<GitLogEntryDTO[]> { ... }

  private static createDefaultHttp(): AxiosInstance { ... }
}
```

```ts
// frontend/src/plugins/data-dictionary/services/PublishService.ts

import type { GitService } from '../../git/services/GitService';

export interface SaveResult { commitHash?: string; }

export class PublishService {
  constructor(private readonly git: GitService) {}

  /** Compose: commit current changes with the given message.
   *  Mirror of the deleted versionApi.commitChanges contract — same
   *  return shape so call-sites stay mechanical. */
  async save(message: string): Promise<SaveResult> { ... }

  /** Compose: push to origin. */
  async publish(remote?: string): Promise<void> { ... }

  /** Compose: pull from origin. */
  async sync(remote?: string): Promise<void> { ... }

  /** Domain add-on. Framework IGitClient has no `revert` op; we call the
   *  legacy `/api/revert` endpoint kept on the backend's versionService
   *  for one release. Delete once the upstream framework lands revert. */
  async revert(commitHash: string): Promise<{ newCommitHash?: string }> { ... }
}
```

```ts
// frontend/src/plugins/git/gitPlugin.ts

import type { PluginModule } from '@hamak/microkernel-spi';
import { createGitPlugin as createFrameworkGitPlugin } from '@hamak/ui-remote-git-fs';
import { Pathway } from '@hamak/shared-utils';
import { GIT_SERVICE_TOKEN } from '../../kernel/tokens';
import { GitService } from './services/GitService';

/** Compose the framework git plugin (transport: middleware + GIT_CLIENT_TOKEN
 *  registration) with our Pattern B GitService facade (Promise-returning
 *  methods that the UI consumes via useCommand). The framework plugin is
 *  invoked first; we then run our own initialize + activate on top.
 *
 *  Framework reference:
 *    - dist/impl/plugin/git-plugin-factory.js  (returns PluginModule with
 *      initialize/activate/deactivate; registers GIT_CLIENT_TOKEN +
 *      GIT_PATH_TRANSLATOR_TOKEN via ctx.provide, emits 'ui-remote-git-fs:ready'
 *      on activate).
 *    - dist/api/tokens.js  (GIT_SERVICE_TOKEN is *exported* but NOT
 *      registered by the framework — we own it). */
export function createGitPlugin(): PluginModule {
  const framework = createFrameworkGitPlugin({
    workspaceId: 'dictionaries',
    mountPoint: Pathway.ofRoot().resolve('dictionaries'),
    gitApiBaseUrl: '/api/git',
    debug: import.meta.env.DEV,
  });

  return {
    async initialize(ctx) {
      await framework.initialize!(ctx);
      ctx.provide({ provide: GIT_SERVICE_TOKEN, useValue: new GitService() });
    },
    async activate(ctx) {
      if (framework.activate) await framework.activate(ctx);
    },
    async deactivate() {
      if (framework.deactivate) await framework.deactivate();
    },
  };
}
```

```ts
// frontend/src/kernel/commands.ts (new entries added to CommandMap)

import type {
  GitStatusDTO,
  GitBranchListDTO,
  GitCommitDTO,
  GitLogEntryDTO,
} from '../plugins/git/services/GitService';
import type { SaveResult } from '../plugins/data-dictionary/services/PublishService';

export interface CommandMap {
  // … existing 19 entries unchanged …

  // ── Git transport (data-dictionary owns the user-facing commands,
  //    delegates to GitService) ──────────────────────────────────────────
  'data-dictionary.git.getStatus': { input: void; output: GitStatusDTO; };
  'data-dictionary.git.listBranches': { input: void; output: GitBranchListDTO; };
  'data-dictionary.git.checkout': { input: { branch: string; create?: boolean }; output: void; };
  'data-dictionary.git.log': { input: { limit?: number }; output: GitLogEntryDTO[]; };
  'data-dictionary.git.diff': { input: { file?: string }; output: { diff: string; file?: string }; };
  'data-dictionary.git.pull': { input: { remote?: string }; output: void; };
  'data-dictionary.git.push': { input: { remote?: string }; output: void; };

  // ── Save & Publish (PublishService composites) ──────────────────────────
  'data-dictionary.publish.save': { input: { message: string }; output: SaveResult; };
  'data-dictionary.publish.publish': { input: { remote?: string }; output: void; };
  'data-dictionary.publish.sync': { input: { remote?: string }; output: void; };
  'data-dictionary.publish.revert': { input: { commitHash: string }; output: { newCommitHash?: string }; };
}
// Total: 19 (pre-#160) + 11 (this ticket) = 30 keys.
```

```ts
// frontend/src/plugins/data-dictionary/dataDictionaryPlugin.ts
// inside initialize, after the existing ctx.commands.register calls

const git = ctx.resolve<GitService>(GIT_SERVICE_TOKEN);
const publish = new PublishService(git);
ctx.provide({ provide: PUBLISH_SERVICE_TOKEN, useValue: publish });

ctx.commands.register('data-dictionary.git.getStatus',    () => git.getStatus());
ctx.commands.register('data-dictionary.git.listBranches', () => git.listBranches());
ctx.commands.register('data-dictionary.git.checkout',     ({ branch, create }: { branch: string; create?: boolean }) => git.checkout(branch, create));
ctx.commands.register('data-dictionary.git.log',          ({ limit }: { limit?: number }) => git.log(limit));
ctx.commands.register('data-dictionary.git.diff',         ({ file }: { file?: string }) => git.diff(file));
ctx.commands.register('data-dictionary.git.pull',         ({ remote }: { remote?: string }) => git.pull(remote));
ctx.commands.register('data-dictionary.git.push',         ({ remote }: { remote?: string }) => git.push(remote));

ctx.commands.register('data-dictionary.publish.save',    ({ message }: { message: string }) => publish.save(message));
ctx.commands.register('data-dictionary.publish.publish', ({ remote }: { remote?: string }) => publish.publish(remote));
ctx.commands.register('data-dictionary.publish.sync',    ({ remote }: { remote?: string }) => publish.sync(remote));
ctx.commands.register('data-dictionary.publish.revert',  ({ commitHash }: { commitHash: string }) => publish.revert(commitHash));
```

```ts
// frontend/src/kernel/bootstrap.ts (diff)
// - import { createVersionControlPlugin } from '../plugins/version-control/versionControlPlugin';
// - import { createAppRemoteGitPlugin } from '../plugins/remote-fs/remoteGitPlugin';
// + import { createGitPlugin } from '../plugins/git/gitPlugin';
// - import versionReducer from '../store/slices/versionSlice';
// inside registerPlugins:
// - reducerRegistry.register('version', versionReducer);
// - host.registerPlugin('version-control', {...}, createVersionControlPlugin());
// - host.registerPlugin('remote-git', { name: 'remote-git', ..., dependsOn: ['store', 'remote-fs'] }, createAppRemoteGitPlugin());
// + host.registerPlugin('git', { name: 'git', version: '1.0.0', entry: '', dependsOn: ['store', 'remote-fs'] }, createGitPlugin());
```

## Framework APIs used

All citations are absolute paths into `frontend/node_modules/`.

- `@hamak/ui-remote-git-fs` — `createGitPlugin(config: GitPluginConfig): PluginModule`
  - `.d.ts`: `@hamak/ui-remote-git-fs/dist/impl/plugin/git-plugin-factory.d.ts:32`
  - `.js`: `@hamak/ui-remote-git-fs/dist/impl/plugin/git-plugin-factory.js:36-151`
  - Runtime side effects (read from `.js`): `initialize` registers `GIT_CLIENT_TOKEN` and `GIT_PATH_TRANSLATOR_TOKEN` via `ctx.provide`; `activate` resolves `STORE_MANAGER_TOKEN` + `STORE_EXTENSIONS_TOKEN` and registers two middleware (`git-ops` priority 40, `git-sync` priority 30) under `ui-remote-git-fs:middleware`; emits `ui-remote-git-fs:ready` on success. **`GIT_SERVICE_TOKEN` is exported but NOT registered by the factory** (verified at git-plugin-factory.js:76-77 — only `GIT_CLIENT_TOKEN` and `GIT_PATH_TRANSLATOR_TOKEN` are provided).
- `@hamak/ui-remote-git-fs` — `GIT_CLIENT_TOKEN`, `GIT_PATH_TRANSLATOR_TOKEN`, `GIT_SERVICE_TOKEN` (re-exported from `./api`)
  - `.d.ts`: `@hamak/ui-remote-git-fs/dist/api/tokens.d.ts:5-9`
  - `.js`: `@hamak/ui-remote-git-fs/dist/api/tokens.js:5-9`
- `@hamak/ui-remote-git-fs` — `IGitClient` interface (typed contract of the framework's HTTP client, registered under `GIT_CLIENT_TOKEN`)
  - `.d.ts`: `@hamak/ui-remote-git-fs/dist/spi/providers/i-git-client.d.ts:10-87`
  - Surface: `getStatus`, `listBranches`, `checkout`, `createBranch`, `stage`, `unstage`, `commit`, `pull`, `push`, `fetch`, `diff`, `log`. **No `revert`, no `merge`.**
- `@hamak/ui-remote-git-fs` — `HttpGitClient` class (marked legacy in `dist/impl/index.js:20` but still the class the factory instantiates)
  - `.d.ts`: `@hamak/ui-remote-git-fs/dist/impl/providers/http-git-client.d.ts:35-104`
  - The class is what the framework wires under `GIT_CLIENT_TOKEN`. Our `GitService` does NOT consume `HttpGitClient` directly — we run our own axios because we need flexible response-shape handling that matches the legacy backend's loose JSON contracts (`branch` as object-or-string, etc.), and so unit tests can inject a stub like the IntegrityService precedent.
- `@hamak/shared-utils` — `Pathway.ofRoot().resolve(...)` for `mountPoint`
  - Already used in the current `remoteGitPlugin.ts:15`.
- `@hamak/microkernel-spi` — `PluginModule` interface (initialize/activate/deactivate)
  - Already used throughout `frontend/src/plugins/**`.

**Pattern decision**: this is **Pattern B** per cookbook §3b (REST wrapper, no Store FS node). Justification: git operations are computed against the live filesystem on the backend; there's no logical "file" we cache reactive state for. Cookbook §3b's IntegrityService is the precedent — eager `useValue`, optional axios injection, self-contained auth interceptor.

## Acceptance criteria

All checkable. Counts use exact-match grep; existence uses file-stat.

### Frontend file structure

1. `test -f frontend/src/plugins/git/gitPlugin.ts` exits 0.
2. `test -f frontend/src/plugins/git/services/GitService.ts` exits 0.
3. `test -f frontend/src/plugins/data-dictionary/services/PublishService.ts` exits 0.
4. `test ! -e frontend/src/plugins/version-control` exits 0 (folder gone).
5. `test ! -e frontend/src/plugins/remote-fs/remoteGitPlugin.ts` exits 0 (file gone).
6. `test ! -e frontend/src/store/slices/versionSlice.ts` exits 0 (file gone).

### `services/api.ts` excisions (use `grep -F` literal)

7. `grep -cF 'export const versionApi' frontend/src/services/api.ts` returns `0`.
8. `grep -cF 'export const gitApi' frontend/src/services/api.ts` returns `0`.

### Consumer migration (exhaustive — every call-site)

9. `grep -cF 'versionApi.' frontend/src/` (recursive across `*.ts`/`*.tsx`) returns `0`.
10. `grep -cF 'gitApi.' frontend/src/` (recursive across `*.ts`/`*.tsx`) returns `0`.
11. `grep -cF "import { versionApi" frontend/src/` returns `0`.
12. `grep -cF "import { gitApi" frontend/src/` returns `0`.
13. Each migrated file has at least one `useCommand` import:
    - `grep -cF "from '../kernel/useCommand'" frontend/src/components/GitStatusIndicator.tsx` returns `1`.
    - Same check for `frontend/src/components/CommitChanges.tsx`, `frontend/src/components/CommitHistory.tsx`, `frontend/src/pages/SavePublishPage.tsx`, `frontend/src/pages/WorkspacesPage.tsx`, `frontend/src/pages/MergePage.tsx`. (`HomePage.tsx` and `LogicalDiffPage.tsx` already import `useCommand`.)

### CommandMap and registrations

14. `grep -cF "'data-dictionary.git." frontend/src/kernel/commands.ts` returns `7` (seven `.git.*` keys in the CommandMap).
15. `grep -cF "'data-dictionary.publish." frontend/src/kernel/commands.ts` returns `4` (four `.publish.*` keys).
16. `grep -cF "ctx.commands.register('data-dictionary.git." frontend/src/plugins/data-dictionary/dataDictionaryPlugin.ts` returns `7`.
17. `grep -cF "ctx.commands.register('data-dictionary.publish." frontend/src/plugins/data-dictionary/dataDictionaryPlugin.ts` returns `4`.

### Bootstrap

18. `grep -cF "createVersionControlPlugin" frontend/src/kernel/bootstrap.ts` returns `0`.
19. `grep -cF "createAppRemoteGitPlugin" frontend/src/kernel/bootstrap.ts` returns `0`.
20. `grep -cF "'remote-git'" frontend/src/kernel/bootstrap.ts` returns `0`.
21. `grep -cF "'version-control'" frontend/src/kernel/bootstrap.ts` returns `0`.
22. `grep -cF "createGitPlugin" frontend/src/kernel/bootstrap.ts` returns `>= 1`.
23. `grep -cF "name: 'git'" frontend/src/kernel/bootstrap.ts` returns `1`.
24. `grep -cF "versionReducer" frontend/src/kernel/bootstrap.ts` returns `0`.

### Tokens

25. `grep -cF "GIT_SERVICE_TOKEN" frontend/src/kernel/tokens.ts` returns `1`.
26. `grep -cF "PUBLISH_SERVICE_TOKEN" frontend/src/kernel/tokens.ts` returns `1`.

### Backend

27. `test ! -e backend/src/controllers/versionController.ts` exits 0.
28. `test ! -e backend/src/routes/data-dictionary/version.routes.ts` exits 0.
29. `grep -cF "versionRoutes" backend/src/routes/data-dictionary/index.ts` returns `0`.
30. `test -e backend/src/services/versionService.ts` exits 0 (kept; still used by project.routes.ts).
31. `grep -cF "getWorkingTreeStatus" backend/src/services/versionService.ts` returns `>= 1` (the one remaining method).
32. `versionService.ts` slimmed surface (one `grep -cF` per literal; each asserted independently per the calibration narrow-form rule):
    - `grep -cF 'commitChanges' backend/src/services/versionService.ts` returns `0`.
    - `grep -cF 'getCommitHistory' backend/src/services/versionService.ts` returns `0`.
    - `grep -cF 'revertToCommit' backend/src/services/versionService.ts` returns `>= 1` (**kept** for one release — see Risk #3; consumed by the new `publish.routes.ts`).

### Backend tests

33. `api.test.ts` references to endpoints — three independent `grep -cF` assertions (calibration narrow-form rule):
    - `grep -cF '/api/commit' backend/src/__tests__/integration/api.test.ts` returns `0` (sub-test deleted).
    - `grep -cF '/api/history' backend/src/__tests__/integration/api.test.ts` returns `0` (sub-test deleted).
    - `grep -cF '/api/revert' backend/src/__tests__/integration/api.test.ts` returns `>= 1` (KEPT — endpoint moved to `publish.routes.ts`, URL unchanged; only the `commitChanges` / `getCommitHistory` sub-tests are deleted per Files-touched).
34. Backend `npm test` passes. **Preconditions** (must run BEFORE this AC is evaluated): (a) the `describe('Version Control', ...)` block at `backend/src/__tests__/integration/api.test.ts:121-140` has been deleted per Files-touched, AND (b) `backend/src/services/__mocks__/versionService.ts` has been slimmed per Files-touched. Without (a) the test makes calls to `POST /api/commit` and `GET /api/history` which return 404 after `version.routes.ts` deletion (the `POST /api/revert` sub-test stays — its endpoint moves to `publish.routes.ts` but the URL is unchanged); without (b) the mock stubs methods that no longer exist on the real service and Jest's `jest.mock(...)` consistency checks fail in strict mode.

### Frontend tests

35. Frontend `npm test` passes.
36. `frontend/src/plugins/data-dictionary/services/__tests__/spec-grep-guards.commands.test.ts` passes — note that this file is being edited (per "Tests modified" above) to drop the `VERSION_CONTROL_PLUGIN` references AND to bump the exact-counts from 19 to 30 (CommandMap) and 18 to 29 (dataDictionaryPlugin register count). Without that edit the test fails after the source changes.
37. New test `frontend/src/plugins/git/__tests__/spec-grep-guards.git.test.ts` passes with at least these guards (one `it()` per item):
    - `gitPlugin.ts` exists and exports `createGitPlugin`.
    - `GitService.ts` exists and exports `class GitService`.
    - `PublishService.ts` exists and exports `class PublishService`.
    - `frontend/src/services/api.ts` does not contain the literal `'export const versionApi'`.
    - `frontend/src/services/api.ts` does not contain the literal `'export const gitApi'`.
    - No file under `frontend/src/` (excluding the spec-grep guard files themselves) contains the literal `versionApi.` or `gitApi.`.
    - `bootstrap.ts` contains `name: 'git'` exactly once.
    - `dataDictionaryPlugin.ts` registers exactly seven `data-dictionary.git.*` commands AND exactly four `data-dictionary.publish.*` commands.
38. New tests `GitService.test.ts` and `PublishService.test.ts` pass — each constructs the service with an injected axios stub (Pattern B test precedent: IntegrityService.test.ts) and asserts request URL + body.

### Manual smoke (post-implementation by user before merge)

39. With backend running, `/version/save` page loads, shows changed-file list, save button commits, push button pushes.
40. `/version/history` loads commits and revert works.
41. `/version/workspaces` lists branches and switch works.
42. `/version/merge` previews diff and merge-via-pull works.
43. The git status pill in the navbar updates within 30 s (the existing polling cadence in `GitStatusIndicator.tsx`).

## Out of scope

- **Capability gating per #168.** The 2026-05-15 comment requires `capabilities.versionControl && capabilities.branches` to gate plugin activation. That contract doesn't exist yet (no `STORAGE_CAPABILITIES_TOKEN` in the codebase — verified by grep). The git plugin is registered unconditionally for now. Add a single capability-check in `createGitPlugin` (frontend wrapper) when #168 lands. **Risk recorded below.**
- **Raw vs logical workspace per the 2026-05-16 comment.** That comment requires the git plugin to consume `workspaceId: 'dictionaries:raw'` after #167 introduces the dual-view projection. The dual-view doesn't exist yet (backend mounts a single workspace `'dictionaries'` — verified at `backend/src/server.ts:84`). We register with `workspaceId: 'dictionaries'` as today. Mechanical one-line edit when #167 lands.
- **A real `merge` command.** The framework `IGitClient` exposes no `merge` — `MergePage` continues its existing pull-as-simplified-merge behaviour. A true three-way merge UI is its own ticket.
- **Cleanup of the `mock-token-for-testing` fallback** — same dev-environment relic flagged in IntegrityService comments. Out of scope for this PR, tracked alongside `services/api.ts:23-32`.
- **Restoring `state.version` Redux selectors.** No consumer reads from `state.version` outside `versionSlice.ts` itself (verified by grep). Slice deletion is safe; no migration needed.
- **The `getWorkingTreeStatus` endpoint at `/api/project/status`.** It is owned by `project.routes.ts` and #95 — not part of the version-control surface this ticket migrates. Stays as-is.
- **Repointing the `routes.version-control` view contribution to the new plugin.** The hand-rolled plugin's `views.register('routes.version-control', ...)` declared `/version/**`, but `App.tsx` defines those routes directly (verified at App.tsx:140-158). The view contribution was decorative; deleting it has no functional effect. No replacement needed.
- **Filling cookbook §4 (commands+events).** This spec exercises §4's `data-dictionary.git.*` naming pattern; the cookbook update is a separate doc PR per `frontend/docs/patterns.md` status header. **Risk recorded — agents may try to "fill" §4 in this PR; reject that scope creep.**

## Dependencies

- **Builds on #155 (DI services pattern, Pattern B) — merged.** Cookbook §3b is the precedent for `GitService` shape.
- **Builds on #163 (typed commands + `useCommand` hook) — merged.** All migrated components consume the new git surface via `useCommand`.
- **Builds on #156 (notification consolidation) — merged.** The dataDictionaryPlugin's `notifyImpl` forwarder pattern is reused if the new git commands emit toasts (not specified by ticket; keep notification-silent for this slice and add later if UX requires).
- **Coordinates with #157** (backend route split). #157 already moved version routes into `backend/src/routes/data-dictionary/version.routes.ts` (the file we delete). #157 also restructured `index.ts`; the diff to remove `versionRoutes` from there is a single-line edit.
- **Forward-coordinates with #168 (pluggable storage capabilities) — not yet open as a PR.** The 2026-05-15 comment defers capability gating to that ticket.
- **Forward-coordinates with #167 (backend projection / raw-vs-logical workspaces) — not yet open as a PR.** The 2026-05-16 comment defers the `dictionaries:raw` workspace switch to that ticket.

## Risks

1. **`GIT_SERVICE_TOKEN` ownership collision.** The framework exports a `GIT_SERVICE_TOKEN` Symbol from `@hamak/ui-remote-git-fs-api/tokens` but never registers a provider for it (verified at `dist/impl/plugin/git-plugin-factory.js:76-77` — only the two other tokens are provided). We own the local symbol with the same name in `frontend/src/kernel/tokens.ts`. **Mitigation:** use a local symbol (`Symbol('GitService')`) — symbols are unique per identity, so the framework's exported symbol and ours never collide even though they share a debug name. The local token is what `dataDictionaryPlugin` resolves; the framework's token is dead weight, which is fine.
2. **Loose response shapes from the framework `/api/git/**` endpoints.** Existing consumers handle `branch` as object-or-string, `files` as either an array or as `modified|created|deleted` fields, etc. (see GitStatusIndicator.tsx:28-36 and HomePage.tsx:151-159). **Mitigation:** `GitService` returns a `GitStatusDTO` with the same loose-shape, optional-everywhere typing. Migration is mechanical — no shape changes. A future ticket can tighten this once the backend's response is normalized.
3. **`revert` has no framework equivalent.** `IGitClient` exposes no `revert` op (verified at `dist/spi/providers/i-git-client.d.ts:10-87`). The legacy `/api/revert` endpoint was owned by `versionController` which this ticket DELETES. **Mitigation (Path A, applied throughout Files-touched and AC #32):** keep `versionService.revertToCommit` for one release; introduce a new `backend/src/routes/data-dictionary/publish.routes.ts` that owns `POST /api/revert` and delegates to `versionService.revertToCommit(commitHash)`. `PublishService.revert(commitHash)` on the frontend posts to this endpoint. A TODO in `PublishService.revert` points to "remove once upstream framework adds revert." This keeps the UI revert button working and AC #32 explicitly allows `revertToCommit` to remain in the slimmed service.
4. **Capability-gate gap (#168).** Deploying on a non-git backend would activate this plugin and trigger network failures on every `getStatus` poll. **Mitigation:** none in this PR — the codebase has no capability surface yet. Document the gap; when #168 lands, the `createGitPlugin` wrapper gets a one-block early-return.
5. **Test count drift in `spec-grep-guards.commands.test.ts`.** That file hard-codes the CommandMap entry count to 19 (line 126) and the dataDictionaryPlugin register count to 18 (line 183). After this PR those become 30 and 29. **Mitigation:** the Files-touched "tests modified" subsection names this test with five concrete edits including the count-bumps AND the per-name iteration extensions. The new `spec-grep-guards.git.test.ts` (added by this PR) supplements rather than replaces, so the old test still proves the count discipline holds.

6. **Plugin init-order: `data-dictionary` resolves `GIT_SERVICE_TOKEN` synchronously.** If the `git` plugin initializes after `data-dictionary` because `dependsOn` does not list it, `ctx.resolve(GIT_SERVICE_TOKEN)` throws at boot. The current `data-dictionary` manifest is `dependsOn: ['store', 'auth', 'store-fs']` (bootstrap.ts:108) — `git` is missing. **Mitigation:** Files-touched > bootstrap.ts edit explicitly extends `data-dictionary`'s `dependsOn` to include `'git'`. The microkernel's plugin-loader honors `dependsOn` for init ordering, so `git.initialize` (which `ctx.provide`s `GIT_SERVICE_TOKEN`) runs before `data-dictionary.initialize` resolves it.

7. **`PUBLISH_SERVICE_TOKEN` registration may be dead weight.** `dataDictionaryPlugin.initialize` constructs `PublishService` locally, calls `ctx.provide({ provide: PUBLISH_SERVICE_TOKEN, useValue: publish })`, and the 11 command handlers below close over the local `publish` variable directly (not via `ctx.resolve`). No other plugin in the codebase resolves `PUBLISH_SERVICE_TOKEN`. **Mitigation:** the token is provided for forward-compatibility (matching the Pattern B pattern from #155 where every service has a DI handle for future cross-plugin consumers / debug surface). If reviewers prefer YAGNI, the token can be dropped from `tokens.ts` and the `ctx.provide` call removed; the eleven command handlers continue to work. Documented but kept as low-risk surplus.

8. **`gitApi` has 9 methods, not 8.** The legacy `gitApi` block at `frontend/src/services/api.ts:357-395` exports nine methods (`getStatus`, `getBranches`, `createBranch`, `checkout`, `pull`, `push`, `commit`, `getDiff`, `fetch`); `createBranch` and `fetch` are dead (verified by grep, no consumers) but the deletion of the whole block is unchanged. **Mitigation:** doc nit only; the migration plan is unchanged and the dead methods evaporate with the block.
