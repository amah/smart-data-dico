# Migration Plan: smart-data-dico → @hamak/app-framework

## Context

GitHub issue #1 requests migrating smart-data-dico to the `@hamak/app-framework` microkernel architecture for better modularity, plugin support, DI, and testability. The framework repo is at `amah/app-framework` (private). Frontend and backend remain separated.

The current app is a monolithic Express+React stack with file-based YAML persistence, direct `simple-git` usage, scattered `useState`/`useEffect` state, and centralized routing. The target architecture uses the microkernel's plugin lifecycle (initialize → activate → deactivate), DI container, and framework packages for shell, store, auth, filesystem, and git.

---

## Phase 0: Foundation — Install Dependencies & Create Kernel Skeleton

**Goal:** Add framework packages, create the plugin infrastructure skeleton. App continues working as-is.

### Frontend

**New files:**
- `frontend/src/kernel/bootstrap.ts` — Instantiate `Host` from `@hamak/microkernel-impl`, export `bootstrapApplication()` and `host` singleton
- `frontend/src/kernel/tokens.ts` — DI injection tokens for domain services

**Modify:**
- `frontend/package.json` — Add: `@hamak/microkernel-api`, `@hamak/microkernel-spi`, `@hamak/microkernel-impl`, `@hamak/ui-store-api/spi/impl/templates`, `@hamak/ui-shell-api/spi/impl/templates`, `@hamak/shared-utils`, `@reduxjs/toolkit`, `react-redux`
- `frontend/src/main.tsx` — Call `bootstrapApplication()` before React render

### Backend

**New files:**
- `backend/src/kernel/config.ts` — Centralize config (data dir, git settings, JWT secret)

**Modify:**
- `backend/package.json` — Add: `@hamak/filesystem-server-api/spi/impl`, `@hamak/ui-remote-git-fs-backend`, `@hamak/shared-utils`

**Verify:** All existing tests pass after dependency install.

---

## Phase 1: Backend — Filesystem Server + Git Integration

**Goal:** Replace hand-rolled `fileOperations.ts` and `simple-git` with `@hamak/filesystem-server-impl` and `@hamak/ui-remote-git-fs-backend`.

**Depends on:** Phase 0

### Step 1.1: Adapt WorkspaceManager

**New files:**
- `backend/src/adapters/EntityFileAdapter.ts` — Wraps `WorkspaceManager` to provide the same API as current `fileOperations.ts` functions (`readEntityFile`, `writeEntityFile`, `listAllEntities`, etc.). Preserves existing service layer contracts.
- `backend/src/adapters/YamlFileInfoEnricher.ts` — `FileInfoEnricher` that parses `.yaml` files and adds entity metadata.

**Modify:**
- `backend/src/utils/fileOperations.ts` — Delegate to `EntityFileAdapter` internally, keep exported function signatures unchanged so services don't break.
- `backend/src/server.ts` — Mount `FileRouter` at `/fs` and git routes at `/api/git` alongside existing routes:
  ```typescript
  const workspaceManager = new WorkspaceManager(config, { baseDirectory });
  const fileRouter = new FileRouter(workspaceManager, { enricherRegistry });
  app.use('/fs', fileRouter.router);
  app.use('/api/git', createGitRoutes({ gitService }));
  ```

### Step 1.2: Replace versionService

**Modify:**
- `backend/src/services/versionService.ts` — Replace direct `simple-git` usage with `createGitService` from `@hamak/ui-remote-git-fs-backend`. Same interface, new internals.

### Key constraint
Existing domain routes (`/api/services/...`, `/api/dictionaries/...`, `/api/search`, `/api/graph/...`) stay unchanged — they contain domain logic that `FileRouter` doesn't replace. Both coexist.

**Verify:** All backend tests pass. New integration tests for `/fs` and `/api/git` endpoints.

---

## Phase 2: Frontend — Store Plugin & State Management

**Goal:** Introduce Redux via `@hamak/ui-store-impl` to centralize state currently scattered across components.

**Depends on:** Phase 0

### Step 2.1: Store plugin

**New files:**
- `frontend/src/plugins/store/storePlugin.ts` — Create plugin via `createStorePlugin()` from `@hamak/ui-store-impl`
- `frontend/src/plugins/store/index.ts` — Export plugin factory

**Modify:**
- `frontend/src/kernel/bootstrap.ts` — Register store plugin first (others depend on it)

### Step 2.2: Domain Redux slices

**New files** (each wraps existing `api.ts` functions via `createAsyncThunk`):
- `frontend/src/store/slices/authSlice.ts` — User, token, auth status
- `frontend/src/store/slices/servicesSlice.ts` — Microservices list, entities
- `frontend/src/store/slices/entitySlice.ts` — Current entity, CRUD
- `frontend/src/store/slices/dictionarySlice.ts` — Dictionaries
- `frontend/src/store/slices/diagramSlice.ts` — Diagram layouts
- `frontend/src/store/slices/versionSlice.ts` — Commit history
- `frontend/src/store/slices/searchSlice.ts` — Search results

### Step 2.3: Wrap App with StoreProvider

**Modify:**
- `frontend/src/main.tsx` or `App.tsx` — Resolve store from kernel, wrap with `<Provider store={storeManager.getStore()}>`.

### Step 2.4: Incremental component migration

