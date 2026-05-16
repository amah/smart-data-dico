# Spec — #164: turn metadata value types into a plugin extension point (with object structure)

## Goal

Replace two coupled limitations:

1. `MetadataValue` is `string | number | boolean` — scalars only. Real-world metadata (PII classification, data ownership, lineage steps) is structured and is today either flattened into multiple scalar entries or smuggled as JSON-encoded strings. The ticket widens `MetadataValue` to permit arrays and nested objects: `string | number | boolean | MetadataValue[] | { [k: string]: MetadataValue }`. YAML already serialises this losslessly — no migration.

2. `MetadataValueType` is a closed enum of 6 entries. Two consumers (`MetadataEditor`, `StereotypeForm`) hard-switch on it; one consumer (`stereotypeService.validateMetadata`) reads `def.type` as a string compared against enum values; the `exportService` does **not** switch on it today (markdown renders `${m.name}: ${m.value}` as a plain string and JSON Schema does not emit metadata at all — see "Baseline correction" below). Adding `email` / `url` / `pii-level` requires editing the enum and every consumer that switches on it. Replace with a typed registry of contributions, owned by the `data-dictionary` plugin and exposed via DI. Every consumer resolves the contribution for a given type instead of switching on a closed enum. The export service additionally gains a new path that emits metadata into JSON Schema and structured Markdown via the registry — additive new behaviour, not migration.

Quoting the ticket body: *"A typed registry of metadata value type contributions, owned by the `data-dictionary` plugin and exposed via DI. Every consumer resolves the contribution for a given type instead of switching on a closed enum. Object/array/enum composite types ship as built-in contributions so users can compose schemas without writing code."*

Scope for THIS ticket per the calibration brief: **Phases 1–3 only** — data model widening, registry plumbing (DI token + SPI + plugin ownership + built-ins for the 6 scalars plus `object`/`array`/`enum`), and consumer migration off the enum. Phases 4–8 from the ticket body are deferred (see Out of scope).

### Baseline correction (cycle 2)

`backend/src/services/exportService.ts` (read end-to-end, 209 lines):
- `exportToJsonSchema` (lines 23-63) iterates `entity.attributes`, calls `attributeToJsonSchema`, and emits `$defs` for derived types. **It never touches `entity.metadata` and never references `MetadataValueType`.** No metadata appears in the emitted JSON Schema today.
- `exportToMarkdown` (lines 121-206) renders metadata at lines 181-187 as `- ${m.name}: ${m.value}` for each entry. The interpolation `${m.value}` is implicit string-coercion — no switch on `MetadataValueType`. Nested objects/arrays would render as `[object Object]` / `1,2` today, but no sample data exercises that path.

Consequently, AC #7 and AC #8 (below) describe **net-new behaviour**, not the replacement of an existing switch: a new metadata-emission path is added to JSON Schema export, and the Markdown metadata loop is replaced with a registry-dispatched `toMarkdown` call. The wider scope is acknowledged here; the spec authorises this addition because (a) it is the natural consumer for the new `toJsonSchema`/`toMarkdown` contribution methods that the registry SPI must define anyway, (b) without it the registry's export-facing surface has no in-tree consumer and cannot be tested.

## Files touched

### Backend
- `backend/src/models/EntitySchema.ts` — widen `MetadataValue` and `MetadataEntry.value`; extend `MetadataDefinition` with `fields?`, `items?`, `enum?`; relax `MetadataDefinition.type` from `MetadataValueType` enum to `string` (free-form contribution key); keep the `MetadataValueType` enum exported as the seed for built-in registrations.
- `backend/src/models/Dictionary.ts` — no signature changes, but imports remain valid because `MetadataDefinition` / `MetadataEntry` keep the same names.
- `backend/src/services/metadata/MetadataTypeRegistry.ts` — **new**. Backend half of the registry: `MetadataTypeRegistryBackend` class, `MetadataTypeContributionCore<T>` interface (no React). Owned by the backend module that calls write-time validation.
- `backend/src/services/metadata/builtinContributions.ts` — **new**. Registers the 6 scalar contributions (`string`, `number`, `boolean`, `date`, `flag`, `rule`) plus `object`, `array`, `enum`. Pure data; no React.
- `backend/src/services/metadata/metadataValueToSearchString.ts` — **new** (helper, ~10 lines). Recursively flattens a `MetadataValue` into a search-friendly string (`{a:1, b:[2,3]}` → `"a 1 b 2 3"`). Consumed by `serviceService.ts` search.
- `backend/src/services/stereotypeService.ts` — `validateMetadata` becomes registry-driven; emits path-aware `MetadataValidationError[]` instead of `string[]`. Returns both shapes during the deprecation grace window (see Risks).
- `backend/src/services/serviceService.ts` — lines 410, 415, 428, 433 currently do `String(m.value)` for search ranking and `${m.value}` in `description`. Both silently degrade for non-scalar metadata. Replace `String(m.value)` with `metadataValueToSearchString(m.value)`; replace `${m.value}` in the description string with `metadataValueToSearchString(m.value)`. Other call sites in this file (`normalizeMetadata`, `validateMetadata` call to stereotypeService) are untouched.
- `backend/src/services/exportService.ts` — additive: extend `exportToJsonSchema` to emit a `metadata` property per entity-definition that composes registry contributions' `toJsonSchema` fragments; replace the metadata loop in `exportToMarkdown` (currently lines 181-187) with a call to the registry's `toMarkdown` per entry. Both paths fall back to the existing scalar coercion if the contribution is unregistered (unknown-type fallback).
- `backend/src/models/EntitySchema.ts` JSON Schema (the `entitySchema` constant): widen `metadata` items so `value` accepts string/number/boolean/object/array (currently `metadata: { type: 'array' }` with no `items` constraint — so backwards compatible by default, but explicitly document this in the schema description).
- `backend/src/services/__tests__/stereotypeService.test.ts` — adapt asserts to the new `MetadataValidationError[]` shape and add nested-object + array round-trip cases.
- `backend/src/services/__tests__/exportService.test.ts` (or new file if absent) — JSON Schema + Markdown round-trip for `object`/`array`/`enum` metadata; assert the new metadata emission path produces the expected fragments.

