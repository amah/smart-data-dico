# Spec — #165c: frontend metadata-type registry collapse + per-field renderer unification

## Goal

Delete the frontend `MetadataTypeRegistry` (and its 9 built-in contributions, plus the unknown-type fallback) introduced by #164. Remove `METADATA_TYPE_REGISTRY_TOKEN` from the DI catalog. Stop constructing and providing the registry in `dataDictionaryPlugin.initialize`. Replace the registry-driven rendering paths in `MetadataField` (inside `MetadataEditor.tsx`), `InlineMetadataCell`, and `StereotypeForm` with a single static type-key switch grounded in the standard `AttributeType` enum (plus `flag` and `rule` keys held for back-compat with on-disk YAML and existing stereotypes). After this slice, the frontend has **one** per-field rendering layer (`MetadataField` inside `components/MetadataEditor.tsx`), and the per-field control shape converges on what #165 Phase 5 calls "an attribute-aware control for one metadata field." This ticket does NOT extract a shared component sandwiched between `MetadataField` and `AttributeEditor`; the page-level `AttributeEditor.tsx` is a form/route container, not a per-field renderer, and conflating the two is out of scope (see "Out of scope" and "Risks" — escalation #1).

Quoting the original ticket Phase 5: "The metadata type registry from #164 collapses into the attribute type registry (#107 derived types). One namespace, one set of contributions." #165c executes the **collapse** half; the rendezvous on the derived-types catalog is left for a follow-up because today's `MetadataEditor`/`InlineMetadataCell` callers do not yet consume the `dico.config.json.types[]` catalog (see Risk 3).

## Files touched

### Deleted (entirely)
- `frontend/src/plugins/data-dictionary/metadata/MetadataTypeRegistry.ts` — registry interface + factory.
- `frontend/src/plugins/data-dictionary/metadata/builtinContributions.tsx` — 9 built-in contributions plus the `setMetadataFieldComponent` shim.
- `frontend/src/plugins/data-dictionary/metadata/UnknownTypeEditor.tsx` — fallback contribution.
- `frontend/src/plugins/data-dictionary/metadata/` — the directory itself, after the three files above are removed (it is the only content; verify via `ls`).

