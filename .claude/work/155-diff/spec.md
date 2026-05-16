# Spec — #155-diff: DiffService Pattern B proof

## Goal

Second slice from the #155 service catalog — register `DIFF_SERVICE_TOKEN` and migrate the two diff pages (`LogicalDiffPage`, `PhysicalDiffPage`) off `diffApi` onto a DI-resolved `DiffService`. Mirror the `IntegrityService` precedent (PR #173, merged `5a48c44`) character-for-character: a Pattern B class with an optional injected `AxiosInstance`, a private `createDefaultHttp()` factory replicating `services/api.ts:23-32` auth interceptor, eager `useValue` registration in `dataDictionaryPlugin.initialize`. Per the #155 catalog: "Logical / physical / impact diffs — computed". The endpoints are pure REST (server aggregates over many YAML files; there is no file-shape to attach to Store FS), so Pattern B is the correct shape and stays so even after Store FS adoption expands (orchestrator coordination note re #166). All four diff REST paths used by the two pages move onto the service — including the bare `POST /api/diff/physical` currently called from a local axios instance at `PhysicalDiffPage.tsx:167` — so the service is the only frontend client of `/api/diff*`. `diffApi` is deleted from `frontend/src/services/api.ts`. Per orchestrator: `useState<loading|error>` in the diff pages is preserved per cookbook §1.5 ephemeral-UI carve-out (same as the IntegrityPage precedent).

## Files touched

- `frontend/src/kernel/tokens.ts` — add `DIFF_SERVICE_TOKEN` (symbol) with a docblock mirroring `INTEGRITY_SERVICE_TOKEN`'s.
- `frontend/src/plugins/data-dictionary/services/DiffService.ts` — new file. Pattern B class wrapping `/diff/logical`, `/diff/physical`, `/diff/physical/all`, `/services/:svc/physical-config`. Owns its own axios via private static `createDefaultHttp()`.
- `frontend/src/plugins/data-dictionary/dataDictionaryPlugin.ts` — import `DIFF_SERVICE_TOKEN` and `DiffService`; add eager `ctx.provide({ provide: DIFF_SERVICE_TOKEN, useValue: new DiffService() })` inside `initialize`, immediately after the existing `INTEGRITY_SERVICE_TOKEN` provider block (Pattern B → Pattern B grouping).
- `frontend/src/pages/LogicalDiffPage.tsx` — drop `diffApi` from the `services/api` import; add `useService` + `DIFF_SERVICE_TOKEN` + `DiffService` imports; replace `await diffApi.logical(left, right)` at line 266 with `await diff.getLogical(left, right)`; resolve the service at component top via `useService<DiffService>(DIFF_SERVICE_TOKEN)`; fix the stale prose comment at line 18 (`diffApi.logical` → `diff.getLogical`).
- `frontend/src/pages/PhysicalDiffPage.tsx` — drop `diffApi` from the `services/api` import; remove the local `axios.create(...)` + interceptor block at lines 13–25 along with the `import axios from 'axios'` line; add `useService` + `DIFF_SERVICE_TOKEN` + `DiffService` imports; resolve the service at component top; replace `await diffApi.getPhysicalConfig(svc)` (line 107) with `await diff.getPhysicalConfig(svc)`, `await diffApi.physicalAll(...)` (line 143) with `await diff.getPhysicalAll(...)`, and the bare `await api.post('/diff/physical', { service, source: { type: 'ddl', sql } })` (line 167) with `await diff.getPhysicalForService(service, { type: 'ddl', sql })`. The local `api` constant goes away entirely — `axios` import is removed.
- `frontend/src/services/api.ts` — delete `export const diffApi = { … }` (currently lines 425–456). No other surface changes. The stale `// Diff API (#86)` / `// Project management (#95)` comment pair at lines 375–376 (which precedes `filesystemApi`, not `diffApi`) is **left alone** — those are unrelated stale headers outside this slice's scope. Cycle 2 fix: prior draft mis-located them as "adjacent" to `diffApi`; verified `:375-376` precede `filesystemApi` at `:377` while the lines around the `diffApi` block (`:424` and `:457`) are simply blank, so there is nothing diff-adjacent to scrub.
- `frontend/src/plugins/data-dictionary/services/__tests__/DiffService.test.ts` — new unit test, constructor-injected `AxiosInstance` stub, no `vi.mock('axios')`. Mirrors `IntegrityService.test.ts`.
- `frontend/src/plugins/data-dictionary/__tests__/dataDictionaryPlugin.diff.test.ts` — new bootstrap test; calls production `bootstrapApplication()` and asserts `host.rootActivationCtx.resolve(DIFF_SERVICE_TOKEN)` returns a service with the four method names.
- `frontend/src/plugins/data-dictionary/services/__tests__/spec-grep-guards.diff.test.ts` — new content-guard test mirroring `spec-grep-guards.integrity.test.ts`; walks `frontend/src` for surviving `diffApi` identifiers and asserts the token + plugin + page invariants.
- `frontend/src/pages/__tests__/LogicalDiffPage.test.tsx` — new MSW page test; calls `bootstrapApplication()` once in `beforeAll`, stubs `POST /api/diff/logical` and `GET /api/services` and `GET /api/history`, exercises the Compare button path.
- `frontend/src/pages/__tests__/PhysicalDiffPage.test.tsx` — new MSW page test; covers the single-service `POST /api/diff/physical` path (DDL paste) and the all-services `POST /api/diff/physical/all` + `GET /api/services/:svc/physical-config` path.

