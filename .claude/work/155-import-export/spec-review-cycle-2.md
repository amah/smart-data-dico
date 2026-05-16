# Spec review — #155 (slice): ImportExportService — Pattern B proof  (cycle 2)

## Verdict
**approve**

Cycle 2 applies both required changes cleanly and absorbs the three non-blocking suggestions without introducing new issues. Cycle-1 framework-citation verification still holds end-to-end; nothing changed in the surface area that would invalidate it.

## Required changes (if rework)
None.

## Suggestions (optional, won't block)

- The two surviving `as any` strings in the spec body (lines 19 and 282) are explicitly framing — line 19 quotes the legacy code at `api.ts:365`; line 282 documents that the legacy cast is "dropped intentionally" inside the docblock of the new `exportMarkdown`. Both are unambiguously non-prescriptive. An implementer who copy-pastes verbatim still ends up with the correct cast-free signature. Non-blocking.

- The `responseType: 'text' as any` quote at line 19 is technically faithful to legacy source — verified at `api.ts:354` (the file's import-export block has shifted: spec says line 365, actual is line 354 due to file edits since spec was written). Not a defect — the surrounding context (`/import/{json-schema,sql-ddl,sql-ddl/preview,oracle/preview,db/preview,sql-ddl/diff,sql-ddl/commit}`, `/export/{json-schema,markdown}`, `/quality/report`) is identical, and the legacy `as any` is faithfully reproduced as a quote, not a prescription. The only consequence: future readers chasing the line number find the block slightly higher than the spec text claims. Non-blocking suggestion: a follow-up spell may want to standardise on line ranges rather than exact line numbers.

- Spec line 280 cites axios's `ResponseType` union at `frontend/node_modules/axios/index.d.ts:296-303`. Verified: actual location is lines 296-304 (the union spans 8 elements, the closing token on line 304). The cited range covers all members including `'text'`. Non-blocking.

## Cycle 2 fix verification

### Fix 1: TypeScript cast removed from `exportMarkdown`

- Spec line 287 reads: `{ responseType: 'text' },` — no `as 'json'`, no `as any`, no other cast. Clean.
- Spec line 285 reads: `const response = await this.http.get<string>(` — type parameter is `<string>`, matching the `Promise<string>` return type. Internally consistent.
- The two surviving `as any` mentions are non-prescriptive framing (line 19: quotes legacy code; line 282: documents that legacy cast is dropped). Verified: search for the string `as 'json'` returns zero hits across the spec.
- Acceptance criterion #10's grep `responseType:\s*'text'` is unchanged (spec line 563). Will return one hit against the prescribed code at line 287.

### Fix 2: Method count

- Spec line 5 reads: `but covers **ten methods** instead of one`. Correct.
- Spec line 16 reads: `**ten methods**: importJsonSchema, ...` — enumerates all 10. Correct.
- `grep -nE "nine|nine methods"` against the spec returns **zero hits**. Verified.

### Suggestion absorption (non-blocking)

- **Suggestion 1: 4 source + 1 test mock = 5 phrasing.** Spec line 13 reads: `**Source consumers: 4** (the 3 the orchestrator flagged + HomePage). **Test mock to retarget: 1** (SchemaImportWizard.test.tsx). **Total file count touching importExportApi: 5.**` — absorbed verbatim.

- **Suggestion 2: MSW handler-count rationale.** Spec criterion #9 line 558 reads: `**No POST /api/import/oracle/preview handler is needed**: no test case in the file exercises previewOracleSchema. The "Oracle" test case at SchemaImportWizard.test.tsx:195 routes through previewDbSchema('oracle', ...).` — absorbed with the specific test-line citation.

- **Suggestion 3: HomePage line-14 prose comment.** Tracked in four places, exactly as the prompt enumerates:
  - Files-touched section: spec line 28 — `The prose comment at line 14 (importExportApi.getQualityReport()) is rewritten to importExport.getQualityReport()`.
  - Criterion #4 (HomePage row): spec line 533 — `The prose comment at line 14 must also be rewritten so the repo-wide guard in criterion #6 does not catch a stale importExportApi string.`
  - Criterion #6: spec line 538 — `including HomePage.tsx's prose comment at line 14 — have been migrated.`
  - HomePage diff block: spec lines 425-426 — the diff explicitly shows `-// Quality → importExportApi.getQualityReport()` becoming `+// Quality → importExport.getQualityReport()`.

  All four locations the prompt called out are present.

### Cycle-2 scope discipline

Verified that cycle 2 did NOT silently expand scope:

- 10 methods still enumerated at spec line 16 and at criterion #8 bullet 4 (spec line 553).
- Envelope asymmetry still pinned: `getQualityReport` reads `response.data.data` (spec line 309); every other method returns `response.data` (spec lines 187, 196, 210, 227, 240, 249, 258, 272, 289). Sub-bullet at criterion #7 (spec lines 544-545) explicitly enumerates the asymmetry. Risk 5 (spec line 611) flags it.
- SchemaImportWizard.test.tsx full rewrite mandate intact (spec lines 31, 556-562).
- Out-of-scope list (spec lines 578-591) unchanged in shape: quality extraction deferred, `previewOracleSchema` preserved, ESLint guardrail deferred, AuthService cleanup deferred, notification wiring deferred, page-level MSW tests deferred.

## Framework citation verification

| Cited path | Verified | Notes |
|---|---|---|
| `frontend/node_modules/@hamak/microkernel-spi/dist/plugin.d.ts:1,3` | yes | `InitializationContext.provide<T>(prov: Provider<T>): void;` on line 3. Unchanged from cycle 1. |
| `frontend/node_modules/@hamak/microkernel-api/dist/types.d.ts:1,36-37,42-43,46-51,53` | yes | `Token<T>`, `ClassProvider`, `ValueProvider`, `FactoryProvider`, `Provider`, `ProvidedServices.resolve<T>` all confirmed at the cited lines. |
| `frontend/node_modules/axios/index.d.ts:296-303` (`ResponseType` includes `'text'`) | yes | Verified: union spans `arraybuffer \| blob \| document \| json \| text \| stream \| formdata`. The `'text'` literal is a structural member, no cast required. |
| `frontend/src/kernel/useService.ts` | yes (cycle 1) | Signature `useService<T>(token: symbol \| string): T` confirmed. |
| `frontend/src/kernel/bootstrap.ts:186,212,40` | yes (cycle 1) | `bootstrapApplication()`, `getStore()`, `host` singleton at the cited lines. |
| `frontend/src/services/api.ts:319-373` | yes (cycle 1) | `importExportApi` block, all 10 methods, envelope asymmetry confirmed. The cycle-2 spec correctly retains the cited range; the legacy `as any` is at `api.ts:354` not `:365` in current main, but the spec's quote is faithful and the block contents are unchanged. |
| `frontend/src/plugins/data-dictionary/services/IntegrityService.ts` | yes | Precedent class structure matches the spec's prescribed shape verbatim. |
| `frontend/src/plugins/data-dictionary/dataDictionaryPlugin.ts:80-84` | yes (cycle 1) | INTEGRITY_SERVICE_TOKEN registration sits at those lines. |
| `frontend/docs/patterns.md:166-215` | yes (cycle 1) | §3b worked example covers the cited lines. |
| `frontend/src/pages/HomePage.tsx:14, 27, 113, 81` | yes | Confirmed: prose comment at line 14, named import on line 27, `getQualityReport` call at line 113, `useService<IntegrityService>` at line 81. |
| `frontend/src/components/__tests__/SchemaImportWizard.test.tsx:21-39, 84-90` | yes (cycle 1) | `vi.mock` block at 21-29, `mockedApi` extraction at 31-39, `beforeEach` mockReset at 84-90. |

All citations re-verified. No degradations from cycle 1.

## Risk reassessment

Cycle 1's enumerated risks (5 in-spec + 3 review-added) remain accurate. Cycle-2 fixes do not retire Risks 1-5 (mostly inherent to the migration, mitigated as documented); Risks 6-8 (review-added in cycle 1) are now addressed:

- **Risk 6 (cycle-1, now resolved):** TypeScript cast misdirection in `exportMarkdown` — fixed in cycle 2 (no cast in the prescribed signature).
- **Risk 7 (cycle-1, suggestion):** `previewOracleSchema` mock prose comment in `SchemaImportWizard.test.tsx` (test file's top-of-file doc comment). The cycle-2 spec at line 31 calls for a full test rewrite with MSW; whether the doc comment survives is harmless prose and not enforced by the grep guard (which scans for `importExportApi`, not `previewOracleSchema`). Non-blocking.
- **Risk 8 (cycle-1):** HomePage.tsx prose comment as a hidden grep-guard failure — addressed in 4 places in the cycle-2 spec (Files-touched, criterion #4, criterion #6, the diff itself).

No new risks surfaced in cycle 2.

## Cross-ticket conflicts

None new in cycle 2. The sibling `#155-*` slices (search, diff, etc.) keep their distinct file footprints. The only shared file is `frontend/src/kernel/tokens.ts` (additive append) — mechanical conflict only.

