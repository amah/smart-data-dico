# Spec — #161: arch: fold cases and rules into data-dictionary core

## Goal

Delete the `case` and `rules` plugin folders. Move all their domain assets — the existing `casesSlice`, a newly-created `rulesSlice`, two new Pattern-B services (`CaseService`, `RuleService`), and the affected pages/components — under `frontend/src/plugins/data-dictionary/` as **internal modules**. The data-dictionary plugin's `initialize` lifecycle absorbs the route registrations the deleted plugins used to do (`routes.case`, `routes.rules`) and gains command registrations for the new services. From the ticket: *"Keep them as internal modules with clear sub-folders, not as plugin boundaries."* Backend is already correctly grouped by #157 (`backend/src/routes/data-dictionary/case.routes.ts`, `rule.routes.ts`) and is **out of scope** for code changes here — but the spec includes a passing grep guard so the layout cannot regress. The contract for consumers is: import paths change once, no shims/re-exports, every old path is deleted.

## Files touched

### New files
- `frontend/src/plugins/data-dictionary/services/CaseService.ts` — Pattern B (REST wrapper around `/api/cases/**`), constructor-injected `AxiosInstance`, mirrors `IntegrityService.ts` shape.
- `frontend/src/plugins/data-dictionary/services/RuleService.ts` — Pattern B (REST wrapper around `/api/rules/**` + `/api/entities/:uuid/rules`), same shape.
- `frontend/src/plugins/data-dictionary/services/__tests__/CaseService.test.ts` — vitest unit suite using constructor-injected stub `AxiosInstance` (same shape as `IntegrityService.test.ts`).
- `frontend/src/plugins/data-dictionary/services/__tests__/RuleService.test.ts` — same shape.
- `frontend/src/plugins/data-dictionary/services/__tests__/spec-grep-guards.cases-rules.test.ts` — content guards: forbidden imports, old folders absent, slice locations, etc. (Single consolidated file mirroring `spec-grep-guards.integrity.test.ts`.)
- `frontend/src/plugins/data-dictionary/slices/casesSlice.ts` — moved from `frontend/src/store/slices/casesSlice.ts` (verbatim, only the relative-path imports adjust by one extra `..`).
- `frontend/src/plugins/data-dictionary/slices/rulesSlice.ts` — newly created; mirrors casesSlice shape; replaces local `useState<Rule[]>` in `RuleBrowserPage` (see Public surface below).
- `frontend/src/plugins/data-dictionary/components/cases/CaseTreeTable.tsx` — moved from `frontend/src/components/CaseTreeTable.tsx`.
- `frontend/src/plugins/data-dictionary/components/cases/CaseEntityPicker.tsx` — moved from `frontend/src/components/CaseEntityPicker.tsx`.
- `frontend/src/plugins/data-dictionary/components/cases/__tests__/CaseTreeTable.test.tsx` — moved from `frontend/src/components/__tests__/CaseTreeTable.test.tsx`.
- `frontend/src/plugins/data-dictionary/components/rules/RuleEditor.tsx` — moved from `frontend/src/components/RuleEditor.tsx`.
- `frontend/src/plugins/data-dictionary/components/rules/EntityRulesList.tsx` — moved from `frontend/src/components/EntityRulesList.tsx`.
- `frontend/src/plugins/data-dictionary/components/rules/RulesSidePanel.tsx` — moved from `frontend/src/components/RulesSidePanel.tsx`.
- `frontend/src/plugins/data-dictionary/pages/cases/CaseListPage.tsx` — moved from `frontend/src/pages/CaseListPage.tsx`.
- `frontend/src/plugins/data-dictionary/pages/cases/CaseDetailPage.tsx` — moved from `frontend/src/pages/CaseDetailPage.tsx`.
- `frontend/src/plugins/data-dictionary/pages/cases/CaseCreatePage.tsx` — moved from `frontend/src/pages/CaseCreatePage.tsx`.
- `frontend/src/plugins/data-dictionary/pages/rules/RuleBrowserPage.tsx` — moved from `frontend/src/pages/RuleBrowserPage.tsx`.