## Public surface (signatures)

```ts
// frontend/src/kernel/tokens.ts (appended below the INTEGRITY_SERVICE_TOKEN block)

/**
 * DI token for the DiffService.
 *
 * Pattern B per #155 catalog: REST wrapper around the computed
 * `/api/diff/logical`, `/api/diff/physical`, `/api/diff/physical/all`, and
 * `/api/services/:svc/physical-config` endpoints. Owned by the
 * `data-dictionary` plugin; constructed and provided eagerly in
 * `dataDictionaryPlugin.initialize` (no kernel dependencies — same shape
 * as INTEGRITY_SERVICE_TOKEN).
 */
export const DIFF_SERVICE_TOKEN = Symbol('DiffService');
```

```ts
// frontend/src/plugins/data-dictionary/services/DiffService.ts

import axios, { type AxiosInstance } from 'axios';

/**
 * Left/right operand of a logical diff. Mirrors the existing call sites in
 * LogicalDiffPage (lines 258-264) — the union is reproduced here so the
 * service surface is self-typed; the page does not need to assert.
 */
export type LogicalDiffOperand =
  | { type: 'service'; name: string }
  | { type: 'all-services' }
  | { type: 'git-ref'; ref: string; service?: string };

/**
 * Per-service physical source — DDL paste or live introspection. Shape is
 * dictated by the backend (POST /api/diff/physical body) and is reused
 * verbatim from the local `sources[svc] = { ... }` builder in
 * PhysicalDiffPage (lines 130-136 + 167-170).
 */
export type PhysicalDiffSource =
  | { type: 'ddl'; sql: string }
  | { type: 'live'; credentials: { user: string; password: string } };

/**
 * Persisted physical-config row returned by GET /api/services/:svc/physical-config.
 *
 * Cycle 2 narrowing: the only field the page reads is `dialect`
 * (PhysicalDiffPage.tsx:327 — `cfg ? cfg.dialect : 'no physical.yaml'`).
 * Typing the row as `Record<string, unknown>` would force a cast at the
 * read site (under strict TS, `unknown.dialect` is not assignable to
 * `ReactNode`). Narrowing to `{ dialect?: string; [k: string]: unknown }`
 * lets the page render `cfg.dialect` directly (`string | undefined`,
 * which is a valid `ReactNode`) while keeping the rest of the shape
 * intentionally opaque. The backend route returns `null` when no config
 * is persisted; the page's `try/catch` handles the 404 path (the service
 * contract itself is success-only).
 */
export type PhysicalConfig = { dialect?: string; [k: string]: unknown } | null;

/** Whole-result payload of POST /api/diff/logical. Page treats as opaque. */
export type LogicalDiffResult = unknown;

/** Whole-result payload of POST /api/diff/physical (single service). */
export type PhysicalDiffResult = unknown;

/** Whole-result payload of POST /api/diff/physical/all. */
export type PhysicalDiffAllResult = unknown;

/**
 * Pattern B service — thin axios wrapper over the `/diff/*` endpoints and
 * `/services/:svc/physical-config`. NOT a Store FS facade: every result is
 * a computed aggregate the backend builds across many YAML files (see #86
 * for the logical diff algorithm). Per cookbook §3 (`frontend/docs/patterns.md`)
 * Pattern B applies. The service owns its own axios instance — it does NOT
 * import from `@/services/api` (cookbook anti-pattern). Auth header
 * replication matches `services/api.ts:23-32`.
 */
