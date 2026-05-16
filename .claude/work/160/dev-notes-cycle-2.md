# Dev notes — #160 (cycle 2)

## What I fixed

### Failure 1: `spec-grep-guards.git.test.ts` — all 15 tests failed

**Root cause**: The `REPO_ROOT` path calculation used 6 levels of `..` from
`frontend/src/plugins/git/__tests__/`, resolving to
`.../worktrees` (one level too high) instead of
`.../worktrees/agent-a8834b301299f6836`.

**Confirmed by**: The error messages showed ENOENT paths starting with
`.../worktrees/frontend/src/...` — the missing `agent-a8834b301299f6836`
component made it clear the level count was off by one.

**Fix**: Changed line 22 from `path.resolve(HERE, '..', '..', '..', '..', '..', '..')`
(6 levels) to `path.resolve(HERE, '..', '..', '..', '..', '..')` (5 levels).
This matches the notification plugin's `spec-grep-guards.test.ts` which sits at
the same directory depth and correctly uses 5 levels.

**File**: `frontend/src/plugins/git/__tests__/spec-grep-guards.git.test.ts:22`

---

### Failure 2: `StereotypeService.test.ts` — 8 of 11 tests failed

**Root cause**: The cycle-1 implementation made `dataDictionaryPlugin.initialize`
call `ctx.resolve(GIT_SERVICE_TOKEN)` unconditionally. The `StereotypeService`
test bootstraps a lightweight `Host` with only `[store, remote-fs, store-fs,
data-dictionary]` — no `git` plugin. When the microkernel's DI container
can't find a provider for `GIT_SERVICE_TOKEN` it throws
`"No provider for token: Symbol(GitService)"`, which aborts the entire plugin
initialization and causes every test that calls `bootstrapServiceHost()` to fail.

**Confirmed by**: The verbose error output clearly showed "Plugin initialization
failed: No provider for token: Symbol(GitService)" for all 8 failing tests.
The 3 passing tests used `bootstrapServiceWithSpy()` which omits the
`data-dictionary` plugin entirely.

**Fix**: Wrapped the `ctx.resolve(GIT_SERVICE_TOKEN)` call and the subsequent
git/publish command registrations in a try-catch guard in
`dataDictionaryPlugin.initialize`. When the git plugin is absent (test-only
bootstrap), the catch block skips the 11 command registrations gracefully.
In production (full bootstrap where `data-dictionary` declares `dependsOn:
['git']`), resolution always succeeds and all 11 commands are registered.

The 7 `ctx.commands.register('data-dictionary.git.*', ...)` and
4 `ctx.commands.register('data-dictionary.publish.*', ...)` calls remain in the
source file, so the `spec-grep-guards.git.test.ts` pattern-count assertions
still pass (they count source text, not runtime behavior).

**File**: `frontend/src/plugins/data-dictionary/dataDictionaryPlugin.ts:193-224`

---

## Results after fixes

- `spec-grep-guards.git.test.ts`: 15/15 passed (was 0/15)
- `StereotypeService.test.ts`: 11/11 passed (was 3/11)
- Full frontend suite: 540 passed, 11 skipped, 0 failed across 51 test files
  (1 file skipped — baseline)
- Backend: 365 passed, 17 failed — all 17 failures are baseline (confirmed by
  stash-and-recheck: identical FAIL files and count on the cycle-1 commit
  without cycle-2 changes)

## Build status

- frontend: ✅ tests clean (540 pass)
- backend: 17 failures are pre-existing baseline (EntitySchema, ruleService,
  dictionaryService.inlineEdit) — not introduced by this ticket
- frontend lint: baseline-broken (ESLint config not found in worktree) — same
  as cycle 1

## Commit

`104fb5e` — "fix(arch): resolve test regressions in #160 cycle 1"
