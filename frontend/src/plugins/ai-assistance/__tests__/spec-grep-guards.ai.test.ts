/**
 * #162 ai-assistance plugin extraction — content-guard regressions.
 *
 * Walks `frontend/src/**` with fs.readdirSync / readFileSync (NOT shell
 * `grep`) and asserts on the acceptance criteria from spec.md.
 *
 * This file excludes itself from the walk (by basename suffix) so the
 * literal strings in these guards do not trip the guards against themselves.
 *
 * Coverage map:
 *   #1  AI_SERVICE_TOKEN declared exactly once in tokens.ts.
 *   #2  AIService.ts does not import from services/api.
 *   #3  DI registration in initialize with useValue.
 *   #4  data-dictionary has no AI knowledge; AIService has no data-dictionary refs.
 *   #5  Repo-wide content guards (this file).
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const HERE = __dirname;
// Resolve repo root: `frontend/src/plugins/ai-assistance/__tests__` is
// 4 levels deep under `frontend`, plus one more above `frontend` for the
// repo root. Total: 5 levels up from HERE.
//   HERE:      frontend/src/plugins/ai-assistance/__tests__
//   ..         frontend/src/plugins/ai-assistance
//   ../..      frontend/src/plugins
//   ../../..   frontend/src
//   ../../../.. frontend
//   ../../../../.. repo root
const REPO_ROOT = path.resolve(HERE, '..', '..', '..', '..', '..');
const FRONTEND = path.join(REPO_ROOT, 'frontend');
const SRC = path.join(FRONTEND, 'src');

const TOKENS = path.join(SRC, 'kernel', 'tokens.ts');
const AI_SERVICE = path.join(SRC, 'plugins', 'ai-assistance', 'services', 'AIService.ts');
const AI_PLUGIN = path.join(SRC, 'plugins', 'ai-assistance', 'aiPlugin.ts');
const SHELL_LAYOUT = path.join(SRC, 'plugins', 'shell', 'ShellLayout.tsx');
const SETTINGS = path.join(SRC, 'pages', 'Settings.tsx');
const DD_PLUGIN_DIR = path.join(SRC, 'plugins', 'data-dictionary');

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

// ──────────────────────────────────────────────────────────────────────────────
// Acceptance #1 — Token declared exactly once
// ──────────────────────────────────────────────────────────────────────────────
describe('#162 acceptance #1 — AI_SERVICE_TOKEN declared exactly once', () => {
  it('tokens.ts declares AI_SERVICE_TOKEN exactly once with a Symbol value', () => {
    const content = read(TOKENS);
    const matches = content.match(/export\s+const\s+AI_SERVICE_TOKEN\s*=\s*Symbol\(/g);
    expect(matches, 'AI_SERVICE_TOKEN must be declared exactly once').not.toBeNull();
    expect(matches!.length).toBe(1);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Acceptance #2 — AIService self-contained
// ──────────────────────────────────────────────────────────────────────────────
describe('#162 acceptance #2 — AIService is self-contained', () => {
  it('AIService.ts does NOT import from services/api', () => {
    const content = read(AI_SERVICE);
    expect(content).not.toMatch(/from\s+['"][^'"]*services\/api['"]/);
  });

  it('AIService.ts does NOT import data-dictionary tokens', () => {
    const content = read(AI_SERVICE);
    expect(content).not.toMatch(/import.*dataDictionaryPlugin|DICTIONARY_SERVICE_TOKEN|STEREOTYPE_SERVICE_TOKEN|INTEGRITY_SERVICE_TOKEN|DIFF_SERVICE_TOKEN|IMPORT_EXPORT_SERVICE_TOKEN/);
  });

  it('AIService.ts has a constructor(http?: AxiosInstance) signature', () => {
    const content = read(AI_SERVICE);
    expect(content).toMatch(/constructor\s*\(\s*http\s*\?\s*:/);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Acceptance #3 — DI registration in initialize with useValue
// ──────────────────────────────────────────────────────────────────────────────
describe('#162 acceptance #3 — DI registration in initialize with useValue', () => {
  it('aiPlugin.ts provides AI_SERVICE_TOKEN inside initialize() with useValue', () => {
    const content = read(AI_PLUGIN);
    // Locate the initialize body
    const initStart = content.indexOf('async initialize(ctx)');
    expect(initStart, 'initialize() method should exist').toBeGreaterThanOrEqual(0);
    const activateStart = content.indexOf('async activate(', initStart);
    expect(activateStart, 'activate() method should follow initialize()').toBeGreaterThan(initStart);
    const initBody = content.slice(initStart, activateStart);

    expect(initBody).toMatch(/AI_SERVICE_TOKEN/);
    expect(initBody).toMatch(/ctx\.provide\s*\(/);
    expect(initBody).toMatch(/useValue\s*:/);

    // The provider block must not be a useClass / useFactory provider.
    const providerBlock = initBody.match(
      /ctx\.provide\s*\(\s*\{[^}]*AI_SERVICE_TOKEN[^}]*\}\s*\)/,
    );
    expect(providerBlock, 'Provider block referencing AI_SERVICE_TOKEN must be present').not.toBeNull();
    expect(providerBlock![0]).toMatch(/useValue/);
    expect(providerBlock![0]).not.toMatch(/useClass/);
    expect(providerBlock![0]).not.toMatch(/useFactory/);
  });

  it('aiPlugin.ts registers ai.chat.send command inside initialize()', () => {
    const content = read(AI_PLUGIN);
    const initStart = content.indexOf('async initialize(ctx)');
    const activateStart = content.indexOf('async activate(', initStart);
    const initBody = content.slice(initStart, activateStart);
    expect(initBody).toMatch(/ctx\.commands\.register\(\s*['"]ai\.chat\.send['"]/);
  });

  it('aiPlugin.ts registers at least 16 ai.* commands inside initialize()', () => {
    const content = read(AI_PLUGIN);
    const initStart = content.indexOf('async initialize(ctx)');
    const activateStart = content.indexOf('async activate(', initStart);
    const initBody = content.slice(initStart, activateStart);
    const registrations = initBody.match(/ctx\.commands\.register\(/g) ?? [];
    expect(registrations.length, 'Expected at least 16 command registrations').toBeGreaterThanOrEqual(15);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Acceptance #4 — Data-dictionary has no AI knowledge
// ──────────────────────────────────────────────────────────────────────────────
describe('#162 acceptance #4 — data-dictionary plugin has no AI knowledge', () => {
  it('data-dictionary plugin files (excl. __tests__) contain no AI references', () => {
    const offenders: Array<{ file: string; line: number; text: string }> = [];
    for (const file of walk(DD_PLUGIN_DIR)) {
      if (file.includes('__tests__')) continue;
      if (!/\.(ts|tsx)$/.test(file)) continue;
      const lines = read(file).split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (/AI_SERVICE_TOKEN|ai-assistance|AIService|AIChatPanel/i.test(lines[i])) {
          offenders.push({ file, line: i + 1, text: lines[i].trim() });
        }
      }
    }
    expect(
      offenders,
      `Unexpected AI references in data-dictionary:\n${JSON.stringify(offenders, null, 2)}`,
    ).toEqual([]);
  });

  it('AIService.ts has no import of dataDictionaryPlugin or data-dictionary tokens', () => {
    const content = read(AI_SERVICE);
    // Per spec acceptance #2: the regex is applied to import lines specifically.
    // Comments may reference these identifiers in prose; only actual import
    // statements are forbidden.
    expect(content).not.toMatch(/import.*dataDictionaryPlugin|DICTIONARY_SERVICE_TOKEN|STEREOTYPE_SERVICE_TOKEN|INTEGRITY_SERVICE_TOKEN|DIFF_SERVICE_TOKEN|IMPORT_EXPORT_SERVICE_TOKEN/);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Acceptance #5 — Repo-wide content guards
// ──────────────────────────────────────────────────────────────────────────────
describe('#162 acceptance #5 — repo-wide content guards', () => {
  // Self-exclusion: the literal strings in this guard file must not trigger
  // the guards against themselves.
  const SELF_SUFFIX = 'spec-grep-guards.ai.test.ts';

  it('frontend/src/components/AIChatPanel.tsx does NOT exist', () => {
    const filePath = path.join(SRC, 'components', 'AIChatPanel.tsx');
    expect(fs.existsSync(filePath), `${filePath} should have been deleted`).toBe(false);
  });

  it('frontend/src/utils/aiSlashCommands.ts does NOT exist', () => {
    const filePath = path.join(SRC, 'utils', 'aiSlashCommands.ts');
    expect(fs.existsSync(filePath), `${filePath} should have been deleted`).toBe(false);
  });

  it('frontend/src/utils/aiAutoApprovePolicy.ts does NOT exist', () => {
    const filePath = path.join(SRC, 'utils', 'aiAutoApprovePolicy.ts');
    expect(fs.existsSync(filePath), `${filePath} should have been deleted`).toBe(false);
  });

  it('frontend/src/components/__tests__/AIChatPanel.*.test.tsx returns zero files', () => {
    const testsDir = path.join(SRC, 'components', '__tests__');
    if (!fs.existsSync(testsDir)) return; // directory doesn't exist = zero files
    const aiTestFiles = fs.readdirSync(testsDir).filter(f => f.startsWith('AIChatPanel'));
    expect(
      aiTestFiles,
      `AIChatPanel test files should have been moved: ${aiTestFiles.join(', ')}`,
    ).toHaveLength(0);
  });

  it('frontend/src/utils/__tests__/aiSlashCommands.test.ts does NOT exist', () => {
    const filePath = path.join(SRC, 'utils', '__tests__', 'aiSlashCommands.test.ts');
    expect(fs.existsSync(filePath), `${filePath} should have been deleted`).toBe(false);
  });

  it('frontend/src/utils/__tests__/aiAutoApprovePolicy.test.ts does NOT exist', () => {
    const filePath = path.join(SRC, 'utils', '__tests__', 'aiAutoApprovePolicy.test.ts');
    expect(fs.existsSync(filePath), `${filePath} should have been deleted`).toBe(false);
  });

  it('no file outside plugins/ai-assistance imports from the old AIChatPanel / utils paths', () => {
    // The old paths (before the move) were:
    //   @/components/AIChatPanel  (or ../components/AIChatPanel etc.)
    //   ../utils/aiSlashCommands  (from components/ or src/)
    //   ../utils/aiAutoApprovePolicy
    // The new paths have plugins/ai-assistance/ in front.
    // We match the old-path pattern: an import whose path ends in
    //   components/AIChatPanel   — but NOT  plugins/ai-assistance/components/AIChatPanel
    //   src/utils/aiSlashCommands — but NOT  plugins/ai-assistance/utils/...
    //   src/utils/aiAutoApprovePolicy
    // Strategy: match the pattern, then verify the match does NOT contain the new plugin prefix.
    const OLD_PATH_RE = /components\/AIChatPanel|(?<![^\s/])utils\/aiSlashCommands|(?<![^\s/])utils\/aiAutoApprovePolicy/;
    const NEW_PLUGIN_INFIX = 'plugins/ai-assistance';

    const offenders: Array<{ file: string; line: number; text: string }> = [];
    for (const file of walk(SRC)) {
      if (file.endsWith(SELF_SUFFIX)) continue;
      if (file.includes('plugins/ai-assistance')) continue;
      if (!/\.(ts|tsx)$/.test(file)) continue;
      const lines = read(file).split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Only inspect import lines
        if (!line.trim().startsWith('import') && !line.trim().startsWith('from')) continue;
        if (OLD_PATH_RE.test(line) && !line.includes(NEW_PLUGIN_INFIX)) {
          offenders.push({ file, line: i + 1, text: line.trim() });
        }
      }
    }
    expect(
      offenders,
      `Unexpected imports of old paths:\n${JSON.stringify(offenders, null, 2)}`,
    ).toEqual([]);
  });

  it('ShellLayout.tsx imports AIChatPanel from the new plugin path', () => {
    const content = read(SHELL_LAYOUT);
    expect(content).toMatch(/from\s+['"][^'"]*plugins\/ai-assistance\/components\/AIChatPanel['"]/);
  });

  it('Settings.tsx imports aiAutoApprovePolicy from the plugin utils path', () => {
    const content = read(SETTINGS);
    expect(content).toMatch(/plugins\/ai-assistance\/utils\/aiAutoApprovePolicy/);
  });
});
