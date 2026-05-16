/**
 * #160 spec-grep guards — git plugin migration.
 *
 * Content guards per spec acceptance criterion #37:
 *   - gitPlugin.ts exists and exports createGitPlugin.
 *   - GitService.ts exists and exports class GitService.
 *   - PublishService.ts exists and exports class PublishService.
 *   - api.ts does NOT contain 'export const versionApi'.
 *   - api.ts does NOT contain 'export const gitApi'.
 *   - No file under frontend/src/ contains 'versionApi.' or 'gitApi.'.
 *   - bootstrap.ts contains name: 'git' exactly once.
 *   - dataDictionaryPlugin.ts registers exactly 7 data-dictionary.git.* commands
 *     and exactly 4 data-dictionary.publish.* commands.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const HERE = __dirname;
// Resolve from `frontend/src/plugins/git/__tests__` → repo root: 5 levels up
// git/__tests__ → git → plugins → src → frontend → <repo-root>
const REPO_ROOT = path.resolve(HERE, '..', '..', '..', '..', '..');
const FRONTEND = path.join(REPO_ROOT, 'frontend');
const SRC = path.join(FRONTEND, 'src');

const GIT_PLUGIN_TS = path.join(SRC, 'plugins', 'git', 'gitPlugin.ts');
const GIT_SERVICE_TS = path.join(SRC, 'plugins', 'git', 'services', 'GitService.ts');
const PUBLISH_SERVICE_TS = path.join(SRC, 'plugins', 'data-dictionary', 'services', 'PublishService.ts');
const API_TS = path.join(SRC, 'services', 'api.ts');
const BOOTSTRAP_TS = path.join(SRC, 'kernel', 'bootstrap.ts');
const DATA_DICTIONARY_PLUGIN = path.join(SRC, 'plugins', 'data-dictionary', 'dataDictionaryPlugin.ts');

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

describe('#160 spec-grep — gitPlugin.ts', () => {
  it('gitPlugin.ts exists', () => {
    expect(fs.existsSync(GIT_PLUGIN_TS)).toBe(true);
  });

  it('gitPlugin.ts exports createGitPlugin', () => {
    const content = read(GIT_PLUGIN_TS);
    expect(content).toMatch(/export function createGitPlugin\b/);
  });
});

describe('#160 spec-grep — GitService.ts', () => {
  it('GitService.ts exists', () => {
    expect(fs.existsSync(GIT_SERVICE_TS)).toBe(true);
  });

  it('GitService.ts exports class GitService', () => {
    const content = read(GIT_SERVICE_TS);
    expect(content).toMatch(/export class GitService\b/);
  });
});

describe('#160 spec-grep — PublishService.ts', () => {
  it('PublishService.ts exists', () => {
    expect(fs.existsSync(PUBLISH_SERVICE_TS)).toBe(true);
  });

  it('PublishService.ts exports class PublishService', () => {
    const content = read(PUBLISH_SERVICE_TS);
    expect(content).toMatch(/export class PublishService\b/);
  });
});

describe('#160 spec-grep — api.ts excisions', () => {
  it('api.ts does NOT contain "export const versionApi"', () => {
    const content = read(API_TS);
    expect(content).not.toContain('export const versionApi');
  });

  it('api.ts does NOT contain "export const gitApi"', () => {
    const content = read(API_TS);
    expect(content).not.toContain('export const gitApi');
  });
});

describe('#160 spec-grep — zero versionApi./gitApi. call-sites in frontend/src', () => {
  // These guard files are allowed to mention the strings in prose
  const allowedSuffixes = [
    'spec-grep-guards.git.test.ts',
    'spec-grep-guards.commands.test.ts',
  ];

  it('no file under frontend/src/ (excluding guard files) contains "versionApi."', () => {
    const offenders: Array<{ file: string; line: number; text: string }> = [];
    for (const file of walk(SRC)) {
      if (allowedSuffixes.some((s) => file.endsWith(s))) continue;
      if (!/\.(ts|tsx)$/.test(file)) continue;
      const lines = read(file).split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (/versionApi\./.test(lines[i])) {
          offenders.push({ file, line: i + 1, text: lines[i] });
        }
      }
    }
    expect(
      offenders,
      `Unexpected versionApi. references:\n${JSON.stringify(offenders, null, 2)}`,
    ).toEqual([]);
  });

  it('no file under frontend/src/ (excluding guard files) contains "gitApi."', () => {
    const offenders: Array<{ file: string; line: number; text: string }> = [];
    for (const file of walk(SRC)) {
      if (allowedSuffixes.some((s) => file.endsWith(s))) continue;
      if (!/\.(ts|tsx)$/.test(file)) continue;
      const lines = read(file).split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (/gitApi\./.test(lines[i])) {
          offenders.push({ file, line: i + 1, text: lines[i] });
        }
      }
    }
    expect(
      offenders,
      `Unexpected gitApi. references:\n${JSON.stringify(offenders, null, 2)}`,
    ).toEqual([]);
  });
});

describe('#160 spec-grep — bootstrap.ts plugin rename', () => {
  it('bootstrap.ts contains name: \'git\' exactly once', () => {
    const content = read(BOOTSTRAP_TS);
    const matches = content.match(/name:\s*'git'/g) ?? [];
    expect(matches.length).toBe(1);
  });

  it('bootstrap.ts does NOT contain \'remote-git\'', () => {
    const content = read(BOOTSTRAP_TS);
    expect(content).not.toContain("'remote-git'");
  });

  it('bootstrap.ts does NOT contain createVersionControlPlugin', () => {
    const content = read(BOOTSTRAP_TS);
    expect(content).not.toContain('createVersionControlPlugin');
  });
});

describe('#160 spec-grep — dataDictionaryPlugin command registrations', () => {
  it('dataDictionaryPlugin.ts registers exactly 7 data-dictionary.git.* commands', () => {
    const content = read(DATA_DICTIONARY_PLUGIN);
    const matches = content.match(/ctx\.commands\.register\s*\(\s*'data-dictionary\.git\./g) ?? [];
    expect(matches.length).toBe(7);
  });

  it('dataDictionaryPlugin.ts registers exactly 4 data-dictionary.publish.* commands', () => {
    const content = read(DATA_DICTIONARY_PLUGIN);
    const matches = content.match(/ctx\.commands\.register\s*\(\s*'data-dictionary\.publish\./g) ?? [];
    expect(matches.length).toBe(4);
  });
});
