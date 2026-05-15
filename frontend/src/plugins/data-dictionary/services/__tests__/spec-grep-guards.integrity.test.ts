/**
 * #155 integrity-slice pilot — content-guard regressions.
 *
 * Mirrors the pattern from #166's spec-grep-guards.test.ts: walk the file
 * tree with fs.readdirSync / readFileSync (NOT shell `grep`) and assert
 * on hits. Per agent guidance the new test files MUST NOT themselves
 * reintroduce the `integrityApi` import — the walker therefore inspects
 * `frontend/src/**` including `__tests__` directories, with this file
 * (and the prior IntegrityPage test if it persists prose references)
 * excluded by suffix.
 *
 * Coverage map:
 *   #1  INTEGRITY_SERVICE_TOKEN declared exactly once in tokens.ts.
 *   #2  IntegrityService.ts does not import from `services/api`.
 *   #3  DI registration call appears inside the `initialize` body of
 *       dataDictionaryPlugin (not `activate`) and uses `useValue`.
 *   #4  IntegrityPage.tsx contains a `useService(INTEGRITY_SERVICE_TOKEN)`
 *       call and no `integrityApi` references.
 *   #5  HomePage.tsx contains a `useService(INTEGRITY_SERVICE_TOKEN)`
 *       call and no `integrityApi` references.
 *   #6  api.ts no longer exports `integrityApi`.
 *   #7  Repo-wide (frontend/src/**): no `integrityApi` identifier
 *       survives outside this guard file. The walker explicitly excludes
 *       files whose basename ends in `spec-grep-guards.integrity.test.ts`
 *       so the literal `integrityApi` strings in this test do not
 *       falsely trip the guard against itself.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const HERE = __dirname;
// Resolve repo root: `frontend/src/plugins/data-dictionary/services/__tests__`
// is 5 levels deep under `frontend`, plus one more above `frontend` for the
// repo root.
const REPO_ROOT = path.resolve(HERE, '..', '..', '..', '..', '..', '..');
const FRONTEND = path.join(REPO_ROOT, 'frontend');
const SRC = path.join(FRONTEND, 'src');

const TOKENS = path.join(SRC, 'kernel', 'tokens.ts');
const SERVICE = path.join(
  SRC,
  'plugins',
  'data-dictionary',
  'services',
  'IntegrityService.ts',
);
const PLUGIN = path.join(
  SRC,
  'plugins',
  'data-dictionary',
  'dataDictionaryPlugin.ts',
);
const INTEGRITY_PAGE = path.join(SRC, 'pages', 'IntegrityPage.tsx');
const HOME_PAGE = path.join(SRC, 'pages', 'HomePage.tsx');
const API = path.join(SRC, 'services', 'api.ts');

function read(file: string): string {
  return fs.readFileSync(file, 'utf8');
}

/**
 * Recursively walk a directory yielding absolute paths of every regular
 * file. Skips `node_modules` and `dist` folders defensively (they should
 * not exist under `src/` but the walker is reusable).
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

describe('#155 acceptance #1 — token declaration', () => {
  it('tokens.ts declares INTEGRITY_SERVICE_TOKEN exactly once with a Symbol value', () => {
    const content = read(TOKENS);
    const matches = content.match(/export\s+const\s+INTEGRITY_SERVICE_TOKEN\s*=\s*Symbol\(/g);
    expect(matches, 'INTEGRITY_SERVICE_TOKEN must be declared exactly once').not.toBeNull();
    expect(matches!.length).toBe(1);
  });
});

describe('#155 acceptance #2 — IntegrityService is self-contained', () => {
  it('IntegrityService.ts does NOT import from services/api', () => {
    const content = read(SERVICE);
    // Match `from '...services/api'` or `from "...services/api"` for any
    // relative/absolute path ending in `services/api`.
    expect(content).not.toMatch(/from\s+['"][^'"]*services\/api['"]/);
  });
});

describe('#155 acceptance #3 — DI registration in initialize with useValue', () => {
  it('dataDictionaryPlugin.ts provides INTEGRITY_SERVICE_TOKEN inside initialize() with useValue', () => {
    const content = read(PLUGIN);
    // Locate the initialize body. The body opens at `async initialize(ctx) {`
    // and closes when the brace depth returns to its starting level. We
    // grab the slice between that opening and the start of the next
    // top-level method (`async activate(ctx)`) which is a structural cue
    // matching the current source.
    const initStart = content.indexOf('async initialize(ctx)');
    expect(initStart, 'initialize() method should exist').toBeGreaterThanOrEqual(0);
    const activateStart = content.indexOf('async activate(ctx)', initStart);
    expect(activateStart, 'activate() method should follow initialize()').toBeGreaterThan(initStart);
    const initBody = content.slice(initStart, activateStart);

    // Provider call shape: ctx.provide({ provide: INTEGRITY_SERVICE_TOKEN, useValue: ... })
    // The two key tokens must both appear inside the body.
    expect(initBody).toMatch(/INTEGRITY_SERVICE_TOKEN/);
    expect(initBody).toMatch(/ctx\.provide\s*\(/);
    expect(initBody).toMatch(/useValue\s*:/);
    // Negative: must NOT be a useClass / useFactory provider.
    const integrityBlock = initBody.match(
      /ctx\.provide\s*\(\s*\{[^}]*INTEGRITY_SERVICE_TOKEN[^}]*\}\s*\)/,
    );
    expect(integrityBlock, 'Provider block referencing INTEGRITY_SERVICE_TOKEN must be present').not.toBeNull();
    expect(integrityBlock![0]).toMatch(/useValue/);
    expect(integrityBlock![0]).not.toMatch(/useClass/);
    expect(integrityBlock![0]).not.toMatch(/useFactory/);
  });
});

describe('#155 acceptance #4 — IntegrityPage consumes via useService', () => {
  it('IntegrityPage.tsx imports useService and calls useService(INTEGRITY_SERVICE_TOKEN)', () => {
    const content = read(INTEGRITY_PAGE);
    expect(content).toMatch(/from\s+['"]\.\.\/kernel\/useService['"]/);
    expect(content).toMatch(/useService\s*<[^>]+>\s*\(\s*INTEGRITY_SERVICE_TOKEN\s*\)/);
  });

  it('IntegrityPage.tsx contains no `integrityApi` references', () => {
    const content = read(INTEGRITY_PAGE);
    expect(content).not.toMatch(/\bintegrityApi\b/);
  });
});

describe('#155 acceptance #5 — HomePage migrated', () => {
  it('HomePage.tsx imports useService and calls useService(INTEGRITY_SERVICE_TOKEN)', () => {
    const content = read(HOME_PAGE);
    expect(content).toMatch(/from\s+['"]\.\.\/kernel\/useService['"]/);
    expect(content).toMatch(/useService\s*<[^>]+>\s*\(\s*INTEGRITY_SERVICE_TOKEN\s*\)/);
  });

  it('HomePage.tsx contains no `integrityApi` references', () => {
    const content = read(HOME_PAGE);
    expect(content).not.toMatch(/\bintegrityApi\b/);
  });
});

describe('#155 acceptance #6 — integrityApi gone from api.ts', () => {
  it('services/api.ts no longer exports integrityApi', () => {
    const content = read(API);
    expect(content).not.toMatch(/^export\s+const\s+integrityApi\b/m);
    expect(content).not.toMatch(/\bintegrityApi\b/);
  });
});

describe('#155 acceptance #7 — no surviving consumer in frontend/src', () => {
  it('repo-wide walk of frontend/src returns no `integrityApi` identifier outside this guard file', () => {
    // Files allowed to mention the identifier in prose (this guard file
    // matches by suffix; any other test that needs to mention it should
    // be added to this allowlist explicitly).
    const allowedSuffixes = ['spec-grep-guards.integrity.test.ts'];

    const offenders: Array<{ file: string; line: number; text: string }> = [];
    for (const file of walk(SRC)) {
      if (allowedSuffixes.some((s) => file.endsWith(s))) continue;
      // Only inspect text-ish source files. The repo's src tree is .ts/.tsx
      // exclusively, but we filter defensively.
      if (!/\.(ts|tsx|js|jsx)$/.test(file)) continue;
      const lines = read(file).split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (/\bintegrityApi\b/.test(lines[i])) {
          offenders.push({ file, line: i + 1, text: lines[i] });
        }
      }
    }
    expect(
      offenders,
      `Unexpected \`integrityApi\` survivors:\n${JSON.stringify(offenders, null, 2)}`,
    ).toEqual([]);
  });
});

describe('#155 — bootstrap singleton remains the consumer pattern', () => {
  it('bootstrap.ts still exports bootstrapApplication and host (signature contract for tests)', () => {
    const content = read(path.join(SRC, 'kernel', 'bootstrap.ts'));
    expect(content).toMatch(/export\s+async\s+function\s+bootstrapApplication\s*\(/);
    expect(content).toMatch(/export\s+const\s+host\s*=/);
  });
});
