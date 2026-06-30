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

**Current behaviour: one-shot generation, NOT an in-place update.**

`Emit dico project` writes a **fresh** project: it `writeFileSync`-overwrites the
files for the entities it knows and assigns **new random UUIDs each run**
(`crypto.randomUUID`). Consequently, pointing it at an **existing** dico project:

- **changes all UUIDs** (breaking anything keyed by uuid — references, diagram
  layouts, history);
- **overwrites** the regenerated entity YAML, **clobbering human-authored
  descriptions / rules / review comments**;
- leaves unrelated entities untouched (a partial overwrite).

What **is** re-run-friendly today: the CIR store and synthesis briefs are
regenerated deterministically (except those UUIDs), and **Jira/Confluence
enrichment is cached with a 24h TTL** (re-fetches only stale items).

**So: always emit into a NEW directory, then bring changes into your real
dictionary via the AI prose pass / manual review — do not emit on top of a
maintained project yet.**

### True update mode — roadmap (not yet built)
To support safe re-runs onto a maintained dictionary we need:
1. **Stable identity** — derive UUIDs deterministically (UUIDv5 from the canonical
   `table` / `table.column` key) or reuse existing UUIDs by matching physical names,
   instead of `randomUUID`.
2. **Merge, don't clobber** — load the existing project, update **structural** facts
   (types, required, constraints) from the new extraction while **preserving
   human prose** (non-empty descriptions, rules, review comments); add new
   elements; mark removed ones **deprecated** rather than deleting; surface
   conflicts.

This is the "incremental + human-override-safe" guardrail from
`reverse-engineering-strategy.md` — designed, not yet implemented.

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
