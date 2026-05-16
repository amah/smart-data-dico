import { useState } from 'react';
import type { MetadataEntry, MetadataDefinition, MetadataValue, Stereotype, RuleSeverity } from '../types';
import { METADATA_TYPE_REGISTRY_TOKEN } from '../kernel/tokens';
import { useService } from '../kernel/useService';
import type { MetadataTypeRegistry } from '../plugins/data-dictionary/metadata/MetadataTypeRegistry';
import { setMetadataFieldComponent } from '../plugins/data-dictionary/metadata/builtinContributions';

// ─── MetadataField ────────────────────────────────────────────────────────────

interface MetadataFieldProps {
  value: MetadataValue;
  definition: MetadataDefinition;
  onChange: (next: MetadataValue) => void;
  /** Dotted path from the root entry value — used for nested error keys. */
  path: string;
  readOnly?: boolean;
}

/**
 * Recursive single-field renderer. Resolves the contribution for
 * definition.type from the registry and renders <contribution.Editor />.
 * Built-in object/array contributions render their children by recursing
 * INTO <MetadataField />, NOT into <MetadataBlock /> (which speaks the
 * entries+stereotype shape, not value+definition).
 */
export function MetadataField({ value, definition, onChange, path, readOnly }: MetadataFieldProps) {
  const registry = useService<MetadataTypeRegistry>(METADATA_TYPE_REGISTRY_TOKEN);
  const contribution = registry.getOrFallback(definition.type);
  const { Editor } = contribution;

  return (
    <Editor
      value={value as any}
      onChange={onChange as any}
      def={definition}
      path={path}
      readOnly={readOnly}
    />
  );
}

// Register MetadataField with builtinContributions so object/array editors
// can recurse without a circular import.
setMetadataFieldComponent(MetadataField);

// ─── MetadataBlock ─────────────────────────────────────────────────────────────

interface MetadataBlockProps {
  entries: MetadataEntry[];
  stereotype?: Stereotype | null;
  onChange: (entries: MetadataEntry[]) => void;
  readOnly?: boolean;
}

/**
 * Top-level block editor. Adapts a MetadataEntry[] (the on-disk shape) +
 * Stereotype to a definitions-driven iteration over MetadataField.
 * This is the ONLY component that adapts MetadataEntry[] ↔ MetadataDefinition[].
 * Everything beneath it speaks MetadataValue + MetadataDefinition.
 */
export function MetadataBlock({ entries, stereotype, onChange, readOnly }: MetadataBlockProps) {
  const [newName, setNewName] = useState('');
  const [newValue, setNewValue] = useState('');

  const definitions = stereotype?.metadataDefinitions || [];

  // Merge stereotype definitions with current entries — add placeholders for
  // definitions not yet present in entries.
  const allEntries = [...entries];
  for (const def of definitions) {
    if (!allEntries.find((e) => e.name === def.name)) {
      allEntries.push({ name: def.name, value: def.type === 'flag' || def.type === 'boolean' ? false : '' });
    }
  }

  const getDef = (name: string): MetadataDefinition | undefined =>
    definitions.find((d) => d.name === name);

  const updateEntry = (name: string, value: MetadataValue, severity?: RuleSeverity) => {
    const updated = entries.map((e) =>
      e.name === name ? { ...e, value, ...(severity !== undefined ? { severity } : {}) } : e,
    );
    if (!updated.find((e) => e.name === name)) {
      updated.push({ name, value, ...(severity ? { severity } : {}) });
    }
    onChange(updated);
  };

  const removeEntry = (name: string) => {
    const def = getDef(name);
    if (def?.required) return;
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
              {def ? (
                <MetadataField
                  value={entry.value}
                  definition={def}
                  onChange={(next) => updateEntry(entry.name, next)}
                  path={entry.name}
                  readOnly={readOnly}
                />
              ) : (
                // Custom entry with no stereotype definition — render as string
                readOnly ? (
                  <span className="text-sm">{String(entry.value ?? '')}</span>
                ) : (
                  <input
                    type="text"
                    className="input input-bordered input-sm flex-1"
                    value={String(entry.value ?? '')}
                    onChange={(e) => updateEntry(entry.name, e.target.value)}
                  />
                )
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

// Default export preserves existing import sites:
//   import MetadataEditor from '../components/MetadataEditor'
//   -> resolves to MetadataBlock (same props as today).
export default MetadataBlock;
