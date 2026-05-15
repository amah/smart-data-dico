/**
 * #155-diff — content-guard regressions.
 *
 * Mirrors spec-grep-guards.integrity.test.ts: walk the file tree with
 * fs.readdirSync / readFileSync (NOT shell `grep`) and assert on hits.
 * The walker includes `__tests__` directories but this file (and any
 * other guard file for diff) is excluded by suffix from the global scan
 * that checks for `diffApi` survivors — so the literal `diffApi` strings
 * in this file do not falsely trip the guard against itself.
 *
 * Coverage map (mirrors spec acceptance criteria):
 *   #1  No `diffApi` identifier survives anywhere in frontend/src, except
 *       inside this guard file. Verified by repo-wide walk with
 *       `spec-grep-guards.diff.test.ts` added to the allowedSuffixes.
 *   #2  tokens.ts declares DIFF_SERVICE_TOKEN exactly once.
 *   #4  DiffService.ts does not import from `services/api`.
 *   #5  dataDictionaryPlugin.ts provides DIFF_SERVICE_TOKEN inside
 *       initialize() body with useValue (not useClass / useFactory).
 *   #6  LogicalDiffPage.tsx imports useService and calls
 *       useService<...>(DIFF_SERVICE_TOKEN); contains no diffApi.
 *   #7  PhysicalDiffPage.tsx imports useService and calls
 *       useService<...>(DIFF_SERVICE_TOKEN); contains no diffApi,
 *       no axios.create, no top-level `import axios from 'axios'`.
 *   #8  services/api.ts no longer exports diffApi.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const HERE = __dirname;
// Resolve repo root: `frontend/src/plugins/data-dictionary/services/__tests__`
// is 5 levels deep under `frontend/src`, plus one more for `frontend`, plus
// one more for the repo root.
const REPO_ROOT = path.resolve(HERE, '..', '..', '..', '..', '..', '..');
const FRONTEND = path.join(REPO_ROOT, 'frontend');
const SRC = path.join(FRONTEND, 'src');

const TOKENS = path.join(SRC, 'kernel', 'tokens.ts');
const DIFF_SERVICE_FILE = path.join(
  SRC,
  'plugins',
  'data-dictionary',
  'services',
  'DiffService.ts',
);
const PLUGIN = path.join(
  SRC,
  'plugins',
  'data-dictionary',
  'dataDictionaryPlugin.ts',
);
const LOGICAL_DIFF_PAGE = path.join(SRC, 'pages', 'LogicalDiffPage.tsx');
const PHYSICAL_DIFF_PAGE = path.join(SRC, 'pages', 'PhysicalDiffPage.tsx');
const API = path.join(SRC, 'services', 'api.ts');

function read(file: string): string {
  return fs.readFileSync(file, 'utf8');
}

/**
 * Recursively walk a directory yielding absolute paths of every regular
 * file. Skips `node_modules` and `dist` folders defensively.
 */
function* walk(dir: string): Generator<string> {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(full);
    } else if (entry.isFile()) {
      yield full;
    }
  }
}

describe('#155-diff acceptance #1 — no diffApi survivors in frontend/src', () => {
  it('repo-wide walk of frontend/src returns no `diffApi` identifier outside this guard file', () => {
    // Files allowed to mention the identifier in prose (this guard file
    // matches by suffix so the literal `diffApi` strings here do not
    // falsely trip the guard).
    const allowedSuffixes = ['spec-grep-guards.diff.test.ts'];

    const offenders: Array<{ file: string; line: number; text: string }> = [];
    for (const file of walk(SRC)) {
      if (allowedSuffixes.some((s) => file.endsWith(s))) continue;
      if (!/\.(ts|tsx|js|jsx)$/.test(file)) continue;
      const lines = read(file).split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (/\bdiffApi\b/.test(lines[i])) {
          offenders.push({ file, line: i + 1, text: lines[i] });
        }
      }
    }
    expect(
      offenders,
      `Unexpected \`diffApi\` survivors:\n${JSON.stringify(offenders, null, 2)}`,
    ).toEqual([]);
  });
});

