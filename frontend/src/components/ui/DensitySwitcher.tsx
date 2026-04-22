/**
 * DensitySwitcher — 3-position segmented control for row density.
 *
 * Phase 3 will wire the selected density into the shell prefs slice
 * and rebind `--row-height` globally. For Phase 2 it's a controlled
 * component that just reports changes.
 */

import type { ReactNode } from 'react';

export type Density = 'comfortable' | 'compact' | 'dense';

const DENSITIES: Array<{ value: Density; label: string; glyph: ReactNode }> = [
  {
    value: 'comfortable',
    label: 'Comfortable',
    glyph: (
      <>
        <line x1="4" y1="7"  x2="20" y2="7"  />
        <line x1="4" y1="12" x2="20" y2="12" />
        <line x1="4" y1="17" x2="20" y2="17" />
      </>
    ),
  },
  {
    value: 'compact',
    label: 'Compact',
    glyph: (
      <>
        <line x1="4" y1="6"  x2="20" y2="6"  />
        <line x1="4" y1="10" x2="20" y2="10" />
        <line x1="4" y1="14" x2="20" y2="14" />
        <line x1="4" y1="18" x2="20" y2="18" />
      </>
    ),
  },
  {
    value: 'dense',
    label: 'Dense',
    glyph: (
      <>
        <line x1="4" y1="5"  x2="20" y2="5"  />
        <line x1="4" y1="9"  x2="20" y2="9"  />
        <line x1="4" y1="13" x2="20" y2="13" />
        <line x1="4" y1="17" x2="20" y2="17" />
        <line x1="4" y1="21" x2="20" y2="21" />
      </>
    ),
  },
];

export interface DensitySwitcherProps {
  value: Density;
  onChange: (value: Density) => void;
  className?: string;
}

const DensitySwitcher = ({ value, onChange, className = '' }: DensitySwitcherProps) => (
  <div
    className={`inline-flex items-center ${className}`}
    style={{
      height: 28,
      background: 'var(--bg-subtle)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-sm)',
      padding: 2,
      gap: 2,
    }}
    role="group"
    aria-label="Row density"
  >
    {DENSITIES.map(d => {
      const active = value === d.value;
      return (
        <button
          key={d.value}
          type="button"
          onClick={() => onChange(d.value)}
          title={d.label}
          aria-pressed={active}
          style={{
            height: 22,
            width: 26,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: active ? 'var(--bg-raised)' : 'transparent',
            color: active ? 'var(--text)' : 'var(--text-muted)',
            border: 'none',
            borderRadius: 'var(--radius-sm)',
            boxShadow: active ? 'var(--shadow-sm)' : 'none',
            cursor: 'pointer',
            transition: 'background var(--dur-fast), color var(--dur-fast)',
          }}
        >
          <svg
            width={12}
            height={12}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.6}
            strokeLinecap="round"
            aria-hidden
          >
            {d.glyph}
          </svg>
        </button>
      );
    })}
  </div>
);

export default DensitySwitcher;
