/**
 * Application directory management
 *
 * All app-level config and storage lives under ~/.dico-app/
 *
 * Structure:
 *   ~/.dico-app/
 *   ├── dico-app.json                  # App config (AI settings, preferences)
 *   └── storage/
 *       └── conversations/             # AI chat history (JSON files)
 *           ├── {uuid}.json
 *           └── ...
 *
 * Future: conversations may migrate to SQLite for better querying
 * at scale. The JSON-file approach works well for <1000 conversations.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

export const APP_DIR = path.join(os.homedir(), '.dico-app');
export const CONFIG_FILE = path.join(APP_DIR, 'dico-app.json');
export const STORAGE_DIR = path.join(APP_DIR, 'storage');
export const CONVERSATIONS_DIR = path.join(STORAGE_DIR, 'conversations');

// Legacy path (for migration)
const LEGACY_CONFIG = path.join(os.homedir(), '.cfg', 'ai-config.json');

/**
 * Ensure the app directory structure exists.
 */
export function ensureAppDir(): void {
  for (const dir of [APP_DIR, STORAGE_DIR, CONVERSATIONS_DIR]) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
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
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
      // Don't delete legacy — user might have other tools using it
      return config;
    } catch {
      // Ignore migration errors
    }
  }

  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    }
  } catch {
    // Corrupt config, start fresh
  }
  return {};
}

/**
 * Write the app config (merges with existing).
 */
export function writeAppConfig(updates: Record<string, any>): void {
  ensureAppDir();
  const existing = readAppConfig();
  const merged = { ...existing, ...updates };
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(merged, null, 2), 'utf8');
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
