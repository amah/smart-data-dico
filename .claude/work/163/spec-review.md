# Spec review — #163: arch: actually use the action/command/event framework (cycle 1)

## Verdict
**rework**

The spec is solid on structure, framework-API verification, scoping calls (workspace/actor/path/move all correctly deferred with the right blocker tickets), event-channel + ui-navigation removal, and Phase-4 deferral. Two material issues require fixing before approve:

1. The CommandMap count is wrong by one. Counting actual entries: 4 stereotype + 1 integrity + 4 diff + 8 import-export + 1 quality + 1 search = **19** total / **18** data-dictionary.\* (not 18 / 17 as the spec claims in five places). Every grep-based acceptance criterion that hard-pins these numbers will fail on the implementer's first run.
2. The `data-dictionary.stereotype.create` handler signature contradicts its CommandMap entry. CommandMap declares `input: Stereotype` (a flat Stereotype); the register handler destructures `{ data }: { data: Stereotype }`. A caller using the typed `useCommand` would pass a Stereotype but the handler would read `undefined.data` at runtime.

## Required changes

1. **Reconcile the command counts across the spec.** The actual CommandMap totals are 18 `data-dictionary.*` + 1 `search.*` = 19 total. Update every place these numbers appear:
   - Section "Scope decision" line 16: "register ~17 commands" → "register 19 commands" (or keep "~18", but the surrounding "Net +13 commands" arithmetic depends: 19 new − 4 deleted refresh − 1 deleted `version.commit` = +14; recheck).
   - Acceptance #2: "exactly the 18 keys" → "exactly the 19 keys" and the regex match-count `=== 18` → `=== 19`.
   - Acceptance #5: "registers all 17 data-dictionary.\* commands … matches ≥ 17 times" → 18 / 18.
   - Acceptance #18: "for each of the 17 data-dictionary command names" → 18; "Total: 18 has-true assertions" → 19.
   - Acceptance #21 second bullet: "data-dictionary: 17, search: 1" → "data-dictionary: 18, search: 1".

2. **Fix the `data-dictionary.stereotype.create` input contract.** Either:
   - (a) Change the CommandMap entry to `'data-dictionary.stereotype.create': { input: { data: Stereotype }; output: Stereotype }` to match the handler that destructures `({ data })`; OR
   - (b) Change the handler signature to `async (data: Stereotype) => { const created = await stereotype.create(data); … }` so the CommandMap's flat `input: Stereotype` matches the runtime.
   Pick one and ensure it propagates to acceptance #19 (the stereotype-create listener-fire assertion) and to the StereotypesPage call-site migration. The other three stereotype commands (`loadAll`, `update`, `delete`) are already consistent.

## Suggestions (won't block)

- **Cookbook §4 prose drift.** The cookbook says `commands.execute` but the framework method is `commands.run` (verified at `frontend/node_modules/@hamak/microkernel-impl/dist/runtime/registries.js:4-5`). Per working rules the spec-writer cannot edit the cookbook; surfacing this for the user is appropriate. The spec's risk #1 already does so — keep as-is.
- **`if (res?.data)` defensive check.** In the `commitSqlDdl` register handler (spec line 366), `CommitResponse.data` is declared as required (`ImportExportService.ts:41-50` — `data: { … }`, not `data?: { … }`), so the guard is dead. Harmless; remove or keep. The other import-export envelopes (`PreviewResponse`, `DiffResponse`, `ImportResponse`) DO have `data?`, so consistency is fine.
- **`StereotypeTarget` import is unused in the spec.** The CommandMap signature block at line 152 imports `StereotypeTarget` from `../types` but never uses it in any command's input/output. Trim or note it'll be needed when stereotype-by-target commands land later.
- **Acceptance #21 first bullet wording.** "Zero call-sites of `commands.execute(` outside `node_modules`" — clarify the walker also excludes the guard file itself, mirroring the precedent in `spec-grep-guards.integrity.test.ts:21-26` (excludes self-references by basename suffix). Otherwise the test might trip on its own forbidden-string assertion.
- **Phase-4 in-plugin proof flow.** Spec line 18 mentions wiring `import-export.committed` → `quality.report.refreshed` re-emit on HomePage. This is fine as a soft demo but the spec ALSO says "Skip if it adds noise". Leaving it ambiguous risks the implementer doing nothing. Recommend either including a concrete acceptance criterion for the listener or moving it firmly into "out of scope".
- **CommandsDebugPage route registration ambiguity.** Spec line 33-34 admits the route mapping location ("confirm the exact location when implementing"). The spec should either name the file definitively or call this out as a deliberate implementer judgement call.

