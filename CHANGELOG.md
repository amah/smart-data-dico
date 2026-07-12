# Changelog

All notable changes to **@hamak/smart-data-dico** are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.24.3] — 2026-07-12

### Fixed
- **Page scroll position carried across routes.** The shell now resets its main
  scroll container when the pathname changes, keeping page headers and toolbars
  visible after navigating away from long views such as diagrams.

### Documentation
- Expanded the contributor guide with architecture, security, testing, and
  package and desktop release instructions.

## [1.24.1] — 2026-07-10

### Fixed
- **Oracle queries failed with ORA-00933 when they ended with a `;`.** The
  trailing semicolon reached the `oracledb` driver, which rejects it before
  parsing — masking the query's real error (the same text pasted into SQL
  Developer ran, surfacing e.g. ORA-00904 instead). The statement separator is
  now stripped before execution on every dialect, and the exact SQL handed to
  the driver is logged at DEBUG for diagnosis.

## [1.24.0] — 2026-07-10

### Added
- **Saved connection library.** Name and reuse database connections across
  projects: the SQL run dialog gains a "Saved connection" picker that fills the
  form, a save/update action, and an inline delete. Connection *parameters*
  live per user in `~/.dico-app/dico-app.json`; *passwords* stay in the secure
  secret store (OS keychain / encrypted), are stripped from anything persisted
  or returned — at any nesting depth — and, when connecting by saved entry,
  are resolved server-side so they never pass through the browser. Editing a
  saved entry's parameters keeps its password attached. On a shared server
  each authenticated user sees only their own library. The dialog prefills
  from the last connection used for the package, falling back to the package's
  physical config.

## [1.23.0] — 2026-07-10

### Fixed
- **Optional DB drivers now resolve on `npx` runs.** Launched via
  `npx @hamak/smart-data-dico`, the app runs from the npx cache, where a bare
  `import('oracledb')` can see neither the directory you launched from nor the
  global npm root — so "oracledb not found" persisted no matter where the
  driver was installed. Driver loading now falls back to the launch directory,
  the global npm root (`npm i -g oracledb` works again), and an explicit
  `DICO_DRIVER_PATH` override. A driver that is present but fails to load
  (e.g. a native-binding/Node ABI mismatch) reports its real error instead of
  "isn't installed".

## [1.22.0] — 2026-07-10

### Added
- **Legacy physical metadata resolves in the AI read path.** A shared resolver
  now backs both `getSqlSchema` and `getEntityDetails`: the primary-key flag
  stored as `isPrimaryKey` attribute metadata (eshop-style / older imports) is
  recognised when the schema field is unset, so PK columns survive into
  generated SQL. `getSqlSchema` also lists `tablesWithFallbackColumns` and
  names them in a note, so the agent warns the user about columns with no
  explicit physical mapping instead of guessing.

### Changed
- **The AI chat's per-turn model snapshot is cached.** Building it used to
  re-read every package's entities and relationships on each message — a
  linear IO tax on large dictionaries. It is now memoized and invalidated by
  the same change bus that keeps the search index fresh, by the AI's own
  mutation tools (an entity created in chat appears in the next turn's
  snapshot), and by a 60-second TTL backstop.

## [1.21.0] — 2026-07-09

### Added
- **Cross-package entity resolution for the AI agent's tools.** `getEntityDetails`
  no longer requires `packageName` — a unique entity name resolves across every
  package (the result names the owning package), several matches return a
  disambiguation list instead of an error. `getSqlSchema` accepts
  `entityNames: [...]` and returns just those entities **plus their
  directly-related neighbours** (so JOIN endpoints are always present), each
  table stamped with its owning `package`.

### Fixed
- **AI agent lost the plot on large dictionaries (~40 packages / 3000 entities).**
  The model snapshot injected into the system prompt was silently cut at 2,000
  characters, so most packages and entities vanished from the agent's view and
  it fabricated table names when asked for SQL. Over-budget outlines now switch
  to a compact package+counts form with an explicit "entity lists omitted — call
  `searchModel`" banner (never a mid-truncated listing); the per-tool-result cap
  on the OpenAI-compatible path was raised 2,000 → 20,000 characters with an
  explicit retry-narrower marker when truncation still occurs; the SQL protocol
  now mandates `searchModel`-first with `entityNames`/`packageName` scoping and
  surfaces `physicalMappingMissing` instead of guessing; every not-found tool
  error steers the model to `searchModel`; a malformed non-array `entityNames`
  errors instead of silently returning the whole model.