### Edited files
- `frontend/src/kernel/tokens.ts` — add `CASE_SERVICE_TOKEN` and `RULE_SERVICE_TOKEN` (both `Symbol(...)`) with the same documentation shape used for `INTEGRITY_SERVICE_TOKEN` (lines 71). Per the ticket: *"`CASE_SERVICE_TOKEN`, `RULE_SERVICE_TOKEN` confirmed."*
- `frontend/src/kernel/bootstrap.ts` — three changes:
  1. Delete the `createCasePlugin` and `createRulesPlugin` imports (current lines 20–21).
  2. Delete the two `host.registerPlugin('cases', …)` / `host.registerPlugin('rules', …)` blocks (current lines 160–171).
  3. Update the `casesReducer` import path from `'../store/slices/casesSlice'` (current line 32) to `'../plugins/data-dictionary/slices/casesSlice'`; add a new `rulesReducer` import from `'../plugins/data-dictionary/slices/rulesSlice'`; add `reducerRegistry.register('rules', rulesReducer)` alongside the existing `'cases'` registration (after current line 68).
- `frontend/src/plugins/data-dictionary/dataDictionaryPlugin.ts` — six additions:
  1. Add `CASE_SERVICE_TOKEN`, `RULE_SERVICE_TOKEN` to the existing imports from `'../../kernel/tokens'`.
  2. Add `CaseService` and `RuleService` imports.
  3. Inside `initialize`, after the existing `ImportExportService` block (current lines 112–116), add `ctx.provide({ provide: CASE_SERVICE_TOKEN, useValue: new CaseService() })` and `ctx.provide({ provide: RULE_SERVICE_TOKEN, useValue: new RuleService() })`. Both are Pattern B eager `useValue` providers (cookbook §3b).
  4. Extend the existing `ctx.views.register('routes.data-dictionary', …)` block (current lines 51–58) to include `'/cases/**'` and `'/rules/**'` and `'/rules'` (the rules plugin previously registered both `/rules` and `/rules/**` — preserve both).
  5. Resolve both new services after the existing `ie` resolve (current line 123): `const cs = ctx.resolve<CaseService>(CASE_SERVICE_TOKEN); const rs = ctx.resolve<RuleService>(RULE_SERVICE_TOKEN);`.
  6. Register the 14 new commands (7 case + 7 rule — see Public surface). Each handler awaits the service method and returns its result; the four mutating commands also emit a typed event (`case.changed` / `rule.changed`).
- `frontend/src/kernel/commands.ts` — append 14 new keys to `CommandMap` (see Public surface). Update the header comment `Total: 19 (pre-#160 baseline) + 11 (#160: git + publish) = 30 keys` → `Total: 19 (#163) + 11 (#160: git+publish) + 14 (#161: case+rule) = 44 keys`.
- `frontend/src/kernel/events.ts` — append `'case.changed': { uuid: string; op: 'create' | 'update' | 'delete' }` and `'rule.changed': { uuid: string; op: 'create' | 'update' | 'delete' }` to `EventMap`. Match the shape of the existing `stereotype.changed` entry.
- `frontend/src/plugins/data-dictionary/__tests__/dataDictionaryPlugin.commands.test.ts` — extend the `ALL_DD_COMMAND_NAMES` array (current line 38) with the 14 new command names, and add MSW handlers + emission tests for `case.changed` and `rule.changed` (mirroring the existing `stereotype.changed` test at lines 145–172).
- `frontend/src/services/api.ts` — delete the `caseApi` block (current lines 336–370) and the `ruleApi` block (current lines 419–464). No shim, no re-export.
- All consumers of `caseApi` / `ruleApi` outside `services/api.ts` migrate to `useService(CASE_SERVICE_TOKEN)` / `useService(RULE_SERVICE_TOKEN)` — exhaustive list (verified by grep):
  - `frontend/src/components/RuleEditor.tsx` → moved + rewritten to call `RuleService` via `useService`.
  - `frontend/src/components/AttributeList.tsx` (line 11, 145) → `useService(RULE_SERVICE_TOKEN)` for `.getRulesForEntity(uuid)`.
  - `frontend/src/components/EntityDetail.tsx` (line 3, 113) → same.
  - `frontend/src/components/CytoscapeGraph/useCytoscapeCaseOverlay.ts` (line 3, 23) → `useService(CASE_SERVICE_TOKEN)` for `.resolve(id)`.
  - `frontend/src/pages/RelationshipDetailPage.tsx` (lines 21–23, 99, 110) → both services.
  - `frontend/src/pages/AttributeDetailPage.tsx` (line 25, 87) → `RuleService`.
  - `frontend/src/store/slices/casesSlice.ts` → moved (uses CaseService from inside the slice, see Public surface).
- `frontend/src/App.tsx` (or wherever routes are wired — verify) — update lazy-import paths for `CaseListPage`, `CaseDetailPage`, `CaseCreatePage`, `RuleBrowserPage` to point at the new locations.

