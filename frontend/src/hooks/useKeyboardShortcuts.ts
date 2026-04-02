import { useEffect, useState, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';

const STORAGE_KEY = 'keyboard-shortcuts-enabled';

export interface ShortcutDef {
  key: string;
  label: string;
  context: string;
  action: () => void;
}

export function useKeyboardShortcutsEnabled() {
  const [enabled, setEnabled] = useState(() => {
    return localStorage.getItem(STORAGE_KEY) === 'true';
  });

  const toggle = useCallback((value: boolean) => {
    setEnabled(value);
    localStorage.setItem(STORAGE_KEY, String(value));
  }, []);

  return { enabled, toggle };
}

export function useKeyboardShortcuts(enabled: boolean) {
  const navigate = useNavigate();
  const location = useLocation();
  const [showHelp, setShowHelp] = useState(false);
  const [gPending, setGPending] = useState(false);

  useEffect(() => {
    if (!enabled) return;

    let gTimeout: ReturnType<typeof setTimeout> | null = null;

    const handler = (e: KeyboardEvent) => {
      // Don't fire when typing in inputs
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if ((e.target as HTMLElement)?.isContentEditable) return;

      const key = e.key.toLowerCase();
      const isCmd = e.metaKey || e.ctrlKey;

      // Cmd+S — save (trigger click on visible save/submit button)
      if (isCmd && key === 's') {
        e.preventDefault();
        const saveBtn = document.querySelector<HTMLButtonElement>(
          'button[type="submit"], button:has(.loading-spinner), [class*="btn-primary"]:not(a)'
        );
        if (saveBtn && !saveBtn.disabled) saveBtn.click();
        return;
      }

      // Don't process other shortcuts if modifier keys are held
      if (isCmd || e.altKey) return;

      // ? — help modal
      if (key === '?' || (e.shiftKey && key === '/')) {
        e.preventDefault();
        setShowHelp(prev => !prev);
        return;
      }

      // Escape — close modal / cancel
      if (key === 'escape') {
        setShowHelp(false);
        setGPending(false);
        // Close any open modal
        const modal = document.querySelector<HTMLElement>('.modal-open .btn-ghost, .modal-open [class*="cancel"]');
        if (modal) modal.click();
        return;
      }

      // G prefix for navigation chords
      if (gPending) {
        setGPending(false);
        if (gTimeout) clearTimeout(gTimeout);
        if (key === 'h') { navigate('/'); return; }
        if (key === 'd') { navigate('/diagram'); return; }
        if (key === 'q') { navigate('/quality'); return; }
        return;
      }

      if (key === 'g') {
        setGPending(true);
        gTimeout = setTimeout(() => setGPending(false), 1000);
        return;
      }

      // / — focus search
      if (key === '/') {
        e.preventDefault();
        const searchInput = document.querySelector<HTMLInputElement>('input[placeholder*="Search"]');
        if (searchInput) searchInput.focus();
        return;
      }

      // Context-aware shortcuts based on current page
      const path = location.pathname;

      // N — new entity (on package pages)
      if (key === 'n' && path.startsWith('/packages/') && !path.includes('/entities/')) {
        e.preventDefault();
        const addBtn = document.querySelector<HTMLAnchorElement>('a[href*="/entities/create"]');
        if (addBtn) addBtn.click();
        return;
      }

      // A — add attribute row (on entity detail pages)
      if (key === 'a' && path.includes('/entities/') && !path.includes('/edit') && !path.includes('/attributes/')) {
        e.preventDefault();
        const addRowBtn = Array.from(document.querySelectorAll('button')).find(
          b => b.textContent?.includes('Add Row')
        );
        if (addRowBtn) addRowBtn.click();
        return;
      }

      // E — edit (on entity detail)
      if (key === 'e' && path.includes('/entities/') && !path.includes('/edit')) {
        e.preventDefault();
        const editBtn = document.querySelector<HTMLAnchorElement>('a[href*="/edit"]');
        if (editBtn) editBtn.click();
        return;
      }

      // D — toggle diagram view (on package pages)
      if (key === 'd' && path.startsWith('/packages/') && !path.includes('/entities/')) {
        e.preventDefault();
        const searchParams = new URLSearchParams(window.location.search);
        const isGraph = searchParams.get('view') === 'graph';
        const tab = Array.from(document.querySelectorAll('button')).find(
          b => b.textContent?.trim() === (isGraph ? 'Page View' : 'Diagram View')
        );
        if (tab) tab.click();
        return;
      }
    };

    window.addEventListener('keydown', handler);
    return () => {
      window.removeEventListener('keydown', handler);
      if (gTimeout) clearTimeout(gTimeout);
    };
  }, [enabled, navigate, location.pathname, gPending]);

  return { showHelp, setShowHelp, gPending };
}

export const SHORTCUT_LIST: Array<{ key: string; label: string; context: string }> = [
  { key: '?', label: 'Show/hide this help', context: 'Global' },
  { key: '/', label: 'Focus search bar', context: 'Global' },
  { key: 'Escape', label: 'Cancel / close modal', context: 'Global' },
  { key: 'Cmd+S', label: 'Save / submit', context: 'Any form' },
  { key: 'G then H', label: 'Go to Home', context: 'Global' },
  { key: 'G then D', label: 'Go to Diagram', context: 'Global' },
  { key: 'G then Q', label: 'Go to Quality', context: 'Global' },
  { key: 'N', label: 'New entity', context: 'Package page' },
  { key: 'A', label: 'Add attribute row', context: 'Entity detail' },
  { key: 'E', label: 'Edit entity', context: 'Entity detail' },
  { key: 'D', label: 'Toggle diagram view', context: 'Package page' },
];
