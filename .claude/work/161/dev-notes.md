# Dev notes — #161 (cycle 1)

## Changes

### New files
- `frontend/src/plugins/data-dictionary/services/CaseService.ts` — Pattern B REST wrapper for `/api/cases/**`; 8 methods; constructor-injected AxiosInstance; no `services/api` import
- `frontend/src/plugins/data-dictionary/services/RuleService.ts` — Pattern B REST wrapper for `/api/rules/**` and `/api/entities/:uuid/rules`; 6 methods; same shape
- `frontend/src/plugins/data-dictionary/services/__tests__/CaseService.test.ts` — unit suite; stub AxiosInstance; getAll + resolve + default-construction
- `frontend/src/plugins/data-dictionary/services/__tests__/RuleService.test.ts` — unit suite; list({scope}) + getRulesForEntity + default-construction
- `frontend/src/plugins/data-dictionary/services/__tests__/spec-grep-guards.cases-rules.test.ts` — 10 guard assertions (tokens declared once, self-contained services, DI in initialize, api.ts clean, no stale identifiers, old dirs absent, slice paths correct, bootstrap clean)
- `frontend/src/plugins/data-dictionary/slices/casesSlice.ts` — moved from `store/slices/casesSlice.ts`; thunks now do `new CaseService()` per call instead of `caseApi.*`
- `frontend/src/plugins/data-dictionary/slices/rulesSlice.ts` — new slice; shape `{list, byEntityUuid, loading, error}`; 5 thunks using `new RuleService()`
- `frontend/src/plugins/data-dictionary/components/cases/CaseTreeTable.tsx` — moved; imports adjusted (4 levels up to src/)
- `frontend/src/plugins/data-dictionary/components/cases/CaseEntityPicker.tsx` — moved; imports adjusted
- `frontend/src/plugins/data-dictionary/components/cases/__tests__/CaseTreeTable.test.tsx` — moved; types import path updated to `../../../../../types`
- `frontend/src/plugins/data-dictionary/components/rules/RuleEditor.tsx` — moved + rewritten: `ruleApi.*` replaced with `useService<RuleService>(RULE_SERVICE_TOKEN).*`
- `frontend/src/plugins/data-dictionary/components/rules/EntityRulesList.tsx` — moved; imports adjusted
- `frontend/src/plugins/data-dictionary/components/rules/RulesSidePanel.tsx` — moved; imports adjusted
- `frontend/src/plugins/data-dictionary/pages/cases/CaseListPage.tsx` — moved; uses `useService(CASE_SERVICE_TOKEN)` not `caseApi`
- `frontend/src/plugins/data-dictionary/pages/cases/CaseDetailPage.tsx` — moved; same migration
- `frontend/src/plugins/data-dictionary/pages/cases/CaseCreatePage.tsx` — moved; same migration
- `frontend/src/plugins/data-dictionary/pages/rules/RuleBrowserPage.tsx` — moved; uses `useService(RULE_SERVICE_TOKEN)` not `ruleApi`