### Deleted files
- `frontend/src/plugins/case/casePlugin.ts` — folder `frontend/src/plugins/case/` empty and itself deleted.
- `frontend/src/plugins/rules/rulesPlugin.ts` — folder `frontend/src/plugins/rules/` empty and itself deleted.
- `frontend/src/store/slices/casesSlice.ts` — moved (the source path no longer exists).
- `frontend/src/components/CaseTreeTable.tsx`, `CaseEntityPicker.tsx`, `RuleEditor.tsx`, `EntityRulesList.tsx`, `RulesSidePanel.tsx` — moved.
- `frontend/src/pages/CaseListPage.tsx`, `CaseDetailPage.tsx`, `CaseCreatePage.tsx`, `RuleBrowserPage.tsx` — moved.
- `frontend/src/components/__tests__/CaseTreeTable.test.tsx` — moved.

## Public surface (signatures)

```ts
// frontend/src/kernel/tokens.ts (additions)
export const CASE_SERVICE_TOKEN = Symbol('CaseService');
export const RULE_SERVICE_TOKEN = Symbol('RuleService');
```

```ts
// frontend/src/plugins/data-dictionary/services/CaseService.ts
import axios, { type AxiosInstance } from 'axios';
import type { Case, ResolvedCase, CaseNode, GraphData } from '../../../types';

export class CaseService {
  constructor(http?: AxiosInstance);
  getAll(): Promise<Case[]>;
  getById(id: string): Promise<Case>;
  create(data: Partial<Case>): Promise<{ data: Case }>;
  update(id: string, data: Partial<Case>): Promise<{ data: Case }>;
  delete(id: string): Promise<void>;
  resolve(id: string): Promise<ResolvedCase>;
  getGraphData(id: string): Promise<GraphData>;
  upsertNode(id: string, node: CaseNode): Promise<{ data: Case }>;
}
```

```ts
// frontend/src/plugins/data-dictionary/services/RuleService.ts
import axios, { type AxiosInstance } from 'axios';
import type {
  Rule,
  RuleScope,
  RuleSeverityValue,
  RuleEnforcement,
} from '../../../types';

export interface RuleListFilters {
  scope?: RuleScope;
  severity?: RuleSeverityValue;
  enforcement?: RuleEnforcement;
  targetUuid?: string;
  case?: string;
  package?: string;
}

export class RuleService {
  constructor(http?: AxiosInstance);
  list(filters?: RuleListFilters): Promise<Rule[]>;
  get(uuid: string): Promise<Rule>;
  getRulesForEntity(entityUuid: string): Promise<Rule[]>;
  create(rule: Partial<Rule>): Promise<Rule>;
  update(uuid: string, rule: Partial<Rule>): Promise<Rule>;
  delete(uuid: string): Promise<void>;
}
```

> Method shapes match the existing `caseApi` (`services/api.ts:337–370`) and `ruleApi` (`services/api.ts:420–464`) exactly — only the constructor / auth-header plumbing is new (copied from `IntegrityService.createDefaultHttp()`). This minimises consumer churn: a call-site that did `caseApi.resolve(id)` becomes `useService<CaseService>(CASE_SERVICE_TOKEN).resolve(id)` with the same return type.

```ts
// frontend/src/plugins/data-dictionary/slices/casesSlice.ts
// Verbatim move of frontend/src/store/slices/casesSlice.ts, with two import
// adjustments:
//   - `import { caseApi } from '../../services/api'` → REMOVED.
//   - Thunks construct an ad-hoc CaseService via `new CaseService()` at call
//     time. (Slice cannot use `useService` — not a React context. Direct
//     instantiation is acceptable here because the slice is owned by the
//     same plugin that registers the service.)
// All five thunk names and the reducer name stay identical, so existing
// `state.cases` selectors and dispatches keep working unchanged.
export const fetchCases: AsyncThunk<Case[], void, {}>;
export const resolveCase: AsyncThunk<ResolvedCase, string, {}>;
export const createCaseAction: AsyncThunk<Case, Partial<Case>, {}>;
export const updateCaseAction: AsyncThunk<Case, { id: string; data: Partial<Case> }, {}>;
export const deleteCaseAction: AsyncThunk<string, string, {}>;
export const { clearCurrent }: { clearCurrent: ActionCreatorWithoutPayload };
export default casesReducer; // (CasesState reducer)
```

