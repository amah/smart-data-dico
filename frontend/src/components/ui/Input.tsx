/**
 * Input — design-system text input ported from primitives.jsx.
 *
 * Optional leading icon (e.g. `search`). Focus ring uses
 * --border-focus via the global :focus-visible rule.
 */

import type { InputHTMLAttributes, CSSProperties } from 'react';
import Icon, { type IconName } from './Icon';

export type InputSize = 'sm' | 'md';

const SIZE_STYLES: Record<InputSize, { padX: number; height: number; fs: string }> = {
  sm: { padX: 8,  height: 24, fs: 'var(--fs-sm)' },
  md: { padX: 10, height: 30, fs: 'var(--fs-sm)' },
};

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  size?: InputSize;
  icon?: IconName;
  /** Total width; default leaves it natural. */
  width?: number | string;
}

const Input = ({
  size = 'md',
  icon,
  width,
  className = '',
  style,
  ...rest
}: InputProps) => {
  const s = SIZE_STYLES[size];
  const wrapperStyle: CSSProperties = {
    position: 'relative',
    display: 'inline-flex',
    alignItems: 'center',
    width,
  };
  const inputStyle: CSSProperties = {
    width: '100%',
    paddingLeft: icon ? 26 : s.padX,
    paddingRight: s.padX,
    height: s.height,
    fontSize: s.fs,
    fontFamily: 'inherit',
    background: 'var(--bg-raised)',
    color: 'var(--text)',
    border: '1px solid var(--border-strong)',
    borderRadius: 'var(--radius-sm)',
    outline: 'none',
    ...style,
  };
  return (
    <span style={wrapperStyle} className={className}>
      {icon && (
        <Icon
          name={icon}
          size={13}
          style={{ position: 'absolute', left: 8, color: 'var(--text-subtle)', pointerEvents: 'none' }}
        />
      )}
      <input type="text" style={inputStyle} {...rest} />
    </span>
  );
};

export default Input;
