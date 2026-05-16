import React from 'react';
import type { MetadataValue, MetadataDefinition } from '../../../types';
import type {
  MetadataTypeContribution,
  MetadataTypeRegistry,
  MetadataEditorInputProps,
  MetadataViewerProps,
} from './MetadataTypeRegistry';

// ─── Helper: MetadataField forward-ref (to allow recursion without circular dep) ─
// The actual MetadataField is in MetadataEditor.tsx. We declare the interface
// here and late-bind at render time via the registry's getOrFallback.

// ─── String ──────────────────────────────────────────────────────────────────

function StringEditor({ value, onChange, def, readOnly }: MetadataEditorInputProps<string>) {
  return (
    <input
      type="text"
      className="input input-bordered input-sm flex-1"
      value={typeof value === 'string' ? value : ''}
      onChange={(e) => onChange(e.target.value)}
      disabled={readOnly}
      placeholder={def.description}
    />
  );
}

function StringViewer({ value }: MetadataViewerProps<string>) {
  return <span>{String(value ?? '')}</span>;
}

export const builtinStringContribution: MetadataTypeContribution<string> = {
  type: 'string',
  label: 'Text',
  defaultValue: '',
  validate(value) {
    if (typeof value !== 'string') return { ok: false, errors: [{ path: '', message: `Expected string` }] };
    return { ok: true, errors: [] };
  },
  serialize: (v) => v,
  parse: (raw) => raw === undefined || raw === null ? '' : String(raw),
  toJsonSchema: () => ({ type: 'string' }),
  toMarkdown: (v) => String(v),
  Editor: StringEditor,
  Viewer: StringViewer,
};

// ─── Number ──────────────────────────────────────────────────────────────────

function NumberEditor({ value, onChange, def, readOnly }: MetadataEditorInputProps<number>) {
  return (
    <input
      type="number"
      className="input input-bordered input-sm w-32"
      value={typeof value === 'number' ? value : 0}
      onChange={(e) => onChange(Number(e.target.value))}
      disabled={readOnly}
      placeholder={def.description}
    />
  );
}

function NumberViewer({ value }: MetadataViewerProps<number>) {
  return <span>{String(value ?? 0)}</span>;
}

export const builtinNumberContribution: MetadataTypeContribution<number> = {
  type: 'number',
  label: 'Number',
  defaultValue: 0,
  validate(value) {
    if (typeof value !== 'number') return { ok: false, errors: [{ path: '', message: `Expected number` }] };
    return { ok: true, errors: [] };
  },
  serialize: (v) => v,
  parse: (raw) => { const n = Number(raw); return isNaN(n) ? 0 : n; },
  toJsonSchema: () => ({ type: 'number' }),
  toMarkdown: (v) => String(v),
  Editor: NumberEditor,
  Viewer: NumberViewer,
};

// ─── Boolean ─────────────────────────────────────────────────────────────────

function BooleanEditor({ value, onChange, readOnly }: MetadataEditorInputProps<boolean>) {
  return (
    <input
      type="checkbox"
      className="checkbox checkbox-sm"
      checked={!!value}
      onChange={(e) => onChange(e.target.checked)}
      disabled={readOnly}
    />
  );
}

function BooleanViewer({ value }: MetadataViewerProps<boolean>) {
  return <span>{value ? 'true' : 'false'}</span>;
}

export const builtinBooleanContribution: MetadataTypeContribution<boolean> = {
  type: 'boolean',
  label: 'Boolean',
  defaultValue: false,
  validate(value) {
    if (typeof value !== 'boolean') return { ok: false, errors: [{ path: '', message: `Expected boolean` }] };
    return { ok: true, errors: [] };
  },
  serialize: (v) => v,
  parse: (raw) => !!raw,
  toJsonSchema: () => ({ type: 'boolean' }),
  toMarkdown: (v) => String(v),
  Editor: BooleanEditor,
  Viewer: BooleanViewer,
};

// ─── Date ────────────────────────────────────────────────────────────────────

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function DateEditor({ value, onChange, readOnly }: MetadataEditorInputProps<string>) {
  return (
    <input
      type="date"
      className="input input-bordered input-sm"
      value={typeof value === 'string' ? value : ''}
      onChange={(e) => onChange(e.target.value)}
      disabled={readOnly}
    />
  );
}

