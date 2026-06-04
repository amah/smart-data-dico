---
name: smart-data-dico
description: "Author, edit, and validate Smart Data Dictionary files (entities, relationships, rules, cases, actions, state machines, stereotypes, dico.config.json). Use whenever creating or modifying YAML/JSON under a folder that contains dico.config.json — the project marker for a Smart Data Dictionary, in any repo. The full format spec and related docs are bundled alongside this skill."
---

# Smart Data Dictionary — format authoring skill

Use this skill when creating or editing a **file-based Smart Data Dictionary** — any
`.yaml`/`.json` under a folder that contains `dico.config.json` (the project marker).
These dictionary projects are usually separate from the application source: they hold only
the data files, not the app's TypeScript. This skill works in any such project.

This skill folder bundles the project's docs. The authoritative format spec is
**`format-reference.md`** (read it first); `user-guide.md`, `api-reference.md`,
`deployment.md`, and `adr/` provide supporting context.

## Step 0 — orient

1. Read **`format-reference.md`** (in this skill's directory) for the section you're touching.
2. If an example already exists in the project (another package's `*.model.yaml`,
   `relationships.model.yaml`, etc.), mirror its style and conventions.
3. If you happen to be working **inside the `smart-data-dico` application source repo**, the
   authoritative types live in `backend/src/models/` (`EntitySchema.ts`, `Rule.ts`, `Action.ts`,
   `StateMachine.ts`) — prefer those over the bundled doc if they've diverged, and flag the drift.

## Hard rules (these are load-time errors or silent corruption if broken)

- **Every `uuid` is required and must be a real UUID v1–v5** matching
  `^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`.
  Applies to entities, every attribute (including nested `properties`/`items`), relationships,
  cases, and to relationship/rule targets that reference by UUID. **Never hand-invent UUIDs by
  typing hex** — generate them: `node -e "console.log(crypto.randomUUID())"` (or `uuidgen`).
  Action/state-machine/transition UUIDs are author-chosen slugs (e.g. `act-order-cancel`,
  `tr-f-1`) but must be **unique within the package**.
- **Identifiers are unique across the whole package**, not per file. Duplicate entity name, or
  duplicate rule/case/relationship/action/state-machine UUID anywhere in the package folder is a
  **hard load error citing both paths**. The loader merges all files in a package, so a collision
  across two files fails just as hard as within one.
- **References are UUID-based, never name-based**, so renames don't break links: relationship
  `ends[].entity` / `source.entity` / `target.entity`, rule `targets[].uuid`, action `ownerRef`,
  state-machine `ownerRef`, transition `invoke[]` (action UUIDs). Verify every reference resolves
  to something that exists in the same package.
- **`package.yaml` is the reserved package marker** (`name: <pkg>`). `metadata.yaml` is reserved
  at project level. Don't put domain content in either.
- **Multi-kind YAML:** filenames are convention only. A file may carry any mix of `entities:` /
  `relationships:` / `rules:` / `cases:` / `perspectives:` / `actions:` / `stateMachines:`. Put
  content where the convention says (see the table in `format-reference.md`) unless asked otherwise.

## Don't collapse the three governance concepts

| Concept | Goes in | Never put it... |
|---|---|---|
| **Validation** (shape: `pattern`, `maxLength`, `enumValues`, `minimum`…) | `attribute.validation` | as a constraint or a rule |
| **Constraint** (DB-enforced: `unique`, `check`, `foreignKey`, `index`) | `entity.constraints[]` | as validation |
| **Rule** (business invariant) | first-class `Rule` (entity/package/case/global) | synthesized from validation |

`type: enum` → the allowed values live in `validation.enumValues`, not a separate field.

## When adding each element — checklist

- **Entity** (`entities:` in `<Name>.model.yaml`): `uuid`, `name`, `attributes` required. Use
  `type: object` → `properties:` (keyed map) and `type: array` → `items:` for nested shapes; every
  nested attribute still needs its own `uuid`. Avoid legacy `id`/`microservice`/`version`/inline
  `relationships` fields some older files still carry.
- **Attribute type**: a standard `AttributeType` (`string number integer boolean datetime date
  time date-time timestamp duration enum object array uuid`) **or** a derived-type name declared
  in `dico.config.json.types[]`. For a reusable validated type, add it there (`basedOn` +
  `validation`) instead of repeating validation on every attribute.
- **Relationship** (`relationships.model.yaml`): prefer the symmetric `ends: [ {entity,
  cardinality, role?}, {…} ]` shape. `cardinality` is `one`|`many`. Keep `source`/`target` only
  when matching existing legacy data in the same file.
- **Rule** (`rules.model.yaml` or inlined on the entity): kebab-case `name`, markdown
  `description`, `severity` (info|warning|error), `enforcement` (save|process|advisory), `scope`,
  and ≥1 `targets[]`. Scope-specific field required: `entityUuid` / `packageName` / `caseUuid`.
  `process` enforcement needs a `process-stage-field` metadata entry.
- **Case** (`<Name>.case.yaml`): `uuid`, `name`, `rootEntities` (entity UUIDs); annotate paths via
  `nodes[]` (`traverse`/`exclude`/`metadata`).
- **Action** (`<Name>.actions.yaml`): `uuid`, `name`, `ownerRef` (entity UUID); flow steps must use
  a valid `kind` (`assign emitEvent invokeAction branch wait callExternal`) with that kind's fields.
  `invokeAction.actionRef` must resolve within the package. Modeling only — strings are opaque.
- **State machine** (`<Name>.statemachine.yaml`): `uuid`, `name`, `ownerRef`, `initialState` (a
  declared state), `states[]`, `transitions[]`. `from` is a declared state or `"*"`; `to` is a
  declared state; `invoke[]` are action UUIDs. `(ownerRef, name)` must be unique per entity.
- **Stereotype**: canonical form is a **schema-entity** under `.dico/schemas/<slug>.entity.yaml`
  tagged `stereotype: metadata-schema`, with an `appliesTo` metadata entry and `displayName` when
  the label differs from the slug. UUIDs are minted once and never regenerated. The legacy
  `.dico/stereotypes.yaml` is usually `[]`.

## Validate your work

There is no standalone validate CLI. Verify by these means, in order:

1. **Self-check** every file against the checklist above and the JSON Schema shapes described in
   `format-reference.md` (§3 entities, §6 relationships). Confirm: all UUIDs well-formed and
   unique package-wide; every reference resolves; required fields present; validation vs.
   constraint vs. rule not conflated.
2. **End-to-end (the real pass):** load the project in the Smart Data Dictionary app
   (`smart-data-dico --data-dir <project>`, or point the dev server's `DATA_DIR` at it). The
   content-driven loader parses every package file and **throws on UUID/name collisions and
   unresolved references** — a clean boot is the definitive validation.
3. **Programmatic (only if the app source is on hand):** from the app's `backend/`, run the
   exported `validateEntity` / `validateRelationship` on your YAML. Write a small `tsx` script
   (the inline `tsx -e` form does NOT resolve the `.js`→`.ts` import — use a file):
   ```bash
   # run from the smart-data-dico backend/ directory
   cat > /tmp/dico-check.mts <<'EOF'
   import { load } from 'js-yaml';
   import { readFileSync } from 'fs';
   import { validateEntity } from './src/models/EntitySchema.js';
   const doc: any = load(readFileSync(process.argv[2], 'utf8'));
   for (const e of doc.entities ?? []) console.log(e.name, JSON.stringify(validateEntity(e)));
   EOF
   cp /tmp/dico-check.mts ./dico-check.mts
   npx tsx ./dico-check.mts /path/to/Your.model.yaml
   rm -f ./dico-check.mts
   ```
   Note: YAML parses unquoted ISO timestamps to JS `Date`, so `createdAt`/`updatedAt` may report
   `is not of a type(s) string` — that's a parse artifact, not a file error.

Never commit or push unless asked.
