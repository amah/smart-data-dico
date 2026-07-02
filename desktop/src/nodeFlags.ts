/**
 * Decide whether the server child needs `--experimental-sqlite`. Ported from
 * `bin/cli.js`'s `serverNodeOptions()`: node:sqlite is built-in but gated until
 * it stabilises. We probe THIS (Electron's) Node: if it loads unflagged it's
 * already stable; if it throws it's present-but-gated; if the version is too old
 * it's unavailable and we don't pass an unknown flag.
 *
 * NOTE: this reflects Electron's bundled Node, not the system Node. node:sqlite
 * requires Node ≥ 22.5, so the Electron version must be new enough (Electron 35
 * ships Node 22.16 → loads unflagged). If too old, SQLite run-SQL is unavailable
 * (the Tier-2 fallback is better-sqlite3 — out of scope here).
 */
export function nodeFlags(): string[] {
  if ((process.env.NODE_OPTIONS || '').includes('--experimental-sqlite')) return [];
  const [major, minor] = process.versions.node.split('.').map(Number);
  const flagSupported = major > 22 || (major === 22 && minor >= 5);
  if (!flagSupported) return []; // too old: node:sqlite unavailable, flag unknown
  try {
    require('node:sqlite'); // loads unflagged → already stable
    return [];
  } catch {
    return ['--experimental-sqlite']; // present but gated → enable it
  }
}