### Frontend
- `frontend/src/types/index.ts` — mirror the backend widening: `MetadataValue`, `MetadataEntry.value`, `MetadataDefinition.{fields,items,enum}`. Keep `MetadataValueType` enum exported for legacy callers.
- `frontend/src/plugins/data-dictionary/metadata/MetadataTypeRegistry.ts` — **new**. Frontend half: `MetadataTypeContribution<T>` (Core + `Editor` + `Viewer` + optional `searchFacets`), `MetadataTypeRegistry` interface, `createMetadataTypeRegistry()` factory returning the mutable registry instance.
- `frontend/src/plugins/data-dictionary/metadata/builtinContributions.tsx` — **new**. The 9 built-in contributions with React `Editor`/`Viewer` components. `object` and `array` editors recurse via `MetadataField` (see below), NOT via the top-level `MetadataBlock`.
- `frontend/src/plugins/data-dictionary/metadata/UnknownTypeEditor.tsx` — **new**. Read-only fallback renderer for unregistered types (warning badge + JSON.stringify).
- `frontend/src/kernel/tokens.ts` — add `METADATA_TYPE_REGISTRY_TOKEN`.
- `frontend/src/plugins/data-dictionary/dataDictionaryPlugin.ts` — in `initialize`, construct the registry, seed it with the 9 built-ins from `builtinContributions.tsx`, and `ctx.provide({ provide: METADATA_TYPE_REGISTRY_TOKEN, useValue: registry })`. Pattern B shape (eager `useValue`, no Store FS dep).
- `frontend/src/components/MetadataEditor.tsx` — **renamed conceptually**: the file now exports two components, `MetadataBlock` (default export, replaces the current default export) and `MetadataField` (the recursive primitive). The file path stays `MetadataEditor.tsx` to avoid an import cascade across the codebase. `MetadataBlock` takes `{ entries, stereotype, onChange, readOnly }` and iterates `stereotype.metadataDefinitions`, rendering one `<MetadataField />` per definition. `MetadataField` takes `{ value, definition, onChange, path, readOnly }`, resolves `useService(METADATA_TYPE_REGISTRY_TOKEN).getOrFallback(definition.type)`, and renders `<contribution.Editor value={...} onChange={...} def={definition} path={path} readOnly={readOnly} />`. Built-in `object` and `array` Editors recurse into `<MetadataField />`, keyed by `definition.fields[i]` (for object) or `definition.items` (for array). Top-level `MetadataBlock` is the **only** component that adapts `MetadataEntry[]` ↔ `MetadataDefinition[]`; everything beneath it speaks `MetadataValue` + `MetadataDefinition`. Re-export: `export default MetadataBlock` (so existing import sites `import MetadataEditor from '../components/MetadataEditor'` keep working).
- `frontend/src/components/InlineMetadataCell.tsx` — widen `value` prop type to `MetadataValue | undefined` and `onChange` arg to `MetadataValue`; for non-scalar values render via the registry's `Viewer` (read-only — no inline-edit of nested values). The table's row renderer must not attempt to inline-edit nested objects; an `onExpand?: () => void` optional callback is added so the parent can open a side panel (the panel itself is out of scope). Imports the registry token + `useService`. Drop the local `column.type === 'number' | 'date' | 'flag' | 'boolean'` switch by delegating to the contribution's Editor/Viewer; the file retains scalar-fast-path rendering (text/number/date `<input>` + checkbox) only when `registry.get(column.type)` is one of the four built-in scalar contributions AND the value is scalar — this preserves the existing inline-edit UX for scalar columns. For non-scalar `MetadataValue`, render `<contribution.Viewer />` in display mode and `onExpand?.()` from the click handler.
- `frontend/src/components/StereotypeForm.tsx` — type `<select>` reads `registry.list()` (filtered by `stereotype.appliesTo` via each contribution's optional `appliesTo` field), not `Object.values(MetadataValueType)`. Filter logic: `contribution.appliesTo === undefined || contribution.appliesTo.includes(stereotype.appliesTo)`.
- `frontend/src/hooks/useStereotypeMetadata.ts` — `MetadataColumn.type` stays a free-form `string` (already is). `getMetadataValue` / `setMetadataValue`: see "Call sites for the helper widening" below.
- `frontend/src/components/CaseTreeTable.tsx` — `getMetaVal` widens return type; the inline cell renderers stay (scalar metadata still inlines).
- `frontend/src/components/__tests__/MetadataEditor.test.tsx` (or new file if absent) — render-through-registry test with the built-in `string` and `object` contributions; assert recursion via `<MetadataField />`.
- `frontend/src/components/__tests__/StereotypeForm.test.tsx` (or new file if absent) — assert type dropdown reflects the registry, not the enum.

### Call sites for the helper widening (`getMetadataValue` return type cascade)

`useStereotypeMetadata.getMetadataValue` returns `string | number | boolean | undefined` today (line 96). The five downstream call sites all pipe that return into `InlineMetadataCell`'s `value` prop, which today is `string | number | boolean | undefined`. **This spec chooses option (B) from the review**: widen `InlineMetadataCell`'s `value` prop to `MetadataValue | undefined` (more aligned with the registry pattern — the cell routes through the registry's `Viewer`/`Editor`). `getMetadataValue` is widened to return `MetadataValue | undefined`. The five call sites then compile against the widened `InlineMetadataCell` prop:

| File | Lines | Change pattern |
|---|---|---|
| `frontend/src/components/AttributeFlatTable.tsx` | 309, 482, 492 | No source change — `InlineMetadataCell` accepts the widened type; the surrounding code still inspects scalar shapes via `typeof`. Line 482 (`getMetadataValue(attr, 'pii')`) is read in a scalar context; add a `typeof raw === 'string'` guard if the existing logic indexes into it as a string. |
| `frontend/src/components/AttributeList.tsx` | 57, 465, 678 | Same as above. Line 57 (`getMetadataValue(attr, 'pii')`) is read as a string (badge label) — add `typeof raw === 'string' ? raw : ''` guard at the call site. Lines 465, 678 pass to `InlineMetadataCell` — no change after prop widening. |
| `frontend/src/components/PackageFlatTable.tsx` | 206, 327, 499 | Same pattern. Lines 206 and 327 are scalar-context reads — guard with `typeof v === 'string' \|\| typeof v === 'number' \|\| typeof v === 'boolean' ? v : undefined`. Line 499 passes to `InlineMetadataCell` — no change after prop widening. |
| `frontend/src/components/AttributeSidePanel.tsx` | 253 | Passes to `InlineMetadataCell` — no change after prop widening. |
| `frontend/src/components/RelationshipList.tsx` | 241, 413, 641 | Lines 241 and 413 are scalar-context reads (table cell display) — same `typeof` guard. Line 641 passes to `InlineMetadataCell` — no change after prop widening. |

`InlineMetadataCell` itself routes through the registry's contribution to render — scalar values use the existing inline-edit UX (see file-touched note above); non-scalar values render via `<contribution.Viewer />` with optional `onExpand`.

### Docs
- `frontend/docs/patterns.md` — add a short note under §3 (or as a follow-up TODO) that `METADATA_TYPE_REGISTRY_TOKEN` follows the Pattern B shape but holds a **registry**, not a REST wrapper; consumers register additional contributions during their own `initialize` by `ctx.resolve(METADATA_TYPE_REGISTRY_TOKEN).register(...)`. Cite `STORE_EXTENSIONS_TOKEN` (`frontend/node_modules/@hamak/ui-store-api/dist/tokens/service-tokens.d.ts:8`) as the closest in-framework precedent — `@hamak/ui-remote-fs` and `@hamak/notification` consume it as a registry extension point that other plugins write into. Frame `METADATA_TYPE_REGISTRY_TOKEN` as an in-house analog of that pattern. NB: keep this short — full cookbook entry is out of scope.

## Public surface (signatures)

```ts
// backend/src/models/EntitySchema.ts
export type MetadataValue =
  | string
  | number
  | boolean
  | MetadataValue[]
  | { [key: string]: MetadataValue };

export interface MetadataEntry {
  name: string;
  value: MetadataValue;                   // widened
  severity?: RuleSeverity;
}

/**
 * Schema for a metadata entry. `type` is a free-form contribution key
 * (was: closed `MetadataValueType` enum). Validated at write time against
 * the MetadataTypeRegistry. Built-in keys: 'string' | 'number' | 'boolean'
 * | 'date' | 'flag' | 'rule' | 'object' | 'array' | 'enum'.
 */
export interface MetadataDefinition {
  name: string;
  type: string;                           // free-form, validated by registry
  description?: string;
  required?: boolean;
  fields?: MetadataDefinition[];          // 'object' contributions
  items?: MetadataDefinition;             // 'array' contributions
  enum?: Array<string | number | { value: string | number; label: string }>;  // 'enum'
}

// MetadataValueType enum is RETAINED as the seed for built-in scalar
// registrations and for back-compat with legacy TS consumers, but is no
// longer authoritative — the registry is. Deprecation comment added.
export enum MetadataValueType {
  STRING = 'string',
  NUMBER = 'number',
  BOOLEAN = 'boolean',
  DATE = 'date',
  FLAG = 'flag',
  RULE = 'rule',
}
```

```ts
// backend/src/services/metadata/MetadataTypeRegistry.ts
import type { MetadataDefinition, MetadataValue } from '../../models/EntitySchema.js';

export interface JsonSchemaFragment {
  // Sub-shape of JSON Schema Draft-07 that we actually emit. Open-ended on
  // purpose — exportService composes contributions' fragments together.
  type?: string | string[];
  enum?: unknown[];
  format?: string;
  properties?: Record<string, JsonSchemaFragment>;
  items?: JsonSchemaFragment;
  required?: string[];
  description?: string;
  [k: string]: unknown;
}

export interface MetadataValidationError {
  /** Dotted path from the root entry value. '' for a top-level error. */
  path: string;
  message: string;
}

export interface MetadataValidationResult {
  ok: boolean;
  errors: MetadataValidationError[];
}

/**
 * Backend-portable half of a metadata-type contribution. No React, no DOM.
 * Mirrored exactly on the frontend (see `frontend/.../MetadataTypeRegistry.ts`)
 * which adds `Editor` + `Viewer` + `searchFacets`.
 */
export interface MetadataTypeContributionCore<T extends MetadataValue = MetadataValue> {
  /** Contribution key — matches `MetadataDefinition.type`. Globally unique. */
  type: string;
  /** Human label for pickers. */
  label: string;
  /** Value used when no entry is present and the field is rendered. */
  defaultValue: T;
  /** Stereotype targets this contribution may be attached to. Undefined = all. */
  appliesTo?: Array<'package' | 'entity' | 'attribute' | 'model' | 'relationship'>;
  /** Validate a stored value against a definition. Path-aware. */
  validate(value: unknown, def: MetadataDefinition): MetadataValidationResult;
  /** Normalize an in-memory value to its on-disk form. Identity for most types. */
  serialize(value: T): MetadataValue;
  /** Normalize a raw YAML value to the in-memory form. Identity for most types. */
  parse(raw: unknown): T;
  /** Translate a definition into a JSON Schema fragment for exportService. */
  toJsonSchema(def: MetadataDefinition): JsonSchemaFragment;
  /** Render an entry as Markdown — single line for scalars, indented for object/array. */
  toMarkdown(value: T, def?: MetadataDefinition): string;
}

export interface MetadataTypeRegistryBackend {
  register(c: MetadataTypeContributionCore): void;
  get(type: string): MetadataTypeContributionCore | undefined;
  list(): MetadataTypeContributionCore[];
  /**
   * Validate a single metadata entry against the registry. Resolves the
   * contribution from `def.type`, dispatches `validate`, and prefixes each
   * returned error's path with the entry name (so callers see e.g.
   * `pii.reviewers[1].reviewedAt`).
   */
  validateEntry(entry: MetadataEntry, def: MetadataDefinition): MetadataValidationError[];
  /**
   * Validate an entire stereotype-shaped metadata block. Returns all
   * required-entry-missing errors PLUS all per-entry validate() errors,
   * flattened with stable ordering.
   */
  validateBlock(
    metadata: MetadataEntry[] | undefined,
    defs: MetadataDefinition[],
    stereotypeName: string,
  ): MetadataValidationError[];
}

export function createMetadataTypeRegistry(): MetadataTypeRegistryBackend;

/** Module-singleton registry used by stereotypeService + exportService. */
export const metadataTypeRegistry: MetadataTypeRegistryBackend;
```

```ts
// backend/src/services/metadata/metadataValueToSearchString.ts
import type { MetadataValue } from '../../models/EntitySchema.js';

/**
 * Recursively flattens a MetadataValue into a search-friendly string.
 * Scalar values stringify directly; arrays join their flattened parts with
 * ' '; objects emit `key value key value` pairs flattened recursively.
 *
 *   metadataValueToSearchString('foo')                          === 'foo'
 *   metadataValueToSearchString(42)                             === '42'
 *   metadataValueToSearchString(['a', 'b'])                     === 'a b'
 *   metadataValueToSearchString({ level: 'pii', count: 3 })     === 'level pii count 3'
 *   metadataValueToSearchString({ a: [1, 2] })                  === 'a 1 2'
 */
export function metadataValueToSearchString(value: MetadataValue): string;
```

```ts
// backend/src/services/metadata/builtinContributions.ts
import type { MetadataTypeContributionCore } from './MetadataTypeRegistry.js';

export const builtinStringContribution:  MetadataTypeContributionCore<string>;
export const builtinNumberContribution:  MetadataTypeContributionCore<number>;
export const builtinBooleanContribution: MetadataTypeContributionCore<boolean>;
export const builtinDateContribution:    MetadataTypeContributionCore<string>;   // ISO date string
export const builtinFlagContribution:    MetadataTypeContributionCore<boolean>;  // distinct UI affordance, same value type
export const builtinRuleContribution:    MetadataTypeContributionCore<string>;   // textarea + severity remains on MetadataEntry
export const builtinObjectContribution:  MetadataTypeContributionCore<{ [k: string]: MetadataValue }>;
export const builtinArrayContribution:   MetadataTypeContributionCore<MetadataValue[]>;
export const builtinEnumContribution:    MetadataTypeContributionCore<string | number>;

export function registerBuiltinContributions(r: MetadataTypeRegistryBackend): void;
```

```ts
// backend/src/services/stereotypeService.ts (signature changes only)
import type { MetadataValidationError } from './metadata/MetadataTypeRegistry.js';

class StereotypeService {
  // Was: validateMetadata(s, m): string[]. Now returns path-aware errors.
  validateMetadata(
    stereotype: Stereotype,
    metadata: MetadataEntry[] = [],
  ): MetadataValidationError[];

  // BACK-COMPAT shim, deletes in a follow-up:
  validateMetadataLegacy(stereotype: Stereotype, metadata: MetadataEntry[] = []): string[];
}
```

```ts
// frontend/src/plugins/data-dictionary/metadata/MetadataTypeRegistry.ts
import type { ComponentType, ReactNode } from 'react';
import type {
  MetadataTypeContributionCore,
  MetadataValidationError,
  MetadataValidationResult,
  JsonSchemaFragment,
} from '../../../../types/index';   // mirrored interface lives in frontend/src/types/index.ts
import type { MetadataDefinition, MetadataValue } from '../../../types';

export interface MetadataEditorInputProps<T> {
  value: T;
  onChange: (next: T) => void;
  def: MetadataDefinition;
  /** Dotted path from the root entry value — used to compose nested error keys. */
  path: string;
  readOnly?: boolean;
}

export interface MetadataViewerProps<T> {
  value: T;
  def: MetadataDefinition;
}

export interface MetadataTypeContribution<T extends MetadataValue = MetadataValue>
  extends MetadataTypeContributionCore<T> {
  Editor: ComponentType<MetadataEditorInputProps<T>>;
  Viewer: ComponentType<MetadataViewerProps<T>>;
  /** Optional facets the search plugin can index this value under. */
  searchFacets?: Array<{ path: string; kind: 'enum' | 'string' | 'number' | 'boolean' | 'date' }>;
}

export interface MetadataTypeRegistry {
  register(c: MetadataTypeContribution): void;
  get(type: string): MetadataTypeContribution | undefined;
  list(): MetadataTypeContribution[];
  /** Frontend convenience — returns Viewer + Editor for the type, or the unknown fallback. */
  getOrFallback(type: string): MetadataTypeContribution;
}

export function createMetadataTypeRegistry(opts?: {
  unknownTypeFallback?: MetadataTypeContribution;
}): MetadataTypeRegistry;
```

```ts
// frontend/src/kernel/tokens.ts (new line)
export const METADATA_TYPE_REGISTRY_TOKEN = Symbol('MetadataTypeRegistry');
```

```tsx
// frontend/src/plugins/data-dictionary/metadata/builtinContributions.tsx
export const builtinStringContribution:  MetadataTypeContribution<string>;
export const builtinNumberContribution:  MetadataTypeContribution<number>;
export const builtinBooleanContribution: MetadataTypeContribution<boolean>;
export const builtinDateContribution:    MetadataTypeContribution<string>;
export const builtinFlagContribution:    MetadataTypeContribution<boolean>;
export const builtinRuleContribution:    MetadataTypeContribution<string>;
export const builtinObjectContribution:  MetadataTypeContribution<{ [k: string]: MetadataValue }>;
export const builtinArrayContribution:   MetadataTypeContribution<MetadataValue[]>;
export const builtinEnumContribution:    MetadataTypeContribution<string | number>;

export function registerBuiltinContributions(r: MetadataTypeRegistry): void;
```

```tsx
// frontend/src/components/MetadataEditor.tsx (two components; default export = MetadataBlock)

/**
 * Top-level block editor. Adapts a MetadataEntry[] (the on-disk shape) +
 * Stereotype to a definitions-driven iteration over MetadataField. Used at
 * the entity-edit / attribute-edit / package-edit page level. Does NOT
 * recurse — it is the only adapter between MetadataEntry[] and MetadataDefinition[].
 */
export function MetadataBlock(props: {
  entries: MetadataEntry[];
  stereotype?: Stereotype | null;
  onChange: (entries: MetadataEntry[]) => void;
  readOnly?: boolean;
}): JSX.Element;

/**
 * Recursive single-field renderer. Resolves the contribution for
 * definition.type from the registry and renders <contribution.Editor />.
 * Built-in object/array contributions render their children by recursing
 * INTO <MetadataField />, NOT into <MetadataBlock /> (which speaks the
 * entries+stereotype shape, not value+definition).
 */
export function MetadataField(props: {
  value: MetadataValue;
  definition: MetadataDefinition;
  onChange: (next: MetadataValue) => void;
  /** Dotted path from the root entry value — used for nested error keys. */
  path: string;
  readOnly?: boolean;
}): JSX.Element;

// Default export preserves existing import sites:
//   import MetadataEditor from '../components/MetadataEditor'
//   -> resolves to MetadataBlock (same props as today).
export default MetadataBlock;
```

```ts
// frontend/src/hooks/useStereotypeMetadata.ts (widened return + arg types)
export function getMetadataValue(
  target: { metadata?: MetadataEntry[] },
  metadataName: string,
): MetadataValue | undefined;

export function setMetadataValue(
  currentMetadata: MetadataEntry[] | undefined,
  name: string,
  value: MetadataValue,
): MetadataEntry[];
```

```ts
// frontend/src/components/InlineMetadataCell.tsx (widened props)
interface InlineMetadataCellProps {
  value: MetadataValue | undefined;     // was: string | number | boolean | undefined
  column: MetadataColumn;
  onChange: (value: MetadataValue) => void;   // was: (value: string | number | boolean) => void
  /** Optional — called when the cell shows a non-scalar value and the user clicks. */
  onExpand?: () => void;
}
```

## Framework APIs used

- `@hamak/microkernel-api` — `Token<T>`, `Provider<T>`, `ValueProvider<T>` (`frontend/node_modules/@hamak/microkernel-api/dist/types.d.ts:1,42,51`). Used to register the registry via `ctx.provide({ provide: METADATA_TYPE_REGISTRY_TOKEN, useValue: registry })`.
- `@hamak/microkernel-spi` — `InitializationContext.provide` / `resolve` (`frontend/node_modules/@hamak/microkernel-spi/dist/plugin.d.ts:2-15`). Used in `dataDictionaryPlugin.initialize` to install the registry under the new token. No new framework call shapes — same pattern as `INTEGRITY_SERVICE_TOKEN` (`frontend/src/plugins/data-dictionary/dataDictionaryPlugin.ts:83-86`).
- `@hamak/ui-store-api` — `STORE_EXTENSIONS_TOKEN` (`frontend/node_modules/@hamak/ui-store-api/dist/tokens/service-tokens.d.ts:8`). Cited (not used) as the precedent for a registry-shaped DI token that other plugins write into. `@hamak/ui-remote-fs` and `@hamak/notification` consume it. `METADATA_TYPE_REGISTRY_TOKEN` follows the same shape.
- `frontend/src/kernel/useService.ts` — `useService<T>(token)` for consumer resolution. Already in use by `StereotypesPage`, `IntegrityPage`, etc.

No new framework packages are introduced. No factory functions or plugin lifecycle hooks beyond `initialize` are touched.

## Acceptance criteria

1. **Backwards compat — every existing eshop metadata entry parses unchanged.** Running `npm test` in `backend/` after the type-widening change passes without any change to sample YAML in `samples/eshop/`. `grep -rn 'metadata:' samples/eshop/ | wc -l` matches the pre-change count.
2. **TypeScript widening compiles.** `npm run build` in both `backend/` and `frontend/` succeeds. `MetadataEntry.value` accepts string, number, boolean, `MetadataValue[]`, and `{[k]: MetadataValue}` literals. The five `getMetadataValue` call sites compile against the widened `InlineMetadataCell.value` prop without additional changes beyond the scalar-context `typeof` guards documented in "Call sites for the helper widening" above.
3. **Registry registration is idempotent and singleton.** Calling `metadataTypeRegistry.register(builtinStringContribution)` twice does not throw; second call replaces the first (last-write-wins) and a warning is logged. Asserting via a backend unit test on `MetadataTypeRegistry.test.ts`.
4. **Built-in contributions are all 9 listed.** `new Set(metadataTypeRegistry.list().map(c => c.type))` equals the set `{'string','number','boolean','date','flag','rule','object','array','enum'}`. Order is not asserted (per cycle-1 suggestion).
5. **Path-aware validation works on nested objects.** Given a stereotype with `metadataDefinitions: [{ name: 'pii', type: 'object', fields: [{ name: 'level', type: 'enum', enum: ['public','internal','confidential'], required: true }, { name: 'reviewers', type: 'array', items: { name: 'reviewer', type: 'object', fields: [{ name: 'name', type: 'string', required: true }, { name: 'reviewedAt', type: 'date' }] } }] }]` and entity metadata `[{ name: 'pii', value: { level: 'confidential', reviewers: [{ name: 'alice' }, { name: '', reviewedAt: 'not-a-date' }] } }]`, `stereotypeService.validateMetadata(...)` returns errors with paths `pii.reviewers[1].name` (required-missing) and `pii.reviewers[1].reviewedAt` (date-format). Asserted via unit test in `stereotypeService.test.ts`.
6. **Unknown-type fallback renders without crashing.** A `MetadataDefinition` with `type: 'never-registered-foo'` renders the `UnknownTypeEditor` component (read-only `<pre>{JSON.stringify(value)}</pre>` + `<span className="badge">unknown type</span>`). Asserted in `MetadataEditor.test.tsx`.
7. **JSON Schema export gains a metadata emission path.** Today `exportService.exportToJsonSchema(service)` emits zero metadata into the schema (`exportService.ts:23-63` reads `entity.attributes` only). After this change, for an entity carrying nested object-metadata `{ pii: { level: 'confidential', reviewers: [...] } }` under a stereotype, the emitted JSON Schema for that entity contains a top-level `metadata: { type: 'object', properties: { pii: { type: 'object', properties: { level: { type: 'string', enum: [...] }, reviewers: { type: 'array', items: { ... } } } } } }` composed by walking the stereotype's `metadataDefinitions` and calling each contribution's `toJsonSchema(def)`. Asserted in `exportService.test.ts` snapshot-style. Entities without a stereotype or without metadata emit no `metadata` property (backward compat).
8. **Markdown export renders nested metadata as indented bullets via the registry.** Today `exportService.exportToMarkdown` renders `- ${m.name}: ${m.value}` (string-coerce) at lines 181-187. After this change, the same loop calls `registry.get(def?.type)?.toMarkdown(m.value, def)` and falls back to the existing string coercion for unregistered types or for metadata entries without a stereotype definition. For an entity with the AC #5 fixture, the output contains `- pii:\n  - level: confidential\n  - reviewers:\n    1. name: alice\n    2. name: bob; reviewedAt: 2026-01-01` (exact text matched by test).
9. **`StereotypeForm`'s type dropdown reflects the registry.** Mounting `<StereotypeForm />` and reading the `<select>` options yields exactly the contributions filtered by `appliesTo`, NOT `Object.values(MetadataValueType)`. Assertion: register a 10th contribution `email` (with `appliesTo: ['attribute']`) in the test setup and verify it appears in the dropdown when editing an attribute-targeted stereotype AND is hidden when editing an entity-targeted stereotype (exercises the array-vs-singleton filter logic).
10. **`InlineMetadataCell.tsx` imports the registry token and the resolver, and no longer uses the closed enum.** Three positive grep checks (each must return ≥ 1 hit) and one negative grep check (must return 0):
    - `grep -Fc "METADATA_TYPE_REGISTRY_TOKEN" frontend/src/components/InlineMetadataCell.tsx` ≥ 1
    - `grep -Fc "useService" frontend/src/components/InlineMetadataCell.tsx` ≥ 1
    - `grep -Fc "MetadataValue" frontend/src/components/InlineMetadataCell.tsx` ≥ 1 (the widened prop type)
    - `grep -Fc "MetadataValueType" frontend/src/components/InlineMetadataCell.tsx` == 0 (no closed-enum reference even though the file did not previously import it — guards against regression where a future PR re-introduces the enum)
    
    Plus the existing structural check: `grep -rn 'MetadataValueType\.\w\+' frontend/src/components/MetadataEditor.tsx frontend/src/components/StereotypeForm.tsx` returns zero hits (both files migrate off the enum's case-label use). `exportService.ts` is NOT in this list because it never used `MetadataValueType` to begin with (see "Baseline correction").
11. **`qualityService.metadataCoverage` still computes the same number on the eshop sample.** No regression in `getQualityReport()` output — the stereotype-compliance check now reads `validateMetadata(...).length === 0` instead of `errors.length === 0` (same boolean, new shape).
12. **Cookbook §3 note added.** `frontend/docs/patterns.md` contains a sub-section (or a clearly-marked note) describing the registry-shaped Pattern B variant — narrow regex `metadata-type-registry|METADATA_TYPE_REGISTRY_TOKEN` in `patterns.md` returns at least one hit, AND `STORE_EXTENSIONS_TOKEN` is cited in that note as the in-framework precedent for the "registry other plugins write to" shape.
13. **Search ranking does not silently degrade for non-scalar metadata.** `metadataValueToSearchString({ level: 'pii', count: 3 })` returns `'level pii count 3'` (asserted in a backend unit test). The four `serviceService.ts` lines (410, 415, 428, 433) call `metadataValueToSearchString(m.value)` instead of `String(m.value)` and `${m.value}`. `grep -Fc "String(m.value)" backend/src/services/serviceService.ts` returns 0.

## Out of scope

The ticket body lists 8 phases. This spec covers Phases 1, 2, 3 (with one additive scope for Phase 3's export consumer — see "Baseline correction"). The following are explicitly **deferred**:

- **Phase 4 — InlineMetadataCell side-panel for nested metadata.** Spec widens the value prop, adds `onExpand?`, and asserts compact summary via `<contribution.Viewer />`; the actual side-panel editor is a follow-up. Tests assert "non-scalar values render via Viewer" but not "panel opens correctly."
- **Phase 5 — Backend write-time validation enforcement.** `stereotypeService.validateMetadata` returns the new path-aware error shape but is **not** called on every entity-write path yet. The integrity dashboard surface is unchanged in this ticket (integrity reads `attribute.validation`, not metadata). Wiring write-time enforcement across `serviceController` / `entityFileAdapter` / etc. is a follow-up ticket.
- **Phase 6 — Limits (depth 4, array length 50), reserved-name guards, circular-reference detection.** The data model allows arbitrary depth; enforcement is a follow-up.
- **Phase 7 — `/metadata-types` debug page.** Not built. Discoverability via `registry.list()` is testable from a unit test only.
- **Phase 8 — Full CLAUDE.md "How to register a new metadata type" tutorial.** Cookbook gets a short note (criterion 12); a full howto is a follow-up doc.
- **Non-built-in proof contribution (`email`).** The ticket's Acceptance #2 wants at least one `email` contribution shipped to prove the path end-to-end; per the calibration brief ("New domain-specific types beyond the proof-of-concept email — deployments add their own. Phase 4 (defer): adding new types like email, url, pii-classification — those are illustrations of the goal, not required deliverables"), `email` is **not** required here. It is exercised only in the test suite, where a test-only `email` contribution is registered against the test registry instance to prove the path. Production code ships only the 9 built-ins.
- **#165 unification of Stereotype with Entity.** Forward-compat guidance from the ticket body is respected (contribution `type` uses the same string namespace as `AttributeType` / derived types; no metadata-only fields in the contribution interface). But this spec does NOT collapse the two systems.
- **Merging with `dico.config.json.types[]` derived types (#107).** The two systems remain orthogonal: derived types validate attribute values, metadata-type contributions validate metadata-entry values. The same string namespace is RESPECTED (so a future merger is possible) but no convergence happens here. `exportService` continues to treat `$defs` derived types and metadata-type contributions as two separate machinery paths.
- **Shared `shared/` package between frontend and backend.** The `MetadataTypeContributionCore` interface and the 9 backend built-ins are duplicated in `backend/src/services/metadata/` and a thin mirror in `frontend/src/types/index.ts`. A shared package is a follow-up if duplication starts to bite.

## Dependencies

- **Coordinates with #155** (PR #173 + PR #174 already merged/in-flight): the DI-token + Pattern B precedent (`INTEGRITY_SERVICE_TOKEN` provided eagerly in `dataDictionaryPlugin.initialize`) is the template this spec follows. No code blocker — this ticket builds on the merged precedent.
- **Coordinates with #161** (fold cases/rules into data-dictionary): both consume metadata. Widening the value type lifts the lid for both; this ticket's changes are upstream of #161's plugin moves. If #161 lands before #164 dev starts, the new metadata files live under `frontend/src/plugins/data-dictionary/metadata/` exactly where this spec says they go.
- **Forward-compat with #165** (unify Stereotype with Entity): see Out of scope. Spec preserves the option to converge.
- **Independent of #160** (framework git), **#162** (ai-assistance extraction), **#163** (commands & events framework adoption — already merged), **#167** (backend projection).

This ticket is NOT blocked.

## Risks

1. **Cross-tier duplication of `MetadataTypeContributionCore`.** The interface lives in both `backend/src/services/metadata/MetadataTypeRegistry.ts` and (mirrored) `frontend/src/types/index.ts`. Drift will cause subtle mismatch where the backend rejects a value the frontend let through. **Mitigation**: a single source-of-truth test that imports both and asserts structural equality of the 9 built-in contribution objects' keys (modulo `Editor`/`Viewer`/`searchFacets`). Add to `backend/src/services/metadata/__tests__/parity.test.ts`. Long-term mitigation: a `shared/` package, out of scope here.

2. **`MetadataEntry.value` widening breaks helper signatures.** ~7 backend services have `function readMeta(...): string | number | boolean | undefined`. Widening to `MetadataValue | undefined` ripples through `impactDiff.ts`, `physicalDiff.ts`, `schemaDiff.ts`, `logicalDiff.ts`. **Mitigation**: those helpers all read scalar `physical.*` keys; narrow the return type at the helper site (`readMeta(...): string | number | boolean | undefined` keeps the narrow shape, with a runtime guard `typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'`). Helpers stay narrow; only the model widens. Acceptance #2 verifies the build still passes. Frontend cascade (`getMetadataValue` → 5 callers → `InlineMetadataCell`) is enumerated in "Call sites for the helper widening" and resolved by widening `InlineMetadataCell.value` and adding `typeof` guards at the few scalar-context call sites.

3. **`stereotypeService.validateMetadata` return type change breaks callers.** `qualityService.ts:66` reads `errors.length === 0`. **Mitigation**: keep the legacy `string[]` shape exposed under `validateMetadataLegacy(s, m): string[]` (built by mapping the new `MetadataValidationError[]` through `e => \`Required metadata '${e.path}' is missing\``). Migrate `qualityService.ts` in the same PR to call the new shape. Risk is low — only one caller.

4. **YAML round-trip for nested metadata values is untested.** YAML serializes nested objects/arrays natively, but the read-modify-write cycle through `backend/src/utils/fileOperations.ts` + `js-yaml` (or `yaml`) may introduce key-order or type-coercion drift (e.g. unquoted `2026-01-01` parsing as a Date). **Mitigation**: round-trip test in `fileOperations.test.ts` that writes an entity with nested-object metadata, reads it back, and asserts deep equality. If yaml's date coercion bites, set `customTags`/`schema: 'core'` on the parser; this is local and reversible. Acceptance #1 stresses the existing scalar shapes; criterion is silent on the new shape pending the round-trip test.

5. **Registry is mutable and not snapshot-stable across HMR.** During Vite HMR, the registry singleton instance can be torn down and rebuilt — at which point third-party plugins' contributions are lost until their own `initialize` re-runs. **Mitigation**: documented behaviour, no code-level fix. `register(c)` keys by `c.type` (Map semantics) so re-seeding the built-ins is idempotent; warning is downgraded to `console.debug` in dev. Consumers cannot rely on registrations from prior plugins surviving HMR, only on the data-dictionary plugin's own built-in seeding. Acceptance #3 codifies the registration semantics; HMR survival is explicitly NOT promised.
