# Smart Data Dictionary

A collaborative data dictionary management system for modeling, documenting, and governing your organization's data landscape. Built on a microkernel plugin architecture for modularity, with file-based persistence (YAML/Git) designed for both technical and non-technical users.

## User Journeys

### Journey 1: Model a New Domain (Data Architect)

> *Alice, a data architect, is tasked with documenting the data model for a new e-commerce platform.*

1. **Create the package structure** -- Alice creates a top-level `eShop` package, then sub-packages: `Ordering`, `Catalog`, `Billing`.
2. **Define entities** -- Inside `Ordering`, she creates entities: `Order`, `OrderLine`, `Customer`. For each, she adds a description and attributes (name, type, constraints).
3. **Define relationships** -- She links `Order` to `OrderLine` (one-to-many), `Order` to `Customer` (many-to-one). Relationships are owned at the package level.
4. **Assign stereotypes** -- She marks `Order` as `aggregate-root`, `Customer` as `reference-data`. This auto-populates required metadata fields (e.g., lifecycle rules, ownership).
5. **Add metadata** -- She flags `Customer.email` as PII, adds a business rule "Order total must equal sum of line amounts" on `Order`.
6. **Visualize** -- She opens the interactive graph to verify the model looks right, adjusts layout, and saves the diagram.
7. **Save & publish** -- She saves her work (auto-committed to her workspace branch), then publishes to the shared model.

### Journey 2: Define a Business Context (Business Analyst)

> *Bob, a business analyst, needs to capture the billing-specific view of the data model.*

1. **Create a context** -- Bob creates a "Billing" context and selects `Invoice` and `Payment` as root entities.
2. **Review resolved entities** -- The system walks relationships and pulls in `Order`, `Customer`, `LineItem` transitively. Bob sees the full entity graph for his context.
3. **Refine scope** -- He excludes `Catalog.Product` (pulled in but not relevant to billing) and includes `TaxRule` (not reachable by relationships but needed).
4. **Add context-specific metadata** -- In the Billing context, he marks `Customer.email` as `required` and `Customer.taxId` as `mandatory-for-invoicing`. These overrides don't affect the base model.
5. **Add business rules** -- He adds rules scoped to this context: "Invoices must be generated within 24h of order completion", "Payment retry limited to 3 attempts".
6. **Search within context** -- He searches for all PII-flagged attributes within Billing to prepare a compliance report.
7. **Visualize the context** -- On the interactive graph, he switches to "Billing context" view -- only relevant entities are highlighted, others are dimmed.

### Journey 3: Review & Approve Changes (Data Steward)

> *Carol, a data steward, reviews changes submitted by the team.*

1. **Check notifications** -- Carol sees a notification: "Alice submitted 3 entities for review in the Ordering package."
2. **View the diff** -- She opens the review and sees a side-by-side comparison: `Order` has 2 new attributes, `OrderLine` has a modified constraint.
3. **Add comments** -- On `Order.discountRate`, she comments: "Missing business rule -- max discount must be defined."
4. **Return for revision** -- She returns the submission with her comments. Alice gets notified.
5. **Review revision** -- Alice adds the missing rule, re-submits. Carol approves. The changes move to `approved` status.
6. **Check quality dashboard** -- Carol checks the completeness dashboard: Ordering is at 92% documentation coverage, up from 85%.

### Journey 4: Explore & Discover (Developer)

> *Dave, a backend developer, is implementing the order service and needs to understand the data model.*

1. **Browse packages** -- Dave navigates to `eShop > Ordering`. The URL reads `/packages/eShop/ordering` and the breadcrumb shows his location.
2. **View package dashboard** -- He sees 8 entities, 12 relationships, 95% documented. Recent changes highlight the new `discountRate` attribute.
3. **Search** -- He searches "payment status" and finds the `Payment.status` attribute with its enum values and the `PaymentStatusChanged` event entity.
4. **Check entity detail** -- He opens `Order`, sees attributes, relationships, metadata, and business rules in tabs.
5. **Impact analysis** -- Before modifying `Customer`, he checks "Where Used" -- it's referenced by 4 relationships, 2 contexts, and 1 diagram. He proceeds carefully.
6. **Export** -- He exports the `Ordering` package as JSON Schema to auto-generate TypeScript interfaces for his service.

