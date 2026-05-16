# Spec review — #155 (slice): ImportExportService — Pattern B proof  (cycle 1)

## Verdict
**rework**

The spec is 95% precise, mechanically scoped, and faithful to the PR #173 precedent. Every framework citation verifies. The 10-method enumeration matches `api.ts:319-373` exactly, the envelope asymmetry is correctly pinned (`getQualityReport` unwraps `response.data.data`; all others return `response.data` raw), the `responseType: 'text'` detail is identified, and the test rewrite plan preserves all 12 cases. However, two issues need correction before implementation:

1. A bad TypeScript cast in the prescribed `exportMarkdown` signature that will either fail or mis-instruct the implementer.
2. A self-contradicting method count in the goal sentence ("nine methods") that will confuse the implementer reading top-down.

Both are small but load-bearing for an implementer that codes literally against the spec.

## Required changes

1. **Fix the `responseType: 'text' as 'json'` cast in the `exportMarkdown` signature** (spec lines 282-292). axios's `ResponseType` union (verified at `frontend/node_modules/axios/index.d.ts:296-303`) already includes the string literal `'text'`. The cast `as 'json'` is (a) unnecessary, (b) factually wrong (it claims the value is `'json'` when it is `'text'`), and (c) inconsistent with the legacy code at `api.ts:365` which uses `as any` (also wrong, but at least honest). Replace the prescribed body with:
   ```ts
   const response = await this.http.get<string>(
     `/export/markdown/${service}`,
     { responseType: 'text' },
   );
   ```
   Drop the rationalising comment about a needed cast — there is no narrowing problem. Update the prose at line 287-289 accordingly and remove the `as 'json'` from the signature. Acceptance criterion #10's grep `responseType:\s*'text'` still works either way.

2. **Fix the goal sentence's method count: "nine methods" → "ten methods"** (spec line 5). The rest of the spec consistently says 10 (line 16: "actually ten"; line 24: "10 methods"; line 33: "all 10 methods"; line 554: enumerates 10 names). The summary in line 5 says "nine methods instead of one" — this conflicts with the canonical body. An implementer who lifts the sentence into the PR description will publish a wrong count. Replace "nine methods" with "ten methods" (and the rest of the paragraph already correctly references all 10 including `previewOracleSchema` and `getQualityReport`).

## Suggestions (optional, won't block)

- **Spec line 13 wording.** "expands the consumer count from 3 to 4 source files" — the orchestrator's original list per the spec writer's reading was 3 source consumers (SchemaImportWizard, QualityDashboardPage, ImportExportPage); spec writer found HomePage as the 4th. The body is correct; the sentence is just slightly hard to parse against the prompt's framing of "5 consumers" (which counts the test file). Consider rephrasing to: "Source consumers: 4 (the 3 the orchestrator flagged + HomePage). Test mock to retarget: 1. Total file count: 5." Non-blocking.