### Modified
- `frontend/src/kernel/tokens.ts` — remove `METADATA_TYPE_REGISTRY_TOKEN` export and its JSDoc block (lines 102–116 in current main). No other token is touched.
- `frontend/src/plugins/data-dictionary/dataDictionaryPlugin.ts` — remove the three imports from `./metadata/*` (lines 37–39); remove the construction/seed/provide block for the registry (lines 122–130). Comment update: drop the "#164" note referenced near the block. The plugin's `dependsOn` list is unaffected.
- `frontend/src/types/index.ts` — delete `MetadataTypeContributionCore` and its enclosing block (the comment "MetadataTypeContributionCore mirror (backend parity — #164 Risk 1)" plus the interfaces `MetadataTypeContributionCore`, `JsonSchemaFragment`, `MetadataValidationError`, `MetadataValidationResult`). `MetadataDefinition`, `MetadataEntry`, `MetadataValue`, `MetadataValueType` (already deprecated), `Stereotype`, `StereotypeTarget` are all preserved. **Important**: `MetadataValidationError` is also used by the backend tier (`backend/src/services/metadata/MetadataTypeRegistry.ts:exports`); the frontend deletion is local — backend tier stays untouched per "Out of scope."
- `frontend/src/components/MetadataEditor.tsx` — rewrite `MetadataField` to render per-type controls via a local `switch (definition.type)`. Object/array recursion done directly (recursive `<MetadataField />` call inside the same module — no `setMetadataFieldComponent` shim needed). `MetadataBlock` preserved as-is (the public default export and its props are unchanged). Drop the imports of `METADATA_TYPE_REGISTRY_TOKEN`, `useService`, `MetadataTypeRegistry`, and `setMetadataFieldComponent`. Keep imports of `MetadataValue`, `MetadataDefinition`, `MetadataEntry`, `Stereotype`, `RuleSeverity` from `../types`.
- `frontend/src/components/InlineMetadataCell.tsx` — drop registry imports/use. Replace the registry-driven `Viewer` for non-scalar values with a small inline read-only renderer (object: list of key/value pairs; array: numbered list) lifted from `builtinObjectContribution`/`builtinArrayContribution`. Scalar paths unchanged.
- `frontend/src/components/StereotypeForm.tsx` — drop registry imports/use. Replace `registry.list().filter(...)` with a static `AVAILABLE_TYPES` constant: the 9 keys the registry seeded (`string`, `number`, `boolean`, `date`, `flag`, `rule`, `object`, `array`, `enum`) with human-readable labels. Filter the dropdown by `appliesTo` using nothing (the legacy registry's `appliesTo` field on contributions was always undefined in practice — see Risk 4). Keep the rest of the form unchanged.
- `frontend/src/__tests__/plugin-dependency-graph.test.ts` — remove (a) the import of `METADATA_TYPE_REGISTRY_TOKEN` (line 33) and (b) the `it('data-dictionary → METADATA_TYPE_REGISTRY_TOKEN is non-null', …)` block (lines 229–233). No other tokens in that test file are affected.

### Out of edit
- `frontend/src/hooks/useStereotypeMetadata.ts` — verified clean: zero references to the registry, the deletion has no impact (verified via grep at spec-write time).
- `frontend/src/components/AttributeEditor.tsx` — verified to be a page-level form (`useForm` + `useNavigate` + `servicesApi.updateEntity`), not a per-field renderer. Not in this ticket's scope.
- `frontend/src/components/ui/Field.tsx` — exports a different `MetadataField` (re-exported from `./ui`) that takes `MetadataColumn` (not `MetadataDefinition`) and never used the registry. Verified clean. Out of scope.
- `backend/src/services/metadata/MetadataTypeRegistry.ts`, `backend/src/services/metadata/builtinContributions.ts`, `backend/src/services/metadata/index.ts`, `backend/src/services/exportService.ts`, `backend/src/services/stereotypeService.ts` — all stay. Backend tier is independent of the frontend registry. The ticket prompt confirms this is OOS (see "Key design decisions D"); #165b owns the backend `MetadataDefinition` use-site replacement.

## Public surface (signatures)

```ts
// frontend/src/components/MetadataEditor.tsx — rewritten MetadataField

import type { MetadataValue, MetadataDefinition, MetadataEntry, Stereotype, RuleSeverity } from '../types';

interface MetadataFieldProps {
  value: MetadataValue;
  definition: MetadataDefinition;
  onChange: (next: MetadataValue) => void;
  /** Dotted path from the root entry value — used for nested error keys. */
  path: string;
  readOnly?: boolean;
}

/**
 * Recursive single-field renderer. Dispatches on `definition.type` via a
 * static switch over the 9 known keys (string, number, boolean, date, flag,
 * rule, object, array, enum). Unknown types fall through to a read-only
 * JSON dump with a "unknown type" badge, matching the legacy
 * UnknownTypeEditor behaviour.
 *
 * Object/array recurse back into <MetadataField /> directly (same module —
 * no lazy injection / setMetadataFieldComponent indirection required).
 */
export function MetadataField(props: MetadataFieldProps): JSX.Element;

interface MetadataBlockProps {
  entries: MetadataEntry[];
  stereotype?: Stereotype | null;
  onChange: (entries: MetadataEntry[]) => void;
  readOnly?: boolean;
}

/** Unchanged. Top-level block editor; iterates definitions + entries. */
export function MetadataBlock(props: MetadataBlockProps): JSX.Element;

/** Unchanged default export — preserves all current import sites. */
export default MetadataBlock;
```

```ts
// frontend/src/components/StereotypeForm.tsx — top-of-file additions

/**
 * The fixed type-key catalogue surfaced in the stereotype-form dropdown.
 * Matches the 9 keys the deleted registry seeded (#164). Ordering matches
 * the visual ordering used in builtinContributions.tsx (string → enum).
 *
 * Future extension (post-#165c, e.g. when #107 derived types are exposed
 * here): merge `dico.config.json.types[]` into this list. Out of scope
 * for the registry-collapse slice.
 */
const AVAILABLE_METADATA_TYPES: ReadonlyArray<{ type: string; label: string }> = [
  { type: 'string',  label: 'Text'    },
  { type: 'number',  label: 'Number'  },
  { type: 'boolean', label: 'Boolean' },
  { type: 'date',    label: 'Date'    },
  { type: 'flag',    label: 'Flag'    },
  { type: 'rule',    label: 'Rule'    },
  { type: 'object',  label: 'Object'  },
  { type: 'array',   label: 'Array'   },
  { type: 'enum',    label: 'Enum'    },
];
```

```ts
// frontend/src/components/InlineMetadataCell.tsx — inline read-only renderers

/**
 * Read-only renderer for object-typed metadata values inside the inline
 * table cell. Lifted verbatim (apart from the contribution wrapper) from
 * the deleted `builtinObjectContribution.Viewer`.
 */
function renderObjectInline(value: { [k: string]: MetadataValue }): JSX.Element;

/**
 * Read-only renderer for array-typed metadata values inside the inline
 * table cell. Lifted from the deleted `builtinArrayContribution.Viewer`.
 */
function renderArrayInline(value: MetadataValue[]): JSX.Element;

/**
 * Fallback renderer for unknown metadata `column.type` keys — shows the
 * raw JSON value with a "unknown type: {type}" badge, matching the
 * deleted UnknownTypeContribution.Viewer.
 */
function renderUnknownInline(value: MetadataValue | undefined, columnType: string): JSX.Element;
```

```ts
// frontend/src/kernel/tokens.ts — change

// DELETE these lines (102–116 in current main):
//
// /**
//  * DI token for the MetadataTypeRegistry.
//  * …
//  */
// export const METADATA_TYPE_REGISTRY_TOKEN = Symbol('MetadataTypeRegistry');

// Result: token namespace shrinks by exactly one symbol; surrounding tokens
// (IMPORT_EXPORT_SERVICE_TOKEN, AI_SERVICE_TOKEN, …) keep their JSDoc and
// declarations intact.
```

```ts
// frontend/src/plugins/data-dictionary/dataDictionaryPlugin.ts — change

// DELETE lines 37–39:
//   import { createMetadataTypeRegistry } from './metadata/MetadataTypeRegistry';
//   import { registerBuiltinContributions } from './metadata/builtinContributions';
//   import { UnknownTypeContribution } from './metadata/UnknownTypeEditor';
//
// DELETE METADATA_TYPE_REGISTRY_TOKEN from the kernel/tokens import block
// (lines 13–23) — bare-name removal.
//
// DELETE the registry block (lines 122–130):
//   const metadataRegistry = createMetadataTypeRegistry({ unknownTypeFallback: UnknownTypeContribution });
//   registerBuiltinContributions(metadataRegistry);
//   ctx.provide({ provide: METADATA_TYPE_REGISTRY_TOKEN, useValue: metadataRegistry });
//
// Surrounding code (IntegrityService provide, DiffService provide,
// ImportExportService provide, …) keeps its blank-line separators.
```

## Framework APIs used

None new. The collapse is pure deletion of an internal Pattern-B-registry-variant. The remaining touchpoints that the spec preserves:

- The `data-dictionary` plugin's `initialize` and `activate` hooks (`@hamak/microkernel-spi`'s `PluginModule` shape) keep their existing `ctx.provide` calls for the other 8 tokens (verified at `node_modules/@hamak/microkernel-spi/dist/plugin-module.d.ts:6` for `PluginModule.initialize` and `:7` for `.activate`).
- `useService<T>(TOKEN)` from `frontend/src/kernel/useService.ts` (a project hook, not a framework API) is removed from three call sites (`MetadataEditor.tsx`, `InlineMetadataCell.tsx`, `StereotypeForm.tsx`). The hook itself is untouched.

