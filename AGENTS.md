# Repository Guidelines

## Project Overview

Smart Data Dictionary is a TypeScript application for creating, versioning, and sharing file-backed data dictionaries. Projects contain `dico.config.json`, package YAML files, and `.dico/` system data. Development uses `samples/eshop/`; production selects a project with `DATA_DIR` or `--data-dir`.

## Project Structure & Module Organization

- `backend/src/`: Express routes, controllers, services, models, middleware, storage adapters, and MCP support. Business services must use `IStorageBackend`.
- `frontend/src/`: React pages and components, Redux state, API clients, and `@hamak/app-framework` plugins registered in `kernel/bootstrap.ts`.
- `backend/src/**/__tests__/` and frontend colocated `*.test.ts(x)` files: unit and integration tests.
- `frontend/e2e/`: Playwright scenarios. Documentation, scripts, CLI entries, and examples live in `docs/`, `scripts/`, `bin/`, and `samples/`.

## Build, Test, and Development Commands

- `npm run build`: build both applications; `npm start` runs `bin/cli.js`.
- `cd backend && npm run dev`: start the API on port 3001. Use `npm test`, `npm run test:coverage`, or `npx jest path/to/test.ts`.
- `cd frontend && npm run dev`: start Vite on port 3000 with backend proxies. Use `npm test`, `npm run test:watch`, `npm run test:coverage`, or `npx vitest run path/to/test.ts`.
- Run `npm run lint` in either application. Use `npm ci` in both directories when reproducing CI.

## Coding Style & Architecture

Use TypeScript, two-space indentation, semicolons, PascalCase for components/classes, and camelCase for functions/variables. Frontend imports may use `@/` for `frontend/src`.

Follow existing layers: routes -> controllers -> services -> storage/models. Prefer established microkernel plugins and dependency-injection tokens over cross-plugin imports. Backend ESLint rejects unused variables unless prefixed `_` and restricts direct `fs` imports; never bypass the storage contract.

## Data, Security, and Configuration

YAML loading is content-driven: any package `.yaml` may contain `entities`, `relationships`, `rules`, or `perspectives`; filenames are conventions. Preserve UUIDs and keep `attribute.validation`, `entity.constraints[]`, and first-class business `Rule` objects distinct.

SQL execution must remain read-only. Never persist or log database passwords outside the secret-store mechanism. Development authentication supports `Bearer mock-token-for-testing`; do not commit real credentials.

## Testing Guidelines

Backend tests use Jest, ts-jest, and Supertest. Frontend tests use Vitest, Testing Library, MSW, and Playwright. Name tests `*.test.ts` or `*.test.tsx`, colocate them with changed code, and add focused regression coverage for behavior changes.

## Release & Publishing

Package releases use Semantic Versioning and `v<version>` tags. Update `CHANGELOG.md`, then bump the root `package.json` and `package-lock.json` together. From a clean release commit, run backend and frontend lint/tests, `npm run build`, and `npm publish --dry-run --access public`; inspect the packed file list before publishing `@hamak/smart-data-dico` with `npm publish --access public`. Create and push the matching tag only after the release contents are verified. Publishing is manual; do not publish or tag without explicit maintainer approval.

Desktop releases are separate. A `desktop-v<version>` tag triggers `.github/workflows/desktop-release.yml`, which builds installers and creates the GitHub Release. `workflow_dispatch` validates builds but does not publish a release. Never substitute a package `v*` tag for a desktop tag.

## Commit & Pull Request Guidelines

Use Conventional Commits, such as `feat(diagram): ...`, `fix(sql): ...`, or `docs(format-reference): ...`. PRs should describe the change, link issues, list verification commands, and include screenshots or recordings for UI work. Explicitly call out schema, storage, migration, security, or configuration changes.