```ts
// frontend/src/plugins/data-dictionary/slices/rulesSlice.ts (new)
// Shape derived from the codebase grep of ruleApi consumers:
//   - RuleBrowserPage uses ruleApi.list({scope, severity, enforcement}) and
//     keeps local `rules: Rule[]`, `loading`, `error`.
//   - RuleEditor / EntityRulesList / AttributeList / EntityDetail /
//     RelationshipDetailPage / AttributeDetailPage call
//     ruleApi.getRulesForEntity(uuid). Per-entity state is keyed by UUID.
interface RulesState {
  /** Last full list returned by `list(...)`, used by RuleBrowserPage. */
  list: Rule[];
  /** Per-entity caches keyed by entityUuid, populated by `getRulesForEntity`. */
  byEntityUuid: Record<string, Rule[]>;
  loading: boolean;
  error: string | null;
}
export const fetchRules: AsyncThunk<Rule[], RuleListFilters | undefined, {}>;
export const fetchRulesForEntity: AsyncThunk<{ entityUuid: string; rules: Rule[] }, string, {}>;
export const createRuleAction: AsyncThunk<Rule, Partial<Rule>, {}>;
export const updateRuleAction: AsyncThunk<Rule, { uuid: string; data: Partial<Rule> }, {}>;
export const deleteRuleAction: AsyncThunk<string, string, {}>;
export default rulesReducer;
```

```ts
// frontend/src/plugins/data-dictionary/dataDictionaryPlugin.ts
//   …existing initialize body…
ctx.provide({ provide: CASE_SERVICE_TOKEN, useValue: new CaseService() });
ctx.provide({ provide: RULE_SERVICE_TOKEN, useValue: new RuleService() });
const cs = ctx.resolve<CaseService>(CASE_SERVICE_TOKEN);
const rs = ctx.resolve<RuleService>(RULE_SERVICE_TOKEN);

// Case — 7 commands.
ctx.commands.register('data-dictionary.case.list',         () => cs.getAll());
ctx.commands.register('data-dictionary.case.getById',      ({ id }: { id: string }) => cs.getById(id));
ctx.commands.register('data-dictionary.case.resolve',      ({ id }: { id: string }) => cs.resolve(id));
ctx.commands.register('data-dictionary.case.getGraphData', ({ id }: { id: string }) => cs.getGraphData(id));
ctx.commands.register('data-dictionary.case.create',       async ({ data }: { data: Partial<Case> }) => {
  const res = await cs.create(data);
  ctx.hooks.emit('case.changed', { uuid: res.data.uuid, op: 'create' });
  return res;
});
ctx.commands.register('data-dictionary.case.update',       async ({ id, data }: { id: string; data: Partial<Case> }) => {
  const res = await cs.update(id, data);
  ctx.hooks.emit('case.changed', { uuid: id, op: 'update' });
  return res;
});
ctx.commands.register('data-dictionary.case.delete',       async ({ id }: { id: string }) => {
  await cs.delete(id);
  ctx.hooks.emit('case.changed', { uuid: id, op: 'delete' });
});

// Rule — 7 commands.
ctx.commands.register('data-dictionary.rule.list',                ({ filters }: { filters?: RuleListFilters }) => rs.list(filters));
ctx.commands.register('data-dictionary.rule.get',                 ({ uuid }: { uuid: string }) => rs.get(uuid));
ctx.commands.register('data-dictionary.rule.getRulesForEntity',   ({ entityUuid }: { entityUuid: string }) => rs.getRulesForEntity(entityUuid));
ctx.commands.register('data-dictionary.rule.create',              async ({ data }: { data: Partial<Rule> }) => {
  const created = await rs.create(data);
  ctx.hooks.emit('rule.changed', { uuid: created.uuid, op: 'create' });
  return created;
});
ctx.commands.register('data-dictionary.rule.update',              async ({ uuid, data }: { uuid: string; data: Partial<Rule> }) => {
  const updated = await rs.update(uuid, data);
  ctx.hooks.emit('rule.changed', { uuid, op: 'update' });
  return updated;
});
ctx.commands.register('data-dictionary.rule.delete',              async ({ uuid }: { uuid: string }) => {
  await rs.delete(uuid);
  ctx.hooks.emit('rule.changed', { uuid, op: 'delete' });
});
// (Note: `case.upsertNode` is intentionally NOT exposed as a command in this
// slice — only `CaseEntityPicker` calls it, internal to the plugin; the
// service method stays on the public surface but no cross-plugin caller
// needs the command. Keeping the command surface minimal per #163's
// "one-for-one mapping" guideline.)
```