Framework `.js` runtime read: not required for this ticket — no framework factory / lifecycle / DI mutation introduced or modified. Calibration note from the prompt confirms this.

## Acceptance criteria

1. **Directory deleted.** `ls frontend/src/plugins/data-dictionary/metadata/` returns "No such file or directory." The empty parent directory `frontend/src/plugins/data-dictionary/` still exists and still contains `services/`, `components/`, `pages/`, etc.

2. **Symbol erasure.** `grep -rE "MetadataTypeRegistry|METADATA_TYPE_REGISTRY_TOKEN|builtinContributions|UnknownTypeContribution|MetadataTypeContributionCore|setMetadataFieldComponent" frontend/src/` returns zero matches except inside this ticket's own `attempts.log` / `dev-notes.md` files (if any are added under `.claude/work/165c/`). The dependency-graph test no longer references the token (criterion verified by reading `frontend/src/__tests__/plugin-dependency-graph.test.ts` — both line 33 import and the `it(...)` block at 229 are gone).

3. **Plugin construction.** `frontend/src/plugins/data-dictionary/dataDictionaryPlugin.ts` contains zero matches of `MetadataTypeRegistry`, `METADATA_TYPE_REGISTRY_TOKEN`, or `metadataRegistry` (verified by grep). The other 8 `ctx.provide(...)` blocks remain present; `dependsOn` array in `bootstrap.ts:121` is unchanged.