## [1.20.0] — 2026-07-09

### Added
- **Move an entity to another package.** A relocation that keeps the entity's
  UUID, so relationships (cross-package is first-class), cases and diagrams that
  reference it keep resolving — nothing is orphaned. Available from the diagram
  info panel, from a per-row menu on the package page, and as a `moveEntity` AI
  agent tool. Backend: `PUT /api/services/:service/entities/:entity/move`.
- **Sub-package entities in the package table.** The entity list now folds each
  sub-package in as an expandable group row with its entities indented beneath —
  same columns, fonts and checkboxes as the package's own entities. Selection
  spans sub-packages (select-all and a per-group checkbox), so bulk style /
  hide / unhide / move apply to descendants too.
- **Reorganized diagram entity info panel.** Appearance controls move into a
  compact palette dropdown, the entity description shows directly under its name,
  and the same menu now offers hide/unhide and move-to-package — visible even
  when no element styles are configured.
- **Markdown tables in the AI chat.** GitHub-flavored pipe-tables now render (via
  `remark-gfm`) with bordered, shaded-header, zebra-striped styling in both
  themes, instead of appearing as raw text.

### Fixed
- **Sub-package entities were never listed.** The package-hierarchy builder read
  a sub-package's contents from its leaf name instead of its full path, so its
  entities/relationships/cases always came back empty.
- **Non-destructive re-saves could 500.** Hiding or styling an entity whose
  `attributes`/`properties` is a non-array (e.g. from an import) threw
  `(attrs ?? []) is not iterable`; `fillAttributeDefaults` now guards against it.

## [1.19.0] — 2026-07-07