```ts
// frontend/src/kernel/commands.ts (additions to CommandMap)
'data-dictionary.case.list':              { input: void;                                  output: Case[]; };
'data-dictionary.case.getById':           { input: { id: string };                        output: Case; };
'data-dictionary.case.resolve':           { input: { id: string };                        output: ResolvedCase; };
'data-dictionary.case.getGraphData':      { input: { id: string };                        output: GraphData; };
'data-dictionary.case.create':            { input: { data: Partial<Case> };               output: { data: Case }; };
'data-dictionary.case.update':            { input: { id: string; data: Partial<Case> };   output: { data: Case }; };
'data-dictionary.case.delete':            { input: { id: string };                        output: void; };
'data-dictionary.rule.list':              { input: { filters?: RuleListFilters };         output: Rule[]; };
'data-dictionary.rule.get':               { input: { uuid: string };                      output: Rule; };
'data-dictionary.rule.getRulesForEntity': { input: { entityUuid: string };                output: Rule[]; };
'data-dictionary.rule.create':            { input: { data: Partial<Rule> };               output: Rule; };
'data-dictionary.rule.update':            { input: { uuid: string; data: Partial<Rule> }; output: Rule; };
'data-dictionary.rule.delete':            { input: { uuid: string };                      output: void; };
```

> 13 keys (not 14): `case.upsertNode` is excluded per the note in the plugin block above. Reconciles with the prompt's *"Count them based on the actual service method surfaces"*.

```ts
// frontend/src/kernel/events.ts (additions to EventMap)
'case.changed': { uuid: string; op: 'create' | 'update' | 'delete' };
'rule.changed': { uuid: string; op: 'create' | 'update' | 'delete' };
```

## Framework APIs used

All of these are already in use by `dataDictionaryPlugin.ts` today; no new framework surface is introduced.

- `@hamak/microkernel-spi` — `PluginModule`, `InitializationContext`. Existing in `dataDictionaryPlugin.ts` lines 9, 47. Verified at `frontend/node_modules/@hamak/microkernel-spi/dist/types.d.ts`.
- `@hamak/microkernel-api` — `Hooks`. Already used by `frontend/src/kernel/events.ts:6`. Verified at `frontend/node_modules/@hamak/microkernel-api/dist/types.d.ts` (the `Hooks.emit(event, ...args)` signature is what `events.ts` documents at lines 51–55).
- `ctx.provide({ provide, useValue })` — eager DI provider; cookbook §3b confirms this is the Pattern B canonical form.
- `ctx.resolve<T>(token)` — DI lookup; cookbook §3a confirms the post-`initialize` ordering.
- `ctx.commands.register(name, handler)` — command registration; the existing 29 registrations in `dataDictionaryPlugin.ts:127–236` establish the pattern. Verified at `frontend/node_modules/@hamak/microkernel-api/dist/types.d.ts` (`CommandRegistry.register(id: string, handler: ...) => void`).
- `ctx.hooks.emit(event, payload)` — typed via the `emit()` helper in `events.ts`; the existing `stereotype.changed` emit at `dataDictionaryPlugin.ts:132` is the precedent.
- `ctx.views.register('routes.<name>', () => ({ routes: [...] }))` — documentation-only registration; verified at the four existing call-sites (`searchPlugin.ts:16`, `visualizationPlugin.ts:13`, `dataDictionaryPlugin.ts:51`, `dataDictionaryPlugin.ts:241`). The two deleted plugins (`casePlugin.ts:6`, `rulesPlugin.ts:11`) used the same shape.
- `axios.create({ baseURL, headers })` + `instance.interceptors.request.use(...)` — exact pattern from `IntegrityService.createDefaultHttp()` (`IntegrityService.ts:60–74`). Both new services use this verbatim.

No reads of `.js` runtime files are required because: (a) every API used here is already exercised by the merged `IntegrityService` / `DiffService` / `ImportExportService` slices, all of which passed bootstrap tests; (b) the spec adds no new factory functions, no new lifecycle hooks, no new framework imports.

## Acceptance criteria

Mechanical checks first (each is a single shell command or grep). Then bootstrap-level and behavioral checks.

### A. Structural — folder layout
1. **`frontend/src/plugins/case/` does not exist.** Verify: `test ! -d frontend/src/plugins/case && echo OK`.
2. **`frontend/src/plugins/rules/` does not exist.** Verify: `test ! -d frontend/src/plugins/rules && echo OK`.
3. **`frontend/src/plugins/data-dictionary/services/CaseService.ts` exists** and exports `class CaseService`. Verify: `grep -q '^export class CaseService' frontend/src/plugins/data-dictionary/services/CaseService.ts`.
4. **`frontend/src/plugins/data-dictionary/services/RuleService.ts` exists** and exports `class RuleService`. Same grep shape.
5. **`frontend/src/plugins/data-dictionary/slices/casesSlice.ts` exists**; `frontend/src/store/slices/casesSlice.ts` **does not exist**. Both as `test`/`grep` pair.
6. **`frontend/src/plugins/data-dictionary/slices/rulesSlice.ts` exists** and exports `default rulesReducer`. Verify: `grep -q 'export default.*rulesSlice.reducer\|export default rulesReducer' frontend/src/plugins/data-dictionary/slices/rulesSlice.ts`.
7. **All 8 case/rule pages and components are at their new locations**, and the corresponding old paths don't exist. Single grep loop over the list under "Files touched / Deleted files" suffices.

