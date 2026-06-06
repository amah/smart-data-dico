/**
 * EntityPhysicalSection — typed editor for entity-level physical mapping
 * (`physical.tableName`, `physical.schema`), mirroring the "Physical" section on
 * the attribute detail page and the OrmMappingSection editor. Pure metadata —
 * saving just rewrites metadata[], preserving every other (incl. other
 * `physical.*`) key untouched.
 *
 * Table/column names are owned by `physical.*` (DBA / persistence layer), kept
 * deliberately separate from the JPA behaviour carried under `orm.*`.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { Button, Chip, Icon } from './ui';
import type { MetadataEntry, MetadataValue } from '../types';

interface FieldDef {
  key: string;
  label: string;
  placeholder: string;
  mapsTo: string;
}

const FIELDS: FieldDef[] = [
  { key: 'physical.tableName', label: 'Table name', placeholder: 'orders', mapsTo: '@Table(name)' },
  { key: 'physical.schema', label: 'Schema', placeholder: 'public', mapsTo: '@Table(schema)' },
];

const MANAGED = new Set(FIELDS.map(f => f.key));

interface Props {
  metadata: MetadataEntry[] | undefined;
  onSave: (next: MetadataEntry[]) => void | Promise<void>;
  /** Render the form (inputs) up-front instead of the read view. */
  defaultEditing?: boolean;
}

const valueOf = (md: MetadataEntry[] | undefined, key: string): MetadataValue | undefined =>
  (md || []).find(m => m.name === key)?.value;

function toDraft(md: MetadataEntry[] | undefined): Record<string, string> {
  const d: Record<string, string> = {};
  for (const f of FIELDS) {
    const v = valueOf(md, f.key);
    d[f.key] = v === undefined || v === null ? '' : String(v);
  }
  return d;
}

export default function EntityPhysicalSection({ metadata, onSave, defaultEditing }: Props) {
  const [open, setOpen] = useState(true);
  const [editing, setEditing] = useState(!!defaultEditing);
  const [draft, setDraft] = useState<Record<string, string>>(() => toDraft(metadata));
  const [saving, setSaving] = useState(false);

  // Keep the draft in sync with saved metadata in default-editing mode (e.g.
  // after a save → refresh round-trip).
  useEffect(() => {
    if (defaultEditing) setDraft(toDraft(metadata));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultEditing, metadata]);

  const setEntries = (metadata || []).filter(m => MANAGED.has(m.name));
  const isOpen = editing ? true : open;

  const beginEdit = () => { setDraft(toDraft(metadata)); setEditing(true); };
  const cancel = () => {
    if (defaultEditing) setDraft(toDraft(metadata)); // reset, stay in the form
    else setEditing(false);
  };

  const save = async () => {
    setSaving(true);
    try {
      // Preserve everything except the managed keys, then re-add from draft.
      const next: MetadataEntry[] = (metadata || []).filter(m => !MANAGED.has(m.name));
      for (const f of FIELDS) {
        const s = (draft[f.key] ?? '').trim();
        if (s) next.push({ name: f.key, value: s });
      }
      await onSave(next);
      if (!defaultEditing) setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  const inputStyle: React.CSSProperties = {
    fontSize: 'var(--fs-sm)', padding: '4px 8px', borderRadius: 'var(--radius-sm)',
    border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', minWidth: 180,
  };

  return (
    <section style={{ background: 'var(--bg-raised)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: 'var(--bg-subtle)', borderBottom: isOpen ? '1px solid var(--border)' : 'none' }}>
        <button type="button" onClick={() => setOpen(o => !o)} disabled={editing}
          aria-label={isOpen ? 'Collapse' : 'Expand'}
          style={{ background: 'transparent', border: 'none', cursor: editing ? 'default' : 'pointer', color: 'var(--text-subtle)', display: 'flex', alignItems: 'center' }}>
          <Icon name="chevron" size={10} style={{ transform: isOpen ? 'rotate(0deg)' : 'rotate(-90deg)' }} />
        </button>
        <h2 className="uppercase" style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-subtle)', letterSpacing: '0.06em', fontWeight: 600, margin: 0 }}>
          Physical
        </h2>
        <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-subtle)' }}>metadata.physical.*</span>
        <div style={{ flex: 1 }} />
        {!editing && <Button size="sm" variant="ghost" icon="edit" onClick={beginEdit}>Edit</Button>}
        {editing && (
          <>
            <Button size="sm" variant="primary" icon="check" onClick={save} disabled={saving}>Save</Button>
            <Button size="sm" variant="ghost" onClick={cancel} disabled={saving}>Cancel</Button>
          </>
        )}
      </header>

      {isOpen && (
        <div style={{ padding: '12px' }}>
          {editing ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '10px 14px', alignItems: 'center' }}>
              {FIELDS.map(f => (
                <FieldRow key={f.key} def={f}>
                  <input
                    style={inputStyle}
                    type="text"
                    value={draft[f.key] ?? ''}
                    placeholder={f.placeholder}
                    onChange={e => setDraft(d => ({ ...d, [f.key]: e.target.value }))}
                  />
                </FieldRow>
              ))}
            </div>
          ) : setEntries.length === 0 ? (
            <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-subtle)', margin: 0 }}>
              No physical mapping set — the table name defaults to the entity name by convention.
              Click Edit to set the table name / schema, or import them via Physical Sync.
            </p>
          ) : (
            <dl style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '6px 14px', margin: 0 }}>
              {FIELDS.filter(f => valueOf(metadata, f.key)).map(f => (
                <FragmentRow key={f.key} term={f.label}>
                  <Chip mono soft>{String(valueOf(metadata, f.key))}</Chip>
                </FragmentRow>
              ))}
            </dl>
          )}
        </div>
      )}
    </section>
  );
}

function FieldRow({ def, children }: { def: FieldDef; children: ReactNode }) {
  return (
    <>
      <label title={def.mapsTo} style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-subtle)' }}>{def.label}</label>
      <div>{children}</div>
    </>
  );
}

function FragmentRow({ term, children }: { term: string; children: ReactNode }) {
  return (
    <>
      <dt style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-subtle)' }}>{term}</dt>
      <dd style={{ margin: 0 }}>{children}</dd>
    </>
  );
}
