# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Smart Data Dictionary Management System — a full-stack app for creating, editing, versioning, and sharing data dictionaries. Uses **file-based persistence** (YAML/JSON files in `backend/data-dictionaries/`), not a traditional database. Version control is handled via `simple-git`.

## Commands

### Backend (`cd backend`)
- **Dev server:** `npm run dev` (nodemon + ts-node, port 3001)
- **Build:** `npm run build` (tsc)
- **Test all:** `npm test`
- **Single test:** `npx jest path/to/test.ts`
- **Test with coverage:** `npm run test:coverage`
- **Lint:** `npm run lint`

### Frontend (`cd frontend`)
- **Dev server:** `npm run dev` (Vite, port 3000, proxies `/api` to backend on 3001)
- **Build:** `npm run build` (tsc + vite build)
- **Test all:** `npm test`
- **Single test:** `npx vitest run path/to/test.ts`
- **Test watch mode:** `npm run test:watch`
- **Test with coverage:** `npm run test:coverage`
- **Lint:** `npm run lint`

## Architecture

### Monorepo with two apps
- **`backend/`** — Express + TypeScript (CommonJS). Layered: controllers → services → models. Data persisted as YAML files under `backend/data-dictionaries/microservices/{service-name}/`.
- **`frontend/`** — React 18 + Vite + TypeScript (ESM). Styled with Tailwind CSS + DaisyUI. Uses React Query for data fetching, ReactFlow/D3/Mermaid for visualization.

### Backend layers
- **Routes** (`src/routes/index.ts`): All API endpoints (~65 routes) defined in one file
- **Controllers** (`src/controllers/`): Request handlers for auth, dictionaries, services, versions, diagrams
- **Services** (`src/services/`): Business logic — `dictionaryService.ts` and `serviceService.ts` are the core modules
- **Models** (`src/models/`): TypeScript interfaces + JSON Schema validation (`EntitySchema.ts`, `Dictionary.ts`)
- **Middleware** (`src/middleware/`): Basic auth + JWT auth with role-based access (ADMIN, EDITOR, VIEWER)
- **Utils** (`src/utils/fileOperations.ts`): All file I/O for YAML-based persistence

### Frontend organization
- **Pages** (`src/pages/`): Route-level components
- **Components** (`src/components/`): Reusable UI — `EntityTreeTable.tsx` is the largest component (77KB)
- **Services** (`src/services/api.ts`): Axios client with organized sub-APIs (`servicesApi`, `dictionaryApi`, `versionApi`, etc.)
- **Types** (`src/types/index.ts`): Shared TypeScript interfaces
- **Path alias:** `@/` maps to `src/`

### Auth
- JWT-based authentication with Auth0 on frontend
- Dev mode supports mock token: `Bearer mock-token-for-testing`
- Three roles: ADMIN (full), EDITOR (create/update), VIEWER (read-only)
- Mock dev users: admin/admin123, editor/editor123, viewer/viewer123

### Data model
- Entities belong to microservices (packages). Each entity is a YAML file identified by UUID.
- Entities have attributes (typed fields) and relationships to other entities.
- Diagrams stored as JSON files in `backend/data-dictionaries/diagrams/`.

### Testing
- **Backend:** Jest + Supertest. Tests in `src/**/__tests__/`.
- **Frontend:** Vitest + React Testing Library + MSW for API mocking. Setup in `src/test/setup.ts`.

### API docs
Swagger UI available at `/api-docs` when backend is running.
