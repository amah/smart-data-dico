import { useState } from 'react';
import type { MetadataValue, MetadataDefinition, MetadataEntry, Stereotype, RuleSeverity } from '../types';

// ─── MetadataField ───────────────────────────────────────────────────────────

interface MetadataFieldProps {
  value: MetadataValue;
  definition: MetadataDefinition;
  onChange: (next: MetadataValue) => void;
  /** Dotted path from the root entry value — used for nested error keys. */
  path: string;
  readOnly?: boolean;
}

/**
 * Recursive single-field renderer. Dispatches on `definition.type` via a
 * static switch over the 9 known keys (string, number, boolean, date, flag,
 * rule, object, array, enum). Unknown types fall through to a read-only
 * JSON dump with an "unknown type" badge, matching the legacy
 * UnknownTypeEditor behaviour.
 *
 * Object/array recurse back into <MetadataField /> directly (same module —
 * no lazy injection or indirection required).
 */
export function MetadataField({ value, definition, onChange, path, readOnly }: MetadataFieldProps): JSX.Element {
  switch (definition.type) {
    case 'flag':
      return (
        <input
          type="checkbox"
          className="toggle toggle-primary toggle-sm"
          checked={!!value}
          onChange={(e) => onChange(e.target.checked)}
          disabled={readOnly}
        />
      );

    case 'boolean':
      return (
        <input
          type="checkbox"
          className="checkbox checkbox-sm"
          checked={!!value}
          onChange={(e) => onChange(e.target.checked)}
          disabled={readOnly}
        />
      );

    case 'number':
      return (
        <input
          type="number"
          className="input input-bordered input-sm w-32"
          value={typeof value === 'number' ? value : ''}
          onChange={(e) => onChange(Number(e.target.value))}
          disabled={readOnly}
        />
      );

    case 'date':
      return (
        <input
          type="date"
          className="input input-bordered input-sm"
          value={String(value || '')}
          onChange={(e) => onChange(e.target.value)}
          disabled={readOnly}
        />
      );

    case 'rule':
      return (
        <textarea
          className="textarea textarea-bordered textarea-sm flex-1"
          value={String(value || '')}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Describe the rule..."
          rows={2}
          disabled={readOnly}
        />
      );

    case 'object': {
      const objValue = (value && typeof value === 'object' && !Array.isArray(value))
        ? value as Record<string, MetadataValue>
        : {};
      const childDefs = definition.fields || [];
      if (childDefs.length === 0) {
        return (
          <span className="text-sm text-base-content/50 italic">Object (no fields defined)</span>
        );
      }
      return (
        <div className="pl-3 border-l-2 border-base-300 space-y-2">
          {childDefs.map((childDef) => (
            <div key={childDef.name} className="flex items-start gap-2">
              <span className="font-mono text-xs min-w-[100px] mt-1.5">{childDef.name}</span>
              <MetadataField
                value={objValue[childDef.name] ?? ''}
                definition={childDef}
                onChange={(next) => onChange({ ...objValue, [childDef.name]: next })}
                path={`${path}.${childDef.name}`}
                readOnly={readOnly}
              />
            </div>
          ))}
        </div>
      );
    }

    case 'array': {
      const arrValue = Array.isArray(value) ? value as MetadataValue[] : [];
      const itemDef = definition.items;
      if (!itemDef) {
        return (
          <span className="text-sm text-base-content/50 italic">Array (no item definition)</span>
        );
      }
      return (
        <div className="space-y-1">
          {arrValue.map((item, idx) => (
            <div key={idx} className="flex items-start gap-2">
              <span className="text-xs text-base-content/50 min-w-[24px] mt-1.5">[{idx}]</span>
              <MetadataField
                value={item}
                definition={itemDef}
                onChange={(next) => {
                  const updated = [...arrValue];
                  updated[idx] = next;
                  onChange(updated);
                }}
                path={`${path}[${idx}]`}
                readOnly={readOnly}
              />
              {!readOnly && (
                <button
                  className="btn btn-ghost btn-xs text-error"
                  onClick={() => onChange(arrValue.filter((_, i) => i !== idx))}
                  title="Remove item"
                >
                  &times;
                </button>
              )}
            </div>
          ))}
          {!readOnly && (
            <button
              className="btn btn-xs btn-ghost"
              onClick={() => onChange([...arrValue, ''])}
            >
              + Add item
            </button>
          )}
        </div>
      );
    }

    case 'enum': {
      const enumValues = definition.enum || [];
      return (
        <select
          className="select select-bordered select-sm"
          value={String(value || '')}
          onChange={(e) => onChange(e.target.value)}
          disabled={readOnly}
        >
          <option value="">— select —</option>
          {enumValues.map((v) => (
            <option key={v} value={v}>{v}</option>
          ))}
        </select>
      );
    }

    case 'string':
    default: {
      // Default/unknown types fall back to a text input (string case)
      // or a JSON dump with "unknown type" badge if the type is truly unrecognised.
      const knownTypes = ['string', 'number', 'boolean', 'date', 'flag', 'rule', 'object', 'array', 'enum'];
      if (!knownTypes.includes(definition.type as string)) {
        return (
          <div className="flex items-center gap-2">
            <span className="badge badge-warning badge-xs">unknown type: {definition.type}</span>
            <span className="font-mono text-xs text-base-content/70">
              {JSON.stringify(value)}
            </span>
          </div>
        );
      }
      return (
        <input
          type="text"
          className="input input-bordered input-sm flex-1"
          value={String(value || '')}
          onChange={(e) => onChange(e.target.value)}
          disabled={readOnly}
        />
      );
    }
  }
}