4. **Renderer parity — scalar.** A `MetadataField` invoked with `definition: { name: 'level', type: 'string' }` and `value: 'public'` renders the same `<input type="text" />` DOM node (same `className="input input-bordered input-sm flex-1"` plus same `disabled`, `placeholder`) as it did via the registry. Same assertion for `type: 'number'`, `type: 'boolean'`, `type: 'date'`, `type: 'flag'`, `type: 'rule'`, `type: 'enum'`. Verified by a new Vitest test that mounts `<MetadataField />` for each scalar `type` and asserts the rendered element's `tagName` + relevant attributes.

5. **Renderer parity — object/array recursion.** A `MetadataField` invoked with `definition: { name: 'classification', type: 'object', fields: [{ name: 'level', type: 'string', required: true }] }` and `value: { level: 'restricted' }` renders one nested `<input type="text" />` for the `level` field. Adding a new value to the array variant produces a new element (length + 1). Verified by new Vitest tests.

6. **InlineMetadataCell non-scalar fallback.** For `column.type = 'object'` with a value `{ a: 1, b: 'x' }`, the cell renders a read-only block containing both keys ("a", "b") and their string values; clicking it (when `onExpand` is provided) calls `onExpand`. For unknown `column.type = 'fizzbuzz'` with a value `{ z: 9 }`, the cell renders the JSON dump with a badge whose text contains the substring `unknown type: fizzbuzz`. No registry dependency is involved.

7. **StereotypeForm dropdown source.** The "type" `<select>` inside a freshly-mounted `<StereotypeForm onSubmit={…} onCancel={…} />` contains exactly 9 `<option>` elements, in the order `string, number, boolean, date, flag, rule, object, array, enum`, with the user-facing labels `Text, Number, Boolean, Date, Flag, Rule, Object, Array, Enum`. The dropdown does NOT consult any DI service.

