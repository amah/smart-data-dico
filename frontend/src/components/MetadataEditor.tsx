import { useState } from 'react';
import type { MetadataEntry, MetadataDefinition, Stereotype, RuleSeverity } from '../types';
import { MetadataValueType } from '../types';

interface MetadataEditorProps {
  entries: MetadataEntry[];
  stereotype?: Stereotype | null;
  onChange: (entries: MetadataEntry[]) => void;
  readOnly?: boolean;
}

export default function MetadataEditor({ entries, stereotype, onChange, readOnly }: MetadataEditorProps) {
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

  const updateEntry = (name: string, value: any, severity?: RuleSeverity) => {
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

  const renderInput = (entry: MetadataEntry, def?: MetadataDefinition) => {
    const type = def?.type || MetadataValueType.STRING;

    switch (type) {
      case MetadataValueType.FLAG:
        return (
          <input
            type="checkbox"
            className="toggle toggle-primary toggle-sm"
            checked={!!entry.value}
            onChange={(e) => updateEntry(entry.name, e.target.checked)}
            disabled={readOnly}
          />
        );

      case MetadataValueType.BOOLEAN:
        return (
          <input
            type="checkbox"
            className="checkbox checkbox-sm"
            checked={!!entry.value}
            onChange={(e) => updateEntry(entry.name, e.target.checked)}
            disabled={readOnly}
          />
        );

      case MetadataValueType.NUMBER:
        return (
          <input
            type="number"
            className="input input-bordered input-sm w-32"
            value={entry.value as number}
            onChange={(e) => updateEntry(entry.name, Number(e.target.value))}
            disabled={readOnly}
          />
        );

      case MetadataValueType.DATE:
        return (
          <input
            type="date"
            className="input input-bordered input-sm"
            value={String(entry.value || '')}
            onChange={(e) => updateEntry(entry.name, e.target.value)}
            disabled={readOnly}
          />
        );

      case MetadataValueType.RULE:
        return (
          <div className="flex gap-2 items-start">
            <textarea
              className="textarea textarea-bordered textarea-sm flex-1"
              value={String(entry.value || '')}
              onChange={(e) => updateEntry(entry.name, e.target.value, entry.severity)}
              placeholder="Describe the rule..."
              rows={2}
              disabled={readOnly}
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
        );

      default: // STRING
        return (
          <input
            type="text"
            className="input input-bordered input-sm flex-1"
            value={String(entry.value || '')}
            onChange={(e) => updateEntry(entry.name, e.target.value)}
            disabled={readOnly}
          />
        );
    }
  };

  return (
    <div className="space-y-3">
      {/* Stereotype entries (from definitions) */}
      {allEntries.map((entry) => {
        const def = getDef(entry.name);
        const isRequired = def?.required;
        const isFromStereotype = !!def;

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
            <div className="flex-1">{renderInput(entry, def)}</div>
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