describe('#155-diff acceptance #2 — DIFF_SERVICE_TOKEN declared exactly once', () => {
  it('tokens.ts declares DIFF_SERVICE_TOKEN exactly once with a Symbol value', () => {
    const content = read(TOKENS);
    const matches = content.match(
      /export\s+const\s+DIFF_SERVICE_TOKEN\s*=\s*Symbol\(/g,
    );
    expect(matches, 'DIFF_SERVICE_TOKEN must be declared exactly once').not.toBeNull();
    expect(matches!.length).toBe(1);
  });
});

describe('#155-diff acceptance #4 — DiffService is self-contained', () => {
  it('DiffService.ts does NOT import from services/api', () => {
    const content = read(DIFF_SERVICE_FILE);
    expect(content).not.toMatch(/from\s+['"][^'"]*services\/api['"]/);
  });
});

describe('#155-diff acceptance #5 — DI registration in initialize with useValue', () => {
  it('dataDictionaryPlugin.ts provides DIFF_SERVICE_TOKEN inside initialize() with useValue', () => {
    const content = read(PLUGIN);

    const initStart = content.indexOf('async initialize(ctx)');
    expect(initStart, 'initialize() method should exist').toBeGreaterThanOrEqual(0);
    const activateStart = content.indexOf('async activate(ctx)', initStart);
    expect(activateStart, 'activate() method should follow initialize()').toBeGreaterThan(initStart);
    const initBody = content.slice(initStart, activateStart);

    // Provider call shape: ctx.provide({ provide: DIFF_SERVICE_TOKEN, useValue: ... })
    expect(initBody).toMatch(/DIFF_SERVICE_TOKEN/);
    expect(initBody).toMatch(/ctx\.provide\s*\(/);
    expect(initBody).toMatch(/useValue\s*:/);

    // The provider block must reference DIFF_SERVICE_TOKEN and use useValue.
    const diffBlock = initBody.match(
      /ctx\.provide\s*\(\s*\{[^}]*DIFF_SERVICE_TOKEN[^}]*\}\s*\)/,
    );
    expect(
      diffBlock,
      'Provider block referencing DIFF_SERVICE_TOKEN must be present',
    ).not.toBeNull();
    expect(diffBlock![0]).toMatch(/useValue/);
    expect(diffBlock![0]).not.toMatch(/useClass/);
    expect(diffBlock![0]).not.toMatch(/useFactory/);
  });
});

describe('#155-diff acceptance #6 — LogicalDiffPage consumes via command bus (#163 migration)', () => {
  // #163: LogicalDiffPage migrated from useService(DIFF_SERVICE_TOKEN) to
  // commands.run('data-dictionary.diff.getLogical', ...) via useCommand().
  it('LogicalDiffPage.tsx imports useCommand and calls commands.run for diff.getLogical', () => {
    const content = read(LOGICAL_DIFF_PAGE);
    expect(content).toMatch(/from\s+['"]\.\.\/kernel\/useCommand['"]/);
    expect(content).toMatch(/['"]data-dictionary\.diff\.getLogical['"]/);
  });

  it('LogicalDiffPage.tsx contains no `diffApi` references', () => {
    const content = read(LOGICAL_DIFF_PAGE);
    expect(content).not.toMatch(/\bdiffApi\b/);
  });
});

describe('#155-diff acceptance #7 — PhysicalDiffPage consumes via command bus (#163 migration)', () => {
  // #163: PhysicalDiffPage migrated from useService(DIFF_SERVICE_TOKEN) to
  // commands.run('data-dictionary.diff.*', ...) via useCommand().
  it('PhysicalDiffPage.tsx imports useCommand and calls commands.run for diff commands', () => {
    const content = read(PHYSICAL_DIFF_PAGE);
    expect(content).toMatch(/from\s+['"]\.\.\/kernel\/useCommand['"]/);
    expect(content).toMatch(/['"]data-dictionary\.diff\.getPhysicalConfig['"]/);
  });

  it('PhysicalDiffPage.tsx contains no `diffApi` references', () => {
    const content = read(PHYSICAL_DIFF_PAGE);
    expect(content).not.toMatch(/\bdiffApi\b/);
  });

  it('PhysicalDiffPage.tsx has no local axios.create call', () => {
    const content = read(PHYSICAL_DIFF_PAGE);
    expect(content).not.toMatch(/axios\.create\s*\(/);
  });

  it('PhysicalDiffPage.tsx has no top-level `import axios from \'axios\'`', () => {
    const content = read(PHYSICAL_DIFF_PAGE);
    // The local axios import was removed as part of this slice.
    // A type-only import from DiffService is fine; only the bare default
    // import of the runtime is forbidden.
    expect(content).not.toMatch(/^import\s+axios\s+from\s+['"]axios['"]/m);
  });
});

describe('#155-diff acceptance #8 — diffApi gone from api.ts', () => {
  it('services/api.ts no longer exports diffApi', () => {
    const content = read(API);
    expect(content).not.toMatch(/^export\s+const\s+diffApi\b/m);
    expect(content).not.toMatch(/\bdiffApi\b/);
  });
});

describe('#155-diff — bootstrap contract (tokens.ts and bootstrap.ts)', () => {
  it('bootstrap.ts still exports bootstrapApplication and host (signature contract for tests)', () => {
    const bootstrapFile = path.join(SRC, 'kernel', 'bootstrap.ts');
    const content = read(bootstrapFile);
    expect(content).toMatch(/export\s+async\s+function\s+bootstrapApplication\s*\(/);
    expect(content).toMatch(/export\s+const\s+host\s*=/);
  });

  it('tokens.ts also exports INTEGRITY_SERVICE_TOKEN (sibling integrity guard still valid)', () => {
    const content = read(TOKENS);
    // Integrity guard file must not be broken by this slice — its token
    // must still be present in tokens.ts.
    const matches = content.match(
      /export\s+const\s+INTEGRITY_SERVICE_TOKEN\s*=\s*Symbol\(/g,
    );
    expect(matches).not.toBeNull();
    expect(matches!.length).toBe(1);
  });
});
