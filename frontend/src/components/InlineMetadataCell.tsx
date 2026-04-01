import { useState, useRef, useEffect } from 'react';
import type { MetadataColumn } from '../hooks/useStereotypeMetadata';

interface InlineMetadataCellProps {
  value: string | number | boolean | undefined;
  column: MetadataColumn;
  onChange: (value: string | number | boolean) => void;
}

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
      // Don't prevent default — let Tab naturally move to next cell
    }
  };

  // Flag / boolean: render as a toggle (always interactive, no edit mode needed)
  if (column.type === 'flag' || column.type === 'boolean') {
    const checked = value === true || value === 'true';
    return (
      <input
        type="checkbox"
        className="checkbox checkbox-xs checkbox-primary"
        checked={checked}
        onChange={(e) => onChange(column.type === 'flag' ? e.target.checked : e.target.checked)}
        title={column.description}
      />
    );
  }

  // Display mode
  if (!editing) {
    return (
      <span
        className="cursor-pointer hover:bg-base-200 px-1 py-0.5 rounded min-w-[2rem] inline-block min-h-[1.25rem]"
        onClick={() => {
          setDraft((value ?? '').toString());
          setEditing(true);
        }}
        title={column.description || 'Click to edit'}
      >
        {value !== undefined && value !== '' ? (
          column.type === 'date' ? (
            <span className="text-xs">{value.toString()}</span>
          ) : (
            value.toString()
          )
        ) : (
          <span className="text-base-content/30 text-xs italic">-</span>
        )}
      </span>
    );
  }

  // Edit mode
  if (column.type === 'date') {
    return (
      <input
        ref={inputRef as React.RefObject<HTMLInputElement>}
        type="date"
        className="input input-xs input-bordered w-32"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={handleKeyDown}
      />
    );
  }

  if (column.type === 'number') {
    return (
      <input
        ref={inputRef as React.RefObject<HTMLInputElement>}
        type="number"
        className="input input-xs input-bordered w-20"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={handleKeyDown}
      />
    );
  }

  // Default: text input
  return (
    <input
      ref={inputRef as React.RefObject<HTMLInputElement>}
      type="text"
      className="input input-xs input-bordered w-28"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={handleKeyDown}
    />
  );
}
