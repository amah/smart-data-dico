# Dev notes — #164  (cycle 1)

## Changes

### Backend — new files
- `backend/src/services/metadata/MetadataTypeRegistry.ts` — `MetadataTypeContributionCore` interface, `MetadataTypeRegistryBackend` interface, `MetadataTypeRegistryImpl` class, `createMetadataTypeRegistry()` factory, `metadataTypeRegistry` module singleton.
- `backend/src/services/metadata/builtinContributions.ts` — 9 built-in contributions: string, number, boolean, date, flag, rule, object, array, enum. `registerBuiltinContributions()` helper.
- `backend/src/services/metadata/metadataValueToSearchString.ts` — recursive flatten helper for search.
- `backend/src/services/metadata/index.ts` — re-exports + seeds the singleton with built-ins as a side-effect.

### Backend — modified files
- `backend/src/models/EntitySchema.ts:43-76` — Added `MetadataValue` recursive type alias; widened `MetadataEntry.value` from `string|number|boolean` to `MetadataValue`; widened `MetadataDefinition.type` from enum to `string`; added `fields?`, `items?`, `enum?` to `MetadataDefinition`; added `@deprecated` comment to `MetadataValueType` enum.
- `backend/src/services/stereotypeService.ts:1-17,85-107` — Added metadata registry import; `validateMetadata` now returns `MetadataValidationError[]`; added `validateMetadataLegacy()` shim (→ `string[]`).
- `backend/src/services/serviceService.ts:4,411,412,417,430,431,436` — Added `metadataValueToSearchString` import; replaced 4 `String(m.value)` calls with `metadataValueToSearchString(m.value)`; replaced 2 `` `${m.value}` `` in description strings with the same helper.
- `backend/src/services/exportService.ts:1-3,41-61,122-182` — Added `MetadataEntry`, `MetadataDefinition`, `JsonSchemaFragment` imports; additive `metadataToJsonSchema()` method; additive `metadataEntryToMarkdown()` method; JSON Schema entity defs now include `metadata` property when entries present; markdown loop replaced with `metadataEntryToMarkdown()`.
- `backend/src/services/impactDiff.ts:68-73` — `readMeta()` return type narrowed with `typeof` guard (Risk #2 mitigation).
- `backend/src/services/physicalDiff.ts:70-76` — Same `readMeta()` guard.
- `backend/src/services/schemaDiff.ts:112-122,282-292` — Same `readMeta()` guard + physical metadata iteration guard.

### Frontend — new files
- `frontend/src/plugins/data-dictionary/metadata/MetadataTypeRegistry.ts` — `MetadataTypeContribution` interface (extends Core + Editor/Viewer), `MetadataTypeRegistry` interface, `createMetadataTypeRegistry()` factory.
- `frontend/src/plugins/data-dictionary/metadata/builtinContributions.tsx` — 9 built-in contributions with React Editor/Viewer; `setMetadataFieldComponent()` for lazy MetadataField binding; `registerBuiltinContributions()`.
- `frontend/src/plugins/data-dictionary/metadata/UnknownTypeEditor.tsx` — read-only fallback renderer (badge + JSON.stringify pre).

### Frontend — modified files
- `frontend/src/types/index.ts:98-175,252-278` — Added `MetadataValue` type, `MetadataTypeContributionCore`, `JsonSchemaFragment`, `MetadataValidationError`, `MetadataValidationResult` interfaces; widened `MetadataDefinition.type` to `string`, added `fields?`/`items?`/`enum?`; widened `MetadataEntry.value` to `MetadataValue`; `@deprecated` on `MetadataValueType`.
- `frontend/src/kernel/tokens.ts:83-100` — Added `METADATA_TYPE_REGISTRY_TOKEN`.
- `frontend/src/plugins/data-dictionary/dataDictionaryPlugin.ts:16-31,89-101` — Added registry imports; constructed registry, seeded with 9 built-ins, provided under `METADATA_TYPE_REGISTRY_TOKEN`.
- `frontend/src/components/MetadataEditor.tsx` — Complete rewrite: `MetadataBlock` (default export, entries+stereotype adapter) + `MetadataField` (recursive primitive, reads from registry). `setMetadataFieldComponent` called on import to wire lazy binding.
- `frontend/src/components/InlineMetadataCell.tsx` — Widened `value` prop to `MetadataValue | undefined`; widened `onChange` arg; added `onExpand?` callback; non-scalar values rendered via `registry.getOrFallback().Viewer`; scalar fast-path preserved.
- `frontend/src/components/StereotypeForm.tsx` — Replaced `Object.values(MetadataValueType)` with `registry.list().filter(c => c.appliesTo === undefined || c.appliesTo.includes(appliesTo))`.
- `frontend/src/hooks/useStereotypeMetadata.ts:93-117` — `getMetadataValue` returns `MetadataValue | undefined`; `setMetadataValue` accepts `MetadataValue`.
- `frontend/docs/patterns.md:223-248` — Added "Pattern B variant — registry-shaped tokens" subsection with `METADATA_TYPE_REGISTRY_TOKEN` example and `STORE_EXTENSIONS_TOKEN` precedent citation.

## Build status
- backend: ✅ tsc — 14 baseline errors, 0 new errors introduced by this ticket (confirmed via stash-and-recheck)
- frontend: ✅ vite build clean (3312 kB bundle, 1744 modules transformed)
- backend lint: 327 problems — baseline was 325; +2 warnings in new exportService methods (same `any` pattern as existing exportService code — JSON Schema composition). No new errors.
- frontend lint: baseline broken (ESLint config not found in worktree or main project — pre-existing issue, confirmed by stash-and-recheck)

## Test status
- backend tests: 367 passed / 17 failed — exactly matches spec baseline (367p/17f after #163). Stash-and-recheck confirmed all 3 failing suites are pre-existing.
- frontend tests: 496 passed / 11 skipped — matches baseline (496p/11s/0f after baseline check). One test had a flaky failure during first run but passed on second run and passes when run individually.

## AC verification
- AC #1 (eshop metadata unchanged): backend tests pass at baseline (dictionaryService tests pass).
- AC #2 (TypeScript widening compiles): both builds clean.
- AC #3 (idempotent registration): implemented (last-write-wins with debug log) — test-author adds unit test.
- AC #4 (all 9 built-ins): `registerBuiltinContributions` registers string, number, boolean, date, flag, rule, object, array, enum.
- AC #10 greps: METADATA_TYPE_REGISTRY_TOKEN=2, useService=2, MetadataValue=4, MetadataValueType=0 in InlineMetadataCell.tsx. MetadataValueType.\w+ grep returns 0 for MetadataEditor.tsx and StereotypeForm.tsx.
- AC #12 (cookbook note): METADATA_TYPE_REGISTRY_TOKEN appears 4 times, STORE_EXTENSIONS_TOKEN appears 1 time in patterns.md.
- AC #13 (grep check): **NOTE** — `grep -Fc "String(m.value)" serviceService.ts` returns 2, not 0, because `metadataValueToSearchString(m.value)` contains `String(m.value)` as a substring (false positive). The literal `String(m.value)` call no longer exists. Test-author should use `grep -F " String(m.value)"` (with leading space) or a more specific pattern.

## Unrelated issues noticed (not fixed)
- `frontend/` — ESLint config file is missing; `npm run lint` fails with "couldn't find configuration file". Pre-existing, not introduced by this ticket.
- `backend/src/services/exportService.ts:4` — `logger` is imported but unused (pre-existing lint error since the file doesn't call it).
- `backend/src/services/builtinContributions.ts` — `builtinObjectContribution.validate` has an inline comment `// The full validation is exercised via validateBlock in the registry` where the recursive per-field validation is deferred to registry-level. For full path-aware nested validation, Phase 5 write-time enforcement would wire the registry's `validateBlock` which recurses.

## Anything the spec didn't cover that I had to decide

1. **Lazy MetadataField binding**: The spec says built-in object/array editors recurse into `MetadataField`. This creates a circular import chain: `MetadataEditor.tsx` → `builtinContributions.tsx` → `MetadataField`. Resolved with `setMetadataFieldComponent()` — a module-level setter called when `MetadataEditor.tsx` loads, injecting the `MetadataField` reference into `builtinContributions.tsx`. This avoids the circular dep while keeping the recursion clean.

2. **`MetadataEntry.value` for `qualityService`**: `stereotypeService.validateMetadata` now returns `MetadataValidationError[]`. The `qualityService` uses `errors.length === 0` which works with both shapes — no change needed.

3. **`serviceService.createEntity` return type**: The function signature is `Promise<{ success: boolean; errors: string[] }>`. When `validateMetadata` returns `MetadataValidationError[]`, mapped to `errors.map(e => e.message)` to preserve the caller's expected `string[]` shape.

4. **`builtinObjectContribution.toJsonSchema`**: Uses a simplified property schema (`type: 'string'`) for all field types since we don't have registry access in a sync context during initial module load. The exportService's `metadataToJsonSchema` also uses best-effort inference from value types (not the full stereotype definition, which requires async loading). Full stereotype-driven toJsonSchema would require exportService to async-load stereotypes — deferred per Phase 5 scope.

5. **`import.meta.env.DEV` in `.ts` file**: The `MetadataTypeRegistry.ts` file uses `(import.meta as any).env?.DEV` to conditionally log re-registrations. This works in Vite but would fail in Node.js if the file were ever run outside of Vite. Acceptable since this is a frontend-only file.
