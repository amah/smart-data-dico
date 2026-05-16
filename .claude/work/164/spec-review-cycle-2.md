# Spec review — #164: turn metadata value types into a plugin extension point (with object structure)  (cycle 2)

## Verdict
**approve**

## Summary

All five required changes from cycle 1 are addressed. No regressions in framework citations, trinity preservation, or cross-cutting consistency.

## Cycle-1 required changes — verification

1. **MetadataEditor recursion contract — RESOLVED.** Spec adopts option (c): `MetadataBlock` (default export, `entries + stereotype + onChange + readOnly`) is the entry↔definition adapter and never recurses; `MetadataField` (`value + definition + onChange + path + readOnly`) is the recursive primitive. Built-in `object`/`array` Editors recurse into `<MetadataField />`. `export default MetadataBlock` preserves the three existing import sites (`EntityDetail.tsx`, `Settings.tsx`, `CaseCreatePage.tsx`). Public-surface block at spec lines 317-352 documents both signatures; Files-touched line 45 names the renaming and the default-export preservation. Clean fit — verified against current `MetadataEditor.tsx:1-12` which today exports a default `MetadataEditor` with the same outer props shape `MetadataBlock` adopts.

2. **`serviceService.ts:410+` — RESOLVED.** Spec lists `backend/src/services/serviceService.ts` in Files-touched (line 32) with the four line numbers (410, 415, 428, 433), introduces `backend/src/services/metadata/metadataValueToSearchString.ts` (signature at spec lines 200-215), and adds AC #13 with both the positive assertion (`metadataValueToSearchString({ level: 'pii', count: 3 })` returns `'level pii count 3'`) and the negative guard (`grep -Fc "String(m.value)" backend/src/services/serviceService.ts` returns 0).

3. **`getMetadataValue` cascade — RESOLVED.** New section "Call sites for the helper widening" (spec lines 53-65) tabulates the 5 files with their line numbers (`AttributeFlatTable.tsx` 309/482/492; `AttributeList.tsx` 57/465/678; `PackageFlatTable.tsx` 206/327/499; `AttributeSidePanel.tsx` 253; `RelationshipList.tsx` 241/413/641). Option (B) chosen: widen `InlineMetadataCell.value` to `MetadataValue | undefined`, with scalar-context reads guarded by `typeof` checks. AC #2 explicitly states the cascade "compile[s] against the widened `InlineMetadataCell.value` prop without additional changes beyond the scalar-context `typeof` guards documented".

4. **AC #10 — RESOLVED.** Cycle-2 AC #10 (spec lines 399-405) now has four checks against `InlineMetadataCell.tsx`: three positive (`METADATA_TYPE_REGISTRY_TOKEN` ≥ 1, `useService` ≥ 1, `MetadataValue` ≥ 1) and one negative (`MetadataValueType` == 0). `exportService.ts` correctly dropped from the negative-regex list. The narrow regex for `MetadataEditor.tsx` and `StereotypeForm.tsx` is retained because those two files DO use the enum today. No trivial passes.

5. **`exportService` baseline — RESOLVED.** New "Baseline correction (cycle 2)" subsection (spec lines 15-21) states the truth: `exportToJsonSchema` does not emit metadata; `exportToMarkdown` uses string-interpolation, not a `MetadataValueType` switch. AC #7 reframed as "JSON Schema export GAINS a metadata emission path" with explicit acknowledgement that today no metadata is emitted; AC #8 reframed as replacing the string-interpolation loop with a registry-dispatched `toMarkdown` call. The Goal section explicitly authorises the additive scope (export consumer needs an in-tree caller for the SPI to be testable). Files-touched note for `exportService.ts` (line 33) marked "additive".

## Optional corrections (folded)

- **STORE_EXTENSIONS_TOKEN citation** — present in Framework APIs section (spec line 383) with the dist path `frontend/node_modules/@hamak/ui-store-api/dist/tokens/service-tokens.d.ts:8`, framed as registry-shaped DI-token precedent. Cookbook AC #12 (spec line 407) now also requires the citation in the patterns.md note.
- AC #4 ordering dropped — spec line 393 reads "Order is not asserted".
- Risk #5 HMR — rewrite at spec lines 442-443 acknowledges that third-party HMR survival is not promised, only built-in seeding.
- `appliesTo` array-vs-singleton — AC #9 (spec line 398) now exercises both directions (visible for attribute-targeted, hidden for entity-targeted).

## Framework citation verification

| Cited path | Verified | Notes |
|---|---|---|
| `node_modules/@hamak/microkernel-api/dist/types.d.ts:1,42,51` (Token, ValueProvider, Provider) | OK | unchanged from cycle 1 |
| `node_modules/@hamak/microkernel-spi/dist/plugin.d.ts:2-15` (InitializationContext) | OK | unchanged from cycle 1 |
| `frontend/src/plugins/data-dictionary/dataDictionaryPlugin.ts:83-86` (IntegrityService precedent) | OK | unchanged from cycle 1 |
| `frontend/node_modules/@hamak/ui-store-api/dist/tokens/service-tokens.d.ts:8` (STORE_EXTENSIONS_TOKEN) | OK | new in cycle 2; matches cycle-1 review's correction of the cycle-1 attempts.log claim |
| `frontend/src/kernel/useService.ts` | OK | unchanged from cycle 1 |

No invented APIs.

## Risk reassessment

The three cycle-1 unflagged risks (search degradation, helper cascade, recursion shape) are now addressed in the spec body itself. The five spec-listed risks (cross-tier duplication, scalar-helper widening, validate return shape change, YAML round-trip, HMR re-registration) carry credible mitigations.

YAML round-trip (Risk #4) remains lightly stressed — AC #1 covers scalar back-compat, but no AC asserts a nested-object round-trip through `fileOperations.ts`. Spec's mitigation is a follow-up unit test; acceptable as written but worth surfacing at impl time. Not blocking.

## Cross-ticket conflicts

None changed from cycle 1. No new conflicts introduced by the cycle-2 deltas:
- The new `metadataValueToSearchString.ts` helper is contained under `backend/src/services/metadata/` — no overlap with `#155` subspecs.
- The `MetadataBlock`/`MetadataField` split keeps the file path `MetadataEditor.tsx`, so no rename appears in any other in-flight spec's import map.
- Trinity (`AttributeValidation` / `PhysicalConstraint` / `Rule`) untouched.
- Multi-kind YAML loader (collision detection in `fileOperations.ts:311`) is name/uuid-keyed; widening metadata values cannot affect it.
- `#107` derived types and `#165` stereotype-entity unification remain orthogonal and forward-compatible per spec's Out of scope section.

Approved.
