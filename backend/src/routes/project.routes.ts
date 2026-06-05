import { Router, type Request, type Response } from 'express';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { config } from '../kernel/config.js';
import { UserRole } from '../middleware/auth.js';
import { authorizeJwt } from '../middleware/jwtAuth.js';
import { ACTIVE_PROJECT_FILE } from '../utils/appDir.js';
import { logger } from '../utils/logger.js';

const router: Router = Router();

/** Exit code the server uses to ask its supervisor (bin/cli.js) to respawn. */
const RESTART_EXIT_CODE = 75;

/**
 * Switch the active project to `dataDir`.
 *
 * Boot-time singletons — the framework WorkspaceManager, the LogicalProjection,
 * the UuidIndex, the RawFsWatcher, and the already-mounted `/fs` routes — all
 * capture the data dir at startup and cannot be re-pointed cleanly in-process.
 * So when the server is supervised (bin/cli.js sets SDD_MANAGED=1), we persist
 * the target dir and exit with RESTART_EXIT_CODE; the CLI respawns us with
 * DATA_DIR=dataDir, reusing the known-good boot path (identical to --data-dir).
 *
 * Outside managed mode (dev / direct `node`), fall back to a best-effort
 * in-process re-point — correct for reopening the SAME dir; a different dir
 * needs a manual restart.
 */
function applyProjectSwitch(req: Request, res: Response, dataDir: string, message: string): void {
  if (process.env.SDD_MANAGED === '1') {
    try {
      fs.mkdirSync(path.dirname(ACTIVE_PROJECT_FILE), { recursive: true });
      fs.writeFileSync(ACTIVE_PROJECT_FILE, dataDir, 'utf-8');
    } catch (e) {
      logger.error(`Project switch: failed to persist target dir: ${e}`);
      res.status(500).json({ message: 'Failed to switch project (could not persist target).' });
      return;
    }
    res.json({ message, data: { path: dataDir, name: path.basename(path.dirname(dataDir)) }, restarting: true });
    logger.info(`Project switch → restarting to load ${dataDir}`);
    // Flush the response, then exit so the supervisor respawns with the new DATA_DIR.
    setTimeout(() => process.exit(RESTART_EXIT_CODE), 250);
    return;
  }
  // Best-effort in-process fallback (dev / unmanaged).
  config.dataDir = dataDir;
  const roots = (req.app as { __workspaceRoots?: Map<string, string> }).__workspaceRoots;
  if (roots) roots.set('dictionaries', dataDir);
  res.json({ message, data: { path: dataDir, name: path.basename(path.dirname(dataDir)) }, restarting: false });
}

/**
 * GET /api/filesystem/browse?path=/some/dir
 *
 * Lists subdirectories at the given path so the frontend can render a
 * folder picker without needing the File System Access API (which can't
 * return actual paths). Local-mode only.
 */
router.get('/api/filesystem/browse', (req, res) => {
  if (config.profile !== 'local') {
    return res.status(403).json({ message: 'Filesystem browsing is only available in local mode' });
  }
  const dirPath = (req.query.path as string) || os.homedir();
  const resolved = path.resolve(dirPath);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    return res.status(400).json({ message: `Not a directory: ${resolved}` });
  }
  try {
    const entries = fs.readdirSync(resolved, { withFileTypes: true });
    const directories = entries
      .filter(e => e.isDirectory() && !e.name.startsWith('.'))
      .map(e => e.name)
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    const hasDataDictionaries = fs.existsSync(path.join(resolved, 'dico.config.json'))
      || fs.existsSync(path.join(resolved, 'data-dictionaries', 'dico.config.json'));
    res.json({
      data: {
        path: resolved,
        parent: path.dirname(resolved),
        directories,
        hasDataDictionaries,
      },
    });
  } catch (e) {
    res.status(500).json({ message: `Failed to read directory: ${e}` });
  }
});

