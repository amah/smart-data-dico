# Test results — #163 (cycle 1, test-author 1/3)

## Coverage of acceptance criteria

| Criterion | Test file:lines | Status |
|---|---|---|
| 18. Runtime registration: after bootstrap, `commands.has(name)` true for all 18 dd commands + `search.search` | `dataDictionaryPlugin.commands.test.ts:52-70` (18 dd has-tests) + `searchPlugin.commands.test.ts:55-67` (search.search has-test) | ✅ pass |
| 19. Event emission: `stereotype.changed`, `import-export.committed`, `quality.report.refreshed` listener-fire assertions | `dataDictionaryPlugin.commands.test.ts:81-199` (5 event assertions: create/update/delete/commit/quality) | ✅ pass |
| 20. CommandsDebugPage renders all 19 registered names; zero not-registered rows with real bootstrap | `CommandsDebugPage.test.tsx:67-113` | ✅ pass |
| commands.ts typed wrapper — pre-bootstrap throw, post-bootstrap routing, type-narrowing | `commands.test.ts:29-115` | ✅ pass |
| events.ts typed emit/on — object-payload round-trip, void-payload round-trip, single-arg contract | `events.test.ts:29-110` | ✅ pass |

## Failures

None. All 54 new assertions pass.

## Notes on implementation findings

**Phase 4 deferral confirmed.** Slice 1 emits exactly three events from the data-dictionary plugin: `stereotype.changed` (from create/update/delete), `import-export.committed` (from commitSqlDdl), and `quality.report.refreshed` (from quality.getReport). The aspirational `entity.deleted` → search/visualization/integrity cross-plugin flow is not wired. Tests assert only what the current implementation emits — no aspirational events.

**`runCommand` pre-bootstrap isolation workaround.** The `commands.test.ts` file avoids a direct top-level `import { bootstrapApplication, host }` because running the test in isolation with `npx vitest run <file>` consistently OOMs the worker when the large bootstrap module graph is loaded alongside multiple test groups in the same file. The full suite runs this file pooled with others without issue (confirmed: 484 pass / 0 fail). The pre-bootstrap throw contract is tested via the underlying `createCommandRegistry` primitive (which `runCommand` delegates to) and a dynamic import guard. The post-bootstrap routing path is exercised by the plugin command tests (`dataDictionaryPlugin.commands.test.ts` and `searchPlugin.commands.test.ts`) which use `ctx.commands.run(...)` directly. This is consistent with "test the public surface only."

**Stub approach for `CommandsDebugPage`.** The page reads the singleton `host` from `kernel/bootstrap`. Tests use `vi.spyOn(host.rootActivationCtx!.commands, 'has')` after production bootstrap rather than constructing a hand-rolled host stub, because (a) the production bootstrap is available anyway, and (b) the spy is more minimal than a full mock. The "real bootstrap zero drift" sub-suite uses no spy at all — it asserts directly that all 19 runtime-registered commands match the static `COMMAND_MAP_KEYS` list.

## Build status

- Tests: 484 pass, 11 skipped (unchanged), 0 fail
- New tests added: 54 across 5 files
- Test suite runtime: ~94s (full suite, no regression)
- Individual file runtimes: events.test.ts ~3s, commands.test.ts ~4s, dataDictionaryPlugin.commands.test.ts ~3s, searchPlugin.commands.test.ts ~3s, CommandsDebugPage.test.tsx ~10s
