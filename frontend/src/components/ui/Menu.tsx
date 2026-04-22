/**
 * Menu — simple popover primitive for dropdowns (ColumnChooser,
 * view-options kebab, …). Click-outside to close. Keyboard: Escape.
 *
 * Kept deliberately small; a richer menu with keyboard navigation
 * lands later when we actually need it.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';

export interface MenuProps {
  /** Button that opens the menu. Receives `open` + `toggle`. */
  trigger: (api: { open: boolean; toggle: () => void }) => ReactNode;
  /** Menu body. Called lazily when open. */
  children: ReactNode | ((api: { close: () => void }) => ReactNode);
  align?: 'start' | 'end';
  width?: number;
  className?: string;
}

const Menu = ({ trigger, children, align = 'start', width = 240, className = '' }: MenuProps) => {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  const body = typeof children === 'function'
    ? children({ close: () => setOpen(false) })
    : children;

  return (
    <div ref={rootRef} className={`relative inline-block ${className}`}>
      {trigger({ open, toggle: () => setOpen(v => !v) })}
      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            [align === 'end' ? 'right' : 'left']: 0,
            width,
            background: 'var(--bg-raised)',
            border: '1px solid var(--border-strong)',
            borderRadius: 'var(--radius-md)',
            boxShadow: 'var(--shadow-md)',
            padding: 4,
            zIndex: 50,
          }}
          role="menu"
        >
          {body}
        </div>
      )}
    </div>
  );
};

export default Menu;