### B. Bootstrap — plugin registration
8. **`frontend/src/kernel/bootstrap.ts` does NOT import `createCasePlugin` or `createRulesPlugin`.** Verify: `! grep -q 'createCasePlugin\|createRulesPlugin' frontend/src/kernel/bootstrap.ts`.
9. **`bootstrap.ts` registers exactly 11 plugins** (was 13). Verify: `[ "$(grep -c 'host.registerPlugin' frontend/src/kernel/bootstrap.ts)" = "11" ]`.
10. **The 11 plugin names are exactly:** `store`, `shell`, `auth`, `data-dictionary`, `visualization`, `search`, `remote-fs`, `store-fs`, `git`, `logging`, `notification`. (See risk #1 — the ticket body's *"10 (see resulting architecture below)"* does NOT match the codebase because (a) `ai-assistance` plugin does not exist yet and (b) the body undercounts `store-fs` and `logging`. Following the codebase, not the body.)
11. **`bootstrap.ts` imports `rulesReducer`** from `'../plugins/data-dictionary/slices/rulesSlice'` and **registers** it via `reducerRegistry.register('rules', rulesReducer)`. Verify with two grep lines.

### C. Bootstrap — DI registration (runtime)
12. **After `bootstrapApplication()`, `host.rootActivationCtx.resolve(CASE_SERVICE_TOKEN)` returns a `CaseService` instance** with `getAll`, `getById`, `create`, `update`, `delete`, `resolve`, `getGraphData`, `upsertNode` methods. Test analogous to `dataDictionaryPlugin.integrity.test.ts:40–46`.
13. **Same for `RULE_SERVICE_TOKEN` → `RuleService`** with `list`, `get`, `getRulesForEntity`, `create`, `update`, `delete`.
14. **Repeated resolution returns the same singleton.** Mirrors `dataDictionaryPlugin.integrity.test.ts:48–53`.

### D. Commands — registration + emission
15. **All 13 new commands are registered.** Extend `ALL_DD_COMMAND_NAMES` in `dataDictionaryPlugin.commands.test.ts` from 18 to 31 entries (Risk #4) and let the existing loop assert `ctx.commands.has(name) === true` for each.
16. **`data-dictionary.case.create` emits `case.changed` with `{ uuid, op: 'create' }`.** MSW: stub `POST /api/cases` to return `{ data: { uuid: 'c-1', name: 'X', rootEntities: [] } }`; subscribe via `ctx.hooks.on('case.changed', listener)`; run the command; assert payload.
17. **`data-dictionary.rule.update` emits `rule.changed` with `{ uuid, op: 'update' }`.** MSW: stub `PUT /api/rules/:uuid`; same shape.
18. **`data-dictionary.case.delete` emits `case.changed` with `op: 'delete'`** (handler awaits a 204; emission carries the input `id` as `uuid`). MSW: stub `DELETE /api/cases/:id`.
19. **`data-dictionary.rule.delete` emits `rule.changed` with `op: 'delete'`.** Same shape.

### E. Service-level — unit tests (constructor-injected stub)
20. **`CaseService.test.ts`** asserts: `getAll()` hits `GET /cases`; `resolve(id)` hits `GET /cases/${id}/resolve`; envelope unwrap returns inner shape (mirrors `IntegrityService.test.ts:80–95`); rejection bubbles (line 97–102 shape).
21. **`RuleService.test.ts`** asserts: `list({scope: 'entity'})` hits `GET /rules?scope=entity`; `getRulesForEntity(uuid)` hits `GET /entities/${uuid}/rules`; envelope unwrap; rejection bubbles.
22. **Default-construction (no http arg) does not throw and yields a usable instance** for both services. Mirrors `IntegrityService.test.ts:104–112`.

### F. Spec-grep guards (anti-regression)
23. **`services/api.ts` no longer exports `caseApi` or `ruleApi`.** Verify: `! grep -E '^export const (caseApi|ruleApi)\b' frontend/src/services/api.ts`.
24. **No identifier `caseApi` or `ruleApi` survives in `frontend/src/**` outside the guard file.** Walker pattern from `spec-grep-guards.integrity.test.ts:166–191`, with the guard file itself excluded by suffix.
25. **`CASE_SERVICE_TOKEN` and `RULE_SERVICE_TOKEN` are each declared exactly once in `tokens.ts`** with `Symbol(...)` value. Verify by regex count, mirroring `spec-grep-guards.integrity.test.ts:80–87`.
26. **`CaseService.ts` and `RuleService.ts` do NOT import from `services/api`** (Pattern B self-contained-axios rule from cookbook §3b anti-patterns). Verify: `! grep -E "from\s+['\"][^'\"]*services/api['\"]" frontend/src/plugins/data-dictionary/services/{Case,Rule}Service.ts`.
27. **Provider blocks for both tokens appear inside `initialize()` (NOT `activate()`) and use `useValue` (NOT `useClass`/`useFactory`).** Mirrors `spec-grep-guards.integrity.test.ts:98–126`.

### G. Backend (no code change; layout guard only)
28. **`backend/src/routes/data-dictionary/case.routes.ts` and `rule.routes.ts` exist** and are both `router.use(...)`-mounted in `backend/src/routes/data-dictionary/index.ts` (lines 24–25 in current code). Verify by file existence + grep.
29. **No top-level `backend/src/routes/cases/` or `backend/src/routes/rules/` folders** exist. Verify: `test ! -d backend/src/routes/cases && test ! -d backend/src/routes/rules`.

### H. Behavior
30. **`/cases` route loads `CaseListPage` and renders the list** when MSW stubs `GET /api/cases`. Existing manual smoke; can also be a Vitest + RTL test if the prior CaseListPage had one (it does not — current `frontend/src/pages/__tests__` has no `CaseListPage.test.tsx`).
31. **`/rules` route loads `RuleBrowserPage` and renders rows** when MSW stubs `GET /api/rules`. Same shape.
32. **Both pages, after refactor, resolve their services via `useService(...)` — NOT via direct axios import.** Spec-grep: page files must contain `useService(CASE_SERVICE_TOKEN)` resp. `useService(RULE_SERVICE_TOKEN)` and must NOT import from `'../services/api'` or `'../../services/api'`.

### I. Build + lint
33. **`cd frontend && npm run build` succeeds.** No compile errors after path moves; CommandMap additions type-check against `commands.test.ts`'s extended `ALL_DD_COMMAND_NAMES`.
34. **`cd frontend && npm run lint` succeeds.** No unused-import warnings on `bootstrap.ts` after the two plugin-import deletions.

## Out of scope

- Cookbook §4 "Commands and events" fill-in. The prompt explicitly says: *"Out of scope: cookbook §4 (commands+events) — not filled in this ticket."* The added `case.changed` / `rule.changed` events would be perfect worked examples for §4, but documenting them is deferred (likely #163's follow-up or a dedicated docs ticket).
- Migrating other slices (`entitySlice`, `dictionarySlice`, `packagesSlice`, `stereotypesSlice`, `searchSlice`, `diagramSlice`, etc.) from `frontend/src/store/slices/` into their owning plugins. Per the ticket: *"This is identical pattern to what #154 will later do for ALL slices — this ticket does it for just cases + rules as a forerunner."*
- Backend reorganisation. `case.routes.ts` and `rule.routes.ts` are already correctly grouped under `backend/src/routes/data-dictionary/` per #157. Controllers (`caseController`, `ruleController`) and services (`caseService.ts`, `ruleService.ts`) keep their current locations — ticket §"Backend" explicitly states: *"Controllers and services stay where they are — backend isn't reorganizing controllers in this ticket."*
- Refactoring case or rule internal logic, data model, or business behavior. Ticket §"Out of scope" lines 1–3 verbatim.
- Promoting `RuleBrowserPage`'s ephemeral `useState<Rule[]>` into the new `rulesSlice`. The new slice's `fetchRules` thunk exists, but converting the page to consume it is deferred — Pattern B page-level `useState` for fetched data is allowed by cookbook §3b for REST-only services (the cookbook explicitly: *"Pattern B's loading/error live in the page (§1.5 ephemeral-UI carve-out applies only because there is no Store FS node)"*). Slice will be populated by `extraReducers` once a future Pattern A migration adds Store FS support for rules; until then, the slice's `list` field is unused by the page. (This satisfies the prompt's *"decide its shape based on ruleApi's existing state usage"* — shape is correct now, consumption is later.)
- Migrating callers of `useService(CASE_SERVICE_TOKEN)` / `useService(RULE_SERVICE_TOKEN)` to the command bus (i.e., `useCommand()(name, input)`). Per #163's precedent (IntegrityPage migrated; service-direct callers were not banned), service-direct calls are still permitted. A follow-up ticket can sweep them onto commands.

## Dependencies

- **Builds on #160** (merged, commit `9c9841f`): the git plugin renaming and its dependent ordering. Touched `bootstrap.ts`; this ticket re-touches the same file. No conflict — separate line ranges.
- **Builds on #163** (merged, commit `298dc65`): the 29 command registrations + typed `CommandMap` + `EventMap`. This ticket extends both data structures; the patterns are established.
- **Builds on #164** (merged, commit `e1cd826`): metadata extension point. No direct interaction; this ticket only inserts new providers alongside `METADATA_TYPE_REGISTRY_TOKEN`.
- **Builds on #157** (merged, commit `f871e1d`): backend route grouping. Backend AC #28–29 verifies the existing layout.
- **Coordinates with #154** (open): when #154 lands and moves ALL slices into plugins, the `casesSlice` and `rulesSlice` paths chosen here MUST match its final layout (`frontend/src/plugins/data-dictionary/slices/`). The ticket body confirms: *"Updates the slice locations promised in #154."*
- **Coordinates with #155** (open): the service catalog. The two new tokens (`CASE_SERVICE_TOKEN`, `RULE_SERVICE_TOKEN`) become part of that catalog; #155's spec must list them.

This ticket is **not blocked** — every prerequisite is on `main`.

## Risks

1. **Plugin count miscount in the ticket body** — the ticket says *"exactly the agreed plugin set: store, shell, auth, notification, remote-fs, git, data-dictionary, ai-assistance, visualization, search (10)"*. The codebase has 13 plugins today (verified by `grep -c host.registerPlugin frontend/src/kernel/bootstrap.ts`), and post-ticket has 11. The body's list (a) lacks `store-fs` and `logging`, and (b) names `ai-assistance` which does not exist yet (`ls frontend/src/plugins/` confirms). **Mitigation:** AC #9–#10 are pegged to *the actual post-ticket count and names* (11, with `store-fs` and `logging` included, without `ai-assistance`), and risk #1 is flagged here so reviewers know the implementation does NOT follow the body verbatim.

2. **Slice cannot use `useService`** — `casesSlice.ts` thunks today call `caseApi.getAll()` at module-import time. The new slice has to construct a `CaseService` instance somehow. Three options: (a) `new CaseService()` per thunk call, (b) module-level singleton, (c) inject the service into the thunk via the `thunkAPI.extra` argument. (a) is simplest and matches the per-thunk allocation cost; the service's only state is its `AxiosInstance`, which itself shares an underlying transport. **Mitigation:** spec mandates option (a) for both case and rule slices (see Public surface comment on `casesSlice.ts`). If the team later wants DI-purity for slices, that's a separate slice-architecture refactor.

3. **`case.upsertNode` has no command equivalent** — by design (only one in-plugin caller), but if a future feature needs cross-plugin upsert it must add the command then. **Mitigation:** the command surface is open for extension; nothing here prevents adding `data-dictionary.case.upsertNode` later.

4. **`ALL_DD_COMMAND_NAMES` array drift** — `dataDictionaryPlugin.commands.test.ts:38–57` currently lists 18 entries but the plugin registers 29 (it excludes the 11 git/publish commands because they're conditional on `git !== null`). Adding 13 new entries here brings the test array to 31 — but the runtime registration count rises to 42 (29 + 13). The test's `for (const name of ALL_DD_COMMAND_NAMES)` only asserts the listed names exist; it does not assert "exactly these and no others." So the test still passes if we list only the 13 new keys we care about. **Mitigation:** spec says explicitly "extend `ALL_DD_COMMAND_NAMES` from 18 to 31"; the comment in `commands.ts` header is updated to mention the new total (`19 + 11 + 13 = 43`, with 13 case+rule rather than the prompt's hinted 14 — see Public surface note on `upsertNode`).

5. **Component test path drift** — `frontend/src/components/__tests__/CaseTreeTable.test.tsx` imports `CaseTreeTable` by relative path (`../CaseTreeTable`). When the component moves to `frontend/src/plugins/data-dictionary/components/cases/`, the test moves with it; relative import becomes `../CaseTreeTable` again (one level up to siblings). The test must also still find its store, MSW, etc. — vitest's `tsconfig.app.json` path alias `@/` should keep working. **Mitigation:** test file moves alongside the component, AC #7 verifies both old and new paths, and `npm test` is the final check.
