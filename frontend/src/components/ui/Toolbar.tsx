/**
 * Toolbar — the shared horizontal band that sits above every table.
 *
 * Grammar (design_handoff README §Shell):
 *   primary action → secondary ghost buttons → spacer → search →
 *   density switcher → kebab
 *
 * Kept deliberately unopinionated: a flex container plus a `Spacer`
 * subcomponent. Callers compose Button / Input / DensitySwitcher
 * instances in whatever order their page needs.
 */

import type { ReactNode } from 'react';

export interface ToolbarProps {
  children: ReactNode;
  className?: string;
  /** Visually anchor the toolbar to the table below (no bottom radius). */
  attached?: boolean;
}

const Toolbar = ({ children, className = '', attached }: ToolbarProps) => (
  <div
    className={`flex items-center gap-2 ${className}`}
    style={{
      padding: '6px 10px',
      background: 'var(--bg-raised)',
      border: '1px solid var(--border)',
      borderBottomWidth: attached ? 0 : 1,
      borderRadius: attached ? 'var(--radius-md) var(--radius-md) 0 0' : 'var(--radius-md)',
      minHeight: 44,
    }}
  >
    {children}
  </div>
);

/** Spacer — flexes to push following children to the right. */
const Spacer = () => <div style={{ flex: 1 }} />;

/** Visual divider between button groups. */
const Divider = () => (
  <div
    aria-hidden
    style={{
      width: 1,
      height: 20,
      background: 'var(--border)',
      margin: '0 2px',
    }}
  />
);

Toolbar.Spacer = Spacer;
Toolbar.Divider = Divider;

export default Toolbar;
