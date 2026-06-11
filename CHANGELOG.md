# Changelog

All notable changes to **@hamak/smart-data-dico** are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.12.1] — 2026-06-11

### Fixed
- **Diagram canvas resize handling** — Cytoscape now watches its container with
  a `ResizeObserver` and re-syncs/re-fits when the canvas size changes (initial
  flex sizing, sidebar collapse, description expand, window resize). Previously
  the graph was fitted once against a stale size and could end up off-center or
  cut off at the edges of the new full-height canvas.

## [1.12.0] — 2026-06-11

### Added
- **Sticky view preferences** (localStorage-backed, shared via a new
  `useStoredState` hook):
  - Package pages now open in **Diagram view by default**; the last List/Diagram
    choice follows you across packages. An explicit `?view=` URL param still wins,
    so deep links stay deterministic.
  - The `/diagram` page's **Structural/Physical** tab choice is likewise sticky.
  - The page-header **description expand/collapse** state persists across
    navigation and reloads — one preference shared by all pages.

### Changed
- **Diagram canvas fills the available height** of the main area (package
  Diagram view and `/diagram`) instead of a fixed 600px box.
- Expanded page-header descriptions render in the stronger muted text tone
  for better contrast on the light grey background.

## [1.11.0] — 2026-06-10

### Added
- **Value domains on derived types** — a derived type in `dico.config.json.types[]`
  may now carry a `domain` that classifies where its allowed values come from:
  - `enum` — an inline closed set (`values`, no source);
  - `codelist` — a static managed set (`source` required; optional static `values`);
  - `reference` — referential values drawn from a named `source` (required, no inline values).

  Includes backend validation, transitive `resolveDomain` resolution, JSON-Schema
  export (`enum` values plus `x-domain` / `x-source` annotations), a **Value domain**
  editor on `/types` with `?name=` deep-linking, and value-domain columns in the
  attribute views. See `docs/format-reference.md` §2.1.
- **Top-bar spotlight search** — the navbar search is now a live input backed by an
  in-memory Fuse.js index built from packages, entities, attributes, relationships,
  metadata, cases and stereotypes. Fuzzy, case-insensitive, ranked entities →
  attributes → packages first, with typeahead suggestions and `/` to focus.
- **Diagram: double-click a package** box to open its package-scoped diagram
  (`/diagram/<package>`).

### Changed
- **Diagram now defaults to the Force (fcose) layout** instead of Dagre.
- **Attribute tables**
  - The entity attributes table's **Values** column is now domain-aware and slimmed
    to a single link with the values / reference detail shown on hover; the
    **Description** column is wider; the **Default** column is hidden by default
    (still available from the column chooser).
  - The flat attributes view shows the value-domain kind in the **Type** column and a
    clickable **Source** column.
- **Diagram consolidation** — `/diagram` and the former `/visualization` routes are
  unified onto a single page (`/diagram`, `/diagram/:service`, `/diagram/:service/:entity`)
  with the Structural / Physical view-mode tabs.
- **Physical view** no longer repeats the schema name as a node subtitle when it
  merely restates the owning package.

## [1.10.1] — 2026-06-09

### Changed
- Consolidated the diagram onto a single page and URL; the main **Diagram** nav now
  exposes the Structural / Physical view-mode tabs.

## [1.10.0] — 2026-06-09

### Added
- Diagram **logical (ORM)** and **physical** view modes (#181), with embedded /
  inheritance / merge edges, physical-drift overlay and richer info panels.

---

Earlier history (≤ 1.9.x) is recorded in the git log under `chore(release)` commits.

[1.11.0]: https://github.com/amah/smart-data-dico/releases/tag/v1.11.0
[1.10.1]: https://github.com/amah/smart-data-dico/releases/tag/v1.10.1
[1.10.0]: https://github.com/amah/smart-data-dico/releases/tag/v1.10.0
