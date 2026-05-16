# Spec — #165b: sample data migration to schema-entity format

## Goal

Migrate the seven legacy stereotype entries in `samples/eshop/.dico/stereotypes.yaml` into seven individual schema-entity YAML files under `samples/eshop/.dico/schemas/*.entity.yaml`, each tagged `stereotype: 'metadata-schema'`. After this ticket, the eshop sample's `.dico/stereotypes.yaml` is empty (`[]`) — all stereotype definitions live as schema-entities and round-trip through the `toLegacyStereotypeView` view installed in #165a.

The HTTP API (`GET /api/stereotypes`, `GET /api/stereotypes/:id`, `POST/PUT/DELETE`) must remain byte-identical to current main for the eshop sample. Two issues discovered while reading the #165a code force the spec to extend (not just consume) the existing view:

1. **`Stereotype.id` is a slug, not a UUID, in pre-#165a data.** Legacy entries use ids like `'pii'`, `'aggregate-root'`, `'event'`. The current `toLegacyStereotypeView` (`backend/src/services/schemaEntityView.ts:157`) maps `Entity.uuid → Stereotype.id`, which would change the id format from `'pii'` to `'a1b2c3d4-...'` post-migration. `aiController.ts:462-463` and `serviceService.getStereotype(entity.stereotype)` both treat `Stereotype.id` as a stable slug. Byte-identical HTTP requires the view to preserve the slug semantics — `Stereotype.id = entity.name` (where `entity.name` carries the slug), with the entity uuid retained separately and not surfaced through the legacy `Stereotype` shape.
2. **`Stereotype.name` is a display name, separate from `id`.** Legacy `{id: pii, name: PII}`, `{id: aggregate-root, name: Aggregate Root}`. The current view maps `Entity.name → Stereotype.name`, which works only if we store the slug as `Entity.name` and the display name elsewhere. Decision: store the display name as a metadata entry `{name: 'displayName', value: 'PII'}` on the schema-entity. The view extension reads it back. When absent, falls back to `Entity.name` (so newly authored schema-entities don't need to set `displayName` if slug = display name).

Per the ticket: "the backend's `stereotypeService.getAllStereotypes()` continues returning identical Stereotype shapes ... HTTP API byte-identical."

The migration is done by hand-authored YAML files committed to git (no migration script). This matches CLAUDE.md's content-driven loader posture and keeps the diff reviewable. `MetadataDefinition` is kept as a TS alias of the view shape — option (b) from the ticket's design decision B, with rationale below.

## Files touched

### Sample data (created)
- `samples/eshop/.dico/schemas/aggregate-root.entity.yaml` — new. One schema-entity for the legacy `aggregate-root` stereotype.
- `samples/eshop/.dico/schemas/value-object.entity.yaml` — new. Legacy `value-object`.
- `samples/eshop/.dico/schemas/event.entity.yaml` — new. Legacy `event` (display name `Domain Event`).
- `samples/eshop/.dico/schemas/reference-data.entity.yaml` — new. Legacy `reference-data`.
- `samples/eshop/.dico/schemas/pii.entity.yaml` — new. Legacy `pii` (display name `PII`).
- `samples/eshop/.dico/schemas/indexed.entity.yaml` — new. Legacy `indexed`.
- `samples/eshop/.dico/schemas/deprecated.entity.yaml` — new. Legacy `deprecated`.

### Sample data (modified)
- `samples/eshop/.dico/stereotypes.yaml` — emptied to `[]\n`. NOT deleted. Per the ticket's section C: "the file can be empty or deleted. Decide and document." Decision: empty, not deleted. Rationale: (a) the loader at `backend/src/routes/project.routes.ts:135-138` writes `[]` to a freshly-created project, so the empty file is the documented zero-state; (b) downstream projects that haven't migrated continue using the legacy loader, so deleting it in eshop while keeping the code path encourages parity testing.

### Backend (modified — view extension)
- `backend/src/services/schemaEntityView.ts` — extended. `toLegacyStereotypeView` now reads:
  - `Stereotype.id` from `entity.name` (the slug — preserves pre-#165a HTTP shape)
  - `Stereotype.name` from `entity.metadata['displayName']` if present, else `entity.name`
  - existing mapping of attributes and metadata kept intact
  
  `fromLegacyStereotypeView` updated symmetrically — the synthesised entity gets `name = stereotype.id` (the slug) and a `displayName` metadata entry if `stereotype.name !== stereotype.id`. The uuid is generated fresh (legacy ids are not UUIDs).

### Backend (modified — type alias)
- `backend/src/models/EntitySchema.ts` — `MetadataDefinition` becomes a documented TS alias of `Attribute` with a `@deprecated` JSDoc tag pointing at `Attribute`. Option (b) from ticket section B. Rationale below under "Design decision B." Fields retained on the alias for type-system compatibility with existing consumers (`exportService.metadataEntryToMarkdown`, `MetadataTypeRegistry`, `builtinContributions`); the alias is widened, not narrowed, so callers compile unchanged.
- `backend/src/services/schemaEntityView.ts` — `definitionFromAttribute` and `attributeFromDefinition` survive as identity-ish helpers (they still exist; #165c will collapse callers). One comment update noting the alias status.

### Backend (write path for `.dico/schemas/`)
- `backend/src/services/stereotypeService.ts` — extended. `createStereotype()`, `updateStereotype()`, `deleteStereotype()` gain a code path that writes to `.dico/schemas/<slug>.entity.yaml` instead of `.dico/stereotypes.yaml` **when the eshop sample's legacy YAML is empty AND `.dico/schemas/` contains user-authored entities**. The write-conflict guard from #165a inverts: if the id matches an existing schema-entity, the write goes to that schema-entity file; if it matches a legacy YAML entry, the write goes to the legacy YAML. New stereotypes prefer the schema-entity path when `.dico/schemas/` is the only populated source.

  Concrete trigger: `private async preferSchemaEntityWrite(): Promise<boolean>` — returns `true` when `readLegacyStereotypes()` returns `[]` AND `schemaEntityService.list()` returns at least one user-authored entity. In the eshop sample post-migration, this is `true`; the eshop sample is the demonstration. Downstream projects unaffected.

- `backend/src/services/schemaEntityWriter.ts` — new. Pure file-write helper isolated from `stereotypeService` for testability:
  - `writeSchemaEntity(entity: Entity): Promise<void>` — writes to `.dico/schemas/<slug>.entity.yaml` using the existing `parseSections` round-trip shape (multi-kind YAML wrapper).
  - `deleteSchemaEntity(slug: string): Promise<boolean>` — removes the file, returns `false` if missing.

### Backend (tests created)
- `backend/src/services/__tests__/stereotypeService.165b.test.ts` — new. Verifies HTTP byte-identity, write-path routing, view round-trip on real eshop fixtures.
- `backend/src/services/__tests__/schemaEntityView.165b.test.ts` — new. Asserts the slug-vs-display-name extension. (The existing `schemaEntityView.test.ts` from #165a continues to pass after the view extension — verify it does, do not delete.)

### Backend (tests modified)
- `backend/src/services/__tests__/schemaEntityView.test.ts` — update tests that asserted `Stereotype.id === Entity.uuid`. After the extension, `Stereotype.id === Entity.name`. The round-trip tests on lines 268-300 need symmetric updates. The view's mapping comment block (lines 137-155 of `schemaEntityView.ts`) also needs to reflect the new mapping.

### Docs (modified)
- `CLAUDE.md` — update the "Data model" stanza on stereotypes. The current sentence "Stored in `<project-root>/.dico/stereotypes.yaml`" gains: "or as schema-entities under `.dico/schemas/<slug>.entity.yaml` (#165). In the eshop sample, the schema-entity form is canonical and the legacy YAML is empty." No semantic shifts to the trinity-of-concepts (#85) or multi-kind YAML (#106) sections.

## Public surface (signatures)

```ts
// backend/src/services/schemaEntityView.ts (extended)

import type { Entity, Attribute, MetadataEntry, Stereotype, StereotypeTarget } from '../models/EntitySchema.js';

/**
 * Convert a schema-entity to the legacy `Stereotype` view shape (#165b update).
 *
 * Mapping (changed in #165b — was uuid→id, name→name in #165a):
 *   Entity.name                       → Stereotype.id          (slug — preserves pre-#165a HTTP shape)
 *   metadata['displayName'].value     → Stereotype.name        (display name, falls back to Entity.name)
 *   Entity.description                → Stereotype.description
 *   metadata['domain'].value          → Stereotype.domain
 *   metadata['appliesTo'].value       → Stereotype.appliesTo   (default 'entity')
 *   Entity.attributes[]               → Stereotype.metadataDefinitions[]
 *
 * Entity.uuid is NOT surfaced through the Stereotype view — it is internal
 * to the schema-entity model. Consumers that want the uuid use
 * `schemaEntityService.findByName(slug)` directly.
 *
 * Constraints[] still dropped silently with a logged warning (#85, unchanged).
 */
export function toLegacyStereotypeView(schemaEntity: Entity): Stereotype;

/**
 * Inverse mapping (#165b update).
 *
 * Mapping:
 *   stereotype.id                     → Entity.name            (slug becomes the entity name)
 *   stereotype.name (if !== id)       → metadata['displayName']
 *   stereotype.description            → Entity.description
 *   stereotype.domain                 → metadata['domain']
 *   stereotype.appliesTo              → metadata['appliesTo']
 *   stereotype.metadataDefinitions[]  → Entity.attributes[]
 *
 * UUID handling:
 *   - Always generates a fresh UUID via generateUUID(). Legacy ids are slugs,
 *     not UUIDs (verified at samples/eshop/.dico/stereotypes.yaml — all 7
 *     ids are kebab-case slugs).
 *
 * The synthesised entity gets `stereotype: 'metadata-schema'` set so it is
 * recognised on the next load.
 */
export function fromLegacyStereotypeView(stereotype: Stereotype): Entity;

// definitionFromAttribute, attributeFromDefinition unchanged.
```

```ts
// backend/src/services/schemaEntityWriter.ts (new)

import type { Entity } from '../models/EntitySchema.js';

/**
 * Write a schema-entity to `.dico/schemas/<slug>.entity.yaml`.
 *
 * Slug derivation: `entity.name` (already a slug by convention — no
 * sanitization needed beyond the existing `sanitizeFsName` in
 * `backend/src/utils/uuid.ts`).
 *
 * Multi-kind YAML format (#106):
 *   entities:
 *     - <serialized entity>
 *
 * Throws on collision: if a file with that slug already exists AND its
 * entity has a different uuid, the call fails with a clear error. Callers
 * (stereotypeService.createStereotype) check existence first and call
 * delete+write for updates.
 */
export async function writeSchemaEntity(entity: Entity): Promise<void>;

/**
 * Delete the schema-entity file. Returns `false` if the file does not exist.
 * Used by `stereotypeService.deleteStereotype` when the id matches a
 * schema-entity.
 */
export async function deleteSchemaEntity(slug: string): Promise<boolean>;
```

```ts
// backend/src/services/stereotypeService.ts (write-path routing)

class StereotypeService {
  // existing methods unchanged in signature

  /**
   * Route write operations: prefer schema-entity writes when the legacy
   * YAML is empty AND the schema package has user-authored entities.
   * Inverts the #165a write-conflict guard for projects that have migrated.
   *
   * Returns true → writes go to .dico/schemas/<slug>.entity.yaml
   * Returns false → writes go to .dico/stereotypes.yaml (legacy code path)
   */
  private async preferSchemaEntityWrite(): Promise<boolean>;

  /**
   * #165b: when preferSchemaEntityWrite() returns true, this path runs.
   * Calls fromLegacyStereotypeView, then writeSchemaEntity.
   * Unchanged from caller perspective — same return shape.
   */
  async createStereotype(data: Stereotype): Promise<{ success: boolean; stereotype?: Stereotype; errors?: string[] }>;
  async updateStereotype(id: string, data: Partial<Stereotype>): Promise<{ success: boolean; stereotype?: Stereotype; errors?: string[] }>;
  async deleteStereotype(id: string): Promise<{ success: boolean; errors?: string[] }>;
}
```

```ts
// backend/src/models/EntitySchema.ts (alias added, type retained)

/**
 * A metadata definition (schema for metadata entries).
 *
 * @deprecated #165b — prefer `Attribute`. `MetadataDefinition` is now a
 * documented alias of the same shape: the four extension fields
 * (fields, items, enum, required, description) overlap one-to-one with
 * Attribute's (properties, items, validation.enumValues, required,
 * description). The alias is retained as a TS type for consumers in
 * `exportService`, `MetadataTypeRegistry`, and `builtinContributions`
 * that still consume the `MetadataDefinition` name. New code MUST use
 * `Attribute`. The alias will be deleted in a follow-up ticket once
 * #165c lands and the frontend has converged.
 */
export interface MetadataDefinition {
  name: string;
  type: string;
  description?: string;
  required?: boolean;
  fields?: MetadataDefinition[];
  items?: MetadataDefinition;
  enum?: Array<string | number | { value: string | number; label: string }>;
}
```

### Eshop schema-entity YAML shape (concrete example for `pii.entity.yaml`)

```yaml
entities:
  - uuid: <freshly-generated UUID v4 — committed once, stable thereafter>
    name: pii
    description: Personally Identifiable Information
    stereotype: metadata-schema
    metadata:
      - name: displayName
        value: PII
      - name: domain
        value: Privacy
      - name: appliesTo
        value: attribute
    attributes:
      - uuid: <generated>
        name: pii-category
        description: "Category: direct, indirect, or sensitive"
        type: string
        required: true
      - uuid: <generated>
        name: retention-days
        description: Data retention period in days
        type: number
        required: false
      - uuid: <generated>
        name: encryption-required
        description: Whether this field must be encrypted at rest
        type: flag
        required: false
```

All seven schema-entity files follow this shape. UUIDs are generated once at migration time, committed to git, and remain stable. The slug (`name` field) is the load-bearing identity for the legacy `Stereotype.id` view.

## Framework APIs used

None. #165b is pure YAML data migration + backend write-path routing. No `@hamak/*` API changes. The multi-kind YAML loader at `backend/src/utils/fileOperations.ts:230` (`parseSectionsFromString`) and the schema-package loader added in #165a (`loadSchemaPackage`, line 517) continue to work unchanged.

## Acceptance criteria

1. **All seven schema-entity files exist.** A test enumerates `samples/eshop/.dico/schemas/*.entity.yaml` (excluding `_meta/`) and asserts the set of filenames equals exactly:
   ```
   aggregate-root.entity.yaml, value-object.entity.yaml, event.entity.yaml,
   reference-data.entity.yaml, pii.entity.yaml, indexed.entity.yaml,
   deprecated.entity.yaml
   ```

2. **Each file parses as a valid multi-kind YAML with exactly one entity.** Test calls `parseSectionsFromString` on each file's contents, asserts `sections.entities.length === 1`, `entities[0].stereotype === 'metadata-schema'`, `entities[0].name` is a non-empty kebab-case slug, `entities[0].uuid` matches the UUID regex, `entities[0].attributes` is a (possibly empty) array.

3. **Legacy file is empty.** `samples/eshop/.dico/stereotypes.yaml` contents equal `"[]\n"`. Asserted by exact file-content check.

4. **`getAllStereotypes()` byte-identical to pre-#165b for eshop.** A snapshot test against the eshop sample captures the JSON of `GET /api/stereotypes` pre-migration and compares it to post-migration output. The two must be deep-equal (same set of `{id, name, description, domain, appliesTo, metadataDefinitions}` objects, same ordering — verified by Stereotype.id sort key). Concretely:
   - All 7 ids present: `aggregate-root`, `value-object`, `event`, `reference-data`, `pii`, `indexed`, `deprecated`.
   - Each id's `name`, `description`, `appliesTo`, `domain` matches the legacy YAML byte-for-byte.
   - Each id's `metadataDefinitions[]` has the same length, same `{name, type, required, description}` per element, in the same order, as the pre-#165b legacy YAML.

5. **`getStereotype('pii')` returns the migrated PII stereotype.** Specifically `{ id: 'pii', name: 'PII', domain: 'Privacy', appliesTo: 'attribute', metadataDefinitions: [...] }`. Asserts the slug-vs-display split in the view extension works.

6. **`schemaEntityService.list()` returns 7 entities on the eshop sample.** Each entity has `stereotype === 'metadata-schema'`, `uuid` matches the regex, `name` is one of the seven slugs. The marker is filtered (per #165a criterion 3).

7. **`schemaEntityService.findByName('pii')` returns the pii schema-entity.** Cross-validates the slug-as-name design — schema-entity name MUST equal the legacy stereotype id.

8. **View round-trip preserves slug identity.** Test: load `pii.entity.yaml`, run `toLegacyStereotypeView` → `fromLegacyStereotypeView`; resulting entity's `name` is `'pii'`, `metadata['displayName']` is `'PII'`. UUID is regenerated (round-trip is not required to preserve uuid since the inverse path is a migration tool).

9. **Write path routes to schemas/ on eshop.** Integration test: against the migrated eshop fixture, call `stereotypeService.createStereotype({id: 'audit-log', name: 'Audit Log', appliesTo: 'entity', metadataDefinitions: []})`. Assert (a) `samples/eshop/.dico/schemas/audit-log.entity.yaml` is created; (b) `samples/eshop/.dico/stereotypes.yaml` remains `[]`; (c) `getStereotype('audit-log')` returns the created stereotype. Clean up the test artefact after.

10. **Write path routes to legacy YAML on a project without `.dico/schemas/`.** Integration test against a temp data dir with only `.dico/stereotypes.yaml` (no `schemas/` folder). Calling `createStereotype` writes to `stereotypes.yaml`. Verifies the route-decision logic doesn't accidentally break downstream projects.

11. **`MetadataDefinition` alias compiles.** `tsc --noEmit` against `backend/src/` passes with zero errors. All existing `MetadataDefinition` consumers (`exportService.ts:174`, `MetadataTypeRegistry.ts:42,48,50,62,70,97,114`, `builtinContributions.ts` lines listed in the grep) compile unchanged. No `// @ts-expect-error` introduced.

12. **No frontend file changes.** `git diff main -- frontend/` returns no output after #165b lands. The frontend `StereotypeService` (Pattern A facade from #166) continues consuming the REST endpoint shape.

13. **Three-concept governance preserved (#85).** None of the seven migrated schema-entities carry `constraints[]`. Each `metadataDefinitions` array preserved as-is — no auto-synthesis from validation fields, no fabrication of `Rule` entries. Tested by asserting `result.constraints === undefined` per schema-entity.

14. **Multi-kind YAML semantics preserved (#106).** All seven migrated files parse through the same `parseSectionsFromString` as ordinary entities. Loading them via `loadSchemaPackage()` produces a `PackageModel` with exactly 8 entities (7 schema-entities + 1 bootstrap marker). Identifier-collision detection works within the schema package (already verified by #165a).

15. **HTTP API response shape unchanged.** `GET /api/stereotypes` response keys are exactly `{message, data}` with `data` an array of `Stereotype` objects (`{id, name, description?, domain?, appliesTo, metadataDefinitions}`). Verified by a JSON-shape assertion that lists the allowed keys per stereotype.

## Out of scope

- **Frontend changes.** `MetadataTypeRegistry` collapse, `AttributeEditor` unification, `StereotypeForm` rewrite — all in #165c.
- **`MetadataDefinition` removal.** The alias survives; deletion is a follow-up after #165c.
- **`MetadataValue` widening from #164.** Already in place; no changes.
- **`schemaEntityService` removal.** Survives and is the canonical reader.
- **The bootstrap marker.** Already exists from #165a; not touched.
- **Migration for projects other than eshop sample.** Downstream consumers continue using the legacy loader. They migrate at their own pace via a future ticket (not specified here).
- **Deleting the legacy loader path.** `readLegacyStereotypes()` survives. Future ticket can deprecate.
- **`Entity.stereotype: uuid` semantics.** Today entities reference stereotypes by slug name (`entity.stereotype = 'pii'`). The schema-entity model would naturally use uuids, but changing entity refs is out of scope — `getStereotype(name)` continues to match by `Stereotype.id`, which equals the slug post-extension.

## Dependencies

- **Blocked by #165a** (merged in `e29147a`). Builds directly on the read-compat backend and the bootstrap marker.
- **Coordinates with #165c** (not yet started). Frontend `MetadataTypeRegistry` collapse will follow #165b. The `MetadataDefinition` alias is the seam.
- **Coordinates with #164** (merged in `e1cd826`). The widened `MetadataValue` and the `MetadataTypeRegistry` survive unchanged. The alias for `MetadataDefinition` retains the post-#164 extension fields (fields, items, enum).
- **Independent of #106.** The multi-kind YAML loader is reused unmodified.
- **Independent of #166.** Frontend `StereotypeService` Pattern A facade consumes the unchanged REST endpoint.

## Risks

1. **The schema-entity uuid is not stable across the migration commit.** Generated by `randomUUID()` at authoring time; committed once; never changes. Risk: if the migration is re-run by a developer hand-editing files, uuids will differ between branches. Mitigation: the migration is one-time and the UUIDs are committed to git. Document this in `CLAUDE.md`'s data-model stanza. No deterministic UUID helper exists in `backend/src/utils/uuid.ts`; introducing one is out of scope.

2. **Snapshot drift on the byte-identity criterion (#4).** YAML round-trip via `YAML.stringify` followed by JSON serialization may produce subtly different field ordering than the legacy `YAML.parse` output. The legacy code reads YAML and passes it directly to `res.json()` — field order comes from YAML's parse, which is insertion order. Mitigation: `toLegacyStereotypeView` emits fields in the exact same order as the legacy YAML (id, name, description, domain, appliesTo, metadataDefinitions). Verified by a deep-equal assertion, not a string-compare snapshot.

3. **Display-name extension introduces a new metadata key.** `displayName` is a new well-known metadata entry on schema-entities. Risk: collision with user-authored entities that already have a `displayName` metadata for an unrelated purpose. Mitigation: the key is scoped to schema-entities only (filtered by `stereotype === 'metadata-schema'` in `schemaEntityService.list()`); ordinary entities are unaffected. Document the reserved key in `CLAUDE.md`.

4. **Write-path routing has split-brain potential.** If the eshop sample's `stereotypes.yaml` is accidentally repopulated (e.g. a downstream migration tool runs in error), `preferSchemaEntityWrite()` flips to `false` and new writes go to the legacy file. Mitigation: log an info-level message on every write indicating which path was taken; tests #9 and #10 cover both routes. No automated guard — this is a steward-visible signal.

5. **`MetadataDefinition` alias hides the divergence between the two shapes.** Today `MetadataDefinition.fields[]` is a recursive `MetadataDefinition[]`, while `Attribute.properties[]` is `Attribute[]`. Tracking the structural overlap as a TS alias is correct, but a future change to `Attribute` (e.g. adding `metadata` to a property's inner `Attribute`) silently widens `MetadataDefinition` consumers. Mitigation: alias is `@deprecated`; #165c collapses it. Until then, accept the risk — the alternative (keep two parallel types) prolongs the convergence.

## Cycle-1 notes for the writer

- The byte-identity criterion (#4) is the load-bearing one. Implementers should snapshot the legacy `GET /api/stereotypes` output before migration as a fixture (`backend/src/services/__tests__/__fixtures__/stereotypes-pre-165b.json`) and assert exact equality on post-migration HTTP output.
- Schema-entity UUIDs MUST be generated once and committed. If the implementer regenerates them between PR revisions, the diff will look like noise. Generate once, lock in.
- The `aiController.ts:333` system prompt embeds the legacy stereotype slugs verbatim ("aggregate-root, reference-data, event, value-object"). The migration must preserve those slugs as `Entity.name`. Test #5 covers `pii` specifically; the implementer should add parallel asserts for `aggregate-root` and `event` to cover the slugs the AI prompt depends on.

