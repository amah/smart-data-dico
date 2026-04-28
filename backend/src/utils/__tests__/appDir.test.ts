/**
 * Tests for ~/.dico-app config-file permissions hardening (#125).
 *
 * The config holds the AI provider API key. We always want it written with
 * mode 0600 so a stray rsync / dotfile sync / accidental git add can't leak
 * it to other accounts on the same host.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

jest.mock('../logger');

// Helper to (re)load the appDir module fresh against the current homedir mock.
// The module captures `os.homedir()` at evaluation time, so we must reset
// modules between tests to pick up a new tmp home.
function loadAppDir(): typeof import('../appDir') {
  let mod: typeof import('../appDir') | undefined;
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    mod = require('../appDir');
  });
  return mod!;
}

describe('appDir — config file is written with mode 0600 (#125)', () => {
  let tmpHome: string;
  let homedirSpy: jest.SpyInstance;

  beforeEach(() => {
    // Redirect ~ to a fresh temp dir per test so we never touch the real ~/.dico-app
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'dico-appdir-test-'));
    homedirSpy = jest.spyOn(os, 'homedir').mockReturnValue(tmpHome);
  });

  afterEach(() => {
    homedirSpy.mockRestore();
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  // mode bits are meaningless on Windows
  const isWin = process.platform === 'win32';
  const maybe = isWin ? it.skip : it;

  maybe('setConfigSection writes dico-app.json with mode 0600', () => {
    const { setConfigSection, CONFIG_FILE } = loadAppDir();
    setConfigSection('ai', { provider: 'anthropic', apiKey: 'sk-test-secret' });

    expect(fs.existsSync(CONFIG_FILE)).toBe(true);
    const mode = fs.statSync(CONFIG_FILE).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  maybe('writeAppConfig preserves mode 0600 across updates', () => {
    const { writeAppConfig, CONFIG_FILE } = loadAppDir();
    writeAppConfig({ ai: { provider: 'anthropic', apiKey: 'k1' } });
    writeAppConfig({ ai: { provider: 'openai', apiKey: 'k2' } });

    const mode = fs.statSync(CONFIG_FILE).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  maybe('readAppConfig backfills 0600 when an existing file is world-readable', () => {
    const mod = loadAppDir();
    // Pre-create the file with looser perms (0644) to simulate a pre-#125 install
    mod.ensureAppDir();
    fs.writeFileSync(mod.CONFIG_FILE, JSON.stringify({ ai: { apiKey: 'leaky' } }), { mode: 0o644 });
    expect(fs.statSync(mod.CONFIG_FILE).mode & 0o777).toBe(0o644);

    const data = mod.readAppConfig();
    expect(data.ai.apiKey).toBe('leaky');
    expect(fs.statSync(mod.CONFIG_FILE).mode & 0o777).toBe(0o600);
  });
});
