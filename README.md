# Smart Data Dictionary

A collaborative data dictionary management system for modeling, documenting, and governing your organization's data landscape. Built on a microkernel plugin architecture for modularity, with file-based persistence (YAML/Git) designed for both technical and non-technical users.

## Core Concepts

### Packages

Packages organize entities into logical groups reflecting your system architecture (microservices, modules, bounded contexts). They are hierarchical -- packages can contain sub-packages, forming a tree that mirrors your application structure.

- Navigable via nested URLs: `/packages/eShop/ordering/entities/Order`
- Each package has a dashboard with entity counts, relationship counts, and metadata
- Package names follow kebab-case convention

### Entities & Attributes

Entities are the primary modeling unit -- they represent data structures (tables, documents, events, value objects). Each entity has:

- **Attributes** with types (string, number, integer, boolean, datetime, enum, object, array), constraints (min/max length, pattern, precision), and metadata
- **Nested attributes** for object and array types (e.g. `shippingAddress.postalCode`)
- **Status lifecycle**: draft -> submitted -> approved (or returned)
- **UUID-based identity** for stable cross-references

### Relationships

Relationships connect entities across packages. They are stored at the package level and define:

- **Source and target** entity (by UUID) with cardinality (one/many)
- **Navigation property names** for path traversal
- **Metadata** on the relationship itself

### Stereotypes

Stereotypes define metadata schemas that apply to specific element types (entity, attribute, or package). When assigned, they auto-populate required and optional metadata fields, ensuring consistency.

**Predefined stereotypes:**

| Stereotype | Applies To | Required Fields |
|-----------|-----------|-----------------|
| Aggregate Root | Entity | bounded-context |
| Reference Data | Entity | cacheable (flag) |
| Domain Event | Entity | event-source |
| Value Object | Entity | immutable (flag) |
| PII | Attribute | pii-category |
| Indexed | Attribute | - |
| Deprecated | Attribute | deprecated-since |

**Metadata types**: string, number, boolean, date, **flag** (semantic boolean rendered as toggle), **rule** (text + severity: info/warning/error).

### Perspectives

A Perspective captures a business view over a subset of the data model scoped to a business process (e.g. "Ordering", "Billing"). It is the core differentiating concept of the application.

**How it works:**

1. Select **root entities** -- the starting points of the business process
2. The system performs **BFS traversal** through relationships to discover all reachable entities
3. Each entity is identified by its **relationship path from root** (e.g. `Order/orderItems/product`)
4. The same entity reached via different paths is treated as separate usages

**Path grammar** -- uniform `/` navigation for all levels:
```
Order                              -- root entity
Order/totalAmount                  -- attribute on root
Order/orderItems                   -- relationship -> OrderItem
Order/orderItems/quantity          -- attribute on OrderItem
Order/orderItems/product/sku       -- deep chain -> attribute
Order/shippingAddress/postalCode   -- attribute via relationship
Order/billingAddress/postalCode    -- same attribute, different path
```

**PerspectiveNode** annotations on any path:
- **`traverse: false`** -- frontier node (include but stop BFS here)
- **`exclude: true`** -- prune this path entirely
- **`metadata`** -- path-scoped annotations (not overrides -- new metadata specific to this perspective usage)

### Review Workflow

Entities go through a status lifecycle for team governance:

```
draft --> submitted --> approved
                   \-> returned (with comments) --> submitted
```

- **Comments** can target specific attributes (e.g. "Missing validation rule on discountRate")
- **Status transitions** are role-gated (editors submit, admins approve/return)
- Comments are stored as sidecar YAML files per entity

### Quality Metrics

The quality dashboard tracks documentation completeness:

- **Description coverage** -- % of entities/attributes with descriptions
- **Metadata compliance** -- % of entities with correct stereotype metadata
- **Relationship coverage** -- % of entities with at least one relationship
- **Per-entity scoring** -- weighted composite (30% description, 30% attribute descriptions, 20% relationships, 20% stereotype compliance)
- **Drill-down** from package level to individual entity gaps

## User Journeys

### Journey 1: Model a New Domain (Data Architect)

> *Alice documents the data model for an e-commerce platform.*

1. **Create packages** -- `eShop > Ordering`, `Catalog`, `Billing` via the package dashboard
2. **Define entities** -- `Order`, `OrderLine`, `Customer` with typed attributes and constraints
3. **Define relationships** -- `Order` to `OrderLine` (one-to-many) at the package level
4. **Assign stereotypes** -- Mark `Order` as `aggregate-root`, auto-populating `bounded-context` metadata
5. **Add metadata** -- Flag `Customer.email` as PII, add business rules
6. **Visualize** -- Open the Cytoscape.js interactive graph, verify the model, save the layout
7. **Save & publish** -- Save (commit to workspace), publish (push to shared)

