import { useState, useRef, useEffect, useCallback } from 'react';

export type CellInputType = 'text' | 'textarea' | 'select' | 'toggle';

export interface SelectOption {
  value: string;
  label: string;
}

interface EditableCellProps {
  value: string | number | boolean;
  inputType?: CellInputType;
  options?: SelectOption[];
  onSave: (newValue: string | number | boolean) => Promise<void>;
  className?: string;
  disabled?: boolean;
  /** Display renderer for non-edit mode. If not provided, renders value as string */
  renderDisplay?: (value: string | number | boolean) => React.ReactNode;
}

const EditableCell = ({
  value,
  inputType = 'text',
  options,
  onSave,
  className = '',
  disabled = false,
  renderDisplay,
}: EditableCellProps) => {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(value);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const [saved, setSaved] = useState(false);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(null);

  useEffect(() => {
    setEditValue(value);
  }, [value]);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      if (inputRef.current instanceof HTMLInputElement || inputRef.current instanceof HTMLTextAreaElement) {
        inputRef.current.select();
      }
    }
  }, [editing]);

  const save = useCallback(async (newValue: string | number | boolean) => {
    if (newValue === value) {
      setEditing(false);
      return;
    }
    setSaving(true);
    setError(false);
    try {
      await onSave(newValue);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
      setEditing(false);
    } catch {
      setError(true);
      setEditValue(value);
      setTimeout(() => setError(false), 2000);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }, [value, onSave]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setEditValue(value);
      setEditing(false);
    } else if (e.key === 'Enter' && inputType !== 'textarea') {
      save(editValue);
    } else if (e.key === 'Tab') {
      save(editValue);
      // Let default tab behavior move focus to next cell
    }
  };

  const handleBlur = () => {
    save(editValue);
  };

  // Toggle: no edit mode, just flip on click
  if (inputType === 'toggle') {
    return (
      <td
        className={`cursor-pointer select-none ${className} ${saved ? 'bg-success/10' : ''} ${error ? 'bg-error/10' : ''}`}
        onClick={() => {
          if (!disabled && !saving) save(!value);
        }}
      >
        {saving ? (
          <span className="loading loading-spinner loading-xs"></span>
        ) : value ? (
          <span className="badge badge-xs badge-success">Yes</span>
        ) : (
          <span className="badge badge-xs badge-ghost">No</span>
        )}
      </td>
    );
  }

  // Display mode
  if (!editing) {
    return (
      <td
        className={`cursor-pointer hover:bg-base-200 transition-colors ${className} ${saved ? 'bg-success/10' : ''} ${error ? 'bg-error/10' : ''} ${disabled ? 'cursor-default' : ''}`}
        onClick={() => {
          if (!disabled) setEditing(true);
        }}
      >
        {renderDisplay ? renderDisplay(value) : (
          <span className={!value && value !== 0 ? 'text-base-content/30' : ''}>
            {value?.toString() || '-'}
          </span>
        )}
      </td>
    );
  }

  // Edit mode
  return (
    <td className={`p-0 ${className}`}>
      {inputType === 'select' ? (
        <select
          ref={inputRef as React.RefObject<HTMLSelectElement>}
          className="select select-xs select-bordered w-full"
          value={editValue as string}
          onChange={(e) => {
            setEditValue(e.target.value);
            save(e.target.value);
          }}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
        >
          {options?.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      ) : inputType === 'textarea' ? (
        <textarea
          ref={inputRef as React.RefObject<HTMLTextAreaElement>}
          className="textarea textarea-xs textarea-bordered w-full min-h-[2.5rem]"
          value={editValue as string}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={handleBlur}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setEditValue(value);
              setEditing(false);
            }
            // Enter with Shift creates newline, Enter alone saves
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              save(editValue);
            }
          }}
        />
      ) : (
        <input
          ref={inputRef as React.RefObject<HTMLInputElement>}
          type="text"
          className="input input-xs input-bordered w-full"
          value={editValue as string}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
        />
      )}
    </td>
  );
};

export default EditableCell;
