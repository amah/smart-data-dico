# Reverse-engineering a Data Dictionary from a multi-repo codebase

Status: **design + Phase-1 prototype** · Owner: Amah · Related: `smart-data-dico` (the dictionary tool this feeds)

## Goal

Reconstruct a data dictionary (entities, attributes, relationships, constraints,
validation, business rules) for a large, multi-repo enterprise system by mining
what the code and its history already encode — then let an AI model turn that raw
material into / update the `smart-data-dico` model, with full provenance.

This tool is the **upstream ETL** for `smart-data-dico`: it emits the same YAML
model the dictionary app consumes, so the human-facing tool stays the source of
record while this keeps it grounded in reality.

## Decisions (locked)

- **Lives inside `smart-data-dico`**, runnable from **CLI** and **UI** (a backend
  service invoked by both a script and an API route/page).
- **No CodeQL.** Its free license forbids private-codebase + automated use (needs
  paid GitHub Advanced Security), and buildless Java extraction has weak type
  resolution. See `Appendix: why not CodeQL`.
- **Java extraction = static AST**, JavaParser-class. Because the tool runs in the
  Node backend (and from the UI, no JVM), the in-stack equivalent is a JS Java
  parser (`java-parser` CST / tree-sitter-java), not the JVM JavaParser.
- **Liquibase-first.** It is an explicit, ordered, append-only schema *history* —
  the cheapest, richest signal — so the Phase-1 prototype is Liquibase-only.

## Core principle: deterministic extraction ≠ AI synthesis

Two layers that never blur:

1. **Extraction (deterministic, no LLM):** parse code/schema/history into a
   structured, provenance-tagged store. Same input → same output.
2. **Synthesis (AI, grounded):** an LLM reads that store and writes *only*
   prose/inference (descriptions, candidate rules, groupings); every sentence
   cites a source from layer 1. Unsourced inference is flagged, never asserted.

## Signal sources

| Class | Sources | Yields |
|---|---|---|
| **Structural truth** | **JPA**, **Liquibase**, DDL/Flyway | entities, attributes, types, relationships, constraints, validation |
| **Context (why/when)** | git history, **Jira**, Confluence, PR/MR | rationale, business rules, lifecycle, ownership |

### JPA + Liquibase, and the drift dividend
- **JPA = logical/object truth** (what the app believes): `@Entity/@Table`,
  field→`@Column`, `@ManyToOne/@OneToMany/@ManyToMany/@JoinColumn/@JoinTable`
  (relationships + cardinality), `@Id`, `@Embeddable`, `@Inheritance`,
  `@Enumerated`, Bean Validation (`@NotNull/@Size/@Pattern/@Min/@Max/@Email`).
- **Liquibase = physical truth + timeline** (what the DB has, and *when*): each
  `changeSet` has `id`, `author`, `comment`, `context/labels`, ordered position;
  the `id` often embeds the ticket (`id="PROJ-1234-add-email-verified"`).
- **Their diff is a finding:** `nullable=false` with no NOT NULL constraint, a
  field with no column, an orphan column → emitted as **drift/quality flags**.

### Maps 1:1 onto smart-data-dico's three-concept split (#85)
| dico concept | Source (deterministic unless noted) |
|---|---|
| **Validation** (`attribute.validation`) | JPA Bean Validation + `@Column(length)` |
| **Constraint** (`entity.constraints[]`) | Liquibase PK/FK/unique/check/index + JPA `@JoinColumn` |
| **Rule** (first-class) | Jira/commit/PR rationale — **AI-synthesized, grounded** |

So extraction fills Validation + Constraint deterministically; the AI is reserved
for Rules + descriptions — exactly where business context lives.

## Architecture (pipeline of idempotent stages)

