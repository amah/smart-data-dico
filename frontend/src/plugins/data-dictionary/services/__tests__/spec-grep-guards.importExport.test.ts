/**
 * #155-import-export — content-guard regressions.
 *
 * Mirrors spec-grep-guards.integrity.test.ts and
 * spec-grep-guards.diff.test.ts: walk the file tree with
 * fs.readdirSync / readFileSync (NOT shell `grep`) and assert on hits.
 * The walker includes `__tests__` directories but this file is excluded
 * by suffix from the global scan that checks for `importExportApi`
 * survivors — so the literal `importExportApi` strings in this file do
 * not falsely trip the guard against itself.
 *
 * Coverage map (mirrors spec acceptance criteria):
 *   #1  IMPORT_EXPORT_SERVICE_TOKEN declared exactly once in tokens.ts
 *       with a Symbol value.
 *   #2  ImportExportService.ts does NOT import from `services/api`.
 *   #3  dataDictionaryPlugin.ts provides IMPORT_EXPORT_SERVICE_TOKEN
 *       inside initialize() body with useValue (not useClass / useFactory).
 *   #4a ImportExportPage.tsx imports useService and calls
 *       useService<...>(IMPORT_EXPORT_SERVICE_TOKEN); contains no importExportApi.
 *   #4b QualityDashboardPage.tsx imports useService and calls
 *       useService<...>(IMPORT_EXPORT_SERVICE_TOKEN); contains no importExportApi.
 *   #4c HomePage.tsx imports useService and calls
 *       useService<...>(IMPORT_EXPORT_SERVICE_TOKEN); contains no importExportApi.
 *   #4d SchemaImportWizard.tsx imports useService and calls
 *       useService<...>(IMPORT_EXPORT_SERVICE_TOKEN); contains no importExportApi.
 *   #5  services/api.ts no longer exports importExportApi.
 *   #6  Repo-wide (frontend/src/**): no `importExportApi` identifier
 *       survives outside this guard file (and the SchemaImportWizard test
 *       allowlist — see below).
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
const IMPORT_EXPORT_SERVICE_FILE = path.join(
  SRC,
  'plugins',
  'data-dictionary',
  'services',
  'ImportExportService.ts',
);
const PLUGIN = path.join(
  SRC,
  'plugins',
  'data-dictionary',
  'dataDictionaryPlugin.ts',
);
const IMPORT_EXPORT_PAGE = path.join(SRC, 'pages', 'ImportExportPage.tsx');
const QUALITY_DASHBOARD_PAGE = path.join(SRC, 'pages', 'QualityDashboardPage.tsx');
const HOME_PAGE = path.join(SRC, 'pages', 'HomePage.tsx');
const SCHEMA_IMPORT_WIZARD = path.join(SRC, 'components', 'SchemaImportWizard.tsx');
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

// ── Acceptance #1 — token declaration ─────────────────────────────────────

describe('#155-import-export acceptance #1 — IMPORT_EXPORT_SERVICE_TOKEN declared exactly once', () => {
  it('tokens.ts declares IMPORT_EXPORT_SERVICE_TOKEN exactly once with a Symbol value', () => {
    const content = read(TOKENS);
    const matches = content.match(
      /export\s+const\s+IMPORT_EXPORT_SERVICE_TOKEN\s*=\s*Symbol\(/g,
    );
    expect(matches, 'IMPORT_EXPORT_SERVICE_TOKEN must be declared exactly once').not.toBeNull();
    expect(matches!.length).toBe(1);
  });
});

// ── Acceptance #2 — service self-containment ───────────────────────────────

describe('#155-import-export acceptance #2 — ImportExportService is self-contained', () => {
  it('ImportExportService.ts does NOT import from services/api', () => {
    const content = read(IMPORT_EXPORT_SERVICE_FILE);
    expect(content).not.toMatch(/from\s+['"][^'"]*services\/api['"]/);
  });
});

// ── Acceptance #3 — DI registration in initialize ─────────────────────────

describe('#155-import-export acceptance #3 — DI registration in initialize with useValue', () => {
  it('dataDictionaryPlugin.ts provides IMPORT_EXPORT_SERVICE_TOKEN inside initialize() with useValue', () => {
    const content = read(PLUGIN);

    const initStart = content.indexOf('async initialize(ctx)');
    expect(initStart, 'initialize() method should exist').toBeGreaterThanOrEqual(0);
    const activateStart = content.indexOf('async activate(ctx)', initStart);
    expect(activateStart, 'activate() method should follow initialize()').toBeGreaterThan(initStart);
    const initBody = content.slice(initStart, activateStart);

    // Provider call shape: ctx.provide({ provide: IMPORT_EXPORT_SERVICE_TOKEN, useValue: ... })
    expect(initBody).toMatch(/IMPORT_EXPORT_SERVICE_TOKEN/);
    expect(initBody).toMatch(/ctx\.provide\s*\(/);
    expect(initBody).toMatch(/useValue\s*:/);

    // The provider block must reference IMPORT_EXPORT_SERVICE_TOKEN and use useValue
    const providerBlock = initBody.match(
      /ctx\.provide\s*\(\s*\{[^}]*IMPORT_EXPORT_SERVICE_TOKEN[^}]*\}\s*\)/,
    );
    expect(
      providerBlock,
      'Provider block referencing IMPORT_EXPORT_SERVICE_TOKEN must be present',
    ).not.toBeNull();
    expect(providerBlock![0]).toMatch(/useValue/);
    expect(providerBlock![0]).not.toMatch(/useClass/);
    expect(providerBlock![0]).not.toMatch(/useFactory/);
  });
});

// ── Acceptance #4a — ImportExportPage migrated ────────────────────────────

// #163: ImportExportPage migrated from useService(IMPORT_EXPORT_SERVICE_TOKEN)
// to commands.run('data-dictionary.import-export.*', ...) via useCommand().
describe('#155-import-export acceptance #4a — ImportExportPage consumes via command bus (#163)', () => {
  it('ImportExportPage.tsx imports useCommand and calls commands.run for import-export commands', () => {
    const content = read(IMPORT_EXPORT_PAGE);
    expect(content).toMatch(/from\s+['"]\.\.\/kernel\/useCommand['"]/);
    expect(content).toMatch(/['"]data-dictionary\.import-export\.importJsonSchema['"]/);
  });

  it('ImportExportPage.tsx contains no `importExportApi` references', () => {
    const content = read(IMPORT_EXPORT_PAGE);
    expect(content).not.toMatch(/\bimportExportApi\b/);
  });
});

// ── Acceptance #4b — QualityDashboardPage migrated ────────────────────────

// #163: QualityDashboardPage migrated to commands.run('data-dictionary.quality.getReport').
describe('#155-import-export acceptance #4b — QualityDashboardPage consumes via command bus (#163)', () => {
  it('QualityDashboardPage.tsx imports useCommand and calls commands.run for quality.getReport', () => {
    const content = read(QUALITY_DASHBOARD_PAGE);
    expect(content).toMatch(/from\s+['"]\.\.\/kernel\/useCommand['"]/);
    expect(content).toMatch(/['"]data-dictionary\.quality\.getReport['"]/);
  });

  it('QualityDashboardPage.tsx contains no `importExportApi` references', () => {
    const content = read(QUALITY_DASHBOARD_PAGE);
    expect(content).not.toMatch(/\bimportExportApi\b/);
  });
});

// ── Acceptance #4c — HomePage migrated ────────────────────────────────────

// #163: HomePage migrated to commands.run for both quality.getReport and
// integrity.getReport. IMPORT_EXPORT_SERVICE_TOKEN and INTEGRITY_SERVICE_TOKEN
// no longer imported directly.
describe('#155-import-export acceptance #4c — HomePage consumes via command bus (#163)', () => {
  it('HomePage.tsx imports useCommand and calls commands.run for quality and integrity', () => {
    const content = read(HOME_PAGE);
    expect(content).toMatch(/from\s+['"]\.\.\/kernel\/useCommand['"]/);
    expect(content).toMatch(/['"]data-dictionary\.quality\.getReport['"]/);
    expect(content).toMatch(/['"]data-dictionary\.integrity\.getReport['"]/);
  });

  it('HomePage.tsx contains no `importExportApi` references (including prose comments)', () => {
    const content = read(HOME_PAGE);
    expect(content).not.toMatch(/\bimportExportApi\b/);
  });
});

// ── Acceptance #4d — SchemaImportWizard.tsx migrated ─────────────────────

// #163: SchemaImportWizard migrated to commands.run for all four calls.
describe('#155-import-export acceptance #4d — SchemaImportWizard.tsx consumes via command bus (#163)', () => {
  it('SchemaImportWizard.tsx imports useCommand and calls commands.run for import-export commands', () => {
    const content = read(SCHEMA_IMPORT_WIZARD);
    expect(content).toMatch(/from\s+['"]\.\.\/kernel\/useCommand['"]/);
    expect(content).toMatch(/['"]data-dictionary\.import-export\.previewSqlDdl['"]/);
  });

  it('SchemaImportWizard.tsx contains no `importExportApi` references', () => {
    const content = read(SCHEMA_IMPORT_WIZARD);
    expect(content).not.toMatch(/\bimportExportApi\b/);
  });
});

// ── Acceptance #5 — importExportApi gone from api.ts ──────────────────────

describe('#155-import-export acceptance #5 — importExportApi gone from api.ts', () => {
  it('services/api.ts does not export importExportApi', () => {
    const content = read(API);
    expect(content).not.toMatch(/^export\s+const\s+importExportApi\b/m);
  });

  it('services/api.ts contains no `importExportApi` identifier at all', () => {
    const content = read(API);
    expect(content).not.toMatch(/\bimportExportApi\b/);
  });
});

// ── Acceptance #6 — no surviving consumer in frontend/src ─────────────────

describe('#155-import-export acceptance #6 — no importExportApi survivors in frontend/src', () => {
  it('repo-wide walk of frontend/src returns no `importExportApi` identifier outside this guard file', () => {
    // Files allowed to mention the identifier in prose:
    //   - This guard file (matched by suffix).
    // The SchemaImportWizard.test.tsx was fully rewritten — it must contain
    // no reference to importExportApi either.
    const allowedSuffixes = ['spec-grep-guards.importExport.test.ts'];

    const offenders: Array<{ file: string; line: number; text: string }> = [];
    for (const file of walk(SRC)) {
      if (allowedSuffixes.some((s) => file.endsWith(s))) continue;
      if (!/\.(ts|tsx|js|jsx)$/.test(file)) continue;
      const lines = read(file).split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (/\bimportExportApi\b/.test(lines[i])) {
          offenders.push({ file, line: i + 1, text: lines[i] });
        }
      }
    }
    expect(
      offenders,
      `Unexpected \`importExportApi\` survivors:\n${JSON.stringify(offenders, null, 2)}`,
    ).toEqual([]);
  });
});

// ── Bootstrap contract ─────────────────────────────────────────────────────

describe('#155-import-export — bootstrap contract', () => {
  it('bootstrap.ts still exports bootstrapApplication and host (signature contract for tests)', () => {
    const bootstrapFile = path.join(SRC, 'kernel', 'bootstrap.ts');
    const content = read(bootstrapFile);
    expect(content).toMatch(/export\s+async\s+function\s+bootstrapApplication\s*\(/);
    expect(content).toMatch(/export\s+const\s+host\s*=/);
  });

  it('tokens.ts also exports INTEGRITY_SERVICE_TOKEN (sibling integrity guard still valid)', () => {
    const content = read(TOKENS);
    const matches = content.match(
      /export\s+const\s+INTEGRITY_SERVICE_TOKEN\s*=\s*Symbol\(/g,
    );
    expect(matches).not.toBeNull();
    expect(matches!.length).toBe(1);
  });

  it('tokens.ts also exports DIFF_SERVICE_TOKEN (sibling diff guard still valid)', () => {
    const content = read(TOKENS);
    const matches = content.match(
      /export\s+const\s+DIFF_SERVICE_TOKEN\s*=\s*Symbol\(/g,
    );
    expect(matches).not.toBeNull();
    expect(matches!.length).toBe(1);
  });
});

// ── exportMarkdown responseType guard ─────────────────────────────────────

describe('#155-import-export acceptance #10 — exportMarkdown preserves responseType: "text"', () => {
  it('ImportExportService.ts has a responseType: "text" call inside exportMarkdown', () => {
    const content = read(IMPORT_EXPORT_SERVICE_FILE);
    expect(content).toMatch(/responseType\s*:\s*['"]text['"]/);
  });
});
