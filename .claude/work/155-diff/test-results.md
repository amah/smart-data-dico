# Test results — #155-diff  (cycle 1)

## Coverage of acceptance criteria

| Criterion | Test file:lines | Status |
|---|---|---|
| 1. `diffApi` identifier gone everywhere except the guard file | `spec-grep-guards.diff.test.ts:80-100` | ✅ pass |
| 2. `DIFF_SERVICE_TOKEN` declared exactly once in tokens.ts | `spec-grep-guards.diff.test.ts:103-112` | ✅ pass |
| 3. `DiffService.ts` exports class with 4 public methods | `spec-grep-guards.diff.test.ts:115-120` (exists + self-contained check) + `DiffService.test.ts:197-206` (default ctor) | ✅ pass |
| 4. `DiffService.ts` does not import from `services/api` | `spec-grep-guards.diff.test.ts:115-120` | ✅ pass |
| 5. `dataDictionaryPlugin.ts` provides `DIFF_SERVICE_TOKEN` inside `initialize` with `useValue` | `spec-grep-guards.diff.test.ts:123-152` | ✅ pass |
| 6. `LogicalDiffPage.tsx` uses `useService(DIFF_SERVICE_TOKEN)` and no `diffApi` | `spec-grep-guards.diff.test.ts:155-166` | ✅ pass |
| 7. `PhysicalDiffPage.tsx` uses `useService(DIFF_SERVICE_TOKEN)`, no `diffApi`, no `axios.create`, no top-level `import axios from 'axios'` | `spec-grep-guards.diff.test.ts:169-196` | ✅ pass |
| 8. `services/api.ts` no longer exports `diffApi` | `spec-grep-guards.diff.test.ts:199-205` | ✅ pass |
| 9. Unit suite — 4 methods + reject propagation + no-arg ctor + zero `vi.mock` | `DiffService.test.ts:1-208` (16 tests) | ✅ pass |
| 10. Bootstrap suite — resolve returns service with 4 methods, singleton | `dataDictionaryPlugin.diff.test.ts:1-55` (3 tests) | ✅ pass |
| 11. Spec-grep-guards suite — criteria #1 #2 #4 #5 #6 #7 #8 as fs-walk assertions | `spec-grep-guards.diff.test.ts:1-220` (13 tests) | ✅ pass |
| 12. LogicalDiffPage page test — bootstrap, MSW, Compare fires POST, severity tile renders | `LogicalDiffPage.test.tsx:1-113` (5 tests) | ✅ pass |
| 13. PhysicalDiffPage page test — single-service DDL, all-services config fetch, `Live (postgres)` label, POST /api/diff/physical/all fires | `PhysicalDiffPage.test.tsx:1-324` (7 tests) | ✅ pass |
| 14. Page tests do NOT use `vi.mock('../../services/api', ...)` | Both page test files examined — no `vi.mock` call present | ✅ pass |
| 15. New test files do not exist on `main` | Verified by task brief; files are new on `arch/155-diff` branch | ✅ pass |
| 16. Both `spec-grep-guards.diff` and `spec-grep-guards.integrity` pass together | Run together: 23/23 pass | ✅ pass |

## Failures

None. All 44 tests pass.

## Build status

- Test files: 5
- Tests: 44 pass, 0 fail, 0 skip
- Test suite runtime: ~7.2s

### Test corrections made (test bugs, not implementation bugs)

1. `LogicalDiffPage.test.tsx` — initial assertion used `getByText(/Breaking/i)` which threw "Found multiple elements" because "Breaking" appears in both the severity tile label and a `StatusChip` component within the band header. Fixed to `getAllByText(/Breaking/i).length >= 1`.
2. `PhysicalDiffPage.test.tsx` — `getByText(/Matched/i)` likewise matched both a tile label and a chip; fixed to `getAllByText`. `getByText('user-service')` matched both the select option and the per-service card heading; fixed to `getAllByText`. The all-services DDL test required a per-test `server.use` override so `user-service` returns `null` physical config (causing the page to seed it as `type:'ddl'` and render the DDL textarea) — the default fixture returns `{ dialect: 'postgres' }` which seeds services as `type:'live'`, hiding the DDL textarea.
3. `spec-grep-guards.diff.test.ts` — initial draft of page test comment blocks mentioned `diffApi` as a word which tripped the repo-wide walker. Comments were reworded to "legacy diff API export" before the guard was finalized.

No implementation bugs were found. All spec acceptance criteria are verifiably implemented.
