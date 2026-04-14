import { useCallback, useEffect, useState } from 'react';

const STORAGE_PREFIX = 'sdd.sticky.';

export function useStickyTablePref(tableKey: string, defaultValue = true): [boolean, () => void] {
  const storageKey = STORAGE_PREFIX + tableKey;
  const [pinned, setPinned] = useState<boolean>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      return raw === null ? defaultValue : raw === '1';
    } catch {
      return defaultValue;
    }
  });

  useEffect(() => {
    try { localStorage.setItem(storageKey, pinned ? '1' : '0'); } catch { /* ignore */ }
  }, [storageKey, pinned]);

  const toggle = useCallback(() => setPinned(p => !p), []);
  return [pinned, toggle];
}
