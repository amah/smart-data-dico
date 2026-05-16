# Spec — #165: unify Stereotype with Entity (metadata schemas as schema-entities)

## Scope escalation (read this first)

**The ticket as scoped is too big for a single PR.** The plan touches the
backend data model, backend service rewrite (`stereotypeService.ts`), the
backend metadata-type registry (#164, just merged in `e1cd826`), the entity
loader (`fileOperations.ts`), 5 frontend React components / pages, the
frontend metadata registry (#164), a Pattern A service (`StereotypeService`
landed via #166), and a sample-data migration. Done in one ticket this is
roughly 12 files at the type-system surface, ~9 files at the service layer,
and ~6 UI files, plus a migration script and round-trip tests. Calibration
rules ("narrow regexes, framework `.js` runtime read") and the project's
recent pilot findings argue for phased delivery.

**Recommendation: split into three follow-up tickets, all under the #165
umbrella.** The phasing the ticket body itself proposes (Phase 1..8) clusters
naturally into three safe-to-ship slices:

- **#165a — Bootstrap + read-compat (Phases 1–3 + parts of 7).** Introduce
  the `metadata-schema` marker entity and the `.dico/schemas/` package.
  Teach the YAML loader to recognise schema-entities. Rewrite
  `backend/src/services/stereotypeService.ts` as a view over
  `entityService.findByStereotype('metadata-schema')`. Keep
  `.dico/stereotypes.yaml` working as a read-only fallback. **No UI
  changes, no API shape change, no migration of sample data.** The legacy
  HTTP endpoints (`GET /api/stereotypes`) keep returning the legacy
  `Stereotype` shape via a synthesised view. Outcome: the backend has two
  loaders, the new one is canonical, the old one is a fallback.

- **#165b — Sample migration + `MetadataDefinition` removal (Phases 4 +
  6).** Run the migration script against the eshop sample. Delete
  `.dico/stereotypes.yaml`. Replace `MetadataDefinition` use sites with
  `Attribute` use sites in backend services (validation pipeline, export,
  quality). Migrate the eshop sample data. Frontend still consumes the
  legacy API shape — adapter inside `StereotypeService.ts` (frontend
  Pattern A facade from #166) converts schema-entity ↔ `Stereotype` view.

- **#165c — Frontend registry collapse + editor unification (Phases 5 +
  6 frontend).** Collapse `MetadataTypeRegistry` (#164) into the attribute-
  type rendering layer. `StereotypeForm`, `MetadataEditor`,
  `InlineMetadataCell`, `StereotypesPage` rewritten to read schema-entities
  directly. `MetadataDefinition` removed from `frontend/src/types`.

If the user accepts the split, **this spec defines #165a only** — the
remaining slices get their own specs once #165a is merged. The rest of this
document is the #165a contract.

If the user rejects the split and wants one ticket, surface back: a one-PR
implementation per the eight-phase plan is achievable but exceeds the
~700-line/~12-file PR norm by roughly 4×. Risk is high that one of the
five trinity-of-concepts boundaries (#85), the multi-kind YAML loader
(#106), or the #164 registry will be quietly bent during the work.

---

## Goal (for #165a)

Introduce the `metadata-schema` bootstrap marker entity and a new
`.dico/schemas/` package. Teach the backend loader to recognise any entity
tagged `stereotype: metadata-schema` as a **schema-entity** — a stereotype
definition expressed in the `Entity`/`Attribute` model. Rewrite
`stereotypeService.ts` to view schema-entities as the authoritative
stereotype source, with `.dico/stereotypes.yaml` retained as a read-only
fallback during the migration window. No UI changes, no sample-data
migration, no removal of `MetadataDefinition`/`MetadataValueType`. The
HTTP API (`GET /api/stereotypes`, etc.) returns identical responses
byte-for-byte to current main during the window — the rewrite is
behavior-preserving from any client's point of view. From the ticket:
"Public API endpoints (`GET /api/stereotypes`, etc.) keep returning the
legacy `Stereotype` shape during the migration window — clients don't
break."

## Files touched

### Backend (created)
- `backend/src/services/schemaEntityService.ts` — new. Loads schema-entities from `.dico/schemas/`. The single place that knows where schema-entities live and how to enumerate them. Decoupled from `stereotypeService.ts` so the next slice (#165b) can swap in additional sources without rewriting the consumer.
- `backend/src/services/schemaEntityView.ts` — new. Pure functions converting a schema-entity (`Entity`) to/from the legacy `Stereotype` shape. Reused by `stereotypeService.ts` and (eventually) the migration script.
- `backend/src/services/__tests__/schemaEntityView.test.ts` — new. Round-trip + corner cases on the view conversion.
- `backend/src/services/__tests__/stereotypeService.165a.test.ts` — new. Verifies the merged-source loader returns schemas from both `.dico/schemas/` and `.dico/stereotypes.yaml`, with collision detection.

### Backend (modified)
- `backend/src/services/stereotypeService.ts` — rewritten. `readStereotypes()` now merges schema-entities (via `schemaEntityService.list()`) with legacy entries from `.dico/stereotypes.yaml`. Writes still go to `.dico/stereotypes.yaml` (writes-to-`.dico/schemas/` is deferred to #165b). `validateMetadata` unchanged — still delegates to `metadataTypeRegistry.validateBlock` (#164).
- `backend/src/utils/fileOperations.ts` — extended. New exported helpers `listSchemaPackages()`, `loadSchemaPackage(name)` that allow `.dico/schemas/` to be treated as a package by the multi-kind loader, despite living under `.dico/`. `RESERVED_DIRS` keeps `.dico` excluded from the normal `listPackages()` so we don't accidentally expose schema-entities as ordinary entities.
- `backend/src/models/EntitySchema.ts` — comment-only edits. Add a JSDoc paragraph on `Entity.stereotype` noting the special value `'metadata-schema'`. No type changes.

### Sample data (created)
- `samples/eshop/.dico/schemas/package.yaml` — `name: .dico/schemas`. Marks the directory as a loadable package (the loader requires `package.yaml`).
- `samples/eshop/.dico/schemas/_meta/metadata-schema.entity.yaml` — the bootstrap marker. Single entity, no attributes, `stereotype` field absent (the marker is its own definition).

### Docs (modified)
- `CLAUDE.md` — append a paragraph under "Data model" describing schema-entities and the bootstrap marker. Explicitly preserve the existing "Stereotypes are stored in `.dico/stereotypes.yaml`" sentence; add "or as schema-entities under `.dico/schemas/`" as the alternative.
- `docs/adr/0002-stereotype-as-entity.md` — new. Captures the rationale for the convergence: why one model is better than two, why the marker bootstraps the regress, why phasing matters.

### Out (for #165a only — moved to #165b or #165c)
- `frontend/**` — no changes in #165a.
- `backend/src/services/exportService.ts`, `qualityService.ts`, `serviceService.ts` — keep consuming the `Stereotype` shape via `stereotypeService.getStereotype()` unchanged. The view layer makes this transparent.
- `scripts/migrate-stereotypes-to-schemas.js` — moved to #165b.

## Public surface (signatures)

```ts
// backend/src/services/schemaEntityService.ts

import type { Entity } from '../models/EntitySchema.js';

/**
 * The reserved name of the bootstrap marker entity. Any entity whose
 * `stereotype` field equals this string is interpreted as a schema-entity
 * (i.e. a stereotype definition).
 *
 * Built-in: `samples/eshop/.dico/schemas/_meta/metadata-schema.entity.yaml`
 * defines the marker itself. The marker has no attributes — bootstraps
 * the regress.
 */
export const METADATA_SCHEMA_MARKER: 'metadata-schema';

/**
 * Reserved UUID for the metadata-schema marker entity. Stable across
 * projects; referenced by deployments that want to ship custom schema-
 * entities pre-populated.
 */
export const METADATA_SCHEMA_MARKER_UUID: '00000000-0000-1000-8000-000000000001';

/**
 * Service that loads schema-entities from `.dico/schemas/`. Read-only in
 * #165a — writes still go through `stereotypeService.ts` to
 * `.dico/stereotypes.yaml`.
 */
export class SchemaEntityService {
  /**
   * Return all entities tagged with `stereotype: 'metadata-schema'`
   * loaded from the `.dico/schemas/` package. Does NOT consult
   * `.dico/stereotypes.yaml` — that's `stereotypeService`'s job.
   *
   * Returns an empty array if `.dico/schemas/` does not exist.
   * Logs a warning and returns `[]` if `.dico/schemas/package.yaml`
   * is missing (the package is not loadable).
   */
  list(): Promise<Entity[]>;

  /**
   * Return the marker entity if present, otherwise `null`. Used by
   * loader code that needs to confirm the bootstrap is wired before
   * treating any entity as a schema-entity.
   */
  getMarker(): Promise<Entity | null>;

  /**
   * Lookup by name (the `Entity.name` field — equivalent to the legacy
   * `Stereotype.id` for migration purposes).
   */
  findByName(name: string): Promise<Entity | null>;

  /**
   * Lookup by uuid.
   */
  findByUuid(uuid: string): Promise<Entity | null>;
}

export const schemaEntityService: SchemaEntityService;
```

```ts
// backend/src/services/schemaEntityView.ts

import type { Entity } from '../models/EntitySchema.js';
import type { Stereotype, MetadataDefinition, StereotypeTarget } from '../models/EntitySchema.js';

/**
 * Convert a schema-entity to the legacy `Stereotype` view shape. The
 * conversion is total — every schema-entity that passes the marker test
 * produces a valid `Stereotype`. Where information would be lost
 * (e.g. nested `Attribute.properties`), it is folded into the
 * `MetadataDefinition.fields` shape from #164.
 *
 * Mapping:
 *   Entity.uuid               → Stereotype.id (string form)
 *   Entity.name               → Stereotype.name
 *   Entity.description        → Stereotype.description
 *   metadata['domain'].value  → Stereotype.domain      (string)
 *   metadata['appliesTo'].v   → Stereotype.appliesTo   (StereotypeTarget)
 *   Entity.attributes[]       → Stereotype.metadataDefinitions[]
 *     attr.name               → def.name
 *     attr.type               → def.type
 *     attr.description        → def.description
 *     attr.required           → def.required
 *     attr.properties[]       → def.fields[]    (recursive, same mapping)
 *     attr.items              → def.items       (recursive, same mapping)
 *     attr.validation.enumVal → def.enum        (string-only enum)
 *
 * `appliesTo` defaults to `'entity'` if not present on the schema-entity's
 * metadata block, matching the most common case.
 */
export function toLegacyStereotypeView(schemaEntity: Entity): Stereotype;

/**
 * Inverse mapping — used by #165b for the migration script and by the
 * #165b writer when stereotypes are persisted as schema-entities. Kept
 * here in #165a so the converter is tested as a pair.
 *
 * The inverse loses no information when the input is a legacy
 * `Stereotype` (which is structurally a strict subset of `Entity`).
 * Generates a new UUID for the synthesised entity if `stereotype.id`
 * is not a valid UUID; otherwise reuses `id` as `uuid`.
 */
export function fromLegacyStereotypeView(stereotype: Stereotype): Entity;

/**
 * Recursive helper exported for tests — converts one `Attribute` to one
 * `MetadataDefinition`. Inverse is `attributeFromDefinition`.
 */
export function definitionFromAttribute(attr: Attribute): MetadataDefinition;
export function attributeFromDefinition(def: MetadataDefinition): Attribute;
```

```ts
// backend/src/services/stereotypeService.ts (rewritten)

class StereotypeService {
  /**
   * Returns the merged list of stereotypes — schema-entities loaded from
   * `.dico/schemas/` (converted via `toLegacyStereotypeView`) PLUS legacy
   * entries from `.dico/stereotypes.yaml`. Schema-entities win on
   * conflict (same `Stereotype.id`, where the schema-entity's `Entity.uuid`
   * or `Entity.name` matches a legacy stereotype id); the legacy entry is
   * shadowed and a warning is logged with both file paths so stewards can
   * resolve the duplication.
   *
   * #165a goal: this method's return value is observationally identical
   * to current main, because `.dico/schemas/` is empty (only the marker
   * exists, and the marker is filtered out — see test #4). Once #165b
   * lands and the migration runs, the legacy file disappears and the
   * schema-entity branch becomes authoritative.
   */
  getAllStereotypes(appliesTo?: StereotypeTarget): Promise<Stereotype[]>;
  getStereotype(id: string): Promise<Stereotype | null>;

  /**
   * Create / update / delete: writes ONLY to `.dico/stereotypes.yaml` in
   * #165a. Schema-entity writes are #165b. If `id` matches an existing
   * schema-entity (not a legacy entry), the operation fails with a clear
   * error message pointing the user at the schema-entity YAML file.
   * Rationale: silent split-brain writes (some go to .yaml, some to
   * .dico/schemas/) would be the worst possible #165a regression.
   */
  createStereotype(data: Stereotype): Promise<{ success: boolean; stereotype?: Stereotype; errors?: string[] }>;
  updateStereotype(id: string, data: Partial<Stereotype>): Promise<{ success: boolean; stereotype?: Stereotype; errors?: string[] }>;
  deleteStereotype(id: string): Promise<{ success: boolean; errors?: string[] }>;

  /** Unchanged. Still delegates to `metadataTypeRegistry.validateBlock`. */
  validateMetadata(stereotype: Stereotype, metadata: MetadataEntry[]): MetadataValidationError[];
  /** Unchanged shim. */
  validateMetadataLegacy(stereotype: Stereotype, metadata: MetadataEntry[]): string[];
}
```

```ts
// backend/src/utils/fileOperations.ts (extensions)

/**
 * Load the `.dico/schemas/` directory as a package, bypassing
 * `RESERVED_DIRS` exclusion. Returns the empty package if the directory
 * or its `package.yaml` is missing. Internally delegates to the same
 * `mergePackageSections` pipeline as `loadPackage()` so identifier-
 * collision rules apply identically.
 *
 * The schema package is NEVER returned by `listPackages()` — the
 * frontend doesn't see it as an ordinary package. Only `schemaEntityService`
 * imports this function.
 */
export async function loadSchemaPackage(): Promise<PackageModel>;

/**
 * Resolve the on-disk path for the schema package. Returns
 * `<dataDir>/.dico/schemas`.
 */
export function getSchemaPackagePath(): string;
```

## Framework APIs used

None — #165a is pure backend service surgery + YAML loader extension. No
new `@hamak/*` dependencies. The existing #164 backend registry
(`backend/src/services/metadata/MetadataTypeRegistry.ts`) and the
multi-kind YAML loader infrastructure (`fileOperations.ts`, verified at
line 230 `parseSectionsFromString`, line 311 `mergePackageSections`, line
431 `loadPackage`) are reused.

Existing framework-API touchpoints that #165a does NOT alter:
- `@hamak/ui-store-impl` `StoreFileSystemFacade` — frontend `StereotypeService`
  (Pattern A facade at `frontend/src/plugins/data-dictionary/services/StereotypeService.ts:46`)
  keeps reading `dictionaries/.dico/stereotypes.yaml` unchanged.

## Acceptance criteria

1. **Marker exists.** `samples/eshop/.dico/schemas/_meta/metadata-schema.entity.yaml`
   is present, parses as a valid multi-kind YAML file (one `entities:`
   entry, uuid = `00000000-0000-1000-8000-000000000001`, name = `metadata-schema`,
   attributes = `[]`). A test loads the file via
   `parseSectionsFromString` and asserts `entities.length === 1` and
   `entities[0].name === 'metadata-schema'`.

2. **`.dico/schemas/` is a loadable package.**
   `loadSchemaPackage()` returns a `PackageModel` with the marker entity
   present and no errors. With the marker file missing, the call returns
   a `PackageModel` whose `entities[]` is empty and logs a warning
   containing the substring `metadata-schema`.

3. **The marker filters itself out of consumer views.**
   `schemaEntityService.list()` returns `[]` against the eshop sample
   (only the marker exists). The marker is intentionally excluded — it
   defines its own type and has nothing to contribute as a stereotype.

4. **`getAllStereotypes()` is observationally identical to current main.**
   A Jest snapshot test against the eshop sample asserts the response of
   `GET /api/stereotypes` produces the same JSON before and after the
   rewrite (same 7 stereotypes, same field set, same ordering).

5. **Collision detection works.** A test creates a schema-entity in
   `.dico/schemas/MockStereotype.entity.yaml` with `name: pii` (matches
   the existing legacy `id: pii` from `stereotypes.yaml`). The merged
   loader emits a `logger.warn` containing both file paths AND prefers
   the schema-entity (later versions of the marker take precedence). The
   legacy entry is logged as `shadowed`.

6. **Write-conflict guard.**
   `createStereotype({ id: 'pii', ... })` against a project where `pii`
   exists only as a schema-entity (not in `stereotypes.yaml`) returns
   `{ success: false, errors: ['Stereotype id "pii" is defined as a schema-entity at <path>; edit that file or use #165b write path'] }`. The
   legacy YAML file is NOT touched.

7. **`Entity.stereotype: 'metadata-schema'` is reserved.**
   `validateEntity()` on an `Entity` with `stereotype: 'metadata-schema'`
   passes (the marker self-references). This is a stability check — we
   are NOT teaching `validateEntity` anything new; we're asserting the
   existing validator already accepts the value because `stereotype` is
   typed as `string`.

8. **Three-concept governance preserved (#85).**
   A schema-entity with a non-empty `constraints[]` array logs a warning
   on load (constraints are physical and only meaningful for business
   entities). Test: load a fixture schema-entity with one
   `constraints[]` entry; assert the warning is emitted; assert the
   resulting `Stereotype` view does NOT carry any constraint information
   (it's silently dropped during view conversion — this is the safer
   default than synthesising a fake `MetadataDefinition` for it).

9. **`.dico/stereotypes.yaml` keeps working.** Existing eshop YAML is
   not edited; existing endpoint responses remain stable; no migration
   runs in #165a. Verified by criterion 4.

10. **#106 multi-kind YAML semantics preserved.**
    The schema-entity YAML at `_meta/metadata-schema.entity.yaml`
    parses through the SAME `parseSectionsFromString` function as
    regular entities (line 230 of `fileOperations.ts`). No bespoke
    parser is introduced. Verified by criterion 1 — the test calls
    `parseSectionsFromString` directly, not a new function.

11. **`metadataTypeRegistry` (#164) is untouched.**
    `validateMetadata()` still delegates to
    `metadataTypeRegistry.validateBlock(metadata, defs, stereotypeName)`
    at the same call site. A grep test asserts:
    `grep -r "validateBlock" backend/src/services/stereotypeService.ts`
    finds exactly one match, identical to current main.

12. **No frontend file changes.**
    `git diff main -- frontend/` returns no output after #165a lands.

## Dependencies

- **Coordinates with #164** (merged in `e1cd826`). The backend registry
  at `backend/src/services/metadata/MetadataTypeRegistry.ts` continues
  to own metadata-value validation. #165a does NOT collapse it — that's
  #165c.
- **Coordinates with #166** (merged in `e76374e`). The frontend
  Pattern A `StereotypeService` at
  `frontend/src/plugins/data-dictionary/services/StereotypeService.ts`
  is read-through-Store-FS and writes via REST shim. #165a does not
  touch it — the REST shim still proxies to the rewritten backend
  service, which still returns the legacy `Stereotype` shape.
- **Independent of #106.** Reuses the multi-kind loader; does not change
  it.
- **Blocks #165b** (sample migration, `MetadataDefinition` removal in
  backend) and **#165c** (frontend registry collapse).

## Out of scope

- **No sample-data migration.** `samples/eshop/.dico/stereotypes.yaml`
  stays. The migration script lives in #165b.
- **No `MetadataDefinition` removal.** It's still the canonical
  representation that `stereotypeService.validateMetadata` consumes via
  #164's `metadataTypeRegistry.validateBlock`.
- **No `MetadataValueType` removal.** Already deprecated per `EntitySchema.ts:43-56`. Leave as-is.
- **No frontend changes.** `StereotypesPage`, `StereotypeForm`,
  `MetadataEditor`, `InlineMetadataCell`, frontend
  `MetadataTypeRegistry`, the frontend `StereotypeService` — all unchanged
  in #165a.
- **No `Entity.stereotype` semantic change.** Field stays `string`
  (today it's a name reference; after the full #165 it could be a uuid
  reference, but that's a #165b/c decision).
- **`Stereotype` interface stays.** Not aliased to `Entity` — that's #165c.
- **`StereotypeService` frontend rename.** Stays as-is in #165a.

## Risks

1. **Loader collision.** The reserved `.dico/` dir is excluded from
   `listPackages()` (verified at `fileOperations.ts:21` and `:159`). If
   `loadSchemaPackage()` accidentally piggybacks on the same recursion,
   schema-entities could surface in the entity flat list and corrupt the
   /entities page. Mitigation: `loadSchemaPackage()` opens the directory
   directly via an absolute path and does NOT pass through `listPackages()`
   or `listAllEntities()`. Test #6 asserts `GET /api/entities/flat`
   contains no entity with `stereotype: 'metadata-schema'`.

2. **Collision-error wording.** `mergePackageSections` raises hard errors
   on identifier collisions across files. Within `.dico/schemas/` a
   schema-entity colliding with another schema-entity is fine to error
   on. Across the boundary (schema-entity `pii` vs legacy `pii` in
   `stereotypes.yaml`) we want a *warning*, not an error. Mitigation: the
   cross-boundary check happens in the new `stereotypeService.ts`
   merger, not inside `mergePackageSections`. Each loader owns its own
   collisions; the cross-loader join is permissive with logging.

3. **Marker self-reference.** The marker entity has `name: metadata-schema`
   and ought to be self-defining. Today `Entity.stereotype` is just a
   string; we are not enforcing referential integrity. Risk: a future
   integrity check might flag the marker as referencing a non-existent
   stereotype. Mitigation: the marker's `stereotype` field is OMITTED in
   the YAML (it's an entity that defines a stereotype, not one that uses
   one). The bootstrap regress is solved by treating the marker as a
   well-known special case in `schemaEntityService.getMarker()`.

4. **Snapshot drift on `getAllStereotypes()`.** Criterion 4 requires the
   merged-loader response be byte-identical to current main. With the
   eshop sample having zero schema-entities (only the marker, which is
   filtered) this should hold trivially. Risk: undefined field ordering
   in `Stereotype` view conversion produces stable but different JSON.
   Mitigation: `toLegacyStereotypeView` emits fields in the exact same
   order as the current `stereotypeService.readStereotypes()` output,
   verified by a serialization test.

5. **#106 multi-kind boundary on `.dico/schemas/`.** The loader treats
   any `.yaml` in the package as a multi-kind file. The marker lives at
   `_meta/metadata-schema.entity.yaml` — under a subdirectory. Today's
   `loadPackage()` is *not* recursive (it reads files directly in the
   package folder via `fs.readdirSync`, no descent into subdirs).
   Mitigation: `loadSchemaPackage()` reads two layers — files directly
   under `.dico/schemas/` AND files directly under `.dico/schemas/_meta/`.
   The `_meta/` convention is documented as the home for marker /
   bootstrap entities; user-authored schema-entities live in
   `.dico/schemas/<Name>.entity.yaml`. This is a NEW pattern not covered
   by `frontend/docs/patterns.md`. Flagged.

## Pattern gaps (not covered by `frontend/docs/patterns.md`)

- **Reserved subdirectories under `.dico/`.** The cookbook describes
  package layouts but not the case of a system-owned subdirectory that
  the multi-kind loader is selectively allowed to descend into. Propose
  documenting "Schema package layout" once #165a ships: `.dico/schemas/`
  is a package with a single `_meta/` subdirectory reserved for built-in
  bootstrap entities; user content lives at the top level. Surface back
  via a follow-up cookbook PR.

- **Bootstrap markers for the metamodel.** `metadata-schema` is the
  first metamodel-bootstrap entity in the project. Future work
  (case schemas, rule schemas) may want the same pattern. Cookbook
  should grow a "Bootstrap markers" section once a second example
  appears.
