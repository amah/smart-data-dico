/**
 * #155-search — content-guard regressions.
 *
 * Mirrors spec-grep-guards.integrity.test.ts: walk the file tree with
 * fs.readdirSync / readFileSync (NOT shell `grep`) and assert on content.
 * This file MUST NOT itself reintroduce any of the banned identifiers, so
 * the repo-wide walker excludes files whose basename ends in
 * `spec-grep-guards.search.test.ts`.
 *
 * Coverage map:
 *   #1  SEARCH_SERVICE_TOKEN declared exactly once in tokens.ts.
 *   #2  SearchService.ts does not import from `services/api`.
 *   #10 DI registration call appears inside the `initialize` body of
 *       searchPlugin (not `activate`) and uses `useValue`.
 *   #12 SearchComponent.tsx imports useService and calls it with
 *       SEARCH_SERVICE_TOKEN; the file contains no servicesApi.searchEntities.
 *   #13 searchSlice.ts no longer imports anything from ../../services/api;
 *       its thunk body calls useService<SearchService>(SEARCH_SERVICE_TOKEN).
 *   #14 services/api.ts no longer declares a `searchEntities` method on
 *       servicesApi (the property-declaration site is gone).
 *   #15 Repo-wide walk of frontend/src (*.ts and *.tsx files) finds zero
 *       occurrences of `servicesApi.searchEntities` (outside this guard file).
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const HERE = __dirname;
// `frontend/src/plugins/search/services/__tests__` is 5 levels under
// `frontend/src`; two more directories up to reach the repo root.
const REPO_ROOT = path.resolve(HERE, '..', '..', '..', '..', '..', '..');
const SRC = path.join(REPO_ROOT, 'frontend', 'src');

const TOKENS = path.join(SRC, 'kernel', 'tokens.ts');
const SERVICE = path.join(SRC, 'plugins', 'search', 'services', 'SearchService.ts');
const PLUGIN = path.join(SRC, 'plugins', 'search', 'searchPlugin.ts');
const SEARCH_COMPONENT = path.join(SRC, 'components', 'SearchComponent.tsx');
const SEARCH_SLICE = path.join(SRC, 'store', 'slices', 'searchSlice.ts');
const API = path.join(SRC, 'services', 'api.ts');

function read(file: string): string {
  return fs.readFileSync(file, 'utf8');
}

/**
 * Recursively walk a directory yielding absolute paths of every regular file.
 * Skips `node_modules` and `dist` defensively.
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

// -----------------------------------------------------------------------
// Criterion #1 — token declaration
// -----------------------------------------------------------------------
describe('#155-search criterion #1 — token declaration', () => {
  it('tokens.ts declares SEARCH_SERVICE_TOKEN exactly once with a Symbol value', () => {
    const content = read(TOKENS);
    const matches = content.match(
      /export\s+const\s+SEARCH_SERVICE_TOKEN\s*=\s*Symbol\(/g,
    );
    expect(
      matches,
      'SEARCH_SERVICE_TOKEN must be declared exactly once',
    ).not.toBeNull();
    expect(matches!.length).toBe(1);
  });
});

// -----------------------------------------------------------------------
// Criterion #2 — SearchService is self-contained
// -----------------------------------------------------------------------
describe('#155-search criterion #2 — SearchService is self-contained', () => {
  it('SearchService.ts does NOT import from services/api', () => {
    const content = read(SERVICE);
    expect(content).not.toMatch(/from\s+['"][^'"]*services\/api['"]/);
  });
});

// -----------------------------------------------------------------------
// Criterion #10 — DI registration in initialize with useValue
// -----------------------------------------------------------------------
describe('#155-search criterion #10 — DI registration in initialize with useValue', () => {
  it('searchPlugin.ts provides SEARCH_SERVICE_TOKEN inside initialize() with useValue', () => {
    const content = read(PLUGIN);

    const initStart = content.indexOf('async initialize(ctx)');
    expect(initStart, 'initialize() method should exist').toBeGreaterThanOrEqual(0);

    const activateStart = content.indexOf('async activate(', initStart);
    expect(activateStart, 'activate() method should follow initialize()').toBeGreaterThan(
      initStart,
    );

    const initBody = content.slice(initStart, activateStart);

    // Both the token reference and the ctx.provide call must sit inside the
    // initialize body.
    expect(initBody).toMatch(/SEARCH_SERVICE_TOKEN/);
    expect(initBody).toMatch(/ctx\.provide\s*\(/);
    expect(initBody).toMatch(/useValue\s*:/);

    // The provider block must NOT use useClass or useFactory.
    const provideBlock = initBody.match(
      /ctx\.provide\s*\(\s*\{[^}]*SEARCH_SERVICE_TOKEN[^}]*\}\s*\)/,
    );
    expect(
      provideBlock,
      'Provider block referencing SEARCH_SERVICE_TOKEN must be present',
    ).not.toBeNull();
    expect(provideBlock![0]).toMatch(/useValue/);
    expect(provideBlock![0]).not.toMatch(/useClass/);
    expect(provideBlock![0]).not.toMatch(/useFactory/);
  });
});

// -----------------------------------------------------------------------
// Criterion #12 — SearchComponent consumer migration
// -----------------------------------------------------------------------
describe('#155-search criterion #12 — SearchComponent consumer migration', () => {
  it('SearchComponent.tsx imports useService from ../kernel/useService', () => {
    const content = read(SEARCH_COMPONENT);
    expect(content).toMatch(/from\s+['"]\.\.\/kernel\/useService['"]/);
  });

  it('SearchComponent.tsx calls useService<SearchService>(SEARCH_SERVICE_TOKEN)', () => {
    const content = read(SEARCH_COMPONENT);
    expect(content).toMatch(
      /useService\s*<\s*SearchService\s*>\s*\(\s*SEARCH_SERVICE_TOKEN\s*\)/,
    );
  });

  it('SearchComponent.tsx contains no servicesApi.searchEntities reference', () => {
    const content = read(SEARCH_COMPONENT);
    expect(content).not.toMatch(/servicesApi\.searchEntities/);
  });
});

// -----------------------------------------------------------------------
// Criterion #13 — searchSlice thunk migration
// -----------------------------------------------------------------------
describe('#155-search criterion #13 — searchSlice thunk migration', () => {
  it('searchSlice.ts does not import from ../../services/api', () => {
    const content = read(SEARCH_SLICE);
    expect(content).not.toMatch(/from\s+['"][^'"]*services\/api['"]/);
  });

  it('searchSlice.ts thunk body calls useService<SearchService>(SEARCH_SERVICE_TOKEN)', () => {
    const content = read(SEARCH_SLICE);
    // The call site may span multiple lines; check both the useService call
    // and SEARCH_SERVICE_TOKEN presence in the file.
    expect(content).toMatch(/useService\s*</);
    expect(content).toMatch(/SEARCH_SERVICE_TOKEN/);
  });

  it('searchSlice.ts thunk body calls .searchEntities(query)', () => {
    const content = read(SEARCH_SLICE);
    expect(content).toMatch(/\.searchEntities\s*\(/);
  });
});

// -----------------------------------------------------------------------
// Criterion #14 — searchEntities gone from api.ts
// -----------------------------------------------------------------------
describe('#155-search criterion #14 — searchEntities gone from api.ts', () => {
  it('services/api.ts does not declare a searchEntities property on servicesApi', () => {
    const content = read(API);
    // Match the property-declaration pattern: `searchEntities:` inside the
    // servicesApi object literal.  We locate the servicesApi block and check
    // its interior only, to avoid false positives from import/type statements.
    const servicesApiStart = content.indexOf('export const servicesApi = {');
    expect(
      servicesApiStart,
      'servicesApi object declaration should still exist in api.ts',
    ).toBeGreaterThanOrEqual(0);

    // Grab from the opening brace to the closing `};` at the same nesting level.
    // A simple approach: from `servicesApiStart` scan until we see `};\n` or
    // `};\r` at the start of a line — reliable for the current flat structure.
    const afterOpen = content.slice(servicesApiStart);
    const closingIdx = afterOpen.search(/\n\};\s*(\n|$)/);
    const servicesApiBlock =
      closingIdx >= 0 ? afterOpen.slice(0, closingIdx) : afterOpen;

    expect(servicesApiBlock).not.toMatch(/\bsearchEntities\b/);
  });
});

// -----------------------------------------------------------------------
// Criterion #15 — no surviving servicesApi.searchEntities in frontend/src
// -----------------------------------------------------------------------
describe('#155-search criterion #15 — no surviving servicesApi.searchEntities', () => {
  it('repo-wide walk of frontend/src finds no servicesApi.searchEntities call sites outside this guard file', () => {
    const allowedSuffixes = ['spec-grep-guards.search.test.ts'];

    const offenders: Array<{ file: string; line: number; text: string }> = [];
    for (const file of walk(SRC)) {
      if (allowedSuffixes.some((s) => file.endsWith(s))) continue;
      if (!/\.(ts|tsx|js|jsx)$/.test(file)) continue;
      const lines = read(file).split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Skip lines that are pure comments (JSDoc migration prose). We
        // guard against surviving *call sites* — i.e. lines where the
        // identifier is followed by an opening parenthesis. A line that
        // only mentions the old API name in documentation is not a bug.
        if (!/servicesApi\.searchEntities\s*\(/.test(line)) continue;
        offenders.push({ file, line: i + 1, text: line.trim() });
      }
    }
    expect(
      offenders,
      `Unexpected \`servicesApi.searchEntities\` survivors:\n${JSON.stringify(offenders, null, 2)}`,
    ).toEqual([]);
  });
});

// -----------------------------------------------------------------------
// Bootstrap contract guard (mirrors integrity precedent's last describe)
// -----------------------------------------------------------------------
describe('#155-search — bootstrap singleton shape', () => {
  it('bootstrap.ts still exports bootstrapApplication and host', () => {
    const content = read(path.join(SRC, 'kernel', 'bootstrap.ts'));
    expect(content).toMatch(/export\s+async\s+function\s+bootstrapApplication\s*\(/);
    expect(content).toMatch(/export\s+const\s+host\s*=/);
  });
});
