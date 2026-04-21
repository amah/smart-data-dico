/**
 * Base chip primitive — the shared skeleton for TypeChip / PiiChip /
 * StatusChip / KindChip. Ported from design_handoff/primitives.jsx.
 *
 * Visual grammar (spec):
 *   --fs-xs · --radius-sm · padding 2px 6px · font-weight 500
 *
 * Tones come from design tokens (tokens.css), so chips reskin
 * automatically under any data-variant / data-theme.
 */

import type { ReactNode } from 'react';

export type ChipTone =
  | 'neutral'
  | 'accent'
  | 'success'
  | 'warning'
  | 'danger'
  | 'info'
  | 'meta';

export interface ChipProps {
  tone?: ChipTone;
  /** Mono font + slashed zero — identifiers / types. */
  mono?: boolean;
  /** Dashed border — object / complex types. */
  dashed?: boolean;
  /** Soft fill variant: *-soft bg, solid-color text, no border. */
  soft?: boolean;
  /** Leading dot in the tone color — used by PiiChip. */
  dot?: boolean;
  className?: string;
  title?: string;
  children: ReactNode;
}

type ToneStyle = { bg: string; fg: string; border: string; softBg: string };

const TONE_STYLES: Record<ChipTone, ToneStyle> = {
  neutral: {
    bg:     'var(--bg-subtle)',
    fg:     'var(--text-muted)',
    border: 'var(--border-strong)',
    softBg: 'var(--bg-subtle)',
  },
  accent: {
    bg:     'var(--accent-soft)',
    fg:     'var(--accent)',
    border: 'var(--accent)',
    softBg: 'var(--accent-soft)',
  },
  success: {
    bg:     'transparent',
    fg:     'var(--success)',
    border: 'var(--success)',
    softBg: 'var(--success-soft)',
  },
  warning: {
    bg:     'transparent',
    fg:     'var(--warning)',
    border: 'var(--warning)',
    softBg: 'var(--warning-soft)',
  },
  danger: {
    bg:     'transparent',
    fg:     'var(--danger)',
    border: 'var(--danger)',
    softBg: 'var(--danger-soft)',
  },
  info: {
    bg:     'transparent',
    fg:     'var(--text-muted)',
    border: 'var(--border-strong)',
    softBg: 'var(--bg-subtle)',
  },
  meta: {
    bg:     'var(--meta-bg)',
    fg:     'var(--meta-label)',
    border: 'var(--meta-border)',
    softBg: 'var(--meta-bg)',
  },
};

const Chip = ({
  tone = 'neutral',
  mono,
  dashed,
  soft,
  dot,
  className = '',
  title,
  children,
}: ChipProps) => {
  const s = TONE_STYLES[tone];
  const bg = soft ? s.softBg : s.bg;
  const border = soft ? 'transparent' : s.border;

  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 rounded-token-sm text-token-xs font-medium ${
        mono ? 'mono' : ''
      } ${className}`}
      style={{
        padding: '1px 6px',
        lineHeight: 1.5,
        background: bg,
        color: s.fg,
        border: `1px ${dashed ? 'dashed' : 'solid'} ${border}`,
        whiteSpace: 'nowrap',
      }}
    >
      {dot && (
        <span
          aria-hidden
          style={{
            width: 6,
            height: 6,
            borderRadius: 9999,
            background: s.fg,
            flexShrink: 0,
          }}
        />
      )}
      {children}
    </span>
  );
};

export default Chip;
