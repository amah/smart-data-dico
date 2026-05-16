/**
 * #163 Slice 1 — command bus content-guard regressions.
 *
 * Mirrors the established spec-grep pattern from spec-grep-guards.integrity.test.ts:
 * walk the file tree with fs.readdirSync / readFileSync (NOT shell `grep`)
 * and assert on hits.
 *
 * Coverage map (mirrors spec acceptance criteria):
 *   #1  EventMap exists in kernel/events.ts with the six expected keys.
 *   #2  CommandMap exists in kernel/commands.ts with exactly 19 keys.
 *   #3  useCommand hook exists in kernel/useCommand.ts.
 *   #4  CommandsDebugPage exists in pages/CommandsDebugPage.tsx.
 *   #5  dataDictionaryPlugin.ts registers 18 data-dictionary.* commands.
 *   #6  searchPlugin.ts registers search.search.
 *   #7  Dead refresh commands are deleted from all plugin files.
 *   #8  event-channel and ui-navigation removed from package.json.
 *   #9  StereotypesPage uses commands.run for the four CRUD methods.
 *   #10 IntegrityPage uses commands.run for integrity.getReport.
 *   #11 HomePage uses commands.run for integrity and quality.
 *   #12 LogicalDiffPage uses commands.run for diff.getLogical.
 *   #13 PhysicalDiffPage uses commands.run for three diff commands.
 *   #14 ImportExportPage uses commands.run for four methods.
 *   #15 QualityDashboardPage uses commands.run for quality.getReport.
 *   #16 SearchComponent and searchSlice use commands.run for search.search.
 *   #17 SchemaImportWizard uses commands.run for four methods.
 *   #21 Spec-grep guard for typed-API drift (no commands.execute in src).
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

const EVENTS_TS = path.join(SRC, 'kernel', 'events.ts');
const COMMANDS_TS = path.join(SRC, 'kernel', 'commands.ts');
const USE_COMMAND_TS = path.join(SRC, 'kernel', 'useCommand.ts');
const COMMANDS_DEBUG_PAGE = path.join(SRC, 'pages', 'CommandsDebugPage.tsx');
const DATA_DICTIONARY_PLUGIN = path.join(SRC, 'plugins', 'data-dictionary', 'dataDictionaryPlugin.ts');
const SEARCH_PLUGIN = path.join(SRC, 'plugins', 'search', 'searchPlugin.ts');
const CASE_PLUGIN = path.join(SRC, 'plugins', 'case', 'casePlugin.ts');
const RULES_PLUGIN = path.join(SRC, 'plugins', 'rules', 'rulesPlugin.ts');
const STEREOTYPES_PAGE = path.join(SRC, 'pages', 'StereotypesPage.tsx');
const INTEGRITY_PAGE = path.join(SRC, 'pages', 'IntegrityPage.tsx');
const HOME_PAGE = path.join(SRC, 'pages', 'HomePage.tsx');
const LOGICAL_DIFF_PAGE = path.join(SRC, 'pages', 'LogicalDiffPage.tsx');
const PHYSICAL_DIFF_PAGE = path.join(SRC, 'pages', 'PhysicalDiffPage.tsx');
const IMPORT_EXPORT_PAGE = path.join(SRC, 'pages', 'ImportExportPage.tsx');
const QUALITY_DASHBOARD_PAGE = path.join(SRC, 'pages', 'QualityDashboardPage.tsx');
const SEARCH_COMPONENT = path.join(SRC, 'components', 'SearchComponent.tsx');
const SCHEMA_IMPORT_WIZARD = path.join(SRC, 'components', 'SchemaImportWizard.tsx');
const SEARCH_SLICE = path.join(SRC, 'store', 'slices', 'searchSlice.ts');
const PACKAGE_JSON = path.join(FRONTEND, 'package.json');

function read(file: string): string {
  return fs.readFileSync(file, 'utf8');
}

/**
 * Recursively walk a directory yielding absolute paths of every regular
 * file. Skips `node_modules` and `dist` folders.
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

// ── Acceptance #1 — EventMap ──────────────────────────────────────────────

describe('#163 acceptance #1 — typed EventMap exists', () => {
  it('kernel/events.ts exists and exports EventMap interface', () => {
    const content = read(EVENTS_TS);
    expect(content).toMatch(/export interface EventMap\b/);
  });

  const expectedKeys = [
    'stereotype.changed',
    'import-export.committed',
    'quality.report.refreshed',
    'shell:theme-changed',
    'auth:session-restored',
    'store-fs:ready',
  ];

  for (const key of expectedKeys) {
    it(`EventMap contains key '${key}'`, () => {
      const content = read(EVENTS_TS);
      // Match `'key':` or `"key":` anywhere in the file
      const regex = new RegExp(`['"]${key.replace('.', '\\.').replace(':', ':')}['"]\\s*:`);
      expect(content).toMatch(regex);
    });
  }

  it('EventMap does NOT contain aspirational entity.created key', () => {
    const content = read(EVENTS_TS);
    expect(content).not.toMatch(/['"]entity\.created['"]\s*:/);
  });
});

// ── Acceptance #2 — CommandMap with exactly 19 keys ───────────────────────

describe('#163 acceptance #2 — typed CommandMap exists with 30 entries', () => {
  it('kernel/commands.ts exists and exports CommandMap interface', () => {
    const content = read(COMMANDS_TS);
    expect(content).toMatch(/export interface CommandMap\b/);
  });

  it('CommandMap has exactly 43 command keys (19 pre-#160 + 11 #160 git/publish + 13 #161 case/rule)', () => {
    const content = read(COMMANDS_TS);
    // Count quoted keys ending in `: {` pattern (command entries in interface)
    const matches = content.match(/^\s*['"][a-z][^'"]+['"]\s*:/gm) ?? [];
    expect(matches.length).toBe(43);
  });

  const commandNames = [
    'data-dictionary.stereotype.loadAll',
    'data-dictionary.stereotype.create',
    'data-dictionary.stereotype.update',
    'data-dictionary.stereotype.delete',
    'data-dictionary.integrity.getReport',
    'data-dictionary.diff.getLogical',
    'data-dictionary.diff.getPhysicalConfig',
    'data-dictionary.diff.getPhysicalForService',
    'data-dictionary.diff.getPhysicalAll',
    'data-dictionary.import-export.importJsonSchema',
    'data-dictionary.import-export.importSqlDdl',
    'data-dictionary.import-export.previewSqlDdl',
    'data-dictionary.import-export.previewDbSchema',
    'data-dictionary.import-export.diffSqlDdl',
    'data-dictionary.import-export.commitSqlDdl',
    'data-dictionary.import-export.exportJsonSchema',
    'data-dictionary.import-export.exportMarkdown',
    'data-dictionary.quality.getReport',
    'search.search',
    'data-dictionary.git.getStatus',
    'data-dictionary.git.listBranches',
    'data-dictionary.git.checkout',
    'data-dictionary.git.log',
    'data-dictionary.git.diff',
    'data-dictionary.git.pull',
    'data-dictionary.git.push',
    'data-dictionary.publish.save',
    'data-dictionary.publish.publish',
    'data-dictionary.publish.sync',
    'data-dictionary.publish.revert',
  ];

  for (const name of commandNames) {
    it(`CommandMap contains '${name}'`, () => {
      const content = read(COMMANDS_TS);
      expect(content).toContain(`'${name}'`);
    });
  }
});

// ── Acceptance #3 — useCommand hook ──────────────────────────────────────

describe('#163 acceptance #3 — useCommand hook exists', () => {
  it('kernel/useCommand.ts exists and exports useCommand', () => {
    const content = read(USE_COMMAND_TS);
    expect(content).toMatch(/export function useCommand\b/);
  });
});

// ── Acceptance #4 — CommandsDebugPage ────────────────────────────────────

describe('#163 acceptance #4 — CommandsDebugPage exists', () => {
  it('pages/CommandsDebugPage.tsx exists and exports CommandsDebugPage', () => {
    const content = read(COMMANDS_DEBUG_PAGE);
    expect(content).toMatch(/export function CommandsDebugPage\b/);
  });
});

// ── Acceptance #5 — data-dictionary plugin registers 18 commands ──────────

describe('#163 acceptance #5 — data-dictionary plugin registers 29 data-dictionary.* commands', () => {
  it('dataDictionaryPlugin.ts has >= 29 ctx.commands.register calls for data-dictionary.*', () => {
    const content = read(DATA_DICTIONARY_PLUGIN);
    const matches = content.match(/ctx\.commands\.register\s*\(\s*['"]data-dictionary\./g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(29);
  });

  const ddCommands = [
    'data-dictionary.stereotype.loadAll',
    'data-dictionary.stereotype.create',
    'data-dictionary.stereotype.update',
    'data-dictionary.stereotype.delete',
    'data-dictionary.integrity.getReport',
    'data-dictionary.diff.getLogical',
    'data-dictionary.diff.getPhysicalConfig',
    'data-dictionary.diff.getPhysicalForService',
    'data-dictionary.diff.getPhysicalAll',
    'data-dictionary.import-export.importJsonSchema',
    'data-dictionary.import-export.importSqlDdl',
    'data-dictionary.import-export.previewSqlDdl',
    'data-dictionary.import-export.previewDbSchema',
    'data-dictionary.import-export.diffSqlDdl',
    'data-dictionary.import-export.commitSqlDdl',
    'data-dictionary.import-export.exportJsonSchema',
    'data-dictionary.import-export.exportMarkdown',
    'data-dictionary.quality.getReport',
    'data-dictionary.git.getStatus',
    'data-dictionary.git.listBranches',
    'data-dictionary.git.checkout',
    'data-dictionary.git.log',
    'data-dictionary.git.diff',
    'data-dictionary.git.pull',
    'data-dictionary.git.push',
    'data-dictionary.publish.save',
    'data-dictionary.publish.publish',
    'data-dictionary.publish.sync',
    'data-dictionary.publish.revert',
  ];

  for (const name of ddCommands) {
    it(`dataDictionaryPlugin.ts registers '${name}'`, () => {
      const content = read(DATA_DICTIONARY_PLUGIN);
      expect(content).toContain(`'${name}'`);
    });
  }
});

// ── Acceptance #6 — search plugin registers search.search ────────────────

describe('#163 acceptance #6 — search plugin registers search.search', () => {
  it('searchPlugin.ts has ctx.commands.register for search.search', () => {
    const content = read(SEARCH_PLUGIN);
    expect(content).toMatch(/ctx\.commands\.register\s*\(\s*['"]search\.search['"]/);
  });
});

// ── Acceptance #7 — dead refresh commands deleted ─────────────────────────

describe('#163 acceptance #7 — dead refresh commands deleted', () => {
  // dataDictionaryPlugin and versionControlPlugin still exist; test
  // that they don't contain stale command names.
  const pluginDeadCommands = [
    { file: DATA_DICTIONARY_PLUGIN, label: 'dataDictionaryPlugin', command: 'data-dictionary.refresh' },
    { file: DATA_DICTIONARY_PLUGIN, label: 'dataDictionaryPlugin', command: 'data-dictionary:refresh-requested' },
    // casePlugin, rulesPlugin (deleted #161) and versionControlPlugin (deleted #160)
    // are checked via fs.existsSync below.
  ];

  for (const { file, label, command } of pluginDeadCommands) {
    it(`${label} does NOT contain '${command}'`, () => {
      const content = read(file);
      expect(content).not.toContain(`'${command}'`);
    });
  }

  // #161: casePlugin and rulesPlugin are deleted entirely — verify files are absent.
  it('casePlugin does NOT contain \'case.refresh\' (file deleted by #161)', () => {
    expect(fs.existsSync(CASE_PLUGIN)).toBe(false);
  });

  it('casePlugin does NOT contain \'case:refresh-requested\' (file deleted by #161)', () => {
    expect(fs.existsSync(CASE_PLUGIN)).toBe(false);
  });

  it('rulesPlugin does NOT contain \'rules.refresh\' (file deleted by #161)', () => {
    expect(fs.existsSync(RULES_PLUGIN)).toBe(false);
  });

  it('rulesPlugin does NOT contain \'rules:refresh-requested\' (file deleted by #161)', () => {
    expect(fs.existsSync(RULES_PLUGIN)).toBe(false);
  });
});

// ── Acceptance #8 — event-channel and ui-navigation removed ───────────────

describe('#163 acceptance #8 — event-channel and ui-navigation removed from package.json', () => {
  it('package.json does not have @hamak/event-channel in dependencies', () => {
    const pkg = JSON.parse(read(PACKAGE_JSON));
    expect(pkg.dependencies?.['@hamak/event-channel']).toBeUndefined();
    expect(pkg.devDependencies?.['@hamak/event-channel']).toBeUndefined();
  });

  it('package.json does not have @hamak/ui-navigation in dependencies', () => {
    const pkg = JSON.parse(read(PACKAGE_JSON));
    expect(pkg.dependencies?.['@hamak/ui-navigation']).toBeUndefined();
    expect(pkg.devDependencies?.['@hamak/ui-navigation']).toBeUndefined();
  });

  it('no frontend/src file imports from @hamak/event-channel or @hamak/ui-navigation', () => {
    // This guard file mentions these strings in prose — exclude it from the scan.
    const allowedSuffixes = ['spec-grep-guards.commands.test.ts'];

    const offenders: Array<{ file: string; line: number; text: string }> = [];
    for (const file of walk(SRC)) {
      if (allowedSuffixes.some((s) => file.endsWith(s))) continue;
      if (!/\.(ts|tsx|js|jsx)$/.test(file)) continue;
      const lines = read(file).split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (/@hamak\/(event-channel|ui-navigation)/.test(lines[i])) {
          offenders.push({ file, line: i + 1, text: lines[i] });
        }
      }
    }
    expect(
      offenders,
      `Unexpected @hamak/event-channel or @hamak/ui-navigation imports:\n${JSON.stringify(offenders, null, 2)}`,
    ).toEqual([]);
  });
});

// ── Acceptance #9 — StereotypesPage call-site migration ───────────────────
// Note: components use `const run = useCommand(); run('cmd.name', ...)` pattern,
// so we check for the command name string presence (the run call), not `commands.run`.

describe('#163 acceptance #9 — StereotypesPage uses commands.run for CRUD', () => {
  it('StereotypesPage.tsx references data-dictionary.stereotype.create', () => {
    const content = read(STEREOTYPES_PAGE);
    expect(content).toMatch(/['"]data-dictionary\.stereotype\.create['"]/);
  });

  it('StereotypesPage.tsx references data-dictionary.stereotype.update', () => {
    const content = read(STEREOTYPES_PAGE);
    expect(content).toMatch(/['"]data-dictionary\.stereotype\.update['"]/);
  });

  it('StereotypesPage.tsx references data-dictionary.stereotype.delete', () => {
    const content = read(STEREOTYPES_PAGE);
    expect(content).toMatch(/['"]data-dictionary\.stereotype\.delete['"]/);
  });

  it('StereotypesPage.tsx references data-dictionary.stereotype.loadAll', () => {
    const content = read(STEREOTYPES_PAGE);
    expect(content).toMatch(/['"]data-dictionary\.stereotype\.loadAll['"]/);
  });

  it('StereotypesPage.tsx still uses service.useFile() (hook-shaped call stays)', () => {
    const content = read(STEREOTYPES_PAGE);
    expect(content).toMatch(/service\.useFile\s*\(/);
  });

  it('StereotypesPage.tsx still resolves the service via useService (for hook calls)', () => {
    const content = read(STEREOTYPES_PAGE);
    expect(content).toMatch(/const service\s*=/);
  });
});

// ── Acceptance #10 — IntegrityPage ────────────────────────────────────────

describe('#163 acceptance #10 — IntegrityPage uses command bus for integrity.getReport', () => {
  it('IntegrityPage.tsx references data-dictionary.integrity.getReport', () => {
    const content = read(INTEGRITY_PAGE);
    expect(content).toMatch(/['"]data-dictionary\.integrity\.getReport['"]/);
  });

  it('IntegrityPage.tsx imports useCommand', () => {
    const content = read(INTEGRITY_PAGE);
    expect(content).toMatch(/from\s+['"]\.\.\/kernel\/useCommand['"]/);
  });

  it('IntegrityPage.tsx does not call integrity.getReport() directly', () => {
    const content = read(INTEGRITY_PAGE);
    expect(content).not.toMatch(/integrity\.getReport\s*\(/);
  });
});

// ── Acceptance #11 — HomePage ─────────────────────────────────────────────

describe('#163 acceptance #11 — HomePage uses command bus for integrity and quality', () => {
  it('HomePage.tsx references data-dictionary.integrity.getReport', () => {
    const content = read(HOME_PAGE);
    expect(content).toMatch(/['"]data-dictionary\.integrity\.getReport['"]/);
  });

  it('HomePage.tsx references data-dictionary.quality.getReport', () => {
    const content = read(HOME_PAGE);
    expect(content).toMatch(/['"]data-dictionary\.quality\.getReport['"]/);
  });

  it('HomePage.tsx does not call integrity.getReport() directly', () => {
    const content = read(HOME_PAGE);
    expect(content).not.toMatch(/integrity\.getReport\s*\(/);
  });

  it('HomePage.tsx does not call importExport.getQualityReport() directly', () => {
    const content = read(HOME_PAGE);
    // This pattern was used before #163; it should be gone
    expect(content).not.toMatch(/importExport\.getQualityReport\s*\(/);
  });
});

// ── Acceptance #12 — LogicalDiffPage ─────────────────────────────────────

describe('#163 acceptance #12 — LogicalDiffPage uses command bus for diff.getLogical', () => {
  it('LogicalDiffPage.tsx references data-dictionary.diff.getLogical', () => {
    const content = read(LOGICAL_DIFF_PAGE);
    expect(content).toMatch(/['"]data-dictionary\.diff\.getLogical['"]/);
  });

  it('LogicalDiffPage.tsx imports useCommand', () => {
    const content = read(LOGICAL_DIFF_PAGE);
    expect(content).toMatch(/from\s+['"]\.\.\/kernel\/useCommand['"]/);
  });

  it('LogicalDiffPage.tsx does not call diffSvc.getLogical() directly', () => {
    const content = read(LOGICAL_DIFF_PAGE);
    expect(content).not.toMatch(/diffSvc\.getLogical\s*\(/);
  });
});

// ── Acceptance #13 — PhysicalDiffPage ────────────────────────────────────

describe('#163 acceptance #13 — PhysicalDiffPage uses commands.run for three diff commands', () => {
  it('PhysicalDiffPage.tsx calls commands.run for getPhysicalConfig', () => {
    const content = read(PHYSICAL_DIFF_PAGE);
    expect(content).toMatch(/['"]data-dictionary\.diff\.getPhysicalConfig['"]/);
  });

  it('PhysicalDiffPage.tsx calls commands.run for getPhysicalAll', () => {
    const content = read(PHYSICAL_DIFF_PAGE);
    expect(content).toMatch(/['"]data-dictionary\.diff\.getPhysicalAll['"]/);
  });

  it('PhysicalDiffPage.tsx calls commands.run for getPhysicalForService', () => {
    const content = read(PHYSICAL_DIFF_PAGE);
    expect(content).toMatch(/['"]data-dictionary\.diff\.getPhysicalForService['"]/);
  });
});

// ── Acceptance #14 — ImportExportPage ────────────────────────────────────

describe('#163 acceptance #14 — ImportExportPage uses commands.run for four methods', () => {
  it('ImportExportPage.tsx calls commands.run for importJsonSchema', () => {
    const content = read(IMPORT_EXPORT_PAGE);
    expect(content).toMatch(/['"]data-dictionary\.import-export\.importJsonSchema['"]/);
  });

  it('ImportExportPage.tsx calls commands.run for importSqlDdl', () => {
    const content = read(IMPORT_EXPORT_PAGE);
    expect(content).toMatch(/['"]data-dictionary\.import-export\.importSqlDdl['"]/);
  });

  it('ImportExportPage.tsx calls commands.run for exportJsonSchema', () => {
    const content = read(IMPORT_EXPORT_PAGE);
    expect(content).toMatch(/['"]data-dictionary\.import-export\.exportJsonSchema['"]/);
  });

  it('ImportExportPage.tsx calls commands.run for exportMarkdown', () => {
    const content = read(IMPORT_EXPORT_PAGE);
    expect(content).toMatch(/['"]data-dictionary\.import-export\.exportMarkdown['"]/);
  });
});

// ── Acceptance #15 — QualityDashboardPage ────────────────────────────────

describe('#163 acceptance #15 — QualityDashboardPage uses commands.run for quality.getReport', () => {
  it('QualityDashboardPage.tsx calls commands.run for data-dictionary.quality.getReport', () => {
    const content = read(QUALITY_DASHBOARD_PAGE);
    expect(content).toMatch(/['"]data-dictionary\.quality\.getReport['"]/);
  });

  it('QualityDashboardPage.tsx does not call importExport.getQualityReport() directly', () => {
    const content = read(QUALITY_DASHBOARD_PAGE);
    expect(content).not.toMatch(/importExport\.getQualityReport\s*\(/);
  });
});

// ── Acceptance #16 — SearchComponent and searchSlice (#154 rewrite) ──────

describe('#163 acceptance #16 — Search call sites migrated to commands.run', () => {
  it('SearchComponent.tsx calls commands.run for search.search', () => {
    const content = read(SEARCH_COMPONENT);
    expect(content).toMatch(/['"]search\.search['"]/);
  });

  it('SearchComponent.tsx does not call search.searchEntities() directly', () => {
    const content = read(SEARCH_COMPONENT);
    expect(content).not.toMatch(/search\.searchEntities\s*\(/);
  });

  // #154 rewrite: searchSlice.ts was deleted; the guard now asserts its absence.
  it('searchSlice.ts does not exist (deleted per #154 reframe)', () => {
    expect(
      fs.existsSync(SEARCH_SLICE),
      'searchSlice.ts should not exist after #154 — replaced by dynamic Store FS files',
    ).toBe(false);
  });
});

// ── Acceptance #17 — SchemaImportWizard ──────────────────────────────────

describe('#163 acceptance #17 — SchemaImportWizard uses commands.run for four methods', () => {
  it('SchemaImportWizard.tsx calls commands.run for previewSqlDdl', () => {
    const content = read(SCHEMA_IMPORT_WIZARD);
    expect(content).toMatch(/['"]data-dictionary\.import-export\.previewSqlDdl['"]/);
  });

  it('SchemaImportWizard.tsx calls commands.run for previewDbSchema', () => {
    const content = read(SCHEMA_IMPORT_WIZARD);
    expect(content).toMatch(/['"]data-dictionary\.import-export\.previewDbSchema['"]/);
  });

  it('SchemaImportWizard.tsx calls commands.run for diffSqlDdl', () => {
    const content = read(SCHEMA_IMPORT_WIZARD);
    expect(content).toMatch(/['"]data-dictionary\.import-export\.diffSqlDdl['"]/);
  });

  it('SchemaImportWizard.tsx calls commands.run for commitSqlDdl', () => {
    const content = read(SCHEMA_IMPORT_WIZARD);
    expect(content).toMatch(/['"]data-dictionary\.import-export\.commitSqlDdl['"]/);
  });
});

// ── Acceptance #21 — Typed-API drift guard ───────────────────────────────

describe('#163 acceptance #21 — no commands.execute calls in frontend/src', () => {
  it('zero call-sites of commands.execute in frontend/src (framework method is run, not execute)', () => {
    // This guard file mentions `commands.execute` in prose — exclude it.
    const allowedSuffixes = ['spec-grep-guards.commands.test.ts'];

    const offenders: Array<{ file: string; line: number; text: string }> = [];
    for (const file of walk(SRC)) {
      if (allowedSuffixes.some((s) => file.endsWith(s))) continue;
      if (!/\.(ts|tsx|js|jsx)$/.test(file)) continue;
      const lines = read(file).split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (/commands\.execute\s*\(/.test(lines[i])) {
          offenders.push({ file, line: i + 1, text: lines[i] });
        }
      }
    }
    expect(
      offenders,
      `Unexpected commands.execute( calls (use commands.run instead):\n${JSON.stringify(offenders, null, 2)}`,
    ).toEqual([]);
  });

  it('dataDictionaryPlugin.ts has 42 ctx.commands.register calls (18 pre-#160 + 11 #160 git/publish + 13 #161 case/rule)', () => {
    const content = read(DATA_DICTIONARY_PLUGIN);
    const matches = content.match(/ctx\.commands\.register\s*\(/g) ?? [];
    expect(matches.length).toBe(42);
  });

  it('searchPlugin.ts has 1 ctx.commands.register call (per-plugin total)', () => {
    const content = read(SEARCH_PLUGIN);
    const matches = content.match(/ctx\.commands\.register\s*\(/g) ?? [];
    expect(matches.length).toBe(1);
  });
});