function DateViewer({ value }: MetadataViewerProps<string>) {
  return <span style={{ fontSize: 'var(--fs-xs)' }}>{String(value ?? '')}</span>;
}

export const builtinDateContribution: MetadataTypeContribution<string> = {
  type: 'date',
  label: 'Date',
  defaultValue: '',
  validate(value) {
    if (typeof value !== 'string') return { ok: false, errors: [{ path: '', message: `Expected ISO date string` }] };
    if (value !== '' && !ISO_DATE_RE.test(value)) {
      return { ok: false, errors: [{ path: '', message: `Expected ISO date (YYYY-MM-DD), got '${value}'` }] };
    }
    return { ok: true, errors: [] };
  },
  serialize: (v) => v,
  parse: (raw) => raw === undefined || raw === null ? '' : String(raw),
  toJsonSchema: () => ({ type: 'string', format: 'date' }),
  toMarkdown: (v) => String(v),
  Editor: DateEditor,
  Viewer: DateViewer,
};

// ─── Flag ────────────────────────────────────────────────────────────────────

function FlagEditor({ value, onChange, readOnly }: MetadataEditorInputProps<boolean>) {
  return (
    <input
      type="checkbox"
      className="toggle toggle-primary toggle-sm"
      checked={!!value}
      onChange={(e) => onChange(e.target.checked)}
      disabled={readOnly}
    />
  );
}

function FlagViewer({ value }: MetadataViewerProps<boolean>) {
  return <span>{value ? 'yes' : 'no'}</span>;
}

export const builtinFlagContribution: MetadataTypeContribution<boolean> = {
  type: 'flag',
  label: 'Flag',
  defaultValue: false,
  validate(value) {
    if (typeof value !== 'boolean') return { ok: false, errors: [{ path: '', message: `Expected boolean flag` }] };
    return { ok: true, errors: [] };
  },
  serialize: (v) => v,
  parse: (raw) => !!raw,
  toJsonSchema: () => ({ type: 'boolean' }),
  toMarkdown: (v) => v ? 'true' : 'false',
  Editor: FlagEditor,
  Viewer: FlagViewer,
};

// ─── Rule ────────────────────────────────────────────────────────────────────

function RuleEditor({ value, onChange, def, readOnly }: MetadataEditorInputProps<string>) {
  return (
    <textarea
      className="textarea textarea-bordered textarea-sm flex-1"
      value={typeof value === 'string' ? value : ''}
      onChange={(e) => onChange(e.target.value)}
      placeholder={def.description || 'Describe the rule...'}
      rows={2}
      disabled={readOnly}
    />
  );
}

function RuleViewer({ value }: MetadataViewerProps<string>) {
  return <span style={{ whiteSpace: 'pre-wrap' }}>{String(value ?? '')}</span>;
}

export const builtinRuleContribution: MetadataTypeContribution<string> = {
  type: 'rule',
  label: 'Rule',
  defaultValue: '',
  validate(value) {
    if (typeof value !== 'string') return { ok: false, errors: [{ path: '', message: `Expected rule text string` }] };
    return { ok: true, errors: [] };
  },
  serialize: (v) => v,
  parse: (raw) => raw === undefined || raw === null ? '' : String(raw),
  toJsonSchema: () => ({ type: 'string' }),
  toMarkdown: (v) => String(v),
  Editor: RuleEditor,
  Viewer: RuleViewer,
};

// ─── Object ──────────────────────────────────────────────────────────────────
// Editor recurses into MetadataField (NOT MetadataBlock) to handle nested defs.
// We use a lazy dynamic import to avoid circular deps with MetadataEditor.tsx.

function ObjectViewer({ value, def }: MetadataViewerProps<{ [k: string]: MetadataValue }>) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return <span className="text-warning">—</span>;
  }
  return (
    <div style={{ paddingLeft: 8 }}>
      {Object.entries(value).map(([k, v]) => (
        <div key={k} style={{ fontSize: 'var(--fs-xs)' }}>
          <strong>{k}:</strong> {typeof v === 'object' ? JSON.stringify(v) : String(v)}
        </div>
      ))}
    </div>
  );
}

// Lazy MetadataField reference — resolved at render time to avoid circular dep.
let _MetadataField: React.ComponentType<{
  value: MetadataValue;
  definition: MetadataDefinition;
  onChange: (next: MetadataValue) => void;
  path: string;
  readOnly?: boolean;
}> | null = null;

