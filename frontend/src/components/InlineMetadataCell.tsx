import { useState, useRef, useEffect, type CSSProperties } from 'react';
import type { MetadataColumn } from '../hooks/useStereotypeMetadata';
import type { MetadataValue } from '../types';
import { fieldStyle } from './ui';

interface InlineMetadataCellProps {
  value: string | number | boolean | undefined;
  column: MetadataColumn;
  onChange: (value: string | number | boolean) => void;
  /** Optional callback for non-scalar cells — called when the cell is clicked. */
  onExpand?: () => void;
}

// ─── Non-scalar inline renderers ─────────────────────────────────────────────

/**
 * Read-only renderer for object-typed metadata values inside the inline
 * table cell.
 */
function renderObjectInline(value: { [k: string]: MetadataValue }): JSX.Element {
  const entries = Object.entries(value);
  if (entries.length === 0) {
    return <span style={{ color: 'var(--text-subtle)', fontSize: 'var(--fs-xs)', fontStyle: 'italic' }}>—</span>;
  }
  return (
    <div style={{ fontSize: 'var(--fs-xs)', lineHeight: 1.4 }}>
      {entries.map(([k, v]) => (
        <div key={k}>
          <span style={{ fontWeight: 600 }}>{k}</span>
          {': '}
          <span>{String(v)}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * Read-only renderer for array-typed metadata values inside the inline
 * table cell.
 */
function renderArrayInline(value: MetadataValue[]): JSX.Element {
  if (value.length === 0) {
    return <span style={{ color: 'var(--text-subtle)', fontSize: 'var(--fs-xs)', fontStyle: 'italic' }}>—</span>;
  }
  return (
    <ol style={{ fontSize: 'var(--fs-xs)', listStyleType: 'decimal', paddingLeft: '1rem', margin: 0 }}>
      {value.map((item, i) => (
        <li key={i}>{String(item)}</li>
      ))}
    </ol>
  );
}

/**
 * Fallback renderer for unknown metadata `column.type` keys — shows the
 * raw JSON value with a "unknown type: {type}" badge.
 */
function renderUnknownInline(value: MetadataValue | undefined, columnType: string): JSX.Element {
  return (
    <div style={{ fontSize: 'var(--fs-xs)' }}>
      <span style={{ background: 'var(--warning, #f59e0b)', color: '#fff', padding: '0 4px', borderRadius: 2, fontSize: 'var(--fs-xs)', marginRight: 4 }}>
        unknown type: {columnType}
      </span>
      <span style={{ fontFamily: 'monospace' }}>{JSON.stringify(value)}</span>
    </div>
  );
}

// ─── InlineMetadataCell ───────────────────────────────────────────────────────

/**
 * Inline cell editor for stereotype-driven metadata. Click-to-edit on
 * text/number/date columns; checkboxes for flag/boolean columns are
 * always interactive (no edit mode toggle).
 *
 * Non-scalar columns (object, array) are rendered read-only inline;
 * clicking them calls `onExpand` if provided.
 *
 * Design-token styled — see /design-system.
 */
export default function InlineMetadataCell({ value, column, onChange, onExpand }: InlineMetadataCellProps) {
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

  // Non-scalar types — render read-only inline; clicking calls onExpand.
  if (column.type === 'object') {
    const objValue =
      value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value)
        ? (value as { [k: string]: MetadataValue })
        : {};
    return (
      <span
        onClick={onExpand}
        title={column.description || (onExpand ? 'Click to expand' : undefined)}
        style={{ ...displayStyle, cursor: onExpand ? 'pointer' : 'default' }}
      >
        {renderObjectInline(objValue)}
      </span>
    );
  }

  if (column.type === 'array') {
    const arrValue = Array.isArray(value) ? (value as MetadataValue[]) : [];
    return (
      <span
        onClick={onExpand}
        title={column.description || (onExpand ? 'Click to expand' : undefined)}
        style={{ ...displayStyle, cursor: onExpand ? 'pointer' : 'default' }}
      >
        {renderArrayInline(arrValue)}
      </span>
    );
  }

  // Unknown scalar-ish types — render with unknown badge.
  const knownTypes = ['string', 'number', 'boolean', 'flag', 'date', 'rule', 'enum', 'object', 'array'];
  if (!knownTypes.includes(column.type)) {
    return (
      <span
        onClick={onExpand}
        style={{ ...displayStyle, cursor: onExpand ? 'pointer' : 'default' }}
      >
        {renderUnknownInline(value as MetadataValue | undefined, column.type)}
      </span>
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