```
 repos ─┐
 jira ──┤   1.EXTRACT      2.NORMALIZE     3.CORRELATE      4.ENRICH      5.INDEX        6.SYNTHESIZE     7.REVIEW
 conf ──┘  per-source  →  → CIR elements → lifecycle log → Jira/Conf/PR → registry +  → AI → dico YAML → human gates,
            adapters       + provenance     + ticket link   cached docs    embeddings    (grounded)        drift report
```

Each stage is cached and re-runnable, keyed by content hash + a per-repo
watermark (last processed commit). Re-runs process only new commits/changeSets
and re-synthesize only affected elements. Human edits to the dictionary are
"golden" and survive regeneration (merge, never clobber).

### Correlation engine (the heart)
1. **Element identity** — physical key `(schema, table, column)`, logical key
   `(fqcn, field)`; bridge via `@Table`/`@Column` names → one canonical element,
   both faces recorded.
2. **Lifecycle events** (append-only) — *born / modified / renamed / deprecated /
   removed*. Liquibase: the `createTable`/`addColumn` changeSet = birth; the
   commit that introduced that changelog hunk → ticket. JPA: `git log --follow` +
   `blame -L` on the field line.
3. **Ticket linking** — regex `([A-Z]{2,}-\d+)` over commit messages, branch
   names, changeSet ids, PR titles. More corroboration → higher confidence.
