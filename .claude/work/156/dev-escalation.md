# Dev escalation — #156

## What I tried

Applied the exact one-line fix prescribed by `test-results.md` and reaffirmed by `next-step.md`: added `server: { deps: { inline: [/^@hamak\//] } }` inside the `test:` block of `frontend/vite.config.ts`, placed between `css: true,` and `coverage: { … }`. The block is correctly nested under `test.server` (the Vitest 1.6 location, not the legacy top-level `deps.inline`). Verified the edit is present in the file before re-running tests.

## What failed

Re-running `npx vitest run src/plugins/notification/__tests__/notificationPlugin.test.ts` produces the **identical** error that cycle 1 hit:

```
FAIL  src/plugins/notification/__tests__/notificationPlugin.test.ts  (0 test)
Error: Cannot find module
  '/Users/amah/Devs/projects/smart-data-dico/frontend/node_modules/@hamak/microkernel-impl/dist/runtime/di'
  imported from
  '/Users/amah/Devs/projects/smart-data-dico/frontend/node_modules/@hamak/microkernel-impl/dist/index.js'
Serialized Error: { code: 'ERR_MODULE_NOT_FOUND', url: '…/dist/runtime/di' }
```

To rule out anything in the test file itself, I ran a minimal probe `probe-vitest-156.test.ts` at the frontend root:

```ts
import { describe, it, expect } from 'vitest';
describe('probe', () => {
  it('can import @hamak/microkernel-impl', async () => {
    const mod = await import('@hamak/microkernel-impl');
    expect(typeof mod.Host).toBe('function');
  });
});
```

Same error — failure happens on the bare `import('@hamak/microkernel-impl')`. So `server.deps.inline: [/^@hamak\//]` is **not** transforming `@hamak/microkernel-impl/dist/index.js`'s extensionless `export * from './runtime/di';` line. (Probe file deleted after the experiment.)

Expected (per test-results.md "Diagnosis"): Vitest pulls `@hamak/microkernel-impl` through Vite's transform pipeline, which rewrites the extensionless specifier `./runtime/di` to `./runtime/di.js`, and the import succeeds.
Actual: Vitest still forwards the import to Node's strict ESM loader, which rejects the extensionless specifier with `ERR_MODULE_NOT_FOUND`.

Vitest version confirmed: `vitest/1.6.1 darwin-x64 node-v22.12.0` (matches what test-results.md tested against). The `frontend/node_modules/@hamak/microkernel-impl/dist/runtime/di.js` file exists on disk — only the **extension** is missing in the importer.

## Why I think the spec needs revision

The spec's accepted remediation (the `server.deps.inline: [/^@hamak\//]` one-liner) doesn't actually make Vitest 1.6.1 transform `@hamak/microkernel-impl`'s extensionless ESM internals. Either (a) the framework's `@hamak/microkernel-impl` packaging needs a separate fix (e.g., adding `.js` extensions in its built `dist/`, which is outside this repo), or (b) the Vitest config needs a different mechanism than `server.deps.inline` to handle this packaging quirk — but the spec's "DO NOT improvise additional vite-config plumbing" hard rule forbids me from trying alternatives unilaterally.

The cycle-1 production code (the notification plugin rewrite, new logging plugin, bootstrap.ts edits, package.json dep add, CLAUDE.md fix) is correct and `vite build` is clean — only the **test-host module-resolution** for `@hamak/*` packages is unresolved. The Vitest 1.6 docs do say `test.server.deps.inline` should force a module through Vite's transform pipeline, so the prescribed config is plausible on paper; in practice it isn't sufficient for this particular framework packaging.

## Question for spec-writer

What is the approved next step? Options I can see (without improvising):

1. **Pin Vitest to a different version** (Vitest 2.x changed the `deps` story to `test.server.deps.inline` + `test.deps.optimizer.web.include`, which sometimes handles this case differently). Out of scope for this ticket unless the spec allows it.
2. **Add `test.deps.optimizer.web.include: ['@hamak/*']`** (Vitest 1.6 also supports this; it forces pre-bundling via esbuild rather than transform-on-read). This is "additional vite-config plumbing" the current spec forbids.
3. **Add a `frontend/vitest.setup-resolver` shim that polyfills resolve for `@hamak/*`**. Higher-risk; not in the spec.
4. **Defer Acceptance #6/#7 to a follow-up ticket** that fixes either the framework's `@hamak/microkernel-impl` build (adding `.js` extensions) or the test-host config in a more targeted way. The cycle-1 production diff still satisfies criteria #1–#4, #8, #9, #10. Criteria #6 and #7 (and #11 by extension) would explicitly defer.
5. **Allow option 2 via spec revision** (cycle-3 spec adds the optimizer-include line alongside the inline regex).

Any of 1, 2, 3, 5 is a one-edit-each change once approved; option 4 is a no-op on the worktree (revert nothing) and a scope reduction in the spec.

## Worktree status before escalation

- `frontend/vite.config.ts` carries the `server.deps.inline: [/^@hamak\//]` block (per the cycle-2 directive). I'm **leaving it in place** so the reviewer can see exactly what was tried.
- All cycle-1 production changes remain intact (no reverts).
- No test files modified.
- Probe file `frontend/probe-vitest-156.test.ts` was created at the frontend root for diagnosis and deleted afterward (not under `src/`; not committed).