- **`SchemaImportWizard.test.tsx` MSW handler enumeration (criterion #9).** Spec line 559 lists four MSW handlers needed: `POST /api/import/sql-ddl/preview`, `POST /api/import/sql-ddl/diff`, `POST /api/import/sql-ddl/commit`, `POST /api/import/db/preview`. Verified: no test in the file invokes the `previewOracleSchema` mock — the Oracle test (line 195) explicitly routes through `previewDbSchema('oracle', ...)`. So no `/api/import/oracle/preview` handler is needed. Good catch; spec is correct on this. Mentioning explicitly here for the implementer's clarity is suggested but non-blocking.

- **Acceptance criterion #7 sub-bullet on baseURL.** The spec says "the `baseURL: '/api'` lives on the default instance only — the stub receives relative paths." This matches the IntegrityService precedent (`IntegrityService.test.ts:77` asserts `'/integrity'`, not `'/api/integrity'`). Consider adding one explicit sentence: "Acceptance for unit-test path assertions uses the relative form, e.g. `'/import/sql-ddl/preview'`, NOT `'/api/import/sql-ddl/preview'`." Non-blocking; matches precedent.

- **`exportJsonSchema` return type.** Spec uses `Promise<unknown>`. The single consumer (`ImportExportPage.tsx:53`) immediately calls `JSON.stringify(schema, null, 2)`, which accepts anything. `unknown` is correct but mildly developer-hostile; `Promise<any>` matches the legacy untyped return. Either is fine. Non-blocking.

- **Stable URL building in `getQualityReport`.** Spec line 308 builds query via string concat: `const params = service ? '?service=${encodeURIComponent(service)}' : ''`. This matches `api.ts:369` exactly (which actually does NOT call `encodeURIComponent` — `api.ts:369` is `const params = service ? '?service=${service}' : '';`). The spec is *more correct* than legacy. Worth confirming this slight behavior change (URL-encoding) is intentional. Non-blocking; the change is an improvement.

## Framework citation verification

| Cited path | Verified | Notes |
|---|---|---|
| `frontend/node_modules/@hamak/microkernel-spi/dist/plugin.d.ts:1,3` | yes | `InitializationContext.provide<T>(prov: Provider<T>): void;` on line 3 of plugin.d.ts. Matches spec's claim. |
| `frontend/node_modules/@hamak/microkernel-api/dist/types.d.ts:1,36-37,42-43,46-51,53` | yes | `Token<T> = string \| symbol \| {new (...args: any[]): T;}` on lines 1-3; `ClassProvider` 36-41; `ValueProvider` 42-45; `FactoryProvider` 46-50; `Provider` 51; `ProvidedServices.resolve<T>` on line 53. All match. |
| `frontend/src/kernel/useService.ts` | yes | Signature `export function useService<T>(token: symbol \| string): T` confirmed. Throws if `host.rootActivationCtx` unset (line 17-22). |
| `frontend/src/kernel/bootstrap.ts:186,212` | yes | `export async function bootstrapApplication(): Promise<boolean>` at line 186; `getStore()` at line 212. Spec's note about the `Promise<boolean>` return-vs-void quirk is accurate. |
| `frontend/src/kernel/bootstrap.ts:40` | yes | `export const host = new Host([], undefined, { debug: false });` |
| `frontend/node_modules/@hamak/microkernel-impl/dist/runtime/host.d.ts:13` | yes | `rootActivationCtx?: ActivateContext;` on Host class. |
| `axios.AxiosInstance / index.d.ts` | yes | `ResponseType` includes `'text'` literal — spec's `as 'json'` cast is wrong but does not negate the existence of the API. |
| `frontend/src/services/api.ts:319-373` | yes | `importExportApi` block spans exactly those lines. 10 method names match. Envelope shapes match: only `getQualityReport` does `.data.data`. |
| `frontend/src/plugins/data-dictionary/services/IntegrityService.ts` | yes | Precedent class structure matches the spec's prescribed shape verbatim. |
| `frontend/src/plugins/data-dictionary/dataDictionaryPlugin.ts:80-84` | yes | The INTEGRITY_SERVICE_TOKEN registration sits at exactly those lines, immediately after the StereotypeService block. Spec's "after the existing block" instruction is correct. |
| `frontend/docs/patterns.md:166-215` | yes | §3b worked example with `IntegrityService` covers lines 166-215. §1.5 carve-out for Pattern B `useState<loading\|error>` is at line 84 and 226. |
| `backend/src/routes/index.ts` import/export/quality routes | yes | All 10 backend route paths match what the spec proposes the service should hit. |
| `frontend/src/components/__tests__/SchemaImportWizard.test.tsx:21-39` | yes | The `vi.mock` block is at lines 21-29; `mockedApi` extraction at 31-39; `beforeEach` mockReset at 84-90. Spec's line range claim is precise. |
| `frontend/src/pages/HomePage.tsx:14, 27, 113` | yes | Prose comment at line 14, named import on line 27, call at line 113. All confirmed. |

## Risk reassessment

The spec's 5 enumerated risks are real and adequately mitigated. Additional risk worth surfacing:

- **Risk 6 (new): TypeScript cast misdirection in `exportMarkdown`.** The `as 'json'` cast prescribed in the spec is wrong. An implementer who copies it gets either a compile error or a misleading code reading. Risk reverts to zero with required-change #1.

- **Risk 7 (new): Test file's `previewOracleSchema` mock literal.** Spec acceptance criterion #6 includes a repo-wide walker that prevents `importExportApi` survivors. After the rewrite, `SchemaImportWizard.test.tsx` should also have no surviving mock entry for `previewOracleSchema`. The acceptance criterion #9 says "no surviving reference to `importExportApi` or `mockedApi`" but does not say "no surviving reference to `previewOracleSchema` as a mock target". The literal string `previewOracleSchema` will survive in the prose-doc comment at the top of the test file (line 5: `previewSqlDdl / previewOracleSchema`). This is harmless prose but worth pinning explicitly: the doc comment at the top can be left alone or rewritten to reference `previewDbSchema` only. Non-blocking; suggestion.

- **Risk 8 (new): `HomePage.tsx` prose comment.** Spec line 28 says the comment at line 14 (`Quality → importExportApi.getQualityReport()`) becomes `importExport.getQualityReport()` "for documentation parity." Fine, but the spec's grep guards (criterion #6, repo-wide walker for `importExportApi`) will treat the legacy comment string as a survivor if the implementer forgets to update it. The criterion correctly catches this; surface it here so the implementer doesn't have a surprise on first test run.

## Cross-ticket conflicts

- **`#155-search` spec (sibling, in-flight).** Owned by the search plugin, distinct file footprint. Token (`SEARCH_SERVICE_TOKEN`), service path (`plugins/search/services/SearchService.ts`), plugin (`searchPlugin.ts`), and migrated consumer set (SearchComponent, searchSlice) do not overlap with this spec's footprint. The only shared file is `frontend/src/kernel/tokens.ts` — both append a new token (additive; line-merge conflict risk is mechanical but trivial). No semantic conflict.
- **`#155-diff` spec (sibling, in-flight).** Surface unknown from this review pass; verified to live in `.claude/work/155-diff/spec.md`. Spot check: no overlap with `importExportApi` methods or files touched by this spec. Both extract Pattern B services from the same `api.ts` shim; they coordinate via additive removals of distinct exports.
- **`#155-integrity-service` (merged as PR #173).** Spec correctly inherits its precedent without modifying any of its files. HomePage.tsx is the only shared file; the spec adds a second `useService` line beside the existing `useService<IntegrityService>(INTEGRITY_SERVICE_TOKEN)` call — pure addition, no edit.
- **#106 multi-kind YAML / #85 trinity / #163 command-event naming / #168 dual-view.** Pattern B is REST-shaped over computed endpoints — none of these architectural invariants are touched. Spec correctly notes (line 152, 295-306) that quality is a computed report not a file shape; no multi-kind YAML concerns; no Store FS dual-view concerns.

Net: no blocking cross-ticket conflicts. The two required changes are local to the spec body.
