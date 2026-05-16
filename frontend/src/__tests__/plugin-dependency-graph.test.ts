/**
 * #159 — Plugin dependency-graph smoke test.
 *
 * Three responsibilities:
 *   1. Every name in any plugin's `dependsOn` array resolves to a registered
 *      plugin (no orphan / stale strings, e.g. the 'remote-git' → 'git' rename).
 *   2. Every DI token that a plugin's `initialize` or `activate` actually
 *      resolves is resolvable on `host.rootActivationCtx` after a full
 *      `bootstrapApplication()`. Each token gets its own `it` block so
 *      failures point at the exact provider.
 *   3. Negative: union of all `dependsOn` names maps to registered plugins
 *      (redundant with #1 but stated explicitly per spec so future grep finds it).
 *
 * Bootstrap pattern: mirrors `searchPlugin.search.test.ts` and
 * `dataDictionaryPlugin.integrity.test.ts` — one `beforeAll` that calls the
 * production `bootstrapApplication()` singleton, then assertions on
 * `host.rootActivationCtx.resolve(TOKEN)`.
 *
 * Isolation: `bootstrapApplication()` is idempotent (singleton guard at
 * bootstrap.ts:43). Each Vitest file runs in its own fork (`singleFork: false`
 * in vite.config.ts), so the module-level `host` is private to this worker.
 */

import { describe, it, expect, beforeAll } from 'vitest';

import { bootstrapApplication, host } from '../kernel/bootstrap';
import {
  STORE_FS_TOKEN,
  STEREOTYPE_SERVICE_TOKEN,
  INTEGRITY_SERVICE_TOKEN,
  DIFF_SERVICE_TOKEN,
  IMPORT_EXPORT_SERVICE_TOKEN,
  GIT_SERVICE_TOKEN,
  PUBLISH_SERVICE_TOKEN,
  CASE_SERVICE_TOKEN,
  RULE_SERVICE_TOKEN,
  SEARCH_SERVICE_TOKEN,
  AI_SERVICE_TOKEN,
  AUTH_SERVICE_TOKEN,
} from '../kernel/tokens';
import {
  STORE_MANAGER_TOKEN,
  REDUCER_REGISTRY_TOKEN,
  STORE_EXTENSIONS_TOKEN,
  MIDDLEWARE_REGISTRY_TOKEN,
  AUTOSAVE_REGISTRY_TOKEN,
} from '@hamak/ui-store-api';
import {
  PATH_TRANSLATOR_TOKEN,
  WORKSPACE_CLIENT_TOKEN,
} from '@hamak/ui-remote-fs';
import {
  GIT_CLIENT_TOKEN,
  GIT_PATH_TRANSLATOR_TOKEN,
} from '@hamak/ui-remote-git-fs';
import {
  SHELL_TOKEN,
  THEME_MANAGER_TOKEN,
  FEATURE_MANAGER_TOKEN,
  LAYOUT_MANAGER_TOKEN,
} from '@hamak/ui-shell';
import { LOG_MANAGER_TOKEN, LOG_CONFIG_TOKEN, LOGGER_TOKEN } from '@hamak/logging/api';
import { NOTIFICATION_SERVICE_TOKEN } from '@hamak/notification/api';

beforeAll(async () => {
  await bootstrapApplication();
});

// ---------------------------------------------------------------------------
// 1. Declared dependsOn names resolve to registered plugin names (no orphans)
// ---------------------------------------------------------------------------

