/**
 * #156 — CI-style content guards for spec acceptance criteria
 *
 * Re-runs the checks the spec lists for acceptance #1, #2, #3, #4, #8, #9,
 * #10 so a regression that re-introduces the bespoke notification service
 * (or breaks the CLAUDE.md / package.json sync) fails the suite at unit
 * speed.
 *
 * Out of scope for this guard file:
 *  - #5  (tsc --noEmit) — baseline failure (pre-existing scrollIntoView
 *         errors in AIChatPanel*.test.tsx, see dev-notes.md "Unrelated
 *         issues") makes this criterion unrunnable until a separate ticket
 *         clears the baseline. Tracked in test-results.md as skipped.
 *  - #6, #7 — covered by `notificationPlugin.test.ts` in this directory.
 *  - #11 (npm test) — this test suite IS the bar; if it passes, #11 passes.
 *  - #12 (npm run lint) — baseline broken (no .eslintrc.* at frontend/),
 *         see dev-notes.md. Skipped in test-results.md.
 *  - #13 (attempts.log tail) — orchestrator-side, verified at PR time.
 *
 * Implementation choice: we walk the file tree with `fs.readdirSync` and
 * `fs.readFileSync` rather than shelling out to `grep`. The shell route
 * (an earlier draft) hit two problems on the test host: the user's `grep`
 * was aliased to `ugrep` with non-standard --exclude semantics, and the
 * test files themselves contain literal grep patterns that produced false
 * positives even with `--exclude-dir=__tests__`. The fs-based walker is
 * deterministic across CI shells and lets us cleanly skip the guard file
 * itself by absolute path. The spec's wording was "grep returns exit
 * code 1" but the intent is "no offending content"; we honor the intent.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// Repo root is five levels above this file's __tests__ directory.
const HERE = __dirname;
const REPO_ROOT = path.resolve(HERE, '..', '..', '..', '..', '..');
const FRONTEND_SRC = path.join(REPO_ROOT, 'frontend', 'src');
const THIS_FILE = path.join(HERE, 'spec-grep-guards.test.ts');

/**
 * Recursively walk `dir` and yield absolute file paths matching `pred`.
 * Excludes `node_modules` and the guard file itself unconditionally.
 */
function* walkFiles(
  dir: string,
  pred: (absPath: string) => boolean
): Generator<string> {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      yield* walkFiles(abs, pred);
    } else if (entry.isFile()) {
      if (abs === THIS_FILE) continue;
      if (pred(abs)) yield abs;
    }
  }
}

/**
 * Search for `regex` matches inside files under `root` that satisfy `pred`.
 * Returns an array of `{ file, line, text }` for human-readable assertions.
 */
function searchFiles(
  root: string,
  pred: (abs: string) => boolean,
  regex: RegExp
): Array<{ file: string; line: number; text: string }> {
  const hits: Array<{ file: string; line: number; text: string }> = [];
  for (const file of walkFiles(root, pred)) {
    const content = fs.readFileSync(file, 'utf8');
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (regex.test(lines[i])) {
        hits.push({ file, line: i + 1, text: lines[i] });
      }
    }
  }
  return hits;
}

const isTs = (abs: string) =>
  abs.endsWith('.ts') || abs.endsWith('.tsx') || abs.endsWith('.js');
const isTestFile = (abs: string) =>
  abs.endsWith('.test.ts') || abs.endsWith('.test.tsx');

