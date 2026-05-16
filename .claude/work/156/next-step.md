# Next step — #156

## Decision
Route to: **developer**

## Reason
Test cycle 1 produced 3 failures in `frontend/src/plugins/notification/__tests__/notificationPlugin.test.ts`, all with one root cause: Vitest externalizes `node_modules` by default and Node's strict ESM loader rejects the extensionless relative imports inside `@hamak/microkernel-impl`'s shipped `dist/index.js` (e.g. `export * from './runtime/di';`). test-author categorized this as an implementation/config gap (not a test bug, not a spec ambiguity) and pinpointed a one-block fix in `frontend/vite.config.ts`:

```ts
test: {
  // … existing fields
  server: { deps: { inline: [/^@hamak\/.*/] } },
}
```

The spec is correct, the production source files are correct (`vite build` clean, dev server runs), and the new test code is correct against Acceptance #6 — only the Vitest config is short one line for the spec-mandated test to load framework code. Precedent: `frontend/vite.config.ts` already has an alias for a different `@hamak/*` framework-shipping quirk (`@hamak/ui-store-api → @hamak/ui-store/api`), so adding `server.deps.inline` is consistent with existing project handling of framework packaging issues.

## Inputs the next agent needs
- `.claude/work/156/spec.md` (approved cycle 2; unchanged)
- `.claude/work/156/dev-notes.md` (cycle 1 — context on what's already in the worktree)
- `.claude/work/156/test-results.md` (the 3 failures and exact diagnosis — see §"Failures")
- `frontend/vite.config.ts` (the file to edit)

## Cycle counter
- developer: 2/3
- test-author: 1/3 (does not reset — spec unchanged)
- spec-writer: 2/3 (closed at approve cycle 2)

## Pre-flight check for the next agent
- The cycle-1 dev diff is already in the worktree (notificationPlugin rewrite, new loggingPlugin.ts, bootstrap.ts edits, package.json dep add, CLAUDE.md fix). **Do NOT revert it** — the spec-mandated production changes are correct. The only edit needed is the Vitest config addition.
- Scope is narrow: add the `test.server.deps.inline` block to `frontend/vite.config.ts`. Do NOT modify the test file (`notificationPlugin.test.ts`) or any source file under `frontend/src/plugins/`. The fix lives in test-host configuration, not in any source file.
- After the change, verify by running `cd frontend && npx vitest run src/plugins/notification/__tests__/notificationPlugin.test.ts`. Expect all 3 tests to pass.
- Also run the full suite `cd frontend && npm test` and confirm no regression (181 passing tests in the other 25 files should remain green; the bootstrap suite goes from 0/3 → 3/3).
- Pre-existing baseline failures (`tsc --noEmit` scrollIntoView errors in AIChatPanel tests; `npm run lint` missing eslint config) remain out of scope per the spec — do not attempt to fix.
- The regex pattern test-author recommended is `[/^@hamak\/.*/]`. Either `/^@hamak\//` or `/^@hamak\/.*/` works; pick one and stay consistent with vitest config conventions elsewhere in the repo.
