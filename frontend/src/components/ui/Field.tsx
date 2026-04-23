/**
 * Field — labeled form row used by side panels and create modals.
 *
 * A single-label wrapper with two layout modes:
 *   - block  (default): label on top, control below
 *   - inline:            label + control on the same row
 * `grow` sets `flex: 1` so adjacent fields share a row cleanly.
 *
 * MetadataField renders the appropriate control for a stereotype-driven
 * `MetadataColumn` (checkbox for flag/boolean, text input otherwise).
 *
 * `fieldStyle` / `fieldStyleMono` are the shared input styles used by
 * consumers that build their own controls next to Field.
 */

import type { ReactNode } from 'react';
import type { MetadataColumn } from '../../hooks/useStereotypeMetadata';

export interface FieldProps {
  label: string;
  inline?: boolean;
  grow?: boolean;
  children: ReactNode;
}

export const Field = ({ label, inline, grow, children }: FieldProps) => (
  <label
    style={{
      display: inline ? 'inline-flex' : 'flex',
      flexDirection: inline ? 'row' : 'column',
      alignItems: inline ? 'center' : 'stretch',
      gap: inline ? 6 : 4,
      flex: grow ? 1 : undefined,
    }}
  >
    <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', letterSpacing: '0.02em' }}>
      {label}
    </span>
    {children}
  </label>
);

export interface MetadataFieldProps {
  column: MetadataColumn;
  value: string | number | boolean | undefined;
  onChange: (value: string | number | boolean) => void;
}

export const MetadataField = ({ column, value, onChange }: MetadataFieldProps) => {
  const label = `${column.label} · ${column.stereotypeName}`;
  if (column.type === 'flag' || column.type === 'boolean') {
    return (
      <Field label={label} inline>
        <input
          type="checkbox"
          checked={!!value}
          onChange={(e) => onChange(e.target.checked)}
        />
      </Field>
    );
  }
  return (
    <Field label={label}>
      <input
        type="text"
        value={value === undefined ? '' : String(value)}
        onChange={(e) => onChange(e.target.value)}
        style={fieldStyle}
      />
    </Field>
  );
};

export const fieldStyle = {
  height: 28,
  padding: '0 8px',
  fontSize: 'var(--fs-sm)',
  fontFamily: 'inherit',
  background: 'var(--bg-raised)',
  color: 'var(--text)',
  border: '1px solid var(--border-strong)',
  borderRadius: 'var(--radius-sm)',
  outline: 'none',
} as const;

export const fieldStyleMono = {
  ...fieldStyle,
  fontFamily: 'var(--font-mono)',
} as const;