### Journey 2: Define a Perspective (Business Analyst)

> *Bob captures the billing-specific view of the data model.*

1. **Create perspective** -- "Billing" with `Invoice` and `Payment` as root entities
2. **Review resolved paths** -- BFS walks relationships, discovers `Order`, `Customer`, `LineItem`
3. **Set frontiers** -- Mark `Product` as frontier (`traverse: false`) -- include but don't follow further
4. **Exclude paths** -- Exclude `Order/audit` (not relevant to billing)
5. **Add annotations** -- On `Order/billingAddress/postalCode`, add validation rule "Must match payment country"
6. **Visualize** -- Graph overlay highlights perspective members, dims others

### Journey 3: Review & Approve (Data Steward)

> *Carol reviews changes submitted by the team.*

1. **See pending entities** -- Order is in `submitted` status
2. **Add comments** -- "Missing description on id field" targeting specific attribute
3. **Return for revision** -- Status changes to `returned`, author gets notification
4. **Approve** -- After fixes, approve. Status moves to `approved`
5. **Check quality** -- Quality dashboard shows 90% for order-service, up from 80%

### Journey 4: Explore & Discover (Developer)

> *Dave needs to understand the data model for implementation.*

1. **Browse** -- Navigate `/packages/order-service` to see the dashboard with stats
2. **Search** -- Search "order" returns 27 results across entities, attributes, metadata, relationships, packages
3. **Filter** -- Faceted search: filter by type=relationship, service=order-service, stereotype=aggregate-root
4. **Impact analysis** -- Check "Impact" tab on Order: 2 relationships, 1 perspective reference
5. **Export** -- Export order-service as JSON Schema for code generation, or Markdown for documentation

### Journey 5: Version & Collaborate (Team Lead)

> *Eve manages versioning aligned with application releases.*

1. **Create workspace** -- Creates `workspace/billing-v2` (git branch with friendly name)
2. **Monitor status** -- Navbar shows "MAIN 8" (branch + unsaved count), dropdown shows ahead/behind
3. **Save & publish** -- Save page shows changed files, commit with message, push to remote
4. **Switch workspaces** -- Workspaces page lists branches, switch with one click
5. **Merge** -- Merge page selects source workspace, previews diff, merges

## Architecture

### Monorepo

```
smart-data-dico/
  backend/              Express + TypeScript (controllers > services > models)
  frontend/             React 18 + Vite + TypeScript + Tailwind CSS + DaisyUI
  data-dictionaries/    YAML entity files, relationships, perspectives, stereotypes
  Dockerfile            Multi-stage production build
  docker-compose.yml    One-command deployment
```

### Microkernel Plugin Architecture

The frontend uses `@hamak/app-framework` with 11 plugins:

| Plugin | Responsibility |
|--------|---------------|
| **store** | Redux state management (10 domain slices) |
| **shell** | Layout, theming (synced with DaisyUI) |
| **auth** | JWT authentication with Auth0 |
| **data-dictionary** | Entity, package, relationship CRUD |
| **visualization** | Interactive Cytoscape.js graph |
| **search** | Full-text and faceted search |
| **version-control** | Save/publish, history |
| **perspective** | Perspective management and resolution |
| **remote-fs** | File operations via `@hamak/filesystem-server-impl` |
| **remote-git** | Git operations via `@hamak/ui-remote-git-fs-impl` |
| **notification** | Toast notifications |

### Data Model

```
Package
  +-- Entity (uuid, name, description, stereotype, status, attributes[], metadata[])
  |     +-- Attribute (uuid, name, type, required, constraints, metadata[])
  +-- Relationship (uuid, source, target, cardinality, metadata[])
  +-- Sub-packages

Stereotype (id, name, appliesTo, metadataDefinitions[])
Perspective (uuid, name, rootEntities[], nodes[], maxDepth)
  +-- PerspectiveNode (path, traverse?, exclude?, metadata[])
  +-- ResolvedNode (entityUuid, path, hopDistance, isRoot, isFrontier)
```

### Persistence

```
data-dictionaries/
  microservices/{package}/
    {uuid}_{name}.yaml          -- entity files
    {uuid}.comments.yaml        -- review comments (sidecar)
    relationships.yaml          -- package-level relationships
    metadata.yaml               -- package metadata
  perspectives/{uuid}.yaml      -- perspective definitions
  stereotypes.yaml              -- stereotype definitions
  diagrams/{id}.json            -- saved diagram layouts
```