Migrate components from `useState`+`useEffect` to `useSelector`+`useDispatch` in priority order:
1. `Sidebar.tsx` (3 separate API calls)
2. `AuthGuard.tsx` (per-instance auth check → store-based)
3. `EntityList.tsx`, `EntityDetail.tsx`
4. `SearchComponent.tsx`
5. Remaining components

**Verify:** Existing component tests still pass. New unit tests for Redux slices.

---

## Phase 3: Frontend — Shell, Auth & Feature Plugins

**Goal:** Decompose frontend into plugins. Introduce shell for layout/theming, auth plugin, and domain feature plugins.

**Depends on:** Phase 2

### Step 3.1: Shell plugin

**New files:**
- `frontend/src/plugins/shell/shellPlugin.ts` — Provides `ShellProvider`, theme config mapped to DaisyUI
- `frontend/src/plugins/shell/ShellLayout.tsx` — Adapts current `Layout.tsx`. Renders existing `Navbar`, `Sidebar`, `Breadcrumbs`, `Footer` as slot content (not rewritten).

**Modify:**
- `frontend/src/App.tsx` — Replace `<Layout />` with `<ShellLayout />`

### Step 3.2: Auth plugin

**New files:**
- `frontend/src/plugins/auth/authPlugin.ts` — Registers auth service in DI, registers auth Redux slice, restores session on activate
- `frontend/src/plugins/auth/AuthService.ts` — Wraps existing `authApi`
- `frontend/src/plugins/auth/useAuth.ts` — Hook resolving auth from kernel + store

**Modify:**
- `frontend/src/components/AuthGuard.tsx` — Simplified to use `useAuth()` hook
- `frontend/src/components/Login.tsx` — Dispatch through store

### Step 3.3: Feature plugins (declare ownership, no file moves)

Each plugin registers its Redux slices and declares route ownership. Components stay in their current file locations.

| Plugin | New file | Owns |
|--------|----------|------|
| data-dictionary | `plugins/data-dictionary/dataDictionaryPlugin.ts` | `/services/**`, `/dictionaries/**`, entity components, services/entity/dictionary slices |
| visualization | `plugins/visualization/visualizationPlugin.ts` | `/visualization/**`, `/diagram/**`, diagram components, diagram slice |
| search | `plugins/search/searchPlugin.ts` | `/search`, `/entities/flat`, flat table components, search slice |
| version-control | `plugins/version-control/versionControlPlugin.ts` | `/version/**`, commit components, version slice |

**Verify:** All routes render correctly. Shell layout displays Navbar/Sidebar/content.

---

## Phase 4: Frontend — Remote Resource & Notification

**Goal:** Connect frontend to backend's `/fs` and `/api/git` endpoints via framework services.

**Depends on:** Phase 1, Phase 2

**New files:**
- `frontend/src/plugins/remote-fs/remoteFsPlugin.ts` — Registers `@hamak/ui-remote-fs-impl`, points to backend `/fs`
- `frontend/src/plugins/remote-fs/remoteGitPlugin.ts` — Registers `@hamak/ui-remote-git-fs-impl`, points to `/api/git`
- `frontend/src/plugins/notification/notificationPlugin.ts` — Registers `@hamak/notification-impl` for success/error feedback

**Modify:**
- `frontend/vite.config.ts` — Add proxy rules for `/fs` and `/api/git` to backend
- `frontend/src/store/slices/versionSlice.ts` — Optionally delegate to remote git service

**Verify:** Remote-fs can list/read files. Git plugin fetches commit history.

---

## Phase 5: Cleanup & Optimization

**Goal:** Remove legacy code, finalize plugin boundaries.

- Remove `simple-git` dependency from `backend/package.json`
- Remove legacy functions from `fileOperations.ts` fully replaced by `EntityFileAdapter`
- Replace `backend/src/utils/logger.ts` with `@hamak/logging`
- Enable feature flags via shell plugin for conditional feature rendering
- Update `CLAUDE.md` with new architecture
- Full regression test

---

## What does NOT become a plugin

- `frontend/src/types/index.ts` — Shared types, plain module
- `frontend/src/services/api.ts` — Axios client, consumed by Redux thunks
- `Navbar.tsx`, `Footer.tsx`, `Breadcrumbs.tsx` — Shell slot content, not plugins
- `backend/src/models/*` — Domain models stay as plain modules
- `backend/src/controllers/*` — Keep current form

## Plugin Dependency Graph

```
Frontend:
  store (no deps)
  ├── shell (depends on: store)
  ├── auth (depends on: store)
  ├── remote-fs (depends on: store)
  ├── notification (depends on: store)
  ├── data-dictionary (depends on: store, auth)
  ├── visualization (depends on: store, data-dictionary)
  ├── search (depends on: store, data-dictionary)
  └── version-control (depends on: store, auth)
```

## Watch List

1. **Vite proxy** — Must forward `/fs` and `/api/git` in addition to `/api`
2. **File paths** — `WorkspaceManager` base dir must match current `fileOperations.ts` path resolution
3. **Mock token** — `Bearer mock-token-for-testing` pattern in `jwtAuth.ts` must be preserved
4. **React 18 compat** — Verify `@hamak` packages work with React 18
5. **DaisyUI theming** — Shell theme must map to DaisyUI's `data-theme` attribute, not fight it

## Verification

After each phase:
- `cd backend && npm test` — All backend tests pass
- `cd frontend && npm test` — All frontend tests pass
- Manual smoke test: login, browse services/entities, create/edit entity, visualize diagram, commit, search
