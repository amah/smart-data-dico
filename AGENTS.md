# Repository Guidelines

## Project Overview

Smart Data Dictionary is a full-stack TypeScript app for creating, editing, versioning, and sharing data dictionaries. Persistence is file-based: project folders contain `dico.config.json`, package YAML files, and `.dico/` system files. Development defaults to `samples/eshop/`; production selects a project with `DATA_DIR` or `--data-dir`.

## Project Structure & Module Organization

Backend code lives in `backend/src`: `routes`, `controllers`, `services`, `storage`, `models`, `middleware`, `utils`, and `mcp`. Frontend code lives in `frontend/src`: views in `pages`, UI in `components`, app-framework plugins in `plugins`, and shared state/utilities in `store`, `services`, `hooks`, and `utils`. Tests are colocated in `__tests__`; Playwright specs are in `frontend/e2e`. Docs are in `docs/`, scripts in `scripts/`, CLI entries in `bin/`.

## Build, Test, and Development Commands

- `npm run build`: builds frontend and backend.
- `npm start`: runs the packaged CLI entry point at `bin/cli.js`.
- `cd backend && npm run dev`: seeds the active project and starts the backend on port 3001.
- `cd backend && npm test`: runs Jest backend tests.
- `cd backend && npm run lint`: runs backend ESLint rules.
- `cd frontend && npm run dev`: starts Vite on port 3000, proxying `/api`, `/fs`, and `/api/git` to backend port 3001.
- `cd frontend && npm test`: runs Vitest frontend tests once.
- `cd frontend && npm run e2e`: runs Playwright end-to-end tests.

Use `npm ci` in `backend/` and `frontend/` when reproducing CI on Node.js 16.

## Coding Style & Naming Conventions

Use TypeScript, two-space indentation, and semicolons. Use PascalCase for classes and React components, camelCase for functions and variables, and descriptive service names such as `conversationService.ts`.

Backend ESLint warns on `any`, rejects unused variables unless prefixed with `_`, and restricts direct `fs` or `fs/promises` imports outside the allow-list. Use `IStorageBackend` from `backend/src/storage/contract/` for storage-facing work. Frontend imports can use the `@/` alias for `frontend/src`.

## Architecture & Data Model Notes

Backend routes are Express endpoints; framework routes mount remote filesystem access at `/fs` and git access at `/api/git`. Swagger UI is available at `/api-docs`.

Any package-level `.yaml` file may include `entities`, `relationships`, `rules`, and `perspectives`; filenames such as `<Name>.model.yaml` are conventions only. Keep validation, persistence constraints, and business rules distinct: `attribute.validation`, `entity.constraints[]`, and first-class `Rule` objects.

## Testing Guidelines

Backend tests use Jest, ts-jest, and Supertest; frontend tests use Vitest, Testing Library, MSW, and Playwright. Name tests `.test.ts` or `.test.tsx` and keep them near changed code. For coverage, run `cd backend && npm run test:coverage` or `cd frontend && npm run test:coverage`.

## Commit & Pull Request Guidelines

Recent history follows Conventional Commits, for example `feat(diagram): ...`, `fix(diagram): ...`, `docs(format-reference): ...`, and `chore(release): ...`. PRs should include a concise description, linked issue when available, test commands run, and screenshots or recordings for UI changes. Call out schema, storage, migration, or configuration changes explicitly.

## Agent-Specific Instructions

Prefer existing package boundaries and plugin patterns. Do not bypass the storage contract with direct filesystem access in production code. Preserve YAML UUID stability and avoid convention-only renames unless required. Development auth supports `Bearer mock-token-for-testing`.