export function setMetadataFieldComponent(
  c: React.ComponentType<{
    value: MetadataValue;
    definition: MetadataDefinition;
    onChange: (next: MetadataValue) => void;
    path: string;
    readOnly?: boolean;
  }>,
): void {
  _MetadataField = c;
}

function ObjectEditor({ value, onChange, def, path, readOnly }: MetadataEditorInputProps<{ [k: string]: MetadataValue }>) {
  const obj: { [k: string]: MetadataValue } = (typeof value === 'object' && value !== null && !Array.isArray(value))
    ? (value as { [k: string]: MetadataValue })
    : {};

  const MetadataField = _MetadataField;

  if (!MetadataField || !def.fields || def.fields.length === 0) {
    return <ObjectViewer value={obj} def={def} />;
  }

  return (
    <div className="space-y-2 pl-4 border-l border-base-300">
      {def.fields.map((fieldDef) => {
        const fieldValue = obj[fieldDef.name] ?? '';
        const fieldPath = path ? `${path}.${fieldDef.name}` : fieldDef.name;
        return (
          <div key={fieldDef.name} className="flex items-start gap-2">
            <div className="min-w-[100px]">
              <span className="text-xs font-mono">{fieldDef.name}</span>
              {fieldDef.required && <span className="text-error text-xs ml-0.5">*</span>}
            </div>
            <MetadataField
              value={fieldValue}
              definition={fieldDef}
              onChange={(next) => onChange({ ...obj, [fieldDef.name]: next })}
              path={fieldPath}
              readOnly={readOnly}
            />
          </div>
        );
      })}
    </div>
  );
}

export const builtinObjectContribution: MetadataTypeContribution<{ [k: string]: MetadataValue }> = {
  type: 'object',
  label: 'Object',
  defaultValue: {},
  validate(value, def) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return { ok: false, errors: [{ path: '', message: `Expected object` }] };
    }
    const errors: Array<{ path: string; message: string }> = [];
    if (def.fields) {
      for (const fieldDef of def.fields) {
        const v = (value as Record<string, MetadataValue>)[fieldDef.name];
        if (fieldDef.required && (v === undefined || v === '' || v === null)) {
          errors.push({ path: fieldDef.name, message: `Required field '${fieldDef.name}' is missing` });
        }
      }
    }
    if (errors.length > 0) return { ok: false, errors };
    return { ok: true, errors: [] };
  },
  serialize: (v) => v as MetadataValue,
  parse: (raw) => {
    if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) return raw as { [k: string]: MetadataValue };
    return {};
  },
  toJsonSchema: (def) => {
    const schema: Record<string, unknown> = { type: 'object' };
    if (def.fields && def.fields.length > 0) {
      schema.properties = Object.fromEntries(def.fields.map(f => [f.name, { type: 'string', description: f.description }]));
      const required = def.fields.filter(f => f.required).map(f => f.name);
      if (required.length > 0) schema.required = required;
    }
    return schema;
  },
  toMarkdown: (value) => {
    const lines = Object.entries(value).map(([k, v]) => `  - ${k}: ${String(v)}`);
    return lines.join('\n');
  },
  Editor: ObjectEditor,
  Viewer: ObjectViewer,
};

// ─── Array ───────────────────────────────────────────────────────────────────

function ArrayViewer({ value }: MetadataViewerProps<MetadataValue[]>) {
  if (!Array.isArray(value)) return <span className="text-warning">—</span>;
  return (
    <div style={{ paddingLeft: 8 }}>
      {value.map((item, i) => (
        <div key={i} style={{ fontSize: 'var(--fs-xs)' }}>
          {i + 1}. {typeof item === 'object' ? JSON.stringify(item) : String(item)}
        </div>
      ))}
    </div>
  );
}

