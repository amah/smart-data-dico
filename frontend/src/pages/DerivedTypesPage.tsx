/**
 * Derived Data Types page (#107 + rollout 4.7).
 *
 * Grammar (Data Types):
 *   - Split layout: 280px list (left) + editor (right)
 *   - Editor sections: Identity · Regex with live tester · Constraints
 *     · Enum editor · Format / validation · Used by
 *   - Regex tester shows green when the sample matches, red when it
 *     doesn't, amber on an invalid pattern ("Bad regex")
 *   - Save is draft-oriented: edits stay local until the user clicks
 *     Save, which writes the whole types[] list back (matches the
 *     existing PUT /api/config/types contract).
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { configApi, entityApi, type DerivedType, type ValueDomain, type ValueDomainKind } from '../services/api';
import { AttributeType } from '../types';
import {
  Button,
  Chip,
  Icon,
  Input,
  Toolbar,
  TypeChip,
} from '../components/ui';

const STANDARD_TYPES = Object.values(AttributeType) as string[];

interface UsedByRef {
  service: string;
  entityName: string;
  attributeName: string;
}

const DerivedTypesPage = () => {
  const [types, setTypes] = useState<DerivedType[]>([]);
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [usedBy, setUsedBy] = useState<Record<string, UsedByRef[]>>({});
  const [searchParams, setSearchParams] = useSearchParams();

  const load = useCallback(async () => {
    setLoading(true);
    setErrors([]);
    try {
      const list = await configApi.getDerivedTypes();
      setTypes(list);
      // Honour a `?name=` deep-link (e.g. a clickable source link) when present.
      const want = searchParams.get('name');
      setSelectedName(want && list.some(t => t.name === want) ? want : (list[0]?.name ?? null));
      setDirty(false);
    } catch (e: any) {
      setErrors([`Failed to load: ${e?.message || e}`]);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { load(); }, [load]);

  // Select a type and reflect it in the URL so the view is deep-linkable.
  const selectType = useCallback((name: string | null) => {
    setSelectedName(name);
    const next = new URLSearchParams(searchParams);
    if (name) next.set('name', name); else next.delete('name');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  // Honour external navigation to `/types?name=X` while the page is mounted.
  useEffect(() => {
    const want = searchParams.get('name');
    if (want && want !== selectedName && types.some(t => t.name === want)) {
      setSelectedName(want);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, types]);

  // Build a usedBy map: derived type name → [{service, entity, attribute}].
  useEffect(() => {
    let cancelled = false;
    entityApi.getAllPackages().then((pkgs) => {
      if (cancelled) return;
      const map: Record<string, UsedByRef[]> = {};
      for (const pkg of pkgs) {
        for (const entity of pkg.entities || []) {
          for (const attr of entity.attributes || []) {
            const t = attr.type as string;
            if (!STANDARD_TYPES.includes(t)) {
              (map[t] ||= []).push({
                service: pkg.name,
                entityName: entity.name,
                attributeName: attr.name,
              });
            }
          }
        }
      }
      setUsedBy(map);
    }).catch(() => { /* best effort */ });
    return () => { cancelled = true; };
  }, []);

  const filteredTypes = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return types;
    return types.filter(t =>
      t.name.toLowerCase().includes(needle) ||
      (t.description || '').toLowerCase().includes(needle) ||
      t.basedOn.toLowerCase().includes(needle),
    );
  }, [types, search]);

  const selected = useMemo(
    () => types.find(t => t.name === selectedName) || null,
    [types, selectedName],
  );

  const addType = () => {
    const name = `newType${types.length + 1}`;
    const next: DerivedType = { name, basedOn: 'string', description: '' };
    setTypes([...types, next]);
    setSelectedName(name);
    setDirty(true);
  };

  const updateSelected = (patch: Partial<DerivedType>) => {
    if (!selected) return;
    const original = selected.name;
    const updated: DerivedType = {
      ...selected,
      ...patch,
      validation: patch.validation !== undefined ? patch.validation : selected.validation,
    };
    setTypes(prev => prev.map(t => t.name === original ? updated : t));
    // If the name changed, keep the selection pointed at it.
    if (patch.name && patch.name !== original) setSelectedName(patch.name);
    setDirty(true);
  };

  const removeSelected = () => {
    if (!selected) return;
    const remaining = types.filter(t => t.name !== selected.name);
    setTypes(remaining);
    setSelectedName(remaining[0]?.name ?? null);
    setDirty(true);
  };

  const save = async () => {
    setSaving(true);
    setErrors([]);
    setMessage(null);
    try {
      await configApi.putDerivedTypes(types);
      setMessage('Saved.');
      setDirty(false);
      setTimeout(() => setMessage(null), 2500);
    } catch (e: any) {
      const resp = e?.response?.data;
      if (resp?.errors) setErrors(resp.errors);
      else setErrors([resp?.message || e?.message || 'Save failed']);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-3" style={{ padding: 12, height: '100%' }}>
      {/* Header + global save */}
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <div>
          <h1
            className="mono"
            style={{ fontSize: 'var(--fs-2xl)', fontWeight: 600, margin: 0 }}
          >
            Data types
          </h1>
          <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', marginTop: 4 }}>
            Reusable named types built on standard AttributeTypes. Available
            alongside the standard set in the attribute-type picker.
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {dirty && <Chip tone="warning" soft>unsaved</Chip>}
          {message && <Chip tone="success" soft>{message}</Chip>}
          <Button size="md" variant="primary" icon="check" onClick={save} disabled={saving || !dirty}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>

      {errors.length > 0 && (
        <div
          style={{
            padding: '10px 14px',
            background: 'var(--danger-soft)',
            color: 'var(--danger)',
            border: '1px solid var(--danger)',
            borderRadius: 'var(--radius-sm)',
            fontSize: 'var(--fs-sm)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <Icon name="warning" size={14} />
            <strong>Save blocked:</strong>
          </div>
          <ul style={{ marginLeft: 20, listStyle: 'disc' }}>
            {errors.map((e, i) => <li key={i}>{e}</li>)}
          </ul>
        </div>
      )}

      {/* Split layout */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '280px 1fr',
          gap: 12,
          flex: 1,
          minHeight: 0,
        }}
      >
        {/* Left list */}
        <aside
          style={{
            background: 'var(--bg-raised)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-md)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            height: 'fit-content',
            maxHeight: '100%',
          }}
        >
          <div
            style={{
              padding: 8,
              borderBottom: '1px solid var(--border)',
              display: 'flex',
              gap: 6,
              alignItems: 'center',
            }}
          >
            <Input
              icon="search"
              size="sm"
              placeholder="Filter…"
              value={search}
              onChange={(e) => setSearch(e.currentTarget.value)}
              width="100%"
            />
            <Button size="sm" variant="secondary" icon="plus" onClick={addType} iconOnly aria-label="new type" />
          </div>
          <div style={{ overflow: 'auto', flex: 1 }}>
            {loading ? (
              <div style={{ padding: 14, fontSize: 'var(--fs-sm)', color: 'var(--text-subtle)' }}>
                Loading…
              </div>
            ) : filteredTypes.length === 0 ? (
              <div style={{ padding: 14, fontSize: 'var(--fs-sm)', color: 'var(--text-subtle)' }}>
                {search ? 'No types match.' : 'No derived types yet.'}
              </div>
            ) : (
              filteredTypes.map((t) => {
                const active = t.name === selectedName;
                return (
                  <button
                    key={t.name}
                    type="button"
                    onClick={() => selectType(t.name)}
                    style={{
                      width: '100%',
                      textAlign: 'left',
                      padding: '7px 10px',
                      background: active ? 'var(--accent-soft)' : 'transparent',
                      color: active ? 'var(--accent)' : 'var(--text)',
                      border: 'none',
                      borderLeft: active ? '2px solid var(--accent)' : '2px solid transparent',
                      cursor: 'pointer',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 2,
                    }}
                    onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = 'var(--bg-hover)'; }}
                    onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent'; }}
                  >
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span className="mono" style={{ fontSize: 'var(--fs-sm)', fontWeight: 500 }}>
                        {t.name || '(unnamed)'}
                      </span>
                      {t.domain && <DomainBadge kind={t.domain.kind} />}
                    </span>
                    <span
                      className="mono"
                      style={{
                        fontSize: 'var(--fs-xs)',
                        color: active ? 'var(--accent)' : 'var(--text-subtle)',
                      }}
                    >
                      {t.domain?.source ? `source ${t.domain.source}` : `based on ${t.basedOn}`}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </aside>

        {/* Right editor */}
        <section
          style={{
            background: 'var(--bg-raised)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-md)',
            padding: 14,
            overflow: 'auto',
            minHeight: 300,
          }}
        >
          {!selected ? (
            <div
              style={{
                padding: 40,
                textAlign: 'center',
                color: 'var(--text-subtle)',
                fontSize: 'var(--fs-sm)',
              }}
            >
              {types.length === 0
                ? <>No derived types yet. Click <strong>+</strong> in the list to create one.</>
                : 'Select a type from the list to edit it.'}
            </div>
          ) : (
            <TypeEditor
              type={selected}
              siblings={types}
              usedBy={usedBy[selected.name] || []}
              onChange={updateSelected}
              onRemove={removeSelected}
            />
          )}
        </section>
      </div>
    </div>
  );
};

// ──────────────── Editor ────────────────

interface TypeEditorProps {
  type: DerivedType;
  siblings: DerivedType[];
  usedBy: UsedByRef[];
  onChange: (patch: Partial<DerivedType>) => void;
  onRemove: () => void;
}

const TypeEditor = ({ type, siblings, usedBy, onChange, onRemove }: TypeEditorProps) => {
  const updateValidation = (patch: Partial<NonNullable<DerivedType['validation']>>) => {
    const next = { ...(type.validation || {}), ...patch };
    // Drop empty/undefined keys so we don't persist clutter.
    for (const k of Object.keys(next) as (keyof typeof next)[]) {
      const v = next[k];
      if (v === undefined || v === '' || (Array.isArray(v) && v.length === 0)) {
        delete (next as any)[k];
      }
    }
    onChange({ validation: Object.keys(next).length > 0 ? next : undefined });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* Identity header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <div style={{ flex: 1 }}>
          <h2
            className="mono"
            style={{ fontSize: 'var(--fs-xl)', fontWeight: 600, margin: 0, letterSpacing: '-0.02em' }}
          >
            {type.name || '(unnamed)'}
          </h2>
          <div
            className="mono"
            style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-subtle)', marginTop: 2 }}
          >
            based on <TypeChip type={type.basedOn} />
          </div>
        </div>
        <Button size="sm" variant="danger" icon="close" onClick={onRemove}>Remove</Button>
      </div>

      {/* Identity section */}
      <Section title="Identity">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 180px', gap: 10 }}>
          <Field label="Name">
            <input
              type="text"
              value={type.name}
              onChange={(e) => onChange({ name: e.target.value })}
              style={fieldStyleMono}
            />
          </Field>
          <Field label="Based on">
            <select
              value={type.basedOn}
              onChange={(e) => onChange({ basedOn: e.target.value })}
              style={fieldStyleMono}
            >
              <optgroup label="Standard">
                {STANDARD_TYPES.map(s => <option key={s} value={s}>{s}</option>)}
              </optgroup>
              {siblings.filter(s => s.name && s.name !== type.name).length > 0 && (
                <optgroup label="Derived">
                  {siblings.filter(s => s.name && s.name !== type.name).map(s => (
                    <option key={s.name} value={s.name}>{s.name}</option>
                  ))}
                </optgroup>
              )}
            </select>
          </Field>
        </div>
        <Field label="Description">
          <input
            type="text"
            value={type.description || ''}
            onChange={(e) => onChange({ description: e.target.value })}
            placeholder="What this type represents…"
            style={fieldStyle}
          />
        </Field>
      </Section>

      {/* Value domain */}
      <Section
        title="Value domain"
        hint="enum (inline set) · codelist (static, sourced) · reference (sourced from a data source)."
      >
        <DomainEditor domain={type.domain} onChange={(domain) => onChange({ domain })} />
      </Section>

      {/* Regex tester */}
      <Section title="Regex" hint="Live-tested pattern. Paste a sample to see it match.">
        <RegexTester
          pattern={type.validation?.pattern || ''}
          onPatternChange={(v) => updateValidation({ pattern: v || undefined })}
        />
      </Section>

      {/* Constraints */}
      <Section title="Constraints" hint="Numeric + string bounds. Leave blank to omit.">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
          <ConstraintField
            label="minLength"
            value={type.validation?.minLength}
            onChange={(v) => updateValidation({ minLength: v })}
          />
          <ConstraintField
            label="maxLength"
            value={type.validation?.maxLength}
            onChange={(v) => updateValidation({ maxLength: v })}
          />
          <ConstraintField
            label="minimum"
            value={type.validation?.minimum}
            onChange={(v) => updateValidation({ minimum: v })}
          />
          <ConstraintField
            label="maximum"
            value={type.validation?.maximum}
            onChange={(v) => updateValidation({ maximum: v })}
          />
          <ConstraintField
            label="precision"
            value={type.validation?.precision}
            onChange={(v) => updateValidation({ precision: v })}
          />
          <ConstraintField
            label="scale"
            value={type.validation?.scale}
            onChange={(v) => updateValidation({ scale: v })}
          />
        </div>
      </Section>

      {/* Enum editor */}
      <Section title="Enum values" hint="Set of allowed literal values. Order is preserved.">
        <EnumEditor
          values={type.validation?.enumValues || []}
          onChange={(enumValues) => updateValidation({ enumValues })}
        />
      </Section>

      {/* Format */}
      <Section title="Format" hint="JSON Schema format keyword (email, uri, date, uuid, …).">
        <input
          type="text"
          value={type.validation?.format || ''}
          onChange={(e) => updateValidation({ format: e.target.value || undefined })}
          placeholder="email / uri / uuid / date-time / …"
          style={fieldStyleMono}
        />
      </Section>

      {/* Used by */}
      <Section title={`Used by (${usedBy.length})`}>
        {usedBy.length === 0 ? (
          <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-subtle)' }}>
            Not referenced by any attribute yet.
          </p>
        ) : (
          <ul
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 2,
              maxHeight: 180,
              overflow: 'auto',
            }}
          >
            {usedBy.map((u, i) => (
              <li key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--fs-sm)' }}>
                <Chip tone="meta" className="mono">{u.service}</Chip>
                <Link
                  to={`/packages/${u.service}/entities/${u.entityName}`}
                  className="mono"
                  style={{ color: 'var(--accent)' }}
                >
                  {u.entityName}
                </Link>
                <span style={{ color: 'var(--text-subtle)' }}>·</span>
                <span className="mono" style={{ color: 'var(--text-muted)' }}>{u.attributeName}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
};

// ──────────────── Value-domain editor ────────────────

const DOMAIN_KIND_TONE: Record<ValueDomainKind, string> = {
  enum: 'var(--accent)',
  codelist: 'var(--warning)',
  reference: 'var(--success)',
};

const DomainBadge = ({ kind }: { kind: ValueDomainKind }) => (
  <span
    style={{
      fontSize: 9, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4,
      color: '#fff', background: DOMAIN_KIND_TONE[kind], borderRadius: 3, padding: '1px 5px',
    }}
  >
    {kind}
  </span>
);

const DomainEditor = ({
  domain,
  onChange,
}: {
  domain?: ValueDomain;
  onChange: (d: ValueDomain | undefined) => void;
}) => {
  const kind = domain?.kind ?? '';

  const setKind = (k: string) => {
    if (!k) { onChange(undefined); return; }
    const next: ValueDomain = { kind: k as ValueDomainKind };
    // Carry over fields that remain valid for the new kind.
    if ((k === 'enum' || k === 'codelist') && domain?.values?.length) next.values = domain.values;
    if ((k === 'codelist' || k === 'reference') && domain?.source) next.source = domain.source;
    onChange(next);
  };

  const showValues = kind === 'enum' || kind === 'codelist';
  const showSource = kind === 'codelist' || kind === 'reference';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <Field label="Kind">
        <select value={kind} onChange={(e) => setKind(e.target.value)} style={fieldStyleMono}>
          <option value="">— none —</option>
          <option value="enum">enum — inline closed set</option>
          <option value="codelist">codelist — static, from a named source</option>
          <option value="reference">reference — sourced from a data source</option>
        </select>
      </Field>
      {showSource && domain && (
        <Field label={kind === 'reference' ? 'Source — data source name (required)' : 'Source — code list name (required)'}>
          <input
            type="text"
            value={domain.source || ''}
            onChange={(e) => onChange({ ...domain, source: e.target.value || undefined })}
            placeholder={kind === 'reference' ? 'e.g. geo/Country' : 'e.g. ISO-4217'}
            style={fieldStyleMono}
          />
        </Field>
      )}
      {showValues && domain && (
        <Field label={kind === 'codelist' ? 'Values — static codes' : 'Values'}>
          <EnumEditor
            values={domain.values || []}
            onChange={(values) => onChange({ ...domain, values: values.length ? values : undefined })}
          />
        </Field>
      )}
    </div>
  );
};

// ──────────────── Section / Field primitives ────────────────

const Section = ({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) => (
  <section>
    <header style={{ marginBottom: 6 }}>
      <div
        className="uppercase"
        style={{
          fontSize: 'var(--fs-xs)',
          color: 'var(--text-subtle)',
          letterSpacing: '0.06em',
          fontWeight: 600,
        }}
      >
        {title}
      </div>
      {hint && (
        <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-subtle)' }}>{hint}</div>
      )}
    </header>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {children}
    </div>
  </section>
);

const Field = ({ label, children }: { label: string; children: ReactNode }) => (
  <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
    <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>{label}</span>
    {children}
  </label>
);

interface ConstraintFieldProps {
  label: string;
  value?: number;
  onChange: (v: number | undefined) => void;
}

const ConstraintField = ({ label, value, onChange }: ConstraintFieldProps) => (
  <Field label={label}>
    <input
      type="number"
      value={value ?? ''}
      onChange={(e) => {
        const raw = e.target.value;
        if (raw === '') onChange(undefined);
        else onChange(Number(raw));
      }}
      style={fieldStyleMono}
    />
  </Field>
);

// ──────────────── Regex tester ────────────────

const RegexTester = ({
  pattern,
  onPatternChange,
}: {
  pattern: string;
  onPatternChange: (v: string) => void;
}) => {
  const [sample, setSample] = useState('');

  const result = useMemo(() => {
    if (!pattern) return { state: 'empty' as const };
    try {
      const re = new RegExp(pattern);
      if (!sample) return { state: 'empty' as const, compiled: re };
      return { state: re.test(sample) ? 'match' as const : 'nomatch' as const, compiled: re };
    } catch (e: any) {
      return { state: 'bad' as const, error: e?.message || 'Invalid pattern' };
    }
  }, [pattern, sample]);

  const { toneColor, toneBg, label } = (() => {
    switch (result.state) {
      case 'match':   return { toneColor: 'var(--success)', toneBg: 'var(--success-soft)', label: 'Matches' };
      case 'nomatch': return { toneColor: 'var(--danger)',  toneBg: 'var(--danger-soft)',  label: 'No match' };
      case 'bad':     return { toneColor: 'var(--warning)', toneBg: 'var(--warning-soft)', label: 'Bad regex' };
      default:        return { toneColor: 'var(--text-subtle)', toneBg: 'var(--bg-subtle)', label: 'Add a pattern + sample' };
    }
  })();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <Field label="Pattern">
        <input
          type="text"
          value={pattern}
          onChange={(e) => onPatternChange(e.target.value)}
          placeholder="^[^@\s]+@[^@\s]+\.[^@\s]+$"
          style={fieldStyleMono}
        />
      </Field>
      <Field label="Sample">
        <input
          type="text"
          value={sample}
          onChange={(e) => setSample(e.target.value)}
          placeholder="jane@example.com"
          style={fieldStyleMono}
        />
      </Field>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '6px 10px',
          background: toneBg,
          border: `1px solid ${toneColor}`,
          borderRadius: 'var(--radius-sm)',
          color: toneColor,
          fontSize: 'var(--fs-sm)',
        }}
      >
        <Icon name={result.state === 'match' ? 'check' : result.state === 'bad' ? 'warning' : 'info'} size={12} />
        <span>{label}</span>
        {result.state === 'bad' && (
          <span
            className="mono"
            style={{ fontSize: 'var(--fs-xs)', color: 'var(--warning)', marginLeft: 'auto' }}
          >
            {(result as any).error}
          </span>
        )}
      </div>
    </div>
  );
};

// ──────────────── Enum editor ────────────────

const EnumEditor = ({
  values,
  onChange,
}: {
  values: string[];
  onChange: (v: string[]) => void;
}) => {
  const [draft, setDraft] = useState('');

  const add = () => {
    const v = draft.trim();
    if (!v) return;
    if (values.includes(v)) { setDraft(''); return; }
    onChange([...values, v]);
    setDraft('');
  };

  const remove = (idx: number) => {
    onChange(values.filter((_, i) => i !== idx));
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
          placeholder="Value (Enter to add)"
          style={{ ...fieldStyleMono, flex: 1 }}
        />
        <Button size="sm" variant="secondary" icon="plus" onClick={add} disabled={!draft.trim()}>
          Add
        </Button>
      </div>
      {values.length === 0 ? (
        <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-subtle)' }}>
          No enum values yet.
        </div>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {values.map((v, i) => (
            <span
              key={v + i}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                padding: '2px 4px 2px 8px',
                background: 'var(--bg-subtle)',
                border: '1px solid var(--border-strong)',
                borderRadius: 'var(--radius-sm)',
                fontSize: 'var(--fs-xs)',
                fontFamily: 'var(--font-mono)',
                color: 'var(--text-muted)',
              }}
            >
              {v}
              <button
                type="button"
                aria-label={`remove ${v}`}
                onClick={() => remove(i)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--text-subtle)',
                  cursor: 'pointer',
                  padding: 0,
                  display: 'inline-flex',
                }}
              >
                <Icon name="close" size={10} />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
};

const fieldStyle = {
  height: 28,
  padding: '0 8px',
  fontSize: 'var(--fs-sm)',
  fontFamily: 'inherit',
  background: 'var(--bg-raised)',
  color: 'var(--text)',
  border: '1px solid var(--border-strong)',
  borderRadius: 'var(--radius-sm)',
  outline: 'none',
} as const;

const fieldStyleMono = {
  ...fieldStyle,
  fontFamily: 'var(--font-mono)',
} as const;

// Keep Toolbar imported in case future edits add page-level Toolbar usage.
void Toolbar;

export default DerivedTypesPage;