All files are git-tracked for versioning, branching, and collaboration.

### API Surface

| Area | Endpoints |
|------|-----------|
| Entities | CRUD on `/api/services/:service/entities/:entity` |
| Packages | CRUD on `/api/packages`, hierarchy, path navigation |
| Relationships | CRUD on `/api/packages/:pkg/relationships` |
| Stereotypes | CRUD on `/api/stereotypes` |
| Perspectives | CRUD + resolve + graph on `/api/perspectives` |
| Search | `GET /api/search?q=...&type=...&service=...&stereotype=...` |
| Impact | `GET /api/entities/:uuid/impact` |
| Review | Submit/approve/return + comments on entities |
| Import | `POST /api/import/json-schema`, `POST /api/import/sql-ddl` |
| Export | `GET /api/export/json-schema/:service`, `GET /api/export/markdown/:service` |
| Quality | `GET /api/quality/report` |
| Git | Full git operations via `/api/git/dictionaries/*` (framework routes) |
| Version | Commit, history, revert via `/api/commit`, `/api/history` |

## Getting Started

### Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| **Node.js** | 18+ (LTS) | Hard requirement; checked via `engines` field |
| **npm** | 9+ | Ships with Node 18+ |
| **Git** | 2.x+ | Required — dictionaries are versioned in a git repository |
| **Docker** | 20+ | Optional, only for the containerized deployment path |

Optional database peer dependencies (only needed if you use **Physical Sync** to introspect a live database — see `peerDependencies` in `package.json`): `pg`, `mysql2`, `mssql`, or `oracledb`. Install just the one(s) you need.

### Option A — Install from npm (end users)

The fastest way to run the app against a fresh, empty data directory:

```bash
# One-off run with auto-bootstrap of ./data-dictionaries
npx @hamak/smart-data-dico

# Or install globally
npm install -g @hamak/smart-data-dico
smart-data-dico
```

CLI flags:

| Flag | Default | Purpose |
|------|---------|---------|
| `--port <n>` | `3001` | Server port |
| `--data-dir <path>` | `./data-dictionaries` | Project folder (the one containing `dico.config.json`) |
| `--no-open` | — | Don't auto-open the browser |
| `-h, --help` | — | Show help |

On first run, the CLI creates `<data-dir>/dico.config.json` and `<data-dir>/.dico/` if they don't exist. Point it at an existing project folder to keep working on the data you already have.

### Option B — Run from source (contributors)

```bash
# 1. Clone
git clone https://github.com/amah/smart-data-dico.git
cd smart-data-dico

# 2. Install dependencies — root, backend, frontend
npm install
cd backend  && npm install && cd ..
cd frontend && npm install && cd ..

# 3. Start the dev servers in two terminals
cd backend  && npm run dev   # port 3001
cd frontend && npm run dev   # port 3000
```

- Frontend: http://localhost:3000
- Backend API: http://localhost:3001
- API docs: http://localhost:3001/api-docs

In dev, the backend serves the bundled sample project at `samples/eshop/` (three packages: `order-service`, `product-service`, `user-service`). Override with `DATA_DIR=/path/to/your/project npm run dev` to point at your own data.

### Option C — Restricted networks (no npm registry for this package, or no git)

When the npm registry copy of the package is unavailable, install it from git or
from a prebuilt release tarball. These do **not** require the package to be on a
registry; the lower options additionally avoid needing the `git` binary.

**C1 — Prebuilt tarball over `curl` (no git, no build, fully offline-capable).**
Each release attaches a **self-contained** tarball (esbuild-bundled backend, no
runtime `node_modules`; Node ≥ 18). Download and install it directly:

```bash
curl -fL -o smart-data-dico.tgz \
  https://github.com/amah/smart-data-dico/releases/download/v1.11.0/hamak-smart-data-dico-1.11.0.tgz
npm install -g ./smart-data-dico.tgz
smart-data-dico --data-dir /path/to/your/project
```

For a fully air-gapped machine, download the `.tgz` on a connected host, copy it
across, and run the `npm install -g ./…tgz` step there — it needs no network.

**C2 — Build from git with the helper script.** Clones a pinned ref, installs
deps (root/frontend/backend), builds both bundles, packs a tarball, and installs
the CLI globally:

```bash
scripts/install-from-git.sh                 # build v1.11.0, install globally
scripts/install-from-git.sh --pack-only     # just produce the tarball (prints its path)
```

Add `--archive` (auto-enabled when `git` is absent) to fetch the source via
`curl`/`wget` instead of cloning. Useful env/flags: `SDD_REF` (tag/branch/commit),
`SDD_REPO_URL` (internal mirror or SSH), `-d` (work dir). Run `scripts/install-from-git.sh --help`
for the full list.

