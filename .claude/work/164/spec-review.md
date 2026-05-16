# Spec review — #164: turn metadata value types into a plugin extension point (with object structure)  (cycle 1)

## Verdict
**rework**

## Summary

Spec is well-structured, scope discipline is good, framework citations check out, trinity is preserved, backward compat for the eshop scalar metadata is sound (additive widening). But there are five substantive issues that need addressing before this is implementable.

## Required changes (if rework)

1. **`MetadataEditor` recursion contract is inconsistent.** The proposed public signature (spec lines 274-284) keeps `entries: MetadataEntry[]` + `stereotype?: Stereotype | null` as inputs. But spec §Files-touched, line 35 says "recursion happens inside the `object` / `array` contributions, which themselves render `MetadataEditor` keyed by `def.fields` / `def.items`." A nested object value is *not* shaped like a top-level `entries: MetadataEntry[]` — it's an `{ [k]: MetadataValue }`, where the schema (`def.fields: MetadataDefinition[]`) plays the role the stereotype plays at the top level. The recursion either:
   - needs the props widened to a discriminated union (top-level: `entries + stereotype`; nested: `value + definitions`), OR
   - the recursion uses a *different* component (e.g. `MetadataFieldsEditor` taking `definitions: MetadataDefinition[]`, `values: {[k]: MetadataValue}`, `onChange: (next: {[k]: MetadataValue}) => void`), with the top-level `MetadataEditor` adapting the stereotype façade onto it.
   - The spec must pick one and document it. The current text says both ("render `MetadataEditor` keyed by `def.fields`") and (top-level signature only accepts `Stereotype`), which is contradictory. Implementation cannot proceed without resolving this.

2. **Missed call sites in `serviceService.ts` search path.** Risk #2 enumerates `impactDiff.ts`, `physicalDiff.ts`, `schemaDiff.ts`, `logicalDiff.ts` as the helpers that will need narrow-type guards when `MetadataEntry.value` widens. It misses `backend/src/services/serviceService.ts:410, 415, 428, 433` which do `String(m.value)` for search. When `m.value` becomes `{...}` or `[...]`, `String()` yields `[object Object]` / `1,2,3` — silently lossy for search ranking. The spec must either (a) list `serviceService.ts` under "Files touched" with a guard for non-scalar metadata in the search path, or (b) add an acceptance criterion that `searchService` ignores non-scalar metadata entries so the regression is bounded. As written, search results will silently degrade once any user adds an object-valued metadata entry.

3. **`getMetadataValue` widening is a breaking change for ~5 callers, not flagged.** Spec line 296 widens `getMetadataValue`'s return type to `MetadataValue | undefined`. But `AttributeFlatTable.tsx:309, 482, 492`, `AttributeList.tsx:57, 465, 678`, `PackageFlatTable.tsx:206, 327, 499`, `AttributeSidePanel.tsx:253`, and `RelationshipList.tsx` all consume the return value directly — typically passing it to `<InlineMetadataCell value={...} />` whose `value: string | number | boolean | undefined`. After widening, these become type errors (callers passing `MetadataValue` to a prop expecting scalar-only). Spec lists `InlineMetadataCell.tsx`'s prop widening but does **not** list the 5+ downstream callers as files touched. Either:
   - add all such callers to "Files touched" with a guard pattern, OR
   - keep `getMetadataValue` narrowly-typed (return `string | number | boolean | undefined`) and add a separate `getMetadataValueAny(): MetadataValue | undefined` for the few callers that need nested values.
   - The current spec direction (widen `getMetadataValue` itself) creates a tsc cascade that is not enumerated in "Files touched" and Acceptance #2 (`npm run build` succeeds) will fail until fixed.

