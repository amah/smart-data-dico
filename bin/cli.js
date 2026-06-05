#!/usr/bin/env node

import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'node:path';
import { existsSync, mkdirSync, cpSync, writeFileSync, readFileSync } from 'fs';
import { homedir } from 'node:os';
import { spawn, spawnSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PKG_ROOT = join(__dirname, '..');

// Parse CLI arguments
const args = process.argv.slice(2);
const flags = {};
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--port' && args[i + 1]) { flags.port = args[++i]; }
  else if (args[i] === '--data-dir' && args[i + 1]) { flags.dataDir = args[++i]; }
  else if (args[i] === '--no-open') { flags.noOpen = true; }
  else if (args[i] === '--validate') {
    // `--validate [folder]` — folder is optional; defaults to the data dir.
    flags.validate = (args[i + 1] && !args[i + 1].startsWith('-')) ? args[++i] : true;
  }
  else if (args[i] === '--help' || args[i] === '-h') { flags.help = true; }
}

if (flags.help) {
  console.log(`
  smart-data-dico - Collaborative Data Dictionary Management

  Usage:
    smart-data-dico [options]
    npx @hamak/smart-data-dico [options]

  Options:
    --port <number>     Server port (default: 3001)
    --data-dir <path>   Data directory path (default: ./data-dictionaries)
    --validate [path]   Validate a project folder and exit (no server).
                        Defaults to the data dir. Exit code 1 on errors.
    --no-open           Don't open browser automatically
    -h, --help          Show this help

  Examples:
    smart-data-dico
    smart-data-dico --port 4000
    smart-data-dico --data-dir ~/my-dictionaries
    smart-data-dico --validate ./my-project
    npx @hamak/smart-data-dico --validate ./my-project
  `);
  process.exit(0);
}

// --validate: run the standalone project validator and exit (no server).
// Mirrors the server's bundled/source dual-mode resolution below.
if (flags.validate !== undefined) {
  const folder = resolve(
    typeof flags.validate === 'string'
      ? flags.validate
      : (flags.dataDir || process.env.DATA_DIR || './data-dictionaries'),
  );
  const bundledValidator = join(PKG_ROOT, 'backend', 'dist', 'validate.mjs');
  const sourceValidator = join(PKG_ROOT, 'backend', 'src', 'scripts', 'validateDico.ts');

  let vbin, vargs;
  if (existsSync(bundledValidator)) {
    vbin = process.execPath; // node — bundle has all deps inlined
    vargs = [bundledValidator, '--data-dir', folder];
  } else if (existsSync(sourceValidator)) {
    const tsx = [
      join(PKG_ROOT, 'node_modules', '.bin', 'tsx'),
      join(PKG_ROOT, 'backend', 'node_modules', '.bin', 'tsx'),
    ].find(p => existsSync(p));
    vbin = tsx || 'npx';
    vargs = tsx ? [sourceValidator, '--data-dir', folder] : ['tsx', sourceValidator, '--data-dir', folder];
  } else {
    console.error('Error: validator not found (neither bundled nor source).');
    process.exit(1);
  }

  const r = spawnSync(vbin, vargs, { cwd: PKG_ROOT, stdio: 'inherit', env: process.env });
  if (r.error) {
    console.error('Failed to run validator:', r.error.message);
    process.exit(1);
  }
  process.exit(r.status ?? 0);
}

const port = flags.port || process.env.PORT || '3001';
const dataDir = resolve(flags.dataDir || process.env.DATA_DIR || './data-dictionaries');

// Bootstrap the project on first run. The layout matches the current
// conventions:
//   - `dico.config.json`       — project marker (#104)
//   - `.dico/stereotypes.yaml` — project-level stereotypes (#104)
// Packages and perspectives are created on demand — no empty subfolders.
if (!existsSync(dataDir)) {
  mkdirSync(dataDir, { recursive: true });
  console.log(`Created data directory: ${dataDir}`);

  const dicoDir = join(dataDir, '.dico');
  mkdirSync(dicoDir, { recursive: true });

  const configPath = join(dataDir, 'dico.config.json');
  if (!existsSync(configPath)) {
    writeFileSync(configPath, JSON.stringify({ version: 1 }, null, 2) + '\n', 'utf-8');
  }

  // Default stereotypes are shipped under the bundled sample.
  const defaultStereotypes = join(PKG_ROOT, 'samples', 'eshop', '.dico', 'stereotypes.yaml');
  const targetStereotypes = join(dicoDir, 'stereotypes.yaml');
  if (existsSync(defaultStereotypes) && !existsSync(targetStereotypes)) {
    cpSync(defaultStereotypes, targetStereotypes);
    console.log('Copied default stereotypes to .dico/stereotypes.yaml');
  }
}

