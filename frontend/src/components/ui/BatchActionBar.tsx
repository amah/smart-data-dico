/**
 * BatchActionBar — floating pill that surfaces bulk actions for the
 * currently selected rows. Pairs with DataTable's selection API.
 *
 * Position: fixed at the bottom-center of the viewport so it doesn't
 * compete with the table for horizontal real estate and stays visible
 * when the table scrolls. `z-index: 50` sits above the shell but
 * below modals.
 *
 * The component renders nothing when `count === 0`. Action buttons
 * are passed as plain data so callers stay in charge of labels, icons,
 * and confirm flows.
 */

import { useEffect, type ReactNode } from 'react';
import Button from './Button';
import type { IconName } from './Icon';

export interface BatchAction {
  label: string;
  icon?: IconName;
  onClick: () => void;
  /** 'danger' uses the Button's danger variant. Defaults to secondary. */
  tone?: 'default' | 'danger';
  /** Disable the action — e.g. when the selection mixes types. */
  disabled?: boolean;
  /** Tooltip when disabled. */
  title?: string;
}

export interface BatchActionBarProps {
  count: number;
  actions: BatchAction[];
  onClear: () => void;
  /** Noun used in the count string. Defaults to "selected". */
  label?: string;
  /** Extra content after the actions (e.g. a divider + custom element). */
  trailing?: ReactNode;
}

const BatchActionBar = ({ count, actions, onClear, label = 'selected', trailing }: BatchActionBarProps) => {
  // Esc-to-clear: a common keyboard expectation for any bulk selection
  // mode. Listener is hooked only when the bar is visible so we don't
  // clobber Esc for other surfaces.
  useEffect(() => {
    if (count === 0) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClear();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [count, onClear]);

  if (count === 0) return null;

  return (
    <div
      role="region"
      aria-label="Bulk actions"
      style={{
        position: 'fixed',
        bottom: 24,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 50,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 10px 8px 14px',
        background: 'var(--bg-raised)',
        border: '1px solid var(--border-strong)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--shadow-lg)',
        fontSize: 'var(--fs-sm)',
        color: 'var(--text)',
        animation: 'sddBatchBarSlide var(--dur-med) ease-out',
      }}
    >
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <strong style={{ color: 'var(--accent)' }}>{count}</strong>
        <span style={{ color: 'var(--text-muted)' }}>{label}</span>
      </span>

      <div style={{ width: 1, height: 20, background: 'var(--border)' }} />

      {actions.map(a => (
        <Button
          key={a.label}
          size="sm"
          variant={a.tone === 'danger' ? 'danger' : 'secondary'}
          icon={a.icon}
          disabled={a.disabled}
          title={a.title}
          onClick={a.onClick}
        >
          {a.label}
        </Button>
      ))}

      {trailing}

      <div style={{ width: 1, height: 20, background: 'var(--border)' }} />

      <Button
        size="sm"
        variant="ghost"
        iconOnly
        icon="close"
        title="Clear selection (Esc)"
        aria-label="Clear selection"
        onClick={onClear}
      />
    </div>
  );
};

// Minimal keyframes — piggyback on the design-system motion vars for
// duration. The animation fires on mount, not on every count change,
// because `count === 0` unmounts the component entirely.
const STYLE_ID = 'sdd-batch-bar-keyframes';
if (typeof document !== 'undefined' && !document.getElementById(STYLE_ID)) {
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    @keyframes sddBatchBarSlide {
      from { opacity: 0; transform: translate(-50%, 12px); }
      to   { opacity: 1; transform: translate(-50%, 0); }
    }
  `;
  document.head.appendChild(style);
}

export default BatchActionBar;

// Re-export Icon types so consumers can type their actions without a
// separate import.
export type { IconName };