4. **Acceptance #10's regex is too narrow and will pass when the consumer migration is incomplete.** Criterion #10 says `MetadataValueType.\w+` should yield zero hits in `MetadataEditor.tsx`, `InlineMetadataCell.tsx`, `StereotypeForm.tsx`, `exportService.ts`. But `InlineMetadataCell.tsx` does not currently import `MetadataValueType` at all — its `column.type` is a free-form `string` already (see `MetadataColumn.type: string` in `useStereotypeMetadata.ts:11`). So the criterion passes trivially today, before any migration. The criterion also misses `frontend/src/components/CaseTreeTable.tsx:604` (`getMetaVal`) and the export service's actual switch surface. Tighten:
   - drop `InlineMetadataCell.tsx` from the list (no `MetadataValueType` to begin with);
   - add a positive criterion that asserts the registry is actually called by each consumer (e.g. `grep -l "useService(METADATA_TYPE_REGISTRY_TOKEN)" frontend/src/components/MetadataEditor.tsx`);
   - the `exportService.ts` claim is wrong (see point 5).

5. **`exportService` does not currently switch on `MetadataValueType`.** Spec claims (line 9, line 23, line 24) that `exportService.exportToJsonSchema` and `exportToMarkdown` "hard-switch on `MetadataValueType`". Reading `backend/src/services/exportService.ts` (lines 23-209): metadata is rendered as `- ${m.name}: ${m.value}` in markdown and is **not emitted in JSON Schema at all** today. The current code never resolves a `MetadataValueType`. The registry-driven approach is still cleaner, but the spec's framing of "the consumer hard-switches today" misrepresents the baseline for two of the six listed consumers (`exportService.exportToJsonSchema`, `exportService.exportToMarkdown`). The work in `exportService.ts` is *additive* (new behavior: emit nested metadata schemas), not a *replacement* of an existing switch. Adjust the goal language and reframe Acceptance #7 and #8 as *new* JSON Schema / Markdown surfaces driven by the registry — confirming there's no `metadata: ...` JSON Schema today that breaks.

## Suggestions (optional, won't block)

- **`STORE_EXTENSIONS_TOKEN` is a real precedent in `@hamak/ui-store-api`** (`dist/tokens/service-tokens.d.ts:8` declares it; `@hamak/ui-remote-fs` and `@hamak/notification` consume it as a *registry* that other plugins write reducers/middleware into). The spec-writer's attempts.log line 23 says no extensions-registry precedent exists inside `@hamak/*`; that is false. The spec itself doesn't make that claim, so this isn't a required change — but the cookbook §3 note (Acceptance #12) could usefully cite STORE_EXTENSIONS_TOKEN as the closest framework precedent for the "registry other plugins write to" shape, and frame METADATA_TYPE_REGISTRY_TOKEN as an in-house analog of that pattern rather than a novel one.
- **Acceptance #4 ordering claim is fragile.** "Returns exactly `['string','number','boolean','date','flag','rule','object','array','enum']` in the order registered." Asserting both set membership AND order couples the test to the seeding loop ordering. Asserting set equality only (as the parenthetical also notes) is sufficient and lets `registerBuiltinContributions` reorder if needed.
- **Risk #5 mitigation is wishful.** "Register(c) keys by `c.type` (Map semantics) — last-write-wins is the documented behaviour." In Vite HMR, the *registry instance itself* may be torn down and rebuilt — at which point a third-party plugin's contributions are lost until that plugin re-runs `initialize`. Worth a sentence acknowledging that consumers cannot rely on registrations from prior plugins surviving HMR, only from the data-dictionary plugin's own built-in seeding.
- **`appliesTo` semantic mismatch.** Contribution's `appliesTo?: Array<'package' | 'entity' | 'attribute' | 'model' | 'relationship'>` (multi-element). Stereotype's `appliesTo: StereotypeTarget` (single value). The filter logic in StereotypeForm needs to be `contribution.appliesTo === undefined || contribution.appliesTo.includes(stereotype.appliesTo)`. Spec is silent on this — fine for impl-level detail but Acceptance #9 should verify a contribution with `appliesTo: ['attribute']` is hidden when editing an `entity`-targeted stereotype.