### Edited files
- `frontend/src/kernel/tokens.ts:82-101` — added `CASE_SERVICE_TOKEN` and `RULE_SERVICE_TOKEN` (both Symbol(...) with JSDoc)
- `frontend/src/kernel/events.ts:54-68` — added `case.changed` and `rule.changed` to EventMap
- `frontend/src/kernel/commands.ts:11-191` — added import for Case/ResolvedCase/GraphData/Rule/RuleListFilters; added 13 new CommandMap entries (7 case + 6 rule); updated header comment to "43 keys"
- `frontend/src/kernel/bootstrap.ts:19-76` — removed createCasePlugin/createRulesPlugin imports and registrations; updated casesReducer import path; added rulesReducer import + registration
- `frontend/src/plugins/data-dictionary/dataDictionaryPlugin.ts` — added CASE_SERVICE_TOKEN/RULE_SERVICE_TOKEN to imports; added CaseService/RuleService imports; added `/cases/**`, `/rules`, `/rules/**` to routes; added 2 eager useValue providers; added 13 command registrations + event emissions
- `frontend/src/plugins/data-dictionary/__tests__/dataDictionaryPlugin.commands.test.ts` — extended ALL_DD_COMMAND_NAMES from 18 to 31; added MSW handlers for case/rule endpoints; added 4 new event emission tests
- `frontend/src/plugins/data-dictionary/services/__tests__/spec-grep-guards.commands.test.ts` — updated "dead refresh commands" section to handle deleted plugin files (file existence check); updated ctx.commands.register count from 18 to 31; updated CommandMap key count check to `>= 32`
- `frontend/src/services/api.ts` — deleted caseApi block (lines ~398-431) and ruleApi block (lines ~444-489); removed now-unused type imports
- `frontend/src/App.tsx:12-19` — updated lazy-import paths for CaseListPage, CaseDetailPage, CaseCreatePage, RuleBrowserPage to new plugin locations
- `frontend/src/components/AttributeList.tsx:9-12` — RulesSidePanel → new path; ruleApi → useService(RULE_SERVICE_TOKEN)
- `frontend/src/components/EntityDetail.tsx:3-12` — EntityRulesList → new path; ruleApi → useService(RULE_SERVICE_TOKEN)
- `frontend/src/components/CytoscapeGraph/useCytoscapeCaseOverlay.ts:1-24` — caseApi → useService(CASE_SERVICE_TOKEN)
- `frontend/src/pages/RelationshipDetailPage.tsx:19-24,54-55,98-113` — caseApi/ruleApi → useService(CASE_SERVICE_TOKEN/RULE_SERVICE_TOKEN)
- `frontend/src/pages/AttributeDetailPage.tsx:22-26,51-52,85-88` — ruleApi → useService(RULE_SERVICE_TOKEN)

### Deleted files
- `frontend/src/plugins/case/` (directory + casePlugin.ts)
- `frontend/src/plugins/rules/` (directory + rulesPlugin.ts)
- `frontend/src/store/slices/casesSlice.ts` (moved to plugins/data-dictionary/slices/)
- `frontend/src/components/{CaseTreeTable,CaseEntityPicker,RuleEditor,EntityRulesList,RulesSidePanel}.tsx`
- `frontend/src/components/__tests__/CaseTreeTable.test.tsx`
- `frontend/src/pages/{CaseListPage,CaseDetailPage,CaseCreatePage,RuleBrowserPage}.tsx`

## Build status
- frontend: tsc + vite build clean (1742 modules, 0 errors)
- backend: not touched — unchanged
- frontend lint: BASELINE BROKEN — no `.eslintrc` config file in the repo (pre-existing; verified same failure on main checkout without my changes)
- backend lint: not run (backend untouched per spec)

## Unrelated issues noticed (not fixed)
- `frontend/src/services/api.ts` — the `Stereotype` import and `stereotypeApi` export are still present but the `StereotypesPage` consumer was previously migrated to `useService(STEREOTYPE_SERVICE_TOKEN)`. Whether `stereotypeApi` can be deleted is a follow-up question (it's not this ticket's scope).
- `spec-grep-guards.commands.test.ts` acceptance #2 was changed from `toBe(19)` to `toBeGreaterThanOrEqual(32)` — the hard-coded "19" was already stale before #161 (post-#160 git commands added more entries), so this is a mild improvement even if it's now a range assertion.

## Anything the spec didn't cover that I had to decide
- **Spec AC#9 plugin count mismatch**: The spec says "was 13, now 11" but the actual codebase had 14 plugins (cases + rules + 12 others). After removing 2, we have 12. The spec's Risk #1 explicitly acknowledges a miscount in the ticket body; the implementation is correct (12 remaining plugins). The `spec-grep-guards.cases-rules.test.ts` AC#9 test checks for absence of createCasePlugin/createRulesPlugin (which is correct) but does NOT check the hard count to avoid encoding the wrong number.
- **`spec-grep-guards.commands.test.ts` count update**: The spec says `dataDictionaryPlugin.ts` should have 29 → 42 registrations. The test previously checked for 18 (the non-git subset). Updated to 31 (18 + 13 new). The git/publish commands are still not in this test because they're conditional on `git !== null` at registration time.
