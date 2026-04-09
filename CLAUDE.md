# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Smart Data Dictionary Management System — a full-stack app for creating, editing, versioning, and sharing data dictionaries. Uses **file-based persistence** (YAML/JSON files in `data-dictionaries/`), not a traditional database. Built on the **@hamak/app-framework** microkernel architecture for modularity and plugin support.

## Commands

### Backend (`cd backend`)
- **Dev server:** `npm run dev` (nodemon + tsx, port 3001)
- **Build:** `npm run build` (tsc)
- **Test all:** `npm test`
- **Single test:** `npx jest path/to/test.ts`
- **Test with coverage:** `npm run test:coverage`
- **Lint:** `npm run lint`

### Frontend (`cd frontend`)
- **Dev server:** `npm run dev` (Vite, port 3000, proxies `/api`, `/fs`, `/api/git` to backend on 3001)
- **Build:** `npm run build` (tsc + vite build)
- **Test all:** `npm test`
- **Single test:** `npx vitest run path/to/test.ts`
- **Test watch mode:** `npm run test:watch`
- **Test with coverage:** `npm run test:coverage`
- **Lint:** `npm run lint`

## Architecture

### Monorepo with two apps
- **`backend/`** — Express + TypeScript (ESM via `tsx`). Layered: controllers → services → models. Data persisted as YAML files under `data-dictionaries/microservices/{service-name}/`.
- **`frontend/`** — React 18 + Vite + TypeScript (ESM). Styled with Tailwind CSS + DaisyUI. Uses @hamak/app-framework microkernel with Redux store, Cytoscape.js for visualization.

### Backend layers
- **Routes** (`src/routes/index.ts`): All API endpoints (~90 routes) defined in one file
- **Controllers** (`src/controllers/`): Request handlers for auth, dictionaries, services, versions, diagrams, stereotypes, perspectives, import/export
- **Services** (`src/services/`): Business logic — `serviceService.ts` (entities, search, impact), `dictionaryService.ts` (packages), `stereotypeService.ts`, `perspectiveService.ts` (BFS resolution), `importService.ts`, `exportService.ts`, `qualityService.ts`
- **Models** (`src/models/`): TypeScript interfaces + JSON Schema validation (`EntitySchema.ts`, `Dictionary.ts`)
- **Middleware** (`src/middleware/`): Basic auth + JWT auth with role-based access (ADMIN, EDITOR, VIEWER)
- **Kernel** (`src/kernel/config.ts`): Centralized configuration
- **Adapters** (`src/adapters/`): `EntityFileAdapter.ts` wraps `@hamak/filesystem-server-impl`, `YamlFileInfoEnricher.ts` adds entity metadata to file listings
- **Utils** (`src/utils/fileOperations.ts`): YAML file I/O, git commits via `@hamak/ui-remote-git-fs-backend`
- **Framework routes**: `/fs` (filesystem via `@hamak/filesystem-server-impl`), `/api/git` (git via `@hamak/ui-remote-git-fs-backend`)

### Frontend — Microkernel Plugin Architecture
The frontend uses `@hamak/app-framework` microkernel with these plugins (registered in `src/kernel/bootstrap.ts`):

- **store** — Redux store via `@hamak/ui-store-impl` with 10 domain slices
- **shell** — Layout/theming via `@hamak/ui-shell-impl`, synced with DaisyUI themes
- **auth** — Authentication wrapping existing `authApi`, session restore
- **data-dictionary** — Routes and commands for `/packages/**`, `/services/**`, `/dictionaries/**`
- **visualization** — Routes for `/visualization/**`, `/diagram/**` (Cytoscape.js)
- **search** — Routes for `/search`, `/entities/flat`, `/flat/**`
- **version-control** — Routes for `/version/**`, save/publish/workspaces/merge
- **perspective** — Routes for `/perspectives/**`, BFS resolution, graph overlay
- **remote-fs** — `@hamak/ui-remote-fs-impl` pointing to backend `/fs`
- **remote-git** — `@hamak/ui-remote-git-fs-impl` pointing to backend `/api/git`
- **notification** — Toast notifications with command-based API

