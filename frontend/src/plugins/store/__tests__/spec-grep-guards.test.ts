/**
 * #166 stereotype-slice pilot — content-guard regressions.
 *
 * Mirrors the pattern from #156's spec-grep-guards.test.ts: walk the file
 * tree with fs.readdirSync/readFileSync (NOT `grep`) and assert on hits.
 *
 * Covers spec acceptance criterion #13:
 *   - No `useState<boolean>` or `useState<Error>` in any of the new
 *     architectural files (storeFsPlugin, StereotypeService, useService,
 *     dataDictionaryPlugin).
 *   - StereotypesPage.tsx contains no `useState<(boolean|Error|string \| null)>`
 *     EXCEPT for the two ephemeral-UI declarations (`showCreate`, `editingId`)
 *     allowed by patterns.md §1.5.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const HERE = __dirname;
// repo root is five levels above this file's __tests__ directory.
const REPO_ROOT = path.resolve(HERE, '..', '..', '..', '..', '..');
const FRONTEND = path.join(REPO_ROOT, 'frontend');

const NEW_FILES = [
  path.join(
    FRONTEND,
    'src',
    'plugins',
    'store',
    'storeFsPlugin.ts',
  ),
  path.join(
    FRONTEND,
    'src',
    'plugins',
    'data-dictionary',
    'services',
    'StereotypeService.ts',
  ),
  path.join(FRONTEND, 'src', 'kernel', 'useService.ts'),
  path.join(
    FRONTEND,
    'src',
    'plugins',
    'data-dictionary',
    'dataDictionaryPlugin.ts',
  ),
];

const STEREOTYPES_PAGE = path.join(
  FRONTEND,
  'src',
  'pages',
  'StereotypesPage.tsx',
);

function readLinesOf(file: string): string[] {
  return fs.readFileSync(file, 'utf8').split('\n');
}

describe('#166 acceptance #13 — banned useState patterns', () => {
  it.each(NEW_FILES)(
    'no useState<boolean|Error>(...) invocations in %s',
    (file: string) => {
      const lines = readLinesOf(file);
      // Match `useState<boolean>(` or `useState<Error>(` — INVOCATIONS
      // only. Prose references inside `//` line comments or `/* … */`
      // block comments must not trip this guard; we strip those before
      // matching by ignoring any line that starts with `//` (after
      // leading whitespace) or whose `useState<...>(` substring appears
      // after a `//` on the same line.
      const banned = /useState<\s*(boolean|Error)\b[^>]*>\s*\(/;
      const hits: Array<{ line: number; text: string }> = [];
      for (let i = 0; i < lines.length; i++) {
        const raw = lines[i];
        // Strip from `//` onward (rough — does not handle string literals
        // containing `//`, but our source files don't).
        const codeOnly = raw.replace(/\/\/.*$/, '');
        if (banned.test(codeOnly)) {
          hits.push({ line: i + 1, text: raw });
        }
      }
      expect(
        hits,
        `Banned useState pattern found in ${file}:\n${JSON.stringify(hits, null, 2)}`,
      ).toEqual([]);
    },
  );

  it('StereotypesPage.tsx has no useState<(boolean|Error|string \\| null)>(...) beyond allowed showCreate/editingId', () => {
    const lines = readLinesOf(STEREOTYPES_PAGE);
    // Match INVOCATIONS (the trailing `(` is required) so prose
    // references in comments don't false-positive.
    const banned = /useState<\s*(boolean|Error|string\s*\|\s*null)\s*>\s*\(/;
    const allowlist = /(showCreate|editingId)/;

    const hits: Array<{ line: number; text: string }> = [];
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      const codeOnly = raw.replace(/\/\/.*$/, '');
      if (!banned.test(codeOnly)) continue;
      if (allowlist.test(codeOnly)) continue;
      hits.push({ line: i + 1, text: raw });
    }
    expect(
      hits,
      `Disallowed useState declarations in StereotypesPage.tsx:\n${JSON.stringify(hits, null, 2)}`,
    ).toEqual([]);
  });

  it('StereotypesPage.tsx is migrated: imports useService and STEREOTYPE_SERVICE_TOKEN; no stereotypeApi direct import', () => {
    const content = fs.readFileSync(STEREOTYPES_PAGE, 'utf8');
    expect(content).toMatch(/from\s+['"]\.\.\/kernel\/useService['"]/);
    expect(content).toMatch(/STEREOTYPE_SERVICE_TOKEN/);
    // Page must NOT import stereotypeApi from services/api anymore.
    expect(content).not.toMatch(
      /import\s+\{[^}]*stereotypeApi[^}]*\}\s+from\s+['"][^'"]*services\/api['"]/,
    );
  });
});

describe('#166 — kernel/bootstrap registration', () => {
  it('bootstrap.ts registers store-fs plugin with dependsOn: [store, remote-fs]', () => {
    const bootstrap = fs.readFileSync(
      path.join(FRONTEND, 'src', 'kernel', 'bootstrap.ts'),
      'utf8',
    );
    expect(bootstrap).toMatch(/createAppStoreFsPlugin/);
    expect(bootstrap).toMatch(/['"]store-fs['"]/);
    // dependsOn check — order in the array is not pinned; just both deps.
    const storeFsBlock = bootstrap.match(
      /registerPlugin\(\s*['"]store-fs['"][^]*?\)\s*;/,
    );
    expect(storeFsBlock).not.toBeNull();
    expect(storeFsBlock![0]).toMatch(/['"]store['"]/);
    expect(storeFsBlock![0]).toMatch(/['"]remote-fs['"]/);
  });

  it('bootstrap.ts data-dictionary plugin dependsOn includes store-fs', () => {
    const bootstrap = fs.readFileSync(
      path.join(FRONTEND, 'src', 'kernel', 'bootstrap.ts'),
      'utf8',
    );
    const block = bootstrap.match(
      /registerPlugin\(\s*['"]data-dictionary['"][^]*?\)\s*;/,
    );
    expect(block).not.toBeNull();
    expect(block![0]).toMatch(/['"]store-fs['"]/);
  });
});

describe('#166 — tokens', () => {
  it('tokens.ts exports STORE_FS_TOKEN and STEREOTYPE_SERVICE_TOKEN', () => {
    const content = fs.readFileSync(
      path.join(FRONTEND, 'src', 'kernel', 'tokens.ts'),
      'utf8',
    );
    expect(content).toMatch(/export\s+const\s+STORE_FS_TOKEN\s*=/);
    expect(content).toMatch(/export\s+const\s+STEREOTYPE_SERVICE_TOKEN\s*=/);
  });
});
