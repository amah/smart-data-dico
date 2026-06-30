# Reverse-engineering a data dictionary — UI guide

Reconstruct a smart-data-dico dictionary from an existing codebase (Liquibase +
JPA + git history), optionally enriched from Jira/Confluence, with a live
progress panel and a grounded hand-off for an AI "prose pass".

> **Local-mode only.** The backend reads repository paths on the host it runs on,
> so all paths below are resolved **on the server**, not your browser machine.
> Configuration + runs require **ADMIN** (running alone needs ADMIN/EDITOR).

## 1. (Optional) Configure enrichment — Settings

`/settings` has two sections (both **Atlassian Server / Data Center**, not Cloud):

- **Jira (Server / Data Center)** — Base URL, Auth (Personal Access Token / Bearer,
  or Username + Password), the secret, **Enable**, **Save**, **Test connection**
  (validates against `/rest/api/2/myself`).
- **Confluence (Server / Data Center)** — Base URL, **Space key**, Auth, Max pages,
  the secret, **Enable**, **Save**, **Test connection** (`/rest/api/space/{key}`).

Notes:
- Set the **Base URL to include any context path** (e.g. `https://intranet/confluence`).
- Secrets are stored in `~/.dico-app/dico-app.json` (mode 0600), **redacted on
  load**; saving with the secret field blank **keeps the existing one**.
- Skip this if you only want structure + drift.

## 2. Run the analysis — Reverse-engineer page

Sidebar → **Reverse-engineer** (`/reverse-engineer`). Fill the form:

| Field | Meaning |
|---|---|
| **Repository path** | absolute path to the repo on the server (e.g. `/srv/repos/orders`) |
| **Changelog (repo-relative)** | Liquibase master changelog (`db/db.changelog-master.yaml` or `.xml`) |
| **Java source dir** *(optional → drift)* | e.g. `src/main/java` — enables the JPA scan + JPA⇄DB drift |
| **Output store** *(optional)* | where the CIR store is written (e.g. `.dico-re`) |
| **Emit dico project to** *(optional)* | path for the generated smart-data-dico project |
| **AI synthesis package** | `none` / `review` (markdown for approval) / `direct` (agent edits dico) |
| **Enrich with Jira** | per-run opt-out of enrichment |

Click **Run extraction**.

### Multi-repo (cross-repo analysis)

Tick **Multi-repo (cross-repo analysis)** to mine several repos in one run. A JSON
field replaces the single-repo inputs:

```json
[
  { "name": "orders-svc",   "repoRoot": "/srv/repos/orders",   "changelog": "db/db.changelog-master.yaml", "srcDir": "src/main/java" },
  { "name": "customer-svc", "repoRoot": "/srv/repos/customer", "changelog": "db/db.changelog-master.yaml" }
]
```

Each repo is extracted independently, then **resolved across repos**:
- **Shared entities** — the same physical table defined in more than one repo
  (records all repos; flags `cross-repo-conflict` if the column definitions differ).
- **Cross-repo relationships** — a FK whose referenced table lives in *another*
  repo (e.g. `orders.customer_id` → `customer` in customer-svc) is flagged
  `cross-repo` with the from/to repos.
- **Dangling references** — a FK to a table not found in *any* analysed repo
  (flagged `cross-repo-dangling`).

Results show as chips (repos / cross-repo rels / dangling / conflicts) and a
**Cross-repo analysis** list; the full report is written to `cross-repo.json` in
the store, and each element carries its `repos` (→ `re.repos` in the dico). The
CLI equivalent is `--manifest <repos.json>`.

#### Maven auto-detect (no changelog paths needed)

In multi-repo mode, enter a **Maven project root** and click **Detect changelogs**.
It walks the reactor (root `pom.xml` `<modules>`, recursively) and finds each
module's Liquibase master via — in confidence order — the **liquibase-maven-plugin**
config (`<changeLogFile>` / `<propertyFile>`), **`liquibase.properties`**, then
**`db/changelog` conventions**; `classpath:` is resolved against the resource
roots, `src/test/resources` changelogs are deprioritized, and SQL-formatted
masters are flagged (the SQL loader isn't built yet). The detected plan (one unit
per module) is written into the repos box for you to **review, then Run** — which
gives cross-**module** relationship analysis. CLI: `--maven <projectRoot>` (run)
or `--detect <projectRoot>` (report only); `--include-test` to keep test changelogs.