describe('plugin manifests — declared dependencies resolve to registered plugins', () => {
  it('every dependsOn name in every plugin manifest refers to a registered plugin', () => {
    const manifests = host.listPlugins();
    const registeredNames = new Set(manifests.map((m) => m.name));

    for (const manifest of manifests) {
      for (const dep of manifest.dependsOn ?? []) {
        expect(
          registeredNames.has(dep),
          `Plugin '${manifest.name}' declares dependsOn: '${dep}' but no plugin with that name is registered`
        ).toBe(true);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Per-plugin: actual DI token resolves succeed on the bootstrapped host
// ---------------------------------------------------------------------------

describe("plugin DI tokens — each plugin's actual resolves succeed", () => {
  // ── store ────────────────────────────────────────────────────────────────

  it('store → STORE_MANAGER_TOKEN is non-null', () => {
    const ctx = host.rootActivationCtx!;
    const value = ctx.resolve(STORE_MANAGER_TOKEN);
    expect(value).toBeTruthy();
  });

  it('store → REDUCER_REGISTRY_TOKEN is non-null', () => {
    const ctx = host.rootActivationCtx!;
    const value = ctx.resolve(REDUCER_REGISTRY_TOKEN);
    expect(value).toBeTruthy();
  });

  it('store → STORE_EXTENSIONS_TOKEN is non-null', () => {
    const ctx = host.rootActivationCtx!;
    const value = ctx.resolve(STORE_EXTENSIONS_TOKEN);
    expect(value).toBeTruthy();
  });

  it('store → MIDDLEWARE_REGISTRY_TOKEN is non-null', () => {
    const ctx = host.rootActivationCtx!;
    const value = ctx.resolve(MIDDLEWARE_REGISTRY_TOKEN);
    expect(value).toBeTruthy();
  });

  // ── remote-fs ────────────────────────────────────────────────────────────

  it('remote-fs → PATH_TRANSLATOR_TOKEN is non-null', () => {
    const ctx = host.rootActivationCtx!;
    const value = ctx.resolve(PATH_TRANSLATOR_TOKEN);
    expect(value).toBeTruthy();
  });

  it('remote-fs → WORKSPACE_CLIENT_TOKEN is non-null', () => {
    const ctx = host.rootActivationCtx!;
    const value = ctx.resolve(WORKSPACE_CLIENT_TOKEN);
    expect(value).toBeTruthy();
  });

  // ── store-fs ─────────────────────────────────────────────────────────────

  it('store-fs → STORE_FS_TOKEN (lazy Proxy) is non-null', () => {
    const ctx = host.rootActivationCtx!;
    const value = ctx.resolve(STORE_FS_TOKEN);
    expect(value).toBeTruthy();
  });

  it('store-fs → AUTOSAVE_REGISTRY_TOKEN is non-null', () => {
    const ctx = host.rootActivationCtx!;
    const value = ctx.resolve(AUTOSAVE_REGISTRY_TOKEN);
    expect(value).toBeTruthy();
  });

  // ── git ──────────────────────────────────────────────────────────────────

  it('git → GIT_CLIENT_TOKEN (framework) is non-null', () => {
    const ctx = host.rootActivationCtx!;
    const value = ctx.resolve(GIT_CLIENT_TOKEN);
    expect(value).toBeTruthy();
  });

  it('git → GIT_PATH_TRANSLATOR_TOKEN (framework) is non-null', () => {
    const ctx = host.rootActivationCtx!;
    const value = ctx.resolve(GIT_PATH_TRANSLATOR_TOKEN);
    expect(value).toBeTruthy();
  });

  it('git → GIT_SERVICE_TOKEN (ours) is non-null', () => {
    const ctx = host.rootActivationCtx!;
    const value = ctx.resolve(GIT_SERVICE_TOKEN);
    expect(value).toBeTruthy();
  });

  // ── shell ─────────────────────────────────────────────────────────────────

  it('shell → SHELL_TOKEN is non-null', () => {
    const ctx = host.rootActivationCtx!;
    const value = ctx.resolve(SHELL_TOKEN);
    expect(value).toBeTruthy();
  });

  it('shell → THEME_MANAGER_TOKEN is non-null', () => {
    const ctx = host.rootActivationCtx!;
    const value = ctx.resolve(THEME_MANAGER_TOKEN);
    expect(value).toBeTruthy();
  });

  it('shell → FEATURE_MANAGER_TOKEN is non-null', () => {
    const ctx = host.rootActivationCtx!;
    const value = ctx.resolve(FEATURE_MANAGER_TOKEN);
    expect(value).toBeTruthy();
  });

  it('shell → LAYOUT_MANAGER_TOKEN is non-null', () => {
    const ctx = host.rootActivationCtx!;
    const value = ctx.resolve(LAYOUT_MANAGER_TOKEN);
    expect(value).toBeTruthy();
  });

  // ── auth ──────────────────────────────────────────────────────────────────

  it('auth → AUTH_SERVICE_TOKEN is non-null', () => {
    const ctx = host.rootActivationCtx!;
    const value = ctx.resolve(AUTH_SERVICE_TOKEN);
    expect(value).toBeTruthy();
  });

  // ── data-dictionary ───────────────────────────────────────────────────────

  it('data-dictionary → STEREOTYPE_SERVICE_TOKEN is non-null', () => {
    const ctx = host.rootActivationCtx!;
    const value = ctx.resolve(STEREOTYPE_SERVICE_TOKEN);
    expect(value).toBeTruthy();
  });

  it('data-dictionary → INTEGRITY_SERVICE_TOKEN is non-null', () => {
    const ctx = host.rootActivationCtx!;
    const value = ctx.resolve(INTEGRITY_SERVICE_TOKEN);
    expect(value).toBeTruthy();
  });

  it('data-dictionary → DIFF_SERVICE_TOKEN is non-null', () => {
    const ctx = host.rootActivationCtx!;
    const value = ctx.resolve(DIFF_SERVICE_TOKEN);
    expect(value).toBeTruthy();
  });

  it('data-dictionary → IMPORT_EXPORT_SERVICE_TOKEN is non-null', () => {
    const ctx = host.rootActivationCtx!;
    const value = ctx.resolve(IMPORT_EXPORT_SERVICE_TOKEN);
    expect(value).toBeTruthy();
  });

  it('data-dictionary → CASE_SERVICE_TOKEN is non-null', () => {
    const ctx = host.rootActivationCtx!;
    const value = ctx.resolve(CASE_SERVICE_TOKEN);
    expect(value).toBeTruthy();
  });

  it('data-dictionary → RULE_SERVICE_TOKEN is non-null', () => {
    const ctx = host.rootActivationCtx!;
    const value = ctx.resolve(RULE_SERVICE_TOKEN);
    expect(value).toBeTruthy();
  });

  it('data-dictionary → PUBLISH_SERVICE_TOKEN is non-null', () => {
    const ctx = host.rootActivationCtx!;
    const value = ctx.resolve(PUBLISH_SERVICE_TOKEN);
    expect(value).toBeTruthy();
  });

  // ── search ────────────────────────────────────────────────────────────────

  it('search → SEARCH_SERVICE_TOKEN is non-null', () => {
    const ctx = host.rootActivationCtx!;
    const value = ctx.resolve(SEARCH_SERVICE_TOKEN);
    expect(value).toBeTruthy();
  });

  // ── ai-assistance ─────────────────────────────────────────────────────────

  it('ai-assistance → AI_SERVICE_TOKEN is non-null', () => {
    const ctx = host.rootActivationCtx!;
    const value = ctx.resolve(AI_SERVICE_TOKEN);
    expect(value).toBeTruthy();
  });

  // ── logging ───────────────────────────────────────────────────────────────

  it('logging → LOG_MANAGER_TOKEN is non-null', () => {
    const ctx = host.rootActivationCtx!;
    const value = ctx.resolve(LOG_MANAGER_TOKEN);
    expect(value).toBeTruthy();
  });

  it('logging → LOG_CONFIG_TOKEN is non-null', () => {
    const ctx = host.rootActivationCtx!;
    const value = ctx.resolve(LOG_CONFIG_TOKEN);
    expect(value).toBeTruthy();
  });

  it('logging → LOGGER_TOKEN is non-null', () => {
    const ctx = host.rootActivationCtx!;
    const value = ctx.resolve(LOGGER_TOKEN);
    expect(value).toBeTruthy();
  });

  // ── notification ──────────────────────────────────────────────────────────

  it('notification → NOTIFICATION_SERVICE_TOKEN is non-null', () => {
    const ctx = host.rootActivationCtx!;
    const value = ctx.resolve(NOTIFICATION_SERVICE_TOKEN);
    expect(value).toBeTruthy();
  });

  // ── singleton identity checks (spot) ─────────────────────────────────────

  it('STORE_MANAGER_TOKEN resolves to the same singleton on repeated calls', () => {
    const ctx = host.rootActivationCtx!;
    expect(ctx.resolve(STORE_MANAGER_TOKEN)).toBe(ctx.resolve(STORE_MANAGER_TOKEN));
  });

  it('SEARCH_SERVICE_TOKEN resolves to the same singleton on repeated calls', () => {
    const ctx = host.rootActivationCtx!;
    expect(ctx.resolve(SEARCH_SERVICE_TOKEN)).toBe(ctx.resolve(SEARCH_SERVICE_TOKEN));
  });
});

// ---------------------------------------------------------------------------
// 3. Negative — no plugin lists a dependency name that isn't registered
// ---------------------------------------------------------------------------

describe('plugin manifests — no orphan dependency names', () => {
  it('union of all dependsOn names is a subset of registered plugin names', () => {
    const manifests = host.listPlugins();
    const registeredNames = new Set(manifests.map((m) => m.name));

    // Collect all unique dependency names across all plugins
    const allDeclaredDeps = new Set(
      manifests.flatMap((m) => m.dependsOn ?? [])
    );

    for (const dep of allDeclaredDeps) {
      expect(
        registeredNames.has(dep),
        `dependsOn name '${dep}' is declared by some plugin but has no matching registration`
      ).toBe(true);
    }
  });

  it('host.getPlugin() returns a manifest for every plugin registered by bootstrapApplication()', () => {
    const expectedPlugins = [
      'store', 'shell', 'auth', 'data-dictionary', 'visualization',
      'search', 'remote-fs', 'store-fs', 'git', 'logging', 'notification',
      'ai-assistance',
    ];
    for (const name of expectedPlugins) {
      expect(
        host.getPlugin(name),
        `Expected plugin '${name}' to be registered but host.getPlugin('${name}') returned undefined`
      ).toBeDefined();
    }
  });
});