> Note: C2 still pulls build **dependencies** from whichever npm registry / proxy
> `npm` is configured to use. If even that is blocked, use **C1** — build the
> tarball once on a connected machine (`--pack-only`) and install the artifact offline.

### Option C — Docker

```bash
docker-compose up
# App available at http://localhost:3001
```

The image ships with **no bundled sample data** — `docker-compose.yml` mounts `./data-dictionaries` from the host into the container. Either place your own project there, or copy `samples/eshop/` into `./data-dictionaries/` before starting.

### Dev Credentials (mock auth, dev mode only)

| User | Password | Role |
|------|----------|------|
| admin | admin123 | ADMIN (full access) |
| editor | editor123 | EDITOR (create/edit) |
| viewer | viewer123 | VIEWER (read-only) |

A `Bearer mock-token-for-testing` header also works for API testing.

### Configuration Profiles

Set via `PROFILE` environment variable:

| Profile | Auth | Git | Use Case |
|---------|------|-----|----------|
| **local** | None | Local only | Single user, desktop |
| **team** | Basic/JWT | Remote | Small team sharing a repo |
| **server** | Auth0/SSO | Remote | Organization-wide deployment |

## AI Assistance

The dictionary ships with three AI-aware surfaces, all optional. They share one set of credentials stored at `~/.dico-app/dico-app.json` (mode 0600 — never checked into git):

