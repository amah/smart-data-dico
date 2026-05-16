# Spec review — #166: stereotype-slice pilot — Store FS DI plumbing + StereotypeService facade  (cycle 3, final)

## Verdict
**approve**

Both required changes from cycle 2 have been applied verbatim and are independently verified against the framework sources. The rest of the spec is unchanged in any substantive way. Three minor cosmetic stragglers remain (title, acceptance #17 attempts-log regex, Risk 3 phrasing) but none are blocking.

## Cycle-2 issue verification

### Required Change #1 — `setFile` silent no-op fixed via `mkdir(parents=true)` before `setFile`

Cycle 3 spec lines 502-530 (the `hydrate` method body):

```ts
private hydrate(list: Stereotype[], contentIsPresent: boolean): void {
  // ... 12-line JSDoc explaining the bug and the fix, citing fs-commands.js:127-149
  //     and fs-commands.js:69-104 lines 86-89, and the positional mkdir
  //     signature at fs-adapter.d.ts:53 / fs-adapter.js:97-100 ...
  const actions = this.storeFs.getActions();
  this.dispatch(
    actions.mkdir(['dictionaries', '.dico'], true),
  );
  this.dispatch(
    actions.setFile(
      [...STEREOTYPES_PATH],
      list,
      'application/yaml',
      { override: true, contentIsPresent },
    ),
  );
}
```

Verified:
- **`mkdir` is dispatched BEFORE `setFile`**: spec lines 519-521 then 522-529. Correct order.
- **`mkdir` signature is positional**: `mkdir(path, parents?, extensionStates?)`. Confirmed at `frontend/node_modules/@hamak/ui-store-impl/dist/fs/core/fs-adapter.d.ts:53` (`mkdir(path: string | string[], parents?: boolean, extensionStates?: Record<string, unknown>): FileSystemNodeAction`) and at `fs-adapter.js:97-101` (`mkdir(path, parents, extensionStates) { return { type: this.mkdirType, command: { name: 'mkdir', path, parents, extensionStates } }; }`). The spec passes `(['dictionaries', '.dico'], true)` — positional, matches.
- **`parents=true` actually creates intermediates**: confirmed at `fs-commands.js:86-89` (`if (parents === true) { child = createDirectoryNode(step); dir.children[step] = child; }` inside the `for (let i = 0; i < steps.length; i++)` loop, gated on the non-last step and `dir.children[step] === undefined`). The handler iterates every step and creates each missing intermediate. For `['dictionaries', '.dico']`, this creates both `dictionaries` (i=0) and `.dico` (i=1, last step → the leaf-directory branch at lines 78-82). Both directories exist after dispatch.
- **Re-hydration is safe (idempotency)**: at fs-commands.js:78-82, the leaf-step path `if (dir.children[step] === undefined) dir.children[step] = createDirectoryNode(step, extensionStates);` — if the directory already exists, no-op. At lines 86-95, the intermediate-step path already handles existing directories via the `else if (child.type === 'directory') { dir = child; }` branch. Calling `hydrate` multiple times in succession will not mutate `dictionaries` or `.dico` after the first call.
- **Acceptance criterion updated**: cycle 3 spec line 899 (acceptance #5) was extended:

  > "Pre-populate the cache by dispatching `mkdir(['dictionaries', '.dico'], true)` followed by `setFile(STEREOTYPES_PATH, [<fixture>], 'application/yaml', { override: true, contentIsPresent: true })`. (The `mkdir` step is required: without it `setFile` is a silent no-op against a fresh `root.children: {}` — see fs-commands.js:127-149.) The simplest test path is to invoke `service['hydrate']([<fixture>], true)` directly, which already encodes the mkdir-then-setFile sequence."

  This satisfies the cycle-2 reviewer's mandate that "the matching acceptance criterion or test setup is updated to NOT expect a pre-populated `.dico` directory before `hydrate` runs". Tests that go through `hydrate` get the `mkdir` for free.

### Required Change #2 — `loading` derivation replaced with cookbook-equivalent form

Cycle 3 spec line 695:

```ts
const loading = !file || (!file.state.contentLoaded && !file.state.contentLoadError);
```

This is **exactly** the second of the two equivalent forms the cycle-2 reviewer offered (review lines 52-55). Verified by truth-table trace against all four states:

| `file` | `contentLoaded` | `contentLoadError` | Expected | Computed |
|---|---|---|---|---|
| undefined | n/a | n/a | true (no node yet → loading) | `!undefined = true` → short-circuit → **true** ✓ |
| node | true | undefined | false (loaded successfully) | `!false || (!true && !undefined) = false || (false && true) = false` → **false** ✓ |
| node | false | undefined | true (still loading) | `!false || (!false && !undefined) = false || (true && true) = true` → **true** ✓ |
| node | true/false | { ... } | false (errored — show error, not spinner) | `false || (!X && !error) = false || (Y && false) = false` → **false** ✓ |

All four states semantically correct. No `??` short-circuit lurking — purely boolean `&&` / `||` operators.

`contentLoading` is NOT consulted in the expression. The spec's inline comment (lines 685-694) explains why:

> "Rationale for not consulting `contentLoading`: in this pilot the framework never mutates that field on our path. There is no GET_REQUEST/GET_COMPLETED flow because we use the legacy REST shim — we drive Store FS purely via setFile, which sets `contentLoaded` directly without touching `contentLoading`."

I cross-verified this claim independently. `fileSystemNodeInitialState(contentPresent)` at `frontend/node_modules/@hamak/shared-utils/dist/core-utils-filesystem.js:2-9` initializes `contentLoading: false` and `contentLoaded: contentPresent`. The pilot's `setFile` path through `executeSetFile` (`fs-commands.js:140`) constructs a node via `createFileNode(last, content, schema, fileSystemNodeInitialState(contentIsPresent), extensionStates)` — no `contentLoading` mutation in the constructor or anywhere else in the `setFile` action handler. So the spec's claim is accurate and including `contentLoading` in the derivation would be dead weight that confuses future readers.

**Acceptance criterion updated**: cycle 3 spec line 939 (acceptance #12) was extended:

> "**First paint = loading state.** Synchronously after `render(...)`, before awaiting MSW, the DOM contains the loading `EmptyState` (e.g. `screen.getByText('Loading stereotypes…')`). This pins the cookbook-canonical loading derivation — when `file` is `undefined` on first render (before the mount-effect dispatches anything), `loading === true`. The previous nullish-coalescing form failed this check (cycle-2 review issue #2)."

This satisfies the cycle-2 reviewer's mandate that "there must be a test that asserts the loading message renders SYNCHRONOUSLY before any async waits, otherwise the bug class returns." `screen.getByText` is synchronous; the assertion fires before MSW's promise resolves.

**Cookbook citation**: the spec's inline comment at line 685 cites "patterns.md §2 (line 128-129)". The cookbook canon for the loading derivation is actually at **lines 40-41**:

```ts
const loading = file?.state.contentLoading ?? false;
const error   = file?.state.contentLoadError;
```

Lines 128-129 are the anti-patterns section (e.g. `❌ useState<boolean>(false) named loading`). The spec's expression `!file || (!file.state.contentLoaded && !file.state.contentLoadError)` is a logical-equivalent of the cycle-2 reviewer's offered alternate form, not a verbatim quote of the patterns.md canon. The line citation is wrong but the underlying expression is correct. Cosmetic; not blocking.

## Scope-creep audit — what else changed?

Diffed cycle 3 against cycle 2 by structural section count and risk count:

| Section | Cycle 2 | Cycle 3 | Δ |
|---|---|---|---|
| Acceptance criteria count | 17 | 17 | 0 |
| Risk count | 7 | 7 | 0 |
| Files-touched bullet count | unchanged from cycle 2 review's confirmation | same | 0 |
| Upstream framework bugs (A + B) | both present | both present, source quotes identical | 0 |
| Out-of-scope bullet count | unchanged | unchanged | 0 |
| Dependencies bullet count | unchanged | unchanged | 0 |
| Framework citations | 51 `@hamak/` references | 51 `@hamak/` references | 0 |

The two additions in cycle 3 are:
1. The `mkdir` action creator cited at `fs-adapter.d.ts:53` and `fs-adapter.js:97-100` — both verified.
2. The `executeMkdir` handler at `fs-commands.js:69-104` (specifically 86-89) — already cited in cycle 2's review and still present in cycle 2's `hydrate` JSDoc context; just reused in the cycle-3 `hydrate` body comment.

No new content beyond the two fixes. No bullet additions to risks or out-of-scope. No new acceptance criteria — items #5 and #12 each gained a sentence/paragraph but the count is unchanged.

## Framework citation verification

| Cited path | Verified | Notes |
|---|---|---|
| `@hamak/ui-store-impl/dist/fs/core/fs-adapter.d.ts:53` `mkdir(path, parents?, extensionStates?): FileSystemNodeAction` | YES | Exact match. |
| `@hamak/ui-store-impl/dist/fs/core/fs-adapter.js:97-100` runtime body matches `.d.ts` shape | YES | Lines 97-101 (closing brace at 101); positional args; no options-object form. |
| `@hamak/ui-store-impl/dist/fs/commands/fs-commands.js:86-89` `if (parents === true) { ... dir.children[step] = child; }` | YES | Confirmed verbatim. |
| `@hamak/ui-store-impl/dist/fs/commands/fs-commands.js:127-149` `executeSetFile` silent return on missing parent | YES | Confirmed: `if (parentDir === undefined) return;` at line ~133. |
| `@hamak/shared-utils/dist/core-utils-filesystem.js:2-9` `fileSystemNodeInitialState` sets `contentLoaded: contentPresent` and `contentLoading: false` | YES | Confirmed. |
| `frontend/docs/patterns.md` §2 canonical form lines 40-41 | YES (form exists) | But the spec's inline comment cites "lines 128-129" — those are the anti-patterns section, not the canon. The expression itself is a logical equivalent of the cycle-2 reviewer's offered alternate. Wrong line citation; correct underlying form. Cosmetic. |
| All cycle-2 citations (RemoteFsAutosaveProvider.supports bug, PathTranslator.toRemotePath bug, autosave middleware action-type list, host lifecycle, FileSystemNodeState shape, etc.) | YES | Re-verified the ones I sampled (`autosave-middleware.js:15-18`, `host.js:85-138`, `core-utils-filesystem.d.ts:15-25`). Unchanged from cycle 2. |

No mis-citations of substance. The lone slip is the patterns.md line reference in an inline comment — easily fixed by the implementor without re-spec'ing, and the cycle-2 reviewer pre-approved the cycle-3 form on its merits regardless of where in patterns.md it lives.

## Risk reassessment

Cycle 2's risks 1-7 stand. The two bugs that cycle 2's review surfaced as "Risk 8 (new)" and "Risk 9 (new)" are addressed by the two fixes:

- **Cycle-2 Risk 8** (setFile silent no-op) — closed by `hydrate`'s `mkdir`-then-`setFile` sequence. Acceptance #5 enforces the precondition.
- **Cycle-2 Risk 9** (`contentLoading` never written) — acknowledged in the page's inline comment and routed around by the new derivation. Documented as "dead code for this pilot, will re-activate post-#167".

Overall risk: **Medium**. Down from cycle 2's "Medium-to-High". No new substantive risks introduced in cycle 3.

## Cross-ticket conflicts

None new. Spot-checked:
- No other in-flight specs under `.claude/work/*/spec.md` (only this ticket's work folder exists).
- Multi-kind YAML (#106) — `stereotypes.yaml` is single-kind; not relevant.
- Validation/Constraint/Rule trinity (#85) — not touched.
- Command/event naming (#163) — `notification.error` is a framework-registered command; spec uses it correctly via `ctx.commands.execute('notification.error', { message })`.
- Path semantics (#168) — pilot uses filesystem-shaped paths and explicitly defers the logical-vs-raw split; consistent with the dual-view direction.

## Suggestions (non-blocking)

1. **Cosmetic — title still says "cycle 2".** Line 1 reads `# Spec — #166 (stereotype-slice pilot): Store FS DI plumbing + StereotypeService facade  (cycle 2)`. The implementor or rework-coordinator can bump this to `(cycle 3)` for hygiene. Doesn't affect implementation.

2. **Cosmetic — Acceptance #17 hard-codes `notes=cycle 2`.** Line 961 says the spec-writer's attempts-log line MUST match `notes=cycle 2; …`. But the actual cycle 3 spec-writer entry (attempts.log line 15-16) reads `notes=cycle 3; …`. The acceptance criterion as written is a stale regex from cycle 2. Since this acceptance is metadata about the spec-writer step (not the implementor step), it can't actually be enforced against the implementor — it's effectively defunct. Either delete the criterion or bump the cycle number.

3. **Cosmetic — Risk 3 phrasing.** Line 1011 still says "useState exception was eliminated in cycle 2." Strictly true (the structural removal happened in cycle 2) but reads oddly in a cycle-3 document. The cycle-2 derivation-bug fix is what made cycle 2's elimination actually functional; consider a one-line note. Non-blocking.

4. **Inline comment patterns.md line citation is wrong.** Spec line 686 cites "patterns.md §2 (line 128-129)" for the canonical loading derivation, but lines 128-129 are anti-patterns. The actual cookbook canon is at lines 40-41. The implementor can fix this when writing the JSDoc; reviewer of the eventual PR should not be confused since the expression is correct. Non-blocking.

5. **Cycle 2's suggestions list still applies.** The cycle-2 reviewer flagged:
   - Acceptance #13's grep regex robustness (the `editingId`/`showCreate` exclusion is name-coupled).
   - Preferring `FILESYSTEM_ADAPTER_TOKEN` over `storeManager.getFileSystemAdapter()` cast.
   - The dead `errorMessage` binding on the page (nothing currently sets `contentLoadError`).
   - The implementor's branch-base note belongs in the test file's comments, not just `attempts.log`.

   None of these were addressed in cycle 3 (cycle 3 was tightly scoped to the two required changes — correct discipline). They remain suggestions for the implementor's PR or for a follow-up cookbook entry.

## Final recommendation to rework-coordinator

**Approve as-is.** Both cycle-2 required changes are applied correctly, independently verified against the framework sources, and pinned by updated acceptance criteria (#5 for `mkdir`-before-`setFile`, #12 for first-paint-loading-state). No new substantive bugs introduced. No scope creep. Three cosmetic line-numbers/labels are off; the implementor can fix them inline without spec churn.

The spec is implementable as written. Hand off to developer.
