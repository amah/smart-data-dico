import { useState, useRef, useEffect, type CSSProperties } from 'react';
import type { MetadataColumn } from '../hooks/useStereotypeMetadata';
import { fieldStyle } from './ui';

interface InlineMetadataCellProps {
  value: string | number | boolean | undefined;
  column: MetadataColumn;
  onChange: (value: string | number | boolean) => void;
}

/**
 * Inline cell editor for stereotype-driven metadata. Click-to-edit on
 * text/number/date columns; checkboxes for flag/boolean columns are
 * always interactive (no edit mode toggle).
 *
 * Design-token styled — see /design-system.
 */
export default function InlineMetadataCell({ value, column, onChange }: InlineMetadataCellProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement | HTMLSelectElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      if ('select' in inputRef.current && inputRef.current.type !== 'checkbox') {
        (inputRef.current as HTMLInputElement).select();
      }
    }
  }, [editing]);

  const commit = () => {
    setEditing(false);
    if (column.type === 'number') {
      const num = parseFloat(draft);
      if (!isNaN(num)) onChange(num);
    } else {
      if (draft !== (value ?? '').toString()) {
        onChange(draft);
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      commit();
    } else if (e.key === 'Escape') {
      setEditing(false);
    } else if (e.key === 'Tab') {
      commit();
      // Don't prevent default — let Tab naturally move to the next cell.
    }
  };

  // Flag / boolean — always interactive, no edit toggle.
  if (column.type === 'flag' || column.type === 'boolean') {
    const checked = value === true || value === 'true';
    return (
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        title={column.description}
        style={{ accentColor: 'var(--accent)', cursor: 'pointer' }}
      />
    );
  }

  // Display mode — click to switch to edit.
  if (!editing) {
    return (
      <span
        onClick={() => {
          setDraft((value ?? '').toString());
          setEditing(true);
        }}
        title={column.description || 'Click to edit'}
        style={displayStyle}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
      >
        {value !== undefined && value !== '' ? (
          <span style={column.type === 'date' ? { fontSize: 'var(--fs-xs)' } : undefined}>
            {value.toString()}
          </span>
        ) : (
          <span style={{ color: 'var(--text-subtle)', fontSize: 'var(--fs-xs)', fontStyle: 'italic' }}>—</span>
        )}
      </span>
    );
  }

  // Edit mode — type-specific input.
  const inputProps = {
    ref: inputRef as React.RefObject<HTMLInputElement>,
    value: draft,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setDraft(e.target.value),
    onBlur: commit,
    onKeyDown: handleKeyDown,
  };

  if (column.type === 'date') {
    return <input type="date" {...inputProps} style={{ ...fieldStyle, width: 130, height: 24, fontSize: 'var(--fs-xs)' }} />;
  }
  if (column.type === 'number') {
    return <input type="number" {...inputProps} style={{ ...fieldStyle, width: 80, height: 24, fontSize: 'var(--fs-xs)' }} />;
  }
  return <input type="text" {...inputProps} style={{ ...fieldStyle, width: 120, height: 24, fontSize: 'var(--fs-xs)' }} />;
}

const displayStyle: CSSProperties = {
  cursor: 'pointer',
  padding: '2px 4px',
  borderRadius: 'var(--radius-sm)',
  minWidth: '2rem',
  minHeight: '1.25rem',
  display: 'inline-block',
  background: 'transparent',
  fontSize: 'var(--fs-sm)',
  color: 'var(--text)',
};
