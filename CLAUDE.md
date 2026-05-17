# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Smart Data Dictionary Management System — a full-stack app for creating, editing, versioning, and sharing data dictionaries. Uses **file-based persistence** (YAML/JSON files in a project folder identified by `dico.config.json`), not a traditional database. In dev mode the backend serves the bundled sample project at `samples/eshop/` (the only sample the repo ships). Production deployments point at their own project via the `DATA_DIR` env var or the CLI `--data-dir` flag. Built on the **@hamak/app-framework** microkernel architecture for modularity and plugin support.

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
- **`backend/`** — Express + TypeScript (ESM via `tsx`). Layered: controllers → services → models. Data persisted as YAML files under the project root — one top-level folder per package (e.g. `samples/eshop/order-service/`) and project-level system files under `.dico/`.
- **`frontend/`** — React 18 + Vite + TypeScript (ESM). Styled with Tailwind CSS + DaisyUI. Uses @hamak/app-framework microkernel with Redux store, Cytoscape.js for visualization.

### Backend layers

Backend is a plain Express app; the framework provides only the FS and git route mounts.

- **Routes** (`src/routes/index.ts`): All API endpoints (~90 routes) defined in one file
- **Controllers** (`src/controllers/`): Request handlers for auth, dictionaries, services, versions, diagrams, stereotypes, perspectives, import/export
- **Services** (`src/services/`): Business logic — `serviceService.ts` (entities, search, impact), `dictionaryService.ts` (packages), `stereotypeService.ts`, `perspectiveService.ts` (BFS resolution), `importService.ts`, `exportService.ts`, `qualityService.ts`. All domain services consume `IStorageBackend`. `fileOperations.ts` (slice 5) and `schemaEntityWriter.ts` (slice 5b) are fully migrated. An ESLint `no-restricted-imports` rule on `fs` and `fs/promises` blocks new direct-`fs` imports outside an allow-list (slice 5c; see `backend/.eslintrc.cjs`). Three legacy production sites — `controllers/modelMetadataController.ts`, `routes/project.routes.ts`, `services/dicoConfigService.ts` — are temporarily allow-listed pending follow-up migrations. Bootstrap, storage internals, scripts, and tests are permanently allow-listed.
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
- **ai-assistance** — Chat panel, conversation history, prompt CRUD, slash commands; consumes data-dictionary services for grounding

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

Multi-kind YAML (#106): any `.yaml` file inside a package folder may carry any subset of four top-level sections — `entities:`, `relationships:`, `rules:`, `perspectives:`. The loader is **content-driven**: it scans every file in the package folder, merges the sections, and raises a hard error with both paths on identifier collisions (same entity name, rule uuid, perspective uuid, relationship uuid). Filenames are a human convention only — `*.model.yaml` for mixed content, `*.perspective.yaml` for perspective-centric files, `package.yaml` reserved as the package marker.

- **Entities** belong to packages. Live in any `.yaml` under the package folder as an `entities:` entry. Default convention: one entity per `<Name>.model.yaml`. Entities carry attributes, metadata, stereotype, status, and (inline since #106) `reviewComments` and `rules`.
- **Relationships** at package level in a `relationships:` section (conventionally `relationships.model.yaml`), with source/target entity UUIDs and cardinality.
- **Stereotypes** define metadata schemas per element type. Stored in `<project-root>/.dico/stereotypes.yaml` or as schema-entities under `.dico/schemas/<slug>.entity.yaml` (#165). In the eshop sample, the schema-entity form is canonical and the legacy YAML is empty (`[]`). The reserved metadata key `displayName` on schema-entities holds the human-readable display name when it differs from the slug (e.g. `pii` → `PII`, `aggregate-root` → `Aggregate Root`). UUID stability: schema-entity UUIDs are generated once at migration time, committed to git, and never regenerated.
- **Perspectives** define business views with BFS entity resolution and path-based annotations. Live anywhere in a package as a `perspectives:` section; default convention is one perspective per `<Name>.perspective.yaml` inside the owning package. The legacy project-root `perspectives/` folder is gone (#106).
- **Review comments** and **entity-scoped rules**: inlined on the entity as `entity.reviewComments` and `entity.rules`. The legacy `*.comments.yaml` / `*.rules.yaml` sidecars were eliminated in #106.
- **Diagrams** stored as JSON files in `<project-root>/.dico/diagrams/`.

### Derived data types (#107)

`dico.config.json.types[]` declares reusable **derived types** — named shapes built on a standard `AttributeType` (or on another derived type, transitively). Example:

```json
{ "name": "email", "basedOn": "string", "validation": { "pattern": "^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$", "maxLength": 254 } }
```

An attribute can declare `type: email` instead of `string`; validation merges base→derived so the derived fields win. Circular derivation is a hard error at `PUT /api/config/types`. The attribute-type picker (frontend `AttributeEditor`) surfaces them in a "Derived" optgroup alongside the standard set. JSON Schema export emits each derived type as a named `$defs` entry, with attributes pointing at `#/$defs/<name>`. CRUD UI lives at `/types` (`DerivedTypesPage`).

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
- `@hamak/notification` — Notification system (subpath exports: ., /api, /spi)
- `@hamak/logging` — Pluggable logging system (subpath exports: ., /api, /spi)

### API docs
Swagger UI available at `/api-docs` when backend is running.