### Added
- **Full-text search index over the whole dictionary.** A derived SQLite **FTS5**
  index (via Node's built-in `node:sqlite`, no new dependency) now powers search.
  It's a rebuildable cache — files stay canonical — living per-project under
  `~/.dico-app/storage/search/`. It replaces the previous O(n²) per-query scan in
  `/api/search` (which re-read every entity file — ~159s for 2000 entities) with
  ranked **BM25** matching, prefix/boolean queries and snippet highlighting.
  Rebuilt on boot and kept fresh incrementally by subscribing to the same write
  event bus the UUID index uses. All searches are best-effort: any index failure
  falls back to the legacy scan so search never hard-breaks.
- **Top-bar spotlight runs on the server index.** The ⌘K / "/" search no longer
  ships the entire model to the browser and rebuilds it per session — it queries
  the server index (`/api/search/suggest`) so results are always fresh, covering
  entities, attributes, packages, relationships, rules and cases. The old
  client-side index is retained only as an offline fallback.
- **`searchModel` AI agent tool.** The assistant can now full-text search the
  dictionary to locate an entity/attribute/rule by fuzzy query (then drill in with
  `getEntityDetails`) instead of relying on the truncated whole-model outline in
  its prompt. Read-only — available in every chat mode, no approval.
- **Bulk hide / unhide from the package page.** The entity-list selection bar
  (already offering "Set style") gains **Hide** / **Unhide** actions that toggle
  the reserved `system.hidden` flag on every selected entity at once, plus a
  **Hidden** column and dimmed rows for hidden entities.

### Fixed
- **Plugin agent tools were miscategorised as "modify".** `resolveToolCategory`
  ignored a plugin tool's own category and defaulted to `modify`, so the
  read-only `searchModel` would have been gated for approval under a stricter
  auto-approve policy. It now honours the registered category (matching the
  enforcement path).

## [1.18.4] — 2026-07-07

### Added
- **Export an AI agent conversation as readable Markdown.** The chat panel (header and
  each history row) gains a **download** control that writes the conversation to a
  well-named file — `ai-chat-<title-slug>-<date>.md`. The format is "readable + folded
  tools": a title + metadata table (exported/created/mode/messages/usage), one
  `👤 User` / `🤖 Assistant` section per turn with full text, and each turn's tool
  calls folded into a `<details>` block (a one-line result summary followed by
  input/output JSON). Condensed and cancelled turns are annotated inline.
- **Include the system context in the export.** The download control is a **split
  button**: the primary action downloads the conversation only; the caret opens a
  menu with **Download with system context**, which appends the effective standing
  system prompt (canonical body + mode suffix + authoring rules + SQL settings) as a
  folded `⚙️ System context` block. The effective prompt is captured live from the
  stream and **content-addressed** — stored once under its digest and referenced by a
  short `systemContextDigest` on each conversation, so the same prompt shared across
  many conversations is never duplicated on disk.

### Fixed
- **Duplicated assistant text in some conversations.** A pre-fix streaming path saved
  the reply twice (streamed during the tool loop *and* once after it). The streaming
  footgun is removed, and the exporter collapses any exact back-to-back doubling so
  historical conversations export clean.
- **Export download did nothing.** The blob download revoked its object URL
  synchronously (cancelling the download) from a detached anchor (which never fires);
  the anchor is now appended to the DOM and the URL revoked on a delay.
- **The split button read as two unrelated buttons.** The download + caret are now a
  single bordered, filled segmented control with a divider before the caret, so it
  clearly reads as one control with a "more options" affordance.

## [1.18.3] — 2026-07-06

### Added
- **Bulk style application from the package page.** The entity list gains a select
  column (per-row + a tri-state select-all) and, once anything is selected, a **Set
  style** menu whose options are **visual excerpts** of each style (swatch with
  fill/border/shape/badge/emphasis, not just a name). Picking one applies it to every
  selected entity **immediately** — no separate Apply step — including a "Default
  (clear override)" entry. A new **Style** column shows each entity's current override.

### Fixed
- **Styling from the diagram silently not persisting.** A style set from the canvas
  optimistically restyled the node, then swallowed any save error — so a failed PUT
  (no editor access, a 404, a network drop) looked applied but never saved. Failures
  now **roll the node back** and surface a transient banner explaining why; the
  service/entity are URL-encoded so odd names don't 404.
- **"Invalid entity: … requires property `required`" blocking a style/hide save.**
  The attribute schema requires `required`/`description` on every attribute, but
  imported / reverse-engineered entities often omit them, so a metadata-only change
  was rejected over an unrelated gap. `setEntityStyle`/`setEntityHidden` now backfill
  the safely-defaultable fields (`required` → false, `description` → "") before saving,
  healing the entity instead of failing.

## [1.18.2] — 2026-07-06

### Added
- **Color picker in the Element Styles manager.** Each color field gets a swatch that
  opens a popover with standard presets, a **precise RGB** picker (sliders + numeric
  fields), and a **None** reset; the field still accepts a raw hex or theme token, and
  swatches/previews resolve tokens to real colors.
- **Diagram format painter (#element-style).** Style entities straight from the canvas,
  PowerPoint-style: the entity info panel gains an **Appearance** picker (choose a named
  style / clear) plus **Copy format** / **Paste format**, and a toolbar **brush** applies
  a copied format to clicked entities (single click = one target, double-click = keep
  painting; Esc / Done stops). Every apply persists the non-destructive `system.style`
  override and restyles the node live.
- **Reset controls.** Page-level **Reset to defaults** (revert the whole palette to the
  starter set) and per-style **Reset** (revert one style to its factory definition).
- **Graded emphasis — 3 levels.** `emphasis` is now a level **1** light / **2** medium /
  **3** strong (`true` = 3): the level sets border weight and gates the fill wash (only
  level 3 shows a wash), and all levels boost z-order. A **greyscale font ramp** darkens
  the label with the level (base kept light and readable).
- **Default (fallback) style**, **on-node style badges**, and a **sidebar link** to
  `/element-styles`.

### Changed
- **Emphasis is greyscale, not purple.** The emphasis halo no longer falls back to the
  accent color; emphasis now reads through border weight + greyscale, with no overlay
  wash. The aggregate-root default uses `base-content`/`neutral-subtle` (was `primary`),
  drops the `AR` badge, and `-subtle` fills were lightened.

### Fixed
- Color-picker issues: swatch overflow into the next field, a hang when selecting a
  preset, the native OS color-panel freeze (native input removed), and the swatch color
  stuck on a second pick (`background` shorthand vs `backgroundImage`). Token→color
  resolution is cached.

## [1.18.1] — 2026-07-03

### Changed
- **Single source of truth for AI authoring rules.** The format contract the
  integrated agent must follow (UUID/uniqueness rules, the validation/constraint/
  rule split, conceptual-vs-physical, and the `system.hidden`/`system.style` +
  `hideRules`/`elementStyles`/`styleRules` constructs) now lives in one module
  (`services/ai/authoringRules.ts`) that the in-app agent injects into its system
  prompt (designer mode, both provider paths); `docs/SKILL.md` mirrors it, guarded
  by a drift test. The in-app agent previously carried none of these hard rules.

### Docs
- `format-reference.md` §2.2 (`hideRules[]`/`elementStyles[]`/`styleRules[]`) + §7.1
  (reserved `system.hidden`/`system.style` metadata); `SKILL.md`, `CLAUDE.md`, and
  `user-guide.md` updated to cover the Hide and Element Style features + AI tools.

## [1.18.0] — 2026-07-03

### Added
- **Element Style (#212)** — style model elements by role so large models stay
  readable. Named `elementStyles[]` + binding `styleRules[]` in `dico.config.json`
  (theme-token colors); a resolver picks each element's style by precedence
  (explicit `system.style` → rule → detected role → stereotype) with **zero-tagging
  detectors** (junction / FK-target reference / cross-repo remote-ref). Applied in
  the Cytoscape diagrams via generated `node[styleName="…"]` selectors (emphasis =
  z-order + halo) and as a badge in the entity flat table. New `/element-styles`
  manager page; `GET/PUT /api/config/element-styles|style-rules`; AI agent tools
  `defineElementStyle` / `addStyleRule` / `setEntityStyle`; `PUT
  …/entities/:entity/style`. See `docs/element-style.md`.
- **Hide model data** — non-destructive, reversible hiding of entities to declutter
  reverse-engineering waste (backup/temp/staging tables). Explicit `system.hidden`
  flag (with a pin-visible override) or `hideRules[]` (glob/regex on table/entity/
  package); excluded from lists/exports by default, with a "Show hidden" toggle and
  per-row Hide/Unhide. See `docs/hide-model-data.md`.
- **Left navigation is drag-resizable** (right edge, clamped, persisted), on top of
  the existing collapse/expand.
- **Desktop app — Electron Tier 1 packaging (#206/#207)** — `desktop/` build for
  macOS/Windows/Linux, released by a tag-only workflow (separate from the npm package).

### Fixed
- **AI chat: the reply no longer streams before its tool calls** (OpenAI-compatible
  direct client). A step's text was emitted before the tool-call check, so weak
  tool-callers streamed the answer ahead of the tools; the loop now emits only tool
  events and the controller streams the final reply once, after them — matching the
  Anthropic path.

## [1.17.0] — 2026-07-02

### Added
- **Optional, safe persistence of DB passwords for SQL Run (#209).** The connect
  dialog gains a **“Remember password on this machine”** option so a package's DB
  password isn't retyped each session. A DB password is a personal, per-machine
  secret, so it is **never** written into the project tree (`physical.yaml` is
  git-tracked/shared) — it lives under `~/.dico-app/` (0600), keyed per
  (authenticated app user, package, connection identity, DB user) so secrets are
  isolated per user on a shared machine, redacted everywhere. An **auto-detecting provider
  chain** picks the strongest at-rest protection available: Electron `safeStorage`
  (OS keychain / DPAPI / libsecret) → OS keyring via `keytar` (optional lazy dep)
  → AES-256-GCM with a master key from `DICO_SECRET_KEY` (never stored beside the
  ciphertext) → **refuse** (no plaintext fallback; the checkbox is disabled with
  the reason as a tooltip). A blank-password connect transparently reuses a saved
  secret; **“Forget saved password”** and `DELETE /api/sql/secret/:packageName`
  clear it. New `GET /api/sql/secret-capabilities` and `POST /api/sql/secret-status`.
  See `docs/sql-password-storage.md`.
- **AI chat panel is horizontally resizable.** Drag the panel's left edge to set
  its width (persisted across sessions); the composer input's dragged height is now
  remembered too.

### Changed
- **Physical diagram entity boxes no longer show the schema name.** The box shows
  only the physical table name; the schema is still available in the info panel.

## [1.16.2] — 2026-07-01

### Added
- **Reverse-engineer detection accepts a parent folder of clones.** The Maven
  auto-detect no longer requires a `pom.xml` at the scan root: when absent, the
  root is treated as a parent directory of cloned repos — it descends to the
  topmost `pom.xml` in each subtree, and each one becomes a separate project (git
  clone), single- or multi-module. Each module's `changelog`/`srcDir` are resolved
  relative to *its own clone*, which becomes that analysis unit's `repoRoot`, so
  git-history correlation runs against the right repo and cross-repo analysis sees
  each clone as a distinct repo (labels are clone-prefixed to stay unique). The
  detection result gains a `projects` count.
- **Streaming, non-blocking detection with live UI progress.** Detection is now an
  `async function*` (`detectMavenStream`) over `fs.promises` that yields
  `project`/`module`/`candidate`/`warning` events and never blocks the event loop
  on a large tree. New `POST /api/reverse-engineer/detect-stream` (NDJSON) streams
  those events; the page renders a **live scan panel** (running
  `projects · modules · changelogs` tally + per-clone checklist) instead of a
  frozen spinner, and the CLI `--detect` streams per-project/-module progress to
  stderr. (#208)

## [1.16.1] — 2026-06-30

### Fixed
- **Reverse-engineer now surfaces non-fatal failures.** A wrong changelog/repo
  path, a missing JPA source dir, or Jira/Confluence fetch errors were swallowed
  (logged server-side, returning a "successful" empty run) so nothing showed in
  the UI. The run now returns a `warnings[]` — changelog/repo not found, 0
  changeSets parsed, no `.java` files, enrichment errors, empty result — rendered
  as a Warnings section in the page (and printed by the CLI).

## [1.16.0] — 2026-06-30

### Added
- **Reverse-engineer: first-class multi-repo + cross-repo relationship analysis.**
  Mine several repos in one run; entities are resolved across repos and FKs are
  classified against the global entity set — **cross-repo** (referenced table in
  another repo), **dangling** (target in no repo), **shared entity** / **conflict**
  (same table across repos, differing columns). Emits one combined dictionary + a
  `cross-repo.json` report; each element carries its `repos`.
- **Reverse-engineer: auto-detect Liquibase changelogs from Maven projects.**
  Walks the (multi-module, nested) reactor and finds each module's master via the
  liquibase-maven-plugin config, `liquibase.properties`, or `db/changelog`
  conventions — resolving `classpath:`, validating, deprioritizing test changelogs,
  flagging SQL-format masters. UI "Detect changelogs" / CLI `--maven` / `--detect`.

### Changed
- **Reverse-engineer is now a self-contained plugin.** New contribution hooks — a
  backend **agent-tool registry** and a frontend **settings-section slot** — so the
  shared AI controller and Settings page carry no reverse-engineer-specific code.

## [1.15.0] — 2026-06-30

### Added
- **Reverse-engineer a data dictionary from a codebase** (new `/reverse-engineer`
  page + plugin, CLI, and streaming API). Mines a repo's **Liquibase** changelog
  (YAML + XML), overlays **JPA** entities, and correlates every element to the
  git commit and Jira ticket that introduced it.
  - **Drift report** — JPA (logical) ⇄ Liquibase (physical): nullable / length
    mismatches, columns missing in the DB, orphan columns.
  - **Enrichment (Atlassian Server/DC)** — **Jira** ticket fetch + **Confluence**
    space dump, configured and tested from **Settings**, cached locally.
  - **Projection** — emits a loadable smart-data-dico project (passes
    `validateDico`), provenance/drift kept as `re.*` metadata.
  - **Provider-agnostic AI synthesis package** — per-entity grounded briefs +
    `AGENT.md` hand-off for an external agent (opencode / claude-code) or the
    integrated agent (new `listSynthesisBriefs` / `getSynthesisBrief` tools);
    review (markdown) or direct output modes.
  - **Update mode** — deterministic UUIDv5 ids + merge into an existing project
    (reuse UUIDs, preserve human descriptions/rules, refresh structure).
  - **Live analysis-progress panel** in the UI, fed by a streaming run endpoint.

## [1.14.1] — 2026-06-29

### Changed
- **SQL errors now go back to the AI agent conversationally.** When a query run
  from the chat fails (syntax / DB error), the failed SQL and the error are posted
  into the chat thread (via an `ai-chat:sql-error` event) so the assistant explains
  the cause and replies with a corrected query — whose ```sql block carries its own
  ▶ Run button. This replaces the previous silent, capped auto-repair loop.

### Removed
- `POST /api/ai/sql-repair` and the client `sqlRunApi.repair` helper (superseded by
  the conversational error-to-agent flow above).

## [1.14.0] — 2026-06-28

### Added
- **Run generated SQL from the AI chat** — fenced ```sql blocks now carry a
  **▶ Run** button. It opens a modal that connects to the package's physical
  database (read-only), runs the query, and shows results in a chunked grid that
  fetches more rows on scroll via a server-side cursor (SQL-Developer style — the
  query is opened once, not re-run per page). On a database error it runs an
  **auto-repair loop (cap 3)**: the failed SQL and error are sent back to the
  model (`POST /api/ai/sql-repair`), grounded with the package physical schema,
  and the corrected query is re-run — with the repair trail shown.
- **Read-only SQL execution backend** (`/api/sql/connect|run|fetch|close`,
  `src/services/sql/`). Single-statement `SELECT`/`WITH` is hard-enforced;
  per-dialect server-side cursors (pg/mysql/mssql/oracle/sqlite) stream chunks on demand.
- **SQLite dialect** for zero-setup local/dev querying via Node's built-in
  `node:sqlite` — no external driver. The CLI auto-enables `--experimental-sqlite`
  on Node versions that still gate it.
- **Database drivers are optional** — `pg`/`mysql2`/`mssql`/`oracledb` are optional
  peer dependencies, dynamically loaded with an actionable "npm install <driver>"
  error when missing, so a default install carries none of them.

### Security
- DB credentials for SQL execution are held **in memory only, per package, with a
  sliding ~30-minute TTL** — never written to disk, never logged, and the password
  is redacted from every API response. The repair endpoint never touches the
  connection or credentials (it consumes only model metadata).

### Notes
- Cursor adapters are unit-tested via an in-memory fake. **Postgres and SQLite are
  also verified end-to-end against real databases**; mysql/mssql/oracle still need
  live verification.

## [1.13.1] — 2026-06-28

### Added
- **AI chat can author every concept** — new mutation tools so the assistant can
  create stereotypes, derived types, rules, cases, events, actions (with
  emit/wait flow steps that compose a saga), and entity state machines — not
  just entities and relationships. Wired into both provider paths.
- **Physical-model grounding for SQL** — `getEntityDetails` now returns each
  entity's physical mapping (table/schema, per-column name + DB type),
  validation, constraints, and inline rules; a new `getSqlSchema` tool returns
  the whole physical relational schema (typed columns, PKs, join hints) so the
  assistant writes physically-correct, dialect-aware SQL. System prompt teaches
  the conceptual-vs-physical distinction.
- **`getModelOverview` tool + per-turn model snapshot** injected into the system
  prompt, so the assistant starts each turn oriented (packages → entities +
  concept counts) instead of rediscovering the model.
- **`generateMermaid` tool** — convert the model to Mermaid `er` / `class` /
  `state` / `flow` diagrams, **rendered inline** in the chat panel.
- **`ai.sql.schemaQualifyTables` setting** — opt-in that injects an instruction
  to schema-qualify table names (`schema.table`) in generated SQL, with an
  optional default schema.
- **Self-describing tool cards** — read/navigate tool results now carry a concise
  summary naming the entities / packages / tables involved.

### Fixed
- **Confabulation root cause** — the conversation sent to the model carried text
  only; prior tool calls and their results were stripped, so a weak tool-caller
  learned to narrate "done" instead of calling tools (worsening across a
  multi-turn build). Both provider paths now reconstruct the prior tool calls +
  results into the model history. Verified by a clean-room rebuild that ran with
  zero confabulations where the previous build needed many forceful retries.
- **Silent false-success on entity writes** — attribute `validation`
  (maxLength/pattern/minimum/…) was dropped while the tool reported success; an
  unknown stereotype hard-failed the whole mutation. Validation now persists and
  unknown stereotypes are dropped-and-warned.
- **Confabulation guard** — a `no-op-warning` is surfaced when the model claims a
  change but no create/update/delete actually ran (heuristic catches descriptive
  vs. agentive phrasing, and verb-governed concept claims like "Created state
  machine X").

## [1.13.0] — 2026-06-26

### Added
- **Action-flow diagram** (#201, Phase 1) — an action's typed `FlowStep[]` now
  renders as a top-down flowchart in addition to the nested list. A pure
  `flowToGraph` mapper turns the flow into nodes + edges (synthetic Start/End,
  sequential edges, `branch` forks with labelled then/else, event markers); a
  List/Diagram toggle on each action switches views, and `invokeAction` nodes
  link to the referenced action. Rendering only — nothing is executed.
- **First-class `Event` element** (#201, Phase 2) — events are promoted from
  opaque names to a modeled element with an optional owner and a payload schema.
  New `events:` section in the multi-kind YAML loader (uuid + name collision
  detection), CRUD API + an entity Events tab, and `emitEvent` / `wait` steps
  can now reference a real event via `eventRef` (validated; the opaque name
  stays a non-breaking fallback). The flow diagram resolves modeled event names.
- **CQRS classification + saga / process view** (#201, Phase 3) — actions carry
  an optional `actionKind` (`command` / `query`), shown as a chip and editable
  in the action editor. A new **Process** diagram view-mode graphs every action
  and event in a package into the end-to-end command → events → reactions map
  (`invoke` / `emit` / `react` edges), with commands and queries visually
  distinct and filterable.
- **Create-package modal** — the package hierarchy view gains a "New package"
  action (button + empty-state) wired to package creation, navigation, and
  refresh.

## [1.12.6] — 2026-06-25

### Added
- **Server-side approval gate for AI tool calls** (#197) — the assistant now
  blocks create / update / delete tool calls on a real server-side gate until
  you approve them in the chat; reads and navigation still run freely. Honors
  the per-category auto-approve policy and autonomous mode, and deletes always
  require explicit approval.

### Fixed
- **AI tool approvals now actually take effect** (#197) — approving a gated tool
  call previously only updated the card locally while the backend had already
  executed it ("validation ended with no effect"). The gate makes approve/reject
  a genuine decision: a denied call returns a rejected result and the model
  continues. Side-effect-free reads and `auto`-trust MCP tools no longer prompt.

## [1.12.5] — 2026-06-24

### Changed
- **AI "highlight applied change" now flashes the specific added attribute row**
  — when the assistant's `updateEntity` adds an attribute, navigating to the
  entity briefly flashes that new attribute's row (scrolled into view) instead
  of just the entity header. Field-level edits and whole-entity changes still
  flash the header. (#193)

## [1.12.4] — 2026-06-23

### Fixed
- **Entity detail shows a proper "Entity not found" state on 404** — navigating
  to a non-existent entity (a stale/bad deep link, or an AI navigation to a name
  that was never created) now renders the dedicated not-found banner instead of
  the generic "Failed to load… please try again later" message, which is now
  reserved for real network / 5xx load failures. (#194)

## [1.12.3] — 2026-06-23

### Added
- **AI assistant can now update and delete model elements** — the chat tools
  gained `updateEntity`/`updateRelationship`/`deleteEntity`/`deleteRelationship`
  alongside create, all routed through the per-category review gate (deletes
  always require explicit approval). (#191)
- **Structured change-summary cards** in the AI chat — an applied mutation now
  shows change kind, entity/relationship name, package, and a short delta
  instead of a raw JSON dump, and the changed element is briefly highlighted on
  the destination page after navigation. (#191)
- **Graceful AI step-limit handling** — the agentic tool-call cap is raised to
  500 and, when reached, the assistant wraps up with a summary of what it did
  and shows an explicit "stopped at the step limit" notice rather than cutting
  off silently. (#192)

### Changed
- **AI mutation tools validate structured input before persisting** — typed
  schemas plus semantic checks (unknown attribute type / stereotype / package,
  duplicate names, unresolved relationship endpoints) now reject bad input with
  a clear, recoverable error the model can self-correct, instead of a runtime
  JSON parse failure. (#191)

### Fixed
- **AI chat no longer leaves a hanging "Calling …" tool card** — a tool whose
  execution errors (or whose arguments fail validation) now resolves to a
  terminal error card instead of a perpetual spinner, and is never persisted as
  a stuck card on reload. (#190)

## [1.12.2] — 2026-06-11

### Added
- **Structural/Physical tabs on the package Diagram view** — the package
  diagram now has the same view-mode switcher as `/diagram`; both share the
  sticky `sdd-diagram-view` preference.

### Changed
- Diagram rendering unified into a single `DiagramViewer` component (tab strip
  + sticky view mode + full-height canvas) used by `/diagram` and the package
  Diagram view.

> 1.12.1 was tagged but never published to npm; its fix ships here.

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
