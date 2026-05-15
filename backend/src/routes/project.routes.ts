import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { config } from '../kernel/config.js';
import { UserRole } from '../middleware/auth.js';
import { authorizeJwt } from '../middleware/jwtAuth.js';

const router: Router = Router();

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
  config.dataDir = dataDir;
  // Update workspace roots for the git backend if available
  const roots = (req.app as any).__workspaceRoots as Map<string, string> | undefined;
  if (roots) roots.set('dictionaries', dataDir);
  res.json({ message: `Project opened: ${dataDir}`, data: { path: dataDir, name: path.basename(path.dirname(dataDir)) } });
});

router.post('/api/project/close', authorizeJwt([UserRole.ADMIN]), (req, res) => {
  if (config.profile !== 'local') {
    return res.status(403).json({ message: 'Project switching is only available in local mode' });
  }
  // Reset to the default (empty-ish) — callers should treat isOpen=false as "no project"
  const emptyDir = path.join(os.tmpdir(), 'smart-data-dico-closed');
  if (!fs.existsSync(emptyDir)) fs.mkdirSync(emptyDir, { recursive: true });
  config.dataDir = emptyDir;
  const roots = (req.app as any).__workspaceRoots as Map<string, string> | undefined;
  if (roots) roots.set('dictionaries', emptyDir);
  res.json({ message: 'Project closed' });
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
    // Auto-open the new project
    config.dataDir = dataDir;
    const roots = (req.app as any).__workspaceRoots as Map<string, string> | undefined;
    if (roots) roots.set('dictionaries', dataDir);
    res.json({ message: `Project initialized and opened: ${dataDir}`, data: { path: dataDir } });
  } catch (e) {
    res.status(500).json({ message: `Failed to initialize project: ${e}` });
  }
});

export default router;
