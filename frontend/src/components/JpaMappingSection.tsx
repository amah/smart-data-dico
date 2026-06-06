/**
 * JpaMappingSection — typed editor for the reserved `jpa.*` metadata, mirroring
 * the "Physical" section on the detail pages. Keys/values come from the backend
 * vocabulary (GET /api/jpa/vocabulary via useJpaVocabulary), so the editor can't
 * drift from the validator. Pure metadata — saving just rewrites metadata[].
 */
import { useMemo, useState, type ReactNode } from 'react';
import { Button, Chip, Icon } from './ui';
import type { MetadataEntry, MetadataValue } from '../types';
import { useJpaVocabulary } from '../hooks/useJpaVocabulary';
import type { JpaKeyDef } from '../services/api';

type Scope = 'entity' | 'attribute' | 'relationship';
type Draft = Record<string, string | boolean | string[]>;

interface Props {
  scope: Scope;
  metadata: MetadataEntry[] | undefined;
  onSave: (next: MetadataEntry[]) => void | Promise<void>;
  /** For the `entityRef` picker (jpa.extends). */
  entities?: Array<{ uuid: string; name: string }>;
  /** Optional read-only preview (e.g. derived annotations) shown under the fields. */
  preview?: ReactNode;
}

const labelOf = (md: MetadataEntry[] | undefined, key: string): MetadataValue | undefined =>
  (md || []).find(m => m.name === key)?.value;

function toDraft(defs: JpaKeyDef[], md: MetadataEntry[] | undefined): Draft {
  const d: Draft = {};
  for (const def of defs) {
    const v = labelOf(md, def.key);
    if (def.kind === 'flag') d[def.key] = v === true || v === 'true';
    else if (def.kind === 'enumList') {
      d[def.key] = Array.isArray(v)
        ? v.map(String)
        : (v ? String(v).split(',').map(s => s.trim()).filter(Boolean) : []);
    } else d[def.key] = v === undefined || v === null ? '' : String(v);
  }
  return d;
}

export default function JpaMappingSection({ scope, metadata, onSave, entities, preview }: Props) {
  const vocab = useJpaVocabulary();
  const defs = useMemo<JpaKeyDef[]>(() => vocab?.scopes[scope] ?? [], [vocab, scope]);
  const [open, setOpen] = useState(true);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Draft>({});
  const [saving, setSaving] = useState(false);

  if (!vocab) return null; // vocabulary not loaded (or endpoint unavailable) — hide gracefully

  const knownKeys = new Set(defs.map(d => d.key));
  const setEntries = (metadata || []).filter(m => knownKeys.has(m.name));
  const isOpen = editing ? true : open;

  const beginEdit = () => { setDraft(toDraft(defs, metadata)); setEditing(true); };
  const cancel = () => setEditing(false);

  const save = async () => {
    setSaving(true);
    try {
      // Preserve everything except the known jpa.* keys, then re-add from draft.
      const next: MetadataEntry[] = (metadata || []).filter(m => !knownKeys.has(m.name));
      for (const def of defs) {
        const v = draft[def.key];
        if (def.kind === 'flag') {
          if (v === true) next.push({ name: def.key, value: true });
        } else if (def.kind === 'enumList') {
          const arr = (v as string[]) || [];
          if (arr.length) next.push({ name: def.key, value: arr.join(',') });
        } else {
          const s = (v ?? '').toString().trim();
          if (s) next.push({ name: def.key, value: def.kind === 'int' ? Number(s) : s });
        }
      }
      await onSave(next);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  const setKey = (key: string, value: string | boolean | string[]) =>
    setDraft(d => ({ ...d, [key]: value }));

  const inputStyle: React.CSSProperties = {
    fontSize: 'var(--fs-sm)', padding: '4px 8px', borderRadius: 'var(--radius-sm)',
    border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', minWidth: 180,
  };

  const renderField = (def: JpaKeyDef) => {
    const v = draft[def.key];
    if (def.kind === 'flag') {
      return (
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--fs-sm)' }}>
          <input type="checkbox" checked={v === true} onChange={e => setKey(def.key, e.target.checked)} />
          {def.label}
        </label>
      );
    }
    if (def.kind === 'enum') {
      return (
        <select style={inputStyle} value={String(v ?? '')} onChange={e => setKey(def.key, e.target.value)}>
          <option value="">— {def.label} —</option>
          {(def.values || []).map(opt => <option key={opt} value={opt}>{opt}</option>)}
        </select>
      );
    }
    if (def.kind === 'enumList') {
      const sel = (v as string[]) || [];
      return (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {(def.values || []).map(opt => (
            <label key={opt} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 'var(--fs-xs)' }}>
              <input
                type="checkbox"
                checked={sel.includes(opt)}
                onChange={e => setKey(def.key, e.target.checked ? [...sel, opt] : sel.filter(x => x !== opt))}
              />
              {opt}
            </label>
          ))}
        </div>
      );
    }
    if (def.kind === 'entityRef') {
      const cur = String(v ?? '');
      const known = (entities || []).some(e => e.uuid === cur || e.name === cur);
      return (
        <select style={inputStyle} value={cur} onChange={e => setKey(def.key, e.target.value)}>
          <option value="">— none —</option>
          {!known && cur && <option value={cur}>{cur} (unresolved)</option>}
          {(entities || []).map(e => <option key={e.uuid} value={e.uuid}>{e.name}</option>)}
        </select>
      );
    }
    // string / int
    return (
      <input
        style={inputStyle}
        type={def.kind === 'int' ? 'number' : 'text'}
        value={String(v ?? '')}
        placeholder={def.label}
        onChange={e => setKey(def.key, e.target.value)}
      />
    );
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
          JPA mapping
        </h2>
        <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-subtle)' }}>metadata.jpa.*</span>
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
              {defs.map(def => (
                <FieldRow key={def.key} def={def}>{renderField(def)}</FieldRow>
              ))}
            </div>
          ) : setEntries.length === 0 ? (
            <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-subtle)', margin: 0 }}>
              No JPA mapping set — defaults are derived by convention. Click Edit to override.
            </p>
          ) : (
            <dl style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '6px 14px', margin: 0 }}>
              {setEntries.map(m => (
                <FragmentRow key={m.name} term={defs.find(d => d.key === m.name)?.label || m.name}>
                  <Chip mono soft>{String(m.value)}</Chip>
                </FragmentRow>
              ))}
            </dl>
          )}
          {preview && <div style={{ marginTop: 14 }}>{preview}</div>}
        </div>
      )}
    </section>
  );
}

function FieldRow({ def, children }: { def: JpaKeyDef; children: ReactNode }) {
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