8. **Three-concept governance preserved (CLAUDE.md / #85).** The `MetadataField` switch case for `type: 'enum'` renders the value chooser without synthesizing a `Rule` or referencing `entity.constraints`; the case for `type: 'rule'` renders a textarea exactly as the deleted `RuleEditor` did. No new `validation`-derived `Rule` synthesis is introduced (the auto-synthesizer deleted in #85 R2 stays deleted). A grep test asserts: `grep -rE "synthesizeRule|fromValidation" frontend/src/` returns zero hits, identical to current main.

9. **Multi-kind YAML invariants preserved (CLAUDE.md / #106).** The `MetadataDefinition` interface in `frontend/src/types/index.ts` keeps its `fields`/`items`/`enum`/`required` shape intact. No YAML write paths are altered. A grep test asserts `MetadataDefinition` is exported exactly once from `frontend/src/types/index.ts` (same as current main).

10. **Plugin dependency-graph test passes.** `npx vitest run frontend/src/__tests__/plugin-dependency-graph.test.ts` runs green. The remaining `it(...)` blocks (for the other 10+ tokens) are untouched.

11. **Baseline.** `npm test --prefix frontend` reports 676 passed / 11 skipped / 0 failed BEFORE adding new tests for this slice, and ≥ 676 passed / 11 skipped / 0 failed AFTER. (Allows new green tests; disallows new failures.)

12. **Build clean.** `npm run build --prefix frontend` exits 0. Type errors from the deletions (e.g. `Cannot find module './metadata/MetadataTypeRegistry'`) must be exhaustively resolved — no `// @ts-ignore` is permitted.

13. **CLAUDE.md / Pattern B sanctity.** `frontend/docs/patterns.md` §3 — Pattern B variant — registry-shaped tokens (lines 229–248) is **stale after #165c** because its only worked example was the now-deleted `METADATA_TYPE_REGISTRY_TOKEN`. This ticket flags the staleness in `dev-notes.md` and in Risk 5 below; it does NOT rewrite the cookbook section (per working rule "Do not author cookbook content"). The user fills the cookbook in a follow-up.

## Out of scope

- **Backend changes.** `backend/src/services/metadata/MetadataTypeRegistry.ts`, the backend `metadataTypeRegistry` singleton, `exportService.metadataToJsonSchema`, and `stereotypeService.validateMetadata` stay exactly as merged in #164. Removal of `MetadataDefinition` from the backend is #165b's job.
- **Sample-data migration.** `samples/eshop/.dico/stereotypes.yaml` is not touched. Migration to schema-entity YAML is #165b's job.
- **Extracting a per-Attribute inline editor.** `frontend/src/components/AttributeEditor.tsx` is a page-level form with router/fetch concerns, not a unified inline renderer. Extracting a reusable per-`Attribute` inline editor (so that business-entity attribute rows and metadata fields share one component) is its own design ticket — see Risk 1.
- **Convergence on the #107 derived-types catalog.** The collapse target named in the ticket body Phase 5 ("the metadata type registry from #164 collapses into the attribute type registry — #107 derived types") is partial in #165c: we collapse the registry, but we do not yet read `dico.config.json.types[]` inside `StereotypeForm`. That cross-wiring is a follow-up. See Risk 3.
- **New `AttributeType` additions (e.g. `email`, `url`).** Out of scope; would require design.
- **Pattern-extension surface for custom contributions.** #164's design left an extension point where future plugins could `registry.register({ key: 'email', ... })`. After #165c that surface is gone. Users wanting custom types should reach for #107 derived types, which already have their own registry (`dico.config.json.types[]` + `configApi.getDerivedTypes()`). This is a deliberate convergence consequence; documented here so any future "I want to register a new metadata type from a plugin" request points at #107.
- **Cookbook content.** `frontend/docs/patterns.md` §3 — Pattern B variant — registry-shaped tokens becomes stale. Working rule disallows authoring cookbook fills here; flagged as a risk.

## Dependencies

- **Builds on #165a** (merged at `e29147a` — read-compat backend bootstrap marker). Required for the narrative ("Stereotype is structurally a subset of schema-entity"), but #165c's diff is entirely frontend; nothing in #165a is technically required for the deletion to compile and pass tests.
- **Independent of #165b** (eshop migration + backend `MetadataDefinition` removal). Either can land first. If #165b lands first, the frontend `MetadataDefinition` shape used by `MetadataField` may need a follow-up to align with whatever shape #165b leaves on the wire; but at the time of writing #165b's shape contract is "still emit `metadataDefinitions: MetadataDefinition[]` on `GET /api/stereotypes`," so #165c is safe to land standalone.
- **Coordinates with #164** (merged in `e1cd826` — registry creation). #165c is the deletion half of #164's creation. The backend half of #164 is preserved.
- **Coordinates with #166** (frontend `StereotypeService` Pattern A facade, merged in `e76374e`). `StereotypeService` is unaffected — it reads through Store FS for `Stereotype` shapes, never touches the registry.
- **Independent of #107** (derived types). #107's API (`configApi.getDerivedTypes()`) is consumed only by `AttributeEditor.tsx` today and not pulled into `StereotypeForm` / `MetadataField` until the follow-up flagged in Risk 3.

## Risks

1. **Scope-creep into a generic per-field renderer.** The ticket prompt asked: "If `AttributeEditor` doesn't exist as a unified component, this ticket has TWO parts: (a) extract one, (b) route to it." `AttributeEditor.tsx` is a page-level form (~500 lines, includes `useNavigate`, `servicesApi.updateEntity`, route params); making `MetadataField` route into it is wrong. Making a brand-new per-`Attribute` inline editor sandwiched between them is a major refactor that touches `EntityDetail`, `AttributeSidePanel`, and several flat-table consumers. **Mitigation**: keep #165c strictly to "delete the registry, inline the switch into `MetadataField`." Flag the per-`Attribute` inline-editor extraction as a follow-up. This is exactly the "scope down, don't quietly invent a major component refactor" calibration the prompt called for.

2. **Tests that resolve `METADATA_TYPE_REGISTRY_TOKEN` break.** Inventory at spec time: exactly one test references the token (`frontend/src/__tests__/plugin-dependency-graph.test.ts` lines 33 and 229–233). Both are removed in this ticket. Grep confirms zero other references in `frontend/src/**/*.test.{ts,tsx}`. **Mitigation**: criterion 2 plus the explicit "modified" entry for the test file.

3. **`StereotypeForm` type dropdown loses derived-type coverage.** The deleted registry's `getOrFallback` returned the *unknown* fallback for any unknown key; the new static `AVAILABLE_METADATA_TYPES` is closed at 9 entries. If a project's `dico.config.json.types[]` declared `email`, today's `StereotypeForm` (which consults the registry's `list()`) would NOT have surfaced `email` either — the registry was never seeded with derived types. So this risk is **theoretical, not regressive**: parity holds. **Mitigation**: post-#165c follow-up to thread `configApi.getDerivedTypes()` into `StereotypeForm`. Out of scope here; documented.

4. **`appliesTo` filter dropped from `StereotypeForm`.** Today's form does `registry.list().filter((c) => c.appliesTo === undefined || c.appliesTo.includes(appliesTo))`. None of the 9 built-in contributions in `builtinContributions.tsx` sets `appliesTo` — every contribution had `appliesTo === undefined`, so the filter was a no-op. After #165c the filter is removed entirely (no `appliesTo` field exists on the new static catalog). Confirmed by grep: `grep -n "appliesTo" frontend/src/plugins/data-dictionary/metadata/builtinContributions.tsx` returns zero hits. **Mitigation**: behaviour-preserving by construction; no test required, but criterion 7 freezes the dropdown content.

5. **Cookbook §3 stale example.** `frontend/docs/patterns.md` lines 229–248 use `METADATA_TYPE_REGISTRY_TOKEN` as the worked example for "Pattern B variant — registry-shaped tokens." After #165c the example refers to a deleted symbol. The working rule "do NOT author cookbook content" applies — I cannot rewrite the section here. **Mitigation**: flag in `.claude/work/165c/dev-notes.md`; criterion 13 above; surface to the user. If §3's example becomes the *only* registry-shaped example in the project after #165c, the section's premise breaks (since no concrete project example remains); the user may either remove the section entirely or substitute the framework's `STORE_EXTENSIONS_TOKEN` (already cited as precedent in the same paragraph) as the new example.

## Pattern gaps (not covered by `frontend/docs/patterns.md`)

- **Inline read-only renderers for non-scalar metadata in table cells.** `InlineMetadataCell` now contains two small inline JSX helpers (`renderObjectInline`, `renderArrayInline`). The cookbook does not currently have a section on table-cell renderers for structured values. Propose a §6 "Inline cell renderers for nested values" once a second example appears; out of scope to author here.
- **Deletion of a registry-shaped DI token.** No cookbook coverage today for how to *remove* a Pattern-B-variant registry once consumers consolidate on a static set. #165c's diff is the first instance. Could become cookbook material if a similar contraction (e.g. notification levels, command palette item kinds) lands later.