## 3. Watch the live progress panel

Stages stream as they complete:
`Parse Liquibase → Correlate git/tickets → Scan JPA → Compute drift → Enrich from
Jira → Dump Confluence → Emit dico project → Build synthesis package → done`, each
with detail/counts.

## 4. Read the results

- Summary chips: elements, events, changeSets, **commit-linked**, JPA files,
  **drift**, **Jira**, **Confluence**, plus the tickets found.
- A **drift list** (e.g. `nullable-mismatch customer.display_name — JPA false vs DB true`).
- An **element table** (kind, id, ticket, type, confidence, ⚠ drift).
- Paths to the **CIR store**, the **emitted dico project**, and the **synthesis package**.

### Outputs on disk
- **CIR store** (`.dico-re/`): `model/**`, `timeline/events.jsonl`, `drift.json`,
  `enrichment/jira/*.json`, `enrichment/confluence/*.md`.
- **Emitted dico project**: `dico.config.json` + package + `*.model.yaml` +
  `relationships.model.yaml` (passes the validator; drift/provenance kept as
  `re.*` metadata).
- **Synthesis package** (`<project>/synthesis/`): `AGENT.md`, `briefs/<Entity>.md`,
  and (review mode) `proposals/<Entity>.md`.

## 5. The AI prose pass (descriptions + rules)

Both routes are grounded by the synthesis package; the structural model is already
correct, so the agent only writes prose + proposes rules.

- **External agent** (opencode / claude-code / cursor): point it at the
  `synthesis/` folder — `AGENT.md` is the hand-off. **No API key needed in the app.**
- **Integrated agent**: **Open the emitted project** as the active project, then use
  the **AI chat** — it has `listSynthesisBriefs` / `getSynthesisBrief` to ground its
  existing `updateEntity` / `createRule` writes.

Output mode: **review** → proposals land in `synthesis/proposals/<Entity>.md` for
human approval; **direct** → the agent edits the dico YAML. Rules: cite the source,
don't invent, surface (don't silently fix) drift.

## 6. View the result

Open the emitted dico project (project switcher / Open Folder) and browse it like
any dictionary — entities, attributes, relationships, the diagram.

## Re-running / updating an existing dictionary

Two behaviours, chosen by the **Update existing (merge)** toggle (CLI `--update`):

**Overwrite (default).** Writes a fresh project. UUIDs are now **deterministic**
(UUIDv5 of the canonical key), so repeated overwrite runs on the *same* input are
idempotent — same entities, same UUIDs. It still replaces the files it generates,
so don't point it at a hand-maintained project.

**Update / merge (toggle on).** Patches the existing project at the emit path **in
place**:
- **Reuses existing UUIDs** (matched by physical table/column) — references,
  diagram layouts and history stay intact.
- **Preserves human prose** — non-empty entity/attribute descriptions, `rules`,
  review comments, and any fields the tool doesn't model are kept untouched.
- **Refreshes structural facts** — types, required, validation, constraints,
  relationships, and the `re.*` provenance/drift metadata are updated from the
  new extraction.
- **Adds** new entities/attributes; **tags** attributes that vanished from the
  source with `re.removedFromSource: true` (kept, not deleted).
- The run reports `N merged, M added`. The result still passes `validateDico`.

Also re-run-friendly: the CIR store + synthesis briefs regenerate deterministically,
and **Jira/Confluence enrichment is cached (24h TTL)** — only stale items re-fetch.

> Known limit: matching is by **physical name**. A renamed table/column is seen as
> a remove + add (the old one is tagged `re.removedFromSource`, a new one is
> created) rather than a rename — reconcile those by hand.

## CLI equivalent

```bash
tsx backend/src/scripts/reverseEngineer/cli.ts \
  --repo /srv/repos/orders \
  --changelog db/db.changelog-master.yaml \
  --src src/main/java \
  --out /srv/out/orders/.dico-re \
  --emit-dico /srv/out/orders/project \
  --synthesis review
# Jira/Confluence via env (JIRA_BASE_URL/JIRA_TOKEN, CONFLUENCE_BASE_URL/_TOKEN/_SPACE)
# or the saved Settings config; --no-jira / --no-confluence to opt out.
```