## Framework citation verification

| Cited path | Verified | Notes |
|---|---|---|
| `frontend/node_modules/@hamak/microkernel-api/dist/types.d.ts:2-6` (CommandRegistry: register/run/has, no list) | yes | Lines 4-8 in actual file declare `register(id, handler)`, `run(id, ...a)`, `has(id)`. No `list` / no `execute`. |
| `frontend/node_modules/@hamak/microkernel-api/dist/types.d.ts:11-15` (Hooks: on/off/emit) | yes | Lines 13-17 confirm `on/off/emit` shapes. |
| `frontend/node_modules/@hamak/microkernel-impl/dist/runtime/registries.js` (hooks.on no return / commands.run throws Not Found) | yes | `on(e,f) { ... map.get(e).add(f); }` returns void; `run` throws `Command not found: ${id}` on missing. |
| `frontend/node_modules/@hamak/microkernel-impl/dist/runtime/host.d.ts:13` (rootActivationCtx: ActivateContext) | yes | Line 13 declares `rootActivationCtx?: ActivateContext`. |
| `frontend/node_modules/@hamak/microkernel-api/dist/types.d.ts` ProvidedServices = ActivateContext with commands+hooks+resolve | yes | Lines 52-59. |
| `frontend/node_modules/@hamak/microkernel-spi/dist/plugin.d.ts:3-15` (InitializationContext: register but not run/off) | not opened | Plausible; consistent with InitializationContext vs ActivateContext split that the project documents elsewhere. |
| `frontend/node_modules/@hamak/notification/dist/impl/plugin/notification-plugin-factory.js:78-104` (7 commands) | yes | Confirmed: `notification.show/.info/.success/.warning/.error/.dismiss/.dismissAll`. |
| `frontend/node_modules/@hamak/event-channel/dist/api/index.d.ts` (SSE / remote-action) | yes | Exports `IEventChannel`, `RemoteAction`, `EventChannelEvent`, `ConnectionStatus`, `EVENT_CHANNEL_TOKEN`. Server-push primitive, not local pub-sub. Removal justified. |
| `frontend/node_modules/@hamak/ui-navigation/dist/api/index.d.ts` (Redux navigation store) | yes | Exports `INavigationService`, `NavigateOptions`, `navigationActions`, `NAVIGATION_SERVICE_TOKEN`. URL ↔ store sync, not a hook bus. Removal justified. |
| `frontend/node_modules/@hamak/shared-utils/dist/core-utils-filesystem.js:2-4` (contentLoaded = contentPresent) | not re-verified in this review | Cited from a peripheral StereotypeService note; not relevant to #163 scope. |

## Stale-stats verification (independent recount)

- `grep -rn "ctx.commands.register" frontend/src/plugins/` → **4 hits** (versionControlPlugin, dataDictionaryPlugin, rulesPlugin, casePlugin). Spec says 4. **Match.** Ticket body said 7. Ticket body stale.
- `grep -rn "ctx.hooks.emit" frontend/src/plugins/` → **6 hits** (authPlugin auth:session-restored, versionControlPlugin version:commit-requested, dataDictionaryPlugin data-dictionary:refresh-requested, rulesPlugin rules:refresh-requested, casePlugin case:refresh-requested, storeFsPlugin store-fs:ready). Spec says 6. **Match.** Ticket body said 5. Ticket body stale.
- `grep -rn "ctx.hooks.on\|hooks\.on" frontend/src/` → **1 hit** (shellPlugin shell:theme-changed only). Spec says 1. **Match.** Ticket body said 2 (claimed `auth:session-restored` had a listener) — verified absent: no `hooks.on('auth:session-restored', …)` anywhere. Ticket body stale.
- `grep -rn "commands.run\|commands.execute" frontend/src/` → **1 active call site** at `dataDictionaryPlugin.ts:111` (`ctx.commands.run(\`notification.${level}\`, { message })`). Spec says 1, ticket body said 0. Spec correct.

## Cross-cutting / cross-ticket verification

