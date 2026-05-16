# Spec review — #163: arch: actually use the action/command/event framework (cycle 2)

## Verdict
**approve**

Both required changes from cycle 1 are cleanly applied. No regressions introduced.

## Cycle-1 required changes — verification

### (1) CommandMap count = 19 / 18

Independent recount of CommandMap keys (spec lines 190-274):

| # | Command | Line |
|---|---|---|
| 1 | data-dictionary.stereotype.loadAll | 190 |
| 2 | data-dictionary.stereotype.create | 194 |
| 3 | data-dictionary.stereotype.update | 200 |
| 4 | data-dictionary.stereotype.delete | 204 |
| 5 | data-dictionary.integrity.getReport | 210 |
| 6 | data-dictionary.diff.getLogical | 216 |
| 7 | data-dictionary.diff.getPhysicalConfig | 220 |
| 8 | data-dictionary.diff.getPhysicalForService | 224 |
| 9 | data-dictionary.diff.getPhysicalAll | 228 |
| 10 | data-dictionary.import-export.importJsonSchema | 234 |
| 11 | data-dictionary.import-export.importSqlDdl | 238 |
| 12 | data-dictionary.import-export.previewSqlDdl | 242 |
| 13 | data-dictionary.import-export.previewDbSchema | 246 |
| 14 | data-dictionary.import-export.diffSqlDdl | 250 |
| 15 | data-dictionary.import-export.commitSqlDdl | 254 |
| 16 | data-dictionary.import-export.exportJsonSchema | 258 |
| 17 | data-dictionary.import-export.exportMarkdown | 262 |
| 18 | data-dictionary.quality.getReport | 268 |
| 19 | search.search | 274 |

Total: 19 (18 data-dictionary + 1 search). Confirmed.

Register-call count in handler blocks (lines 327-413): 19 `ctx.commands.register(` calls; 18 with `'data-dictionary.` prefix + 1 with `'search.`. Confirmed.

All numbered references reconciled:

| Location | Claim | Status |
|---|---|---|
| Line 16 (Phase 2 prose) | "register 19 commands … 18 data-dictionary + 1 search" | match |
| Line 16 | "Net +15 commands" (19 new − 4 deleted) | match |
| Line 56 | "All 19 commands take a single argument. 17 of 19 use a wrapped-object input" | match |
| Line 64 | "Sanity sweep across the other 18 commands" | match |
| Line 195 (comment in CommandMap) | "17 of 19 inputs are `{ key: value, ... }`" | match |
| Acceptance #2 (line 450) | "exactly the 19 keys" / `=== 19` | match |
| Acceptance #5 (line 456) | "all 18 data-dictionary.* commands" / "matches ≥ 18 times" | match |
| Acceptance #18 (line 482) | "for each of the 18 data-dictionary command names" / "Total: 19 has-true assertions" | match |
| Acceptance #20 (line 486) | "at least 19 list items" / "registering all 19" | match |
| Acceptance #21 (line 490) | "data-dictionary: 18, search: 1" | match |

Net-change arithmetic (line 16): 19 new − 4 deleted (3 refresh + version.commit) = +15. Correct.

### (2) `data-dictionary.stereotype.create` typing (Option B applied)

- CommandMap entry (lines 194-198): `input: { data: Stereotype }; output: Stereotype`.
- Handler (line 330): `async ({ data }: { data: Stereotype }) => { const created = await stereotype.create(data); … }`.

Both wrapped. Consistent.

New convention-note section (lines 56-64) documents the choice and ties it to the dominant pattern. Verified claim "17 of 19 use a wrapped-object input": 2 voids (loadAll, integrity.getReport), 17 wrapped. Matches.

## Spot-check on spec-writer's "no further mismatches" claim

Sampled 3 random CommandMap ↔ handler pairs to verify destructure matches type:

1. **`data-dictionary.diff.getPhysicalAll`**
   - CommandMap (228-230): `input: { sources: Record<string, PhysicalDiffSource>; services?: string[] }`
   - Handler (358-360): `({ sources, services }: { sources: Record<string, PhysicalDiffSource>; services?: string[] }) => diff.getPhysicalAll(sources, services)`
   - Match.

2. **`data-dictionary.import-export.diffSqlDdl`**
   - CommandMap (250-253): `input: { parsed: unknown[]; targetService: string }`
   - Handler (375-377): `({ parsed, targetService }: { parsed: unknown[]; targetService: string }) => ie.diffSqlDdl(parsed, targetService)`
   - Match.

3. **`search.search`**
   - CommandMap (274-277): `input: { query: string; filters?: SearchFilters }`
   - Handler (413-415): `({ query, filters }: { query: string; filters?: SearchFilters }) => search.searchEntities(query, filters)`
   - Match.

Bonus check (the one that almost paralleled stereotype.create's prior bug — `quality.getReport` has an optional `service?: string` field):

4. **`data-dictionary.quality.getReport`**
   - CommandMap (268-271): `input: { service?: string }`
   - Handler (401): `async ({ service }: { service?: string }) => { const report = await ie.getQualityReport(service); … }`
   - Match.

Spec-writer's claim holds.

## Regression sweep

- No CommandMap key dropped between cycles (independent count = 19, matches both spec totals).
- No register call dropped between cycles (independent count = 19, matches CommandMap).
- All acceptance numeric pins are internally consistent.
- No new framework citations added in cycle 2 — citation table from cycle 1 still applies.
- Convention-note insertion (lines 56-64) is a pure addition to the Public-surface section; no surrounding prose disturbed.

## Suggestions carried forward (still won't block)

Cycle 1's optional suggestions remain pertinent. None were required to be addressed; flagging again for the implementer rather than the spec-writer:

- Cookbook §4 prose drift (`execute` vs `run`) — covered by acceptance #21 first bullet.
- Dead `if (res?.data)` guard at spec line 380 — harmless, may stay.
- Unused `StereotypeTarget` import at spec line 162 — trim at implementation time.
- Self-exclusion in `spec-grep-guards.commands.test.ts` walker (mirror the integrity-guard precedent).
- Implementer judgement call on the `<Route path="/commands" …>` mapping location (spec line 34 acknowledges).

## Framework citation verification

No re-verification needed for cycle 2 — no citations changed. Cycle-1 table remains authoritative.

## Risk reassessment

Unchanged from cycle 1. R7 (handler-side type drift) is now retired as the symptom is fixed and the wider class of bugs is still mitigated by the per-plugin command tests.

## Cross-ticket conflicts

None. Re-confirmed no new in-flight specs have appeared under `.claude/work/` since cycle 1 that would conflict with #163.