### Journey 5: Version & Collaborate (Team Lead)

> *Eve, a team lead, manages dictionary versioning aligned with application releases.*

1. **Create a workspace** -- Eve starts a workspace for `feature/billing-v2`, aligned with the application's feature branch.
2. **Team edits** -- Bob and Alice edit entities within this workspace. Each save auto-commits to the workspace branch.
3. **Sync status** -- Eve sees "5 changes ahead, 2 updates available" in the header. She pulls the latest shared changes.
4. **Resolve conflicts** -- A conflict on `Customer.yaml`: the shared model added `loyaltyTier`, her workspace modified `creditLimit`. The visual merge tool shows both changes field-by-field. She keeps both.
5. **Publish** -- She publishes the workspace. All changes merge to the shared model with a summary: "Billing v2: 3 entities added, 5 modified, 2 new contexts."
6. **Tag release** -- She tags the dictionary at `v2.5` to match the application release.

## Architecture

### Monorepo

```
smart-data-dico/
  backend/          Express + TypeScript, layered (controllers > services > models)
  frontend/         React 18 + Vite + TypeScript + Tailwind CSS + DaisyUI
  data-dictionaries/  YAML entity files, relationships, diagrams (git-tracked)
```

### Microkernel Plugin Architecture

The frontend uses `@hamak/app-framework` with plugins:

| Plugin | Responsibility |
|--------|---------------|
| **store** | Redux state management (7 domain slices) |
| **shell** | Layout, theming (synced with DaisyUI) |
| **auth** | JWT authentication with Auth0 |
| **data-dictionary** | Entity, package, relationship CRUD |
| **visualization** | Interactive graph, diagrams |
| **search** | Full-text and faceted search |
| **version-control** | Git operations (save, publish, history) |
| **remote-fs** | File operations via backend |
| **remote-git** | Git operations via backend |
| **notification** | Toast notifications |

### Data Model

- **Packages** contain entities and sub-packages (hierarchical)
- **Entities** have attributes, metadata, and a stereotype
- **Attributes** have types, constraints, and metadata
- **Relationships** are package-owned, with source/target cardinality
- **Contexts** define business views over a subset of entities with context-specific metadata
- **Stereotypes** control which metadata applies to which elements

### Persistence

- Entity files: `data-dictionaries/microservices/{package}/{uuid}_{name}.yaml`
- Relationships: `data-dictionaries/microservices/{package}/relationships.yaml`
- Contexts: `data-dictionaries/contexts/{uuid}.yaml`
- Diagrams: `data-dictionaries/diagrams/{id}.json`
- All files git-tracked for versioning

## Getting Started

### Prerequisites

- Node.js v18+
- npm

### Quick Start

```bash
# Backend
cd backend && npm install && npm run dev

# Frontend (in another terminal)
cd frontend && npm install && npm run dev
```

- Frontend: http://localhost:3000
- Backend API: http://localhost:3001
- API docs: http://localhost:3001/api-docs

### Dev Credentials

| User | Password | Role |
|------|----------|------|
| admin | admin123 | ADMIN (full access) |
| editor | editor123 | EDITOR (create/edit) |
| viewer | viewer123 | VIEWER (read-only) |

## Roadmap

See [open issues](https://github.com/amah/smart-data-dico/issues) organized by theme:

- **Navigation** -- Package CRUD, nested URLs, breadcrumbs, dashboards
- **Workflow** -- Review lifecycle, comments, diff, notifications
- **Search** -- Extended scope, faceted filters, impact analysis
- **Metadata** -- Stereotypes, flags/rules, templates, validation
- **Context** -- Business views, entity resolution, context-specific metadata
- **Git UX** -- Save/publish, workspaces, merge UI, remote sync
- **Deployment** -- Docker, desktop app, configuration profiles
- **Interop** -- Import/export, lineage, comparison, quality metrics

## Technologies

| Layer | Stack |
|-------|-------|
| Backend | Node.js, Express, TypeScript (ESM), YAML, Git |
| Frontend | React 18, Vite, TypeScript, Tailwind CSS, DaisyUI, Redux |
| Framework | @hamak/app-framework (microkernel, DI, plugins) |
| Visualization | Mermaid, ReactFlow (migrating to Cytoscape.js) |
| Auth | JWT + Auth0 (mock mode for dev) |