4. **Cross-repo entity resolution** — same logical entity across services;
   resolve by canonical key, **never silently merge** — record both, flag
   conflicts (mirrors dico's hard-error-on-collision stance).

## Structured local store ("raw material")

```
.dico-re/                          # the store (gitignorable, re-derivable)
  model/
    entities/<key>.json            # CIR element: facts + provenance + confidence
    attributes/<key>.json
    relationships/<id>.json
    constraints/<id>.json
  timeline/events.jsonl            # append-only lifecycle events
  enrichment/
    jira/<KEY>.json                # summary, desc, type, epic, AC, links, fetchedAt
    confluence/<pageId>.md
    prs/<repo>#<n>.json
  index/elements.sqlite            # registry + xrefs + lookup
  index/embeddings/                # retrieval for grounded synthesis
  dictionary/                      # AI OUTPUT (smart-data-dico YAML) — regenerable
```

Schemas for `element` and `event` are in `docs/reverse-engineering/schemas/`
(authoritative JSON Schema; mirrored as zod in the extractor for runtime
validation).

## Synthesis → dictionary

Two halves, deterministic first:

1. **Deterministic projection (done):** `synthesize.ts` `emitDicoProject()` maps
   the merged CIR → a **loadable smart-data-dico project** (dico.config.json +
   package + per-entity `*.model.yaml` + `relationships.model.yaml`). Types
   mapped (SQL/Java → AttributeType), `required` from nullability, validation
   carried, physical constraints emitted, relationships wired by entity uuid.
   Provenance + drift land as `re.ticket` / `re.commit` / `re.confidence` /
   `re.drift` metadata; entity descriptions seed from the Jira summary. Enabled
   via `emitDico` (CLI `--emit-dico`, API `emitDico`). **Verified: the output
   passes the repo's own `validateDico` with 0 errors/0 warnings.**
2. **AI prose pass (next):** per entity, retrieve facts + lifecycle + linked
   Jira/Conf/PR → prompt the model to rewrite descriptions and propose candidate
   `rules`/stereotypes on top of the grounded skeleton. Guardrails: **cite or
   stay silent**, **confidence-gated**, **incremental**, **human-override-safe**.

## Surfaces — implemented as a plugin (front + back)

Single backend service, three surfaces:

- **Back (service)** — `backend/src/services/reverseEngineer/` (`reverseEngineerService.ts`
  + `liquibase.ts`, `git.ts`, `types.ts` with zod). Reads *external* repos via raw
  fs (legitimately outside `IStorageBackend`; dir is in the ESLint fs allow-list).
- **Back (HTTP)** — `controllers/reverseEngineerController.ts` →
  `routes/reverseEngineer.routes.ts` (`POST /api/reverse-engineer/run`, ADMIN/EDITOR,
  local-mode only), mounted in `routes/index.ts`.
- **CLI** — `backend/src/scripts/reverseEngineer/cli.ts` (thin wrapper over the
  service): `tsx … cli.ts --repo <path> --changelog <file> [--out <dir>]`.
- **Front (plugin)** — `frontend/src/plugins/reverse-engineer/reverseEngineerPlugin.ts`
  registers route ownership of `/reverse-engineer` + a `reverse-engineer.run`
  command; `reverseEngineerApi` in `services/api.ts`; page
  `pages/ReverseEngineerPage.tsx` (design-system primitives); route in `App.tsx`;
  registered in `kernel/bootstrap.ts`.

The page currently shows the summary + element table with commit/ticket
provenance; the timeline view, drift report, and accept-into-dictionary diff are
the next UI increments.

## Build order

1. **Phase 1 (done): Liquibase-only**, single repo → CIR elements + timeline +
   ticket links → emit a dictionary stub. Proves the spine. **YAML + XML**
   changelogs supported (extension-dispatched adapters → one canonical op shape;
   mixed-format includes work); SQL changelogs are the remaining adapter.
2. **JPA extractor → merge with Liquibase → drift report (done).** Focused
   comment/string-aware static scanner (`jpa.ts`) reads `@Entity/@Table/@Column/
   @ManyToOne/@OneToOne/@JoinColumn` + Bean Validation into CIR with both faces
   (logical fqcn/field + physical table/column). `drift.ts` merges by canonical
   id and flags `nullable-mismatch`, `length-mismatch`, `column-missing`
   (JPA-only), `orphan-column` (DB-only). Only owning FK sides emit relationships
   (inverse `@OneToMany` ignored → no false drift). Enabled via `srcDir`
   (CLI `--src`, API `srcDir`); writes `drift.json`. (Upgrade path: java-parser /
   tree-sitter-java behind the same interface for exotic Java.)
3. **Jira enrichment (done, Server/DC).** `jira.ts`: fetches each correlated
   ticket via REST v2 (`/rest/api/2/issue/{key}`), PAT Bearer or basic auth,
   caches to `enrichment/jira/<KEY>.json` (TTL, `fetchedAt`), and adds a `jira`
   provenance entry to every element those tickets touched. Config in
   `~/.dico-app/dico-app.json` `jira` section via the Settings page
   (`GET/POST /api/reverse-engineer/jira-config`, `POST …/jira-test`); run
   enriches when `enabled` + opt-in. (Cloud/ADF + Confluence/PR are the remaining
   enrichers.)
4. Multi-repo join + cross-repo entity resolution.
5. **Confluence dump (done, Server/DC) + UI.** `confluence.ts`: dumps a
   configured space (paged, bounded by `limit`) → `enrichment/confluence/<id>.md`
   (HTML→text + frontmatter); config in Settings; runs when enabled. PR
   enrichment + embeddings remain.

### UI surfaces (done)
Sidebar link to `/reverse-engineer`; the page streams a **live analysis panel**
(`POST /run-stream` emits NDJSON `{type:'progress', stage, status, detail}` →
the page consumes it via `fetch` + a stream reader and lights up each stage:
parse → correlate → jpa → drift → jira → confluence → emit → done). Settings has
Jira + Confluence sections.

## Appendix: why not CodeQL

Technically capable (annotations are first-class QL; dataflow could mine Rule
enforcement points), and `--build-mode none` (CodeQL ≥2.16.5) removes the
per-repo build — but: (1) **license forbids private-codebase + automated/CI use**
without paid GitHub Advanced Security; (2) buildless Java has weak type
resolution (hurts `@OneToMany` target inference); (3) heavyweight per-repo DB
build for what is mostly "enumerate annotations." Kept as an *optional* dataflow
lane behind the same CIR contract **iff** the org already has GHAS — not the
foundation.
