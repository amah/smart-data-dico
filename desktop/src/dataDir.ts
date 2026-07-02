/**
 * Project (data) directory resolution + scaffolding. Mirrors `bin/cli.js`'s
 * bootstrap and shares the server's project-switch handoff file.
 *
 * The active project is persisted to `~/.dico-app/active-project` — the SAME
 * file the backend writes on `/api/project/open` (see backend appDir.ts /
 * project.routes.ts) and that `bin/cli.js` reads on an exit-75 respawn. Using it
 * here means the native "Open Folder" menu and the in-SPA project switch resolve
 * to one source of truth.
 */
import { app } from 'electron';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';

/** Same path as the backend's ACTIVE_PROJECT_FILE (~/.dico-app/active-project). */
export const ACTIVE_PROJECT_FILE = path.join(os.homedir(), '.dico-app', 'active-project');

/** A folder is a dico project iff it has a dico.config.json marker. */
export function isDicoProject(dir: string): boolean {
  return fs.existsSync(path.join(dir, 'dico.config.json'));
}

/** Read the persisted active project, or null if unset / no longer a directory. */
export function readActiveProject(): string | null {
  try {
    const dir = fs.readFileSync(ACTIVE_PROJECT_FILE, 'utf-8').trim();
    if (dir && fs.statSync(dir).isDirectory()) return dir;
  } catch {
    /* unset or stale — fall through */
  }
  return null;
}

/** Persist the active project (raw path, no newline — matches the backend). */
export function writeActiveProject(dir: string): void {
  fs.mkdirSync(path.dirname(ACTIVE_PROJECT_FILE), { recursive: true });
  fs.writeFileSync(ACTIVE_PROJECT_FILE, dir, 'utf-8');
}

/**
 * Initialise an empty dico project at `dir` (no-op for an existing one). Ports
 * cli.js's first-run bootstrap: project marker + .dico/ with default
 * stereotypes copied from the bundled sample.
 */
export function scaffoldProject(dir: string, sampleRoot: string): void {
  fs.mkdirSync(path.join(dir, '.dico'), { recursive: true });
  const configPath = path.join(dir, 'dico.config.json');
  if (!fs.existsSync(configPath)) {
    fs.writeFileSync(configPath, JSON.stringify({ version: 1 }, null, 2) + '\n', 'utf-8');
  }
  const srcStereo = path.join(sampleRoot, '.dico', 'stereotypes.yaml');
  const dstStereo = path.join(dir, '.dico', 'stereotypes.yaml');
  if (fs.existsSync(srcStereo) && !fs.existsSync(dstStereo)) {
    fs.copyFileSync(srcStereo, dstStereo);
  } else if (!fs.existsSync(dstStereo)) {
    fs.writeFileSync(dstStereo, '[]', 'utf-8');
  }
}

/**
 * The bundled starter project shipped with the app:
 * - dev: the repo's `samples/eshop`, edited in place.
 * - packaged: the `sample-project` extraResource under resourcesPath.
 */
export function sampleRoot(resourcesRoot: string): string {
  return app.isPackaged
    ? path.join(resourcesRoot, 'sample-project')
    : path.join(resourcesRoot, 'samples', 'eshop');
}

/**
 * Decide which project to open at launch:
 * 1. A previously chosen project (active-project handoff), if still valid.
 * 2. Otherwise the default starter project. Packaged, the read-only bundled
 *    sample is copied into a writable userData dir on first run.
 */
export function resolveInitialDataDir(resourcesRoot: string): string {
  const active = readActiveProject();
  if (active) return active;

  const sample = sampleRoot(resourcesRoot);
  if (!app.isPackaged) return sample; // dev: edit the repo sample directly

  const target = path.join(app.getPath('userData'), 'projects', 'eshop');
  if (!fs.existsSync(target)) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.cpSync(sample, target, { recursive: true });
    console.log(`[dataDir] seeded starter project → ${target}`);
  }
  return target;
}