router.get('/api/project', (req, res) => {
  const dataDir = config.dataDir;
  const isOpen = fs.existsSync(path.join(dataDir, 'dico.config.json'));
  res.json({
    data: {
      path: dataDir,
      name: path.basename(path.dirname(dataDir)) || path.basename(dataDir),
      isOpen,
      profile: config.profile,
    },
  });
});

router.get('/api/project/status', async (_req, res) => {
  try {
    const { versionService } = await import('../services/versionService.js');
    const status = await versionService.getWorkingTreeStatus();
    res.json({ data: status });
  } catch (e) {
    res.status(500).json({ message: `Failed to read project status: ${e}` });
  }
});

router.post('/api/project/open', authorizeJwt([UserRole.ADMIN]), (req, res) => {
  if (config.profile !== 'local') {
    return res.status(403).json({ message: 'Project switching is only available in local mode' });
  }
  const { path: dirPath } = req.body;
  if (!dirPath || typeof dirPath !== 'string') {
    return res.status(400).json({ message: 'path (string) is required' });
  }
  const resolved = path.resolve(dirPath);
  if (!fs.existsSync(resolved)) {
    return res.status(400).json({ message: `Path does not exist: ${resolved}` });
  }
  // Accept either the project folder itself or its parent containing data-dictionaries/
  const dataDir = fs.existsSync(path.join(resolved, 'dico.config.json'))
    ? resolved
    : fs.existsSync(path.join(resolved, 'data-dictionaries', 'dico.config.json'))
      ? path.join(resolved, 'data-dictionaries')
      : null;
  if (!dataDir) {
    return res.status(400).json({
      message: `No dico.config.json found at ${resolved}. Use /api/project/init to create one.`,
    });
  }
  applyProjectSwitch(req, res, dataDir, `Project opened: ${dataDir}`);
});

router.post('/api/project/close', authorizeJwt([UserRole.ADMIN]), (req, res) => {
  if (config.profile !== 'local') {
    return res.status(403).json({ message: 'Project switching is only available in local mode' });
  }
  // Reset to the default (empty-ish) — callers should treat isOpen=false as "no project"
  const emptyDir = path.join(os.tmpdir(), 'smart-data-dico-closed');
  if (!fs.existsSync(emptyDir)) fs.mkdirSync(emptyDir, { recursive: true });
  applyProjectSwitch(req, res, emptyDir, 'Project closed');
});

router.post('/api/project/init', authorizeJwt([UserRole.ADMIN]), (req, res) => {
  if (config.profile !== 'local') {
    return res.status(403).json({ message: 'Project initialization is only available in local mode' });
  }
  const { path: dirPath } = req.body;
  if (!dirPath || typeof dirPath !== 'string') {
    return res.status(400).json({ message: 'path (string) is required' });
  }
  const resolved = path.resolve(dirPath);
  const dataDir = resolved.endsWith('data-dictionaries')
    ? resolved
    : path.join(resolved, 'data-dictionaries');
  try {
    // Project marker + .dico/ system folder (#104). Packages live at the
    // project root and are created on demand (#105).
    fs.mkdirSync(path.join(dataDir, '.dico'), { recursive: true });
    fs.mkdirSync(path.join(dataDir, '.dico', 'diagrams'), { recursive: true });
    const configPath = path.join(dataDir, 'dico.config.json');
    if (!fs.existsSync(configPath)) {
      fs.writeFileSync(configPath, JSON.stringify({ version: 1 }, null, 2) + '\n', 'utf-8');
    }
    const stereotypesPath = path.join(dataDir, '.dico', 'stereotypes.yaml');
    if (!fs.existsSync(stereotypesPath)) {
      fs.writeFileSync(stereotypesPath, '[]', 'utf-8');
    }
    // Auto-open the new project (restart in managed mode).
    applyProjectSwitch(req, res, dataDir, `Project initialized and opened: ${dataDir}`);
  } catch (e) {
    res.status(500).json({ message: `Failed to initialize project: ${e}` });
  }
});

export default router;