describe('#156 acceptance — content guards', () => {
  it("#1 — SimpleNotificationService and the bespoke `Symbol('NotificationService')` are gone from frontend/src", () => {
    // Two patterns OR'd: the class name and the literal Symbol-constructor
    // expression that produced the bespoke DI token. Either being present
    // means the bespoke service was reintroduced.
    const hits = searchFiles(
      FRONTEND_SRC,
      isTs,
      /SimpleNotificationService|Symbol\(['"]NotificationService['"]\)/
    );
    expect(hits, JSON.stringify(hits, null, 2)).toEqual([]);
  });

  it('#2 — no `class .*NotificationService` re-implementation in frontend/src', () => {
    // Allow the class to live inside node_modules (the framework's own
    // implementation lives there); ban it in our source tree.
    const hits = searchFiles(FRONTEND_SRC, isTs, /\bclass\s+\w*NotificationService\b/);
    expect(hits, JSON.stringify(hits, null, 2)).toEqual([]);
  });

  it("#3 — notificationPlugin.ts imports from '@hamak/notification' and re-exports createNotificationPlugin", () => {
    const pluginPath = path.join(
      FRONTEND_SRC,
      'plugins',
      'notification',
      'notificationPlugin.ts'
    );
    const content = fs.readFileSync(pluginPath, 'utf8');

    // Framework import line must be present.
    expect(content).toMatch(/from\s+['"]@hamak\/notification['"]/);

    // Both the aliased import and the re-exported factory must be present.
    expect(content).toMatch(/createNotificationPlugin\s+as\s+createFrameworkNotificationPlugin/);
    expect(content).toMatch(/export\s+function\s+createNotificationPlugin\b/);
  });

  it("#4 — bespoke `notification.<level>` command registrations are gone from the plugin file", () => {
    // Scoped to the plugin file ONLY. The framework's factory still
    // registers seven `notification.*` commands inside node_modules; that
    // is the framework's responsibility, not ours.
    const pluginPath = path.join(
      FRONTEND_SRC,
      'plugins',
      'notification',
      'notificationPlugin.ts'
    );
    const content = fs.readFileSync(pluginPath, 'utf8');
    expect(content).not.toMatch(/ctx\.commands\.register\s*\(\s*['"]notification\./);
  });

  it('#8 — @hamak/logging and @hamak/notification are declared as direct deps in frontend/package.json at ^0.5.x', () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(REPO_ROOT, 'frontend', 'package.json'), 'utf8')
    ) as { dependencies?: Record<string, string> };

    expect(pkg.dependencies).toBeDefined();
    expect(pkg.dependencies!['@hamak/logging']).toBeDefined();
    expect(pkg.dependencies!['@hamak/notification']).toBeDefined();

    // Spec specifies `^0.5.2` for the new @hamak/logging direct-dep line.
    // The matching @hamak/notification line was already at `^0.5.2`.
    expect(pkg.dependencies!['@hamak/logging']).toMatch(/^\^?0\.5\./);
    expect(pkg.dependencies!['@hamak/notification']).toMatch(/^\^?0\.5\./);
  });

  it('#9 — no existing test files assert exhaustive Redux state shape', () => {
    // The auto-registered `state.notifications` slice (from the framework
    // via STORE_EXTENSIONS_TOKEN) widens RootState. If any test makes
    // exhaustive-shape assertions, the slice could break it; the spec asks
    // for explicit triage. The walker already skips this guard file, so
    // its literal regex source won't self-match.
    const hits = searchFiles(
      FRONTEND_SRC,
      isTestFile,
      /getState\(\)|toEqual.*\bstate\b|Object\.keys\([^)]*\bstate\b/
    );
    expect(hits, JSON.stringify(hits, null, 2)).toEqual([]);
  });

  it('#10 — CLAUDE.md is in sync with frontend/package.json (no stale -api/-impl pair)', () => {
    const claudeMd = fs.readFileSync(path.join(REPO_ROOT, 'CLAUDE.md'), 'utf8');

    // Stale entries (the cycle-1 baseline form) must be gone.
    expect(claudeMd).not.toMatch(/@hamak\/notification-(api|impl)/);

    // New canonical entries must be present, one bullet line each.
    // Match the literal bullet header: `- ` followed by a backtick-wrapped
    // package name. Use multiline mode so `^` anchors to a line start.
    expect(claudeMd).toMatch(/^- `@hamak\/notification`/m);
    expect(claudeMd).toMatch(/^- `@hamak\/logging`/m);
  });
});