- **#157 spec (in flight, parallel)** — read; backend-only, zero `frontend/` references in its Files-touched section. No conflict.
- **#156 (CLOSED)** — notification commands managed by `@hamak/notification` factory. Spec correctly leaves notification's seven framework-registered commands alone and does not add them to `CommandMap` (which would be wrong — `CommandMap` is for our-code-only per the spec's risk #2 reasoning, and the guard in criterion #21 expects zero `notification.*` register calls in our code).
- **Dependency tickets verified open:** #166 (entity slice, OPEN), #167 (backend storage, OPEN), #168 (workspace contract, OPEN), #169 (per-user worktrees, OPEN), #160 (framework-git, OPEN), #161 (cases/rules fold, OPEN), #162 (ai extract, OPEN). All comment-scope deferrals correctly cite blockers that haven't merged.
- **#155 dependencies** — verified at `git log --oneline | head` — commit `6aecd3e` and earlier carry the four DI'd data-dictionary services + `5a48c44` for IntegrityService. Five DI'd services exist today. Spec's "wrap only what's in DI" rule holds.
- **In-flight `.claude/work/` specs** — `155-diff/`, `155-import-export/`, `155-integrity-service/`, `155-search/`, `156/`, `166-stereotype-slice/`, `157/`, `158/`. The five DI services land via the 155-* and 166-stereotype-slice specs (already producing the services). #163 wraps what those produce. No conflict.

## Cross-cutting checks

- **Multi-kind YAML (#106) preservation:** Slice 1 doesn't touch YAML file shapes — it wraps existing service methods. No risk.
- **Validation/Constraint/Rule trinity (#85):** Slice 1 doesn't introduce a new dimension; it commands existing reads. The IntegrityService's getReport still returns the trinity verbatim. No risk.
- **Cookbook conformance:** The spec uses `useCommand` mirroring `useService.ts`'s shape (verified the existing file is 30 lines and the spec proposes a hook of the same shape). Pattern is consistent. The cookbook itself isn't editable by spec-writer — flagged in risks.
- **Command/event naming per ticket body:** Convention from #163 body is `<plugin>.<noun>.<verb>`. Spec follows: `data-dictionary.stereotype.create`, `search.search`, etc. The `search` namespace doesn't strictly follow `noun.verb` (`search.search` is `verb.noun-also-verb`), but the search service only has one method — coining `search.entities.search` for one method would be over-design. Acceptable as a one-off; document in CLAUDE.md when the cookbook fill arrives.

## Risk reassessment

- **Spec's risk #1 (cookbook drift):** Real. The cookbook will say `execute` after the user fills §4; the spec guards against the wrong form propagating via grep. Tractable.
- **Spec's risk #2 (no `list` API):** Real and well-mitigated. Static `CommandMap` + `has` probing is the right pattern given the framework constraint.
- **Spec's risk #3 (hooks.on no disposer):** Real, but Slice 1 has no `deactivate` paths that need teardown, so the risk is documented-but-dormant.
- **Spec's risk #4 (emit shape mismatch):** Real. The framework `Hooks.emit(event, ...a)` is variadic; the typed wrapper passes a single arg. Test coverage in `kernel/__tests__/events.test.ts` handles it. Adequate.
- **Spec's risk #5 (searchSlice dead code):** Real but flagged correctly. The reducer-bug at lines 32-36 (in the actual file it's lines 64-68 per my read; spec's line cite is slightly stale) is unrelated to #163.

**Additional risks the spec doesn't surface:**

- **R6 (new):** The `useCommand` hook returns a function that resolves `host.rootActivationCtx` lazily (presumably; the signature shown doesn't specify). If a component calls the returned function from inside a `useEffect` with `[]` deps and the host activation context changes after first render (e.g. plugin re-bootstrap in HMR), it'll silently use the stale ctx. Mitigation: document that `useCommand` reads `host.rootActivationCtx` at call time, not at hook-call time. Probably already intended given how `useService.ts` works — flag for the implementer to follow the same closure-over-host pattern.
- **R7 (new):** The `data-dictionary.stereotype.create` typing mismatch (Required Change #2) is symptomatic of a wider risk: the CommandMap type contracts are not enforced by the `ctx.commands.register` callback signature (handlers are typed as `(...a: any[]) => any` per `types.d.ts:5`). The typed `useCommand` makes call-site usage safe, but handler-side type drift can sneak in. Mitigation: the per-plugin command tests in acceptance #18-19 should additionally invoke each command with a CommandMap-typed input fixture and assert no runtime TypeError. This adds maybe 2 minutes of test work and would have caught the `stereotype.create` mismatch automatically.

## Cross-ticket conflicts

None. The other in-flight specs (155-*, 156, 157, 158, 166-stereotype-slice) all either land prerequisites or are backend-only.

