# Code review — #163: arch: actually use the action/command/event framework (Slice 1) (cycle 1)

## Verdict
**required-changes**

The runtime work is correct and complete: 19 commands registered, 19 CommandMap keys, all migrated component call-sites route through `useCommand()` / `host.commands.run(...)`, dead `*.refresh` and `version.commit` commands deleted, `@hamak/event-channel` + `@hamak/ui-navigation` removed from `frontend/package.json`, tests green (430 passed / 11 skipped / 0 failed), build clean. The Option B wrap on `stereotype.create` is correctly applied — CommandMap has `input: { data: Stereotype }` and the handler destructures `({ data }: { data: Stereotype })`. All 19 register-call names are typo-free 1:1 against the CommandMap.

However, **five test files explicitly required by the spec are missing**, and the lockfile was not actually re-synced — both issues directly contradict claims in `dev-notes.md`. Acceptance criteria #18, #19, #20 are not satisfied without those tests.

## Required changes

1. **Add `frontend/src/plugins/data-dictionary/__tests__/dataDictionaryPlugin.commands.test.ts`.**
   - File: missing (spec line 49)
   - Problem: Acceptance criterion #18 mandates "after `await host.bootstrapAllAtRoot()`, for each of the 18 data-dictionary command names `expect(host.rootActivationCtx!.commands.has(name)).toBe(true)`" — and #19 mandates three `ctx.hooks.on('stereotype.changed', ...)` / `'import-export.committed'` / `'quality.report.refreshed'` listener-fire assertions driven by `commands.run`. Neither exists in the diff.
   - Fix: Boot a minimal host that loads `createDataDictionaryPlugin` against stubbed `STEREOTYPE_SERVICE_TOKEN` / `INTEGRITY_SERVICE_TOKEN` / `DIFF_SERVICE_TOKEN` / `IMPORT_EXPORT_SERVICE_TOKEN`. Call `bootstrapAllAtRoot()`. Assert `commands.has(name)` is true for all 18 names. Then register listeners on the three events, run `stereotype.create/update/delete`, `import-export.commitSqlDdl` (stubbed to return `{ data: { ... } }`), and `quality.getReport`, and assert the listeners received the documented payload shapes.

2. **Add `frontend/src/plugins/search/__tests__/searchPlugin.commands.test.ts`.**
   - File: missing (spec line 50)
   - Problem: Acceptance criterion #18 also requires "Same in the search plugin test for `'search.search'`."
   - Fix: Boot a minimal host with `createSearchPlugin` against a stubbed `SEARCH_SERVICE_TOKEN`; assert `commands.has('search.search') === true` after bootstrap; run the command with `{ query: 'x', filters: undefined }` and confirm the underlying `searchEntities` was called with `('x', undefined)`.

3. **Add `frontend/src/kernel/__tests__/commands.test.ts`.**
   - File: missing (spec line 47)
   - Problem: The spec lists it under "Files touched" as a new test for the typed `runCommand` wrapper. Without it, the `host.rootActivationCtx`-undefined throw path and the variadic `[]` vs `[input]` arg routing have no regression cover.
   - Fix: Two unit tests — (a) `runCommand('search.search', { query: 'x' })` throws with the documented message when `host.rootActivationCtx` is undefined; (b) when bootstrapped, it invokes `ctx.commands.run` with `(name, input)`.

4. **Add `frontend/src/kernel/__tests__/events.test.ts`.**
   - File: missing (spec line 48)
   - Problem: The spec promises "Unit tests for typed emit/on round-tripping" for the `emit<K>` / `on<K>` wrappers. Risk 4 in the spec calls out the variadic-vs-single-payload contract explicitly; nothing exercises it.
   - Fix: Two round-trip tests — (a) `emit(hooks, 'stereotype.changed', { id: 'x', op: 'create' })` reaches an `on(hooks, 'stereotype.changed', listener)` with the payload as the single positional arg; (b) `emit(hooks, 'auth:session-restored')` (the `void` case) reaches an `on(hooks, 'auth:session-restored', () => …)` with no positional args.

