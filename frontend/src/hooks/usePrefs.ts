/**
 * usePrefs — persistent shell preferences (theme, density, variant).
 *
 * The hook is the single source of truth for:
 *   - data-theme  on <html>  (light / dark)
 *   - data-variant on <html> (calm — only option today; bold + mono later)
 *   - data-density on <html> (rebinds --row-height via tokens.css rules)
 *
 * Values are persisted to localStorage under individual keys so the
 * inline boot script in index.html can hydrate the theme before React
 * mounts (avoids FOUC). Density + variant hydrate on first render.
 *
 * The existing single-key 'theme' is kept for back-compat with
 * pre-Phase-1 code; density + variant use their own keys.
 */

import { useCallback, useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';
export type Variant = 'calm' | 'bold';
export type Density = 'comfortable' | 'compact' | 'dense';

const KEY_THEME   = 'theme';
const KEY_VARIANT = 'sdd-variant';
const KEY_DENSITY = 'sdd-density';

const DEFAULTS = {
  theme: 'light' as Theme,
  variant: 'calm' as Variant,
  density: 'comfortable' as Density,
};

function readTheme(): Theme {
  if (typeof window === 'undefined') return DEFAULTS.theme;
  const saved = window.localStorage.getItem(KEY_THEME);
  if (saved === 'light' || saved === 'dark') return saved;
  const attr = document.documentElement.getAttribute('data-theme');
  if (attr === 'light' || attr === 'dark') return attr;
  if (window.matchMedia?.('(prefers-color-scheme: dark)').matches) return 'dark';
  return DEFAULTS.theme;
}

function readVariant(): Variant {
  if (typeof window === 'undefined') return DEFAULTS.variant;
  const saved = window.localStorage.getItem(KEY_VARIANT);
  if (saved === 'calm' || saved === 'bold') return saved;
  return DEFAULTS.variant;
}

function readDensity(): Density {
  if (typeof window === 'undefined') return DEFAULTS.density;
  const saved = window.localStorage.getItem(KEY_DENSITY);
  if (saved === 'comfortable' || saved === 'compact' || saved === 'dense') return saved;
  return DEFAULTS.density;
}

/**
 * Apply all three attributes to <html>. Call this once on hydration
 * and whenever a value changes; the MutationObserver in useTheme-
 * style code elsewhere will leave these alone.
 */
function applyAttributes(theme: Theme, variant: Variant, density: Density) {
  const el = document.documentElement;
  if (el.getAttribute('data-theme') !== theme) el.setAttribute('data-theme', theme);
  if (el.getAttribute('data-variant') !== variant) el.setAttribute('data-variant', variant);
  if (el.getAttribute('data-density') !== density) el.setAttribute('data-density', density);
}

export interface PrefsApi {
  theme: Theme;
  variant: Variant;
  density: Density;
  setTheme: (t: Theme) => void;
  setVariant: (v: Variant) => void;
  setDensity: (d: Density) => void;
  toggleTheme: () => void;
}

/**
 * Module-level pub-sub.
 *
 * Every `usePrefs()` call mounts a fresh React component with its own
 * `useState`. Without coordination, multiple consumers (Navbar +
 * AIChatPanel + DesignSystemPage) end up with independent React
 * states; when Navbar's `setTheme('dark')` flips `data-theme` on
 * <html>, the other consumers still hold `theme: 'light'` in their
 * closure. Pre-fix, those consumers had their own MutationObserver
 * which fought back to "correct" the attribute, producing an
 * infinite ping-pong loop that froze the tab.
 *
 * Now: setters notify ALL subscribers, so every instance re-reads
 * localStorage and re-renders with the new value in lock-step.
 */
const subscribers = new Set<() => void>();

function broadcast(): void {
  subscribers.forEach(fn => fn());
}

/**
 * Hook version — used in components. Re-renders on change.
 *
 * Multiple `usePrefs()` consumers stay in sync via the module-level
 * `subscribers` set. localStorage is the durable source of truth;
 * React state is a per-instance cache. Cross-tab sync still works
 * via the `storage` event (only fires in OTHER windows).
 */
export function usePrefs(): PrefsApi {
  const [theme, setThemeState]     = useState<Theme>(readTheme);
  const [variant, setVariantState] = useState<Variant>(readVariant);
  const [density, setDensityState] = useState<Density>(readDensity);

  // Apply attribute on every change to this instance's state. Other
  // instances learn about the change through the subscriber broadcast,
  // not through a MutationObserver — see comment on `subscribers`.
  useEffect(() => {
    applyAttributes(theme, variant, density);
  }, [theme, variant, density]);

  // Subscribe to cross-instance updates. Any other `usePrefs()`'s
  // setter calls `broadcast()`, which fires `onUpdate` here; we
  // re-read from localStorage and bring this instance's state into
  // line. No-op if the read values match current state.
  useEffect(() => {
    const onUpdate = () => {
      setThemeState(readTheme());
      setVariantState(readVariant());
      setDensityState(readDensity());
    };
    subscribers.add(onUpdate);
    return () => { subscribers.delete(onUpdate); };
  }, []);

  // Cross-tab sync via the storage event (only fires in OTHER tabs).
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY_THEME)   setThemeState(readTheme());
      if (e.key === KEY_VARIANT) setVariantState(readVariant());
      if (e.key === KEY_DENSITY) setDensityState(readDensity());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const setTheme = useCallback((t: Theme) => {
    window.localStorage.setItem(KEY_THEME, t);
    setThemeState(t);
    broadcast();
  }, []);

  const setVariant = useCallback((v: Variant) => {
    window.localStorage.setItem(KEY_VARIANT, v);
    setVariantState(v);
    broadcast();
  }, []);

  const setDensity = useCallback((d: Density) => {
    window.localStorage.setItem(KEY_DENSITY, d);
    setDensityState(d);
    broadcast();
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState(prev => {
      const next = prev === 'dark' ? 'light' : 'dark';
      window.localStorage.setItem(KEY_THEME, next);
      // Defer the broadcast until after this functional updater commits
      // its own state — otherwise other subscribers may read localStorage
      // before this instance has settled, which is fine here but a habit
      // worth keeping for any subsequent dependent setters.
      queueMicrotask(broadcast);
      return next;
    });
  }, []);

  return { theme, variant, density, setTheme, setVariant, setDensity, toggleTheme };
}
