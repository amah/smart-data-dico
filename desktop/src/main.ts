/**
 * Electron main process — issue #206 (Tier 1 desktop).
 *
 * Hosts the bundled backend (which serves the built SPA over localhost) inside a
 * native BrowserWindow, mirroring `bin/cli.js`'s launch logic. Server bundle,
 * SPA, and the CJS launcher ship as extraResources under process.resourcesPath
 * (outside asar); a dev run reads the same files from the repo tree.
 *
 * Phase 2 adds: native menu, "Open Folder" project switch (+ exit-75 respawn for
 * the in-SPA path), a writable userData project, single-instance lock, and a
 * minimal contextBridge.
 */
import { app, BrowserWindow, Menu, dialog, ipcMain } from 'electron';
import * as path from 'node:path';
import { ServerHost } from './serverHost';
import { buildMenu } from './menu';
import {
  resolveInitialDataDir,
  sampleRoot,
  scaffoldProject,
  isDicoProject,
  writeActiveProject,
} from './dataDir';

const REPO_URL = 'https://github.com/amah/smart-data-dico';

// ── Resource paths: packaged app vs dev tree ─────────────────────────────────
// Packaged: extraResources land under process.resourcesPath.
// Dev: compiled layout is <repo>/desktop/dist/main.js → repo root is two up.
const RES = app.isPackaged ? process.resourcesPath : path.resolve(__dirname, '..', '..');
const SERVER_MJS = path.join(RES, 'backend', 'dist', 'server.mjs');
const FRONTEND_DIST = path.join(RES, 'frontend', 'dist');
const SERVER_LAUNCH_CJS = app.isPackaged
  ? path.join(RES, 'server-launch.cjs')
  : path.join(__dirname, '..', 'server-launch.cjs');
const PRELOAD = path.join(__dirname, 'preload.js');

let win: BrowserWindow | null = null;

const host = new ServerHost({
  serverLaunchCjs: SERVER_LAUNCH_CJS,
  serverMjs: SERVER_MJS,
  frontendDist: FRONTEND_DIST,
  // After an in-SPA (exit-75) switch the server is back on the same port with new
  // content — navigate the window to it afresh (guarded; never on a dead window).
  onSwitched: () => void safeLoad(host.url),
});

/**
 * Navigate the window, tolerating the benign ERR_ABORTED that Electron raises
 * when a newer navigation supersedes an in-flight one (e.g. splash → app, or a
 * rapid project switch). Anything else propagates.
 */
async function safeLoad(url: string): Promise<void> {
  if (!win || win.isDestroyed()) return;
  try {
    await win.loadURL(url);
  } catch (err) {
    if ((err as { code?: string })?.code !== 'ERR_ABORTED') throw err;
  }
}

const LOADING_HTML =
  'data:text/html,' +
  encodeURIComponent(`<!doctype html><meta charset="utf-8">
    <title>Smart Data Dictionary</title>
    <style>
      html,body{height:100%;margin:0;font-family:system-ui,sans-serif;
        display:flex;align-items:center;justify-content:center;
        background:#1d232a;color:#a6adbb}
      .box{text-align:center}
      .spin{width:34px;height:34px;margin:0 auto 16px;border:3px solid #3b4450;
        border-top-color:#7dd3fc;border-radius:50%;animation:r .8s linear infinite}
      @keyframes r{to{transform:rotate(360deg)}}
    </style>
    <div class="box"><div class="spin"></div>Starting Smart Data Dictionary…</div>`);

/** Native folder picker → scaffold if needed → persist → respawn the server. */
async function openFolder(): Promise<void> {
  if (!win) return;
  const result = await dialog.showOpenDialog(win, {
    title: 'Open Data Dictionary Project',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (result.canceled || !result.filePaths[0]) return;

  const dir = result.filePaths[0];
  // A fresh / empty folder becomes a new project; an existing one is left as-is.
  if (!isDicoProject(dir)) scaffoldProject(dir, sampleRoot(RES));
  writeActiveProject(dir);
  await safeLoad(LOADING_HTML);
  await host.switchTo(dir);
  await safeLoad(host.url);
}

async function bootstrap(): Promise<void> {
  const port = await ServerHost.freePort();

  win = new BrowserWindow({
    width: 1400,
    height: 900,
    backgroundColor: '#1d232a',
    webPreferences: { preload: PRELOAD, contextIsolation: true },
  });
  Menu.setApplicationMenu(buildMenu({ onOpenFolder: () => void openFolder(), repoUrl: REPO_URL }));
  await safeLoad(LOADING_HTML); // simple loading state until ready

  try {
    await host.start(port, resolveInitialDataDir(RES));
    await safeLoad(host.url);
  } catch (err) {
    console.error('[main] server failed to start:', err);
    await safeLoad(
      'data:text/html,' +
        encodeURIComponent(`<pre style="padding:24px;color:#f87171;font-family:monospace">Server failed to start:\n${String(err)}</pre>`),
    );
  }
}

ipcMain.handle('app:getVersion', () => app.getVersion());
ipcMain.handle('app:openFolder', () => openFolder());

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(bootstrap);

  app.on('window-all-closed', () => app.quit());

  app.on('before-quit', () => host.dispose());
}