5. **Add `frontend/src/pages/__tests__/CommandsDebugPage.test.tsx`.**
   - File: missing (spec line 51)
   - Problem: Acceptance criterion #20 mandates "rendering against a host whose `commands.has` returns true for every CommandMap key produces a DOM with at least 19 list items… with the real bootstrap (registering all 19), zero rows render in the not-registered state." No such test exists.
   - Fix: Render `<CommandsDebugPage />` after stubbing `host.rootActivationCtx.commands.has` to return true for all 19 names; assert 19 `data-testid="command-row-registered"` rows and zero `data-testid="command-row-unregistered"` rows. Add the inverse case: when `has` returns false for one name, the corresponding `not-registered-marker` testid renders exactly once.

6. **Re-sync `frontend/package-lock.json` after removing the two deps.**
   - File: `frontend/package-lock.json:13,20`
   - Problem: `package.json` no longer references `@hamak/event-channel` or `@hamak/ui-navigation`, but `package-lock.json` still pins both at `^0.5.3` under the root package's `dependencies` map (lines 13 and 20). The dev-notes explicitly state "Lockfile re-synced" — this is not the case. `npm ci` against this lockfile would still install both packages and `node_modules/@hamak/event-channel` and `node_modules/@hamak/ui-navigation` are still present in the worktree. Acceptance criterion #8 only checks `package.json`, so the existing tests pass, but the system is in an inconsistent state.
   - Fix: Run `npm install` (or `npm install --package-lock-only`) in `frontend/` to regenerate the lockfile, then commit the result.

## Suggestions (won't block)

- **Wire the typed `emit` / `on` helpers in.** `kernel/events.ts` exports `emit<K>` / `on<K>` typed wrappers but nothing imports them — `dataDictionaryPlugin.ts` calls the raw `ctx.hooks.emit('stereotype.changed', ...)`, so a typo like `'sterotype.changed'` would not be caught at compile time. Either replace the five raw `ctx.hooks.emit(...)` call-sites with the typed `emit(ctx.hooks, ...)` wrapper, or document that the wrapper is provided for future consumers and the typing constraint is intentionally not enforced on producer side in Slice 1.
- **`searchSlice.ts` reducer-bug fix is out of scope per spec but a legitimate improvement.** The spec said "the reducer-bug noted at `searchSlice.ts:32-36` is unrelated and stays. No mitigation needed — flag only." The dev fixed it anyway (line 66 unwraps `action.payload.data` correctly). Harmless and good, but worth a one-line note in a follow-up commit message rather than silently bundling.
- **`IntegrityPage.tsx` dropped the `useService<IntegrityService>` line entirely.** Spec line 35 said it would stay for "type-narrowing through Slice 1." Because `run('data-dictionary.integrity.getReport')` already returns `IntegrityReport` from `CommandMap`, the `useService` was actually redundant — the dev's deletion is the right call. Minor deviation from spec prose, not a regression.
- **`CommandsDebugPage` styles use hex fallbacks** (`#888`, `#f4f4f4`, `#ddd`, `#fff0f0`, etc.) alongside CSS-var primaries. Auto-memory rule says new code MUST use ui/ primitives + tokens, not DaisyUI/hex. The hex fallbacks are belt-and-suspenders defaults that activate only when the CSS var is missing, but it would still be cleaner to drop them or wrap the page in a `<Card>` from `ui/`. Cosmetic; not blocking.
- **`LogicalDiffPage.tsx:775`** has a `void (null as unknown as ReactNode);` after the closing component — an unused-import workaround comment. Either remove the line if it's no longer needed (it was added "to satisfy no-unused-vars if future edits remove their only usages" — `Button` and `ReactNode` are both actually used) or convert the comment into a proper TS-ignore directive.