| Surface | What it is | Where to find it |
|---|---|---|
| **In-app AI chat panel** | Sidebar chat that grounds against the live dictionary — list packages, describe entities, generate docs, propose edits | Toolbar button **AI Assistant** in the running web app |
| **Slash commands** | Built-in chat shortcuts (`/list`, `/quality`, `/describe`, `/create`, `/relate`, `/export`, `/diagram`, `/help`) + your own saved prompts | Type `/` in the chat composer |
| **MCP server** (`dico-mcp`) | A [Model Context Protocol](https://modelcontextprotocol.io) stdio server that exposes the same operations to external clients — Claude Desktop, Cursor, Roo Code, Claude Code | `npx @hamak/smart-data-dico-mcp` or `node bin/dico-mcp.js` from source |

### Configure the in-app chat (one-time)

1. Start the app (Option A, B, or C above).
2. Open **Settings → AI** (or click the AI Assistant button → ⚙ icon).
3. Pick a **provider** (`anthropic`, `openai`, or `openai-compatible`), paste an API key, and choose a **model** (e.g. `claude-opus-4-7`, `gpt-4o`, or any model your `openai-compatible` endpoint exposes).
4. Save. The config writes to `~/.dico-app/dico-app.json` with mode `0600`; no env vars are required.

Alternatively, if you set `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` before launching the server, the provider is auto-detected for the first session — but the **Settings dialog is the source of truth**; saving overrides env-var defaults.

Conversations and saved prompts live under `~/.dico-app/storage/` as JSON files — portable, diffable, deletable.

### Slash commands

| Command | What it does |
|---|---|
| `/help` | List all available slash commands |
| `/list` | List every package and its entity count |
| `/describe` | Describe the current entity in detail (uses page context) |
| `/quality` | Quality review of the current package (severity-grouped findings) |
| `/create` | Skeleton: create a new entity with suggested attributes |
| `/relate` | Skeleton: create a relationship between two entities |
| `/export` | Generate Markdown documentation for the current package |
| `/diagram` | Navigate to the organization diagram |

The `pageContext` placeholder is filled automatically from the current route (entity / package / etc.). User-saved prompts (via **Prompts** tab in the chat panel) appear in the same slash-command picker.

### MCP server (`dico-mcp`)

The MCP server reuses the same backend services as the web app — it's a different **transport** for the same operations, not a duplicate code path. You can run the web UI and the MCP server side-by-side against the same project folder.

**Tools exposed:** `listPackages`, `listEntities`, `getEntityDetails`, `createEntity`, `createRelationship`, `listStereotypes`, `listRoutes`.

**Launch (from npm):**

```bash
# stdio server — talks JSON-RPC over stdin/stdout
npx @hamak/smart-data-dico --data-dir /path/to/your/project   # web UI
# (the MCP entrypoint is bin/dico-mcp.js inside the package)
node "$(npm root -g)/@hamak/smart-data-dico/bin/dico-mcp.js" --data-dir /path/to/your/project
```

**Register with Claude Desktop** — edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "smart-data-dico": {
      "command": "npx",
      "args": ["-y", "@hamak/smart-data-dico", "dico-mcp", "--data-dir", "/absolute/path/to/your/project"]
    }
  }
}
```

Or, if installed from source, point at the bin script directly:

```json
{
  "command": "node",
  "args": ["/absolute/path/to/smart-data-dico/bin/dico-mcp.js", "--data-dir", "/absolute/path/to/your/project"]
}
```

**Register with Cursor** — `.cursor/mcp.json` (project-level) or `~/.cursor/mcp.json` (global): identical shape.

**Register with Roo Code** — `.roo/mcp.json`: identical shape.

The MCP process speaks JSON-RPC on stdio and stays attached to its parent; all logging goes to stderr so it doesn't corrupt the stream. Git auto-commit honours the same `GIT_AUTO_COMMIT` env var as the web backend.

### Connect external MCP servers *to* the in-app chat

The flip side of the above: the in-app chat can also consume external MCP servers (Filesystem, GitHub, etc.). Go to **Settings → MCP** for a curated registry — pick a server, paste any required tokens, save. The chat will then surface those server's tools alongside the built-in ones.

## Technologies

| Layer | Stack |
|-------|-------|
| Backend | Node.js, Express, TypeScript (ESM), YAML, Git |
| Frontend | React 18, Vite, TypeScript, Tailwind CSS, DaisyUI, Redux |
| Framework | @hamak/app-framework (microkernel, DI, plugins) |
| Visualization | Cytoscape.js (dagre + fcose layouts) |
| Auth | JWT + Auth0 (mock mode for dev) |
| Deployment | Docker (multi-stage build) |

## Documentation

| Doc | What it covers |
|-----|----------------|
| [Format reference](docs/format-reference.md) | Authoritative spec for the on-disk format — project layout, `dico.config.json`, entities, validation, constraints, relationships, stereotypes, rules, cases, actions, state machines |
| [User guide](docs/user-guide.md) | Task-oriented walkthrough of the app |
| [API reference](docs/api-reference.md) | REST endpoints (live Swagger UI at `/api-docs` when the backend is running) |
| [Deployment](docs/deployment.md) | Desktop vs. server modes, file layout, configuration |
| [Migration plan](docs/migration-plan.md) | @hamak/app-framework migration notes |
| [ADRs](docs/adr/) | Architecture decision records |

### Claude Code skill

The `docs/` folder doubles as a [Claude Code](https://claude.com/claude-code) skill
(`docs/SKILL.md` + the format reference) for authoring and validating dictionary files in
any project. Installing it means copying `docs/` into a skills directory as `smart-data-dico`.
Claude then loads it automatically whenever you work in a folder containing `dico.config.json`.

**From a local checkout of this repo:**

```bash
npm run install:skill                          # → ~/.claude/skills/smart-data-dico
# or into a specific project:
scripts/install-skill.sh /path/to/project/.claude/skills
```

**From another repo / machine (no checkout):** pull just `docs/` into your skills directory
with [`degit`](https://github.com/Rich-Harris/degit) — no auth needed:

```bash
# global → ~/.claude/skills/smart-data-dico
npx degit amah/smart-data-dico/docs ~/.claude/skills/smart-data-dico
```

Or, without Node, via the release tarball:

```bash
tmp=$(mktemp -d) && curl -fsSL https://codeload.github.com/amah/smart-data-dico/tar.gz/refs/heads/main | tar -xz -C "$tmp" \
  && rm -rf ~/.claude/skills/smart-data-dico \
  && cp -R "$tmp"/*/docs ~/.claude/skills/smart-data-dico && rm -rf "$tmp"
```

Swap the destination for `<project>/.claude/skills/smart-data-dico` to scope it to one project.
Re-run either command to update.

**Behind a proxy:** `degit` reads the lowercase `https_proxy` env var (not the CLI), while
`curl` takes an explicit `--proxy` flag — the curl form is usually the more reliable in
locked-down networks:

```bash
# degit
https_proxy=http://proxy.example.com:8080 npx degit amah/smart-data-dico/docs ~/.claude/skills/smart-data-dico

# curl
tmp=$(mktemp -d) && curl -fsSL --proxy http://proxy.example.com:8080 https://codeload.github.com/amah/smart-data-dico/tar.gz/refs/heads/main | tar -xz -C "$tmp" \
  && rm -rf ~/.claude/skills/smart-data-dico \
  && cp -R "$tmp"/*/docs ~/.claude/skills/smart-data-dico && rm -rf "$tmp"
```

If the proxy does TLS interception, point Node/curl at your CA bundle (`NODE_EXTRA_CA_CERTS=…`
for degit, `--cacert …` for curl).
