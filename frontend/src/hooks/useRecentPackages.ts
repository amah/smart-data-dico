import { useEffect } from 'react';

const STORAGE_KEY = 'sdd.recentPackages';
const MAX_RECENT = 5;

export function getRecentPackages(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function useRecordRecentPackage(name: string | undefined) {
  useEffect(() => {
    if (!name) return;
    try {
      const current = getRecentPackages().filter(p => p !== name);
      const next = [name, ...current].slice(0, MAX_RECENT);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch { /* ignore */ }
  }, [name]);
}
