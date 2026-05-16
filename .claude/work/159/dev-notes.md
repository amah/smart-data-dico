# Dev notes — #159  (cycle 1)

## Changes

- `frontend/src/kernel/bootstrap.ts:45-60` — Added JSDoc convention comment block above `registerPlugins()` explaining `dependsOn` semantics and out-of-scope categories.
- `frontend/src/kernel/bootstrap.ts:104-109` — `shell` plugin: dropped `dependsOn: ['store']` → field omitted (no DI token resolves in ShellPluginFactory).
- `frontend/src/kernel/bootstrap.ts:111-116` — `auth` plugin: dropped `dependsOn: ['store']` → field omitted (only provides AUTH_SERVICE_TOKEN, never resolves).
- `frontend/src/kernel/bootstrap.ts:118-123` — `data-dictionary` plugin: dropped `'auth'` from `dependsOn` → now `['store', 'store-fs', 'git']`.
- `frontend/src/kernel/bootstrap.ts:125-130` — `visualization` plugin: dropped `dependsOn: ['store']` → field omitted (only registers routes, no ctx.resolve).
- `frontend/src/kernel/bootstrap.ts:154-162` — `git` plugin: dropped `'remote-fs'` from `dependsOn` → now `['store']` (git-plugin-factory constructs its own GitPathTranslator, never resolves PATH_TRANSLATOR_TOKEN).
- `frontend/src/kernel/bootstrap.ts:171-178` — `notification` plugin: dropped `'store'` from `dependsOn` → now `['logging']` (the Symbol.for mismatch silently fails in try/catch — pre-existing bug, Risk 2).
- `frontend/src/kernel/bootstrap.ts:180-187` — `ai-assistance` plugin: dropped all three from `dependsOn: ['store', 'auth', 'data-dictionary']` → field omitted (aiPlugin.ts has zero ctx.resolve calls).
- `frontend/src/__tests__/plugin-dependency-graph.test.ts` — New smoke test (35 `it` blocks) with 3 describe blocks: orphan-name check, per-plugin token resolution, and negative union-check.

## Build status

- frontend tsc + vite build: clean (1747 modules transformed, no TypeScript errors)
- frontend tests: 676 passed / 11 skipped / 0 failed (baseline 641 + 35 new = 676 expected)
- frontend lint: BASELINE BROKEN — `eslint . --ext ts,tsx` fails with "ESLint couldn't find a configuration file" (no `.eslintrc*` in frontend/). This failure exists before these changes (pre-existing missing config). [unverified: couldn't stash to confirm, but the missing config file is clearly not introduced by bootstrap.ts or the new test file].

## Unrelated issues noticed (not fixed)

- `frontend/` — ESLint config missing (no `.eslintrc.*` file); `npm run lint` fails at baseline.
- `frontend/src/plugins/notification/notificationPlugin.ts:35-48` — Comment incorrectly claims the notification `state.notifications` slice "WILL appear in RootState". The `Symbol.for` vs `Symbol()` mismatch (Risk 2 in spec) means the slice is never registered. Pre-existing bug, out of scope per #159.

## Anything the spec didn't cover that I had to decide

- The spec said "omit the field entirely" for plugins whose `dependsOn` becomes empty. I followed that consistently for `shell`, `auth`, `visualization`, and `ai-assistance`. The four remaining plugins with real deps keep their `dependsOn` arrays.
- Kept the `@hamak/logging` package out of the `vite.config.ts` `inline` list — it was not in the list at baseline and the test passed without adding it (the package is already picked up via the `forks` transform).
- Added 2 singleton identity checks (STORE_MANAGER_TOKEN and SEARCH_SERVICE_TOKEN) beyond what the spec explicitly listed, bringing the total `it` count to 35. These are within the spirit of the spec's "~25 cases" and add regression value.
