# Implementation Plan

## Phase 0: Interactive Graph (foundation for visualization)

Unblocks context visualization (E7) and improves existing UX.

| Ticket | Title | Effort | Depends on |
|--------|-------|--------|------------|
| **#5** | Nx-style interactive graph (Cytoscape.js) | L | -- |

**Deliverable**: Interactive, zoomable entity-relationship graph with Cytoscape.js replacing Mermaid-based rendering.

---

## Phase 1: Package & Navigation Foundation

Make the app navigable before adding complexity.

| Ticket | Title | Effort | Depends on |
|--------|-------|--------|------------|
| **#6** | A1: Explicit package CRUD | M | -- |
| **#7** | A2: Nested URL routing | M | #6 |
| **#8** | A3: Breadcrumb navigation | S | #7 |
| **#9** | A4: Package dashboard | M | #6 |

**Deliverable**: Users can create/manage packages, navigate a hierarchical URL structure, and see package-level summaries.

---

## Phase 2: Metadata & Stereotypes

Enrich the data model before building contexts on top.

| Ticket | Title | Effort | Depends on |
|--------|-------|--------|------------|
| **#17** | D1: Stereotype system | L | #6 |
| **#18** | D2: Metadata as flags and rules | M | -- |
| **#19** | D3: Metadata templates from stereotypes | M | #17 |
| **#20** | D4: Metadata validation per stereotype | M | #17, #19 |

**Deliverable**: Elements can be typed with stereotypes that drive metadata forms, validation, and visual indicators.

---

## Phase 3: Context (the differentiating feature)

Builds on packages (Phase 1) + metadata (Phase 2) + graph (Phase 0).

| Ticket | Title | Effort | Depends on |
|--------|-------|--------|------------|
| **#21** | E1: Context definition & root entities | M | -- |
| **#22** | E2: Transitive entity resolution | L | #21 |
| **#24** | E4: Context-specific visibility | M | #22 |
| **#23** | E3: Context-specific metadata overrides | L | #21, #17 |
| **#25** | E5: Context CRUD & navigation | M | #21, #22 |
| **#27** | E7: Context visualization on graph | M | #5, #22 |
| **#26** | E6: Context-aware search | M | #25, #14 |

**Deliverable**: Full context lifecycle -- create, resolve entities, set visibility/overrides, visualize, and search within contexts.

---

## Phase 4: Search & Discovery

Leverage all the new data (stereotypes, contexts, metadata) to make search powerful.

| Ticket | Title | Effort | Depends on |
|--------|-------|--------|------------|
| **#14** | C1: Extended search scope | M | -- |
| **#15** | C2: Faceted search | L | #14, #17, #21 |
| **#16** | C3: Where-used / impact analysis | M | #14 |

**Deliverable**: Search across all element types, filter by facets, and assess impact before making changes.

---

## Phase 5: Review Workflow

Now that the model is rich, add governance.

| Ticket | Title | Effort | Depends on |
|--------|-------|--------|------------|
| **#10** | B1: Status lifecycle (draft/submitted/approved) | L | -- |
| **#11** | B2: Review comments | M | #10 |
| **#12** | B3: Change diff view | M | #10 |
| **#13** | B4: Notifications on transitions | S | #10 |

**Deliverable**: Entities go through a review lifecycle with comments, diffs, and notifications.

---

## Phase 6: Git UX for Non-Technical Users

Abstract git behind user-friendly concepts.

| Ticket | Title | Effort | Depends on |
|--------|-------|--------|------------|
| **#28** | F1: Save/Publish abstraction | L | -- |
| **#29** | F2: Workspaces (branch-per-feature) | L | #28 |
| **#32** | F5: Remote sync with status indicators | M | #28 |
| **#30** | F3: Visual merge & conflict resolution | XL | #29 |
| **#31** | F4: Branches aligned with DevOps lifecycle | M | #29 |

**Deliverable**: Non-technical users save/publish without knowing git. Teams work in isolated workspaces with visual merge.

---

## Phase 7: Interop & Quality

Make the dictionary a hub, not a silo.

| Ticket | Title | Effort | Depends on |
|--------|-------|--------|------------|
| **#36** | H1: Import/Export (JSON Schema, OpenAPI, SQL DDL) | L | -- |
| **#39** | H4: Completeness dashboard | M | #17, #20 |
| **#38** | H3: Side-by-side version comparison | M | #12 |
| **#37** | H2: Data lineage | L | #5 |

**Deliverable**: Import from existing schemas, export to documentation, track quality, and visualize data flow.

---

## Phase 8: Deployment & Packaging

Ship it.

| Ticket | Title | Effort | Depends on |
|--------|-------|--------|------------|
| **#33** | G1: Docker image | M | -- |
| **#35** | G3: Configuration profiles | M | -- |
| **#34** | G2: Desktop app (Electron/Tauri) | XL | #35 |

**Deliverable**: Deploy as Docker container for teams, or package as desktop app for individual use.

---

## Timeline

```
Phase 0  [####]              Interactive Graph
Phase 1  [######]            Package & Navigation
Phase 2     [######]         Metadata & Stereotypes
Phase 3        [##########]  Context
Phase 4           [######]   Search & Discovery
Phase 5              [####]  Review Workflow
Phase 6              [########]  Git UX
Phase 7                 [######] Interop & Quality
Phase 8                    [######] Deployment
```

Phases 0-1-2 can partially overlap. Phase 3 is the critical path. Phases 5-6 and 4-7 can run in parallel. Phase 8 can start earlier for G1 (Docker).

**Effort key**: S = 1-2 days, M = 3-5 days, L = 1-2 weeks, XL = 2-3 weeks
