/**
 * Button — design-system primitive ported from primitives.jsx.
 *
 * Variants:
 *   primary    — solid accent fill (page-level primary actions)
 *   secondary  — raised bg + strong border (secondary actions)
 *   ghost      — transparent, muted text (toolbar buttons)
 *   soft       — subtle bg, no border (tertiary / toggle-like)
 *   danger     — danger-colored text with a muted border
 *
 * Sizes are tied to the design densities: sm/md/lg → 22/28/34px tall.
 */

import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from 'react';
import Icon, { type IconName } from './Icon';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'soft' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

type VariantStyle = { bg: string; fg: string; border: string };

const VARIANTS: Record<ButtonVariant, VariantStyle> = {
  primary:   { bg: 'var(--accent)',    fg: 'var(--accent-fg)',  border: 'var(--accent)' },
  secondary: { bg: 'var(--bg-raised)', fg: 'var(--text)',       border: 'var(--border-strong)' },
  ghost:     { bg: 'transparent',      fg: 'var(--text-muted)', border: 'transparent' },
  soft:      { bg: 'var(--bg-subtle)', fg: 'var(--text)',       border: 'transparent' },
  danger:    { bg: 'transparent',      fg: 'var(--danger)',     border: 'var(--border)' },
};

const SIZE_STYLES: Record<ButtonSize, CSSProperties> = {
  sm: { padding: '3px 8px', fontSize: 'var(--fs-xs)', height: 22 },
  md: { padding: '5px 10px', fontSize: 'var(--fs-sm)', height: 28 },
  lg: { padding: '7px 14px', fontSize: 'var(--fs-md)', height: 34 },
};

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: IconName;
  /** Show only the icon (no text child). Width shrinks to a square. */
  iconOnly?: boolean;
  /** Mark as toggled/pressed — visual feedback for toggle buttons in segmented controls. */
  pressed?: boolean;
  children?: ReactNode;
}

const Button = ({
  variant = 'secondary',
  size = 'md',
  icon,
  iconOnly,
  pressed,
  disabled,
  className = '',
  style,
  children,
  ...rest
}: ButtonProps) => {
  const v = VARIANTS[variant];
  const s = SIZE_STYLES[size];

  return (
    <button
      type="button"
      disabled={disabled}
      className={`inline-flex items-center gap-1.5 rounded-token-sm transition-colors duration-fast ${className}`}
      style={{
        background: pressed ? 'var(--bg-active)' : v.bg,
        color: pressed ? 'var(--text)' : v.fg,
        border: `1px solid ${pressed ? 'var(--border-strong)' : v.border}`,
        fontWeight: 500,
        opacity: disabled ? 0.5 : 1,
        cursor: disabled ? 'not-allowed' : 'pointer',
        ...s,
        ...(iconOnly ? { width: s.height, padding: 0, justifyContent: 'center' } : null),
        ...style,
      }}
      {...rest}
    >
      {icon && <Icon name={icon} size={size === 'lg' ? 14 : 12} />}
      {!iconOnly && children}
    </button>
  );
};

export default Button;
