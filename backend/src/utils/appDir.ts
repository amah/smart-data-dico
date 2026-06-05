/**
 * Application directory management
 *
 * All app-level config and storage lives under ~/.dico-app/
 *
 * Structure:
 *   ~/.dico-app/
 *   ├── dico-app.json                  # App config (AI settings, preferences) — written with mode 0600
 *   └── storage/
 *       ├── conversations/             # AI chat history (JSON files)
 *       │   ├── {uuid}.json
 *       │   └── ...
 *       └── prompts/                   # Saved AI prompts (JSON files, #123)
 *           ├── {uuid}.json
 *           └── ...
 *
 * Future: conversations may migrate to SQLite for better querying
 * at scale. The JSON-file approach works well for <1000 conversations.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { logger } from './logger.js';

export const APP_DIR = path.join(os.homedir(), '.dico-app');
export const CONFIG_FILE = path.join(APP_DIR, 'dico-app.json');
// Handoff file for managed project switching: the server writes the target
// project dir here and exits with the restart sentinel; bin/cli.js reads it
// and respawns the server with DATA_DIR set to it. (#open-project)
export const ACTIVE_PROJECT_FILE = path.join(APP_DIR, 'active-project');
export const STORAGE_DIR = path.join(APP_DIR, 'storage');
export const CONVERSATIONS_DIR = path.join(STORAGE_DIR, 'conversations');
export const PROMPTS_DIR = path.join(STORAGE_DIR, 'prompts');

// Legacy path (for migration)
const LEGACY_CONFIG = path.join(os.homedir(), '.cfg', 'ai-config.json');

// Track whether we've already warned about loose perms this process
let loosePermsWarned = false;

/**
 * Ensure the app directory structure exists.
 */
export function ensureAppDir(): void {
  for (const dir of [APP_DIR, STORAGE_DIR, CONVERSATIONS_DIR, PROMPTS_DIR]) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}

/**
 * Backfill restrictive permissions (0600) if the config file exists with looser perms.
 * Logs a warning once per process. Skipped on Windows (where mode bits are meaningless).
 */
function ensureRestrictivePerms(file: string): void {
  if (process.platform === 'win32') return;
  try {
    const mode = fs.statSync(file).mode & 0o777;
    if (mode !== 0o600) {
      fs.chmodSync(file, 0o600);
      if (!loosePermsWarned) {
        loosePermsWarned = true;
        logger.warn(
          `Config file ${file} had loose permissions (0${mode.toString(8)}); reset to 0600.`,
        );
      }
    }
  } catch {
    // best-effort; ignore stat/chmod failures
  }
}

/**
 * Write data to the config file atomically with mode 0600.
 * Uses temp-file + rename so partial writes can't leave a world-readable file behind.
 */
function writeConfigFileAtomic(data: string): void {
  const tmp = `${CONFIG_FILE}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, data, { mode: 0o600 });
  fs.renameSync(tmp, CONFIG_FILE);
  // rename preserves the temp file's mode, but chmod again defensively
  // in case a pre-existing target file's perms were inherited on some FS.
  if (process.platform !== 'win32') {
    try { fs.chmodSync(CONFIG_FILE, 0o600); } catch { /* best-effort */ }
  }
}

/**
 * Read the app config. Migrates from legacy path if needed.
 */
export function readAppConfig(): Record<string, any> {
  ensureAppDir();

  // Migrate from legacy ~/.cfg/ai-config.json
  if (!fs.existsSync(CONFIG_FILE) && fs.existsSync(LEGACY_CONFIG)) {
    try {
      const legacy = JSON.parse(fs.readFileSync(LEGACY_CONFIG, 'utf8'));
      const config = { ai: legacy };
      writeConfigFileAtomic(JSON.stringify(config, null, 2));
      // Don't delete legacy — user might have other tools using it
      return config;
    } catch {
      // Ignore migration errors
    }
  }

  try {
    if (fs.existsSync(CONFIG_FILE)) {
      ensureRestrictivePerms(CONFIG_FILE);
      return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    }
  } catch {
    // Corrupt config, start fresh
  }
  return {};
}

/**
 * Write the app config (merges with existing). Always written with mode 0600.
 */
export function writeAppConfig(updates: Record<string, any>): void {
  ensureAppDir();
  const existing = readAppConfig();
  const merged = { ...existing, ...updates };
  writeConfigFileAtomic(JSON.stringify(merged, null, 2));
}

/**
 * Read a specific config section.
 */
export function getConfigSection<T = any>(section: string): T | undefined {
  const config = readAppConfig();
  return config[section];
}

/**
 * Write a specific config section.
 */
export function setConfigSection(section: string, value: any): void {
  writeAppConfig({ [section]: value });
}