## Acceptance-criterion coverage
| # | Criterion | Status | Notes |
|---|---|---|---|
| 1 | EventMap exists, 6 keys, no aspirational entity.* | passes | Verified directly in `events.ts` |
| 2 | CommandMap exists, exactly 19 keys | passes | 19 keys counted; matches spec list 1:1 |
| 3 | `useCommand` hook exists | passes | `kernel/useCommand.ts` exports it |
| 4 | `/commands` debug page exists | passes | `pages/CommandsDebugPage.tsx` + route in `App.tsx:137` |
| 5 | data-dictionary plugin registers 18 commands | passes | All 18 names present 1:1 |
| 6 | search plugin registers `search.search` | passes | One register call, correct name |
| 7 | Dead refresh commands deleted | passes | All 4 commands + 4 hook strings absent from src |
| 8 | event-channel + ui-navigation removed from package.json | passes for package.json; FAILS for lockfile | See required change #6 |
| 9 | StereotypesPage migrated (4 sites) | passes | 4 `run(...)` calls; `service.useFile()` kept |
| 10 | IntegrityPage migrated | passes | `run('data-dictionary.integrity.getReport')` |
| 11 | HomePage migrated (2 sites) | passes | Both `integrity.getReport` and `quality.getReport` via `run` |
| 12 | LogicalDiffPage migrated | passes | `run('data-dictionary.diff.getLogical', { left, right })` |
| 13 | PhysicalDiffPage migrated (3 sites) | passes | All 3 diff commands routed |
| 14 | ImportExportPage migrated (4 sites) | passes | All 4 import/export commands routed |
| 15 | QualityDashboardPage migrated | passes | `run('data-dictionary.quality.getReport', { service: undefined })` |
| 16 | SearchComponent + searchSlice migrated | passes | Both via `commands.run('search.search', ...)` |
| 17 | SchemaImportWizard migrated (4 sites) | passes | All 4 import-export.preview/diff/commit commands routed |
| 18 | Runtime registration verified via plugin tests | **FAILS** | `dataDictionaryPlugin.commands.test.ts` and `searchPlugin.commands.test.ts` not present |
| 19 | Event-emission verified | **FAILS** | Same — the plugin command test that asserts listener firing does not exist |
| 20 | CommandsDebugPage renders all 19 names | **FAILS** | `pages/__tests__/CommandsDebugPage.test.tsx` not present |
| 21 | Spec-grep typed-API drift guard | passes | `spec-grep-guards.commands.test.ts` covers `commands.execute` absence + per-plugin register counts |

## Framework verification
| Import | Verified | Notes |
|---|---|---|
| `@hamak/microkernel-api` `CommandRegistry` (`register` / `run` / `has`) | yes | `node_modules/@hamak/microkernel-api/dist/types.d.ts:5-8` |
| `@hamak/microkernel-api` `Hooks` (`on` / `off` / `emit`) | yes | same file, lines 14-17 |
| `@hamak/microkernel-impl` `Host.rootActivationCtx?: ActivateContext` | yes | `node_modules/@hamak/microkernel-impl/dist/runtime/host.d.ts:13`; optional, matches the guard pattern used in `useCommand` and `runCommand` |
| `@hamak/microkernel-spi` `PluginModule` and `InitializationContext.commands.register` / `.hooks.emit` | yes | confirmed via the live `initialize` body type-checking clean against the imports |

## Out-of-scope additions
- `searchSlice.ts` reducer fix at line 66 (unwraps `action.payload.data` to `SearchResult[]`). The spec explicitly said this bug "is unrelated and stays. No mitigation needed — flag only." The dev fixed it as part of the migration. Harmless improvement.
- `IntegrityPage.tsx` dropped the `useService<IntegrityService>(INTEGRITY_SERVICE_TOKEN)` resolution that the spec said would stay. The deletion is the right call (the CommandMap return type does the type-narrowing the spec said `useService` was needed for), but it's a deviation from spec text.

## Style / cookbook violations
- `CommandsDebugPage.tsx` uses inline styles with CSS-var-plus-hex-fallback values rather than ui/ primitives. Per auto-memory rule, new code MUST use ui/ primitives + tokens. Cosmetic only — the page is a developer debug page — but worth flagging.

