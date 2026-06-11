/**
 * useStoredState — useState backed by localStorage.
 *
 * For sticky UI choices that should survive navigation and reload
 * (description expanded, package view mode, …) without being shell
 * preferences (those live in usePrefs and rebind <html> attributes).
 *
 * The component owning the state typically remounts on navigation,
 * so the lazy initializer re-reads localStorage each time; instances
 * mounted simultaneously under the same key stay in sync via the
 * module-level subscriber set (same scheme as usePrefs), and other
 * tabs via the `storage` event.
 */

import { useCallback, useEffect, useState } from 'react';

const subscribersByKey = new Map<string, Set<() => void>>();

function broadcast(key: string): void {
  subscribersByKey.get(key)?.forEach(fn => fn());
}

export function useStoredState<T extends string>(
  key: string,
  defaultValue: T,
  isValid: (raw: string) => raw is T,
): [T, (next: T) => void] {
  const read = useCallback((): T => {
    if (typeof window === 'undefined') return defaultValue;
    try {
      const saved = window.localStorage.getItem(key);
      if (saved !== null && isValid(saved)) return saved;
    } catch { /* ignore */ }
    return defaultValue;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const [value, setValueState] = useState<T>(read);

  useEffect(() => {
    const onUpdate = () => setValueState(read());
    let set = subscribersByKey.get(key);
    if (!set) {
      set = new Set();
      subscribersByKey.set(key, set);
    }
    set.add(onUpdate);

    const onStorage = (e: StorageEvent) => {
      if (e.key === key) setValueState(read());
    };
    window.addEventListener('storage', onStorage);
    return () => {
      set!.delete(onUpdate);
      window.removeEventListener('storage', onStorage);
    };
  }, [key, read]);

  const setValue = useCallback((next: T) => {
    try {
      window.localStorage.setItem(key, next);
    } catch { /* ignore */ }
    setValueState(next);
    broadcast(key);
  }, [key]);

  return [value, setValue];
}