// ─── MetadataBlock ────────────────────────────────────────────────────────────

interface MetadataBlockProps {
  entries: MetadataEntry[];
  stereotype?: Stereotype | null;
  onChange: (entries: MetadataEntry[]) => void;
  readOnly?: boolean;
}

/**
 * Top-level block editor; iterates definitions + entries and delegates
 * per-field rendering to <MetadataField />.
 */
export function MetadataBlock({ entries, stereotype, onChange, readOnly }: MetadataBlockProps): JSX.Element {
  const [newName, setNewName] = useState('');
  const [newValue, setNewValue] = useState('');

  // Merge stereotype definitions with current entries
  const definitions = stereotype?.metadataDefinitions || [];
  const allEntries = [...entries];

  // Add missing required/optional entries from stereotype
  for (const def of definitions) {
    if (!allEntries.find((e) => e.name === def.name)) {
      allEntries.push({ name: def.name, value: def.type === 'flag' ? false : '' });
    }
  }

  const getDef = (name: string): MetadataDefinition | undefined =>
    definitions.find((d) => d.name === name);

  const updateEntry = (name: string, value: MetadataValue, severity?: RuleSeverity) => {
    const updated = entries.map((e) =>
      e.name === name ? { ...e, value, ...(severity !== undefined ? { severity } : {}) } : e,
    );
    // If entry doesn't exist yet, add it
    if (!updated.find((e) => e.name === name)) {
      updated.push({ name, value, ...(severity ? { severity } : {}) });
    }
    onChange(updated);
  };

  const removeEntry = (name: string) => {
    const def = getDef(name);
    if (def?.required) return; // Can't remove required entries
    onChange(entries.filter((e) => e.name !== name));
  };

  const addCustomEntry = () => {
    if (!newName.trim()) return;
    if (entries.find((e) => e.name === newName)) return;
    onChange([...entries, { name: newName.trim(), value: newValue }]);
    setNewName('');
    setNewValue('');
  };

  return (
    <div className="space-y-3">
      {/* Stereotype entries (from definitions) */}
      {allEntries.map((entry) => {
        const def = getDef(entry.name);
        const isRequired = def?.required;
        const isFromStereotype = !!def;

        // For rule-typed entries, render severity alongside the field
        const isRule = def?.type === 'rule';

        return (
          <div key={entry.name} className="flex items-start gap-3">
            <div className="min-w-[140px]">
              <div className="flex items-center gap-1">
                <span className="font-mono text-sm">{entry.name}</span>
                {isRequired && <span className="text-error text-xs">*</span>}
              </div>
              {def?.description && (
                <p className="text-xs text-base-content/50">{def.description}</p>
              )}
              {isFromStereotype && (
                <span className="badge badge-xs badge-outline mt-0.5">stereotype</span>
              )}
            </div>
            <div className="flex-1">
              {isRule ? (
                <div className="flex gap-2 items-start">
                  <MetadataField
                    value={entry.value}
                    definition={def!}
                    onChange={(next) => updateEntry(entry.name, next, entry.severity)}
                    path={entry.name}
                    readOnly={readOnly}
                  />
                  <select
                    className="select select-bordered select-sm"
                    value={entry.severity || 'info'}
                    onChange={(e) => updateEntry(entry.name, entry.value, e.target.value as RuleSeverity)}
                    disabled={readOnly}
                  >
                    <option value="info">Info</option>
                    <option value="warning">Warning</option>
                    <option value="error">Error</option>
                  </select>
                </div>
              ) : def ? (
                <MetadataField
                  value={entry.value}
                  definition={def}
                  onChange={(next) => updateEntry(entry.name, next)}
                  path={entry.name}
                  readOnly={readOnly}
                />
              ) : (
                // Custom (non-stereotype) entry — plain text input
                <input
                  type="text"
                  className="input input-bordered input-sm flex-1"
                  value={String(entry.value || '')}
                  onChange={(e) => updateEntry(entry.name, e.target.value)}
                  disabled={readOnly}
                />
              )}
            </div>
            {!readOnly && !isRequired && (
              <button
                className="btn btn-ghost btn-xs text-error"
                onClick={() => removeEntry(entry.name)}
                title="Remove"
              >
                &times;
              </button>
            )}
          </div>
        );
      })}

      {/* Add custom entry */}
      {!readOnly && (
        <div className="flex items-center gap-2 pt-2 border-t border-base-300">
          <input
            type="text"
            className="input input-bordered input-sm w-36"
            placeholder="Key"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <input
            type="text"
            className="input input-bordered input-sm flex-1"
            placeholder="Value"
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
          />
          <button className="btn btn-sm btn-ghost" onClick={addCustomEntry} disabled={!newName.trim()}>
            Add
          </button>
        </div>
      )}

      {allEntries.length === 0 && !readOnly && (
        <p className="text-sm text-base-content/50">No metadata. Add entries above or assign a stereotype.</p>
      )}
    </div>
  );
}

/** Unchanged default export — preserves all current import sites. */
export default MetadataBlock;