function ArrayEditor({ value, onChange, def, path, readOnly }: MetadataEditorInputProps<MetadataValue[]>) {
  const arr: MetadataValue[] = Array.isArray(value) ? value : [];
  const MetadataField = _MetadataField;

  if (!MetadataField || !def.items) {
    return <ArrayViewer value={arr} def={def} />;
  }

  const addItem = () => {
    const newItem: MetadataValue = def.items?.type === 'object' ? {} : '';
    onChange([...arr, newItem]);
  };

  const removeItem = (i: number) => {
    const next = arr.filter((_, idx) => idx !== i);
    onChange(next);
  };

  return (
    <div className="space-y-2">
      {arr.map((item, i) => (
        <div key={i} className="flex items-start gap-2">
          <span className="text-xs text-base-content/50 mt-1">{i + 1}.</span>
          <div className="flex-1">
            <MetadataField
              value={item}
              definition={def.items!}
              onChange={(next) => {
                const updated = [...arr];
                updated[i] = next;
                onChange(updated);
              }}
              path={`${path}[${i}]`}
              readOnly={readOnly}
            />
          </div>
          {!readOnly && (
            <button
              type="button"
              className="btn btn-ghost btn-xs text-error"
              onClick={() => removeItem(i)}
            >
              &times;
            </button>
          )}
        </div>
      ))}
      {!readOnly && (
        <button type="button" className="btn btn-xs btn-ghost" onClick={addItem}>
          + Add item
        </button>
      )}
    </div>
  );
}

export const builtinArrayContribution: MetadataTypeContribution<MetadataValue[]> = {
  type: 'array',
  label: 'Array',
  defaultValue: [],
  validate(value) {
    if (!Array.isArray(value)) return { ok: false, errors: [{ path: '', message: `Expected array` }] };
    return { ok: true, errors: [] };
  },
  serialize: (v) => v as MetadataValue,
  parse: (raw) => Array.isArray(raw) ? raw as MetadataValue[] : [],
  toJsonSchema: (def) => {
    const schema: Record<string, unknown> = { type: 'array' };
    if (def.items) schema.items = { type: 'object', description: def.items.description };
    return schema;
  },
  toMarkdown: (value) => value.map((item, i) => `  ${i + 1}. ${String(item)}`).join('\n'),
  Editor: ArrayEditor,
  Viewer: ArrayViewer,
};

// ─── Enum ────────────────────────────────────────────────────────────────────

function EnumEditor({ value, onChange, def, readOnly }: MetadataEditorInputProps<string | number>) {
  const options = def.enum || [];
  return (
    <select
      className="select select-bordered select-sm"
      value={typeof value === 'string' || typeof value === 'number' ? String(value) : ''}
      onChange={(e) => onChange(e.target.value)}
      disabled={readOnly}
    >
      <option value="">— select —</option>
      {options.map((opt) => {
        const v = typeof opt === 'object' ? opt.value : opt;
        const l = typeof opt === 'object' ? opt.label : String(opt);
        return <option key={String(v)} value={String(v)}>{l}</option>;
      })}
    </select>
  );
}

function EnumViewer({ value }: MetadataViewerProps<string | number>) {
  return <span>{String(value ?? '')}</span>;
}

export const builtinEnumContribution: MetadataTypeContribution<string | number> = {
  type: 'enum',
  label: 'Enum',
  defaultValue: '',
  validate(value, def) {
    if (typeof value !== 'string' && typeof value !== 'number') {
      return { ok: false, errors: [{ path: '', message: `Expected string or number for enum` }] };
    }
    if (def.enum && def.enum.length > 0) {
      const allowed = def.enum.map((e) => typeof e === 'object' ? e.value : e);
      if (!allowed.includes(value)) {
        return { ok: false, errors: [{ path: '', message: `Value '${value}' is not one of the allowed enum values` }] };
      }
    }
    return { ok: true, errors: [] };
  },
  serialize: (v) => v as MetadataValue,
  parse: (raw) => {
    if (typeof raw === 'number') return raw;
    return raw === undefined || raw === null ? '' : String(raw);
  },
  toJsonSchema: (def) => {
    const schema: Record<string, unknown> = { type: 'string' };
    if (def.enum && def.enum.length > 0) {
      schema.enum = def.enum.map((e) => typeof e === 'object' ? e.value : e);
    }
    return schema;
  },
  toMarkdown: (v) => String(v),
  Editor: EnumEditor,
  Viewer: EnumViewer,
};

// ─── Registration helper ─────────────────────────────────────────────────────

export function registerBuiltinContributions(r: MetadataTypeRegistry): void {
  r.register(builtinStringContribution);
  r.register(builtinNumberContribution);
  r.register(builtinBooleanContribution);
  r.register(builtinDateContribution);
  r.register(builtinFlagContribution);
  r.register(builtinRuleContribution);
  r.register(builtinObjectContribution);
  r.register(builtinArrayContribution);
  r.register(builtinEnumContribution);
}
