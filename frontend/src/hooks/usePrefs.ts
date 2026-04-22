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
 * Hook version — used in components. Re-renders on change.
 *
 * The hook intentionally stays small; there's no Redux or context
 * involved. localStorage is the shared store across all consumers,
 * and a `storage` event listener keeps tabs in sync.
 */
export function usePrefs(): PrefsApi {
  const [theme, setThemeState]     = useState<Theme>(readTheme);
  const [variant, setVariantState] = useState<Variant>(readVariant);
  const [density, setDensityState] = useState<Density>(readDensity);

  // Apply on mount + whenever values change. A MutationObserver also
  // re-applies if something else (e.g. the @hamak shell plugin's
  // 'system'-mode theme sync) clobbers our attributes after first
  // render — the previous useTheme hook did the same thing.
  useEffect(() => {
    applyAttributes(theme, variant, density);
    const el = document.documentElement;
    const observer = new MutationObserver(() => {
      if (
        el.getAttribute('data-theme') !== theme ||
        el.getAttribute('data-variant') !== variant ||
        el.getAttribute('data-density') !== density
      ) {
        applyAttributes(theme, variant, density);
      }
    });
    observer.observe(el, {
      attributes: true,
      attributeFilter: ['data-theme', 'data-variant', 'data-density'],
    });
    return () => observer.disconnect();
  }, [theme, variant, density]);

  // Cross-tab sync via the storage event
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
  }, []);

  const setVariant = useCallback((v: Variant) => {
    window.localStorage.setItem(KEY_VARIANT, v);
    setVariantState(v);
  }, []);

  const setDensity = useCallback((d: Density) => {
    window.localStorage.setItem(KEY_DENSITY, d);
    setDensityState(d);
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState(prev => {
      const next = prev === 'dark' ? 'light' : 'dark';
      window.localStorage.setItem(KEY_THEME, next);
      return next;
    });
  }, []);

  return { theme, variant, density, setTheme, setVariant, setDensity, toggleTheme };
}
