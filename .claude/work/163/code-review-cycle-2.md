# Code review — #163: arch: actually use the action/command/event framework (Slice 1) (cycle 2)

## Verdict
**approve**

All six required changes from cycle 1 are addressed. Test suite is green at the claimed 484 passed / 11 skipped / 0 failed. No calibration violations in the new test files.

## Cycle-1 required-changes — disposition

| # | Change | Addressed | Notes |
|---|---|---|---|
| 1 | Add `dataDictionaryPlugin.commands.test.ts` | yes | `frontend/src/plugins/data-dictionary/__tests__/dataDictionaryPlugin.commands.test.ts` (9048 bytes). Iterates all 18 dd command names asserting `commands.has(name) === true`. Five `commands.run` event-emission assertions for `stereotype.changed` ×3 (create/update/delete), `import-export.committed` (commitSqlDdl), `quality.report.refreshed` (getReport) — exactly the events Slice 1 emits, no aspirational ones. MSW stubs the three backend endpoints. |
| 2 | Add `searchPlugin.commands.test.ts` | yes | `frontend/src/plugins/search/__tests__/searchPlugin.commands.test.ts` (3042 bytes). Asserts `commands.has('search.search') === true` and runs the command end-to-end through MSW stub. |
| 3 | Add `kernel/__tests__/commands.test.ts` | yes | `frontend/src/kernel/__tests__/commands.test.ts` (5742 bytes). Covers the underlying `createCommandRegistry` primitive (`has` true/false, `run` invocation, void-input, idempotent re-register, "Command not found" throw). The post-bootstrap delegation path of `runCommand` is covered transitively by the two plugin tests above. Type-narrowing assertions via `expectTypeOf`. The deviation from cycle-1 fix #3a (the specific `host.rootActivationCtx === undefined` throw assertion) is documented in-file with an OOM-isolation rationale and counter-covered by source presence plus the plugin command tests, which is acceptable. |
| 4 | Add `kernel/__tests__/events.test.ts` | yes | `frontend/src/kernel/__tests__/events.test.ts` (4244 bytes). Round-trips: object payload (`stereotype.changed`, `import-export.committed`, `quality.report.refreshed`), single-arg-not-spread assertion, void payload (`auth:session-restored`), multi-listener fan-out, no-replay-for-late-subscribers. Uses real `createHooks()`, not a hand-rolled mock. |
| 5 | Add `pages/__tests__/CommandsDebugPage.test.tsx` | yes | `frontend/src/pages/__tests__/CommandsDebugPage.test.tsx` (5705 bytes). Both required paths: positive (19 registered rows, 0 unregistered, 0 markers) and inverse (mock `has` to return false for `search.search` → exactly one unregistered row + one marker). Plus a real-bootstrap drift check. Testid contract (`command-row-registered` / `command-row-unregistered` / `not-registered-marker`) matches `CommandsDebugPage.tsx:118,130`. |
| 6 | Re-sync `frontend/package-lock.json` | yes | `grep -nE "@hamak/(event-channel\|ui-navigation)" frontend/package-lock.json` returns empty. `node_modules/@hamak/event-channel` and `node_modules/@hamak/ui-navigation` are gone from disk. `package-lock.json` shrank by 20 lines (`-20` in diff stat). |

## Test-suite verification

`cd frontend && npm test` (cycle 2 HEAD `8eb8976`):
```
Test Files  48 passed | 1 skipped (49)
     Tests  484 passed | 11 skipped (495)
```

Matches the +54 test-author claim relative to cycle 1's 430 (484 − 430 = 54). 11 skipped unchanged. Zero failures.

## Calibration check on new test files

- No `[verified]/[unverified]` labels — clean.
- No `// TODO` / `// XXX` left behind.
- No broad regex assertions — the new spec-grep-style checks live in `spec-grep-guards.commands.test.ts` (already approved in cycle 1) and use anchored names.
- Command names asserted are the literal 18 + 1 enumerated constants, not derived from a pattern.
- Event payload assertions check specific fields (`id`, `op`, `service`, `overall`, `added/merged/unchanged/...`) rather than `expect.anything()`.
- MSW handlers return specific shapes; no `*` catch-alls.

The "verified" word appears only in JSDoc prose explaining what each block does — not as a label on an unverified-as-fact assertion.

## Out-of-scope additions
None new in cycle 2. (Cycle-1 noted `searchSlice.ts:66` reducer fix and `IntegrityPage` `useService` drop — both still present, unchanged.)

## Suggestions (won't block, carry to a follow-up if you want)

- The cycle-1 suggestion to wire the typed `emit`/`on` helpers into the producer call-sites in `dataDictionaryPlugin.ts` was not taken, which is fine — the spec didn't require it. The new `events.test.ts` does exercise the wrappers against a real `createHooks()` so the wrappers are not dead code, just untaken at the producer side.
- `kernel/__tests__/commands.test.ts` chose to not directly test `runCommand`'s `host.rootActivationCtx === undefined` throw path due to a worker-OOM concern. The choice is documented in-file and the delegation path is covered transitively by the plugin command tests; acceptable. If a future Slice covers `runCommand` more thoroughly, that throw assertion could be added with isolated module mocks.