// Determine how to run the server:
// 1. Bundled (production/npm): single .mjs file, run with node — no deps needed
// 2. Source (dev): TypeScript source, run with tsx
const bundledServer = join(PKG_ROOT, 'backend', 'dist', 'server.mjs');
const sourceServer = join(PKG_ROOT, 'backend', 'src', 'server.ts');

let bin, binArgs;

if (existsSync(bundledServer)) {
  // Production: bundled server — all deps inlined, just node
  bin = process.execPath; // 'node'
  binArgs = [bundledServer];
} else if (existsSync(sourceServer)) {
  // Development: run TypeScript source via tsx
  const tsxPaths = [
    join(PKG_ROOT, 'node_modules', '.bin', 'tsx'),
    join(PKG_ROOT, 'backend', 'node_modules', '.bin', 'tsx'),
  ];
  bin = tsxPaths.find(p => existsSync(p)) || 'npx';
  binArgs = bin.endsWith('npx') ? ['tsx', sourceServer] : [sourceServer];
} else {
  console.error('Error: No server found (neither bundled nor source).');
  process.exit(1);
}

const frontendDist = join(PKG_ROOT, 'frontend', 'dist');

// In-app "Open project" can't hot-swap the boot-time data dir, so the server
// persists the new project here and exits with RESTART_EXIT_CODE; we respawn
// it with DATA_DIR set to that path. SDD_MANAGED=1 tells the server it's safe
// to use this restart path.
const RESTART_EXIT_CODE = 75;
const ACTIVE_PROJECT_FILE = join(homedir(), '.dico-app', 'active-project');

let currentChild = null;
let browserOpened = false;

function startServer(dir) {
  console.log(`
  Smart Data Dictionary

  Port:       ${port}
  Data:       ${dir}
  Profile:    ${process.env.PROFILE || 'local'}
  Frontend:   ${existsSync(frontendDist) ? 'bundled' : 'dev (use frontend dev server on :3000)'}
`);

  const child = spawn(bin, binArgs, {
    cwd: PKG_ROOT,
    env: {
      ...process.env,
      PORT: port,
      NODE_ENV: 'production',
      PROFILE: process.env.PROFILE || 'local',
      DATA_DIR: dir,
      SDD_FRONTEND_DIST: frontendDist,
      SDD_MANAGED: '1',
    },
    stdio: 'inherit',
  });
  currentChild = child;

  child.on('error', (err) => {
    console.error('Failed to start server:', err.message);
    process.exit(1);
  });

  child.on('exit', (code) => {
    if (code === RESTART_EXIT_CODE) {
      // Project switch requested — read the new dir and respawn.
      let nextDir = dir;
      try {
        const persisted = readFileSync(ACTIVE_PROJECT_FILE, 'utf-8').trim();
        if (persisted) nextDir = persisted;
      } catch { /* keep current dir */ }
      console.log(`\nSwitching project → ${nextDir}\n`);
      startServer(nextDir);
      return;
    }
    process.exit(code || 0);
  });

  // Open the browser once, on the first start only (not on project-switch restarts).
  if (!flags.noOpen && !browserOpened) {
    browserOpened = true;
    setTimeout(async () => {
      const url = `http://localhost:${port}`;
      console.log(`Opening ${url} ...`);
      try {
        const { exec } = await import('child_process');
        const cmd = process.platform === 'darwin' ? 'open' :
                    process.platform === 'win32' ? 'start' : 'xdg-open';
        exec(`${cmd} ${url}`);
      } catch {
        console.log(`Open ${url} in your browser`);
      }
    }, 3000);
  }
}

startServer(dataDir);

process.on('SIGINT', () => {
  console.log('\nShutting down...');
  if (currentChild) currentChild.kill('SIGINT');
});

process.on('SIGTERM', () => {
  if (currentChild) currentChild.kill('SIGTERM');
});