## Framework citation verification
| Cited path | Verified | Notes |
|---|---|---|
| `node_modules/@hamak/microkernel-api/dist/types.d.ts:1` (Token<T>) | ✅ | `Token<T> = string \| symbol \| {new(...args:any[]):T}` |
| `node_modules/@hamak/microkernel-api/dist/types.d.ts:42` (ValueProvider<T>) | ✅ | `{ provide: Token<T>; useValue: T }` |
| `node_modules/@hamak/microkernel-api/dist/types.d.ts:51` (Provider<T>) | ✅ | Union of Class/Value/Factory providers |
| `node_modules/@hamak/microkernel-spi/dist/plugin.d.ts:2-15` (InitializationContext) | ✅ | `provide<T>(prov: Provider<T>): void` + `resolve<T>(token: Token<T>): T` |
| `frontend/src/plugins/data-dictionary/dataDictionaryPlugin.ts:83-86` (IntegrityService precedent) | ✅ | Exact `ctx.provide({ provide: INTEGRITY_SERVICE_TOKEN, useValue: new IntegrityService() })` |
| `frontend/src/kernel/useService.ts` | ✅ | Hook exists; consumed by `StereotypesPage`, `IntegrityPage` |

No invented framework calls. All citations resolve.

## Risk reassessment

The spec-listed risks (cross-tier duplication, scalar-helper widening, validate return shape change, YAML round-trip, HMR re-registration) are real and the mitigations are credible — except Risk #2's enumeration is incomplete (missing `serviceService.ts` search path; see Required #2). 

Additional risks the spec misses:

- **`getMetadataValue` cascade** (Required #3) — widening the helper return type creates a tsc cascade across 5+ table/list components. Not enumerated.
- **`MetadataEditor` recursion shape inconsistency** (Required #1) — the public signature does not admit the recursion the §Files-touched text claims. This is a design-coherence risk: implementation will diverge from spec on the very recursive contract that justifies the widening.
- **Search degradation** for non-scalar metadata values (`serviceService.ts:410+`) is unaddressed. Acceptable to defer, but must be acknowledged.

## Cross-ticket conflicts

- **#160** (framework git): no metadata overlap. Skim of `.claude/work/160/spec.md` confirms it touches `versionControl`, `gitService`, `publishService` — no `MetadataEntry`, `MetadataValueType`, or related symbols. No conflict.
- **#155 subspecs** (diff, integrity, import-export, search): integrity and import-export already touch metadata indirectly (search by metadata, export with metadata) — the spec correctly identifies these as upstream-vs-downstream rather than conflicting. ImportExportService.test.ts uses `metadata: []`, unaffected by widening.
- **#161** (fold cases/rules into data-dictionary): no spec under `.claude/work/161` yet — the dependency is forward-looking only. No conflict.
- **#165** (unify Stereotype with Entity): #165 spec doesn't exist; spec's forward-compat claim (free-form string namespace shared with `AttributeType`) is consistent with current `EntitySchema.ts:474` (which already accepts free-form strings for derived types). No conflict.
- **#106** (multi-kind YAML): the loader's collision detection (`mergePackageSections` at `backend/src/utils/fileOperations.ts:311`) keys on `entity.name`/`entity.uuid`, `relationship.uuid`, `rule.uuid`, `case.uuid` — never on metadata structure. Widening metadata values cannot break collision detection. No conflict.
- **#85** trinity (validation/constraint/rule): preserved. `AttributeValidation`, `PhysicalConstraint`, `Rule` all remain distinct. `MetadataDefinition` extension (`fields`, `items`, `enum`) is contained to metadata-only — does not bleed into `AttributeValidation` or `PhysicalConstraint`. `RuleMetadataEntry` is left alone (separate type in `Rule.ts:32`).
- **#107** (derived types): respected. `dico.config.json.types[]` remains orthogonal; spec explicitly defers convergence to a follow-up. Shared string namespace is preserved.

No blocking conflicts.

## Cookbook compliance

The spec follows Pattern B (eager `useValue` in `initialize`) but applies it to a *registry* rather than a *REST wrapper*. Cookbook §3b's worked example is the IntegrityService — a service with methods. The spec's `MetadataTypeRegistry` is a service with `register()`/`get()`/`list()`. This is a legitimate extension of Pattern B but the cookbook does not yet document it. Spec includes Acceptance #12 to add a short cookbook note. Acceptable.