### Frontend organization
- **Kernel** (`src/kernel/`): `bootstrap.ts` (Host + plugin registration), `tokens.ts` (DI tokens)
- **Plugins** (`src/plugins/`): One directory per plugin with plugin factory, services, hooks
- **Store** (`src/store/slices/`): Redux slices — auth, services, entity, dictionary, diagram, packages, stereotypes, perspectives, version, search
- **Pages** (`src/pages/`): Route-level components
- **Components** (`src/components/`): Reusable UI
- **Services** (`src/services/api.ts`): Axios client with organized sub-APIs
- **Types** (`src/types/index.ts`): Shared TypeScript interfaces
- **Path alias:** `@/` maps to `src/`

### Auth
- JWT-based authentication with Auth0 on frontend
- Dev mode supports mock token: `Bearer mock-token-for-testing`
- Three roles: ADMIN (full), EDITOR (create/update), VIEWER (read-only)
- Mock dev users: admin/admin123, editor/editor123, viewer/viewer123

### Data model
- **Entities** belong to packages. Each entity is a YAML file (`{uuid}_{name}.yaml`) with attributes, metadata, stereotype, and status (draft/submitted/approved/returned).
- **Relationships** stored at package level in `relationships.yaml` with source/target entity UUIDs and cardinality.
- **Stereotypes** define metadata schemas per element type. Stored in `data-dictionaries/stereotypes.yaml`.
- **Perspectives** define business views with BFS entity resolution and path-based annotations. Stored in `data-dictionaries/perspectives/{uuid}.yaml`.
- **Review comments** stored as sidecar files: `{entityUuid}.comments.yaml`.
- **Diagrams** stored as JSON files in `data-dictionaries/diagrams/`.

### Validation / Constraint / Rule — three concepts, three homes (#85)

These three words are kept strictly separate. **Do not collapse them.**

| Concept | Lives as | Owned by | Examples |
|---|---|---|---|
| **Validation** | `attribute.validation` (nested object alongside `type` and `required`) | Data steward modelling the attribute | `maxLength`, `minLength`, `pattern`, `format`, `enum`, `minimum`, `maximum`, `precision`, `scale` |
| **Constraint** | `entity.constraints[]` (top-level array of `PhysicalConstraint`) | DBA / persistence layer | `unique`, `check`, `foreignKey`, `index` — captured from SQL DDL or live DB introspection |
| **Rule** | First-class `Rule` object (entity sidecar / package / perspective) | Business / domain expert | "Order total = sum of line items", "Active users must have a verified email" — cross-attribute, conditional, or lifecycle invariants |

**Do not** synthesize Rules from validation fields (the auto-synthesizer was deleted in #85 R2 — every entry it produced was already type metadata). The Integrity page (`/integrity`, see R5) is the single pane of glass that shows all three categories together with per-category filters.

### Testing
- **Backend:** Jest + ts-jest (CJS transform with `moduleNameMapper` for `.js` extension stripping) + Supertest. Tests in `src/**/__tests__/`. Config: `jest.config.cjs`.
- **Frontend:** Vitest + React Testing Library + MSW for API mocking. Setup in `src/test/setup.ts`.

### @hamak/app-framework packages used
- `@hamak/microkernel-api`, `@hamak/microkernel-spi`, `@hamak/microkernel-impl` — Core kernel with DI, commands, hooks
- `@hamak/ui-store-api`, `@hamak/ui-store-impl` — Redux store management
- `@hamak/ui-shell-api`, `@hamak/ui-shell-impl` — Shell/layout/theming
- `@hamak/ui-remote-fs-api`, `@hamak/ui-remote-fs-impl` — Remote filesystem client
- `@hamak/ui-remote-git-fs-impl` — Remote git client (frontend)
- `@hamak/ui-remote-git-fs-backend` — Git service + routes (backend)
- `@hamak/filesystem-server-api`, `@hamak/filesystem-server-impl` — Filesystem server with workspace management (backend)
- `@hamak/notification-api`, `@hamak/notification-impl` — Notification system

### API docs
Swagger UI available at `/api-docs` when backend is running.