export class DiffService {
  private readonly http: AxiosInstance;

  /**
   * @param http  Optional injected AxiosInstance for unit tests (see
   *              `__tests__/DiffService.test.ts`). Production callsite is
   *              `new DiffService()` — receives the default instance from
   *              `createDefaultHttp()`.
   */
  constructor(http?: AxiosInstance);

  /** POST /api/diff/logical — full-model logical diff between two refs. */
  getLogical(left: LogicalDiffOperand, right: LogicalDiffOperand): Promise<LogicalDiffResult>;

  /** GET /api/services/:service/physical-config — returns persisted config or null. */
  getPhysicalConfig(service: string): Promise<PhysicalConfig>;

  /** POST /api/diff/physical — single-service DDL/live diff. */
  getPhysicalForService(service: string, source: PhysicalDiffSource): Promise<PhysicalDiffResult>;

  /** POST /api/diff/physical/all — whole-model physical diff across services. */
  getPhysicalAll(
    sources: Record<string, PhysicalDiffSource>,
    services?: string[],
  ): Promise<PhysicalDiffAllResult>;
}
```

```ts
// frontend/src/plugins/data-dictionary/dataDictionaryPlugin.ts (delta inside initialize, after the INTEGRITY provider block)

ctx.provide({
  provide: DIFF_SERVICE_TOKEN,
  useValue: new DiffService(),
});
```

Method body contract (mirroring `IntegrityService.getReport`):

- `getLogical`: `this.http.post<{ data: LogicalDiffResult }>('/diff/logical', { left, right }).then(r => r.data.data)`
- `getPhysicalConfig`: `this.http.get<{ data: PhysicalConfig }>(\`/services/${service}/physical-config\`).then(r => r.data.data)`
- `getPhysicalForService`: `this.http.post<{ data: PhysicalDiffResult }>('/diff/physical', { service, source }).then(r => r.data.data)`
- `getPhysicalAll`: `this.http.post<{ data: PhysicalDiffAllResult }>('/diff/physical/all', { sources, services }).then(r => r.data.data)`

Single layer of `.data` unwrap (axios) plus the backend envelope `{ data: T }` — identical to `IntegrityService.getReport` and matches the existing `diffApi.*` body shapes (`response.data.data` at `services/api.ts:428, 437, 445, 450, 454`). For the single-service `/diff/physical` path the current PhysicalDiffPage uses `response.data.data` (line 171), so this matches.

Page consumption pattern (both diff pages, mirroring `IntegrityPage.tsx:170-172`):

```tsx
import { useService } from '../kernel/useService';
import { DIFF_SERVICE_TOKEN } from '../kernel/tokens';
import type { DiffService } from '../plugins/data-dictionary/services/DiffService';

const diff = useService<DiffService>(DIFF_SERVICE_TOKEN);
```

Page state typing for `PhysicalDiffPage.tsx`: the `physicalConfigs` state currently typed `Record<string, any>` (line 90) should retype to `Record<string, PhysicalConfig>` (importing `PhysicalConfig` as a type-only import from `DiffService`). The read site `cfg.dialect` at line 327 resolves to `string | undefined`, which renders cleanly as a `ReactNode`; no cast is required. If the agent encounters any other read site of a non-`dialect` field on `cfg` during implementation, it should narrow the union further at that read site (e.g. `(cfg.someField as string | undefined)`) rather than widen the type — the contract stays narrow.

## Framework APIs used

- `@hamak/microkernel-api` — `Provider<T>` discriminated union `ClassProvider | ValueProvider | FactoryProvider` (`frontend/node_modules/@hamak/microkernel-api/dist/types.d.ts:36-51`). The `useValue: T` branch is what `dataDictionaryPlugin.initialize` invokes.
- `@hamak/microkernel-spi` — `InitializationContext.provide<T>(prov: Provider<T>): void` (`frontend/node_modules/@hamak/microkernel-spi/dist/plugin.d.ts:3`). The same surface `INTEGRITY_SERVICE_TOKEN` registers against; no Pattern A `dependsOn: ['store-fs']` needed.
- `@hamak/microkernel-impl` — `Host` and its root activation context exposed as `host.rootActivationCtx.resolve<T>(token)` (consumed by `frontend/src/kernel/useService.ts:23` and verified at `frontend/node_modules/@hamak/microkernel-impl/dist/runtime/di.d.ts:15`). The bootstrap test calls this directly.
- `axios` v1.x — `AxiosInstance` type and `axios.create({ baseURL, headers })` + `instance.interceptors.request.use(...)` are the same surface `IntegrityService.createDefaultHttp` uses.
- `msw` v2 — `http.post`/`http.get` + `HttpResponse.json(...)` for the bootstrap and page tests; same as `IntegrityPage.test.tsx:92-99`.

No new framework API is introduced. Every shape is already exercised by the merged IntegrityService precedent.

## Acceptance criteria

1. `grep -rnE '\bdiffApi\b' frontend/src --include='*.ts*'` returns **only** hits inside `frontend/src/plugins/data-dictionary/services/__tests__/spec-grep-guards.diff.test.ts` (the guard file itself). No `services/api.ts` hit, no page hit, no other test hit.
2. `frontend/src/kernel/tokens.ts` declares `DIFF_SERVICE_TOKEN` exactly once: `grep -cE '^export const DIFF_SERVICE_TOKEN\s*=\s*Symbol\(' frontend/src/kernel/tokens.ts` returns `1`.
3. `frontend/src/plugins/data-dictionary/services/DiffService.ts` exists and exports a class named `DiffService` with the four public method names `getLogical`, `getPhysicalConfig`, `getPhysicalForService`, `getPhysicalAll`. Asserted by `grep -E '^\s*(async\s+)?(getLogical|getPhysicalConfig|getPhysicalForService|getPhysicalAll)\b' frontend/src/plugins/data-dictionary/services/DiffService.ts` returning exactly 4 lines.
4. `DiffService.ts` does **not** import from `services/api`: `grep -E "from\s+['\"][^'\"]*services/api['\"]" frontend/src/plugins/data-dictionary/services/DiffService.ts` is empty.
5. `dataDictionaryPlugin.ts` provides `DIFF_SERVICE_TOKEN` inside the `initialize` body with a `useValue` provider (NOT `useClass` / `useFactory`). The provider block matching `/ctx\.provide\s*\(\s*\{[^}]*DIFF_SERVICE_TOKEN[^}]*\}\s*\)/` lies between the `async initialize(ctx)` and `async activate(ctx)` markers and contains `useValue`.
6. `LogicalDiffPage.tsx` imports `useService` from `../kernel/useService`, imports `DIFF_SERVICE_TOKEN` from `../kernel/tokens`, contains a `useService<DiffService>(DIFF_SERVICE_TOKEN)` call, and contains no `diffApi` identifier. Grep-asserted by the spec-grep-guards file.
7. `PhysicalDiffPage.tsx` imports `useService` from `../kernel/useService`, imports `DIFF_SERVICE_TOKEN` from `../kernel/tokens`, contains a `useService<DiffService>(DIFF_SERVICE_TOKEN)` call, and contains no `diffApi` identifier, no `axios.create`, and no top-level `import axios from 'axios'`. Grep-asserted by the spec-grep-guards file.
8. `services/api.ts` no longer exports `diffApi`: `grep -nE "^export\s+const\s+diffApi\b" frontend/src/services/api.ts` returns nothing.
9. **Unit suite** — `DiffService.test.ts` constructs the service with a stubbed `AxiosInstance` (cast through `unknown`, same shape as `IntegrityService.test.ts:65-67`). Tests:
   - `getLogical(left, right)` calls `stubHttp.post` with `'/diff/logical'` and `{ left, right }` and unwraps `response.data.data`.
   - `getPhysicalConfig('user-service')` calls `stubHttp.get` with the literal `'/services/user-service/physical-config'`.
   - `getPhysicalForService('user-service', source)` calls `stubHttp.post` with `'/diff/physical'` and `{ service: 'user-service', source }`.
   - `getPhysicalAll(sources, services)` calls `stubHttp.post` with `'/diff/physical/all'` and `{ sources, services }`.
   - Every method rejects when the stub rejects (no internal try/catch).
   - `new DiffService()` (no arg) does not throw and exposes all four methods (no actual HTTP made).
   - Suite contains zero `vi.mock(` invocations.
10. **Bootstrap suite** — `dataDictionaryPlugin.diff.test.ts` runs `await bootstrapApplication()` in `beforeAll`, then asserts:
    - `host.rootActivationCtx` is defined.
    - `ctx.resolve<DiffService>(DIFF_SERVICE_TOKEN)` returns an object with `typeof getLogical === 'function'`, `typeof getPhysicalConfig === 'function'`, `typeof getPhysicalForService === 'function'`, `typeof getPhysicalAll === 'function'`.
    - Repeated `resolve` calls return the same instance (`useValue` singleton — same assertion as `dataDictionaryPlugin.integrity.test.ts:48-53`).
11. **Spec-grep-guards suite** — `spec-grep-guards.diff.test.ts` mirrors the integrity guard file's walker (`fs.readdirSync` + `readFileSync`, NOT shell `grep`). Asserts criteria #1, #2, #4, #5, #6, #7, #8 above. The guard file's own basename `spec-grep-guards.diff.test.ts` is added to the walker's `allowedSuffixes` so its literal `diffApi` strings don't trip the global walk.
12. **LogicalDiffPage page test** — `bootstrapApplication()` in `beforeAll`; `beforeEach` registers MSW handlers for `GET /api/services`, `GET /api/history`, `POST /api/diff/logical`; renders the page inside `<Provider store={getStore()}>` + `<MemoryRouter>`; selecting a service and clicking Compare results in the `POST /api/diff/logical` handler being hit (counter-based assertion, same shape as `StereotypesPage.bootstrap.test.tsx`). At least one observable signal from the diff result lands in the DOM (e.g. a severity tile rendering or the empty-state message).
13. **PhysicalDiffPage page test** — `bootstrapApplication()` in `beforeAll`. Two cases:
    - Single-service DDL: select a service, paste SQL, click Compare → `POST /api/diff/physical` handler hit, summary tiles render.
    - All-services: select "All services" → `GET /api/services/:svc/physical-config` is hit per service (counter-based), `POST /api/diff/physical/all` fires on Compare. The all-services case also asserts that when the MSW handler returns a config row of shape `{ dialect: 'postgres' }`, the rendered radio label reads `Live (postgres)` (line 327 read site, with the cycle-2 narrowed `PhysicalConfig` type).
14. The two new page tests do **not** use `vi.mock('../../services/api', ...)`. The legacy harness is gone with `diffApi`.
15. **Baseline reproducibility** — the five new test files (`DiffService.test.ts`, `dataDictionaryPlugin.diff.test.ts`, `spec-grep-guards.diff.test.ts`, `LogicalDiffPage.test.tsx`, `PhysicalDiffPage.test.tsx`) do not exist on `main` (`git ls-tree -r main --name-only` shows none of them). After implementation, `npm --prefix frontend test -- DiffService.test.ts dataDictionaryPlugin.diff.test.ts spec-grep-guards.diff.test.ts LogicalDiffPage.test.tsx PhysicalDiffPage.test.tsx` on the PR branch passes.
16. `npm --prefix frontend test -- spec-grep-guards.diff.test.ts spec-grep-guards.integrity.test.ts` (run together) both pass — the new diff guard does not regress the integrity guard, and the integrity guard does not flag the new diff code (since `diffApi` and `integrityApi` are distinct identifiers).

## Out of scope

- The remaining #155 catalog tokens (`DICTIONARY_SERVICE_TOKEN`, `RULE_SERVICE_TOKEN`, `IMPORT_EXPORT_SERVICE_TOKEN`, `SEARCH_SERVICE_TOKEN`, `VISUALIZATION_SERVICE_TOKEN`, `CASE_SERVICE_TOKEN`, `AI_SERVICE_TOKEN`) — separate slices.
- `IntegrityService` / `IntegrityPage` / `HomePage` — already migrated in PR #173, untouched here.
- `StereotypeService` / `StereotypesPage` — already migrated in PR #172, untouched.
- `servicesApi`, `versionApi` consumed by the same two pages — these are out of `diffApi` scope. They stay on the legacy `@/services/api` import until their own slices land (orchestrator hard scope).
- Caching, retry, dedup, request cancellation on diff methods. Mirror IntegrityService verbatim — no extra behavior.
- ESLint guardrail forbidding `@/services/api` imports inside `plugins/*/services/*`. The cookbook anti-pattern is enforced by the spec-grep-guards test for this slice; project-wide lint is a later ticket.
- Removing `useState<diff|loading|error>` in the two diff pages. Preserved per cookbook §1.5 ephemeral-UI carve-out (same posture as `IntegrityPage`, see `IntegrityPage.tsx:176-182` TODO comment).
- `frontend/docs/patterns.md` cookbook update (§3b reference list). Post-merge human follow-up per orchestrator.
- Backend route reorganization of `/api/diff*` — explicitly coordinated with #157 (later ticket).
- The unused `diffApi.impactAll` method — gone with `diffApi` deletion. It has zero consumers (`grep -rn 'impactAll' frontend/src --include='*.ts*'` returns only the declaration in `api.ts:439`). No `getImpactAll` is added to `DiffService` until a real consumer surfaces; revisit if/when impact-diff UI ships.
- The `diffApi.putPhysicalConfig` method — also gone with `diffApi` deletion. Zero consumers in `frontend/src`. Not added to `DiffService`. If a future "save physical config" UI needs it, add it then.
- Scrubbing the stale `// Diff API (#86)` / `// Project management (#95)` comment pair at `services/api.ts:375-376` — these precede `filesystemApi`, not `diffApi`, and are unrelated to this slice. Cycle 1 review correctly flagged the prior draft's misattribution; the comments stay untouched here. A separate tidy-up PR can scrub them if desired.

## Dependencies

- Builds on PR #173 (`#155-integrity`, commit `5a48c44` on `main`) — same Pattern B shape, same `useValue` provider mechanic, same constructor-injected http test pattern. No code reuse, structural mirror only.
- Builds on PR #171 (`@hamak/notification` consolidation, `7f0a145`) — irrelevant to this slice but ensures `dataDictionaryPlugin.activate` notify shape is stable.
- Coordinates with #157 (route reorganization) — `/api/diff*` paths stay literal in `DiffService` for now; #157 will rewrite both routes and method bodies later.
- Coordinates with #166 (Store FS adoption) — diff endpoints are computed REST with no file-shape, so Pattern B remains correct after Store FS expands. No future refactor pressure.
- No nested branch dependencies; branch off `main`.

### Coordination notes — sibling #155 slices

Three live spec drafts (`155-diff`, `155-import-export`, `155-search`) all additively touch the same three files:

- `frontend/src/kernel/tokens.ts` — each adds a distinct new `*_SERVICE_TOKEN` symbol below the existing `INTEGRITY_SERVICE_TOKEN` block.
- `frontend/src/plugins/data-dictionary/dataDictionaryPlugin.ts` — each appends a distinct `ctx.provide({ provide: *_SERVICE_TOKEN, useValue: new *Service() })` block inside `initialize`.
- `frontend/src/services/api.ts` — each deletes a distinct top-level export (`diffApi` / `importExportApi` / `searchApi`).

No semantic conflict: the edits are non-overlapping append-or-delete operations on different identifiers. If a sibling slice lands first, this PR needs a **trivial mechanical rebase** to re-anchor its token and `ctx.provide` block after the most-recently-merged sibling's block (no logic change). The orchestrator decides merge order; the rebase is expected to be `git rebase main` with at most one conflict marker per file, resolved by accepting both additions in their original positions.

## Risks

1. **`DIFF_SERVICE_TOKEN` collision with the orchestrator's #155 catalog name.** The catalog (issue body) names it `DIFF_SERVICE_TOKEN` and `IntegrityService` precedent uses `INTEGRITY_SERVICE_TOKEN`. Identical naming convention — no collision risk, but if a downstream slice (e.g. #155-search) re-declares the symbol the kernel's DI throws at provide-time. Mitigation: the spec-grep-guards test asserts the token is declared exactly once.
2. **Stale `vi.mock('../../services/api', ...)` patterns surviving in other tests after `diffApi` deletion.** A test that imports `diffApi` for mocking purposes would fail to compile. Mitigation: `grep -rn "vi.mock.*services/api" frontend/src` before opening the PR; any survivor needs its mock surface trimmed of `diffApi` (likely none exist — the only test files that mention `diffApi` today are the ones we're touching, and there are no `vi.mock('.*services/api')` calls referencing it in `__tests__/`).
3. **Envelope-mismatch on the bare `/diff/physical` route.** The local axios in PhysicalDiffPage at line 167 used `response.data.data` (line 171) — same envelope shape as the rest of `diffApi`. Verified consistent with `services/api.ts:428` etc. If the backend route in fact returns the bare object (not `{ data: T }`), the page will break. Mitigation: the page test asserts an observable DOM signal from the diff result, which would surface an envelope mismatch immediately. If discovered during implementation, the `getPhysicalForService` unwrap reduces to `r.data`.
4. **MSW handler URL must include the `/api` prefix.** The IntegrityService precedent confirms it (handler is `http.get('/api/integrity', ...)` at `IntegrityPage.test.tsx:93`) — the page-test handlers we register must do the same (`/api/diff/logical`, `/api/diff/physical`, `/api/diff/physical/all`, `/api/services/:svc/physical-config`). Mitigation: copy the URL shape directly from `IntegrityPage.test.tsx`; the `axios.create({ baseURL: '/api' })` factory inside `DiffService.createDefaultHttp` prepends the prefix automatically.
5. **`LogicalDiffOperand` / narrowed `PhysicalConfig` over-tightening downstream callers.** The discriminated union for operands mirrors `LogicalDiffPage.tsx:259-264` exactly, and the narrowed `PhysicalConfig` shape (`{ dialect?: string; [k: string]: unknown }`) is wide enough to admit any backend-row shape via the index signature while typing the only field the page reads. If a future page reads a different named field, it should narrow at the read site (cast through the index signature) rather than widen the union here. Mitigation: only one consumer today for each type; tests pin the contracts.
