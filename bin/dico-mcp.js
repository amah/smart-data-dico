#!/usr/bin/env node
/**
 * Smart Data Dictionary MCP launcher (#62).
 *
 * Boots the MCP server defined under `backend/src/mcp/server.ts` over stdio.
 * Mirrors `bin/cli.js`:
 *   - Resolves `--data-dir <path>` (falling back to env `DATA_DIR`).
 *   - Prefers the bundled JS build if present; falls back to `tsx` over the
 *     TypeScript source when running from a checkout.
 *
 * Critically: this script must NOT write to stdout. The MCP stdio transport
 * uses stdout for JSON-RPC framing — any extra bytes will corrupt the stream.
 * All chatter goes to stderr.
 */

import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'node:path';
import { existsSync } from 'fs';
import { spawn } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PKG_ROOT = join(__dirname, '..');

const args = process.argv.slice(2);
const flags = {};
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--data-dir' && args[i + 1]) {
    flags.dataDir = args[++i];
  } else if (args[i] === '--help' || args[i] === '-h') {
    flags.help = true;
  }
}

if (flags.help) {
  process.stderr.write(`
  dico-mcp - Smart Data Dictionary MCP server (stdio)

  Usage:
    dico-mcp [options]

  Options:
    --data-dir <path>   Project directory (overrides DATA_DIR env)
    -h, --help          Show this help

  Register with Claude Desktop / Cursor / Roo Code:
    See backend/src/mcp/README.md for the JSON config snippets.

`);
  process.exit(0);
}

const dataDir = resolve(flags.dataDir || process.env.DATA_DIR || './data-dictionaries');

const bundledServer = join(PKG_ROOT, 'backend', 'dist', 'mcp', 'cli.js');
const sourceServer = join(PKG_ROOT, 'backend', 'src', 'mcp', 'cli.ts');

let bin, binArgs;

if (existsSync(bundledServer)) {
  bin = process.execPath; // node
  binArgs = [bundledServer];
} else if (existsSync(sourceServer)) {
  const tsxPaths = [
    join(PKG_ROOT, 'node_modules', '.bin', 'tsx'),
    join(PKG_ROOT, 'backend', 'node_modules', '.bin', 'tsx'),
  ];
  bin = tsxPaths.find(p => existsSync(p));
  if (!bin) {
    process.stderr.write('Error: tsx not found. Run `cd backend && npm install` first.\n');
    process.exit(1);
  }
  binArgs = [sourceServer];
} else {
  process.stderr.write('Error: MCP server not found (neither bundled nor source).\n');
  process.exit(1);
}

// Spawn the server, wiring its stdio straight through to ours so the parent
// MCP client (Claude Desktop, Cursor, ...) talks to it directly.
const child = spawn(bin, binArgs, {
  cwd: PKG_ROOT,
  env: {
    ...process.env,
    DATA_DIR: dataDir,
  },
  stdio: 'inherit',
});

child.on('error', (err) => {
  process.stderr.write(`Failed to start MCP server: ${err.message}\n`);
  process.exit(1);
});

child.on('exit', (code) => process.exit(code || 0));

process.on('SIGINT', () => child.kill('SIGINT'));
process.on('SIGTERM', () => child.kill('SIGTERM'));
