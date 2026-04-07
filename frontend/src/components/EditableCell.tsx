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
  /** Accessible label for the cell — used for the toggle checkbox aria-label */
  ariaLabel?: string;
}

/**
 * Inline-editable table cell.
 *
 * - Text/textarea/select cells enter edit mode on single click.
 * - Toggle cells render an inert <td> wrapping a small checkbox widget — the
 *   checkbox is the only click target, so the cell area is text-selectable
 *   and stray clicks on the row don't accidentally flip the value (#70).
 */
const EditableCell = ({
  value,
  inputType = 'text',
  options,
  onSave,
  className = '',
  disabled = false,
  renderDisplay,
  ariaLabel,
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

  // ────────────────────────────────────────────
  // Toggle: inert <td> with an inner checkbox (#70)
  // ────────────────────────────────────────────
  if (inputType === 'toggle') {
    const handleCheckboxChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!disabled && !saving) save(e.target.checked);
    };
    return (
      <td
        className={`cursor-default ${className} ${saved ? 'bg-success/10' : ''} ${error ? 'bg-error/10' : ''}`}
      >
        {saving ? (
          <span className="loading loading-spinner loading-xs" aria-label="saving"></span>
        ) : (
          <input
            type="checkbox"
            className="checkbox checkbox-xs checkbox-success"
            checked={!!value}
            disabled={disabled}
            onChange={handleCheckboxChange}
            aria-label={ariaLabel ?? 'toggle value'}
          />
        )}
      </td>
    );
  }

  // ────────────────────────────────────────────
  // Display mode — single click to edit
  //
  // Note: no hover background or transition on the cell itself. The parent
  // table rows in flat views and entity detail use DaisyUI's `tr.hover` which
  // already highlights the whole row; layering a cell-level hover background
  // on top caused a visible flicker when the mouse moved between cells in a
  // hovered row (the transition-colors animation re-painted each cell).
  // ────────────────────────────────────────────
  if (!editing) {
    return (
      <td
        className={`${disabled ? '' : 'cursor-pointer'} ${className} ${saved ? 'bg-success/10' : ''} ${error ? 'bg-error/10' : ''}`}
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

  // ────────────────────────────────────────────
  // Edit mode
  // ────────────────────────────────────────────
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
