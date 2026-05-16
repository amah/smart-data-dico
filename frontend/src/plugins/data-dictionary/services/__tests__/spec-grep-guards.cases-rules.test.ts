/**
 * #161 cases-rules — content-guard regressions.
 *
 * Mirrors the pattern from spec-grep-guards.integrity.test.ts: walk the file
 * tree with fs.readdirSync / readFileSync (NOT shell `grep`) and assert
 * on hits. The guard file is excluded from its own repo-wide walks to
 * prevent self-referential false positives.
 *
 * Coverage map:
 *   #1  CASE_SERVICE_TOKEN and RULE_SERVICE_TOKEN each declared exactly once
 *       in tokens.ts with Symbol(...) value.
 *   #2  CaseService.ts and RuleService.ts do NOT import from services/api.
 *   #3  DI registration for both tokens appears inside initialize() (not
 *       activate()) and uses useValue (not useClass/useFactory).
 *   #4  api.ts no longer exports caseApi or ruleApi.
 *   #5  No identifier caseApi or ruleApi survives in frontend/src/**
 *       outside this guard file.
 *   #6  plugins/case/ and plugins/rules/ directories do not exist.
 *   #7  casesSlice.ts is at the new path (plugins/data-dictionary/slices/)
 *       and does NOT exist at the old path (store/slices/).
 *   #8  rulesSlice.ts exists at the new path and exports default rulesReducer.
 *   #9  bootstrap.ts does NOT import createCasePlugin or createRulesPlugin.
 *   #10 bootstrap.ts imports rulesReducer from the new path.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const HERE = __dirname;
// Resolve repo root: `frontend/src/plugins/data-dictionary/services/__tests__`
// is 6 levels deep under the repo root.
const REPO_ROOT = path.resolve(HERE, '..', '..', '..', '..', '..', '..');
const FRONTEND = path.join(REPO_ROOT, 'frontend');
const SRC = path.join(FRONTEND, 'src');

const TOKENS = path.join(SRC, 'kernel', 'tokens.ts');
const CASE_SERVICE = path.join(SRC, 'plugins', 'data-dictionary', 'services', 'CaseService.ts');
const RULE_SERVICE = path.join(SRC, 'plugins', 'data-dictionary', 'services', 'RuleService.ts');
const PLUGIN = path.join(SRC, 'plugins', 'data-dictionary', 'dataDictionaryPlugin.ts');
const API = path.join(SRC, 'services', 'api.ts');
const BOOTSTRAP = path.join(SRC, 'kernel', 'bootstrap.ts');
const NEW_CASES_SLICE = path.join(SRC, 'plugins', 'data-dictionary', 'slices', 'casesSlice.ts');
const OLD_CASES_SLICE = path.join(SRC, 'store', 'slices', 'casesSlice.ts');
const RULES_SLICE = path.join(SRC, 'plugins', 'data-dictionary', 'slices', 'rulesSlice.ts');

function read(file: string): string {
  return fs.readFileSync(file, 'utf8');
}

/**
 * Recursively walk a directory yielding absolute paths of every regular file.
 * Skips `node_modules` and `dist` folders.
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

describe('#161 acceptance #1 — token declarations', () => {
  it('tokens.ts declares CASE_SERVICE_TOKEN exactly once with a Symbol value', () => {
    const content = read(TOKENS);
    const matches = content.match(/export\s+const\s+CASE_SERVICE_TOKEN\s*=\s*Symbol\(/g);
    expect(matches, 'CASE_SERVICE_TOKEN must be declared exactly once').not.toBeNull();
    expect(matches!.length).toBe(1);
  });

  it('tokens.ts declares RULE_SERVICE_TOKEN exactly once with a Symbol value', () => {
    const content = read(TOKENS);
    const matches = content.match(/export\s+const\s+RULE_SERVICE_TOKEN\s*=\s*Symbol\(/g);
    expect(matches, 'RULE_SERVICE_TOKEN must be declared exactly once').not.toBeNull();
    expect(matches!.length).toBe(1);
  });
});

describe('#161 acceptance #2 — services are self-contained', () => {
  it('CaseService.ts does NOT import from services/api', () => {
    const content = read(CASE_SERVICE);
    expect(content).not.toMatch(/from\s+['"][^'"]*services\/api['"]/);
  });

  it('RuleService.ts does NOT import from services/api', () => {
    const content = read(RULE_SERVICE);
    expect(content).not.toMatch(/from\s+['"][^'"]*services\/api['"]/);
  });
});

describe('#161 acceptance #3 — DI registration in initialize with useValue', () => {
  it('dataDictionaryPlugin.ts provides CASE_SERVICE_TOKEN inside initialize() with useValue', () => {
    const content = read(PLUGIN);
    const initStart = content.indexOf('async initialize(ctx)');
    expect(initStart, 'initialize() method should exist').toBeGreaterThanOrEqual(0);
    const activateStart = content.indexOf('async activate(ctx)', initStart);
    expect(activateStart, 'activate() method should follow initialize()').toBeGreaterThan(initStart);
    const initBody = content.slice(initStart, activateStart);

    expect(initBody).toMatch(/CASE_SERVICE_TOKEN/);
    expect(initBody).toMatch(/ctx\.provide\s*\(/);
    expect(initBody).toMatch(/useValue\s*:/);

    const caseBlock = initBody.match(
      /ctx\.provide\s*\(\s*\{[^}]*CASE_SERVICE_TOKEN[^}]*\}\s*\)/,
    );
    expect(caseBlock, 'Provider block referencing CASE_SERVICE_TOKEN must be present').not.toBeNull();
    expect(caseBlock![0]).toMatch(/useValue/);
    expect(caseBlock![0]).not.toMatch(/useClass/);
    expect(caseBlock![0]).not.toMatch(/useFactory/);
  });

  it('dataDictionaryPlugin.ts provides RULE_SERVICE_TOKEN inside initialize() with useValue', () => {
    const content = read(PLUGIN);
    const initStart = content.indexOf('async initialize(ctx)');
    const activateStart = content.indexOf('async activate(ctx)', initStart);
    const initBody = content.slice(initStart, activateStart);

    expect(initBody).toMatch(/RULE_SERVICE_TOKEN/);

    const ruleBlock = initBody.match(
      /ctx\.provide\s*\(\s*\{[^}]*RULE_SERVICE_TOKEN[^}]*\}\s*\)/,
    );
    expect(ruleBlock, 'Provider block referencing RULE_SERVICE_TOKEN must be present').not.toBeNull();
    expect(ruleBlock![0]).toMatch(/useValue/);
    expect(ruleBlock![0]).not.toMatch(/useClass/);
    expect(ruleBlock![0]).not.toMatch(/useFactory/);
  });
});

describe('#161 acceptance #4 — caseApi and ruleApi gone from api.ts', () => {
  it('services/api.ts no longer exports caseApi', () => {
    const content = read(API);
    expect(content).not.toMatch(/^export\s+const\s+caseApi\b/m);
    expect(content).not.toMatch(/\bcaseApi\b/);
  });

  it('services/api.ts no longer exports ruleApi', () => {
    const content = read(API);
    expect(content).not.toMatch(/^export\s+const\s+ruleApi\b/m);
    expect(content).not.toMatch(/\bruleApi\b/);
  });
});

describe('#161 acceptance #5 — no surviving caseApi or ruleApi in frontend/src', () => {
  it('no caseApi identifier survives in frontend/src outside this guard file', () => {
    const allowedSuffixes = ['spec-grep-guards.cases-rules.test.ts'];

    const offenders: Array<{ file: string; line: number; text: string }> = [];
    for (const file of walk(SRC)) {
      if (allowedSuffixes.some((s) => file.endsWith(s))) continue;
      if (!/\.(ts|tsx|js|jsx)$/.test(file)) continue;
      const lines = read(file).split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (/\bcaseApi\b/.test(lines[i])) {
          offenders.push({ file, line: i + 1, text: lines[i] });
        }
      }
    }
    expect(
      offenders,
      `Unexpected \`caseApi\` survivors:\n${JSON.stringify(offenders, null, 2)}`,
    ).toEqual([]);
  });

  it('no ruleApi identifier survives in frontend/src outside this guard file', () => {
    const allowedSuffixes = ['spec-grep-guards.cases-rules.test.ts'];

    const offenders: Array<{ file: string; line: number; text: string }> = [];
    for (const file of walk(SRC)) {
      if (allowedSuffixes.some((s) => file.endsWith(s))) continue;
      if (!/\.(ts|tsx|js|jsx)$/.test(file)) continue;
      const lines = read(file).split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (/\bruleApi\b/.test(lines[i])) {
          offenders.push({ file, line: i + 1, text: lines[i] });
        }
      }
    }
    expect(
      offenders,
      `Unexpected \`ruleApi\` survivors:\n${JSON.stringify(offenders, null, 2)}`,
    ).toEqual([]);
  });
});

describe('#161 acceptance #6 — old plugin directories do not exist', () => {
  it('frontend/src/plugins/case/ directory does not exist', () => {
    const casePath = path.join(SRC, 'plugins', 'case');
    expect(fs.existsSync(casePath)).toBe(false);
  });

  it('frontend/src/plugins/rules/ directory does not exist', () => {
    const rulesPath = path.join(SRC, 'plugins', 'rules');
    expect(fs.existsSync(rulesPath)).toBe(false);
  });
});

describe('#161 acceptance #7 — casesSlice at new path, gone from old path', () => {
  it('casesSlice.ts exists at the new path (plugins/data-dictionary/slices/)', () => {
    expect(fs.existsSync(NEW_CASES_SLICE)).toBe(true);
  });

  it('casesSlice.ts does NOT exist at the old path (store/slices/)', () => {
    expect(fs.existsSync(OLD_CASES_SLICE)).toBe(false);
  });
});

describe('#161 acceptance #8 — rulesSlice at new path', () => {
  it('rulesSlice.ts exists at the new path (plugins/data-dictionary/slices/)', () => {
    expect(fs.existsSync(RULES_SLICE)).toBe(true);
  });

  it('rulesSlice.ts exports a default reducer', () => {
    const content = read(RULES_SLICE);
    expect(content).toMatch(/export\s+default\s+rulesSlice\.reducer|export\s+default\s+rulesReducer/);
  });
});

describe('#161 acceptance #9 — bootstrap.ts does not import case/rules plugins', () => {
  it('bootstrap.ts does NOT import createCasePlugin', () => {
    const content = read(BOOTSTRAP);
    expect(content).not.toMatch(/\bcreateCase[Pp]lugin\b/);
  });

  it('bootstrap.ts does NOT import createRulesPlugin', () => {
    const content = read(BOOTSTRAP);
    expect(content).not.toMatch(/\bcreateRules[Pp]lugin\b/);
  });
});

describe('#161 acceptance #10 — bootstrap.ts imports rulesReducer from new path', () => {
  it('bootstrap.ts imports rulesReducer from plugins/data-dictionary/slices/rulesSlice', () => {
    const content = read(BOOTSTRAP);
    expect(content).toMatch(/import\s+rulesReducer\s+from\s+['"][^'"]*plugins\/data-dictionary\/slices\/rulesSlice['"]/);
  });
});
