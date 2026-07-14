#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(scriptDir, '..');
const rootDir = path.resolve(desktopDir, '..');
const dryRun = process.argv.includes('--dry-run');
const skipBuild = process.argv.includes('--skip-build');

function run(command, args, cwd, { optional = false } = {}) {
  const rendered = [command, ...args].join(' ');
  console.log(`> ${rendered}`);
  if (dryRun) return;

  const result = spawnSync(command, args, { cwd, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0 && !optional) {
    throw new Error(`${rendered} exited with status ${result.status}`);
  }
}

if (process.platform !== 'darwin') {
  console.error('desktop:install:mac is only supported on macOS.');
  process.exit(1);
}

const outputDirectory = process.arch === 'arm64' ? 'mac-arm64' : 'mac';
const source = path.join(desktopDir, 'release', outputDirectory, 'Smart Data Dictionary.app');
const installRoot = process.env.SDD_INSTALL_DIR
  ? path.resolve(process.env.SDD_INSTALL_DIR.replace(/^~(?=$|\/)/, os.homedir()))
  : path.join(os.homedir(), 'Applications');
const target = path.join(installRoot, 'Smart Data Dictionary.app');
const staged = path.join(installRoot, `.Smart Data Dictionary.app.install-${process.pid}`);

try {
  if (!skipBuild) {
    run('npm', ['run', 'build'], rootDir);
    run('npm', ['run', 'pack'], desktopDir);
  }

  if (!dryRun && !fs.existsSync(source)) {
    throw new Error(`Packaged application not found: ${source}`);
  }

  console.log(`Installing ${source}`);
  console.log(`       to ${target}`);

  if (!dryRun) {
    fs.mkdirSync(installRoot, { recursive: true });
    fs.rmSync(staged, { recursive: true, force: true });
  }
  run('ditto', [source, staged], desktopDir);

  if (!dryRun) {
    fs.rmSync(target, { recursive: true, force: true });
    fs.renameSync(staged, target);
  }

  // Spotlight normally watches ~/Applications. Asking it to import immediately
  // makes the application searchable without waiting for the next filesystem scan.
  run('mdimport', [target], desktopDir, { optional: true });

  console.log(dryRun
    ? 'Dry run complete; no files were changed.'
    : `Installed successfully. Open Spotlight and search for “Smart Data Dictionary”.`);
} catch (error) {
  if (!dryRun) fs.rmSync(staged, { recursive: true, force: true });
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
