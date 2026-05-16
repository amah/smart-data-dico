# Dev notes — #165b (cycle 1)

## Changes

### Sample data (new)
- `samples/eshop/.dico/schemas/aggregate-root.entity.yaml` — new schema-entity for aggregate-root stereotype
- `samples/eshop/.dico/schemas/value-object.entity.yaml` — new schema-entity for value-object stereotype
- `samples/eshop/.dico/schemas/event.entity.yaml` — new schema-entity for event stereotype (displayName: Domain Event)
- `samples/eshop/.dico/schemas/reference-data.entity.yaml` — new schema-entity for reference-data stereotype (displayName: Reference Data)
- `samples/eshop/.dico/schemas/pii.entity.yaml` — new schema-entity for pii stereotype (displayName: PII)
- `samples/eshop/.dico/schemas/indexed.entity.yaml` — new schema-entity for indexed stereotype (displayName: Indexed)
- `samples/eshop/.dico/schemas/deprecated.entity.yaml` — new schema-entity for deprecated stereotype (displayName: Deprecated)

### Sample data (modified)
- `samples/eshop/.dico/stereotypes.yaml:1` — emptied to `[]\n` (was 98-line legacy YAML)

### Backend (modified)
- `backend/src/services/schemaEntityView.ts:137-195` — `toLegacyStereotypeView` changed: `Stereotype.id ← Entity.name` (slug), `Stereotype.name ← metadata['displayName'] ?? Entity.name`. `fromLegacyStereotypeView` changed symmetrically: always generates fresh UUID, sets `entity.name = stereotype.id`, adds `displayName` metadata when `name !== id`. Removed unused `isValidUUID` import.
- `backend/src/services/stereotypeService.ts:1-300` — added `preferSchemaEntityWrite()` private method + routing in `createStereotype`, `updateStereotype`, `deleteStereotype`. Imports `fromLegacyStereotypeView`, `writeSchemaEntity`, `deleteSchemaEntity`. Changed re-export from `export {...} from` to `export {...}`.
- `backend/src/models/EntitySchema.ts:82-95` — added `@deprecated #165b` JSDoc to `MetadataDefinition` interface.
- `backend/src/services/__tests__/schemaEntityView.test.ts:143-300` — updated round-trip assertions for `id ← name` mapping; added display-name tests; fixed UUID handling in `fromLegacyStereotypeView` tests.
- `backend/src/services/__tests__/stereotypeService.165a.test.ts:257-263` — updated collision detection test to use `id === 'pii'` instead of UUID after #165b slug change.
- `CLAUDE.md:85` — updated stereotypes stanza to document schema-entity canonical form, `displayName` reserved key, and UUID stability.

### Backend (new)
- `backend/src/services/schemaEntityWriter.ts` — new pure write helper: `writeSchemaEntity(entity)` and `deleteSchemaEntity(slug)`.
- `backend/src/services/__tests__/schemaEntityView.165b.test.ts` — 20 new tests covering slug-vs-display split, round-trips, AC#2/3/13/15 file assertions.
- `backend/src/services/__tests__/stereotypeService.165b.test.ts` — 16 new tests covering AC#1/3/4/5/6/7/9/10/14 plus `preferSchemaEntityWrite()` routing.

## Build status
- backend tsc: same 14 baseline errors (unchanged)
- backend lint: 387 problems (73 errors, 314 warnings) — 1 fewer than baseline 388 (removed stale `isValidUUID` import)
- backend tests: 430 passed / 17 failed / 36 suites. Baseline was 394p/17f/32 suites. +36 new passing tests from #165b test files, same 17 baseline failures.

## Worktree issue discovered
The worktree's `samples/` directory was empty on startup (the tracked files were deleted from the working tree, showing as "deleted" in git status). This occurred because the worktree was created before `samples/` files were tracked at the merge base. Had to restore them using `git show HEAD:path > target` before the tests could access them. The `afterEach` in the new test file had a bug that would `fs.rmSync` the real eshop directory — fixed to only delete dirs matching the temp prefix `dico-test-165b-`.

## Unrelated issues noticed (not fixed)
- `backend/src/services/__tests__/promptService.test.ts` — pre-existing flaky test; fails intermittently due to UUID ordering in list results when run alongside other tests.
- `samples/eshop/.dico/schemas/value-object.entity.yaml:attribute[0].description` — empty string `''` serializes as such; value-object has only one boolean attribute (immutable) with no description. Not a bug.

## Anything the spec didn't cover that I had to decide

1. **`reference-data`, `indexed`, `deprecated` displayName** — the spec only explicitly cited `pii` (PII), `aggregate-root` (Aggregate Root), `event` (Domain Event), `value-object` (Value Object) as having display names different from their slugs. The original YAML also had `reference-data → Reference Data`, `indexed → Indexed`, `deprecated → Deprecated`. I added `displayName` metadata to all three to preserve byte-identity of `Stereotype.name`. This was required for AC#4 (byte-identical HTTP response) to pass.

2. **Worktree file persistence** — the `afterEach` in the test used `fs.rmSync(testDataDir, recursive)` which would delete the real eshop directory when `testDataDir` was set to the eshop path. Fixed by guarding on the temp-dir prefix pattern. The 165a test has the same pattern but only uses temp dirs — this is a new pattern introduced in 165b tests that directly use the real eshop sample.
